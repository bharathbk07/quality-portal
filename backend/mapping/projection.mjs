import { endpointLabel } from "./endpoints.mjs";
import ELK from "elkjs/lib/elk.bundled.js";
import { createHash } from "node:crypto";
import { discovery } from "./metadata.mjs";
import { number } from "../shared/config.mjs";
const groupId = (s) =>
  "g" + createHash("sha256").update(s).digest("hex").slice(0, 16);
const palettes = {
  frontend: "#e8efff",
  gateway: "#e1f1ea",
  service: "#edf4f1",
  database: "#fff0df",
  cache: "#f8e9ec",
  queue: "#f2eafa",
  package: "#f1f3f6",
  external: "#f7f7f7",
  infrastructure: "#f0edff",
};
export async function projectGraph(
  graph,
  options = {},
  annotations = {},
  positions = {},
  env = process.env,
) {
  const view = options.view || "logical",
    groupBy =
      options.layout === "swimlanes" &&
      (!options.groupBy || options.groupBy === "none")
        ? "function"
        : options.groupBy || "none",
    layout = options.layout || "hierarchical";
  const environment = options.environment || "all",
    search = (options.search || "").toLowerCase();
  let nodes = graph.nodes.filter(
    (n) =>
      (environment === "all" ||
        (n.metadata?.deployments || []).some(
          (d) => d.environment === environment,
        )) &&
      (!search ||
        JSON.stringify({
          label: n.label,
          kind: n.kind,
          language: n.metadata?.primaryLanguage,
          owner: annotations[n.id]?.owner || n.metadata?.owner,
          caching: n.metadata?.caching,
        })
          .toLowerCase()
          .includes(search)),
  );
  let edges = graph.edges.filter(
    (e) =>
      nodes.some((n) => n.id === e.from) && nodes.some((n) => n.id === e.to),
  );
  if (view === "deployment" && environment === "all")
    nodes = [
      ...nodes,
      ...(graph.infrastructure || [])
        .filter(
          (i) =>
            !search || `${i.name} ${i.type}`.toLowerCase().includes(search),
        )
        .map((i) => ({
          id: i.id,
          label: i.name,
          kind: "infrastructure",
          evidence: [i.evidence],
          metadata: {
            primaryLanguage: "Infrastructure",
            deployments: [
              {
                platform: i.provider,
                environment: "Unspecified",
                kind: i.type,
              },
            ],
            owner: "",
          },
        })),
    ];
  const environments = [
    ...new Set(
      graph.nodes.flatMap((n) =>
        (n.metadata?.deployments || []).map((d) => d.environment),
      ),
    ),
  ].sort();
  if (view === "high-level") {
    const kinds = [...new Set(nodes.map((n) => n.kind))];
    const membership = new Map();
    const groups = kinds.map((kind) => {
      const children = nodes.filter((n) => n.kind === kind);
      const id = groupId("overview:" + kind);
      children.forEach((n) => membership.set(n.id, id));
      return {
        id,
        label: kind[0].toUpperCase() + kind.slice(1) + ` · ${children.length}`,
        kind,
        members: children.map((n) => n.id),
        metadata: {
          primaryLanguage: [
            ...new Set(
              children.map((n) => n.metadata?.primaryLanguage || "Unknown"),
            ),
          ].join(", "),
        },
        evidence: children.flatMap((n) => n.evidence),
      };
    });
    const groupedEdges = new Map();
    for (const e of edges) {
      const from = membership.get(e.from),
        to = membership.get(e.to);
      if (from !== to) {
        const key = from + ":" + to;
        if (!groupedEdges.has(key))
          groupedEdges.set(key, {
            from,
            to,
            relation: "declared dependencies",
            evidence: [],
          });
        groupedEdges.get(key).evidence.push(...e.evidence);
      }
    }
    nodes = groups;
    edges = [...groupedEdges.values()];
  }
  const bucket = (n) =>
    groupBy === "function"
      ? {
          frontend: "User interface & experience",
          service: "Application services",
          database: "Persistent data stores",
          cache: "Caching layer",
          queue: "Messaging & events",
          package: "Libraries & modules",
          external: "External & unresolved dependencies",
          gateway: "Routing & gateways",
          infrastructure: "Infrastructure declarations",
        }[n.kind] || n.kind
      : groupBy === "language"
        ? n.metadata?.primaryLanguage || "Unknown"
        : groupBy === "team"
          ? annotations[n.id]?.owner || n.metadata?.owner || "Unassigned"
          : groupBy === "environment"
            ? (n.metadata?.deployments || [])
                .map((d) => d.environment)
                .join(" / ") || "Unspecified"
            : groupBy === "custom"
              ? annotations[n.id]?.group || "Ungrouped"
              : groupBy === "namespace"
                ? (n.metadata?.deployments || [])
                    .map((d) => d.namespace || d.platform)
                    .join(" / ") || "Undeclared"
                : "";
  const grouping = view !== "high-level" && groupBy !== "none";
  const buckets = [...new Set(nodes.map(bucket))].sort();
  const elkOptions = {
    "elk.algorithm": layout === "tree" ? "mrtree" : "layered",
    "elk.direction": layout === "tree" ? "DOWN" : "RIGHT",
    "elk.spacing.nodeNode": String(discovery.layout.spacing),
    "elk.layered.spacing.nodeNodeBetweenLayers": String(
      discovery.layout.spacing,
    ),
    "elk.hierarchyHandling": "INCLUDE_CHILDREN",
  };
  const elkNodes = nodes.map((n) => ({
    id: n.id,
    width: discovery.layout.nodeWidth,
    height: discovery.layout.nodeHeight,
  }));
  const children = grouping
    ? buckets.map((b) => ({
        id: groupId(view + ":" + groupBy + ":" + b),
        layoutOptions: {
          "elk.algorithm": "layered",
          "elk.direction": "DOWN",
          "elk.padding": `[top=${discovery.layout.groupPadding + 20},left=${discovery.layout.groupPadding},bottom=${discovery.layout.groupPadding},right=${discovery.layout.groupPadding}]`,
        },
        children: elkNodes.filter(
          (n) => bucket(nodes.find((x) => x.id === n.id)) === b,
        ),
      }))
    : elkNodes;
  const engine = new ELK();
  let timer;
  let result;
  try {
    result = await Promise.race([
      engine.layout({
        id: "root",
        layoutOptions: elkOptions,
        children,
        edges: edges.map((e, i) => ({
          id: "e" + i,
          sources: [e.from],
          targets: [e.to],
        })),
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              Object.assign(
                new Error("Layout timed out; reduce the map scope"),
                { statusCode: 422, expose: true },
              ),
            ),
          number("map_studio", "layout_timeout_ms", env),
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
    // The bundled Node fallback uses an in-process worker and owns no OS worker.
    if (typeof engine.worker?.worker?.terminate === "function")
      engine.terminateWorker();
  }
  const canvasNodes = [];
  for (const entry of result.children || []) {
    if (entry.children) {
      canvasNodes.push({
        id: entry.id,
        type: "group",
        draggable: false,
        selectable: false,
        position: { x: entry.x, y: entry.y },
        style: {
          width: entry.width,
          height: entry.height,
          backgroundColor: "rgba(227,232,246,.32)",
          border: "1px dashed #a7b5d1",
          borderRadius: 16,
        },
        data: {
          description:
            groupBy === "custom"
              ? nodes
                  .map((n) => annotations[n.id])
                  .find(
                    (a) =>
                      a?.group &&
                      groupId(view + ":" + groupBy + ":" + a.group) ===
                        entry.id,
                  )?.groupDescription || "Owner-defined component boundary"
              : `Components grouped by ${groupBy}; declared scope only`,
          label: buckets.find(
            (b) => groupId(view + ":" + groupBy + ":" + b) === entry.id,
          ),
        },
      });
      for (const child of entry.children)
        canvasNodes.push(formatNode(child, entry.id));
    } else canvasNodes.push(formatNode(entry));
  }
  function formatNode(entry, parentId) {
    const n = nodes.find((n) => n.id === entry.id);
    const annotation = annotations[n.id] || {};
    const subtitle =
      view === "deployment"
        ? (n.metadata?.deployments || [])
            .map(
              (d) =>
                `${d.platform} · ${d.environment}${d.replicas === null || d.replicas === undefined ? "" : ` · ${d.replicas} replica(s)`}`,
            )
            .join(" / ") || "Deployment unknown"
        : n.kind === "database"
          ? n.databaseNames?.join(", ") ||
            (() => {
              const images = (n.metadata?.deployments || [])
                .flatMap((d) => [
                  d.image,
                  ...(d.containers || []).map((c) => c.image),
                ])
                .filter(Boolean)
                .join(" ");
              const engine = images.match(
                /postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|oracle|mssql|cassandra|cockroach/gi,
              );
              return engine
                ? [...new Set(engine.map((x) => x.toLowerCase()))].join(" / ")
                : "Database engine not declared";
            })()
          : n.metadata?.primaryLanguage || "Language not detected";
    return {
      id: n.id,
      type: "service",
      position: positions[n.id] || { x: entry.x, y: entry.y },
      ...(parentId ? { parentId } : {}),
      style: {
        width: discovery.layout.nodeWidth,
        height: discovery.layout.nodeHeight,
      },
      data: {
        label: n.label,
        kind: n.kind,
        subtitle,
        members: n.members || [n.id],
        color: annotation.color || palettes[n.kind] || palettes.service,
        icon: annotation.icon || n.kind,
        hasCache: !!n.metadata?.caching?.length,
        hasWarning: !!annotation.warning,
        owner: annotation.owner || n.metadata?.owner || "Unknown",
      },
    };
  }
  return {
    view,
    groupBy,
    layout,
    environments,
    nodes: canvasNodes,
    edges: edges.map((e, i) => ({
      id: "edge-" + i,
      source: e.from,
      target: e.to,
      label: endpointLabel(e),
      markerEnd: { type: "arrowclosed" },
      ...(e.confidence === "ai-inferred"
        ? { style: { strokeDasharray: "6 4" } }
        : {}),
      data: {
        confidence: e.confidence || "repository-backed",
        evidence: e.evidence,
      },
    })),
    visibleComponents: nodes.length,
    totalComponents: graph.nodes.length,
    limits:
      "Static declared topology. Groups and positions are presentation only; no runtime discovery.",
  };
}

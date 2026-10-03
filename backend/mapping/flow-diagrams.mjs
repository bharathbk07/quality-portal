import { number } from "../shared/config.mjs";
import { safeSql } from "./database-access.mjs";
import { endpointLabel, safeEndpoint } from "./endpoints.mjs";
import ts from "typescript";
import { createHash } from "node:crypto";
const id = (s) =>
  "f" + createHash("sha256").update(s).digest("hex").slice(0, 16);
const label = (s) =>
  String(s || "")
    .replace(/[^\p{L}\p{N} ._/@(){}+-]/gu, " ")
    .replace(/\s+/g, " ")
    .slice(0, 140) || "Unresolved";
export function discoverFlowDetails(graph, files, roots) {
  const classes = [],
    machines = [];
  const owner = (p) =>
    [...roots]
      .sort((a, b) => b.root.length - a.root.length)
      .find((r) => r.id && (!r.root || p.startsWith(r.root + "/")))?.id;
  for (const file of files) {
    const from = owner(file.path);
    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.path)) {
      const ast = ts.createSourceFile(
        file.path,
        file.content,
        ts.ScriptTarget.Latest,
        true,
      );
      const visit = (n) => {
        if (ts.isClassDeclaration(n) && n.name && classes.length < 200)
          classes.push({
            id: id(file.path + ":" + n.name.text),
            name: n.name.text,
            base:
              n.heritageClauses?.flatMap((h) =>
                h.types.map((t) => t.expression.getText(ast)),
              ) || [],
            methods: n.members
              .filter(ts.isMethodDeclaration)
              .map((m) => m.name.getText(ast))
              .filter((m) => /^[\w$]+$/.test(m))
              .slice(0, 30),
            evidence: {
              path: file.path,
              line: ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1,
            },
          });
        if (from && ts.isCallExpression(n)) {
          const fn = n.expression.getText(ast);
          const first = n.arguments[0];
          if (
            /^(fetch|axios\.(get|post|put|patch|delete)|requests\.(get|post))$/.test(
              fn,
            ) &&
            first &&
            ts.isStringLiteral(first)
          ) {
            try {
              const u = new URL(first.text);
              const target = graph.nodes.find(
                (x) =>
                  x.label === u.hostname ||
                  x.metadata?.serviceName === u.hostname,
              );
              if (target && target.id !== from) {
                let method = fn.startsWith("axios.")
                  ? fn.split(".")[1].toUpperCase()
                  : "HTTP";
                if (fn === "fetch" && n.arguments.length === 1) method = "GET";
                if (
                  fn === "fetch" &&
                  n.arguments[1] &&
                  ts.isObjectLiteralExpression(n.arguments[1])
                ) {
                  const options = n.arguments[1].properties;
                  const declared = options.find(
                    (p) =>
                      ts.isPropertyAssignment(p) &&
                      p.name.getText(ast).replace(/["']/g, "") === "method",
                  );
                  if (declared && ts.isStringLiteral(declared.initializer))
                    method = declared.initializer.text.toUpperCase();
                  else if (!declared && !options.some(ts.isSpreadAssignment))
                    method = "GET";
                }
                const endpoint = safeEndpoint(first.text, method);
                const ev = {
                  path: file.path,
                  line:
                    ast.getLineAndCharacterOfPosition(n.getStart(ast)).line + 1,
                  detail: fn + " " + label(u.pathname),
                };
                const existing = graph.edges.find(
                  (e) =>
                    e.from === from &&
                    e.to === target.id &&
                    e.relation === "source HTTP call",
                );
                if (existing && endpoint) {
                  if (
                    !existing.endpoints.some(
                      (e) =>
                        e.path === endpoint.path &&
                        e.method === endpoint.method,
                    )
                  )
                    existing.endpoints.push({ ...endpoint, evidence: ev });
                  existing.evidence.push(ev);
                } else if (graph.edges.length < 500)
                  graph.edges.push({
                    from,
                    to: target.id,
                    relation: "source HTTP call",
                    endpoints: endpoint ? [{ ...endpoint, evidence: ev }] : [],
                    confidence: "repository-backed",
                    evidence: [ev],
                  });
              }
            } catch {
              /* Relative/dynamic destinations require runtime resolution. */
            }
          }
        }
        ts.forEachChild(n, visit);
      };
      visit(ast);
    }
    if (/\.json$/.test(file.path)) {
      try {
        const v = JSON.parse(file.content);
        if (v.initial && v.states && typeof v.states === "object") {
          const states = Object.keys(v.states).slice(0, 100),
            transitions = [];
          for (const s of states)
            for (const [event, t] of Object.entries(v.states[s]?.on || {})) {
              const target = typeof t === "string" ? t : t?.target;
              if (states.includes(target))
                transitions.push({ from: s, to: target, event });
            }
          machines.push({
            name: file.path,
            initial: v.initial,
            states,
            transitions: transitions.slice(0, 300),
            evidence: { path: file.path, line: 1 },
          });
        }
      } catch {
        /* Unsupported declarations remain unresolved. */
      }
    }
  }
  // Read database identity declarations without retaining credentials or connection strings.
  for (const file of files) {
    for (const match of file.content.matchAll(
      /(?:POSTGRES_DB|MYSQL_DATABASE|MONGO_INITDB_DATABASE|DB_NAME|DATABASE_NAME)\s*[:=]\s*["']?([A-Za-z][A-Za-z0-9_.-]{0,80})["']?\s*(?:$|[,\r\n])/gm,
    )) {
      const from = owner(file.path);
      let candidates = graph.nodes.filter(
        (n) =>
          n.kind === "database" &&
          (n.id === from || n.evidence.some((e) => e.path === file.path)),
      );
      if (candidates.length !== 1) continue;
      const n = candidates[0];
      n.databaseNames = [...new Set([...(n.databaseNames || []), match[1]])];
      n.evidence.push({
        path: file.path,
        line: file.content.slice(0, match.index).split("\n").length,
        detail: "Database name: " + match[1],
      });
    }
  }
  for (const file of files) {
    const declarations = [];
    for (const m of file.content.matchAll(
      /(?:jdbc:)?(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?):\/\/[^\s"'<>]+/gi,
    )) {
      try {
        const u = new URL(m[0].replace(/^jdbc:/, ""));
        const db = u.pathname.slice(1).split("/")[0];
        if (/^[A-Za-z][A-Za-z0-9_.-]*$/.test(db))
          declarations.push({ name: db, host: u.hostname, index: m.index });
      } catch {
        /* Ignore malformed and templated addresses. */
      }
    }
    for (const m of file.content.matchAll(
      /CREATE\s+DATABASE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?([A-Za-z][A-Za-z0-9_-]*)["`]?/gi,
    ))
      declarations.push({ name: m[1], index: m.index });
    for (const m of file.content.matchAll(
      /name:\s*(?:POSTGRES_DB|MYSQL_DATABASE|MONGO_INITDB_DATABASE)\s*\n\s*value:\s*["']?([A-Za-z][A-Za-z0-9_.-]*)["']?\s*(?:$|\n)/gm,
    ))
      declarations.push({ name: m[1], index: m.index });
    for (const d of declarations) {
      const candidates = graph.nodes.filter(
        (n) =>
          n.kind === "database" &&
          (d.host
            ? n.label === d.host
            : n.id === owner(file.path) ||
              n.evidence.some((e) => e.path === file.path)),
      );
      if (candidates.length !== 1) continue;
      const n = candidates[0];
      n.databaseNames = [...new Set([...(n.databaseNames || []), d.name])];
      n.evidence.push({
        path: file.path,
        line: file.content.slice(0, d.index).split("\n").length,
        detail: "Database name: " + d.name,
      });
    }
  }
  graph.flowDetails = { classes, machines };
  return graph;
}
export function flowDiagram(graph, type, entryId, spans = []) {
  const names = new Map(
    graph.nodes.map((n) => [
      n.id,
      label(n.label) +
        (n.databaseNames?.length
          ? " / " + n.databaseNames.map(label).join(", ")
          : ""),
    ]),
  );
  if (type === "class") {
    const c = graph.flowDetails?.classes || [];
    if (!c.length)
      throw new Error(
        "No supported class declarations found. Refresh the repository or choose another diagram.",
      );
    const lines = ["classDiagram"];
    for (const n of c) {
      lines.push(
        `class ${n.id}["${label(n.name)}"] {`,
        ...n.methods.map((m) => "  " + label(m) + "()"),
        "}",
      );
      for (const b of n.base) {
        const parent = c.filter((p) => p.name === b);
        if (parent.length === 1) lines.push(`${parent[0].id} <|-- ${n.id}`);
      }
    }
    return lines.join("\n");
  }
  if (type === "state") {
    const machines = graph.flowDetails?.machines || [];
    if (!machines.length)
      throw new Error(
        "No explicit JSON state-machine declarations found. States cannot be inferred from service dependencies.",
      );
    const lines = ["stateDiagram-v2"];
    for (const m of machines) {
      const mid = id(m.name);
      lines.push(`state "${label(m.name)}" as ${mid} {`);
      for (const s of m.states)
        lines.push(`state "${label(s)}" as ${id(m.name + s)}`);
      if (m.states.includes(m.initial))
        lines.push(`[*] --> ${id(m.name + m.initial)}`);
      for (const t of m.transitions)
        lines.push(
          `${id(m.name + t.from)} --> ${id(m.name + t.to)} : ${label(t.event)}`,
        );
      lines.push("}");
    }
    return lines.join("\n");
  }
  if (type === "trace") {
    const byId = new Map(spans.map((s) => [s.spanId, s]));
    if (byId.size !== spans.length || !spans.length)
      throw new Error("Provide unique spans from one trace.");
    if (new Set(spans.map((s) => s.traceId)).size !== 1)
      throw new Error("Spans must belong to one trace.");
    const services = [...new Set(spans.map((s) => s.service))];
    const lines = [
      "sequenceDiagram",
      ...services.map((s) => `participant ${id(s)} as ${label(s)}`),
    ];
    for (const s of [...spans].sort((a, b) => a.startTime - b.startTime)) {
      const p = byId.get(s.parentSpanId);
      const details = [
        s.operation,
        s.database &&
          [s.database.name, s.database.schema, s.database.table]
            .filter(Boolean)
            .join("."),
        s.durationMs !== undefined &&
          `${s.durationMs} ms observed span duration`,
        s.roundTrips !== undefined && `${s.roundTrips} round trips reported`,
        s.database?.timeoutMs !== undefined &&
          `${s.database.timeoutMs} ms reported timeout`,
      ]
        .filter(Boolean)
        .map(label)
        .join(" / ");
      if (p) lines.push(`${id(p.service)}->>${id(s.service)}: ${details}`);
      else
        lines.push(
          `Note over ${id(s.service)}: ${details} - root or missing parent`,
        );
      if (s.database?.query) {
        const query = safeSql(
          s.database.query,
          number("map_database", "query_max_chars"),
        );
        if (query)
          lines.push(
            `Note over ${id(s.service)}: SQL template ${label(query)}`,
          );
      }
    }
    return lines.join("\n");
  }
  const calls = graph.edges.filter((e) =>
    /call|endpoint|routes to|connects|publishes|consumes/i.test(e.relation),
  );
  const start =
    entryId ||
    graph.nodes.find((n) => n.kind === "frontend" || n.kind === "gateway")
      ?.id ||
    graph.nodes[0]?.id;
  if (!names.has(start))
    throw new Error("Select an entry service in this map.");
  const seen = new Set([start]),
    edges = [],
    queue = [start];
  while (queue.length) {
    const from = queue.shift();
    for (const e of calls.filter((e) => e.from === from)) {
      edges.push(e);
      if (!seen.has(e.to)) {
        seen.add(e.to);
        queue.push(e.to);
      }
    }
  }
  if (!edges.length)
    throw new Error(
      "No supported outgoing call evidence for this entry. Import more services/configuration or an observed trace.",
    );
  if (type === "sequence")
    return [
      "sequenceDiagram",
      ...[...seen].map((n) => `participant ${n} as ${names.get(n)}`),
      `Note over ${start}: Possible path from static evidence - order and execution unverified`,
      ...edges.map(
        (e) =>
          `${e.from}->>${e.to}: ${label(endpointLabel(e))} (${label(e.evidence?.[0]?.path)} L${e.evidence?.[0]?.line || 1})`,
      ),
    ].join("\n");
  const lines = [
    "flowchart LR",
    "%% Possible request flow; branch ordering and runtime execution unverified",
  ];
  for (const kind of [
    ...new Set(graph.nodes.filter((n) => seen.has(n.id)).map((n) => n.kind)),
  ]) {
    lines.push(`subgraph ${id(kind)}["${label(kind)} lane"]`);
    for (const n of graph.nodes.filter(
      (n) => seen.has(n.id) && n.kind === kind,
    ))
      lines.push(`${n.id}["${names.get(n.id)}"]`);
    lines.push("end");
  }
  lines.push(
    ...edges.map((e) => `${e.from} -->|"${label(endpointLabel(e))}"| ${e.to}`),
  );
  return lines.join("\n");
}

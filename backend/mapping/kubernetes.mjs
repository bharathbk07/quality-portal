import { declaredHttpCalls } from "./http-calls.mjs";
import { pythonEndpoints, safeEndpoint } from "./endpoints.mjs";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { number } from "../shared/config.mjs";

// Only declared resources are read. No manifests, commands, or repository code run.
export function kubernetesTopology(
  files,
  policy,
  { node, edge, roots, kind, warnings },
) {
  const documents = [];
  const artifacts = [];
  const imageName = (image) =>
    String(image || "")
      .split("/")
      .at(-1)
      .split(/[:@]/)[0];
  for (const file of files.filter((f) => /\.ya?ml$/i.test(f.path))) {
    try {
      for (const doc of parseAllDocuments(file.content, { uniqueKeys: true })) {
        if (doc.errors.length) continue;
        const data = doc.toJS({
          maxAliasCount: number("validation", "yaml_max_aliases"),
        });
        if (!data || typeof data !== "object") continue;
        const ev = (keys, detail) => {
          const offset =
            doc.getIn(keys, true)?.range?.[0] ?? doc.range?.[0] ?? 0;
          return {
            path: file.path,
            line: file.content.slice(0, offset).split("\n").length,
            detail,
          };
        };
        if (String(data.apiVersion).startsWith("skaffold/")) {
          for (const artifact of data.build?.artifacts || []) {
            if (
              typeof artifact.image !== "string" ||
              typeof artifact.context !== "string"
            )
              continue;
            const root = path.posix.normalize(
              path.posix.join(
                path.posix.dirname(file.path),
                artifact.context,
                typeof artifact.jib?.project === "string"
                  ? artifact.jib.project
                  : "",
              ),
            );
            if (!root.startsWith("..") && !root.includes("://"))
              artifacts.push({
                image: imageName(artifact.image),
                root: root === "." ? "" : root,
              });
          }
        } else if (
          data.apiVersion &&
          data.metadata?.name &&
          [
            "Deployment",
            "StatefulSet",
            "DaemonSet",
            "Service",
            "ConfigMap",
          ].includes(data.kind)
        ) {
          documents.push({
            data,
            file,
            ev,
            scope: path.posix.dirname(file.path),
          });
        }
      }
    } catch {
      warnings.push(`Could not parse Kubernetes candidates in ${file.path}.`);
    }
  }
  const preferred = documents.filter((d) =>
    policy.kubernetesManifestDirs?.includes(d.scope),
  );
  const selected = preferred.length ? preferred : documents;
  if (preferred.length && preferred.length !== documents.length)
    warnings.push(
      "Deployment scope selected from configured Kubernetes manifest directories; alternative deployments are excluded.",
    );
  const key = (d, name = d.data.metadata.name) =>
    `${d.scope}:${d.data.metadata.namespace || "default"}:${name}`;
  const workloads = selected.filter((d) =>
    ["Deployment", "StatefulSet", "DaemonSet"].includes(d.data.kind),
  );
  const ids = new Map();
  const services = new Map();
  const configs = new Map(
    selected.filter((d) => d.data.kind === "ConfigMap").map((d) => [key(d), d]),
  );
  for (const d of workloads) {
    const containers = d.data.spec?.template?.spec?.containers || [];
    const images = containers.map((c) => c.image).join(" ");
    const type = /(?:^|[-_])db(?:$|[-_])/.test(d.data.metadata.name)
      ? "database"
      : kind(d.data.metadata.name, images);
    const id = node(
      "kubernetes:" + key(d),
      d.data.metadata.name,
      type,
      d.ev(["metadata", "name"], `Kubernetes ${d.data.kind}`),
    );
    ids.set(d, id);
    for (const c of containers) {
      const matches = artifacts.filter((a) => a.image === imageName(c.image));
      const unique = [...new Set(matches.map((a) => a.root))];
      if (unique.length === 1) roots.push({ root: unique[0], id });
      else if (unique.length > 1)
        warnings.push(
          `Ambiguous build context for ${d.data.metadata.name}; source ownership is not inferred.`,
        );
    }
  }
  for (const d of selected.filter((d) => d.data.kind === "Service")) {
    const selector = d.data.spec?.selector;
    if (!selector || !Object.keys(selector).length) continue;
    const matches = workloads.filter(
      (w) =>
        w.scope === d.scope &&
        (w.data.metadata.namespace || "default") ===
          (d.data.metadata.namespace || "default") &&
        Object.entries(selector).every(
          ([k, v]) => w.data.spec?.template?.metadata?.labels?.[k] === v,
        ),
    );
    if (matches.length === 1) {
      services.set(key(d), ids.get(matches[0]));
      const w = matches[0];
      node(
        "kubernetes:" + key(w),
        w.data.metadata.name,
        kind(w.data.metadata.name),
        d.ev(
          ["metadata", "name"],
          "Kubernetes Service " + d.data.metadata.name,
        ),
      );
    } else
      warnings.push(
        `Service ${d.data.metadata.name} has ${matches.length} matching workloads; endpoint resolution requires review.`,
      );
  }
  for (const d of workloads) {
    const env = new Map();
    const containers = d.data.spec?.template?.spec?.containers || [];
    for (const [i, c] of containers.entries()) {
      for (const ref of c.envFrom || []) {
        const cfg = configs.get(key(d, ref.configMapRef?.name));
        for (const [name, value] of Object.entries(cfg?.data.data || {}))
          env.set((ref.prefix || "") + name, {
            value,
            ev: cfg.ev(["data", name], name),
            inherited: true,
          });
      }
      for (const [j, entry] of (c.env || []).entries()) {
        const ref = entry.valueFrom?.configMapKeyRef;
        const cfg = ref && configs.get(key(d, ref.name));
        env.set(entry.name, {
          value: entry.value ?? cfg?.data.data?.[ref?.key],
          ev: cfg
            ? cfg.ev(["data", ref.key], entry.name)
            : d.ev(
                ["spec", "template", "spec", "containers", i, "env", j],
                entry.name,
              ),
          inherited: false,
        });
      }
    }
    const sourceRoots = roots.filter((r) => r.id === ids.get(d));
    const sources = files.filter(
      (f) =>
        sourceRoots.some((r) => f.path.startsWith(r.root + "/")) &&
        !/(^|\/)(test|tests)(\/|$)/.test(f.path),
    );
    let sourceCalls = [];
    try {
      const parsedEndpoints = pythonEndpoints(
        sources,
        Object.fromEntries(
          [...env]
            .filter(
              ([name, v]) =>
                typeof v.value === "string" &&
                !/password|secret|token|credential|username|key/i.test(name),
            )
            .map(([k, v]) => [k, v.value]),
        ),
        policy,
      );
      sourceCalls = [
        ...parsedEndpoints.calls,
        ...declaredHttpCalls(
          sources,
          Object.fromEntries(
            [...env]
              .filter(
                ([name, v]) =>
                  typeof v.value === "string" &&
                  !/password|secret|token|credential|username|key/i.test(name),
              )
              .map(([k, v]) => [k, v.value]),
          ),
          policy.maxEdges,
        ),
      ];
    } catch {
      warnings.push(
        "Python endpoint resolution unavailable for a workload; service addresses remain partial.",
      );
    }
    const configuredHttpHosts = new Set(
      [...env]
        .filter(
          ([name, v]) =>
            typeof v.value === "string" &&
            (!v.inherited || sources.some((f) => f.content.includes(name))) &&
            !/password|secret|token|credential|username|key/i.test(name),
        )
        .flatMap(([, v]) => {
          try {
            const raw = v.value.includes("://") ? v.value : "http://" + v.value;
            const parsed = new URL(raw);
            return ["http:", "https:"].includes(parsed.protocol)
              ? [parsed.host]
              : [];
          } catch {
            return [];
          }
        }),
    );
    for (const [name, value] of env) {
      if (
        typeof value.value !== "string" ||
        /password|secret|token|credential|username|key/i.test(name)
      )
        continue;
      // Shared envFrom makes endpoints available, not necessarily consumed by this service.
      const use = sources.find((f) => f.content.includes(name));
      const springDatasource =
        name === "SPRING_DATASOURCE_URL" &&
        sources.some(
          (f) =>
            f.path.endsWith("pom.xml") && f.content.includes("spring-boot"),
        );
      if (value.inherited && !use && !springDatasource) continue;
      const raw = value.value.replace(/^jdbc:/, "");
      let host;
      try {
        host = new URL(raw.includes("://") ? raw : "http://" + raw).hostname;
      } catch {
        continue;
      }
      const parts = host.split(".");
      const namespace =
        parts.length > 1 ? parts[1] : d.data.metadata.namespace || "default";
      if (parts.length > 1 && !(parts.length === 2 || parts[2] === "svc"))
        continue;
      const to = services.get(`${d.scope}:${namespace}:${parts[0]}`);
      const endpoint = safeEndpoint(
        raw.includes("://") ? raw : "http://" + raw,
      );
      const calls = sourceCalls.filter(
        (c) =>
          safeEndpoint(c.url, c.method)?.address === endpoint?.address ||
          (c.url.startsWith("/") &&
            endpoint &&
            ["http", "https"].includes(endpoint.protocol) &&
            configuredHttpHosts.size === 1),
      );
      const resolved = calls.length
        ? calls.map((c) => ({
            ...safeEndpoint(
              c.url.startsWith("/")
                ? new URL(c.url, `${endpoint.protocol}://${endpoint.address}`)
                    .href
                : c.url,
              c.method,
            ),
            evidence: {
              path: c.path,
              line: c.line,
              detail: "HTTP call declaration",
            },
          }))
        : endpoint?.path !== "/"
          ? [endpoint]
          : [];
      edge(ids.get(d), to, "configured endpoint", value.ev, resolved);
      if (to && use)
        edge(
          ids.get(d),
          to,
          "configured endpoint",
          {
            path: use.path,
            line: use.content.slice(0, use.content.indexOf(name)).split("\n")
              .length,
            detail: `references ${name}; static evidence only`,
          },
          resolved,
        );
    }
  }
  if (workloads.length)
    warnings.push(
      "Kubernetes map: selectors resolve declared Services. Shared ConfigMap endpoints require a source reference; unsupported templates, Secrets, runtime overrides and external endpoints are not inferred.",
    );
  return workloads.length > 0;
}

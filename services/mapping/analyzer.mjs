import ts from "typescript";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseDocument } from "yaml";
import { validateFiles } from "./policy.mjs";
import { number } from "../shared/config.mjs";
const hash = (s) =>
  "n" + createHash("sha256").update(s).digest("hex").slice(0, 16);
function textLabel(value, max) {
  return (
    String(value)
      .replace(/[^\p{L}\p{N} ._/@:+()-]/gu, " ")
      .replace(/\s+/g, " ")
      .slice(0, max) || "Unnamed"
  );
}
export function toMermaid(graph, policy, suggestions = []) {
  const direction = ["LR", "TD", "TB", "RL", "BT"].includes(policy.direction)
    ? policy.direction
    : "LR";
  const lines = [`flowchart ${direction}`];
  for (const node of graph.nodes)
    lines.push(
      `  ${node.id}["${textLabel(node.label, policy.labelMaxChars)} (${node.kind})"]`,
    );
  for (const edge of graph.edges)
    lines.push(
      `  ${edge.from} -->|"${textLabel(edge.relation, policy.labelMaxChars)}"| ${edge.to}`,
    );
  for (const edge of suggestions)
    lines.push(`  ${edge.from} -.->|"AI suggestion"| ${edge.to}`);
  for (const kind of [
    "frontend",
    "gateway",
    "service",
    "database",
    "cache",
    "queue",
    "package",
    "external",
  ]) {
    const ids = graph.nodes.filter((n) => n.kind === kind).map((n) => n.id);
    if (ids.length) lines.push(`  class ${ids.join(",")} ${kind}`);
  }
  lines.push(
    "  classDef frontend fill:#e8efff,stroke:#647dae,color:#24354e",
    "  classDef gateway fill:#e1f1ea,stroke:#478972,color:#214537",
    "  classDef service fill:#edf4f1,stroke:#6b9986,color:#244437",
    "  classDef database fill:#fff0df,stroke:#b0804b,color:#5f4023",
    "  classDef cache fill:#f8e9ec,stroke:#b77184,color:#58313c",
    "  classDef queue fill:#f2eafa,stroke:#9174ac,color:#49365d",
    "  classDef package fill:#f1f3f6,stroke:#8a96a5,color:#354351",
    "  classDef external fill:#f7f7f7,stroke:#999,color:#444",
  );
  return lines.join("\n");
}
export function analyzeRepository(input, policy) {
  const checked = validateFiles(input, policy);
  const files = checked.files.sort((a, b) => a.path.localeCompare(b.path));
  const byPath = new Map(files.map((f) => [f.path, f]));
  const nodes = new Map();
  const edges = new Map();
  const warnings = [];
  const roots = [];
  const manifests = [];
  if (checked.excluded)
    warnings.push(`${checked.excluded} excluded files were not analyzed.`);
  const evidence = (file, key) => ({
    path: file.path,
    line: Math.max(
      1,
      file.content.slice(0, Math.max(0, file.content.indexOf(key))).split("\n")
        .length,
    ),
    detail: key.includes("://") ? "configured route" : key,
  });
  function node(key, label, kind, ev) {
    const id = hash(key);
    if (!nodes.has(id)) {
      if (nodes.size >= policy.maxNodes) {
        if (!warnings.includes("Node limit reached; this map is partial."))
          warnings.push("Node limit reached; this map is partial.");
        return null;
      }
      nodes.set(id, {
        id,
        label: textLabel(label, policy.labelMaxChars),
        kind,
        evidence: [ev],
      });
    }
    return id;
  }
  function edge(from, to, relation, ev) {
    if (!from || !to || from === to) return;
    const key = [from, to, relation].join(":");
    if (edges.has(key)) {
      const e = edges.get(key);
      if (!e.evidence.some((x) => x.path === ev.path && x.line === ev.line))
        e.evidence.push(ev);
      return;
    }
    if (edges.size >= policy.maxEdges) {
      if (!warnings.includes("Edge limit reached; this map is partial."))
        warnings.push("Edge limit reached; this map is partial.");
      return;
    }
    edges.set(key, {
      from,
      to,
      relation,
      confidence: "observed",
      evidence: [ev],
    });
  }
  function yaml(file) {
    const doc = parseDocument(file.content, { uniqueKeys: true });
    if (doc.errors.length) throw new Error("Invalid YAML");
    return doc.toJS({
      maxAliasCount: number("validation", "yaml_max_aliases"),
    });
  }
  function kind(name, image = "") {
    const val = (name + " " + image).toLowerCase();
    for (const [k, list] of [
      ["database", policy.databasePatterns],
      ["cache", policy.cachePatterns],
      ["queue", policy.queuePatterns],
      ["gateway", policy.gatewayPatterns],
    ])
      if (list.some((p) => val.includes(p))) return k;
    return /front|web|client|ui/.test(name.toLowerCase())
      ? "frontend"
      : "service";
  }
  // Compose provides declared topology, not proof of runtime traffic.
  for (const file of files.filter((f) =>
    /(^|\/)(docker-)?compose(?:[.-][\w-]+)?\.ya?ml$/i.test(f.path),
  )) {
    try {
      const data = yaml(file);
      if (!data?.services || typeof data.services !== "object") continue;
      const composeDocument = parseDocument(file.content);
      const serviceEvidence = (name, key) => {
        const yamlNode = composeDocument.getIn(["services", name, key], true);
        const offset = yamlNode?.range?.[0];
        return offset === undefined
          ? evidence(file, key)
          : {
              path: file.path,
              line: file.content.slice(0, offset).split("\n").length,
              detail: key,
            };
      };
      const ids = new Map();
      const dir = path.posix.dirname(file.path);
      for (const [name, svc] of Object.entries(data.services)) {
        if (!svc || typeof svc !== "object") continue;
        const id = node(
          "compose:" + file.path + ":" + name,
          name,
          kind(name, typeof svc.image === "string" ? svc.image : ""),
          evidence(file, name + ":"),
        );
        ids.set(name, id);
        const build =
          typeof svc.build === "string" ? svc.build : svc.build?.context;
        if (
          typeof build === "string" &&
          !build.includes("://") &&
          !build.includes("${")
        ) {
          const context = path.posix.normalize(path.posix.join(dir, build));
          const command = Array.isArray(svc.command)
            ? svc.command
            : typeof svc.command === "string"
              ? svc.command.split(/\s+/)
              : [];
          const entry = command.find(
            (x) =>
              typeof x === "string" &&
              policy.sourceExtensions.some((ext) => x.endsWith(ext)),
          );
          const root = entry
            ? path.posix.dirname(path.posix.join(context, entry))
            : context;
          if (!root.startsWith(".."))
            roots.push({ root: root === "." ? "" : root, id });
        }
      }
      for (const [name, svc] of Object.entries(data.services)) {
        if (!svc || typeof svc !== "object") continue;
        const from = ids.get(name);
        const deps = Array.isArray(svc.depends_on)
          ? svc.depends_on
          : Object.keys(svc.depends_on || {});
        for (const dep of deps)
          edge(
            from,
            ids.get(dep),
            "startup dependency",
            serviceEvidence(name, "depends_on"),
          );
        const env = Array.isArray(svc.environment)
          ? Object.fromEntries(
              svc.environment
                .filter((x) => typeof x === "string" && x.includes("="))
                .map((x) => [
                  x.slice(0, x.indexOf("=")),
                  x.slice(x.indexOf("=") + 1),
                ]),
            )
          : svc.environment || {};
        for (const [key, val] of Object.entries(env)) {
          if (typeof val !== "string") continue;
          const urls = val.match(/[a-z][a-z0-9+.-]*:\/\/[^\s"']+/gi) || [];
          for (const url of urls) {
            try {
              const host = new URL(url.replace(/\$\{[^}]+\}/g, "configured"))
                .hostname;
              edge(
                from,
                ids.get(host),
                "configured endpoint",
                evidence(file, key),
              );
            } catch {}
          }
        }
        for (const volume of svc.volumes || []) {
          const src =
            typeof volume === "string" ? volume.split(":")[0] : volume?.source;
          if (typeof src !== "string") continue;
          const mounted = byPath.get(
            path.posix.normalize(path.posix.join(dir, src)),
          );
          if (!mounted || !/.ya?ml$/.test(mounted.path)) continue;
          try {
            const routes = yaml(mounted);
            for (const upstream of Object.values(
              routes?.http?.services || {},
            )) {
              for (const server of upstream?.loadBalancer?.servers || []) {
                if (typeof server?.url === "string") {
                  try {
                    edge(
                      from,
                      ids.get(new URL(server.url).hostname),
                      "routes to",
                      evidence(mounted, server.url),
                    );
                  } catch {}
                }
              }
            }
          } catch {}
        }
      }
    } catch {
      warnings.push(
        `Could not parse ${file.path}; no topology was extracted from it.`,
      );
    }
  }
  // Package manifests identify app boundaries and explicit workspace dependencies.
  for (const file of files.filter(
    (f) => path.posix.basename(f.path) === "package.json",
  )) {
    try {
      const pkg = JSON.parse(file.content);
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      const names = Object.keys(deps);
      const root =
        path.posix.dirname(file.path) === "."
          ? ""
          : path.posix.dirname(file.path);
      const existing = roots.find((r) => r.root === root);
      let type = policy.frontendDependencies.some((x) => names.includes(x))
        ? "frontend"
        : policy.backendDependencies.some((x) => names.includes(x))
          ? "service"
          : "package";
      const id =
        existing?.id ||
        node(
          "package:" + file.path,
          pkg.name || root || "Application",
          type,
          evidence(file, '"name"'),
        );
      if (!existing) roots.push({ root, id });
      manifests.push({
        name: typeof pkg.name === "string" ? pkg.name : null,
        id,
        deps: names,
        file,
      });
    } catch {
      warnings.push(`Could not parse ${file.path}.`);
    }
  }
  for (const file of files.filter(
    (f) =>
      policy.manifestNames.includes(
        path.posix.basename(f.path).toLowerCase(),
      ) && path.posix.basename(f.path) !== "package.json",
  )) {
    const root =
      path.posix.dirname(file.path) === "."
        ? ""
        : path.posix.dirname(file.path);
    if (!roots.some((r) => r.root === root)) {
      const label = root || path.posix.basename(file.path);
      const id = node(
        "manifest:" + file.path,
        label,
        "service",
        evidence(file, path.posix.basename(file.path)),
      );
      roots.push({ root, id });
    }
  }
  for (const manifest of manifests) {
    for (const dep of manifest.deps) {
      const internal = manifests.find((m) => m.name === dep);
      if (internal)
        edge(
          manifest.id,
          internal.id,
          "package dependency",
          evidence(manifest.file, '"' + dep + '"'),
        );
      else if (policy.storageDependencies.includes(dep)) {
        const depId = node(
          "dependency:" + dep,
          dep + " client",
          "package",
          evidence(manifest.file, '"' + dep + '"'),
        );
        edge(
          manifest.id,
          depId,
          "declares client library",
          evidence(manifest.file, '"' + dep + '"'),
        );
      }
    }
  }
  roots.sort((a, b) => b.root.length - a.root.length);
  const owner = (file) =>
    roots.find((r) => r.id && (!r.root || file.startsWith(r.root + "/")))?.id;
  for (const file of files.filter((f) =>
    policy.sourceExtensions.some((ext) => f.path.endsWith(ext)),
  )) {
    let from = owner(file.path);
    if (!from) {
      const root = file.path.includes("/") ? file.path.split("/")[0] : "";
      from = node(
        "source:" + root,
        root || "Source files",
        "service",
        evidence(file, "source"),
      );
      roots.push({ root, id: from });
      roots.sort((a, b) => b.root.length - a.root.length);
    }
    // Use the TypeScript parser so commented-out imports and quoted examples do not become edges.
    if (
      ![".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"].includes(
        path.posix.extname(file.path),
      )
    )
      continue;
    const ast = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
    );
    function visit(syntax) {
      let literal;
      if (ts.isImportDeclaration(syntax) || ts.isExportDeclaration(syntax))
        literal = syntax.moduleSpecifier;
      else if (
        ts.isCallExpression(syntax) &&
        (syntax.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(syntax.expression) &&
            syntax.expression.text === "require"))
      )
        literal = syntax.arguments[0];
      if (
        literal &&
        ts.isStringLiteral(literal) &&
        literal.text.startsWith(".")
      ) {
        const spec = literal.text;
        const resolved = path.posix.normalize(
          path.posix.join(path.posix.dirname(file.path), spec),
        );
        const candidates = [
          resolved,
          ...policy.sourceExtensions.map((e) => resolved + e),
          ...policy.sourceExtensions.map((e) => resolved + "/index" + e),
          ...policy.sourceExtensions.map(
            (e) => resolved.replace(/\.[^.\/]+$/, "") + e,
          ),
        ];
        const target = candidates.find((p) => byPath.has(p));
        if (target)
          edge(from, owner(target), "source import", {
            path: file.path,
            line:
              ast.getLineAndCharacterOfPosition(literal.getStart(ast)).line + 1,
            detail: spec,
          });
      }
      ts.forEachChild(syntax, visit);
    }
    visit(ast);
  }
  if (!nodes.size)
    warnings.push("No supported application boundaries were detected.");
  warnings.push(
    "Static map only: startup dependencies, configured endpoints, and source imports do not prove runtime calls. Dynamic configuration and unsupported language imports may be missing.",
  );
  const graph = { nodes: [...nodes.values()], edges: [...edges.values()] };
  return {
    ...graph,
    mermaid: toMermaid(graph, policy),
    warnings,
    stats: {
      files: files.length,
      bytes: checked.bytes,
      nodes: nodes.size,
      edges: edges.size,
    },
    analyzerVersion: "1",
    generatedAt: new Date().toISOString(),
  };
}
export function validateEnrichment(text, graph, env = process.env) {
  const trimmed = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
  let data;
  try {
    data = JSON.parse(trimmed);
  } catch {
    throw new Error(
      "AI returned invalid JSON. The evidence-based map is unchanged.",
    );
  }
  if (typeof data.summary !== "string" || !Array.isArray(data.suggestions))
    throw new Error("AI returned an unsupported enrichment format.");
  if (
    data.summary.length >
      number("repository", "repository_ai_summary_max_chars", env) ||
    data.suggestions.length >
      number("repository", "repository_ai_max_suggestions", env)
  )
    throw new Error("AI enrichment exceeds configured limits.");
  const ids = new Set(graph.nodes.map((n) => n.id));
  const seen = new Set();
  const observed = new Set(graph.edges.map((e) => e.from + ":" + e.to));
  const suggestions = data.suggestions.map((e) => {
    if (
      !e ||
      !ids.has(e.from) ||
      !ids.has(e.to) ||
      e.from === e.to ||
      typeof e.reason !== "string" ||
      !e.reason.trim() ||
      e.reason.length >
        number("repository", "repository_ai_reason_max_chars", env)
    )
      throw new Error(
        "AI suggested an invalid connection. The evidence-based map is unchanged.",
      );
    const key = e.from + ":" + e.to;
    if (observed.has(key))
      throw new Error(
        "AI repeated an observed connection. The evidence-based map is unchanged.",
      );
    if (seen.has(key)) throw new Error("AI suggested duplicate connections.");
    seen.add(key);
    return {
      from: e.from,
      to: e.to,
      reason: e.reason,
      confidence: "ai-inferred",
    };
  });
  return {
    summary: data.summary,
    suggestions,
    generatedAt: new Date().toISOString(),
  };
}

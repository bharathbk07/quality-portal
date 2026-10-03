import { sourceStrings } from "./database-access.mjs";
// Conservative transport call resolution. Unknown argument expressions become path parameters.
export function declaredHttpCalls(files, environment, limit) {
  const calls = [];
  for (const file of files.filter((f) =>
    /\.(java|kt|cs|go|[cm]?[jt]sx?)$/.test(f.path),
  )) {
    const strings = sourceStrings(file);
    const values = new Map();
    const cleaned = file.content.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) =>
      " ".repeat(m.length),
    );
    for (const match of cleaned.matchAll(
      /\b([\w]+)\s*=\s*(?:System\.(?:getenv|getProperty)|Environment\.GetEnvironmentVariable|os\.Getenv)\(\s*"([\w.-]+)"\s*\)/g,
    )) {
      if (environment[match[2]]) values.set(match[1], environment[match[2]]);
    }
    for (const match of cleaned.matchAll(
      /\b([\w]+)\s*=\s*process\.env\.([\w]+)/g,
    )) {
      if (environment[match[2]]) values.set(match[1], environment[match[2]]);
    }
    // Binding strings uses token positions from the lexer; comments are excluded.
    for (const literal of strings) {
      const before = file.content.slice(
        Math.max(0, literal.offset - 100),
        literal.offset,
      );
      const binding = /\b([\w]+)\s*=\s*$/.exec(before);
      if (binding) values.set(binding[1], literal.text);
    }
    const resolve = (expression) => {
      const parts = expression.split(/\s*\+\s*/);
      return parts
        .map((part) => {
          const text = part.trim();
          if (/^"[\s\S]*"$/.test(text)) return text.slice(1, -1);
          if (/^`[\s\S]*`$/.test(text))
            return text
              .slice(1, -1)
              .replace(
                /\$\{(?:process\.env\.)?(\w+)\}/g,
                (_, name) =>
                  environment[name] || values.get(name) || `{${name}}`,
              );
          return (
            values.get(text) ||
            `{${text.replace(/[^\w]/g, "").slice(0, 40) || "parameter"}}`
          );
        })
        .join("");
    };
    // Locate calls outside comments AND quoted strings.
    let callSource = cleaned;
    for (const literal of [...strings].reverse()) {
      const start = literal.offset;
      // Only mask actual source literals for call detection (not their contents/arguments).
      const end =
        file.content[start] === "`"
          ? file.content.indexOf("`", start + 1) + 1
          : start + literal.text.length + 2;
      callSource =
        callSource.slice(0, start) +
        " ".repeat(Math.max(0, end - start)) +
        callSource.slice(end);
    }
    const pattern =
      /\b(?:[\w.]+\.)?(getForObject|getForEntity|postForObject|postForEntity|GetAsync|PostAsync|Get|Post|fetch|axios\.get|axios\.post)\s*\(/g;
    for (const m of callSource.matchAll(pattern)) {
      if (calls.length >= limit) break;
      const start = m.index + m[0].length;
      // First argument only, excluding commas within quoted literals.
      const argument = /^\s*((?:"(?:\\.|[^"\\])*"|`[^`]*`|[^,;\n)])+)/.exec(
        file.content.slice(start),
      );
      if (!argument) continue;
      const url = resolve(argument[1]);
      if (
        !/^https?:\/\//.test(url) ||
        /\{[^}]*\}/.test(url.split("/").slice(0, 3).join("/"))
      )
        continue;
      let method = /post/i.test(m[1]) ? "POST" : "GET";
      if (m[1] === "fetch") {
        const options = file.content.slice(
          start + argument[0].length,
          start + argument[0].length + 300,
        );
        const explicit =
          /method\s*:\s*["'](GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)["']/i.exec(
            options,
          );
        method =
          explicit?.[1]?.toUpperCase() ||
          (/^\s*\)/.test(options) ? "GET" : "HTTP");
      }
      calls.push({
        url,
        method,
        path: file.path,
        line: file.content.slice(0, m.index).split("\n").length,
      });
    }
  }
  return calls;
}
export function collectRequestCandidates(graph, files, roots, limit) {
  let count = 0;
  for (const file of files.filter(
    (f) =>
      /\.(java|kt|cs|go|py|[cm]?[jt]sx?)$/.test(f.path) &&
      !/(^|\/)(tests?|fixtures?)(\/|$)/i.test(f.path),
  )) {
    const from = [...roots]
      .sort((a, b) => b.root.length - a.root.length)
      .find((r) => r.id && (!r.root || file.path.startsWith(r.root + "/")))?.id;
    const node = graph.nodes.find((n) => n.id === from);
    if (!node) continue;
    for (const s of sourceStrings(file)) {
      let path = s.text;
      if (/^https?:\/\//.test(path)) {
        try {
          path = new URL(path).pathname;
        } catch {
          continue;
        }
      }
      if (
        !/^\/[\w/{}<>:.-]*$/.test(path) ||
        path.length > 300 ||
        count >= limit
      )
        continue;
      const candidate = {
        path: path.replace(/<(?:\w+:)?(\w+)>/g, "{$1}"),
        evidence: {
          path: file.path,
          line: s.line || file.content.slice(0, s.offset).split("\n").length,
          detail:
            "Literal path declaration; direction and method require call-site evidence",
        },
      };
      node.requestPathCandidates ||= [];
      node.requestPathCandidates.push(candidate);
      count++;
    }
  }
}
export function validateRequestResolutions(input, graph, limit, reasonMax) {
  if (input === undefined) return [];
  if (!Array.isArray(input) || input.length > limit)
    throw new Error("AI request resolution limit exceeded");
  const seen = new Set();
  return input.map((r) => {
    const edge = graph.edges.find(
      (e) =>
        e.from === r?.from &&
        e.to === r?.to &&
        !(e.endpoints || []).length &&
        e.relation === "configured endpoint",
    );
    const targets = graph.nodes.filter(
      (n) => n.id === r?.from || n.id === r?.to,
    );
    const candidates = targets.flatMap((n) => n.requestPathCandidates || []);
    const candidate = candidates.find(
      (c) =>
        c.path === r?.path &&
        (r?.evidence || []).some(
          (e) => e.path === c.evidence.path && e.line === c.evidence.line,
        ),
    );
    const key = r?.from + ":" + r?.to;
    if (
      !edge ||
      !candidate ||
      targets.some((n) => n.kind === "database") ||
      seen.has(key) ||
      ![
        "GET",
        "POST",
        "PUT",
        "PATCH",
        "DELETE",
        "HEAD",
        "OPTIONS",
        "HTTP",
      ].includes(r.method) ||
      typeof r.reason !== "string" ||
      !r.reason.trim() ||
      r.reason.length > reasonMax ||
      !Array.isArray(r.evidence) ||
      r.evidence.length > 4
    )
      throw new Error(
        "AI request proposal must reference an unresolved service edge and an exact supplied path declaration",
      );
    if (
      !r.evidence.every(
        (e) =>
          candidates.some(
            (c) => c.evidence.path === e.path && c.evidence.line === e.line,
          ) ||
          (edge.evidence || []).some(
            (c) => c.path === e.path && c.line === e.line,
          ),
      )
    )
      throw new Error("AI request proposal cited unknown evidence");
    seen.add(key);
    return {
      from: r.from,
      to: r.to,
      method: r.method,
      path: r.path,
      reason: r.reason,
      evidence: r.evidence.map(({ path, line }) => ({ path, line })),
      confidence: "ai-inferred",
    };
  });
}
export function withRequestResolutions(graph, resolutions = []) {
  return {
    ...graph,
    edges: graph.edges.map((edge) => {
      const proposal = resolutions.find(
        (r) => r.from === edge.from && r.to === edge.to,
      );
      return proposal && !(edge.endpoints || []).length
        ? { ...edge, requestHypothesis: proposal, confidence: "ai-inferred" }
        : edge;
    }),
  };
}

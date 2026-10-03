import path from "node:path";
// Literal declarations only; no compiler, preprocessor, JCL procedure expansion or execution.
export function legacyTopology(files, roots, node, edge) {
  const programs = new Map();
  const entries = [];
  for (const f of files) {
    if (!/\.(cbl|cob|pli|pl1|jcl)$/i.test(f.path)) continue;
    const lines = f.content
      .split("\n")
      .map((l) =>
        /^.{6}[*\/]/.test(l) || /^\s*(?:\*>|\/\/\*)/.test(l) ? "" : l,
      );
    const text = lines.join("\n");
    const match =
      /\bPROGRAM-ID\s*\.\s*([\w-]+)/i.exec(text) ||
      /\/\/([\w-]+)\s+JOB\b/i.exec(text) ||
      /\b([\w-]+)\s*:\s*PROC(?:EDURE)?\b/i.exec(text);
    const label = match?.[1] || path.posix.basename(f.path);
    const id = node("legacy:" + f.path, label, "service", {
      path: f.path,
      line: match ? text.slice(0, match.index).split("\n").length : 1,
      detail: match ? "Declared legacy program/job" : "Legacy source boundary",
    });
    programs.set(label.toUpperCase(), id);
    entries.push({ f, text, id });
    roots.push({
      root:
        path.posix.dirname(f.path) === "." ? "" : path.posix.dirname(f.path),
      id,
    });
  }
  for (const { f, text, id } of entries) {
    for (const m of text.matchAll(
      /\bCALL\s+["']([\w-]+)["']|\bEXEC\s+PGM\s*=\s*([\w-]+)/gi,
    )) {
      const label = m[1] || m[2];
      const ev = {
        path: f.path,
        line: text.slice(0, m.index).split("\n").length,
        detail: "Literal program reference: " + label,
      };
      const target =
        programs.get(label.toUpperCase()) ||
        node(
          "legacy-reference:" + label.toUpperCase(),
          label + " (unresolved program)",
          "external",
          ev,
        );
      edge(id, target, "declared program invocation", ev);
    }
  }
}

import path from "node:path";
// Conservative literal internal imports. Dynamic/reflection imports stay unknown.
export function languageImports(files, roots, edge) {
  const owner = (p) =>
    roots.find((r) => r.id && (!r.root || p.startsWith(r.root + "/")))?.id;
  const packages = new Map();
  for (const f of files) {
    const m =
      /^\s*package\s+([\w.]+)\s*;/m.exec(f.content) ||
      /^\s*namespace\s+([\w.]+)\s*[;{]/m.exec(f.content);
    if (m)
      packages.set(
        m[1] + "." + path.posix.basename(f.path).replace(/\.[^.]+$/, ""),
        f.path,
      );
  }
  const byPath = new Map(files.map((f) => [f.path, f]));
  for (const f of files) {
    const from = owner(f.path);
    if (!from) continue;
    let imports = [];
    if (f.path.endsWith(".py"))
      imports = [
        ...f.content.matchAll(
          /^\s*(?:from\s+([\w.]+)\s+import|import\s+([\w.]+))/gm,
        ),
      ].map((m) => ({ spec: m[1] || m[2], offset: m.index }));
    else if (/\.(java|kt|cs)$/.test(f.path))
      imports = [
        ...f.content.matchAll(
          /^\s*(?:import\s+(?:static\s+)?|using\s+)([\w.]+)(?:\.\*)?\s*;?/gm,
        ),
      ].map((m) => ({ spec: m[1], offset: m.index }));
    else if (f.path.endsWith(".go")) {
      for (const block of f.content.matchAll(/^\s*import\s+(?:\([^)]*\)|(?:[\w._]+\s+)?"[^"\n]+")/gm)) {
        for (const item of block[0].matchAll(/(?:^|\n|import\s+)\s*(?:[\w._]+\s+)?"([\w./-]+)"/g)) {
          imports.push({ spec: item[1], offset: block.index + item.index });
        }
      }
    }
    for (const item of imports) {
      let target = packages.get(item.spec);
      if (!target && f.path.endsWith(".py")) {
        const p = item.spec.replaceAll(".", "/");
        const candidates = [
          p + ".py",
          p + "/__init__.py",
          ...roots.flatMap((r) => [
            r.root + "/" + p + ".py",
            r.root + "/" + p + "/__init__.py",
          ]),
        ].filter((p) => byPath.has(p));
        if (new Set(candidates).size === 1) target = candidates[0];
      }
      if (!target && f.path.endsWith(".go")) {
        const mod = files.find(
          (x) =>
            path.posix.basename(x.path) === "go.mod" &&
            x.content.includes(
              "module " + item.spec.split("/").slice(0, 3).join("/"),
            ),
        );
        const moduleName = mod && /^module\s+(\S+)/m.exec(mod.content)?.[1];
        if (moduleName && item.spec.startsWith(moduleName + "/")) {
          const prefix =
            path.posix.join(
              path.posix.dirname(mod.path),
              item.spec.slice(moduleName.length + 1),
            ) + "/";
          target = files.find(
            (x) => x.path.startsWith(prefix) && x.path.endsWith(".go"),
          )?.path;
        }
      }
      if (target)
        edge(from, owner(target), "source import", {
          path: f.path,
          line: f.content.slice(0, item.offset).split("\n").length,
          detail: item.spec,
        });
    }
  }
}

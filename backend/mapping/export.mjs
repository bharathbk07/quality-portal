const xml = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[c],
  );
export function exportSvg(projection) {
  const byId = new Map(projection.nodes.map((n) => [n.id, n]));
  const absolute = (n) => {
    let x = n.position.x,
      y = n.position.y;
    let parent = n.parentId;
    const seen = new Set();
    while (parent && !seen.has(parent)) {
      seen.add(parent);
      const p = byId.get(parent);
      if (!p) break;
      x += p.position.x;
      y += p.position.y;
      parent = p.parentId;
    }
    return { x, y };
  };
  const rects = projection.nodes.map((n) => ({ ...n, absolute: absolute(n) }));
  const minX = Math.min(0, ...rects.map((n) => n.absolute.x)),
    minY = Math.min(0, ...rects.map((n) => n.absolute.y));
  const width =
    Math.max(
      1,
      ...rects.map((n) => n.absolute.x + Number(n.style.width || 240)),
    ) -
    minX +
    80;
  const height =
    Math.max(
      1,
      ...rects.map((n) => n.absolute.y + Number(n.style.height || 110)),
    ) -
    minY +
    80;
  const lines = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX - 40} ${minY - 40} ${width} ${height}" role="img"><title>Saved architecture view: ${xml(projection.view)}</title><defs><marker id="arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#74829b"/></marker></defs><rect x="${minX - 40}" y="${minY - 40}" width="${width}" height="${height}" fill="#fff"/>`,
  ];
  for (const n of rects.filter((n) => n.type === "group"))
    lines.push(
      `<rect x="${n.absolute.x}" y="${n.absolute.y}" width="${n.style.width}" height="${n.style.height}" rx="16" fill="#f4f6fc" stroke="#a7b5d1" stroke-dasharray="6 4"/><text x="${n.absolute.x + 16}" y="${n.absolute.y + 25}" font-family="Arial" font-size="15" fill="#43516b">${xml(n.data.label)}</text>`,
    );
  for (const e of projection.edges) {
    const a = rects.find((n) => n.id === e.source),
      b = rects.find((n) => n.id === e.target);
    if (!a || !b) continue;
    const x1 = a.absolute.x + Number(a.style.width),
      y1 = a.absolute.y + Number(a.style.height) / 2,
      x2 = b.absolute.x,
      y2 = b.absolute.y + Number(b.style.height) / 2,
      mid = (x1 + x2) / 2;
    lines.push(
      `<path d="M ${x1} ${y1} H ${mid} V ${y2} H ${x2}" stroke="#74829b" fill="none" marker-end="url(#arrow)"/><text x="${mid + 4}" y="${(y1 + y2) / 2 - 5}" font-family="Arial" font-size="10" fill="#607089">${xml(e.label)}</text>`,
    );
  }
  for (const n of rects.filter((n) => n.type !== "group")) {
    lines.push(
      `<rect x="${n.absolute.x}" y="${n.absolute.y}" width="${n.style.width}" height="${n.style.height}" rx="12" fill="${xml(n.data.color || "#edf4f1")}" stroke="#a6b2c5"/><text x="${n.absolute.x + 16}" y="${n.absolute.y + 28}" font-family="Arial" font-size="16" fill="#233047">${xml(n.data.label)}</text><text x="${n.absolute.x + 16}" y="${n.absolute.y + 54}" font-family="Arial" font-size="11" fill="#506079">${xml(n.data.subtitle?.slice(0, 38))}</text><text x="${n.absolute.x + 16}" y="${n.absolute.y + 82}" font-family="Arial" font-size="11" fill="#506079">${xml(n.data.kind)}${n.data.hasCache ? " · cache declaration" : ""}</text>`,
    );
  }
  return lines.join("\n") + "</svg>";
}
export function compareRevisions(graph, from, to) {
  const changes = [];
  for (const node of graph.nodes) {
    const a = from?.annotations?.[node.id] || {},
      b = to?.annotations?.[node.id] || {};
    for (const field of new Set([...Object.keys(a), ...Object.keys(b)]))
      if (JSON.stringify(a[field]) !== JSON.stringify(b[field]))
        changes.push({
          nodeId: node.id,
          label: node.label,
          field,
          before: a[field] ?? null,
          after: b[field] ?? null,
        });
  }
  return {
    from: from?.label || "Repository base",
    to: to?.label || "Repository base",
    changes,
    scenario: { before: from?.scenario || null, after: to?.scenario || null },
    layoutChanged:
      JSON.stringify(from?.positions || {}) !==
      JSON.stringify(to?.positions || {}),
    basis:
      "Snapshots share the same imported repository graph. This compares owner annotations, presentation and proposed scenarios; it does not claim deployed architecture changes.",
  };
}

import { number } from "../shared/config.mjs";
export function validateGrouping(content, graph, env = process.env) {
  let result;
  try {
    result = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw new Error("Invalid grouping JSON");
  }
  if (
    typeof result.summary !== "string" ||
    result.summary.length >
      number("repository", "repository_ai_summary_max_chars", env) ||
    !Array.isArray(result.groups) ||
    result.groups.length > number("map_studio", "max_groups", env)
  )
    throw new Error("Invalid grouping schema");
  const ids = new Set(graph.nodes.map((n) => n.id)),
    used = new Set(),
    names = new Set();
  const annotations = {};
  for (const group of result.groups) {
    if (
      typeof group.name !== "string" ||
      !group.name.trim() ||
      group.name.length > 100 ||
      /[<>\x00-\x1f]/.test(group.name) ||
      names.has(group.name) ||
      !Array.isArray(group.nodeIds) ||
      !group.nodeIds.length ||
      !Array.isArray(group.evidence) ||
      !group.evidence.length ||
      group.evidence.length > number("repository", "repository_max_edges", env)
    )
      throw new Error("Invalid boundary proposal");
    names.add(group.name);
    for (const id of group.nodeIds) {
      if (!ids.has(id) || used.has(id))
        throw new Error("Unknown or duplicate boundary member");
      used.add(id);
      annotations[id] = { group: group.name };
    }
    const evidence = graph.nodes
      .filter((n) => group.nodeIds.includes(n.id))
      .flatMap((n) => n.evidence);
    if (
      !group.evidence.every((e) =>
        evidence.some((v) => v.path === e?.path && v.line === e?.line),
      )
    )
      throw new Error("Unknown boundary evidence");
  }
  return {
    summary: result.summary,
    groups: result.groups.map((g) => ({
      name: g.name,
      nodeIds: g.nodeIds,
      evidence: g.evidence.map((e) => ({ path: e.path, line: e.line })),
    })),
    annotations,
    classification: "Proposed boundaries; review and save before sharing",
  };
}

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { number, value } from "../shared/config.mjs";
export function safeEndpoint(raw, method = "HTTP") {
  try {
    const u = new URL(raw);
    const pathname =
      decodeURI(u.pathname)
        .replace(/[^\p{L}\p{N}/{}._:<>-]/gu, "")
        .slice(0, 300) || "/";
    const protocol = u.protocol.replace(":", "");
    return {
      address: u.host,
      path: pathname,
      method: /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|HTTP)$/.test(method)
        ? method
        : "HTTP",
      protocol,
    };
  } catch {
    return null;
  }
}
export function endpointLabel(edge) {
  if (edge.requestHypothesis)
    return `AI proposal: ${edge.requestHypothesis.method} ${edge.requestHypothesis.path}`;
  if (edge.databaseCalls?.length)
    return (
      [
        ...new Set(
          edge.databaseCalls.flatMap((c) =>
            c.objects.map((o) => [o.schema, o.table].filter(Boolean).join(".")),
          ),
        ),
      ]
        .slice(0, 4)
        .join(", ") || "SQL templates"
    );
  if (edge.endpoints?.length)
    return [
      ...new Set(
        edge.endpoints.map((e) =>
          e.protocol && !["http", "https"].includes(e.protocol)
            ? `${e.protocol} ${e.path}`
            : `${e.method} ${e.path}`,
        ),
      ),
    ].join(" · ");
  return edge.relation === "configured endpoint"
    ? "Request path unresolved"
    : edge.relation;
}
export function pythonEndpoints(files, env, policy) {
  const python = files.filter((f) => f.path.endsWith(".py"));
  if (!python.length) return { calls: [], routes: [] };
  return JSON.parse(
    execFileSync(
      value("repository", "repository_python_executable"),
      [fileURLToPath(new URL("./python_endpoints.py", import.meta.url))],
      {
        input: JSON.stringify({ files: python, env, limit: policy.maxEdges }),
        encoding: "utf8",
        timeout: number("repository", "repository_parser_timeout_ms"),
        maxBuffer: policy.maxTotalBytes,
      },
    ),
  );
}

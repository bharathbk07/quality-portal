import ts from "typescript";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { number, value } from "../shared/config.mjs";
// Read source as data. SQL is displayed as a redacted template and never executed.
export function sourceStrings(file) {
  if (file.path.endsWith(".py")) {
    return JSON.parse(
      execFileSync(
        value("repository", "repository_python_executable"),
        [fileURLToPath(new URL("./source_literals.py", import.meta.url))],
        {
          input: JSON.stringify(file),
          encoding: "utf8",
          timeout: number("repository", "repository_parser_timeout_ms"),
          maxBuffer: number("repository", "repository_max_total_bytes"),
        },
      ),
    );
  }
  if (/\.[cm]?[jt]sx?$/.test(file.path)) {
    const ast = ts.createSourceFile(
      file.path,
      file.content,
      ts.ScriptTarget.Latest,
      true,
    );
    const found = [];
    const visit = (n) => {
      if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
        found.push({ text: n.text, offset: n.getStart(ast) });
      else if (ts.isTemplateExpression(n))
        found.push({
          text:
            n.head.text +
            n.templateSpans.map((s) => "{parameter}" + s.literal.text).join(""),
          offset: n.getStart(ast),
        });
      ts.forEachChild(n, visit);
    };
    visit(ast);
    return found;
  }
  // Lex strings while skipping comments; Java text blocks, C#/Go/Ruby/PHP literals.
  const found = [];
  const matcher =
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|^[ \t]*#[^\n]*|"""[\s\S]*?"""|'''[\s\S]*?'''|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`[^`]*`/gm;
  for (const m of file.content.matchAll(matcher)) {
    if (/^(?:\/|\s*#)/.test(m[0])) continue;
    const width = m[0].startsWith('"""') || m[0].startsWith("'''") ? 3 : 1;
    found.push({
      text: m[0]
        .slice(width, -width)
        .replace(/\\[nr]/g, " ")
        .replace(/\\(["'])/g, "$1"),
      offset: m.index,
      end: m.index + m[0].length,
    });
  }
  const merged = [];
  for (const literal of found) {
    const previous = merged.at(-1);
    if (
      previous &&
      /^\s*\+\s*$/.test(file.content.slice(previous.end, literal.offset))
    ) {
      previous.text += literal.text;
      previous.end = literal.end;
    } else
      merged.push({
        ...literal,
        end: literal.end,
      });
  }
  return merged;
}
export function safeSql(raw, maxChars) {
  if (!/^\s*(SELECT|INSERT\s+INTO|UPDATE|DELETE\s+FROM|WITH)\b/i.test(raw))
    return null;
  return raw
    .replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:''|[^'])*'/g, "?")
    .replace(/(?<![\w$:\\])\b\d+(?:\.\d+)?\b/g, "?")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}
export function discoverDatabaseAccess(graph, files, roots, env = process.env) {
  const max = number("map_database", "max_queries", env);
  const chars = number("map_database", "query_max_chars", env);
  const owner = (p) =>
    [...roots]
      .sort((a, b) => b.root.length - a.root.length)
      .find((r) => r.id && (!r.root || p.startsWith(r.root + "/")))?.id;
  let count = 0;
  for (const component of graph.nodes) component.databaseAccess = [];
  for (const file of files) {
    if (/(^|\/)(tests?|fixtures?|vendor|node_modules)(\/|$)/i.test(file.path))
      continue;
    const from = owner(file.path),
      component = graph.nodes.find((n) => n.id === from);
    if (!component) continue;
    const supported =
      /\.(java|kt|cs|go|py|[cm]?[jt]sx?|rb|php|sql|cbl|cob|pli)$/i.test(
        file.path,
      );
    const targets = [
      ...new Set(
        graph.edges
          .filter(
            (e) =>
              e.from === from &&
              graph.nodes.some((n) => n.id === e.to && n.kind === "database"),
          )
          .map((e) => e.to),
      ),
    ];
    const declarations = file.path.endsWith(".sql")
      ? [
          ...file.content.matchAll(
            /(?:^|;)\s*((?:SELECT|INSERT|UPDATE|DELETE|WITH)\b[^;]*)/gi,
          ),
        ].map((m) => ({ text: m[1], offset: m.index }))
      : supported
        ? sourceStrings(file)
        : [];
    for (const literal of declarations) {
      const query = safeSql(literal.text, chars);
      if (!query || count >= max) continue;
      const tables = [
        ...query.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([\w"`.[\]-]+)/gi),
      ]
        .map((m) => m[1].replace(/["`\[\]]/g, ""))
        .filter((t) => /^[\w-]+(?:\.[\w-]+){0,2}$/.test(t));
      const objects = [...new Set(tables)].map((name) => {
        const parts = name.split(".");
        return {
          database: parts.length === 3 ? parts[0] : null,
          schema: parts.length > 1 ? parts.at(-2) : null,
          table: parts.at(-1),
        };
      });
      const evidence = {
        path: file.path,
        line:
          literal.line ||
          file.content.slice(0, literal.offset).split("\n").length,
        detail: "SQL template declaration; runtime execution unverified",
      };
      const access = {
        id: createHash("sha256")
          .update(`${from}:${file.path}:${literal.offset}`)
          .digest("hex")
          .slice(0, 16),
        query,
        objects,
        databaseIds: targets.length === 1 ? targets : [],
        candidateDatabaseIds: targets,
        evidence,
        classification:
          "Static SQL template; parameters and literal values redacted",
        roundTrips: null,
        latencyMs: null,
      };
      component.databaseAccess.push(access);
      count++;
      if (targets.length === 1) {
        const database = graph.nodes.find((n) => n.id === targets[0]);
        database.databaseObjects ||= [];
        for (const object of objects) {
          const identity = [object.database, object.schema, object.table].join(
            ".",
          );
          let stored = database.databaseObjects.find(
            (o) => [o.database, o.schema, o.table].join(".") === identity,
          );
          if (!stored) {
            stored = { ...object, consumers: [], consumerNames: [] };
            database.databaseObjects.push(stored);
          }
          if (!stored.consumers.includes(from)) {
            stored.consumers.push(from);
            stored.consumerNames.push(component.label);
          }
        }
        for (const edge of graph.edges.filter(
          (e) => e.from === from && e.to === database.id,
        )) {
          edge.databaseCalls ||= [];
          edge.databaseCalls.push(access);
        }
      }
    }
    // Configured numeric budgets only. No inference of units or observed duration.
    const timeouts = [
      ...file.content.matchAll(
        /\b((?:[\w.-]*)(?:connection[-_.]?timeout|socket[-_.]?timeout|query[-_.]?timeout|statement[-_.]?timeout|connect_timeout|read_timeout)(?:[\w.-]*))\s*[:=]\s*["']?(\d+)(ms|s)?\b/gi,
      ),
    ]
      .slice(0, number("map_database", "max_timeouts", env))
      .map((m) => ({
        name: m[1],
        value: Number(m[2]),
        unit: m[3] || "declared unit unspecified",
        evidence: {
          path: file.path,
          line: file.content.slice(0, m.index).split("\n").length,
        },
      }));
    component.databaseTimeouts = [
      ...(component.databaseTimeouts || []),
      ...timeouts,
    ].slice(0, number("map_database", "max_timeouts", env));
  }
  return graph;
}

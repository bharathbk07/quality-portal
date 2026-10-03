import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverDatabaseAccess,
  safeSql,
  sourceStrings,
} from "../backend/mapping/database-access.mjs";
import {
  declaredHttpCalls,
  collectRequestCandidates,
  validateRequestResolutions,
  withRequestResolutions,
} from "../backend/mapping/http-calls.mjs";
import { toMermaid } from "../backend/mapping/analyzer.mjs";
import { mappingConfig } from "../backend/mapping/config.mjs";
const graph = () => ({
  nodes: [
    { id: "a", label: "orders", kind: "service", evidence: [] },
    { id: "b", label: "db", kind: "database", evidence: [] },
  ],
  edges: [
    { from: "a", to: "b", relation: "configured endpoint", evidence: [] },
  ],
});
test("database templates redact literal values, group schema/table objects in one physical dependency, and preserve parameters", () => {
  const g = graph();
  discoverDatabaseAccess(
    g,
    [
      {
        path: "app.java",
        content: `String q = "SELECT * FROM billing.orders WHERE email='private@example.com' AND id = ?";\nString other = "UPDATE audit.events SET state='secret' WHERE id=$1";\nconnection_timeout = 3000ms\n// String fake = "DELETE FROM bogus";`,
      },
    ],
    [{ root: "", id: "a" }],
  );
  assert.equal(g.nodes[0].databaseAccess.length, 2);
  assert.equal(g.nodes[1].databaseObjects.length, 2);
  assert.deepEqual(
    g.nodes[1].databaseObjects.map((o) => o.schema),
    ["billing", "audit"],
  );
  assert.equal(g.nodes[0].databaseAccess[0].roundTrips, null);
  assert.equal(g.nodes[0].databaseAccess[1].query.includes("$1"), true);
  assert.equal(g.nodes[0].databaseTimeouts[0].value, 3000);
  assert.doesNotMatch(JSON.stringify(g), /private@example|secret|bogus/);
});
test("multiple databases do not get arbitrary query bindings; Python AST ignores docs/comments and joins literal SQL", () => {
  const g = graph();
  g.nodes.push({ id: "c", label: "db-two", kind: "database", evidence: [] });
  g.edges.push({ from: "a", to: "c" });
  discoverDatabaseAccess(
    g,
    [
      {
        path: "app.py",
        content: `"""SELECT * FROM documentation_only"""\n# SELECT * FROM comments\nquery = "SELECT * " + "FROM app.orders WHERE id = %s"\ncursor.execute(query, (user_id,))`,
      },
    ],
    [{ root: "", id: "a" }],
  );
  assert.equal(g.nodes[0].databaseAccess.length, 1);
  assert.deepEqual(g.nodes[0].databaseAccess[0].databaseIds, []);
  assert.equal(g.nodes[0].databaseAccess[0].candidateDatabaseIds.length, 2);
  assert.equal(
    sourceStrings({ path: "app.py", content: '# "SELECT * FROM fake"' }).length,
    0,
  );
  assert.equal(safeSql("not a query", 100), null);
});
test("Java and JS transport calls resolve environment bindings and path parameters without executing source", () => {
  const calls = declaredHttpCalls(
    [
      {
        path: "Main.java",
        content: `String target = System.getenv("API_URL");\nrest.getForObject(target + "/balances/" + accountId, Balance.class);\n// rest.postForObject("http://evil/no",body,Type.class);`,
      },
      {
        path: "api.ts",
        content: 'const base=process.env.API_URL; fetch(base + "/orders");',
      },
    ],
    { API_URL: "http://api:8080" },
    20,
  );
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "http://api:8080/balances/{accountId}");
  assert.equal(calls[1].method, "GET");
});
test("AI path proposals require existing unresolved service edges and exact path/evidence; remain dashed hypotheses", () => {
  const g = graph();
  g.nodes[1].kind = "service";
  collectRequestCandidates(
    g,
    [{ path: "app.py", content: 'route = "/orders"' }],
    [{ root: "", id: "a" }],
    20,
  );
  const p = {
    from: "a",
    to: "b",
    method: "HTTP",
    path: "/orders",
    reason: "Possible wrapper path; verify runtime",
    evidence: [{ path: "app.py", line: 1 }],
  };
  const proposals = validateRequestResolutions([p], g, 5, 500);
  assert.equal(proposals[0].confidence, "ai-inferred");
  assert.throws(() =>
    validateRequestResolutions([{ ...p, path: "/invented" }], g, 5, 500),
  );
  assert.throws(() =>
    validateRequestResolutions([{ ...p, from: "unknown" }], g, 5, 500),
  );
  const mermaid = toMermaid(
    withRequestResolutions(g, proposals),
    mappingConfig(),
  );
  assert.match(mermaid, /-\.->/);
  assert.match(mermaid, /AI proposal/);
  assert.equal(g.edges[0].requestHypothesis, undefined);
});

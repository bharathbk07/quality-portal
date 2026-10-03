import test from "node:test";
import assert from "node:assert/strict";
import {
  discoverFlowDetails,
  flowDiagram,
} from "../backend/mapping/flow-diagrams.mjs";
const graph = () => ({
  nodes: [
    { id: "front", label: "web", kind: "frontend", evidence: [] },
    { id: "api", label: "api", kind: "service", evidence: [] },
    {
      id: "db",
      label: "db",
      kind: "database",
      evidence: [{ path: "database.ini", line: 1 }],
    },
  ],
  edges: [
    {
      from: "front",
      to: "api",
      relation: "configured endpoint",
      evidence: [{ path: "compose.yaml", line: 8 }],
    },
    {
      from: "api",
      to: "db",
      relation: "source HTTP call",
      evidence: [{ path: "app.ts", line: 4 }],
    },
  ],
});
test("flow diagrams preserve direction, avoid startup/import edges, and terminate on cycles", () => {
  const g = graph();
  g.edges.push(
    { from: "db", to: "api", relation: "configured endpoint" },
    { from: "front", to: "db", relation: "startup dependency" },
  );
  const seq = flowDiagram(g, "sequence");
  assert.match(seq, /front->>api/);
  assert.match(seq, /api->>db/);
  assert.doesNotMatch(seq, /front->>db/);
  assert.match(seq, /unverified/);
  assert.match(flowDiagram(g, "swimlane"), /subgraph/);
  assert.throws(() => flowDiagram(g, "sequence", "missing"), /entry service/);
});
test("class/state diagrams use declarations; database names and HTTP source calls keep evidence", () => {
  const g = graph();
  g.edges = [];
  discoverFlowDetails(
    g,
    [
      {
        path: "app.ts",
        content:
          'class Base {}\nclass Child extends Base { send() {} }\nfetch("http://api/orders");\n// fetch("http://db/fake")',
      },
      {
        path: "machine.json",
        content: JSON.stringify({
          initial: "idle",
          states: { idle: { on: { START: "running" } }, running: {} },
        }),
      },
      {
        path: "database.ini",
        content: "POSTGRES_DB=payments\nPASSWORD=secret\n",
      },
    ],
    [{ root: "", id: "front" }],
  );
  assert.equal(g.edges.length, 1);
  assert.equal(g.edges[0].relation, "source HTTP call");
  assert.deepEqual(g.nodes[2].databaseNames, ["payments"]);
  assert.match(flowDiagram(g, "class"), /<\|--/);
  assert.match(flowDiagram(g, "state"), /: START/);
  assert.doesNotMatch(JSON.stringify(g), /PASSWORD|secret/);
  assert.throws(() => flowDiagram(graph(), "state"), /explicit/);
  assert.throws(() => flowDiagram(graph(), "class"), /declarations/);
});
test("observed trace order uses parent IDs, handles missing parents and rejects mixed/duplicate traces", () => {
  const spans = [
    {
      traceId: "a",
      spanId: "1",
      service: "web",
      operation: "GET /orders",
      startTime: 1,
    },
    {
      traceId: "a",
      spanId: "2",
      parentSpanId: "1",
      service: "api",
      operation: "query orders",
      startTime: 2,
    },
  ];
  assert.match(flowDiagram(graph(), "trace", null, spans), /query orders/);
  assert.match(
    flowDiagram(graph(), "trace", null, spans),
    /root or missing parent/,
  );
  assert.throws(
    () => flowDiagram(graph(), "trace", null, [...spans, spans[0]]),
    /unique/,
  );
  assert.throws(
    () =>
      flowDiagram(graph(), "trace", null, [
        spans[0],
        { ...spans[1], traceId: "b" },
      ]),
    /one trace/,
  );
});

test("observed database spans show identity and reported timing while redacting SQL literal values", () => {
  const spans = [
    {
      traceId: "a",
      spanId: "1",
      service: "api",
      operation: "GET /orders",
      startTime: 1,
    },
    {
      traceId: "a",
      spanId: "2",
      parentSpanId: "1",
      service: "postgres",
      operation: "SELECT",
      startTime: 2,
      durationMs: 12,
      roundTrips: 2,
      database: {
        name: "commerce",
        schema: "billing",
        table: "orders",
        query: "SELECT * FROM billing.orders WHERE email='private@example.com'",
        timeoutMs: 500,
      },
    },
  ];
  const result = flowDiagram(graph(), "trace", null, spans);
  assert.match(result, /commerce.billing.orders/);
  assert.match(result, /12 ms observed span duration/);
  assert.match(result, /2 round trips reported/);
  assert.doesNotMatch(result, /private@example/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { renderPrompt } from "../backend/shared/prompts.mjs";
import { number } from "../backend/shared/config.mjs";
import { analyzeRepository } from "../backend/mapping/analyzer.mjs";
import { mappingConfig } from "../backend/mapping/config.mjs";
import {
  dependencyImpact,
  simulate,
  forecastCost,
  knowledge,
  auditMap,
  mapDocumentation,
} from "../backend/mapping/intelligence.mjs";
import { projectGraph } from "../backend/mapping/projection.mjs";
import { exportSvg, compareRevisions } from "../backend/mapping/export.mjs";
import {
  validateStudioAi,
  validateRevisionPayload,
  registerStudioRoutes,
} from "../backend/mapping/studio-routes.mjs";
import { validateGrouping } from "../backend/mapping/grouping.mjs";
import { createService } from "../backend/shared/http.mjs";
import {
  encryptSettings,
  decryptSettings,
} from "../backend/settings/store.mjs";
test("architecture review prompts fit the configured AI gateway budget", () => {
  for (const task of ["knowledge", "audit", "documentation", "simulation"]) {
    const prompt = renderPrompt("application-maps/studio-review.txt", {
      task,
      maxChars: number("map_studio", "max_documents_chars"),
    });
    assert.ok(prompt.length <= number("public", "ai_prompt_max_chars"));
    assert.match(prompt, /citations/);
    assert.match(prompt, /actions/);
  }
});
test("AI accepts supplied flow and document citations but rejects unrelated evidence", () => {
  const sample = {
    nodes: [
      { id: "service-a", evidence: [] },
      { id: "service-b", evidence: [] },
      { id: "unrelated", evidence: [] },
    ],
    edges: [
      {
        from: "service-a",
        to: "service-b",
        evidence: [{ path: "client.py", line: 42 }],
      },
    ],
  };
  const content = (nodeId, path, line) =>
    JSON.stringify({
      text: "Verified reference",
      citations: [{ nodeId, path, line }],
      actions: [],
    });
  assert.equal(
    validateStudioAi(content("service-b", "client.py", 42), sample).citations
      .length,
    1,
  );
  assert.equal(
    validateStudioAi(
      content("service-a", "README.md", 15),
      sample,
      process.env,
      [{ path: "README.md", line: 15 }],
    ).citations.length,
    1,
  );
  assert.throws(() =>
    validateStudioAi(content("unrelated", "client.py", 42), sample),
  );
  assert.throws(() =>
    validateStudioAi(
      content("service-a", "README.md", 16),
      sample,
      process.env,
      [{ path: "README.md", line: 15 }],
    ),
  );
});
const node = (id, label, kind) => ({
  id,
  label,
  kind,
  evidence: [{ path: "manifest.yaml", line: 1, detail: "declared" }],
  metadata: {
    primaryLanguage: "Python",
    owner: "",
    caching: [],
    deployments: [],
    ports: [],
  },
});
const ids = ["n" + "a".repeat(16), "n" + "b".repeat(16), "n" + "c".repeat(16)];
const graph = {
  nodes: [
    node(ids[0], "frontend", "frontend"),
    node(ids[1], "api", "service"),
    node(ids[2], "cache", "cache"),
  ],
  edges: [
    {
      from: ids[0],
      to: ids[1],
      relation: "configured endpoint",
      evidence: [{ path: "manifest.yaml", line: 2 }],
    },
    {
      from: ids[1],
      to: ids[2],
      relation: "configured endpoint",
      evidence: [{ path: "manifest.yaml", line: 3 }],
    },
    {
      from: ids[2],
      to: ids[1],
      relation: "configured endpoint",
      evidence: [{ path: "manifest.yaml", line: 4 }],
    },
  ],
  warnings: ["Static only"],
  analyzerVersion: "3",
};
test("dependency impact handles cycles, outage uses reverse dependencies and preserves uncertainty", () => {
  const impact = dependencyImpact(graph, ids[2]);
  assert.deepEqual(
    impact.upstream.map((n) => n.label),
    ["frontend", "api"],
  );
  assert.deepEqual(
    impact.downstream.map((n) => n.label),
    ["api"],
  );
  assert.throws(() => dependencyImpact(graph, "unknown"));
  const outage = simulate(graph, { type: "outage", nodeId: ids[2] });
  assert.ok(outage.findings.some((s) => s.includes("TTL")));
  assert.match(outage.assumptions.join(" "), /No deployment changes/);
  assert.deepEqual(
    knowledge(graph, "Which services depend on cache?").context[0].upstream,
    ["frontend", "api"],
  );
  assert.match(
    knowledge(graph, "Who owns api?", { [ids[1]]: { owner: "Platform team" } })
      .answer,
    /Platform team/,
  );
  assert.match(mapDocumentation(graph, "api").warning, /no endpoints invented/);
});
test("cost estimates use supplied pricing and quantities; missing deployment data remains unknown", () => {
  const g = structuredClone(graph);
  g.nodes[1].metadata.deployments = [
    {
      platform: "Kubernetes",
      environment: "production",
      replicas: 2,
      containers: [
        {
          requests: { cpu: "500m", memory: "512Mi" },
          limits: { memory: "1Gi" },
          healthChecks: [],
          security: {},
        },
      ],
    },
  ];
  const result = forecastCost(g, {
    currency: "EUR",
    hours: 100,
    items: [{ nodeId: ids[1], cpuHour: 2, memoryGiBHour: 4 }],
  });
  assert.equal(result.total, 600);
  assert.equal(result.rows[0].cpuCores, 0.5);
  assert.equal(result.rows[0].memoryGiB, 0.5);
  const missing = forecastCost(g, {
    currency: "EUR",
    hours: 100,
    items: [{ nodeId: ids[0], replicas: 1, cpuHour: 2 }],
  });
  assert.equal(missing.total, null);
  assert.ok(missing.rows[0].missing.includes("CPU requests"));
  const audit = auditMap(g);
  assert.ok(audit.findings.some((f) => f.code === "health-probes-unknown"));
  assert.ok(audit.limits.some((s) => s.includes("certification")));
});
test("views, grouping, search and SVG export preserve evidence and cannot insert HTML", async () => {
  const grouped = await projectGraph(graph, { groupBy: "function" });
  assert.ok(grouped.nodes.some((n) => n.type === "group"));
  assert.ok(grouped.nodes.some((n) => n.parentId));
  const filtered = await projectGraph(graph, { search: "cache" });
  assert.equal(filtered.visibleComponents, 1);
  const overview = await projectGraph(graph, { view: "high-level" });
  assert.equal(overview.nodes.length, 3);
  const svg = exportSvg({
    ...overview,
    nodes: overview.nodes.map((n) => ({
      ...n,
      data: { ...n.data, label: '<script>alert("x")</script>' },
    })),
  });
  assert.doesNotMatch(svg, /<script>/);
  assert.match(svg, /&lt;script&gt;/);
  assert.deepEqual(
    graph.nodes.map((n) => n.label),
    ["frontend", "api", "cache"],
  );
});
test("AI citations, grouping, annotation IDs and HTTPS links are validated on the backend", () => {
  const content = JSON.stringify({
    text: "Static explanation",
    citations: [{ nodeId: ids[0], path: "manifest.yaml", line: 1 }],
  });
  assert.equal(validateStudioAi(content, graph).citations.length, 1);
  assert.throws(() =>
    validateStudioAi(
      JSON.stringify({
        text: "x",
        citations: [{ nodeId: ids[0], path: "invented.py", line: 1 }],
      }),
      graph,
    ),
  );
  assert.throws(() =>
    validateGrouping(
      JSON.stringify({
        summary: "x",
        groups: [{ name: "X", nodeIds: ["unknown"], evidence: [] }],
      }),
      graph,
    ),
  );
  const boundary = validateGrouping(
    JSON.stringify({
      summary: "proposal",
      groups: [
        {
          name: "Web",
          nodeIds: [ids[0]],
          evidence: [{ path: "manifest.yaml", line: 1 }],
        },
      ],
    }),
    graph,
  );
  assert.equal(boundary.annotations[ids[0]].group, "Web");
  const base = {
    label: "Saved",
    kind: "current",
    annotations: {},
    positions: {},
  };
  assert.throws(() =>
    validateRevisionPayload(graph, {
      ...base,
      annotations: { unknown: { notes: "no" } },
    }),
  );
  assert.throws(() =>
    validateRevisionPayload(graph, {
      ...base,
      annotations: {
        [ids[0]]: { documentation: ["https://user:pass@example.com/"] },
      },
    }),
  );
  assert.throws(() =>
    validateRevisionPayload(graph, {
      ...base,
      scenario: { type: "outage", nodeId: ids[0] },
    }),
  );
  const changes = compareRevisions(graph, null, {
    annotations: { [ids[0]]: { owner: "Team" } },
  });
  assert.equal(changes.changes[0].field, "owner");
});
test("metadata identifies language and cache declarations without treating secrets or test-only caches as evidence", () => {
  const files = [
    {
      path: "app/requirements.txt",
      content: "# either express or implied\nflask\n",
    },
    {
      path: "app/main.py",
      content:
        "from functools import lru_cache\n@lru_cache(maxsize=64)\ndef get_cached():\n    return 1\n",
    },
    {
      path: "app/tests/test_fake.py",
      content: "@cache(foo)\ndef fake(): pass\n",
    },
    {
      path: ".github/workflows/build.yaml",
      content: "name: CI\njobs:\n  build:\n    runs-on: ubuntu-latest\n",
    },
    { path: "infra/main.tf", content: 'resource "aws_lb" "public" {}\n' },
  ];
  const g = analyzeRepository(files, mappingConfig());
  const app = g.nodes.find((n) => n.label === "app");
  assert.equal(app.metadata.primaryLanguage, "Python");
  assert.deepEqual(
    app.metadata.runtimes.map((r) => r.name),
    ["Flask"],
  );
  assert.equal(app.metadata.caching.length, 1);
  assert.equal(app.metadata.caching[0].evidence.line, 2);
  assert.equal(g.pipelines[0].system, "GitHub Actions");
  assert.equal(g.infrastructure[0].type, "aws_lb");
});
test("studio APIs reject foreign workspace maps, invalid bodies, stale snapshots and preserve deterministic analysis on AI failure", async () => {
  const mapId = "11111111-1111-4111-8111-111111111111",
    workspaceId = "22222222-2222-4222-8222-222222222222";
  const env = {
    SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
    SERVICE_TOKEN: "test-service-token",
  };
  let stored = [];
  const db = {
    query: async (sql, v) => {
      sql = typeof sql === "string" ? sql : sql.text;
      if (sql.startsWith("SELECT id,name,source"))
        return {
          rows:
            v[1] === workspaceId
              ? [
                  {
                    id: mapId,
                    status: "completed",
                    result: graph,
                    source: { kind: "git" },
                  },
                ]
              : [],
        };
      if (sql.startsWith("SELECT * FROM map_studio")) return { rows: stored };
      if (sql.startsWith("INSERT INTO map_studio")) {
        const row = {
          id: v[0],
          map_id: v[1],
          workspace_id: v[2],
          version: v[3],
          created_by: v[4],
          kind: v[5],
          ciphertext: v[6],
          iv: v[7],
          tag: v[8],
          created_at: new Date().toISOString(),
        };
        stored = [row, ...stored];
        return { rows: [row] };
      }
      return { rows: [] };
    },
    connect: async () => ({ ...db, release() {} }),
  };
  const app = await createService("studio-tests", {
    secret: env.SERVICE_TOKEN,
    logger: false,
  });
  app.addHook("onRequest", async (req) => {
    req.workspaceId = req.headers["x-test-workspace"] || workspaceId;
    req.identity = { user: { id: workspaceId } };
  });
  registerStudioRoutes(app, {
    db,
    env,
    upstream: async () => {
      throw new Error("Provider offline");
    },
  });
  const inject = (method, url, payload, headers = {}) =>
    app.inject({
      method,
      url,
      payload,
      headers: { "x-service-token": env.SERVICE_TOKEN, ...headers },
    });
  const unknown = await inject("GET", `/maps/${mapId}/studio`, undefined, {
    "x-test-workspace": "foreign",
  });
  assert.equal(unknown.statusCode, 404);
  const invalid = await inject("POST", `/maps/${mapId}/simulate`, {
    scenario: { nodeId: ids[0], type: "traffic", multiplier: 0 },
  });
  assert.equal(invalid.statusCode, 400);
  const simulation = await inject("POST", `/maps/${mapId}/simulate`, {
    scenario: { nodeId: ids[2], type: "outage" },
    useAi: true,
  });
  assert.equal(simulation.statusCode, 200);
  assert.match(simulation.json().aiError, /deterministic/);
  const body = {
    expectedVersion: 0,
    label: "Demo annotation",
    kind: "current",
    annotations: { [ids[0]]: { notes: "PRIVATE_NOTE" } },
    positions: {},
    view: "logical",
    groupBy: "none",
    layout: "hierarchical",
  };
  const first = await inject("POST", `/maps/${mapId}/revisions`, body);
  assert.equal(first.statusCode, 201, first.body);
  assert.ok(!stored[0].ciphertext.includes("PRIVATE_NOTE"));
  const saved = decryptSettings(
    { ...stored[0], id: `map-studio:${workspaceId}:${mapId}:${stored[0].id}` },
    Buffer.from(env.SETTINGS_ENCRYPTION_KEY, "base64"),
  );
  assert.equal(saved.annotations[ids[0]].notes, "PRIVATE_NOTE");
  const stale = await inject("POST", `/maps/${mapId}/revisions`, body);
  assert.equal(stale.statusCode, 409);
  assert.equal(stored.length, 1);
  const view = await inject("GET", `/maps/${mapId}/studio?view=deployment`);
  assert.equal(view.statusCode, 200, view.body);
  assert.equal(view.json().revision.version, 1);
  await app.close();
});
test("encrypted snapshot substitution fails for different workspace or map IDs", () => {
  const key = randomBytes(32),
    id = "map-studio:workspace:map:revision";
  const encrypted = encryptSettings(
    id,
    { annotations: { notes: "private" } },
    key,
  );
  assert.throws(() =>
    decryptSettings({ ...encrypted, id: "map-studio:other:map:revision" }, key),
  );
  assert.throws(() =>
    decryptSettings(
      { ...encrypted, id: "map-studio:workspace:other:revision" },
      key,
    ),
  );
});

test("AI analysis actions accept only bounded tools and existing map components", () => {
  const graph = {
    nodes: [
      {
        id: "service-1",
        label: "Payments",
        evidence: [{ path: "app.py", line: 1 }],
      },
    ],
    edges: [],
  };
  const validate = (actions) =>
    validateStudioAi(
      JSON.stringify({ text: "Evidence-based answer", citations: [], actions }),
      graph,
    );
  assert.deepEqual(
    validate([{ type: "impact", nodeId: "service-1" }, { type: "audit" }])
      .actions,
    [{ type: "impact", nodeId: "service-1" }, { type: "audit" }],
  );
  for (const actions of [
    [{ type: "shell", command: "rm" }],
    [{ type: "outage", nodeId: "foreign" }],
    [{ type: "audit", nodeId: "service-1" }],
    [{ type: "readme", url: "https://example.com" }],
    Array(4).fill({ type: "audit" }),
  ]) {
    assert.throws(() => validate(actions));
  }
});

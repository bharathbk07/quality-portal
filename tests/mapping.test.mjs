import test from "node:test";
import assert from "node:assert/strict";
import { mappingConfig } from "../backend/mapping/config.mjs";
import {
  analyzeRepository,
  validateEnrichment,
  toMermaid,
} from "../backend/mapping/analyzer.mjs";
import { validateFiles, eligibleFile } from "../backend/mapping/policy.mjs";
import { validateGitUrl } from "../backend/mapping/git-reader.mjs";
import { processMapJob } from "../backend/mapping/worker.mjs";
const policy = mappingConfig();
import { fixture } from "./fixtures/repository.mjs";
test("static map extracts configured topology, package relationships, source evidence and stable Mermaid", () => {
  const result = analyzeRepository(fixture, policy);
  const labels = new Map(result.nodes.map((n) => [n.id, n.label]));
  assert.ok(
    result.nodes.some((n) => n.label === "db" && n.kind === "database"),
  );
  assert.ok(
    result.edges.some(
      (e) =>
        labels.get(e.from) === "api" &&
        labels.get(e.to) === "db" &&
        e.relation === "configured endpoint",
    ),
  );
  assert.ok(
    result.edges.some(
      (e) =>
        labels.get(e.from) === "gateway" &&
        labels.get(e.to) === "api" &&
        e.relation === "routes to",
    ),
  );
  assert.ok(
    result.edges.some(
      (e) =>
        e.relation === "source import" &&
        e.evidence[0].path === "apps/api/index.ts" &&
        e.evidence[0].line === 1,
    ),
  );
  assert.equal(
    result.edges.find(
      (e) =>
        labels.get(e.from) === "api" && e.relation === "startup dependency",
    ).evidence[0].line,
    13,
  );
  assert.ok(result.edges.some((e) => e.relation === "package dependency"));
  assert.ok(!JSON.stringify(result).includes("SECRET_VALUE"));
  assert.equal(
    result.mermaid,
    analyzeRepository([...fixture].reverse(), policy).mermaid,
  );
  assert.match(result.mermaid, /^flowchart LR/);
  assert.ok(
    result.warnings.some((w) => w.includes("do not prove runtime calls")),
  );
});
test("upload path validation, secret exclusion and resource limits are enforced", () => {
  assert.equal(eligibleFile(".env.production", policy), false);
  assert.equal(eligibleFile("node_modules/a/index.js", policy), false);
  assert.equal(eligibleFile("credentials.json", policy), false);
  assert.throws(() =>
    validateFiles([{ path: "../secrets.json", content: "{}" }], policy),
  );
  assert.throws(() =>
    validateFiles([{ path: "/etc/passwd", content: "x" }], policy),
  );
  assert.throws(() =>
    validateFiles(
      [
        { path: "x.js", content: "x" },
        { path: "x.js", content: "y" },
      ],
      policy,
    ),
  );
  assert.throws(() =>
    validateFiles([{ path: "x.js", content: "123456" }], {
      ...policy,
      maxTotalBytes: 5,
    }),
  );
  const cleaned = validateFiles(
    [{ path: ".env", content: "SECRET=x" }, ...fixture],
    policy,
  );
  assert.equal(cleaned.excluded, 1);
  assert.equal(cleaned.files.length, fixture.length);
});
test("Git URL policy rejects arbitrary protocols, credentials, local addresses and query strings", () => {
  assert.equal(
    validateGitUrl("https://github.com/team/project.git", policy).hostname,
    "github.com",
  );
  for (const url of [
    "file:///etc",
    "ssh://github.com/a/b",
    "https://token@github.com/a/b",
    "https://127.0.0.1/a/b",
    "https://github.com/a/b?token=secret",
    "https://github.com:443/a/b",
    "https://evil.example/a/b",
  ]) {
    assert.throws(() => validateGitUrl(url, policy));
  }
});
test("AI enrichment validates existing nodes and cannot replace the static graph or inject Mermaid", () => {
  const graph = analyzeRepository(fixture, policy);
  const [from, to] = graph.nodes.slice(0, 2).map((n) => n.id);
  const original = graph.mermaid;
  const enrichment = validateEnrichment(
    JSON.stringify({
      summary: "Review recovery behavior",
      suggestions: [
        {
          from,
          to,
          reason: "Possible request path; verify tracing",
          evidence: [graph.nodes[0].evidence[0]],
        },
      ],
    }),
    graph,
  );
  assert.match(
    toMermaid(graph, policy, enrichment.suggestions),
    /AI suggestion/,
  );
  assert.equal(graph.mermaid, original);
  assert.throws(() =>
    validateEnrichment(
      JSON.stringify({
        summary: "x",
        suggestions: [{ from: "unknown", to, reason: "x" }],
      }),
      graph,
    ),
  );
  assert.throws(() =>
    validateEnrichment('flowchart LR;click x "https://evil.example"', graph),
  );
});
test("worker completion stores the map and clears input with a fencing token; failures preserve no source", async () => {
  const calls = [];
  const db = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rowCount: 1 };
    },
  };
  await processMapJob(
    {
      id: "job",
      source: { kind: "upload" },
      input: { kind: "upload", files: fixture },
    },
    { db, token: "lease-token" },
  );
  assert.match(calls[0].sql, /status='completed'/);
  assert.match(calls[0].sql, /input=NULL/);
  assert.equal(calls[0].params[3], "lease-token");
  assert.match(calls[0].sql, /worker_token=\$4/);
  calls.length = 0;
  await processMapJob(
    {
      id: "job",
      source: { kind: "upload" },
      input: { kind: "upload", files: [{ path: "../bad", content: "x" }] },
    },
    { db, token: "lease-token" },
  );
  assert.match(calls[0].sql, /status=CASE WHEN result IS NULL THEN 'failed' ELSE 'completed' END/);
  assert.match(calls[0].sql, /input=NULL/);
});

test("Kubernetes resolves selector-backed endpoints and excludes shared but unused endpoints and alternate deployments", () => {
  const files = [
    {
      path: "kubernetes-manifests/config.yaml",
      content:
        "apiVersion: v1\nkind: ConfigMap\nmetadata:\n  name: endpoints\ndata:\n  DB_ADDR: db:5432\n  UNUSED_ADDR: unused:8080\n  PASSWORD: SECRET_VALUE\n",
    },
    ...["api", "db", "unused"].map((name) => ({
      path: `kubernetes-manifests/${name}.yaml`,
      content: `apiVersion: v1\nkind: Service\nmetadata:\n  name: ${name}\nspec:\n  selector:\n    app: ${name}\n---\napiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${name}\nspec:\n  template:\n    metadata:\n      labels:\n        app: ${name}\n    spec:\n      containers:\n      - name: main\n        image: registry/${name}:latest\n        envFrom:\n        - configMapRef:\n            name: endpoints\n`,
    })),
    {
      path: "src/api/skaffold.yaml",
      content:
        "apiVersion: skaffold/v4beta1\nkind: Config\nbuild:\n  artifacts:\n  - image: api\n    context: ../..\n    jib:\n      project: src/api\n",
    },
    {
      path: "src/api/main.py",
      content: "import os\nhost = os.environ.get('DB_ADDR')\n",
    },
    {
      path: "extras/other.yaml",
      content:
        "apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: alternate\nspec: {}\n",
    },
    { path: "extras/requirements.txt", content: "flask\n" },
  ];
  const graph = analyzeRepository(files, policy);
  const names = new Map(graph.nodes.map((n) => [n.id, n.label]));
  assert.deepEqual(graph.nodes.map((n) => n.label).sort(), [
    "api",
    "db",
    "unused",
  ]);
  assert.equal(graph.edges.length, 1);
  assert.equal(names.get(graph.edges[0].from), "api");
  assert.equal(names.get(graph.edges[0].to), "db");
  assert.equal(graph.edges[0].evidence[1].path, "src/api/main.py");
  assert.equal(graph.edges[0].evidence[1].line, 2);
  assert.equal(graph.nodes.find((n) => n.label === "db").kind, "database");
  assert.equal(
    graph.mermaid,
    analyzeRepository([...files].reverse(), policy).mermaid,
  );
  assert.ok(!JSON.stringify(graph).includes("SECRET_VALUE"));
  const [from, to] = graph.nodes
    .filter((n) => n.label !== "api")
    .map((n) => n.id);
  assert.throws(
    () =>
      validateEnrichment(
        JSON.stringify({
          summary: "Unknown",
          suggestions: [
            {
              from,
              to,
              reason: "guess",
              evidence: [{ path: "fabricated.py", line: 1 }],
            },
          ],
        }),
        graph,
      ),
    /cite existing/,
  );
});

test("Kubernetes namespace boundaries and ambiguous selectors do not produce guessed connections", () => {
  const workload = (name, namespace, app, env = "") =>
    `apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: ${name}\n  namespace: ${namespace}\nspec:\n  template:\n    metadata:\n      labels:\n        app: ${app}\n    spec:\n      containers:\n      - name: main\n        image: ${name}\n${env}`;
  const service = (namespace) =>
    `apiVersion: v1\nkind: Service\nmetadata:\n  name: target\n  namespace: ${namespace}\nspec:\n  selector:\n    app: shared\n`;
  const files = [
    {
      path: "kubernetes-manifests/client.yaml",
      content: workload(
        "client",
        "a",
        "client",
        "        env:\n        - name: API_ADDR\n          value: target.b.svc.cluster.local:8080\n",
      ),
    },
    {
      path: "kubernetes-manifests/a.yaml",
      content: service("a") + "---\n" + workload("local", "a", "shared"),
    },
    {
      path: "kubernetes-manifests/b.yaml",
      content: service("b") + "---\n" + workload("remote", "b", "shared"),
    },
  ];
  const graph = analyzeRepository(files, policy);
  const names = new Map(graph.nodes.map((n) => [n.id, n.label]));
  assert.equal(graph.edges.length, 1);
  assert.equal(names.get(graph.edges[0].to), "remote");
  const ambiguous = analyzeRepository(
    [
      ...files,
      {
        path: "kubernetes-manifests/duplicate.yaml",
        content: workload("duplicate", "b", "shared"),
      },
    ],
    policy,
  );
  assert.equal(ambiguous.edges.length, 0);
  assert.ok(ambiguous.warnings.some((w) => w.includes("2 matching workloads")));
});

import test from "node:test";
import assert from "node:assert/strict";
import { mappingConfig } from "../services/mapping/config.mjs";
import {
  analyzeRepository,
  validateEnrichment,
  toMermaid,
} from "../services/mapping/analyzer.mjs";
import { validateFiles, eligibleFile } from "../services/mapping/policy.mjs";
import { validateGitUrl } from "../services/mapping/git-reader.mjs";
import { processMapJob } from "../services/mapping/worker.mjs";
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
        { from, to, reason: "Possible request path; verify tracing" },
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
  assert.match(calls[0].sql, /status='failed'/);
  assert.match(calls[0].sql, /input=NULL/);
});

import test from "node:test";
import assert from "node:assert/strict";
import { assess, markdownReport } from "../backend/assessment/service.mjs";
import {
  assessmentSchema,
  assessmentCatalog,
} from "../backend/assessment/schema.mjs";
import { permission } from "../backend/identity/routes.mjs";
import { createService } from "../backend/shared/http.mjs";
import { randomBytes } from "node:crypto";
import { registerAssessment } from "../backend/assessment/routes.mjs";
test("pre-test reports distinguish missing information, observed configuration and hypotheses without claiming execution", () => {
  const r = assess(
    {
      kind: "performance",
      name: " Review ",
      intake: { objective: "Checkout", baseline: "Old incident" },
    },
    {
      contract: {
        title: "API",
        warnings: ["Missing response schema"],
        endpoints: [{ method: "POST", path: "/pay" }],
      },
      map: {
        nodes: [{ id: "api" }],
        edges: [{ source: "a", target: "b" }],
        warnings: ["Partial map"],
      },
    },
  );
  assert.equal(r.stage, "pre-test");
  assert.equal(r.name, "Review");
  assert.equal(r.evidence.map.edges, 1);
  assert.ok(
    r.findings.some(
      (x) => x.id === "write-safety" && x.classification === "hypothesis",
    ),
  );
  assert.ok(
    r.findings.some(
      (x) =>
        x.id === "contract-0" && x.classification === "observed configuration",
    ),
  );
  assert.ok(r.findings.some((x) => x.id === "missing-workload"));
  assert.match(markdownReport(r), /No test or active scan was run/);
  assert.equal(r.ai, null);
});
test("each report type asks for its relevant evidence and viewers cannot create reports", () => {
  for (const type of assessmentCatalog.reportKinds)
    assert.ok(
      assess({ kind: type.id, name: "Review", intake: {} }).readiness.total > 0,
    );
  const a = assess({ kind: "accessibility", name: "Review", intake: {} });
  assert.ok(a.findings.some((x) => x.id === "missing-experience"));
  assert.ok(!a.findings.some((x) => x.id === "missing-workload"));
  assert.throws(
    () =>
      permission(
        { user: {}, workspace: { role: "viewer" } },
        "/assessments",
        "POST",
      ),
    (e) => e.statusCode === 403,
  );
  assert.doesNotThrow(() =>
    permission(
      { user: {}, workspace: { role: "viewer" } },
      "/assessments",
      "GET",
    ),
  );
});
test("assessment API validates inputs and rejects unavailable or foreign workspace sources", async (t) => {
  const app = createService("assessment-test", {
    secret: "test-token",
    logger: false,
  });
  app.addHook("onRequest", async (req) => {
    req.workspaceId = "12345678-1234-1234-1234-123456789012";
  });
  registerAssessment(app, {
    db: { query: async () => ({ rows: [] }) },
    env: { SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64") },
    upstream: async () => {
      throw Error("Should not be called");
    },
  });
  t.after(() => app.close());
  const headers = { "x-service-token": "test-token" };
  assert.equal(
    (await app.inject({ url: "/assessments/catalog", headers })).statusCode,
    200,
  );
  const input = { name: "Review", kind: "readiness", intake: {}, useAI: false };
  for (const payload of [
    { ...input, kind: "unknown" },
    { ...input, name: "   " },
    { ...input, intake: { password: "x" } },
    {
      ...input,
      intake: {
        objective: "x".repeat(
          assessmentSchema().properties.intake.properties.objective.maxLength +
            1,
        ),
      },
    },
  ])
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/assessments",
          headers,
          payload,
        })
      ).statusCode,
      400,
    );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/assessments",
        headers,
        payload: {
          ...input,
          contractId: "12345678-1234-1234-1234-123456789000",
        },
      })
    ).statusCode,
    404,
  );
  assert.equal(
    (
      await app.inject({
        url: "/assessments/12345678-1234-1234-1234-123456789000",
        headers,
      })
    ).statusCode,
    404,
  );
});

test("failed AI suggestion preserves a usable deterministic encrypted report", async (t) => {
  let stored;
  const db = {
    query: async (sql, args) => {
      const text = typeof sql === "string" ? sql : sql.text;
      if (text.startsWith("INSERT")) stored = args;
      return { rows: [] };
    },
  };
  const app = createService("assessment-fallback", {
    secret: "test-token",
    logger: false,
  });
  app.addHook("onRequest", async (req) => {
    req.workspaceId = "12345678-1234-1234-1234-123456789012";
  });
  registerAssessment(app, {
    db,
    env: { SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64") },
    upstream: async () => {
      throw new Error("private provider failure");
    },
  });
  t.after(() => app.close());
  const r = await app.inject({
    method: "POST",
    url: "/assessments",
    headers: { "x-service-token": "test-token" },
    payload: {
      name: "Fallback",
      kind: "readiness",
      intake: { objective: "secret journey" },
      useAI: true,
    },
  });
  assert.equal(r.statusCode, 201);
  assert.equal(r.json().report.ai, null);
  assert.match(r.json().aiError, /evidence-based report is available/);
  assert.ok(!r.body.includes("private provider failure"));
  assert.ok(!JSON.stringify(stored).includes("secret journey"));
});

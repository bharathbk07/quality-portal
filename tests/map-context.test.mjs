import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  indexDocumentation,
  retrieveDocumentation,
  encryptDocumentation,
  redactDocument,
} from "../backend/mapping/document-context.mjs";
import { decryptSettings, encryptionKey } from "../backend/settings/store.mjs";
import { analyzeRepository } from "../backend/mapping/analyzer.mjs";
import { mappingConfig } from "../backend/mapping/config.mjs";
import { permission } from "../backend/identity/routes.mjs";
import { createService } from "../backend/shared/http.mjs";
import { registerMapRoutes } from "../backend/mapping/routes.mjs";
test("bounded document retrieval redacts secrets and binds encryption to map/workspace", () => {
  const env = { SETTINGS_ENCRYPTION_KEY: randomBytes(32).toString("base64") };
  const chunks = indexDocumentation(
    [
      {
        path: "README.md",
        content:
          "# Accounts\npassword=hunter2\nowner@example.com\nThe accounts service publishes balances.",
      },
      {
        path: "docs/cache.md",
        content: "# Cache\nRedis expiry policy needs operator review.",
      },
    ],
    env,
  );
  assert.ok(!JSON.stringify(chunks).includes("hunter2"));
  assert.ok(!JSON.stringify(chunks).includes("owner@example.com"));
  assert.equal(
    retrieveDocumentation(chunks, "Redis expiry", env)[0].path,
    "docs/cache.md",
  );
  const encrypted = encryptDocumentation("a", "w", chunks, env);
  assert.deepEqual(
    decryptSettings(
      { ...encrypted, id: "map-documents:w:a" },
      encryptionKey(env),
    ).chunks,
    chunks,
  );
  assert.throws(() =>
    decryptSettings(
      { ...encrypted, id: "map-documents:x:a" },
      encryptionKey(env),
    ),
  );
  assert.equal(
    redactDocument("api_key=sk-abcdefghijklmnop123456"),
    "api_key=[REDACTED]",
  );
});
test("legacy program/job references keep unresolved programs outside imported scope", () => {
  const graph = analyzeRepository(
    [
      {
        path: "PAY.cbl",
        content:
          '       IDENTIFICATION DIVISION.\n       PROGRAM-ID. PAY.\n      * CALL "COMMENT"\n           CALL "AUTH"\n           CALL "REMOTE"',
      },
      { path: "AUTH.cbl", content: "       PROGRAM-ID. AUTH." },
      { path: "job.jcl", content: "//PAYJOB JOB 1\n//STEP EXEC PGM=PAY" },
    ],
    mappingConfig(),
  );
  assert.ok(
    graph.nodes.some(
      (n) => n.label === "PAY" && n.metadata.primaryLanguage === "COBOL",
    ),
  );
  assert.ok(!graph.nodes.some((n) => n.label.includes("COMMENT")));
  assert.ok(
    graph.nodes.some(
      (n) => n.label === "REMOTE (unresolved program)" && n.kind === "external",
    ),
  );
  assert.equal(
    graph.edges.filter((e) => e.relation === "declared program invocation")
      .length,
    3,
  );
  const docs = analyzeRepository(
    [
      {
        path: "README.md",
        content: "# Architecture\nNo executable source supplied.",
      },
    ],
    mappingConfig(),
  );
  assert.equal(docs.nodes[0].label, "Documentation-only scope");
  assert.equal(docs.edges.length, 0);
});
test("only workspace administrators can delete an application-map project", () => {
  for (const role of ["viewer", "developer", "tester"])
    assert.throws(
      () =>
        permission(
          { workspace: { role }, user: {} },
          "/maps/example",
          "DELETE",
        ),
      { statusCode: 403 },
    );
  assert.doesNotThrow(() =>
    permission(
      { workspace: { role: "admin" }, user: {} },
      "/maps/example",
      "DELETE",
    ),
  );
});
test("regeneration and exact-name deletion stay workspace scoped and remove snapshots atomically", async () => {
  const id = "11111111-1111-4111-8111-111111111111",
    ws = "22222222-2222-4222-8222-222222222222";
  let record = {
    id,
    name: "Legacy subsystem",
    status: "completed",
    result: analyzeRepository(
      [{ path: "main.cbl", content: "       PROGRAM-ID. MAIN." }],
      mappingConfig(),
    ),
  };
  const queries = [];
  const db = {
    query: async (q, v = []) => {
      const sql = typeof q === "string" ? q : q.text;
      queries.push(sql);
      if (sql.startsWith("SELECT id,name"))
        return { rows: v[1] === ws && record ? [record] : [] };
      if (sql.startsWith("UPDATE application_maps SET result")) {
        record.result.mermaid = v[0];
        return { rows: [{ id }] };
      }
      if (sql.startsWith("DELETE FROM application_maps")) record = null;
      return { rows: [] };
    },
    connect: async () => ({ ...db, release() {} }),
  };
  const app = await createService("map-lifecycle", {
    secret: "service",
    logger: false,
  });
  app.addHook("onRequest", async (req) => {
    req.workspaceId = req.headers["x-test-workspace"] || ws;
  });
  registerMapRoutes(app, {
    db,
    env: { SERVICE_TOKEN: "service" },
    upstream: async () => ({}),
  });
  const send = (method, path, body, headers = {}) =>
    app.inject({
      method,
      url: path,
      payload: body,
      headers: { "x-service-token": "service", ...headers },
    });
  try {
    assert.equal(
      (await send("POST", `/maps/${id}/regenerate`, { direction: "TD" }))
        .statusCode,
      200,
    );
    assert.ok(record.result.mermaid.startsWith("flowchart TD"));
    assert.equal(
      (await send("POST", `/maps/${id}/regenerate`, { direction: "INVALID" }))
        .statusCode,
      400,
    );
    assert.equal(
      (
        await send(
          "DELETE",
          `/maps/${id}`,
          { confirmName: "Legacy subsystem" },
          { "x-test-workspace": "33333333-3333-4333-8333-333333333333" },
        )
      ).statusCode,
      404,
    );
    assert.equal(
      (await send("DELETE", `/maps/${id}`, { confirmName: "wrong" }))
        .statusCode,
      400,
    );
    assert.ok(record);
    assert.equal(
      (await send("DELETE", `/maps/${id}`, { confirmName: "Legacy subsystem" }))
        .statusCode,
      200,
    );
    assert.equal(record, null);
    assert.ok(
      queries.indexOf(
        "DELETE FROM map_studio_revisions WHERE map_id=$1 AND workspace_id=$2",
      ) <
        queries.indexOf(
          "DELETE FROM application_maps WHERE id=$1 AND workspace_id=$2",
        ),
    );
    assert.equal((await send("GET", `/maps/${id}`)).statusCode, 404);
  } finally {
    await app.close();
  }
});

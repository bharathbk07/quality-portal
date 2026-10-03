// Run from /app: docker compose exec -T core node --input-type=module < tests/identity-postgres.mjs
// Uses an isolated PostgreSQL schema and drops only that schema after verification.
import assert from "node:assert/strict";
import pg from "pg";
import { randomBytes } from "node:crypto";
import {runMigrations, migrations} from "./backend/database/migrate.mjs";
import { migrateIdentity } from "./backend/identity/store.mjs";
import { migrateSso } from "./backend/identity/sso.mjs";
import { migrateSettings } from "./backend/settings/store.mjs";
import { migrateMapping } from "./backend/mapping/migrations.mjs";
import { buildCore } from "./backend/core/app.mjs";
import { buildBff } from "./middleware/bff/app.mjs";
const schema = "identity_test_" + randomBytes(8).toString("hex");
const root = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await root.query(`CREATE SCHEMA ${schema}`);
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  options: `-c search_path=${schema}`,
});
const env = {
  ...process.env,
  SUPER_ADMIN_PASSWORD: randomBytes(32).toString("hex"),
  BOOTSTRAP_ADMIN_USERNAME: "integration-admin",
  SESSION_SECRET: randomBytes(32).toString("hex"),
  PUBLIC_ORIGINS: "http://localhost:8088",
};
let app, bff;
let checks = 0;
try {
  await db.query(
    `CREATE TABLE contracts(id uuid PRIMARY KEY,title text,document jsonb,created_at timestamptz DEFAULT now());CREATE TABLE plans(id uuid PRIMARY KEY,name text,discipline integer,artifact text,created_at timestamptz DEFAULT now());CREATE TABLE audit_events(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,action text,entity_id uuid,created_at timestamptz DEFAULT now());`,
  );
  await migrateMapping(db);
  await migrateSettings(db);
  await migrateIdentity(db, env);
  await migrateSso(db);
  const oldHash = (await db.query("SELECT password_hash FROM users")).rows[0]
    .password_hash;
  await migrateIdentity(db, {
    ...env,
    SUPER_ADMIN_PASSWORD: "another long startup password",
  });
  assert.equal(
    (await db.query("SELECT password_hash FROM users")).rows[0].password_hash,
    oldHash,
  );
  checks++;
  const cache = {
    ping: async () => {},
    get: async () => null,
    set: async () => {},
    del: async () => {},
  };
  app = buildCore({ db, cache, env, secret: env.SERVICE_TOKEN, logger: false });
  bff = await buildBff({
    env,
    logger: false,
    serviceCaller: async (base, path, opts) => {
      const r = await app.inject({
        method: opts.method || "GET",
        url: path,
        headers: {
          "x-service-token": env.SERVICE_TOKEN,
          ...(opts.sessionToken
            ? { "x-session-token": opts.sessionToken }
            : {}),
          ...(opts.workspaceId ? { "x-workspace-id": opts.workspaceId } : {}),
        },
        ...(opts.body !== undefined ? { payload: opts.body } : {}),
      });
      if (r.statusCode >= 400)
        throw Object.assign(new Error(r.json().error), {
          statusCode: r.statusCode,
          expose: true,
        });
      return r.json();
    },
  });
  async function request(path, method = "GET", body, session) {
    const r = await bff.inject({
      url: "/api" + path,
      method,
      headers: session
        ? { cookie: session.cookie, "x-csrf-token": session.csrf }
        : {},
      ...(body === undefined ? {} : { payload: body }),
    });
    return {
      status: r.statusCode,
      data: r.json(),
      cookie: r.headers["set-cookie"],
    };
  }
  async function login(username, password) {
    const r = await request("/session", "POST", { username, password });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    checks++;
    return { ...r.data, cookie: r.cookie, csrf: r.data.csrfToken };
  }
  const admin = await login("integration-admin", env.SUPER_ADMIN_PASSWORD),
    defaultId = admin.workspace.id;
  const alpha = await request(
    "/identity/workspaces",
    "POST",
    { name: "Isolated alpha" },
    admin,
  );
  assert.equal(alpha.status, 200);
  checks++;
  const adminId = admin.user.id;
  assert.equal(
    (await request("/auth/workspace", "POST", { id: alpha.data.id }, admin))
      .status,
    200,
  );
  checks++;
  const contract = await request(
    "/contracts",
    "POST",
    {
      spec: JSON.stringify({
        openapi: "3.1.0",
        info: { title: "Private API", version: "1" },
        paths: {
          "/health": { get: { responses: { 200: { description: "ok" } } } },
        },
      }),
    },
    admin,
  );
  assert.equal(contract.status, 201);
  assert.deepEqual(contract.data.defaultSelection, ["GET /health"]);
  checks += 2;
  const artifact = await request(
    "/artifacts",
    "POST",
    {
      discipline: 0,
      contractId: contract.data.id,
      selected: ["GET /health"],
      p95: 300,
      vus: 2,
    },
    admin,
  );
  assert.equal(artifact.status, 200);
  assert.match(artifact.data.content, /p\(95\)<300/);
  checks += 2;
  assert.equal(
    (await request("/artifacts", "POST", { discipline: 0, p95: -1 }, admin))
      .status,
    400,
  );
  checks++;
  assert.equal(
    (
      await request(
        "/assistant",
        "POST",
        { prompt: "x", context: "forged browser context" },
        admin,
      )
    ).status,
    400,
  );
  checks++;
  const evidence = await request(
    "/evidence",
    "POST",
    { report: '{"violations":[],"passes":[]}' },
    admin,
  );
  assert.equal(evidence.status, 200);
  assert.equal(evidence.data.tool, "axe-core");
  checks += 2;
  const selection = await request(
    "/maps/selection",
    "POST",
    { paths: [".env", "package.json", "src/main.ts", "private.key"] },
    admin,
  );
  assert.deepEqual(selection.data.paths, ["package.json", "src/main.ts"]);
  checks++;
  const plan = await request(
    "/plans",
    "POST",
    { name: "Private plan", discipline: 0, artifact: "private draft" },
    admin,
  );
  assert.equal(plan.status, 201);
  checks++;
  const map = await request(
    "/maps",
    "POST",
    {
      name: "Private topology",
      source: {
        kind: "upload",
        files: [
          { path: "package.json", content: '{"dependencies":{"react":"19"}}' },
        ],
      },
    },
    admin,
  );
  assert.equal(map.status, 202, JSON.stringify(map.data));
  checks++;
  const save = await request(
    "/settings/openai",
    "PUT",
    {
      version: 0,
      values: {
        OPENAI_API_KEY: "workspace-alpha-secret",
        OPENAI_MODEL: "private-model",
      },
    },
    admin,
  );
  assert.equal(save.status, 200, JSON.stringify(save.data));
  checks++;
  assert.equal(
    (await request("/settings", "GET", undefined, admin)).data.groups
      .find((x) => x.id === "openai")
      .fields.find((x) => x.key === "OPENAI_API_KEY").hasValue,
    true,
  );
  checks++;
  const row = (await db.query("SELECT * FROM workspace_settings")).rows[0];
  assert.ok(!JSON.stringify(row).includes("workspace-alpha-secret"));
  checks++;
  const create = await request(
    "/identity/users",
    "POST",
    {
      username: "test-viewer",
      displayName: "Viewer Test",
      password: "temporary password test value",
      role: "viewer",
    },
    admin,
  );
  assert.equal(create.status, 200);
  checks++;
  let viewer = await login("test-viewer", "temporary password test value");
  assert.equal(viewer.workspace.id, defaultId);
  assert.equal(viewer.workspace.role, "viewer");
  checks += 2;
  assert.equal((await request("/plans", "GET", undefined, viewer)).status, 403);
  checks++;
  const change = await request(
    "/auth/password",
    "POST",
    {
      currentPassword: "temporary password test value",
      password: "a fresh long unique passphrase",
    },
    viewer,
  );
  assert.equal(change.status, 200);
  checks++;
  assert.equal(
    (await request("/session", "GET", undefined, viewer)).status,
    401,
  );
  checks++;
  viewer = {
    ...change.data,
    cookie: change.cookie,
    csrf: change.data.csrfToken,
  };
  assert.equal(
    (await request("/plans", "GET", undefined, viewer)).data.plans.length,
    0,
  );
  checks++;
  assert.equal(
    (await request("/maps/" + map.data.id, "GET", undefined, viewer)).status,
    404,
  );
  checks++;
  assert.equal(
    (await request("/plans/" + plan.data.id, "DELETE", undefined, viewer))
      .status,
    403,
  );
  checks++;
  assert.equal(
    (await request("/auth/workspace", "POST", { id: alpha.data.id }, viewer))
      .status,
    200,
  );
  checks++;
  assert.equal(
    (await request("/plans", "GET", undefined, viewer)).data.plans.length,
    1,
  );
  checks++;
  assert.equal(
    (await request("/settings", "GET", undefined, viewer)).status,
    403,
  );
  checks++;
  assert.equal(
    (
      await request(
        "/plans",
        "POST",
        { name: "Denied", discipline: 0, artifact: "x" },
        viewer,
      )
    ).status,
    403,
  );
  checks++;
  await request(
    "/identity/members/" + viewer.user.id,
    "PUT",
    { role: "tester" },
    admin,
  );
  assert.equal(
    (
      await request(
        "/plans",
        "POST",
        { name: "Allowed", discipline: 0, artifact: "x" },
        viewer,
      )
    ).status,
    201,
  );
  checks++;
  assert.equal(
    (
      await request(
        "/assistant/cursor/agents",
        "POST",
        { prompt: "x", repository: "https://github.com/example/repo" },
        viewer,
      )
    ).status,
    403,
  );
  checks++;
  assert.equal(
    (
      await request(
        "/identity/members/" + adminId,
        "PUT",
        { role: "viewer" },
        admin,
      )
    ).status,
    409,
  );
  checks++;
  await request(
    "/identity/members/" + viewer.user.id,
    "PUT",
    { role: "admin" },
    admin,
  );
  assert.equal(
    (await request("/settings", "GET", undefined, viewer)).status,
    200,
  );
  checks++;
  assert.equal(
    (await request("/auth/sso/config", "GET", undefined, viewer)).status,
    403,
  );
  checks++;
  const beta = await request(
    "/identity/workspaces",
    "POST",
    { name: "Beta" },
    admin,
  );
  await request("/auth/workspace", "POST", { id: beta.data.id }, admin);
  assert.equal(
    (await request("/plans", "GET", undefined, admin)).data.plans.length,
    0,
  );
  checks++;
  assert.equal(
    (await request("/maps", "GET", undefined, admin)).data.maps.length,
    0,
  );
  checks++;
  assert.equal(
    (await request("/settings", "GET", undefined, admin)).data.groups
      .find((x) => x.id === "openai")
      .fields.find((x) => x.key === "OPENAI_API_KEY").hasValue,
    false,
  );
  checks++;
  assert.equal(
    (
      await request(
        "/artifacts",
        "POST",
        {
          discipline: 0,
          contractId: contract.data.id,
          selected: ["GET /health"],
        },
        admin,
      )
    ).status,
    404,
  );
  checks++;
  assert.equal(
    (
      await request(
        "/identity/members/" + viewer.user.id,
        "DELETE",
        undefined,
        admin,
      )
    ).status,
    200,
  );
  checks++; // removing a non-member is idempotent
  const runtime = await app.inject({
    url: "/settings/runtime",
    headers: {
      "x-service-token": env.SERVICE_TOKEN,
      "x-workspace-id": alpha.data.id,
    },
  });
  assert.equal(runtime.json().values.OPENAI_API_KEY, "workspace-alpha-secret");
  checks++;
  assert.equal(
    (
      await app.inject({
        url: "/settings/runtime",
        headers: { "x-service-token": env.SERVICE_TOKEN },
      })
    ).statusCode,
    403,
  );
  checks++;
  assert.equal(
    (await request("/auth/workspace", "POST", { id: beta.data.id }, viewer))
      .status,
    403,
  );
  checks++;
  await request("/auth/workspace", "POST", { id: alpha.data.id }, admin);
  await request(
    "/identity/members/" + viewer.user.id,
    "PUT",
    { role: "tester" },
    admin,
  );
  assert.equal(
    (
      await request(
        "/identity/users/" + viewer.user.id,
        "PUT",
        { disabled: true },
        admin,
      )
    ).status,
    200,
  );
  checks++;
  assert.equal(
    (await request("/session", "GET", undefined, viewer)).status,
    401,
  );
  checks++;
  assert.equal(
    (
      await request("/session", "POST", {
        username: "unknown",
        password: "wrong long passphrase",
      })
    ).status,
    401,
  );
  checks++;
  const configuration = await request(
    "/auth/sso/config",
    "PUT",
    {
      enabled: false,
      label: "Test identity provider",
      issuer: "",
      clientId: "",
      clientSecret: "temporary-idp-secret",
      domains: "example.org",
      jit: true,
    },
    admin,
  );
  assert.equal(configuration.status, 200);
  assert.equal(configuration.data.hasSecret, true);
  assert.equal(configuration.data.clientSecret, undefined);
  checks += 3;
  const encryptedSso = (await db.query("SELECT * FROM identity_configuration"))
    .rows[0];
  assert.ok(!JSON.stringify(encryptedSso).includes("temporary-idp-secret"));
  checks++;
  const methods = await request("/auth/methods");
  assert.equal(methods.data.sso.enabled, false);
  assert.equal(methods.data.sso.label, "Test identity provider");
  checks += 2;
  const callback = await bff.inject({
    url: "/api/auth/sso/callback?code=invalid&state=invalid",
  });
  assert.equal(callback.statusCode, 302);
  assert.equal(callback.headers.location, "/login?error=sso");
  assert.ok(
    !String(callback.headers["set-cookie"]).includes("vivegam_session="),
  );
  checks += 3;
  await runMigrations(db, env);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, migrations.length);
  checks++;
  await runMigrations(db, env);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM schema_migrations")).rows[0].n, migrations.length);
  checks++;
  const assessment = await request('/assessments','POST',{name:'Pre-test review',kind:'readiness',intake:{objective:'private business journey'},useAI:false},admin);
  assert.equal(assessment.status,201,JSON.stringify(assessment.data));checks++;
  assert.equal(assessment.data.report.stage,'pre-test');checks++;
  assert.equal(assessment.data.report.ai,null);checks++;
  const reportId=assessment.data.report.id;
  assert.equal((await request('/assessments/'+reportId,'GET',undefined,admin)).data.report.intake.objective,'private business journey');checks++;
  assert.ok(!JSON.stringify((await db.query('SELECT * FROM assessment_reports')).rows).includes('private business journey'));checks++;
  await request('/auth/workspace','POST',{id:beta.data.id},admin);
  assert.equal((await request('/assessments/'+reportId,'GET',undefined,admin)).status,404);checks++;
  assert.equal((await request('/assessments','GET',undefined,admin)).data.reports.length,0);checks++;
  await db.query("UPDATE schema_migrations SET checksum='invalid' WHERE id='000-core-tables'");
  await assert.rejects(() => runMigrations(db, env), /Applied migration changed/);
  checks++;
  console.log(
    `PASS: ${checks} PostgreSQL-backed identity, password, session, role and workspace isolation assertions.`,
  );
} finally {
  if (bff) await bff.close();
  if (app) await app.close();
  await db.end();
  await root.query(`DROP SCHEMA ${schema} CASCADE`);
  await root.end();
}

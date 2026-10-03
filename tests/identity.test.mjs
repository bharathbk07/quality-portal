import test from "node:test";
import assert from "node:assert/strict";
import { verify } from "@node-rs/argon2";
import { passwordHash, passwordPolicy } from "../backend/identity/store.mjs";
import { permission } from "../backend/identity/routes.mjs";
const session = (role) => ({
  workspace: { role },
  user: { mustChangePassword: false, isSuperAdmin: false },
});
test("workspace roles deny protected changes and distinguish developer agents from tester workflows", () => {
  for (const role of ["admin", "developer", "tester", "viewer"])
    assert.doesNotThrow(() => permission(session(role), "/plans", "GET"));
  for (const path of [
    "/plans",
    "/contracts",
    "/maps",
    "/assistant",
    "/evidence",
    "/artifacts",
  ])
    assert.throws(
      () => permission(session("viewer"), path, "POST"),
      (e) => e.statusCode === 403,
    );
  for (const role of ["developer", "tester", "viewer"])
    assert.throws(
      () => permission(session(role), "/settings", "GET"),
      (e) => e.statusCode === 403,
    );
  assert.doesNotThrow(() =>
    permission(session("tester"), "/assistant", "POST"),
  );
  assert.doesNotThrow(() =>
    permission(session("developer"), "/assistant/cursor/agents", "POST"),
  );
  assert.throws(
    () => permission(session("tester"), "/assistant/cursor/agents", "POST"),
    (e) => e.statusCode === 403,
  );
  assert.throws(
    () => permission(session("admin"), "/auth/sso/config", "PUT"),
    (e) => e.statusCode === 403,
  );
  const s = session("admin");
  s.user.isSuperAdmin = true;
  assert.doesNotThrow(() => permission(s, "/auth/sso/config", "PUT"));
  s.user.mustChangePassword = true;
  assert.throws(() => permission(s, "/contracts", "GET"));
  assert.doesNotThrow(() => permission(s, "/auth/password", "POST"));
});
test("passwords use salted Argon2id and a configurable passphrase policy", async () => {
  assert.throws(() => passwordPolicy("short"));
  const password = "a long unique test passphrase";
  const a = await passwordHash(password),
    b = await passwordHash(password);
  assert.match(a, /^\$argon2id\$/);
  assert.notEqual(a, b);
  assert.equal(await verify(a, password), true);
  assert.equal(await verify(a, "incorrect"), false);
});

test("backend egress policy blocks arbitrary hosts, insecure cloud connections and oversized responses", async () => {
  const { validateEgress, egressFetch } =
    await import("../backend/shared/egress.mjs");
  for (const url of [
    "http://169.254.169.254/latest/meta-data",
    "https://evil.example",
    "http://api.openai.com/v1",
    "https://user:secret@api.openai.com",
  ])
    assert.throws(() => validateEgress(url));
  assert.equal(
    validateEgress("https://api.openai.com/v1").hostname,
    "api.openai.com",
  );
  assert.throws(() => validateEgress("https://auth0.com.evil.example"));
  assert.throws(() => validateEgress("https://evil-okta.com"));
  assert.equal(
    validateEgress("https://company.okta.com").hostname,
    "company.okta.com",
  );
  let options;
  await assert.rejects(
    egressFetch(
      "https://api.openai.com",
      {},
      { RESPONSE_MAX_BYTES: "2" },
      async (url, opts) => {
        options = opts;
        return new Response("too long");
      },
    ),
    (e) => e.statusCode === 502,
  );
  assert.equal(options.redirect, "error");
});

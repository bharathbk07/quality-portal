import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { value, number } from "../services/shared/config.mjs";
import { fixture } from "../tests/fixtures/repository.mjs";
const env = Object.fromEntries(
  readFileSync(".env", "utf8")
    .split("\n")
    .filter((x) => x.includes("="))
    .map((x) => {
      const i = x.indexOf("=");
      return [x.slice(0, i), x.slice(i + 1)];
    }),
);
const base = value("services", "bff_url");
const login = await fetch(base + "/api/session", {
  method: "POST",
  headers: { "Content-Type": "application/json", origin: base },
  body: JSON.stringify({ password: env.ADMIN_PASSWORD }),
});
assert.equal(login.status, 200);
const cookie = login.headers.get("set-cookie").split(";")[0];
const headers = { cookie, "Content-Type": "application/json", origin: base };
async function submit(source, name) {
  const response = await fetch(base + "/api/maps", {
    method: "POST",
    headers,
    body: JSON.stringify({ name, source }),
  });
  const body = await response.json();
  assert.equal(response.status, 202, JSON.stringify(body));
  const deadline =
    Date.now() +
    number("repository", "repository_scan_timeout_ms") +
    number("repository", "repository_worker_poll_ms");
  while (Date.now() < deadline) {
    const r = await fetch(base + "/api/maps/" + body.id, {
      headers: { cookie },
    });
    assert.equal(r.status, 200);
    const map = await r.json();
    if (map.status === "completed") return map;
    if (map.status === "failed") throw new Error(map.error);
    await delay(number("repository", "repository_ui_poll_ms"));
  }
  throw new Error("Mapping job timed out");
}
const map = await submit(
  { kind: "upload", files: fixture },
  "Example commerce application",
);
assert.ok(map.result.nodes.some((n) => n.kind === "database"));
assert.ok(map.result.edges.some((e) => e.relation === "configured endpoint"));
assert.ok(map.result.edges.some((e) => e.relation === "source import"));
assert.match(map.result.mermaid, /^flowchart/);
assert.ok(!JSON.stringify(map).includes("SECRET_VALUE"));
const forbidden = await fetch(base + "/api/maps", {
  method: "POST",
  headers,
  body: JSON.stringify({
    name: "Invalid path test",
    source: {
      kind: "upload",
      files: [{ path: "../private.json", content: "{}" }],
    },
  }),
});
assert.equal(forbidden.status, 400);
const status = await (
  await fetch(base + "/api/assistant", { headers: { cookie } })
).json();
if (!status.configured) {
  const enrichment = await fetch(base + "/api/maps/" + map.id + "/enrich", {
    method: "POST",
    headers,
    body: "{}",
  });
  assert.equal(enrichment.status, 503);
}
const list = await (
  await fetch(base + "/api/maps", { headers: { cookie } })
).json();
assert.ok(list.maps.some((m) => m.id === map.id));
const gitUrl = process.argv[2];
if (gitUrl) {
  const remote = await submit(
    { kind: "git", url: gitUrl },
    "Git repository verification",
  );
  assert.match(remote.source.revision, /^[a-f0-9]{40,64}$/);
  assert.ok(remote.result.stats.files > 0);
  console.log(
    "PASS: live HTTPS Git import, pinned commit, background analysis and saved Mermaid.",
  );
}
console.log(
  "PASS: authenticated folder import, background worker, persisted application graph, evidence, Mermaid, path rejection and optional AI state.",
);

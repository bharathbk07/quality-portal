import * as repository from "../database/repositories/identity-sso.mjs";
import { egressFetch, validateEgress } from "../shared/egress.mjs";
import * as oidc from "openid-client";
import { randomBytes, createHash } from "node:crypto";
import {
  encryptSettings,
  decryptSettings,
  encryptionKey,
} from "../settings/store.mjs";
import { fail } from "./store.mjs";
import { number, value } from "../shared/config.mjs";
export async function migrateSso(db) {
  await repository.createIdentityConfiguration(db);
}
export function registerSso(app, db, env, identity) {
  const key = encryptionKey(env),
    id = "enterprise-sso";
  const callback =
    value("identity", "auth_public_url", env).replace(/\/$/, "") +
    "/api/auth/sso/callback";
  async function load() {
    const row = (
      await repository.selectIdentityConfiguration(db, [id])
    ).rows[0];
    return row ? decryptSettings(row, key) : {};
  }
  function publicFields(c) {
    return {
      enabled: c.enabled === true,
      label: c.label || "Enterprise SSO",
      issuer: c.issuer || "",
      clientId: c.clientId || "",
      hasSecret: Boolean(c.clientSecret),
      domains: c.domains || "",
      jit: c.jit === true,
      callbackUrl: callback,
    };
  }
  async function client(c) {
    if (!c.enabled || !c.issuer || !c.clientId || !c.clientSecret)
      throw fail("Enterprise SSO is not configured", 503);
    return oidc.discovery(
      new URL(c.issuer),
      c.clientId,
      { client_secret: c.clientSecret },
      oidc.ClientSecretBasic(c.clientSecret),
      {
        timeout: number("timeouts", "service_ms", env) / 1000,
        execute: [oidc.enableNonRepudiationChecks],
        [oidc.customFetch]: (url, opts) => egressFetch(url, opts, env),
      },
    );
  }
  app.get("/auth/methods", async () => {
    const c = await load();
    return {
      local: true,
      sso: {
        enabled: Boolean(c.enabled && c.issuer && c.clientId && c.clientSecret),
        label: c.label || "Enterprise SSO",
      },
      passwordMinChars: number("identity", "password_min_chars", env),
    };
  });
  app.get("/auth/sso/config", async () => publicFields(await load()));
  app.put(
    "/auth/sso/config",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "enabled",
            "label",
            "issuer",
            "clientId",
            "domains",
            "jit",
          ],
          properties: {
            enabled: { type: "boolean" },
            label: { type: "string", maxLength: 120 },
            issuer: { type: "string", maxLength: 2048 },
            clientId: { type: "string", maxLength: 2048 },
            clientSecret: { type: "string", maxLength: 8192 },
            domains: { type: "string", maxLength: 2048 },
            jit: { type: "boolean" },
          },
        },
      },
    },
    async (req) => {
      const c = { ...(await load()), ...req.body };
      c.domains = c.domains
        .toLowerCase()
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean)
        .join(",");
      if (c.enabled) {
        let url;
        try {
          url = new URL(c.issuer);
        } catch {
          throw fail("Enter a valid OIDC issuer URL");
        }
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash
        )
          throw fail(
            "OIDC issuer must use HTTPS without credentials, query or fragment",
          );
        validateEgress(c.issuer, env);
        if (!c.clientId || !c.clientSecret)
          throw fail("Client ID and client secret are required");
        if (c.jit && !c.domains)
          throw fail(
            "Specify allowed email domains before enabling automatic enrollment",
          );
        if (
          c.domains.split(",").some((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(d))
        )
          throw fail("Enter comma-separated email domains");
        await client(c);
      }
      const e = encryptSettings(id, c, key);
      await repository.insertIdentityConfiguration(db, [id, e.ciphertext, e.iv, e.tag]);
      await identity.audit(
        { id: req.identity.user.id, workspace_id: req.workspaceId },
        "sso.configuration.changed",
        { enabled: c.enabled },
      );
      return publicFields(c);
    },
  );
  app.get("/auth/sso/start", async () => {
    const c = await load(),
      config = await client(c),
      verifier = oidc.randomPKCECodeVerifier(),
      state = oidc.randomState(),
      nonce = oidc.randomNonce(),
      flow = randomBytes(32).toString("base64url");
    const challenge = await oidc.calculatePKCECodeChallenge(verifier),
      encrypted = encryptSettings(
        flow,
        { verifier, nonce, issuer: c.issuer, clientId: c.clientId },
        key,
      );
    await repository.deleteSsoFlows(db);
    await repository.insertSsoFlows(db, [
        createHash("sha256").update(flow).digest("hex"),
        state,
        JSON.stringify(encrypted),
        number("identity", "sso_flow_seconds", env),
      ]);
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: callback,
      scope: "openid profile email",
      state,
      nonce,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    validateEgress(authorizationUrl.href, env);
    if (authorizationUrl.protocol !== "https:")
      throw fail("SSO authorization requires HTTPS", 503);
    return { flow, url: authorizationUrl.href };
  });
  app.post("/auth/sso/callback", async (req) => {
    const { flow, url } = req.body || {};
    if (
      typeof flow !== "string" ||
      flow.length > 128 ||
      typeof url !== "string" ||
      url.length > 8192
    )
      throw fail("Invalid SSO transaction", 401);
    const row = (
      await repository.deleteSsoFlows2(db, [createHash("sha256").update(flow).digest("hex")])
    ).rows[0];
    if (!row) throw fail("SSO transaction expired. Start again.", 401);
    const transaction = decryptSettings({ id: flow, ...row.payload }, key),
      c = await load();
    if (c.issuer !== transaction.issuer || c.clientId !== transaction.clientId)
      throw fail("SSO configuration changed. Start again.", 401);
    const incoming = new URL(url),
      expected = new URL(callback);
    if (
      incoming.origin !== expected.origin ||
      incoming.pathname !== expected.pathname
    )
      throw fail("Invalid SSO callback", 401);
    let claims;
    try {
      const tokens = await oidc.authorizationCodeGrant(
        await client(c),
        incoming,
        {
          pkceCodeVerifier: transaction.verifier,
          expectedState: row.state,
          expectedNonce: transaction.nonce,
          idTokenExpected: true,
        },
      );
      claims = tokens.claims();
    } catch {
      throw fail(
        "Enterprise sign-in failed. Start again or contact your administrator.",
        401,
      );
    }
    if (!claims?.sub) throw fail("SSO identity is missing", 401);
    let u = (
      await repository.selectUsers(db, [
        claims.iss,
        claims.sub,
      ])
    ).rows[0];
    if (!u) {
      const email =
        typeof claims.email === "string" ? claims.email.toLowerCase() : "";
      if (
        !c.jit ||
        claims.email_verified !== true ||
        !c.domains.split(",").includes(email.split("@")[1])
      )
        throw fail(
          "Your organization has not allowed this identity to enroll",
          403,
        );
      const uuid = (await import("node:crypto")).randomUUID();
      const username =
        "sso-" +
        createHash("sha256")
          .update(claims.iss + "\0" + claims.sub)
          .digest("hex");
      const client = await db.connect();
      try {
        await repository.beginTransaction(client);
        const result = await repository.insertUsers(client, [
            uuid,
            username,
            String(claims.name || email).slice(
              0,
              number("identity", "name_max_chars", env),
            ),
            claims.iss,
            claims.sub,
          ]);
        u = result.rows[0];
        await repository.insertWorkspaceMembers(client, [u.id]);
        await repository.commitTransaction(client);
      } catch (e) {
        await repository.rollbackTransaction(client);
        throw e;
      } finally {
        client.release();
      }
    }
    if (u.disabled) throw fail("Account access has been disabled", 403);
    await identity.audit(u, "sso.login.succeeded");
    return identity.session(u.id, "oidc");
  });
}

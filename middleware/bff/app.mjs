import { assessmentSchema } from "../../backend/assessment/schema.mjs";
import { settingsBody } from "../../backend/settings/catalog.mjs";
import { mapInputSchema } from "../../backend/mapping/schema.mjs";
import { value, number, publicConfig } from "../../backend/shared/config.mjs";
import cookie from "@fastify/cookie";
import { createHmac } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import {
  createService,
  callService,
  equal,
} from "../../backend/shared/http.mjs";
export async function buildBff({
  env = process.env,
  serviceCaller = callService,
  ...options
} = {}) {
  if (!env.SESSION_SECRET) throw new Error("SESSION_SECRET is required");
  const publicUrl = new URL(value("identity", "auth_public_url", env));
  if (
    !["http:", "https:"].includes(publicUrl.protocol) ||
    publicUrl.username ||
    publicUrl.password ||
    publicUrl.search ||
    publicUrl.hash
  )
    throw new Error("AUTH_PUBLIC_URL must be an HTTP(S) origin");
  if (
    publicUrl.protocol === "http:" &&
    !["localhost", "127.0.0.1", "[::1]"].includes(publicUrl.hostname)
  )
    throw new Error("Public deployments require HTTPS");
  if (
    publicUrl.protocol === "https:" &&
    value("security", "cookie_secure", env) !== "true"
  )
    throw new Error("HTTPS deployments require COOKIE_SECURE=true");
  const app = createService("bff", { ...options, internal: false });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: number("security", "rate_limit_max", env),
    timeWindow: number("security", "rate_limit_window_ms", env),
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Vivegam BFF API", version: "1.0.0" },
      components: {
        securitySchemes: {
          session: { type: "apiKey", in: "cookie", name: "vivegam_session" },
        },
      },
      security: [{ session: [] }],
    },
  });
  const core = (path, req, body, method = "GET") =>
    serviceCaller(value("services", "core_url", env), path, {
      method,
      body,
      requestId: req.id,
      token: env.SERVICE_TOKEN,
      sessionToken: req.cookies.vivegam_session,
    });
  const csrf = (token) =>
    createHmac("sha256", env.SESSION_SECRET).update(token).digest("base64url");
  const cookieOptions = {
    httpOnly: true,
    sameSite: "lax",
    secure: value("security", "cookie_secure", env) === "true",
    path: "/",
    maxAge: number("security", "session_ttl_seconds", env),
  };
  function establish(data, reply) {
    const { token, ...session } = data;
    reply.setCookie("vivegam_session", token, cookieOptions);
    return { ...session, csrfToken: csrf(token) };
  }
  app.addHook("onRequest", async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    reply.header("X-Content-Type-Options", "nosniff");
    const path = req.url.split("?")[0];
    if (path.startsWith("/health/") || path === "/metrics") return;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const allowed = value("security", "public_origins", env)
        .split(",")
        .map((x) => x.trim());
      if (req.headers.origin && !allowed.includes(req.headers.origin))
        return reply.code(403).send({ error: "Origin is not allowed" });
      if (
        ["POST", "PUT", "PATCH"].includes(req.method) &&
        req.headers["content-type"]?.split(";")[0] !== "application/json"
      )
        return reply.code(415).send({ error: "Use application/json" });
    }
    if (
      [
        "/api/config",
        "/api/auth/methods",
        "/api/auth/sso/start",
        "/api/auth/sso/callback",
      ].includes(path) ||
      (path === "/api/session" && req.method === "POST")
    )
      return;
    if (!req.cookies.vivegam_session)
      return reply.code(401).send({ error: "Sign in to your workspace" });
    if (
      !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      !equal(req.headers["x-csrf-token"], csrf(req.cookies.vivegam_session))
    )
      return reply
        .code(403)
        .send({ error: "Refresh your session before making changes" });
    await core("/auth/session", req);
  });
  app.post(
    "/api/session",
    {
      config: {
        rateLimit: {
          max: number("security", "login_rate_limit_max", env),
          timeWindow: number("security", "rate_limit_window_ms", env),
        },
      },
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          additionalProperties: false,
          properties: {
            username: {
              type: "string",
              minLength: 1,
              maxLength: number("identity", "name_max_chars", env),
            },
            password: {
              type: "string",
              minLength: 1,
              maxLength: number("validation", "password_max_chars", env),
            },
          },
        },
      },
    },
    async (req, reply) =>
      establish(await core("/auth/login", req, req.body, "POST"), reply),
  );
  app.get("/api/config", async () => publicConfig(env));
  app.get("/api/auth/methods", (req) => core("/auth/methods", req));
  app.get("/api/session", async (req) => ({
    ...(await core("/auth/session", req)),
    csrfToken: csrf(req.cookies.vivegam_session),
  }));
  app.delete("/api/session", async (req, reply) => {
    await core("/auth/logout", req, {}, "POST");
    reply.clearCookie("vivegam_session", { path: "/" });
    return { authenticated: false };
  });
  app.post(
    "/api/auth/password",
    {
      config: {
        rateLimit: {
          max: number("security", "login_rate_limit_max", env),
          timeWindow: number("security", "rate_limit_window_ms", env),
        },
      },
    },
    async (req, reply) =>
      establish(await core("/auth/password", req, req.body, "POST"), reply),
  );
  app.post("/api/auth/workspace", async (req) => ({
    ...(await core("/auth/workspace", req, req.body, "POST")),
    csrfToken: csrf(req.cookies.vivegam_session),
  }));
  app.get(
    "/api/auth/sso/start",
    {
      config: {
        rateLimit: {
          max: number("security", "login_rate_limit_max", env),
          timeWindow: number("security", "rate_limit_window_ms", env),
        },
      },
    },
    async (req, reply) => {
      const result = await core("/auth/sso/start", req);
      reply.setCookie("vivegam_sso_flow", result.flow, {
        ...cookieOptions,
        path: "/api/auth/sso",
        maxAge: number("identity", "sso_flow_seconds", env),
      });
      return reply.redirect(result.url);
    },
  );
  app.get("/api/auth/sso/callback", async (req, reply) => {
    reply.clearCookie("vivegam_sso_flow", { path: "/api/auth/sso" });
    try {
      const url =
        value("identity", "auth_public_url", env).replace(/\/$/, "") + req.url;
      establish(
        await core(
          "/auth/sso/callback",
          req,
          { flow: req.cookies.vivegam_sso_flow, url },
          "POST",
        ),
        reply,
      );
      return reply.redirect("/");
    } catch {
      return reply.redirect("/login?error=sso");
    }
  });
  const bodies = {
    "/assessments": assessmentSchema(env),
    "/settings/:id": settingsBody,
    "/maps/:id/enrich": {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    "/maps": mapInputSchema(env),
    "/assistant/test": {
      type: "object",
      required: ["provider"],
      additionalProperties: false,
      properties: {
        provider: {
          type: "string",
          enum: [
            "openai",
            "google",
            "claude",
            "lmstudio",
            "ollama",
            "compatible",
            "cursor",
          ],
        },
      },
    },
    "/assistant/cursor/agents": {
      type: "object",
      required: ["prompt", "repository"],
      additionalProperties: false,
      properties: {
        prompt: {
          type: "string",
          minLength: 1,
          maxLength: number("public", "ai_prompt_max_chars"),
        },
        repository: {
          type: "string",
          maxLength: number("validation", "endpoint_max_chars"),
        },
        ref: {
          type: "string",
          maxLength: number("repository", "repository_max_path_chars"),
        },
      },
    },
    "/assistant": {
      type: "object",
      required: ["prompt", "selected", "scope"],
      additionalProperties: false,
      properties: {
        provider: {
          type: "string",
          enum: [
            "openai",
            "google",
            "claude",
            "lmstudio",
            "ollama",
            "compatible",
          ],
        },
        prompt: {
          type: "string",
          maxLength: number("public", "ai_prompt_max_chars", env),
        },
        contractId: { type: "string", format: "uuid" },
        selected: {
          type: "array",
          uniqueItems: true,
          maxItems: number("public", "max_operations", env),
          items: {
            type: "string",
            maxLength: number("validation", "endpoint_max_chars", env),
          },
        },
        scope: {
          type: "string",
          maxLength: number("identity", "name_max_chars", env),
        },
        evidence: {
          type: "string",
          maxLength: number("public", "ai_context_max_chars", env),
        },
      },
    },
    "/contracts": {
      type: "object",
      required: ["spec"],
      additionalProperties: false,
      properties: {
        spec: {
          type: "string",
          minLength: 1,
          maxLength: number("public", "contract_max_bytes"),
        },
      },
    },
    "/plans": {
      type: "object",
      required: ["discipline", "artifact"],
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: number("validation", "plan_name_max_chars"),
        },
        contractId: { type: "string", format: "uuid" },
        discipline: { type: "integer", minimum: 0, maximum: 5 },
        artifact: {
          type: "string",
          minLength: 1,
          maxLength: number("validation", "artifact_max_chars"),
        },
      },
    },
    "/artifacts": {
      type: "object",
      required: ["discipline"],
      additionalProperties: false,
      properties: {
        discipline: { type: "integer", minimum: 0, maximum: 5 },
        contractId: { type: "string", format: "uuid" },
        selected: {
          type: "array",
          items: { type: "string" },
          maxItems: number("public", "max_operations"),
        },
        p95: {
          type: "integer",
          minimum: 1,
          maximum: number("public", "max_p95_ms"),
        },
        vus: {
          type: "integer",
          minimum: 1,
          maximum: number("public", "max_virtual_users"),
        },
      },
    },
    "/evidence": {
      type: "object",
      required: ["report"],
      additionalProperties: false,
      properties: {
        report: {
          type: "string",
          maxLength: number("public", "evidence_max_bytes"),
        },
      },
    },
  };
  const routes = [
    ["GET", "/assessments/catalog"],
    ["GET", "/assessments"],
    ["POST", "/assessments"],
    ["GET", "/assessments/:id"],
    ["GET", "/toolkits"],
    ["POST", "/maps/selection"],
    ["GET", "/connections"],
    ["GET", "/identity/workspaces"],
    ["POST", "/identity/workspaces"],
    ["POST", "/identity/lookup"],
    ["GET", "/identity/members"],
    ["PUT", "/identity/members/:id"],
    ["DELETE", "/identity/members/:id"],
    ["GET", "/identity/users"],
    ["POST", "/identity/users"],
    ["PUT", "/identity/users/:id"],
    ["GET", "/identity/audit"],
    ["GET", "/auth/sso/config"],
    ["PUT", "/auth/sso/config"],
    ["GET", "/settings"],
    ["PUT", "/settings/:id"],
    ["GET", "/maps/config"],
    ["GET", "/maps"],
    ["POST", "/maps"],
    ["GET", "/maps/:id"],
    ["DELETE", "/maps/:id"],
    ["POST", "/maps/:id/regenerate"],
    ["GET", "/maps/:id/studio"],
    ["GET", "/maps/:id/export"],
    ["GET", "/maps/:id/compare"],
    ["GET", "/maps/:id/impact"],
    ["POST", "/maps/:id/revisions"],
    ["POST", "/maps/:id/simulate"],
    ["POST", "/maps/:id/knowledge"],
    ["POST", "/maps/:id/documentation"],
    ["POST", "/maps/:id/audit"],
    ["POST", "/maps/:id/grouping"],
    ["POST", "/maps/:id/cost"],
    ["POST", "/maps/:id/enrich"],
    ["POST", "/assistant/test"],
    ["POST", "/assistant/cursor/agents"],
    ["GET", "/assistant/cursor/agents/:id"],
    ["GET", "/assistant"],
    ["POST", "/assistant"],
    ["GET", "/contracts"],
    ["POST", "/contracts"],
    ["GET", "/plans"],
    ["POST", "/plans"],
    ["DELETE", "/plans/:id"],
    ["POST", "/artifacts"],
    ["POST", "/evidence"],
    ["GET", "/tools"],
    ["GET", "/tools/prometheus/summary"],
    ["GET", "/tools/jaeger/services"],
  ];
  for (const [method, path] of routes)
    app.route({
      method,
      url: "/api" + path,
      schema: {
        tags: [path.split("/")[1]],
        summary: method + " " + path,
        ...(["POST", "PUT"].includes(method) && bodies[path]
          ? { body: bodies[path] }
          : {}),
      },
      handler: async (req, reply) => {
        let route = path.includes(":id")
          ? path.replace(":id", encodeURIComponent(req.params.id))
          : path;
        if (
          [
            "/maps/:id",
            "/maps/:id/studio",
            "/maps/:id/impact",
            "/maps/:id/export",
            "/maps/:id/compare",
          ].includes(path) &&
          Object.keys(req.query || {}).length
        )
          route += "?" + new URLSearchParams(req.query).toString();
        if (path.startsWith("/settings"))
          reply.header("Cache-Control", "no-store");
        const data = await serviceCaller(
          value("services", "core_url", env),
          route,
          {
            method,
            body: req.body,
            requestId: req.id,
            token: env.SERVICE_TOKEN,
            sessionToken: req.cookies.vivegam_session,
          },
        );
        if (
          method === "POST" &&
          ["/contracts", "/plans", "/assessments"].includes(path)
        )
          reply.code(201);
        if (method === "POST" && path === "/maps") reply.code(202);
        return data;
      },
    });
  app.get("/api/openapi.json", async () => app.swagger());
  await app.register(swaggerUI, { routePrefix: "/api/docs" });
  return app;
}

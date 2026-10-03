import {settingsBody} from "../settings/catalog.mjs";
import { mapInputSchema } from "../mapping/schema.mjs";
import { value, number, publicConfig } from "../shared/config.mjs";
import cookie from "@fastify/cookie";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import swagger from "@fastify/swagger";
import swaggerUI from "@fastify/swagger-ui";
import { createService, callService, equal } from "../shared/http.mjs";
export async function buildBff({ env = process.env, ...options } = {}) {
  if (!env.SESSION_SECRET || !env.ADMIN_PASSWORD)
    throw new Error("SESSION_SECRET and ADMIN_PASSWORD are required");
  const app = createService("bff", { ...options, internal: false });
  await app.register(cookie);
  await app.register(jwt, {
    secret: env.SESSION_SECRET,
    cookie: { cookieName: "vivegam_session", signed: false },
  });
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
  app.addHook("onRequest", async (req, reply) => {
    if (req.url.startsWith("/health/") || req.url === "/metrics") return;
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed = value("security", "public_origins", env).split(",");
      if (origin && !allowed.includes(origin))
        return reply.code(403).send({ error: "Origin is not allowed" });
      if (
        ["POST", "PUT", "PATCH"].includes(req.method) &&
        req.headers["content-type"]?.split(";")[0] !== "application/json"
      )
        return reply.code(415).send({ error: "Use application/json" });
    }
    if (
      req.url === "/api/config" ||
      (req.url === "/api/session" && req.method === "POST")
    )
      return;
    try {
      await req.jwtVerify({ onlyCookie: true });
    } catch {
      return reply.code(401).send({ error: "Sign in to your workspace" });
    }
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
          required: ["password"],
          additionalProperties: false,
          properties: {
            password: {
              type: "string",
              minLength: 1,
              maxLength: number("validation", "password_max_chars"),
            },
          },
        },
      },
    },
    async (req, reply) => {
      if (!equal(req.body.password, env.ADMIN_PASSWORD))
        return reply.code(401).send({ error: "Incorrect workspace password" });
      const token = app.jwt.sign(
        { sub: "workspace-admin" },
        { expiresIn: number("security", "session_ttl_seconds", env) },
      );
      reply.setCookie("vivegam_session", token, {
        httpOnly: true,
        sameSite: "strict",
        secure: value("security", "cookie_secure", env) === "true",
        path: "/",
        maxAge: number("security", "session_ttl_seconds", env),
      });
      return { authenticated: true };
    },
  );
  app.get("/api/config", async () => publicConfig(env));
  app.get("/api/session", async () => ({
    authenticated: true,
    user: "Workspace administrator",
  }));
  app.delete("/api/session", async (_req, reply) => {
    reply.clearCookie("vivegam_session", { path: "/" });
    return { authenticated: false };
  });
  const bodies = {
    "/settings/:id":settingsBody,
    "/maps/:id/enrich": {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    "/maps": mapInputSchema(env),
    "/assistant/test": {type:"object",required:["provider"],additionalProperties:false,properties:{provider:{type:"string",enum:["openai","google","claude","lmstudio","ollama","compatible","cursor"]}}},
    "/assistant/cursor/agents": {type:"object",required:["prompt","repository"],additionalProperties:false,properties:{prompt:{type:"string",minLength:1,maxLength:number("public","ai_prompt_max_chars")},repository:{type:"string",maxLength:number("validation","endpoint_max_chars")},ref:{type:"string",maxLength:number("repository","repository_max_path_chars")}}},
    "/assistant": {
      type: "object",
      required: ["prompt", "context"],
      additionalProperties: false,
      properties: {
        provider: {type: "string", enum: ["openai","google","claude","lmstudio","ollama","compatible"]},
        prompt: {
          type: "string",
          minLength: 1,
          maxLength: number("public", "ai_prompt_max_chars"),
        },
        context: {
          type: "string",
          maxLength: number("public", "ai_context_max_chars"),
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
      required: ["name", "discipline", "artifact"],
      additionalProperties: false,
      properties: {
        name: {
          type: "string",
          minLength: 1,
          maxLength: number("validation", "plan_name_max_chars"),
        },
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
    ["GET", "/settings"],
    ["PUT", "/settings/:id"],
    ["GET", "/maps/config"],
    ["GET", "/maps"],
    ["POST", "/maps"],
    ["GET", "/maps/:id"],
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
        ...(["POST","PUT"].includes(method) ? { body: bodies[path] } : {}),
      },
      handler: async (req, reply) => {
        const route = path.includes(":id")
          ? path.replace(":id", encodeURIComponent(req.params.id))
          : path;
        if(path.startsWith("/settings"))reply.header("Cache-Control","no-store");
        const data = await callService(
          value("services", "core_url", env),
          route,
          {
            method,
            body: req.body,
            requestId: req.id,
            token: env.SERVICE_TOKEN,
          },
        );
        if (method === "POST" && ["/contracts", "/plans"].includes(path))
          reply.code(201);
        if (method === "POST" && path === "/maps") reply.code(202);
        return data;
      },
    });
  app.get("/api/openapi.json", async () => app.swagger());
  await app.register(swaggerUI, { routePrefix: "/api/docs" });
  return app;
}

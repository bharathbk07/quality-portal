import { egressFetch } from "../../shared/egress.mjs";
import { registerAiRoutes } from "./ai.mjs";
import { readGitRepository } from "../../mapping/git-reader.mjs";
import { mappingConfig } from "../../mapping/config.mjs";
import { number, value } from "../../shared/config.mjs";
import { createService, callService } from "../../shared/http.mjs";
export function buildIntegration({
  env = process.env,
  fetcher = fetch,
  ...options
} = {}) {
  const app = createService("integration", options);
  registerAiRoutes(app, { env, fetcher });
  async function connectionEnv(req) {
    const result = await callService(
      value("services", "settings_service_url", env),
      "/settings/runtime",
      { token: env.SERVICE_TOKEN, workspaceId: req.headers["x-workspace-id"] },
    );
    return { ...env, ...result.values };
  }
  app.get("/tools", async (req) => {
    const settings = await connectionEnv(req);
    return {
      tools: [
        {
          id: "prometheus",
          configured: Boolean(settings.PROMETHEUS_URL),
          mode: "read-only API",
        },
        {
          id: "jaeger",
          configured: Boolean(settings.JAEGER_URL),
          mode: "read-only API",
        },
        { id: "k6", configured: true, mode: "artifact export + result import" },
        {
          id: "playwright",
          configured: true,
          mode: "artifact export + result import",
        },
        {
          id: "axe-core",
          configured: true,
          mode: "artifact export + result import",
        },
        {
          id: "lighthouse",
          configured: true,
          mode: "execution guide + result import",
        },
        {
          id: "litmuschaos",
          configured: true,
          mode: "reviewed experiment brief",
        },
        { id: "jmeter", configured: true, mode: "existing JMX suite guidance" },
      ],
    };
  });
  async function external(req, key, path) {
    const settings = await connectionEnv(req);
    const base = settings[key];
    if (!base) {
      const e = new Error("Adapter endpoint is not configured");
      e.statusCode = 503;
      throw e;
    }
    const response = await egressFetch(
      base.replace(/\/$/, "") + path,
      {
        signal: AbortSignal.timeout(number("timeouts", "telemetry_ms", env)),
        redirect: "error",
        headers: settings.TELEMETRY_BEARER_TOKEN
          ? { Authorization: "Bearer " + settings.TELEMETRY_BEARER_TOKEN }
          : {},
      },
      env,
      fetcher,
    );
    if (!response.ok)
      throw new Error("Telemetry upstream returned " + response.status);
    const raw = await response.text();
    if (raw.length > number("public", "evidence_max_bytes", env))
      throw new Error("Telemetry response is too large");
    return JSON.parse(raw);
  }
  app.get("/tools/prometheus/summary", async (req) =>
    external(
      req,
      "PROMETHEUS_URL",
      "/api/v1/query?query=" +
        encodeURIComponent("sum(rate(http_requests_total[5m]))"),
    ),
  );
  app.get("/tools/jaeger/services", async (req) =>
    external(req, "JAEGER_URL", "/api/services"),
  );
  app.post(
    "/repositories/read",
    {
      schema: {
        body: {
          type: "object",
          required: ["kind", "url"],
          additionalProperties: false,
          properties: {
            kind: { const: "git" },
            scope: {type:"string",enum:["single-service","multiple-services","system","unknown"]},
            paths: {type:"array",maxItems:20,items:{type:"string",minLength:1,maxLength:number("repository","repository_max_path_chars",env)}},
            url: {
              type: "string",
              minLength: 1,
              maxLength: number("repository", "repository_max_path_chars", env),
            },
            ref: {
              type: "string",
              maxLength: number("repository", "repository_max_path_chars", env),
            },
          },
        },
      },
    },
    async (req, reply) => {
      try {
        const settings = await connectionEnv(req);
        return await readGitRepository(
          req.body,
          mappingConfig(settings),
          settings,
        );
      } catch (error) {
        return reply.code(422).send({ error: error.message });
      }
    },
  );
  return app;
}

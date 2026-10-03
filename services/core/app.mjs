import {registerSettingsRoutes} from "../settings/store.mjs";
import { registerMapRoutes } from "../mapping/routes.mjs";
import { value, number, publicConfig } from "../shared/config.mjs";
import { randomUUID } from "node:crypto";
import { createService, callService } from "../shared/http.mjs";
import {
  parseContract,
  artifactFor,
  parseEvidence,
  toolkits,
} from "../../lib/quality.ts";
export function buildCore({ db, cache, env = process.env, ...options }) {
  const app = createService("core", options);
  registerSettingsRoutes(app,db,env,cache);
  const upstream = (path, opts) =>
    callService(value("services", "integration_url", env), path, opts);
  app.get("/health/ready", async () => {
    await db.query("SELECT 1");
    await cache.ping();
    return { status: "ready" };
  });
  app.post('/assistant/test',async req=>upstream('/ai/test',{method:'POST',body:req.body,requestId:req.id}));
  app.post('/assistant/cursor/agents',async req=>upstream('/ai/cursor/agents',{method:'POST',body:req.body,requestId:req.id}));
  app.get('/assistant/cursor/agents/:id',async req=>upstream('/ai/cursor/agents/'+encodeURIComponent(req.params.id)));
  app.get("/assistant", async () => upstream("/ai/status"));
  app.post(
    "/assistant",
    {
      schema: {
        body: {
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
      },
    },
    async (req) =>
      upstream("/ai/generate", {
        method: "POST",
        body: req.body,
        requestId: req.id,
      }),
  );
  app.get("/contracts", async () => ({
    contracts: (
      await db.query(
        "SELECT id,title,document,created_at FROM contracts ORDER BY created_at DESC LIMIT $1",
        [number("storage", "contract_list_limit")],
      )
    ).rows,
  }));
  app.post(
    "/contracts",
    {
      schema: {
        body: {
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
      },
    },
    async (req, reply) => {
      let parsed;
      try {
        parsed = parseContract(req.body.spec, publicConfig());
      } catch (e) {
        return reply.code(400).send({ error: e.message });
      }
      const id = randomUUID();
      await db.query(
        "INSERT INTO contracts(id,title,document) VALUES($1,$2,$3)",
        [id, parsed.title, JSON.stringify(parsed)],
      );
      return reply.code(201).send({ id, contract: parsed });
    },
  );
  app.get("/plans", async () => ({
    plans: (
      await db.query(
        "SELECT id,name,discipline,artifact,created_at AS created FROM plans ORDER BY created_at DESC LIMIT $1",
        [number("storage", "plan_list_limit")],
      )
    ).rows,
  }));
  app.post(
    "/plans",
    {
      schema: {
        body: {
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
      },
    },
    async (req, reply) => {
      const id = randomUUID();
      const { name, discipline, artifact } = req.body;
      const c = await db.connect();
      try {
        await c.query("BEGIN");
        const result = await c.query(
          "INSERT INTO plans(id,name,discipline,artifact) VALUES($1,$2,$3,$4) RETURNING id,name,discipline,artifact,created_at AS created",
          [id, name, discipline, artifact],
        );
        await c.query(
          "INSERT INTO audit_events(action,entity_id) VALUES($1,$2)",
          ["plan.created", id],
        );
        await c.query("COMMIT");
        return reply.code(201).send(result.rows[0]);
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
  );
  app.delete(
    "/plans/:id",
    {
      schema: {
        params: {
          type: "object",
          properties: { id: { type: "string", format: "uuid" } },
          required: ["id"],
        },
      },
    },
    async (req, reply) => {
      const result = await db.query(
        "DELETE FROM plans WHERE id=$1 RETURNING id",
        [req.params.id],
      );
      return result.rowCount
        ? { deleted: true }
        : reply.code(404).send({ error: "Plan not found" });
    },
  );
  app.post(
    "/artifacts",
    {
      schema: {
        body: {
          type: "object",
          required: ["discipline"],
          additionalProperties: false,
          properties: {
            discipline: { type: "integer", minimum: 0, maximum: 5 },
            contractId: { type: "string", format: "uuid" },
            selected: {
              type: "array",
              items: {
                type: "string",
                maxLength: number("validation", "endpoint_max_chars"),
              },
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
      },
    },
    async (req, reply) => {
      const b = req.body;
      let contract = null;
      if (b.contractId) {
        const r = await db.query("SELECT document FROM contracts WHERE id=$1", [
          b.contractId,
        ]);
        if (!r.rows.length)
          return reply.code(404).send({ error: "Contract not found" });
        contract = r.rows[0].document;
      }
      return {
        filename: toolkits[b.discipline].artifact,
        content: artifactFor(
          b.discipline,
          contract,
          b.selected || [],
          "",
          b.p95 ?? number("public", "default_p95_ms"),
          b.vus ?? number("public", "default_virtual_users"),
          publicConfig(),
        ),
        status: "draft",
      };
    },
  );
  app.post(
    "/evidence",
    {
      schema: {
        body: {
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
      },
    },
    async (req, reply) => {
      try {
        return parseEvidence(req.body.report, publicConfig());
      } catch (e) {
        return reply.code(400).send({ error: e.message });
      }
    },
  );
  app.get("/tools", async () => upstream("/tools"));
  for (const path of ["/tools/prometheus/summary", "/tools/jaeger/services"])
    app.get(path, async () => {
      const key = "adapter:" + path;
      try {
        const cached = await cache.get(key);
        if (cached) return { ...JSON.parse(cached), cached: true };
      } catch {}
      const data = await upstream(path);
      try {
        await cache.set(key, JSON.stringify(data), {
          EX: number("storage", "telemetry_cache_seconds", env),
        });
      } catch {}
      return { ...data, cached: false };
    });
  registerMapRoutes(app, { db, upstream, env });
  return app;
}

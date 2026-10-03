import {registerAssessment} from "../assessment/routes.mjs";
import { renderPrompt } from "../shared/prompts.mjs";
import * as repository from "../database/repositories/core.mjs";
import { validateGitUrl } from "../mapping/git-reader.mjs";
import { mappingConfig } from "../mapping/config.mjs";
import { registerIdentity } from "../identity/routes.mjs";
import { registerSso } from "../identity/sso.mjs";
import { registerSettingsRoutes } from "../settings/store.mjs";
import { registerMapRoutes } from "../mapping/routes.mjs";
import { value, number, publicConfig } from "../shared/config.mjs";
import { randomUUID } from "node:crypto";
import { createService, callService } from "../shared/http.mjs";
import {
  parseContract,
  artifactFor,
  parseEvidence,
  toolkits,
  exampleSpec,
} from "./quality.ts";
export function buildCore({ db, cache, env = process.env, ...options }) {
  const app = createService("core", options);
  const identity = registerIdentity(app, db, env);
  registerSso(app, db, env, identity);
  registerSettingsRoutes(app, db, env, cache);
  const upstream = (path, opts) =>
    callService(value("services", "integration_url", env), path, opts);
  registerAssessment(app,{db,upstream,env});
  app.get("/toolkits", async () => ({ toolkits, exampleSpec }));
  app.get("/health/ready", async () => {
    await repository.selectTransaction(db);
    await cache.ping();
    return { status: "ready" };
  });
  app.post(
    "/assistant/test",
    {
      schema: {
        body: {
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
      },
    },
    async (req) =>
      upstream("/ai/test", {
        method: "POST",
        body: req.body,
        requestId: req.id,
        workspaceId: req.workspaceId,
      }),
  );
  app.post(
    "/assistant/cursor/agents",
    {
      schema: {
        body: {
          type: "object",
          required: ["prompt", "repository"],
          additionalProperties: false,
          properties: {
            prompt: {
              type: "string",
              minLength: 1,
              maxLength: number("public", "ai_prompt_max_chars", env),
            },
            repository: {
              type: "string",
              minLength: 1,
              maxLength: number("validation", "endpoint_max_chars", env),
            },
            ref: {
              type: "string",
              maxLength: number("repository", "repository_max_path_chars", env),
            },
          },
        },
      },
    },
    async (req) => {
      try {
        validateGitUrl(req.body.repository, mappingConfig(env));
      } catch (e) {
        throw Object.assign(e, { statusCode: 400 });
      }
      const result = await upstream("/ai/cursor/agents", {
        method: "POST",
        body: req.body,
        requestId: req.id,
        workspaceId: req.workspaceId,
      });
      const id = result.agent?.id || result.id;
      if (!id) throw new Error("Agent ID is missing");
      await repository.insertWorkspaceAgents(db, [id, req.workspaceId]);
      return result;
    },
  );
  app.get("/assistant/cursor/agents/:id", async (req) => {
    if (
      !(
        await repository.selectWorkspaceAgents(db, [req.params.id, req.workspaceId])
      ).rows.length
    )
      throw Object.assign(new Error("Agent not found"), { statusCode: 404 });
    return upstream("/ai/cursor/agents/" + encodeURIComponent(req.params.id), {
      workspaceId: req.workspaceId,
    });
  });
  app.get("/assistant", async (req) =>
    upstream("/ai/status", { workspaceId: req.workspaceId }),
  );
  app.post(
    "/assistant",
    {
      schema: {
        body: {
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
      },
    },
    async (req, reply) => {
      const b = req.body;
      let contract = null;
      if (b.contractId) {
        const row = (
          await repository.selectContracts(db, [b.contractId, req.workspaceId])
        ).rows[0];
        if (!row) return reply.code(404).send({ error: "Contract not found" });
        contract = {
          ...row.document,
          endpoints: row.document.endpoints.filter((e) =>
            b.selected.includes(e.method + " " + e.path),
          ),
        };
      }
      const context = JSON.stringify({
        contract,
        question: b.prompt,
        evidence: b.evidence || "No execution evidence provided.",
      });
      if (context.length > number("public", "ai_context_max_chars", env))
        return reply.code(413).send({
          error: "Selected scope exceeds the configured AI context limit",
        });
      return upstream("/ai/generate", {
        method: "POST",
        body: {
          ...(b.provider ? { provider: b.provider } : {}),
          prompt: renderPrompt("ai/test-plan.txt", { scope: b.scope }),
          context,
        },
        requestId: req.id,
        workspaceId: req.workspaceId,
      });
    },
  );
  const defaultSelection = (contract) =>
    contract.endpoints
      .filter((e) => e.method === "GET")
      .map((e) => e.method + " " + e.path);
  app.get("/contracts", async (req) => ({
    contracts: (
      await repository.selectContracts2(db, [number("storage", "contract_list_limit"), req.workspaceId])
    ).rows.map((row) => ({
      ...row,
      defaultSelection: defaultSelection(row.document),
    })),
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
        parsed = parseContract(req.body.spec, publicConfig(env));
      } catch (e) {
        return reply.code(400).send({ error: e.message });
      }
      const id = randomUUID();
      await repository.insertContracts(db, [id, parsed.title, JSON.stringify(parsed), req.workspaceId]);
      return reply
        .code(201)
        .send({
          id,
          contract: parsed,
          defaultSelection: defaultSelection(parsed),
        });
    },
  );
  app.get("/plans", async (req) => ({
    plans: (
      await repository.selectPlans(db, [number("storage", "plan_list_limit"), req.workspaceId])
    ).rows,
  }));
  app.post(
    "/plans",
    {
      schema: {
        body: {
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
      },
    },
    async (req, reply) => {
      const id = randomUUID();
      const { discipline, artifact, contractId } = req.body;
      let title = "Application";
      if (contractId) {
        const row = (
          await repository.selectContracts3(db, [contractId, req.workspaceId])
        ).rows[0];
        if (!row) return reply.code(404).send({ error: "Contract not found" });
        title = row.title;
      }
      const name =
        req.body.name?.trim() || `${title} · ${toolkits[discipline].name}`;
      if (name.length > number("validation", "plan_name_max_chars", env))
        return reply
          .code(400)
          .send({ error: "Plan name exceeds the configured limit" });
      const c = await db.connect();
      try {
        await repository.beginTransaction(c);
        const result = await repository.insertPlans(c, [id, name, discipline, artifact, req.workspaceId]);
        await repository.insertAuditEvents(c, ["plan.created", id, req.workspaceId]);
        await repository.commitTransaction(c);
        return reply.code(201).send(result.rows[0]);
      } catch (e) {
        await repository.rollbackTransaction(c);
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
      const result = await repository.deletePlans(db, [req.params.id, req.workspaceId]);
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
        const r = await repository.selectContracts(db, [b.contractId, req.workspaceId]);
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
          publicConfig(env),
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
        return parseEvidence(req.body.report, publicConfig(env));
      } catch (e) {
        return reply.code(400).send({ error: e.message });
      }
    },
  );
  app.get("/tools", async (req) =>
    upstream("/tools", { workspaceId: req.workspaceId }),
  );
  for (const path of ["/tools/prometheus/summary", "/tools/jaeger/services"])
    app.get(path, async (req) => {
      const key = "adapter:" + req.workspaceId + ":" + path;
      try {
        const cached = await cache.get(key);
        if (cached) return { ...JSON.parse(cached), cached: true };
      } catch {}
      const data = await upstream(path, { workspaceId: req.workspaceId });
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

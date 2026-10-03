import { withRequestResolutions } from "./http-calls.mjs";
import { projectIdentity } from "./project-identity.mjs";
import { endpointLabel } from "./endpoints.mjs";
import { lockMap } from "../database/repositories/map-studio.mjs";
import { documentContext } from "./document-context.mjs";
import { registerStudioRoutes } from "./studio-routes.mjs";
import { renderPrompt } from "../shared/prompts.mjs";
import * as repository from "../database/repositories/mapping.mjs";
import { randomUUID } from "node:crypto";
import { mappingConfig } from "./config.mjs";
import { mapInputSchema } from "./schema.mjs";
import { validateFiles, cleanPath, eligibleFile } from "./policy.mjs";
import { validateGitUrl } from "./git-reader.mjs";
import { validateEnrichment, toMermaid } from "./analyzer.mjs";
import { number } from "../shared/config.mjs";
const params = {
  type: "object",
  required: ["id"],
  properties: { id: { type: "string", format: "uuid" } },
};
export function registerMapRoutes(app, { db, upstream, env = process.env }) {
  const policy = mappingConfig(env);
  registerStudioRoutes(app, { db, upstream, env });
  app.post(
    "/maps/selection",
    {
      schema: {
        body: {
          type: "object",
          required: ["paths"],
          additionalProperties: false,
          properties: {
            paths: {
              type: "array",
              maxItems: number(
                "repository",
                "repository_selection_max_files",
                env,
              ),
              items: { type: "string", maxLength: policy.maxPathChars },
            },
          },
        },
      },
    },
    async (req) => {
      const paths = [];
      for (const path of req.body.paths) {
        let normalized;
        try {
          normalized = cleanPath(path, policy);
        } catch (e) {
          throw Object.assign(e, { statusCode: 400, expose: true });
        }
        if (eligibleFile(normalized, policy)) paths.push(normalized);
      }
      if (paths.length > policy.maxFiles)
        throw Object.assign(
          new Error("Select a smaller application directory"),
          { statusCode: 413 },
        );
      return { paths, excluded: req.body.paths.length - paths.length };
    },
  );
  app.get("/maps/config", async () => policy);
  app.get("/maps", async (req) => ({
    maps: (
      await repository.selectApplicationMaps(db, [
        number("repository", "repository_list_limit", env),
        req.workspaceId,
      ])
    ).rows,
  }));
  app.get(
    "/maps/:id",
    {
      schema: {
        params,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { version: { type: "integer", minimum: 1 } },
        },
      },
    },
    async (req, reply) => {
      const result = await repository.selectApplicationMaps2(db, [
        req.params.id,
        req.workspaceId,
      ]);
      let row = result.rows[0];
      if (!row)
        return reply.code(404).send({ error: "Application map not found" });
      const versions = (
        await repository.listAnalysisVersions(db, [
          req.params.id,
          req.workspaceId,
          number("map_studio", "analysis_version_retention", env),
        ])
      ).rows;
      if (req.query.version && req.query.version !== row.analysis_version) {
        const previous = (
          await repository.readAnalysisVersion(db, [
            req.params.id,
            req.workspaceId,
            req.query.version,
          ])
        ).rows[0];
        if (!previous)
          return reply
            .code(404)
            .send({ error: "This version is no longer retained" });
        row = { ...row, ...previous, status: "completed", historical: true };
      }
      row.versions = versions;
      if (row?.result?.edges)
        row.result.edges = row.result.edges.map((e) => ({
          ...e,
          relation: endpointLabel(e),
        }));
      if (row?.result?.mermaid)
        row.result.mermaid = row.result.mermaid.replace(
          /configured endpoint/gi,
          "Request path unresolved",
        );
      if (row?.enrichment?.mermaid)
        row.enrichment.mermaid = row.enrichment.mermaid.replace(
          /configured endpoint/gi,
          "Request path unresolved",
        );
      return (
        row || reply.code(404).send({ error: "Application map not found" })
      );
    },
  );
  app.post(
    "/maps",
    { schema: { body: mapInputSchema(env) } },
    async (req, reply) => {
      const { name, source } = req.body;
      let payload = source;
      let provenance;
      try {
        if (source.kind === "upload") {
          const checked = validateFiles(source.files, policy);
          payload = { kind: "upload", files: checked.files };
          provenance = {
            kind: "upload",
            fileCount: checked.files.length,
            bytes: checked.bytes,
            scope: source.scope || "unknown",
          };
        } else {
          const url = validateGitUrl(source.url, policy);
          for (const path of source.paths || []) cleanPath(path, policy);
          provenance = {
            kind: "git",
            url: url.toString(),
            ref: source.ref || null,
            scope: source.scope || "unknown",
            paths: source.paths || [],
          };
        }
      } catch (e) {
        return reply.code(400).send({ error: e.message });
      }
      let id = randomUUID();
      const identity = projectIdentity(name, provenance);
      const client = await db.connect();
      try {
        await repository.beginTransaction(client);
        await repository.selectTransaction(client);
        const previous = (
          await repository.findProject(client, [req.workspaceId, identity])
        ).rows[0];
        if (previous && ["queued", "running"].includes(previous.status)) {
          await repository.rollbackTransaction(client);
          return reply.code(409).send({
            error: "This application already has an analysis in progress.",
          });
        }
        if (previous) id = previous.id;
        const active = await repository.selectApplicationMaps3(client);
        if (
          active.rows[0].count >=
          number("repository", "repository_queue_limit", env)
        ) {
          await repository.rollbackTransaction(client);
          return reply.code(429).send({
            error:
              "The repository analysis queue is full. Try again when a scan finishes.",
          });
        }
        const values = [
          id,
          name,
          JSON.stringify(provenance),
          JSON.stringify(payload),
          req.workspaceId,
        ];
        if (previous) await repository.requeueProject(client, values);
        else
          await repository.insertApplicationMaps(client, [...values, identity]);
        await repository.insertAuditEvents(client, [
          "map.queued",
          id,
          req.workspaceId,
        ]);
        await repository.commitTransaction(client);
        return reply
          .code(202)
          .send({ id, name, source: provenance, status: "queued" });
      } catch (e) {
        await repository.rollbackTransaction(client);
        throw e;
      } finally {
        client.release();
      }
    },
  );

  app.post(
    "/maps/:id/regenerate",
    {
      schema: {
        params,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            direction: { type: "string", enum: ["LR", "TD", "RL", "BT"] },
            includeAi: { type: "boolean" },
            diagramType: {
              type: "string",
              enum: [
                "flowchart",
                "sequence",
                "swimlane",
                "class",
                "state",
                "trace",
              ],
            },
            entryId: { type: "string", maxLength: 100 },
            spans: {
              type: "array",
              maxItems: 500,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "traceId",
                  "spanId",
                  "service",
                  "operation",
                  "startTime",
                ],
                properties: {
                  traceId: { type: "string", pattern: "^[a-fA-F0-9]{32}$" },
                  spanId: { type: "string", pattern: "^[a-fA-F0-9]{16}$" },
                  parentSpanId: {
                    type: "string",
                    pattern: "^[a-fA-F0-9]{16}$",
                  },
                  service: { type: "string", minLength: 1, maxLength: 140 },
                  operation: { type: "string", minLength: 1, maxLength: 140 },
                  startTime: { type: "number", minimum: 0 },
                  durationMs: { type: "number", minimum: 0, maximum: 86400000 },
                  roundTrips: { type: "integer", minimum: 0, maximum: 100000 },
                  database: {
                    type: "object",
                    additionalProperties: false,
                    properties: {
                      name: { type: "string", maxLength: 140 },
                      schema: { type: "string", maxLength: 140 },
                      table: { type: "string", maxLength: 140 },
                      query: {
                        type: "string",
                        maxLength: number(
                          "map_database",
                          "query_max_chars",
                          env,
                        ),
                      },
                      timeoutMs: {
                        type: "number",
                        minimum: 0,
                        maximum: 86400000,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    async (req, reply) => {
      const row = (
        await repository.selectApplicationMaps2(db, [
          req.params.id,
          req.workspaceId,
        ])
      ).rows[0];
      if (!row)
        return reply.code(404).send({ error: "Application map not found" });
      if (row.status !== "completed")
        return reply.code(409).send({ error: "Wait for analysis to complete" });
      let mermaid;
      try {
        mermaid = toMermaid(
          req.body.includeAi
            ? withRequestResolutions(
                row.result,
                row.enrichment?.requestResolutions,
              )
            : row.result,
          {
            ...policy,
            direction: req.body.direction || policy.direction,
            diagramType: req.body.diagramType,
            entryId: req.body.entryId,
            spans: req.body.spans || [],
          },
          req.body.includeAi ? row.enrichment?.suggestions || [] : [],
        );
      } catch (error) {
        return reply.code(422).send({ error: error.message });
      }
      await repository.updateDiagram(db, [row.id, req.workspaceId, mermaid]);
      await repository.insertAuditEvents(db, [
        "map.diagram.regenerated",
        row.id,
        req.workspaceId,
      ]);
      return {
        mermaid,
        classification:
          "Regenerated from stored evidence; no new repository scan",
      };
    },
  );
  app.delete(
    "/maps/:id",
    {
      schema: {
        params,
        body: {
          type: "object",
          required: ["confirmName"],
          additionalProperties: false,
          properties: { confirmName: { type: "string", maxLength: 300 } },
        },
      },
    },
    async (req, reply) => {
      const client = await db.connect();
      try {
        await repository.beginTransaction(client);
        await lockMap(client, req.params.id, req.workspaceId);
        const row = (
          await repository.lockProject(client, [req.params.id, req.workspaceId])
        ).rows[0];
        if (!row) {
          await repository.rollbackTransaction(client);
          return reply.code(404).send({ error: "Application map not found" });
        }
        if (req.body.confirmName !== row.name) {
          await repository.rollbackTransaction(client);
          return reply
            .code(400)
            .send({ error: "Type the exact project name to confirm deletion" });
        }
        await repository.deleteSnapshots(client, [row.id, req.workspaceId]);
        await repository.deleteProject(client, [row.id, req.workspaceId]);
        await repository.insertAuditEvents(client, [
          "map.deleted",
          row.id,
          req.workspaceId,
        ]);
        await repository.commitTransaction(client);
        return { deleted: true, id: row.id };
      } catch (e) {
        await repository.rollbackTransaction(client);
        throw e;
      } finally {
        client.release();
      }
    },
  );
  app.post("/maps/:id/enrich", { schema: { params } }, async (req, reply) => {
    const row = (
      await repository.selectApplicationMaps4(db, [
        req.params.id,
        req.workspaceId,
      ])
    ).rows[0];
    if (!row)
      return reply.code(404).send({ error: "Application map not found" });
    if (row.status !== "completed")
      return reply
        .code(409)
        .send({ error: "Wait for static analysis to complete" });
    const context = JSON.stringify({
      nodes: row.result.nodes,
      edges: row.result.edges.map(({ databaseCalls, ...edge }) => ({
        ...edge,
        ...(databaseCalls
          ? { databaseQueryIds: databaseCalls.map((c) => c.id) }
          : {}),
      })),
      warnings: row.result.warnings,
      scope: row.result.scope,
      documentation: await documentContext(
        db,
        req.params.id,
        req.workspaceId,
        "architecture readme workflows dependencies",
        env,
      ),
    });
    if (context.length > number("public", "ai_context_max_chars", env))
      return reply.code(413).send({
        error:
          "This map exceeds the configured AI context limit. Use a smaller repository scope.",
      });
    const response = await upstream("/ai/generate", {
      method: "POST",
      body: {
        prompt: renderPrompt("application-maps/enrichment.txt", {
          summaryMaxChars: number(
            "repository",
            "repository_ai_summary_max_chars",
            env,
          ),
          maxSuggestions: number(
            "repository",
            "repository_ai_max_suggestions",
            env,
          ),
          reasonMaxChars: number(
            "repository",
            "repository_ai_reason_max_chars",
            env,
          ),
        }),
        context,
      },
      requestId: req.id,
      workspaceId: req.workspaceId,
    });
    let enriched;
    try {
      enriched = validateEnrichment(response.content, row.result, env);
    } catch (e) {
      return reply.code(502).send({ error: e.message });
    }
    enriched.model = response.model;
    enriched.traceId = response.traceId || null;
    enriched.requestId = req.id;
    enriched.mermaid = toMermaid(
      withRequestResolutions(row.result, enriched.requestResolutions),
      policy,
      enriched.suggestions,
    );
    const saved = await repository.updateApplicationMaps(db, [
      req.params.id,
      JSON.stringify(enriched),
      req.workspaceId,
      row.analysis_version,
    ]);
    if (!saved.rows.length)
      return reply.code(409).send({
        error:
          "The source version changed during AI review. Reload and try again.",
      });
    return enriched;
  });
}

import { withRequestResolutions } from "./http-calls.mjs";
import { documentContext } from "./document-context.mjs";
import { validateGrouping } from "./grouping.mjs";
import { exportSvg, compareRevisions } from "./export.mjs";
import { randomUUID } from "node:crypto";
import { studioOptions, studioSchemas } from "./studio-schema.mjs";
import { projectGraph } from "./projection.mjs";
import {
  auditMap,
  dependencyImpact,
  simulate,
  knowledge,
  forecastCost,
  mapDocumentation,
} from "./intelligence.mjs";
import * as maps from "../database/repositories/mapping.mjs";
import * as store from "../database/repositories/map-studio.mjs";
import {
  encryptionKey,
  encryptSettings,
  decryptSettings,
} from "../settings/store.mjs";
import { number } from "../shared/config.mjs";
import { renderPrompt } from "../shared/prompts.mjs";
const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode, expose: true });
const params = {
  type: "object",
  required: ["id"],
  additionalProperties: false,
  properties: { id: { type: "string", format: "uuid" } },
};
const associatedEvidence = (node) => {
  const all = [];
  function visit(value) {
    if (!value || typeof value !== "object") return;
    if (typeof value.path === "string" && Number.isInteger(value.line))
      all.push(value);
    for (const v of Object.values(value)) visit(v);
  }
  visit(node);
  return all;
};
export function validateStudioAi(
  content,
  graph,
  env = process.env,
  documents = [],
) {
  let data;
  try {
    data = JSON.parse(
      content
        .trim()
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, ""),
    );
  } catch {
    throw fail("AI output was not valid structured JSON", 502);
  }
  if (
    typeof data.text !== "string" ||
    !data.text.trim() ||
    data.text.length > number("map_studio", "max_documents_chars", env) ||
    !Array.isArray(data.citations) ||
    data.citations.length > number("repository", "repository_max_edges", env)
  )
    throw fail("AI output exceeded the document schema", 502);
  for (const c of data.citations) {
    const n = graph.nodes.find((n) => n.id === c?.nodeId);
    if (
      !n ||
      (!associatedEvidence(n).some(
        (e) => e.path === c.path && e.line === c.line,
      ) &&
        !(graph.edges || []).some(
          (edge) =>
            (edge.from === c.nodeId || edge.to === c.nodeId) &&
            associatedEvidence(edge).some(
              (e) => e.path === c.path && e.line === c.line,
            ),
        ) &&
        !(
          c.nodeId === graph.nodes[0]?.id &&
          documents.some((e) => e.path === c.path && e.line === c.line)
        ) &&
        !(graph.documentation || []).some(
          (e) => e.path === c.path && e.line === c.line,
        ))
    )
      throw fail("AI cited unknown repository evidence", 502);
  }
  const actions = data.actions || [];
  const supported = new Set(["impact", "outage", "audit", "readme", "runbook"]);
  if (!Array.isArray(actions) || actions.length > 3)
    throw fail("AI action proposals exceeded the allowed schema", 502);
  for (const action of actions) {
    if (
      !action ||
      !supported.has(action.type) ||
      Object.keys(action).some((key) => !["type", "nodeId"].includes(key)) ||
      (["impact", "outage"].includes(action.type)
        ? !graph.nodes.some((node) => node.id === action.nodeId)
        : action.nodeId !== undefined)
    )
      throw fail("AI proposed an unsupported action or unknown component", 502);
  }
  return {
    actions: actions.map(({ type, nodeId }) => ({
      type,
      ...(nodeId ? { nodeId } : {}),
    })),
    text: data.text,
    citations: data.citations.map((c) => ({
      nodeId: c.nodeId,
      path: c.path,
      line: c.line,
    })),
    classification: "AI draft; requires owner review",
  };
}
export function validateRevisionPayload(graph, body) {
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (!body.label.trim()) throw fail("A snapshot label is required");
  for (const id of Object.keys(body.annotations)) {
    if (!ids.has(id)) throw fail("Annotation references an unknown component");
    for (const raw of body.annotations[id].documentation || []) {
      let url;
      try {
        url = new URL(raw);
      } catch {
        throw fail("Documentation links must be valid HTTPS URLs");
      }
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        (url.hash && url.hash.length > 1000)
      )
        throw fail(
          "Documentation links must use HTTPS without embedded credentials",
        );
    }
  }
  for (const id of Object.keys(body.positions))
    if (!ids.has(id))
      throw fail("Layout positions must reference existing components");
  if (body.scenario) {
    if (body.kind !== "proposed")
      throw fail("Scenarios belong to proposed snapshots");
    validateScenario(body.scenario);
    simulate(graph, body.scenario);
  }
  return body;
}
function validateScenario(input) {
  if (
    input.type === "traffic" &&
    (input.multiplier === undefined || input.multiplier < 1)
  )
    throw fail("Supply a traffic multiplier");
  if (input.type === "replace" && !input.replacement?.trim())
    throw fail("Supply a proposed replacement technology");
}
export function registerStudioRoutes(app, { db, upstream, env = process.env }) {
  const schemas = studioSchemas(env);
  const limit = number("map_studio", "max_revisions", env);
  const decode = (row, workspaceId) => ({
    ...decryptSettings(
      { ...row, id: `map-studio:${workspaceId}:${row.map_id}:${row.id}` },
      encryptionKey(env),
    ),
    id: row.id,
    version: row.version,
    createdAt: row.created_at,
    kind: row.kind,
  });
  async function load(req) {
    const row = (
      await maps.selectApplicationMaps2(db, [req.params.id, req.workspaceId])
    ).rows[0];
    if (!row) throw fail("Application map not found", 404);
    if (row.status !== "completed" || !row.result)
      throw fail("Select a completed application map", 409);
    return row;
  }
  async function revisions(req) {
    return (
      await store.listRevisions(db, req.params.id, req.workspaceId, limit)
    ).rows.map((r) => decode(r, req.workspaceId));
  }
  async function ai(task, graph, deterministic, req, annotations = {}) {
    let aiTrace;
    try {
      const documents = await documentContext(
        db,
        req.params.id,
        req.workspaceId,
        req.body.question || task,
        env,
      );
      const citationCatalog = [
        ...new Map(
          graph.nodes
            .flatMap((node) =>
              [
                ...associatedEvidence(node),
                ...(graph.edges || [])
                  .filter(
                    (edge) => edge.from === node.id || edge.to === node.id,
                  )
                  .flatMap(associatedEvidence),
                ...(node.id === graph.nodes[0]?.id ? documents : []),
              ].map(({ path, line }) => ({ nodeId: node.id, path, line })),
            )
            .map((c) => [JSON.stringify(c), c]),
        ).values(),
      ];
      const context = JSON.stringify({
        graph: {
          nodes: graph.nodes,
          edges: graph.edges.map(({ databaseCalls, ...edge }) => ({
            ...edge,
            ...(databaseCalls
              ? { databaseQueryIds: databaseCalls.map((c) => c.id) }
              : {}),
          })),
          warnings: graph.warnings,
          pipelines: graph.pipelines,
        },
        scope: graph.scope || "unknown",
        documentation: documents,
        citationCatalog,
        documentCitationNodeId: graph.nodes[0]?.id,
        annotations,
        deterministic,
        question: req.body.question || "",
      });
      if (context.length > number("public", "ai_context_max_chars", env))
        return {
          aiError:
            "Map exceeds the AI context budget; deterministic analysis remains available.",
        };
      const response = await upstream("/ai/generate", {
        method: "POST",
        body: {
          prompt: renderPrompt("application-maps/studio-review.txt", {
            task,
            maxChars: number("map_studio", "max_documents_chars", env),
          }),
          context,
        },
        requestId: req.id,
        workspaceId: req.workspaceId,
      });
      aiTrace = {
        traceId: response.traceId || null,
        requestId: req.id,
        model: response.model,
      };
      return {
        ai: {
          ...validateStudioAi(response.content, graph, env, documents),
          model: response.model,
          traceId: response.traceId || null,
          requestId: req.id,
        },
      };
    } catch (error) {
      app.log.warn({
        event: "map_ai_review_failed",
        requestId: req.id,
        reason: error?.expose ? error.message : "upstream_or_internal_failure",
      });
      return {
        aiTrace,
        aiError:
          "AI review could not be validated or completed. The deterministic result remains available.",
      };
    }
  }
  app.get(
    "/maps/:id/studio",
    {
      schema: {
        params,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: studioOptions,
        },
      },
    },
    async (req) => {
      const row = await load(req);
      const history = await revisions(req);
      const requested = req.query.revision;
      const revision =
        requested === -1
          ? null
          : requested
            ? history.find((r) => r.version === requested)
            : history[0] || null;
      if (requested > 0 && !revision) throw fail("Snapshot not found", 404);
      const annotations = revision?.annotations || {};
      const useSavedPositions =
        revision &&
        ["view", "groupBy", "layout"].every(
          (k) => !req.query[k] || req.query[k] === revision[k],
        );
      const projection = await projectGraph(
        withRequestResolutions(row.result, row.enrichment?.requestResolutions),
        req.query,
        annotations,
        useSavedPositions ? revision.positions : {},
        env,
      );
      return {
        mapId: row.id,
        source: row.source,
        metadataAvailable: Boolean(row.result.metadataVersion),
        projection,
        components: row.result.nodes,
        pipelines: row.result.pipelines || [],
        infrastructure: row.result.infrastructure || [],
        audit: auditMap(row.result),
        annotations,
        revision,
        latestVersion: history[0]?.version || 0,
        revisions: history.map(({ id, version, label, kind, createdAt }) => ({
          id,
          version,
          label,
          kind,
          createdAt,
        })),
        limits: {
          textMaxChars: number("map_studio", "text_max_chars", env),
          questionMaxChars: number("map_studio", "max_question_chars", env),
          maxMultiplier: number("map_studio", "max_multiplier", env),
          maxHours: number("map_studio", "max_hours", env),
        },
        sharePath: `/?view=Application%20maps&map=${row.id}`,
      };
    },
  );
  app.get(
    "/maps/:id/export",
    {
      schema: {
        params,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: studioOptions,
        },
      },
    },
    async (req) => {
      const graph = (await load(req)).result;
      const history = await revisions(req);
      const revision =
        req.query.revision === -1
          ? null
          : req.query.revision
            ? history.find((r) => r.version === req.query.revision)
            : history[0];
      if (req.query.revision > 0 && !revision)
        throw fail("Snapshot not found", 404);
      const sameLayout =
        revision &&
        ["view", "groupBy", "layout"].every(
          (k) => !req.query[k] || req.query[k] === revision[k],
        );
      return {
        svg: exportSvg(
          await projectGraph(
            graph,
            req.query,
            revision?.annotations || {},
            sameLayout ? revision.positions : {},
            env,
          ),
        ),
      };
    },
  );
  app.get(
    "/maps/:id/compare",
    {
      schema: {
        params,
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["from", "to"],
          properties: {
            from: studioOptions.revision,
            to: studioOptions.revision,
          },
        },
      },
    },
    async (req) => {
      const graph = (await load(req)).result;
      const history = await revisions(req);
      const resolve = (version) => {
        const r =
          version === -1
            ? null
            : version === 0
              ? history[0] || null
              : history.find((r) => r.version === version);
        if (version > 0 && !r) throw fail("Snapshot not found", 404);
        return r;
      };
      return compareRevisions(
        graph,
        resolve(req.query.from),
        resolve(req.query.to),
      );
    },
  );
  app.get(
    "/maps/:id/impact",
    {
      schema: {
        params,
        querystring: {
          type: "object",
          required: ["nodeId"],
          additionalProperties: false,
          properties: {
            nodeId: { type: "string", pattern: "^n[a-f0-9]{16}$" },
          },
        },
      },
    },
    async (req) => dependencyImpact((await load(req)).result, req.query.nodeId),
  );
  app.post(
    "/maps/:id/revisions",
    { schema: { params, body: schemas.revision } },
    async (req, reply) => {
      const row = await load(req);
      validateRevisionPayload(row.result, req.body);
      const client = await db.connect();
      try {
        await maps.beginTransaction(client);
        await store.lockMap(client, row.id, req.workspaceId);
        const existing = (
          await store.listRevisions(client, row.id, req.workspaceId, limit)
        ).rows;
        const version = existing[0]?.version || 0;
        if (version !== req.body.expectedVersion)
          throw fail(
            "This map changed in another session. Reload before saving your snapshot.",
            409,
          );
        const id = randomUUID();
        const encrypted = encryptSettings(
          `map-studio:${req.workspaceId}:${row.id}:${id}`,
          {
            ...req.body,
            source: row.source,
            analyzerVersion: row.result.analyzerVersion,
          },
          encryptionKey(env),
        );
        const saved = (
          await store.insertRevision(client, [
            id,
            row.id,
            req.workspaceId,
            version + 1,
            req.identity.user.id,
            req.body.kind,
            encrypted.ciphertext,
            encrypted.iv,
            encrypted.tag,
          ])
        ).rows[0];
        await store.pruneRevisions(
          client,
          row.id,
          req.workspaceId,
          version + 1 - limit,
        );
        await maps.insertAuditEvents(client, [
          "map.snapshot",
          row.id,
          req.workspaceId,
        ]);
        await maps.commitTransaction(client);
        return reply.code(201).send(saved);
      } catch (e) {
        await maps.rollbackTransaction(client);
        throw e;
      } finally {
        client.release();
      }
    },
  );
  app.post(
    "/maps/:id/simulate",
    { schema: { params, body: schemas.simulation } },
    async (req) => {
      const graph = (await load(req)).result;
      validateScenario(req.body.scenario);
      const result = simulate(graph, req.body.scenario);
      return {
        result,
        ...(req.body.useAi
          ? await ai("Explain hypothetical scenario", graph, result, req)
          : {}),
      };
    },
  );
  app.post(
    "/maps/:id/knowledge",
    { schema: { params, body: schemas.knowledge } },
    async (req) => {
      const graph = (await load(req)).result;
      const history = await revisions(req);
      const revision =
        req.body.revision === -1
          ? null
          : req.body.revision
            ? history.find((r) => r.version === req.body.revision)
            : history[0];
      if (req.body.revision > 0 && !revision)
        throw fail("Snapshot not found", 404);
      const annotations = revision?.annotations || {};
      const result = knowledge(graph, req.body.question, annotations);
      return {
        result,
        ...(req.body.useAi
          ? await ai(
              "Answer operational question with evidence",
              graph,
              result,
              req,
              annotations,
            )
          : {}),
      };
    },
  );
  app.post(
    "/maps/:id/documentation",
    { schema: { params, body: schemas.documentation } },
    async (req) => {
      const graph = (await load(req)).result;
      const history = await revisions(req);
      const revision =
        req.body.revision === -1
          ? null
          : req.body.revision
            ? history.find((r) => r.version === req.body.revision)
            : history[0];
      if (req.body.revision > 0 && !revision)
        throw fail("Snapshot not found", 404);
      const annotations = revision?.annotations || {};
      const context =
        req.body.type === "documentation-summary"
          ? await documentContext(
              db,
              req.params.id,
              req.workspaceId,
              "architecture purpose workflows operations",
              env,
            )
          : [];
      const result =
        req.body.type === "documentation-summary"
          ? {
              format: "markdown",
              content: context.length
                ? "# Retrieved documentation context\n\n" +
                  context
                    .map((c) => `## ${c.path}:${c.line}\n${c.text}`)
                    .join("\n\n")
                : "No Markdown context was imported. Re-import with relevant README/docs; older maps do not retain document bodies.",
              warning:
                "Documentation claims; excerpts are redacted and bounded. AI summarization is optional.",
            }
          : mapDocumentation(graph, req.body.type, annotations);
      return {
        result,
        ...(req.body.useAi
          ? await ai(
              `Draft ${req.body.type} documentation`,
              graph,
              result,
              req,
              annotations,
            )
          : {}),
      };
    },
  );
  app.post(
    "/maps/:id/grouping",
    { schema: { params, body: schemas.audit } },
    async (req) => {
      const graph = (await load(req)).result;
      const nodes = graph.nodes.map((n) => ({
        id: n.id,
        label: n.label,
        kind: n.kind,
        language: n.metadata?.primaryLanguage,
        owner: n.metadata?.owner,
        evidence: n.evidence,
      }));
      const context = JSON.stringify({
        nodes,
        documentation: await documentContext(
          db,
          req.params.id,
          req.workspaceId,
          "architecture components boundaries",
          env,
        ),
        scope: graph.scope,
        edges: graph.edges,
        warnings: graph.warnings,
      });
      if (context.length > number("public", "ai_context_max_chars", env))
        throw fail("Reduce the map scope before AI grouping", 413);
      try {
        const response = await upstream("/ai/generate", {
          method: "POST",
          body: {
            prompt: renderPrompt("application-maps/grouping.txt", {
              maxGroups: number("map_studio", "max_groups", env),
              summaryMaxChars: number(
                "repository",
                "repository_ai_summary_max_chars",
                env,
              ),
            }),
            context,
          },
          requestId: req.id,
          workspaceId: req.workspaceId,
        });
        return {
          ...validateGrouping(response.content, graph, env),
          model: response.model,
          traceId: response.traceId || null,
          requestId: req.id,
        };
      } catch {
        throw fail(
          "AI grouping could not be validated. Existing layout and annotations are unchanged; use ELK boundaries instead.",
          502,
        );
      }
    },
  );
  app.post(
    "/maps/:id/audit",
    { schema: { params, body: schemas.audit } },
    async (req) => {
      const graph = (await load(req)).result;
      const result = auditMap(graph);
      return {
        result,
        ...(req.body.useAi
          ? await ai(
              "Review architecture gaps; no compliance certification",
              graph,
              result,
              req,
            )
          : {}),
      };
    },
  );
  app.post(
    "/maps/:id/cost",
    { schema: { params, body: schemas.cost } },
    async (req) => {
      if (
        new Set(req.body.items.map((i) => i.nodeId)).size !==
        req.body.items.length
      )
        throw fail("Each component can be priced once per forecast");
      return { result: forecastCost((await load(req)).result, req.body) };
    },
  );
}

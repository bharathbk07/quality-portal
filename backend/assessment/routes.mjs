import { randomUUID } from "node:crypto";
import { assessmentCatalog, assessmentSchema } from "./schema.mjs";
import { assess, markdownReport } from "./service.mjs";
import { number } from "../shared/config.mjs";
import { renderPrompt } from "../shared/prompts.mjs";
import {
  encryptionKey,
  encryptSettings,
  decryptSettings,
} from "../settings/store.mjs";
import * as repository from "../database/repositories/assessment.mjs";
import * as contracts from "../database/repositories/core.mjs";
import * as maps from "../database/repositories/mapping.mjs";
const fail = (message, statusCode) =>
  Object.assign(new Error(message), { statusCode, expose: true });
export function registerAssessment(app, { db, upstream, env }) {
  const key = encryptionKey(env);
  app.get("/assessments/catalog", () => ({
    ...assessmentCatalog,
    inputMaxChars: number("assessment", "input_max_chars", env),
    nameMaxChars: number("validation", "plan_name_max_chars", env),
  }));
  app.get("/assessments", async (req) => ({
    reports: (
      await repository.listReports(
        db,
        req.workspaceId,
        number("assessment", "list_limit", env),
      )
    ).rows,
  }));
  app.get(
    "/assessments/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    async (req) => {
      const row = (
        await repository.findReport(db, req.params.id, req.workspaceId)
      ).rows[0];
      if (!row) throw fail("Report not found", 404);
      const report = decryptSettings(
        { ...row, id: `report:${req.workspaceId}:${row.id}` },
        key,
      );
      return { report, markdown: markdownReport(report) };
    },
  );
  app.post(
    "/assessments",
    { schema: { body: assessmentSchema(env) } },
    async (req, reply) => {
      const b = req.body;
      if (!b.name.trim()) throw fail("Report name is required", 400);
      let contract = null,
        map = null;
      if (b.contractId) {
        const row = (
          await contracts.selectContracts(db, [b.contractId, req.workspaceId])
        ).rows[0];
        if (!row) throw fail("Contract not found", 404);
        contract = row.document;
      }
      if (b.mapId) {
        const row = (
          await maps.selectApplicationMaps2(db, [b.mapId, req.workspaceId])
        ).rows[0];
        if (!row) throw fail("Application map not found", 404);
        if (row.status !== "completed" || !row.result)
          throw fail("Select a completed application map", 409);
        map = row.result;
      }
      const report = assess(b, { contract, map });
      let aiError = null;
      if (b.useAI) {
        const context = JSON.stringify(report);
        if (context.length > number("public", "ai_context_max_chars", env))
          throw fail(
            "Assessment exceeds the AI context limit. Shorten supplied context or generate without AI.",
            413,
          );
        try {
          report.ai = await upstream("/ai/generate", {
            method: "POST",
            body: { prompt: renderPrompt("assessment/review.txt"), context },
            workspaceId: req.workspaceId,
            requestId: req.id,
          });
        } catch {
          aiError =
            "AI suggestions could not be generated. The evidence-based report is available; review connection status and retry in a new assessment.";
        }
      }
      const id = randomUUID();
      report.id = id;
      const encrypted = encryptSettings(
        `report:${req.workspaceId}:${id}`,
        report,
        key,
      );
      await repository.saveReport(db, {
        id,
        workspace: req.workspaceId,
        name: report.name,
        kind: report.kind,
        ...encrypted,
      });
      return reply
        .code(201)
        .send({ report, markdown: markdownReport(report), aiError });
    },
  );
}

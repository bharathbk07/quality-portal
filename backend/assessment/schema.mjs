import { readFileSync } from "node:fs";
import { promptDirectory } from "../shared/prompts.mjs";
import { number } from "../shared/config.mjs";
export const assessmentCatalog = JSON.parse(
  readFileSync(promptDirectory() + "/assessment/catalog.json", "utf8"),
);
export function assessmentSchema(env = process.env) {
  return {
    type: "object",
    additionalProperties: false,
    required: ["kind", "name", "intake", "useAI"],
    properties: {
      name: {
        type: "string",
        minLength: 1,
        maxLength: number("validation", "plan_name_max_chars", env),
      },
      kind: {
        type: "string",
        enum: assessmentCatalog.reportKinds.map((x) => x.id),
      },
      contractId: { type: "string", format: "uuid" },
      mapId: { type: "string", format: "uuid" },
      useAI: { type: "boolean" },
      intake: {
        type: "object",
        additionalProperties: false,
        properties: Object.fromEntries(
          assessmentCatalog.inputs.map((x) => [
            x.key,
            {
              type: "string",
              maxLength: number("assessment", "input_max_chars", env),
            },
          ]),
        ),
      },
    },
  };
}

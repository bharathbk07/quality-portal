import { mappingConfig } from "./config.mjs";
import { number } from "../shared/config.mjs";
export function mapInputSchema(env = process.env) {
  const p = mappingConfig(env);
  return {
    type: "object",
    required: ["name", "source"],
    additionalProperties: false,
    properties: {
      name: {
        type: "string",
        minLength: 1,
        maxLength: number("validation", "plan_name_max_chars", env),
      },
      source: {
        oneOf: [
          {
            type: "object",
            required: ["kind", "files"],
            additionalProperties: false,
            properties: {
              kind: { const: "upload" },
              scope: {
                type: "string",
                enum: [
                  "single-service",
                  "multiple-services",
                  "system",
                  "unknown",
                ],
              },
              files: {
                type: "array",
                minItems: 1,
                maxItems: p.maxFiles,
                items: {
                  type: "object",
                  required: ["path", "content"],
                  additionalProperties: false,
                  properties: {
                    path: {
                      type: "string",
                      minLength: 1,
                      maxLength: p.maxPathChars,
                    },
                    content: { type: "string", maxLength: p.maxFileBytes },
                  },
                },
              },
            },
          },
          {
            type: "object",
            required: ["kind", "url"],
            additionalProperties: false,
            properties: {
              kind: { const: "git" },
              scope: {
                type: "string",
                enum: [
                  "single-service",
                  "multiple-services",
                  "system",
                  "unknown",
                ],
              },
              paths: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "string",
                  minLength: 1,
                  maxLength: p.maxPathChars,
                },
              },
              url: { type: "string", maxLength: p.maxPathChars, minLength: 1 },
              ref: { type: "string", maxLength: p.maxPathChars },
            },
          },
        ],
      },
    },
  };
}

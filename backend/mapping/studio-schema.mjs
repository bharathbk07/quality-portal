import { number } from "../shared/config.mjs";
export const studioOptions = {
  view: { type: "string", enum: ["high-level", "logical", "deployment"] },
  groupBy: {
    type: "string",
    enum: [
      "none",
      "function",
      "language",
      "team",
      "environment",
      "namespace",
      "custom",
    ],
  },
  layout: { type: "string", enum: ["hierarchical", "tree", "swimlanes"] },
  environment: { type: "string", maxLength: 300 },
  search: { type: "string", maxLength: 300 },
  revision: { type: "integer", minimum: -1 },
};
export function studioSchemas(env = process.env) {
  const n = (key) => number("map_studio", key, env);
  const text = { type: "string", maxLength: n("text_max_chars") };
  const nodeId = { type: "string", pattern: "^n[a-f0-9]{16}$" };
  const object = (properties, required = []) => ({
    type: "object",
    additionalProperties: false,
    properties,
    required,
  });
  const annotation = object({
    owner: { type: "string", maxLength: 300 },
    notes: text,
    warning: text,
    group: { type: "string", maxLength: 300 },
    groupDescription: text,
    color: { type: "string", pattern: "^#[a-fA-F0-9]{6}$" },
    icon: {
      type: "string",
      enum: [
        "service",
        "frontend",
        "database",
        "cache",
        "queue",
        "gateway",
        "external",
      ],
    },
    documentation: {
      type: "array",
      maxItems: 10,
      items: { type: "string", maxLength: 1000, pattern: "^https://[^\\s]+$" },
    },
  });
  const scenario = object(
    {
      type: { type: "string", enum: ["outage", "traffic", "replace"] },
      nodeId,
      multiplier: { type: "number", minimum: 1, maximum: n("max_multiplier") },
      replacement: { type: "string", maxLength: 300 },
    },
    ["type", "nodeId"],
  );
  const coordinate = { type: "number", minimum: -100000, maximum: 100000 };
  const positions = {
    type: "object",
    maxProperties: number("repository", "repository_max_nodes", env),
    additionalProperties: object({ x: coordinate, y: coordinate }, ["x", "y"]),
  };
  const rate = { type: "number", minimum: 0, maximum: n("max_rate") };
  return {
    revision: object(
      {
        expectedVersion: { type: "integer", minimum: 0 },
        label: { type: "string", minLength: 1, maxLength: 300 },
        kind: { type: "string", enum: ["current", "proposed"] },
        annotations: {
          type: "object",
          maxProperties: n("max_annotations"),
          additionalProperties: annotation,
        },
        positions,
        view: studioOptions.view,
        groupBy: studioOptions.groupBy,
        layout: studioOptions.layout,
        scenario,
      },
      ["expectedVersion", "label", "kind", "annotations", "positions"],
    ),
    simulation: object({ scenario, useAi: { type: "boolean" } }, ["scenario"]),
    knowledge: object(
      {
        question: {
          type: "string",
          minLength: 1,
          maxLength: n("max_question_chars"),
        },
        useAi: { type: "boolean" },
        revision: studioOptions.revision,
      },
      ["question"],
    ),
    documentation: object(
      {
        type: {
          type: "string",
          enum: ["readme", "runbook", "api", "onboarding", "documentation-summary"],
        },
        useAi: { type: "boolean" },
        revision: studioOptions.revision,
      },
      ["type"],
    ),
    audit: object({ useAi: { type: "boolean" } }),
    cost: object(
      {
        currency: { type: "string", pattern: "^[A-Z]{3}$" },
        hours: { type: "number", exclusiveMinimum: 0, maximum: n("max_hours") },
        items: {
          type: "array",
          minItems: 1,
          maxItems: n("max_price_items"),
          items: object(
            {
              nodeId,
              replicas: { type: "integer", minimum: 1, maximum: 10000 },
              cpuHour: rate,
              memoryGiBHour: rate,
              flatHour: rate,
              storageGiBMonth: rate,
              storageGiB: rate,
            },
            ["nodeId"],
          ),
        },
      },
      ["currency", "hours", "items"],
    ),
  };
}

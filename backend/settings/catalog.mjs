import { number } from "../shared/config.mjs";
const help = {
  LANGSMITH_CAPTURE_CONTENT:
    "When enabled, LangSmith receives redacted system/user messages, context and generated content. When disabled, inputs and outputs are intentionally hidden; request IDs, tokens and timings remain searchable. This does not export credentials.",
  GOOGLE_BASE_URL:
    "Use the Gemini API origin shown here. Google AI Studio and gemini.google.com are browser dashboards, not API endpoints.",
  GOOGLE_API_VERSION:
    "Native Gemini API version, such as v1beta. Keep the base URL free of /models or OpenAI compatibility paths.",
  LANGSMITH_ENDPOINT:
    "Use your regional LangSmith API endpoint (US, EU or APAC), not the dashboard URL. Self-hosted endpoints require operator approval.",
  LANGSMITH_UI_URL:
    "Browser dashboard link only; tracing uses the API endpoint above.",
  AI_PROVIDER:
    "Select your preferred configured chat provider. If incomplete, generation uses an available configured provider and shows a notice.",
};
const field = (key, label, type = "text", section = "ai", choices) => ({
  key,
  label,
  type,
  section,
  help: help[key],
  maxLength: number("validation", "settings_value_max_chars"),
  ...(choices ? { choices } : {}),
});
const providers = [
  ["openai", "OpenAI"],
  ["google", "Google Gemini"],
  ["claude", "Anthropic Claude"],
  ["lmstudio", "LM Studio"],
  ["ollama", "Ollama"],
  ["compatible", "OpenAI-compatible"],
  ["cursor", "Cursor"],
];
export const catalog = [
  {
    id: "ai",
    label: "AI defaults",
    description:
      "Choose the default provider for copilots and repository enrichment.",
    fields: [
      field(
        "AI_PROVIDER",
        "Default provider",
        "select",
        "ai",
        providers
          .filter(([id]) => id !== "cursor")
          .map(([value, label]) => ({ value, label })),
      ),
    ],
  },
  ...providers.map(([id, label]) => ({
    id,
    label,
    description:
      id === "cursor"
        ? "Repository coding agents through the Cursor Python SDK."
        : "Configure this provider without restarting the portal.",
    fields: [
      ...(id === "cursor"
        ? [
            field(
              "CURSOR_BRIDGE_URL",
              "Optional SDK bridge URL",
              "url",
              "ai_cursor",
            ),
            field("CURSOR_BRIDGE_TOKEN", "Bridge token", "secret", "ai_cursor"),
          ]
        : [
            field(
              id.toUpperCase() + "_BASE_URL",
              "API base URL",
              "url",
              "ai_" + id,
            ),
          ]),
      field(id.toUpperCase() + "_MODEL", "Model ID", "text", "ai_" + id),
      field(id.toUpperCase() + "_API_KEY", "API key", "secret", "ai_" + id),
      ...(id === "google"
        ? [field("GOOGLE_API_VERSION", "API version", "text", "ai_google")]
        : []),
    ],
  })),
  {
    id: "langsmith",
    label: "LangSmith",
    description:
      "Monitor model latency, tokens and failures. Content capture is optional.",
    fields: [
      field("LANGSMITH_TRACING", "Enable tracing", "boolean", "langsmith"),
      field("LANGSMITH_ENDPOINT", "Regional API endpoint", "url", "langsmith"),
      field("LANGSMITH_PROJECT", "Project name", "text", "langsmith"),
      field("LANGSMITH_API_KEY", "API key", "secret", "langsmith"),
      field(
        "LANGSMITH_WORKSPACE_ID",
        "Workspace ID (optional)",
        "text",
        "langsmith",
      ),
      field(
        "LANGSMITH_CAPTURE_CONTENT",
        "Capture prompts and responses",
        "boolean",
        "langsmith",
      ),
      field("LANGSMITH_UI_URL", "Dashboard URL", "url", "langsmith"),
    ],
  },
  {
    id: "telemetry",
    label: "Observability & APM",
    description:
      "Connect existing Prometheus, Jaeger, Grafana and OpenTelemetry installations.",
    fields: [
      field("PROMETHEUS_URL", "Prometheus API URL", "url", "telemetry"),
      field("JAEGER_URL", "Jaeger API URL", "url", "telemetry"),
      field("GRAFANA_URL", "Grafana dashboard URL", "url", "telemetry"),
      field("OTEL_ENDPOINT", "OpenTelemetry endpoint", "url", "telemetry"),
      field(
        "TELEMETRY_BEARER_TOKEN",
        "Telemetry bearer token",
        "secret",
        "telemetry",
      ),
    ],
  },
  {
    id: "repository",
    label: "Git access",
    description:
      "Credentials for private repository imports. Repository host restrictions remain server policy.",
    fields: [
      field("GIT_HTTP_TOKEN", "Git access token", "secret", "repository"),
    ],
  },
  {
    id: "tools",
    label: "Testing tools",
    description:
      "Store links to your existing testing tools and CI. The portal continues to use these tools for execution.",
    fields: [
      ...[
        ["K6_URL", "k6 / Grafana"],
        ["JMETER_URL", "JMeter / CI"],
        ["PLAYWRIGHT_URL", "Playwright reports"],
        ["LIGHTHOUSE_URL", "Lighthouse / CI"],
        ["AXE_URL", "Accessibility reports"],
        ["LITMUS_URL", "LitmusChaos"],
      ].map(([key, label]) => field(key, label, "url", "tools")),
    ],
  },
];
export const settingsBody = {
  type: "object",
  required: ["version", "values"],
  additionalProperties: false,
  properties: {
    version: { type: "integer", minimum: 0 },
    values: {
      type: "object",
      additionalProperties: {
        anyOf: [
          {
            type: "string",
            maxLength: number("validation", "settings_value_max_chars"),
          },
          { type: "null" },
        ],
      },
      maxProperties: number("validation", "settings_max_fields"),
    },
  },
};

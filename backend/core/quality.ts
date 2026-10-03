import { number } from "../shared/config.mjs";
import { parseDocument } from "yaml";
export type Endpoint = {
  method: string;
  path: string;
  summary: string;
  required: string[];
};
export type Contract = {
  title: string;
  version: string;
  server: string;
  endpoints: Endpoint[];
  warnings: string[];
};
export const exampleSpec = JSON.stringify(
  {
    openapi: "3.0.3",
    info: { title: "Commerce API", version: "1.0.0" },
    servers: [{ url: "https://api.example.com" }],
    paths: {
      "/products": {
        get: {
          summary: "Browse products",
          responses: { 200: { description: "Product list" } },
        },
      },
      "/products/{productId}": {
        get: {
          summary: "Get product details",
          parameters: [
            {
              name: "productId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: { 200: { description: "Product" } },
        },
      },
      "/cart": {
        get: {
          summary: "Read shopping cart",
          responses: { 200: { description: "Cart" } },
        },
        post: {
          summary: "Add item to cart",
          responses: { 201: { description: "Added" } },
        },
      },
      "/checkout": {
        post: {
          summary: "Complete checkout",
          responses: { 201: { description: "Order created" } },
        },
      },
      "/orders": {
        get: {
          summary: "Order history",
          responses: { 200: { description: "Orders" } },
        },
      },
    },
  },
  null,
  2,
);
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
export type RuntimeConfig = {
  default_p95_ms: number;
  default_virtual_users: number;
  max_virtual_users: number;
  max_p95_ms: number;
  test_duration: string;
  error_rate_budget: number;
  iteration_pause_seconds: number;
  contract_max_bytes: number;
  evidence_max_bytes: number;
  max_operations: number;
  ai_prompt_max_chars: number;
  ai_context_max_chars: number;
};
export function parseContract(text: string, config: RuntimeConfig): Contract {
  if (Buffer.byteLength(text, "utf8") > config.contract_max_bytes)
    throw new Error("Contract exceeds the configured size limit.");
  const doc = parseDocument(text, { uniqueKeys: true });
  if (doc.errors.length)
    throw new Error(
      "Invalid JSON or YAML: " + doc.errors[0].message.split("\n")[0],
    );
  const data = doc.toJS({
    maxAliasCount: number("validation", "yaml_max_aliases"),
  });
  if (
    !data ||
    typeof data !== "object" ||
    !/^3\.(0|1|2)\.\d+$/.test(String(data.openapi))
  )
    throw new Error(
      "Import an OpenAPI 3.0, 3.1, or 3.2 document. Swagger 2.0 must be converted first.",
    );
  if (
    typeof data.info?.title !== "string" ||
    typeof data.info?.version !== "string" ||
    !data.paths ||
    typeof data.paths !== "object" ||
    Array.isArray(data.paths)
  )
    throw new Error(
      "The contract needs info.title, info.version, and a paths object.",
    );
  if (
    !data.info.title.trim() ||
    data.info.title.length > number("validation", "contract_title_max_chars") ||
    !data.info.version.trim() ||
    data.info.version.length >
      number("validation", "contract_version_max_chars")
  )
    throw new Error("Contract title or version exceeds the configured limit.");
  const endpoints: Endpoint[] = [];
  const warnings: string[] = [];
  for (const [path, item] of Object.entries(data.paths)) {
    if (!path.startsWith("/")) continue;
    if (!item || typeof item !== "object")
      throw new Error("Invalid path item: " + path);
    if ("$ref" in item) {
      warnings.push("Referenced path " + path + " is not expanded.");
      continue;
    }
    for (const [method, op] of Object.entries(item)) {
      if (
        ![
          "get",
          "post",
          "put",
          "patch",
          "delete",
          "head",
          "options",
          "trace",
        ].includes(method)
      )
        continue;
      if (!op || typeof op !== "object" || Array.isArray(op))
        throw new Error("Invalid operation: " + method + " " + path);
      const o = record(op);
      const p = record(item);
      endpoints.push({
        method: method.toUpperCase(),
        path,
        summary:
          typeof o.summary === "string"
            ? o.summary
            : typeof o.operationId === "string"
              ? o.operationId
              : "Untitled operation",
        required: [
          ...(Array.isArray(p.parameters) ? p.parameters : []),
          ...(Array.isArray(o.parameters) ? o.parameters : []),
        ]
          .map(record)
          .filter((x) => x.required)
          .map(
            (x) =>
              `${typeof x.in === "string" ? x.in : "unknown"}: ${typeof x.name === "string" ? x.name : "unnamed"}`,
          ),
      });
    }
  }
  if (!endpoints.length)
    throw new Error(
      "No inline HTTP operations found. Expand referenced path items before importing.",
    );
  if (endpoints.length > config.max_operations)
    throw new Error("Contract exceeds the configured operation limit.");
  warnings.push(
    "Structural import only; external references, auth, request bodies, and parameter values require review before execution.",
  );
  const server =
    typeof data.servers?.[0]?.url === "string" ? data.servers[0].url : "";
  return {
    title: data.info.title,
    version: data.info.version,
    server,
    endpoints,
    warnings,
  };
}
export const toolkits = [
  {
    name: "Performance",
    tools: "k6 · Apache JMeter",
    slug: "performance",
    docs: "https://grafana.com/docs/k6/latest/",
    goal: "Establish latency, throughput, and error-rate limits under representative traffic.",
    steps: [
      "Agree on traffic mix, p95 latency, error budget, and test duration.",
      "Prepare authentication, representative data, and an isolated target environment.",
      "Run the exported k6 script; use JMeter for existing JMX suites.",
      "Correlate failures with Grafana and Jaeger, then compare against your baseline.",
    ],
    artifact: "performance.js",
    command:
      "k6 run --summary-export=summary.json -e BASE_URL=https://your-test-host performance.js",
  },
  {
    name: "Observability",
    tools: "Prometheus · Grafana",
    slug: "observability",
    docs: "https://prometheus.io/docs/prometheus/latest/querying/basics/",
    goal: "Use latency, traffic, errors, and saturation to explain the behavior seen during a test.",
    steps: [
      "Confirm your service exposes Prometheus metrics.",
      "Verify labels and metric names in your own deployment.",
      "Add the starter PromQL queries to your Grafana dashboard.",
      "Compare the same time window and release across tests.",
    ],
    artifact: "observability.md",
    command:
      "Open the queries in Grafana Explore using your Prometheus data source.",
  },
  {
    name: "APM & tracing",
    tools: "OpenTelemetry · Jaeger",
    slug: "apm",
    docs: "https://opentelemetry.io/docs/collector/",
    goal: "Trace slow requests across services and identify expensive dependencies.",
    steps: [
      "Instrument the application using the relevant OpenTelemetry SDK.",
      "Propagate W3C trace context across service boundaries.",
      "Connect the Collector to your Jaeger OTLP receiver.",
      "Use service, operation, and duration filters to examine slow spans.",
    ],
    artifact: "otel-collector.yaml",
    command: "otelcol --config=otel-collector.yaml",
  },
  {
    name: "UI / UX",
    tools: "Playwright · Lighthouse",
    slug: "ui",
    docs: "https://playwright.dev/docs/test-intro",
    goal: "Validate critical user journeys, layout, and browser experience.",
    steps: [
      "Set a UI target; OpenAPI alone cannot describe user journeys.",
      "Extend the Playwright starter with your actual user-facing locators.",
      "Review screenshot baselines before accepting visual changes.",
      "Run Lighthouse and combine lab scores with field data and user research.",
    ],
    artifact: "journey.spec.ts",
    command: "npx playwright test journey.spec.ts",
  },
  {
    name: "Chaos & resilience",
    tools: "LitmusChaos",
    slug: "chaos",
    docs: "https://docs.litmuschaos.io/",
    goal: "Test a recovery hypothesis with bounded fault injection and explicit abort conditions.",
    steps: [
      "Define a steady-state hypothesis and measurable recovery objective.",
      "Select a staging workload and assign an experiment owner.",
      "Use an existing LitmusChaos experiment with a minimal blast radius.",
      "Review probes, abort conditions, and rollback before running in ChaosCenter.",
    ],
    artifact: "resilience-plan.md",
    command:
      "Review the experiment brief, then configure it in your existing LitmusChaos ChaosCenter.",
  },
  {
    name: "Accessibility",
    tools: "axe-core · Playwright",
    slug: "accessibility",
    docs: "https://playwright.dev/docs/accessibility-testing",
    goal: "Find automated accessibility issues and prepare the necessary manual checks.",
    steps: [
      "Run axe-core on meaningful page states, including dialogs and errors.",
      "Triage violations by impact and verify fixes.",
      "Test keyboard navigation, visible focus, zoom, and a screen reader.",
      "Record manual evidence; an automated pass does not establish WCAG conformance.",
    ],
    artifact: "accessibility.spec.ts",
    command:
      "npm install -D @playwright/test @axe-core/playwright && npx playwright test accessibility.spec.ts",
  },
];
export function artifactFor(
  index: number,
  contract: Contract | null,
  selected: string[],
  target: string,
  p95: number,
  vus: number,
  config: RuntimeConfig,
) {
  const ops = (contract?.endpoints ?? []).filter((e) =>
    selected.includes(e.method + " " + e.path),
  );
  if (index === 0)
    return `// Starter generated from your contract. Review before execution.\n// Read-only operations only; supply real values for all path and query parameters.\nimport http from 'k6/http';\nimport { check, sleep } from 'k6';\nexport const options = { vus: ${vus}, duration: ${JSON.stringify(config.test_duration)}, thresholds: { http_req_duration: ['p(95)<${p95}'], http_req_failed: ['rate<${config.error_rate_budget}'] } };\nconst base = __ENV.BASE_URL;\nif (!base) throw new Error('Set BASE_URL to your approved test environment');\nconst paths = ${JSON.stringify(
      ops
        .filter(
          (e) =>
            e.method === "GET" && !e.path.includes("{") && !e.required.length,
        )
        .map((e) => e.path),
      null,
      2,
    )};\nif (!paths.length) throw new Error('Select a GET operation with no required parameters, or extend this script with fixtures');\nexport default function () {\n  for (const path of paths) {\n    const res = http.get(base.replace(/\\/$/, '') + path, { tags: { endpoint: path } });\n    check(res, { 'successful response': r => r.status >= 200 && r.status < 400 });\n  }\n  sleep(${config.iteration_pause_seconds});\n}\n// ${ops.filter((e) => e.method !== "GET" || e.path.includes("{") || e.required.length).length} selected operations omitted: need request fixtures or parameter values.\n`;
  if (index === 1)
    return `# Observability investigation\n\nService: ${contract?.title ?? "Your service"}\n\nThese are starter queries. Match names, labels, and units to your instrumentation.\n\n## Request rate\nsum(rate(http_requests_total[5m]))\n\n## Error ratio\nsum(rate(http_requests_total{status=~"5.."}[5m])) / sum(rate(http_requests_total[5m]))\n\n## p95 latency (classic histogram, seconds)\nhistogram_quantile(0.95, sum by (le) (rate(http_request_duration_seconds_bucket[5m])))\n\n## Investigation checklist\n- Scope queries to the tested service and environment.\n- Align the dashboard time range with the actual test.\n- Compare latency, CPU, memory, queues, and saturation.\n- Preserve dashboard links and test version as evidence.\n`;
  if (index === 2)
    return `# Requires an OpenTelemetry Collector and a Jaeger OTLP endpoint.\n# Set JAEGER_OTLP_ENDPOINT to host:4317; TLS is enabled by default.\nreceivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 0.0.0.0:4317\n      http:\n        endpoint: 0.0.0.0:4318\nprocessors:\n  batch: {}\nexporters:\n  otlp/jaeger:\n    endpoint: \${env:JAEGER_OTLP_ENDPOINT}\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      processors: [batch]\n      exporters: [otlp/jaeger]\n`;
  if (index === 3)
    return `import { test, expect } from '@playwright/test';\ntest('page loads and matches reviewed baseline', async ({ page }) => {\n  const target = process.env.UI_TARGET;\n  if (!target) throw new Error('Set UI_TARGET to your approved UI environment');\n  const response = await page.goto(target);\n  expect(response?.ok()).toBeTruthy();\n  await expect(page.locator('body')).toBeVisible();\n  // Add actual critical journeys and accessible locators here.\n  await expect(page).toHaveScreenshot('landing.png', { fullPage: true });\n});\n// Create and REVIEW the initial baseline with --update-snapshots.\n// Lighthouse: npx lighthouse <approved-ui-url> --output=json --output-path=./lighthouse.json\n`;
  if (index === 4)
    return `# Resilience experiment brief — review required\n\nService: ${contract?.title ?? "Your service"}\nTool: LitmusChaos\nSuggested experiment: pod-delete (select from your installed ChaosHub)\n\n## Hypothesis\nThe service remains available during the loss of one staging replica.\n\n## Required inputs before execution\n- Experiment owner and approval: TODO\n- Staging namespace and exact workload selector: TODO\n- Replica count and disruption budget: TODO\n- Baseline traffic and health probe: TODO\n- Maximum recovery time: TODO\n- Abort threshold and responsible operator: TODO\n- Rollback procedure: TODO\n\n## Execution\nConfigure the existing experiment in ChaosCenter, target the smallest approved scope, and attach probes. Do not run with unresolved inputs.\n\n## Evidence\nRecord actual steady state, fault timeline, recovery time, relevant Grafana/Jaeger links, and hypothesis outcome.\n`;
  return `import { test, expect } from '@playwright/test';\nimport AxeBuilder from '@axe-core/playwright';\nimport { writeFile } from 'node:fs/promises';\ntest('automated accessibility review', async ({ page }, testInfo) => {\n  const target = process.env.UI_TARGET;\n  if (!target) throw new Error('Set UI_TARGET to your approved UI environment');\n  await page.goto(target);\n  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();\n  await writeFile(testInfo.outputPath('axe-results.json'), JSON.stringify(results, null, 2));\n  expect(results.violations).toEqual([]);\n});\n// Add keyboard, screen-reader, focus order, and zoom checks manually.\n`;
}
export function parseEvidence(text: string, config: RuntimeConfig) {
  if (Buffer.byteLength(text, "utf8") > config.evidence_max_bytes)
    throw new Error("Evidence exceeds the configured size limit.");
  const d = record(JSON.parse(text)),
    metrics = record(d.metrics);
  const summarize = (value: unknown) =>
    JSON.stringify(value).slice(
      0,
      number("validation", "evidence_summary_max_chars"),
    );
  const finite = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  if (metrics.http_req_duration) {
    const duration = record(metrics.http_req_duration),
      latency = record(duration.values ?? duration),
      failed = record(metrics.http_req_failed),
      errors = record(failed.values ?? failed),
      requests = record(metrics.http_reqs),
      counts = record(requests.values ?? requests);
    if (!finite(latency["p(95)"]) || latency["p(95)"] < 0)
      throw new Error("k6 evidence must contain a valid p95 latency.");
    if (
      errors.rate !== undefined &&
      (!finite(errors.rate) || errors.rate < 0 || errors.rate > 1)
    )
      throw new Error("k6 evidence contains an invalid failure rate.");
    return {
      tool: "k6",
      facts: [
        ["p95 latency", latency["p(95)"].toFixed(1) + " ms"],
        [
          "Requests",
          finite(counts.count) && counts.count >= 0
            ? String(counts.count)
            : "Unavailable",
        ],
        [
          "Error rate",
          finite(errors.rate)
            ? (errors.rate * 100).toFixed(2) + "%"
            : "Unavailable",
        ],
      ],
      summary: summarize({ metrics }),
    };
  }
  if (Array.isArray(d.violations) && Array.isArray(d.passes)) {
    const violations = d.violations.map(record);
    if (
      violations.some((v) => v.nodes !== undefined && !Array.isArray(v.nodes))
    )
      throw new Error("Accessibility evidence contains invalid nodes.");
    return {
      tool: "axe-core",
      facts: [
        ["Violation rules", String(violations.length)],
        [
          "Affected nodes",
          String(
            violations.reduce(
              (n, v) => n + (Array.isArray(v.nodes) ? v.nodes.length : 0),
              0,
            ),
          ),
        ],
        ["Passing rules", String(d.passes.length)],
      ],
      summary: summarize({
        violations: violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          description: v.description,
          helpUrl: v.helpUrl,
          nodes: Array.isArray(v.nodes) ? v.nodes.length : 0,
        })),
      }),
    };
  }
  if (
    typeof d.lighthouseVersion === "string" &&
    Object.keys(record(d.categories)).length
  ) {
    const categories = record(d.categories);
    if (
      Object.values(categories).some((value) => {
        const score = record(value).score;
        return (
          score !== null &&
          score !== undefined &&
          (!finite(score) || score < 0 || score > 1)
        );
      })
    )
      throw new Error("Lighthouse evidence contains an invalid score.");
    return {
      tool: "Lighthouse",
      facts: Object.entries(categories).map(([key, value]) => {
        const score = record(value).score;
        return [
          key,
          finite(score) ? Math.round(score * 100) + "/100" : "Not scored",
        ];
      }),
      summary: summarize({
        categories,
        audits: Object.fromEntries(
          Object.entries(record(d.audits)).filter(([, value]) => {
            const score = record(value).score;
            return finite(score) && score < 1;
          }),
        ),
      }),
    };
  }
  throw new Error(
    "Use a k6 summary-export, axe-core results JSON, or Lighthouse JSON report.",
  );
}

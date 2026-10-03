import { assessmentCatalog } from "./schema.mjs";
export function assess(input, { contract = null, map = null } = {}) {
  const relevant = assessmentCatalog.inputs.filter(
    (f) => f.applies.includes("all") || f.applies.includes(input.kind),
  );
  const findings = [];
  const add = (
    id,
    title,
    classification,
    evidence,
    recommendation,
    priority = "medium",
  ) =>
    findings.push({
      id,
      title,
      classification,
      evidence,
      recommendation,
      priority,
      verification:
        "Confirm with service owners and collect dated observations from the existing toolchain.",
    });
  for (const field of relevant)
    if (!input.intake[field.key]?.trim())
      add(
        "missing-" + field.key,
        field.label + " is missing",
        "missing information",
        "No value supplied.",
        field.suggestion,
        "high",
      );
  if (!contract)
    add(
      "contract-missing",
      "No API contract attached",
      "missing information",
      "No OpenAPI contract selected.",
      "Attach OpenAPI for API scenario coverage; this is optional for applications without an API.",
    );
  else {
    for (const [index, warning] of (contract.warnings || []).entries())
      add(
        "contract-" + index,
        "API contract review",
        "observed configuration",
        warning,
        "Review and correct the contract warning before generating test scenarios.",
      );
    const writes = contract.endpoints.filter(
      (e) => !["GET", "HEAD", "OPTIONS"].includes(e.method),
    );
    if (
      writes.length &&
      ["performance", "resilience", "readiness", "release"].includes(input.kind)
    )
      add(
        "write-safety",
        "State-changing operations need safe data handling",
        "hypothesis",
        `${writes.length} state-changing API operations declared; runtime behavior has not been verified.`,
        "Define isolated test data, cleanup and idempotency expectations. Exclude destructive operations until reviewed.",
        "high",
      );
  }
  if (!map)
    add(
      "map-missing",
      "Architecture evidence is missing",
      "missing information",
      "No completed application map selected.",
      "Import a repository map or document service boundaries and dependencies.",
    );
  else {
    for (const [index, warning] of (map.warnings || []).entries())
      add(
        "map-" + index,
        "Static analysis limitation",
        "observed configuration",
        warning,
        "Review the map scope; validate declared connections with traces or architecture owners.",
      );
    if (map.edges?.length)
      add(
        "dependencies",
        "Dependency behavior needs validation",
        "hypothesis",
        `${map.edges.length} declared or source-import connections found by static analysis.`,
        "Review timeout, retry, failure propagation and trace coverage at these boundaries. Static connections do not prove runtime calls.",
      );
  }
  if (input.intake.baseline?.trim())
    add(
      "baseline-review",
      "Existing evidence requires contextual review",
      "hypothesis",
      "A user-supplied baseline or incident summary is present; no tool results were executed or independently verified.",
      "Check date, environment, workload and raw evidence references before treating a symptom as a confirmed defect.",
    );
  const supplied = relevant.filter((f) => input.intake[f.key]?.trim()).length;
  return {
    kind: input.kind,
    name: input.name.trim(),
    createdAt: new Date().toISOString(),
    stage: "pre-test",
    source: "deterministic rules",
    readiness: {
      supplied,
      total: relevant.length,
      missing: relevant.length - supplied,
    },
    intake: input.intake,
    findings,
    evidence: {
      contract: contract
        ? {
            id: input.contractId || null,
            title: contract.title,
            version: contract.version || null,
            operations: contract.endpoints.length,
          }
        : null,
      map: map
        ? {
            id: input.mapId || null,
            analyzedAt: map.generatedAt || null,
            nodes: map.nodes?.length || 0,
            edges: map.edges?.length || 0,
          }
        : null,
    },
    investigations: assessmentCatalog.investigations.filter(
      (c) =>
        ["readiness", "release"].includes(input.kind) || c.id === input.kind,
    ),
    limitations: [
      "No test or active scan was run.",
      "Provided requirements describe intent; they do not prove implementation.",
      "Static analysis cannot confirm runtime bottlenecks, resilience or accessibility conformance.",
      "This report supports planning; it is not a release approval or compliance certificate.",
    ],
    ai: null,
  };
}
export function markdownReport(report) {
  return [
    `# ${report.name}`,
    `Type: ${report.kind} · ${report.stage} · ${report.createdAt}`,
    `\n## Readiness\n${report.readiness.supplied}/${report.readiness.total} relevant inputs supplied.`,
    "\n## Findings & suggested checks",
    ...report.findings.map(
      (f) =>
        `\n### ${f.title}\n${f.priority} priority · ${f.classification}\n\nEvidence: ${f.evidence}\n\nSuggestion: ${f.recommendation}\n\nValidation: ${f.verification}`,
    ),
    "\n## Recommended investigations",
    ...report.investigations.map(
      (c) =>
        `\n### ${c.title}\nQuestion: ${c.question}\n\nTools: ${c.tools}\n\nEvidence needed: ${c.requiredEvidence}\n\nSuggested approach: ${c.suggestion}`,
    ),
    "\n## Supplied context",
    ...Object.entries(report.intake)
      .filter(([, v]) => v.trim())
      .map(([k, v]) => `\n### ${k}\n${v}`),
    "\n## Limitations",
    ...report.limitations.map((x) => "- " + x),
    ...(report.ai
      ? [
          `\n## AI suggestions · unverified draft\n${report.ai.content}\n\nProvider: ${report.ai.provider} · model: ${report.ai.model}`,
        ]
      : []),
  ].join("\n");
}

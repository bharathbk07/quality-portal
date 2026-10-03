const fail = (message) =>
  Object.assign(new Error(message), { statusCode: 400, expose: true });
export function dependencyImpact(graph, nodeId) {
  if (!graph.nodes.some((n) => n.id === nodeId))
    throw fail("Select an existing component");
  const walk = (direction) => {
    const seen = new Set([nodeId]);
    const queue = [nodeId];
    while (queue.length) {
      const id = queue.shift();
      for (const e of graph.edges) {
        const next =
          direction === "upstream"
            ? e.to === id && e.from
            : e.from === id && e.to;
        if (next && !seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    seen.delete(nodeId);
    return graph.nodes
      .filter((n) => seen.has(n.id))
      .map((n) => ({ id: n.id, label: n.label, kind: n.kind }));
  };
  return {
    nodeId,
    upstream: walk("upstream"),
    downstream: walk("downstream"),
    basis:
      "Transitive reachability over declared dependencies; not proof of cascading failure or runtime traffic.",
  };
}
export function auditMap(graph) {
  const findings = [];
  const add = (node, code, severity, title, detail, evidence = []) => {
    if (
      !findings.some(
        (f) =>
          f.nodeId === node.id &&
          f.code === code &&
          f.evidence[0]?.path === evidence[0]?.path,
      )
    )
      findings.push({
        nodeId: node.id,
        code,
        severity,
        title,
        detail,
        evidence,
        classification: "review finding; unverified at runtime",
      });
  };
  for (const n of graph.nodes) {
    const m = n.metadata || {};
    if (!m.primaryLanguage || m.primaryLanguage === "Unknown")
      add(
        n,
        "language-unknown",
        "info",
        "Language ownership needs evidence",
        "Import a supported build manifest/source directory to establish language and runtime.",
        n.evidence,
      );
    if (!m.owner)
      add(
        n,
        "owner-unknown",
        "info",
        "No declared owner",
        "Record a team and runbook before operational testing.",
        n.evidence,
      );
    for (const d of m.deployments || []) {
      if (d.replicas === 1 && graph.edges.some((e) => e.to === n.id))
        add(
          n,
          "single-replica",
          "warning",
          "Single declared replica on a dependency",
          "Potential availability concentration. Verify autoscaling, failover, disruption budgets and effective replicas before calling it a single point of failure.",
          [d.evidence],
        );
      if (d.platform === "Kubernetes")
        for (const c of d.containers || []) {
          if (!c.healthChecks?.length)
            add(
              n,
              "health-probes-unknown",
              "warning",
              "No health probe in analyzed container",
              "Effective admission/controller configuration may differ. Verify readiness, startup and liveness before resilience tests.",
              [d.evidence],
            );
          if (!c.requests?.cpu || !c.requests?.memory || !c.limits?.memory)
            add(
              n,
              "resource-sizing-gap",
              "warning",
              "Incomplete resource sizing evidence",
              "A traffic baseline and measured saturation are required to assess over/under-provisioning; manifest values alone are insufficient.",
              [d.evidence],
            );
          if (
            c.security?.allowPrivilegeEscalation === true ||
            c.security?.runAsNonRoot === false
          )
            add(
              n,
              "container-privilege",
              "warning",
              "Declared container privilege requires review",
              "Review least-privilege settings with platform owners. This is configuration evidence, not a verified exploit.",
              [d.evidence],
            );
        }
    }
  }
  return {
    findings,
    frameworks: [
      {
        name: "NIST CSF",
        scope:
          "Identify ownership/dependencies; Protect least privilege; Recover dependency review",
      },
      {
        name: "OWASP ASVS",
        scope:
          "Architecture and configuration review prompts; no certification or complete control assessment",
      },
    ],
    limits: [
      "No runtime scan, compliance certification, benchmark or fault injection was performed.",
      "Cache fallbacks, retries, circuit breakers and production capacity remain unknown unless supported by explicit evidence.",
    ],
  };
}
export function simulate(graph, input) {
  const node = graph.nodes.find((n) => n.id === input.nodeId);
  if (!node) throw fail("Select an existing component");
  const impact = dependencyImpact(graph, node.id);
  const heading =
    input.type === "outage"
      ? `Hypothetical outage of ${node.label}`
      : input.type === "traffic"
        ? `Hypothetical ${input.multiplier}× traffic at ${node.label}`
        : `Proposed technology replacement for ${node.label}`;
  const findings =
    input.type === "outage"
      ? [
          `Declared upstream dependants (${impact.upstream.map((n) => n.label).join(", ") || "none detected"}) may be affected if these dependencies are synchronous or required.`,
          node.kind === "cache"
            ? "Cache miss behavior, fail-open policy, TTL, database amplification and fallback mechanisms are unknown. Trace and review implementations before assuming an outage propagates."
            : "Retries, timeouts, buffering, circuit breakers and alternative replicas are unknown; graph reachability does not prove a cascade.",
        ]
      : input.type === "traffic"
        ? [
            `A ${input.multiplier}× workload could increase demand along downstream paths: ${impact.downstream.map((n) => n.label).join(", ") || "none detected"}.`,
            `Latency, throughput, resource usage and bottleneck capacity cannot be predicted without baseline measurements, request mix and saturation curves.`,
          ]
        : [
            `Replacing ${node.label} with ${input.replacement} requires checking clients, data models, protocols, consistency, migration, backup and operational compatibility.`,
            `Dependent components to review: ${impact.upstream.map((n) => n.label).join(", ") || "none detected"}. No compatibility or cost outcome has been verified.`,
          ];
  return {
    title: heading,
    type: input.type,
    nodeId: node.id,
    impact,
    findings,
    assumptions: [
      "Static declared topology; runtime configuration and traffic may differ.",
      "No deployment changes, load generation, cache eviction or destructive action was performed.",
    ],
    requiredEvidence: [
      "Representative request traces and workload baseline",
      "Effective deployment/autoscaling configuration",
      "Timeout/retry/fallback implementations and owner review",
    ],
    classification: "hypothetical structural scenario",
  };
}
export function knowledge(graph, question, annotations = {}) {
  const q = question.toLowerCase();
  const matched = graph.nodes.filter(
    (n) =>
      q.includes(n.label.toLowerCase()) ||
      n.label.toLowerCase().includes(q.trim()),
  );
  if (!matched.length)
    return {
      answer:
        "No uniquely named component matches this question. Choose a component by its exact map label or enable the optional AI explanation. Unknown facts will remain unknown.",
      citations: [],
      context: [],
    };
  const context = matched.map((n) => {
    const impact = dependencyImpact(graph, n.id);
    const owner = annotations[n.id]?.owner || n.metadata?.owner || "Unknown";
    return {
      id: n.id,
      label: n.label,
      owner,
      language: n.metadata?.primaryLanguage || "Unknown",
      upstream: impact.upstream.map((n) => n.label),
      downstream: impact.downstream.map((n) => n.label),
      notes: annotations[n.id]?.notes || "",
      evidence: n.evidence,
    };
  });
  const answer = context
    .map((n) =>
      /owner|contact|team/.test(q)
        ? `${n.label}: primary owner/contact team is ${n.owner}.`
        : /depend|upstream|impact|outage|crash/.test(q)
          ? `${n.label}: upstream dependants are ${n.upstream.join(", ") || "none detected"}. Downstream dependencies are ${n.downstream.join(", ") || "none detected"}. These are declared relationships, not verified runtime calls.`
          : `${n.label} (${n.language}): interacts with ${n.downstream.join(", ") || "no downstream components detected"}; is used by ${n.upstream.join(", ") || "no upstream components detected"}. Owner: ${n.owner}.`,
    )
    .join("\n\n");
  return { answer, citations: context.flatMap((n) => n.evidence), context };
}
const cpu = (v) =>
  typeof v === "string" && /^\d+(?:\.\d+)?m$/.test(v)
    ? Number(v.slice(0, -1)) / 1000
    : Number(v);
const memory = (v) => {
  const m = /^(\d+(?:\.\d+)?)([KMGTE]i?|)$/.exec(String(v || ""));
  if (!m) return NaN;
  const base = m[2].endsWith("i") ? 1024 : 1000;
  const power = { K: 1, M: 2, G: 3, T: 4, E: 5 }[m[2][0]] || 0;
  return (Number(m[1]) * base ** power) / 1024 ** 3;
};
export function forecastCost(graph, input) {
  const rows = input.items.map((item) => {
    const n = graph.nodes.find((n) => n.id === item.nodeId);
    if (!n) throw fail("Pricing references an unknown component");
    const deployments = (n.metadata?.deployments || []).filter(
      (d) => d.platform === "Kubernetes",
    );
    const d = deployments.length === 1 ? deployments[0] : null;
    const replicas = item.replicas ?? d?.replicas;
    const containers = d?.containers || [];
    const cores = containers.length
      ? containers.reduce((sum, c) => sum + cpu(c.requests?.cpu), 0)
      : NaN;
    const gib = containers.length
      ? containers.reduce((sum, c) => sum + memory(c.requests?.memory), 0)
      : NaN;
    const missing = [];
    if (!replicas) missing.push("replica quantity");
    if (item.cpuHour !== undefined && !Number.isFinite(cores))
      missing.push("CPU requests");
    if (item.memoryGiBHour !== undefined && !Number.isFinite(gib))
      missing.push("memory requests");
    if (
      item.cpuHour === undefined &&
      item.memoryGiBHour === undefined &&
      item.flatHour === undefined &&
      item.storageGiBMonth === undefined
    )
      missing.push("unit pricing");
    if (item.storageGiBMonth !== undefined && item.storageGiB === undefined)
      missing.push("storage quantity");
    const monthly = missing.length
      ? null
      : replicas *
        (input.hours *
          ((item.cpuHour || 0) * (Number.isFinite(cores) ? cores : 0) +
            (item.memoryGiBHour || 0) * (Number.isFinite(gib) ? gib : 0) +
            (item.flatHour || 0)) +
          (item.storageGiBMonth || 0) * (item.storageGiB || 0));
    return {
      nodeId: n.id,
      label: n.label,
      environment: d?.environment || "Unspecified",
      replicas: replicas || null,
      cpuCores: Number.isFinite(cores) ? cores : null,
      memoryGiB: Number.isFinite(gib) ? gib : null,
      monthly: monthly === null ? null : Math.round(monthly * 100) / 100,
      missing,
    };
  });
  return {
    currency: input.currency,
    hours: input.hours,
    rows,
    total: rows.some((r) => r.monthly === null)
      ? null
      : Math.round(rows.reduce((sum, r) => sum + r.monthly, 0) * 100) / 100,
    pricedSubtotal:
      Math.round(rows.reduce((sum, r) => sum + (r.monthly || 0), 0) * 100) /
      100,
    coverage: {
      priced: rows.filter((r) => r.monthly !== null).length,
      submitted: rows.length,
      mapComponents: graph.nodes.length,
    },
    assumptions: [
      "User-supplied rates; Kubernetes requested resources and specified replica quantities; storage charges assumed per replica.",
      "This is a conditional unit-cost estimate, not a cloud quote or full hosting bill. Shared nodes, packing, regions, discounts, egress, taxes, managed-service SKUs and autoscaling are excluded.",
      "No live utilization or workload baseline: over/under-provisioning cannot be concluded from specifications alone.",
    ],
  };
}
export function mapDocumentation(graph, type, annotations = {}) {
  const rows = graph.nodes.map((n) => ({
    n,
    m: n.metadata || {},
    a: annotations[n.id] || {},
  }));
  if (type === "api")
    return {
      format: "yaml",
      content:
        "openapi: 3.1.0\ninfo:\n  title: Architecture API inventory (draft)\n  version: 0.0.0\n  description: No HTTP operation contracts can be inferred safely from a topology map. Import actual OpenAPI specifications to populate paths.\npaths: {}\n",
      warning:
        "Draft shell only. Methods, schemas and authorization are unknown; no endpoints invented.",
    };
  const title =
    type === "runbook"
      ? "Operational review runbook (draft)"
      : type === "onboarding"
        ? "Architecture onboarding guide"
        : "Repository architecture README";
  let content = `# ${title}\n\nStatic repository evidence; runtime behavior requires verification.\n\n`;
  for (const { n, m, a } of rows) {
    content += `## ${n.label}\n\n- Function: ${n.kind}\n- Language: ${m.primaryLanguage || "Unknown"}\n- Owner: ${a.owner || m.owner || "Unknown"}\n- Dependencies: ${
      graph.edges
        .filter((e) => e.from === n.id)
        .map((e) => graph.nodes.find((n) => n.id === e.to)?.label)
        .join(", ") || "None detected"
    }\n- Cache declarations: ${(m.caching || []).map((c) => c.name).join(", ") || "Unknown"}\n- Evidence: ${n.evidence.map((e) => `${e.path}:${e.line}`).join(", ")}\n`;
    if (a.notes) content += `\nOwner notes (unverified): ${a.notes}\n`;
    if (type === "runbook")
      content +=
        "\n1. Confirm active environment and effective deployment with the owner.\n2. Inspect readiness, traces, error rates and resource saturation in existing monitoring tools.\n3. Review fallback and recovery procedures; obtain approval before any fault injection.\n4. Record evidence, impact and recovery criteria. Executable recovery commands are not inferred.\n";
  }
  content +=
    "\n## Known limits\n\n" + graph.warnings.map((w) => "- " + w).join("\n");
  return { format: "markdown", content };
}

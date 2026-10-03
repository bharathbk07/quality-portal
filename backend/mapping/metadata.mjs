import { readFileSync } from "node:fs";
import path from "node:path";
import { parseAllDocuments } from "yaml";
import { promptDirectory } from "../shared/prompts.mjs";
import { number } from "../shared/config.mjs";
export const discovery = JSON.parse(
  readFileSync(
    path.join(promptDirectory(), "application-maps/discovery.json"),
    "utf8",
  ),
);
const clean = (s) =>
  String(s || "")
    .replace(/[\x00-\x1f<>]/g, " ")
    .slice(0, 300);
const safeResources = (values) =>
  Object.fromEntries(
    Object.entries(values || {})
      .filter(
        ([key, value]) =>
          ["cpu", "memory", "ephemeral-storage", "storage"].includes(key) &&
          ["string", "number"].includes(typeof value),
      )
      .map(([key, value]) => [key, clean(value)]),
  );
const docEvidence = (doc, file, keys, detail) => ({
  path: file.path,
  line: file.content
    .slice(0, doc.getIn(keys, true)?.range?.[0] || doc.range?.[0] || 0)
    .split("\n").length,
  detail,
});
const ev = (file, key, detail = key) => ({
  path: file.path,
  line: file.content
    .slice(0, Math.max(0, file.content.indexOf(key)))
    .split("\n").length,
  detail: clean(detail),
});
export function annotateGraph(graph, files, roots, policy) {
  const infrastructure = [],
    pipelines = [];
  for (const file of files) {
    if (/^\.github\/workflows\/.*\.ya?ml$/.test(file.path))
      pipelines.push({
        system: "GitHub Actions",
        path: file.path,
        evidence: ev(
          file,
          "jobs:",
          "Pipeline definition; deployment linkage unknown",
        ),
      });
    if (path.posix.basename(file.path).toLowerCase() === "jenkinsfile")
      pipelines.push({
        system: "Jenkins",
        path: file.path,
        evidence: ev(
          file,
          "pipeline",
          "Pipeline definition; deployment linkage unknown",
        ),
      });
    if (file.path.endsWith(".tf"))
      for (const m of file.content.matchAll(
        /\bresource\s+"([\w-]+)"\s+"([\w-]+)"\s*\{/g,
      ))
        infrastructure.push({
          id: `infra-${infrastructure.length}`,
          type: m[1],
          name: m[2],
          provider: m[1].split("_")[0],
          evidence: ev(file, m[0], "Terraform resource declaration"),
        });
  }
  graph.infrastructure = infrastructure.slice(0, policy.maxNodes);
  graph.pipelines = pipelines;
  for (const n of graph.nodes) {
    const ownedRoots = roots.filter((r) => r.id === n.id).map((r) => r.root);
    const owned = files.filter(
      (f) =>
        ownedRoots.some((r) => !r || f.path.startsWith(r + "/")) &&
        !/(^|\/)(test|tests)(\/|$)/.test(f.path),
    );
    const counts = new Map();
    for (const f of owned) {
      const language = discovery.languages[path.posix.extname(f.path)];
      if (language) counts.set(language, (counts.get(language) || 0) + 1);
    }
    const languages = [...counts]
      .sort((a, b) => b[1] - a[1])
      .map(([name, fileCount]) => ({ name, fileCount }));
    const manifests = owned.filter(
      (f) =>
        policy.manifestNames.includes(
          path.posix.basename(f.path).toLowerCase(),
        ) || policy.manifestExtensions?.includes(path.posix.extname(f.path).toLowerCase()),
    );
    const runtimes = discovery.runtimes.flatMap((r) => {
      const f = manifests.find((f) =>
        new RegExp(`(^|[^a-z0-9_-])${r.pattern}([^a-z0-9_-]|$)`, "im").test(
          f.content.split("\n").filter((line) => !/^\s*(?:#|\/\/|\*|<!--)/.test(line)).join("\n"),
        ),
      );
      return f
        ? [
            {
              name: r.name,
              evidence: ev(f, r.pattern, "Runtime dependency declaration"),
            },
          ]
        : [];
    });
    const caching = [];
    for (const pattern of discovery.cachePatterns)
      for (const f of owned.filter(
        (f) => discovery.languages[path.posix.extname(f.path)],
      )) {
        const lines = f.content.split("\n");
        const i = lines.findIndex(
          (line) =>
            !/^\s*(#|\/\/|\*)/.test(line) && line.includes(pattern.pattern),
        );
        if (
          i >= 0 &&
          (pattern.name !== "Cache client candidate" ||
            /(?:from\s+["'](?:io)?redis|require\(["'](?:io)?redis)/.test(
              f.content,
            ))
        )
          caching.push({
            name: pattern.name,
            mechanism: pattern.mechanism,
            certainty: "source declaration; runtime behavior unverified",
            evidence: { path: f.path, line: i + 1, detail: pattern.name },
          });
      }
    n.metadata = {
      languages,
      primaryLanguage: languages[0]?.name || "Unknown",
      runtimes,
      sourceRoots: ownedRoots,
      caching,
      ports: [],
      serviceEndpoints: [],
      healthChecks: [],
      runtimeFlags: [],
      deployments: [],
      owner: "",
      documentation: [],
      notes: "",
    };
    for (const f of files.filter(
      (f) =>
        n.evidence.some((e) => e.path === f.path) && /\.ya?ml$/.test(f.path),
    )) {
      try {
        for (const doc of parseAllDocuments(f.content, { uniqueKeys: true })) {
          if (doc.errors.length) continue;
          const d = doc.toJS({
            maxAliasCount: number("validation", "yaml_max_aliases"),
          });
          if (
            d?.kind === "Service" &&
            n.evidence.some(
              (e) =>
                e.path === f.path &&
                e.detail === "Kubernetes Service " + d.metadata?.name,
            )
          ) {
            n.metadata.serviceEndpoints.push({
              name: clean(d.metadata.name),
              type: clean(d.spec?.type || "ClusterIP"),
              namespace: clean(d.metadata.namespace || "default"),
              ports: (d.spec?.ports || [])
                .map((p) => ({
                  port: p.port,
                  targetPort: p.targetPort ?? p.port,
                  protocol: clean(p.protocol || "TCP"),
                }))
                .filter(
                  (p) =>
                    Number.isInteger(p.port) && p.port > 0 && p.port <= 65535,
                ),
              evidence: docEvidence(
                doc,
                f,
                ["spec", "ports"],
                "Declared Service ports; effective networking unknown",
              ),
            });
          }
          if (
            !d ||
            d.metadata?.name !== n.label ||
            !["Deployment", "StatefulSet", "DaemonSet"].includes(d.kind)
          )
            continue;
          const labels =
            d.spec?.template?.metadata?.labels || d.metadata?.labels || {};
          const containers = (d.spec?.template?.spec?.containers || []).map(
            (c) => ({
              name: clean(c.name),
              image: clean(c.image),
              ports: (c.ports || [])
                .map((p) => ({
                  port: p.containerPort,
                  protocol: clean(p.protocol || "TCP"),
                }))
                .filter(
                  (p) =>
                    Number.isInteger(p.port) && p.port > 0 && p.port <= 65535,
                ),
              requests: safeResources(c.resources?.requests),
              limits: safeResources(c.resources?.limits),
              healthChecks: [
                "readinessProbe",
                "livenessProbe",
                "startupProbe",
              ].flatMap((type) =>
                c[type]
                  ? [
                      {
                        type,
                        path: clean(c[type].httpGet?.path),
                        port:
                          c[type].httpGet?.port ||
                          c[type].tcpSocket?.port ||
                          null,
                        mechanism: c[type].httpGet
                          ? "HTTP"
                          : c[type].tcpSocket
                            ? "TCP"
                            : "command (contents withheld)",
                      },
                    ]
                  : [],
              ),
              runtimeFlags: (c.env || []).map((e) => clean(e.name)),
              security: {
                runAsNonRoot:
                  c.securityContext?.runAsNonRoot ??
                  d.spec?.template?.spec?.securityContext?.runAsNonRoot ??
                  null,
                readOnlyRootFilesystem:
                  c.securityContext?.readOnlyRootFilesystem ?? null,
                allowPrivilegeEscalation:
                  c.securityContext?.allowPrivilegeEscalation ?? null,
              },
            }),
          );
          n.metadata.owner = clean(labels.team || labels.owner);
          n.metadata.deployments.push({
            platform: "Kubernetes",
            kind: d.kind,
            namespace: clean(d.metadata.namespace || "default"),
            environment: clean(
              labels.environment || labels.env || "Unspecified",
            ),
            replicas: Number.isInteger(d.spec?.replicas)
              ? d.spec.replicas
              : null,
            containers,
            evidence: docEvidence(
              doc,
              f,
              ["kind"],
              "Declared deployment; effective runtime configuration unknown",
            ),
          });
          n.metadata.ports.push(...containers.flatMap((c) => c.ports));
          n.metadata.healthChecks.push(
            ...containers.flatMap((c) => c.healthChecks),
          );
          n.metadata.runtimeFlags.push(
            ...containers.flatMap((c) => c.runtimeFlags),
          );
        }
      } catch {
        /* Unsupported templates remain outside the verified topology. */
      }
    }
    if (n.kind === "cache")
      n.metadata.caching.push({
        name: n.label,
        mechanism: "declared cache layer",
        certainty: "deployment declaration",
        evidence: n.evidence[0],
      });
    // Compose metadata: record safe deployment fields, never command bodies or environment values.
    for (const f of files.filter(
      (f) =>
        n.evidence.some((e) => e.path === f.path) &&
        /compose.*\.ya?ml$/.test(f.path),
    ))
      try {
        for (const doc of parseAllDocuments(f.content)) {
          const svc = doc.toJS({
            maxAliasCount: number("validation", "yaml_max_aliases"),
          })?.services?.[n.label];
          if (svc)
            n.metadata.deployments.push({
              platform: "Compose",
              environment: "Unspecified",
              image: clean(svc.image),
              buildContext: clean(
                typeof svc.build === "string" ? svc.build : svc.build?.context,
              ),
              replicas: svc.deploy?.replicas ?? null,
              healthCheck: !!svc.healthcheck,
              resources: svc.deploy?.resources || {},
              evidence: ev(f, n.label + ":", "Compose service declaration"),
            });
        }
      } catch {}
  }
  graph.metadataVersion = "1";
  graph.warnings.push(
    "Language counts, cache annotations and infrastructure declarations describe repository evidence only. CI/CD definitions are not proof of deployment, cache hits, ownership or runtime settings.",
  );
  return graph;
}

"use client";
import { lazy, Suspense, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { download } from "@/shared/download";
import { useMapStudio } from "./use-map-studio";
import { studioApi } from "./studio-api";
import type { Options, Annotation, Scenario, Revision } from "./studio-types";
const MapCopilot = lazy(() => import("./map-copilot"));
const ArchitectureCanvas = lazy(() => import("./architecture-canvas"));
const ServiceInspector = lazy(() => import("./service-inspector"));
const IntelligencePanel = lazy(() => import("./intelligence-panel"));
const ScenarioPanel = lazy(() => import("./scenario-panel"));
const CostPanel = lazy(() => import("./cost-panel"));
const initialOptions: Options = {
  view: "logical",
  groupBy: "none",
  layout: "hierarchical",
  search: "",
  environment: "all",
  revision: 0,
};
type Draft = {
  annotations: Record<string, Annotation>;
  positions: Record<string, { x: number; y: number }>;
  baseVersion: number;
};
export default function MapStudio({
  mapId,
  scope,
  canEdit,
  aiConfigured,
}: {
  mapId: string;
  scope: string | undefined;
  canEdit: boolean;
  aiConfigured: boolean;
}) {
  const [options, setOptions] = useState(initialOptions);
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState("canvas");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [label, setLabel] = useState("");
  const [kind, setKind] = useState<Revision["kind"]>("current");
  const [scenario, setScenario] = useState<Scenario | undefined>();
  const [compareFrom, setCompareFrom] = useState(-1);
  const [compareTo, setCompareTo] = useState(0);
  const [notice, setNotice] = useState("");
  const { studio, impact, save } = useMapStudio(
    mapId,
    scope,
    options,
    selected,
  );
  const comparison = useQuery({
    queryKey: [
      "map-comparison",
      scope,
      mapId,
      compareFrom,
      compareTo,
      studio.data?.latestVersion,
    ],
    enabled: tab === "snapshots",
    queryFn: () => studioApi.compare(mapId, compareFrom, compareTo),
    retry: false,
  });
  const exportMap = useMutation({
    mutationFn: () => studioApi.export(mapId, options),
    onSuccess: ({ svg }) =>
      download("architecture-view.svg", svg, "image/svg+xml"),
  });
  const grouping = useMutation({ mutationFn: () => studioApi.grouping(mapId) });
  const data = studio.data;
  if (studio.isPending)
    return (
      <div className="map-progress" role="status">
        Preparing architecture views…
      </div>
    );
  if (studio.error)
    return (
      <p role="alert" className="error">
        {studio.error.message}
      </p>
    );
  if (!data) return null;
  const component = data.components.find((n) => n.id === selected);
  const annotations = draft?.annotations || data.annotations;
  const patchOptions = (patch: Partial<Options>) => {
    setOptions({ ...options, ...patch });
    setSelected("");
    if (patch.revision !== undefined) setDraft(null);
  };
  const updateDraft = (patch: Partial<Draft>) =>
    setDraft((current) => ({
      ...current,
      annotations: current?.annotations || data.annotations,
      positions: current?.positions || data.revision?.positions || {},
      baseVersion: current?.baseVersion ?? data.latestVersion,
      ...patch,
    }));
  const saveSnapshot = async () => {
    try {
      const body = {
        expectedVersion: draft?.baseVersion ?? data.latestVersion,
        label,
        kind,
        annotations,
        positions: draft?.positions || data.revision?.positions || {},
        view: options.view,
        groupBy: options.groupBy,
        layout: options.layout,
        ...(kind === "proposed" && scenario ? { scenario } : {}),
      };
      const result = await save.mutateAsync(body);
      setDraft(null);
      setOptions({ ...options, revision: result.version });
      setNotice(
        `Snapshot v${result.version} saved. Workspace members can open it with their existing access.`,
      );
    } catch {}
  };
  const revisionOptions = (
    <>
      <option value={-1}>Repository base</option>
      <option value={0}>Latest saved state</option>
      {data.revisions.map((r) => (
        <option value={r.version} key={r.id}>
          v{r.version} · {r.kind} · {r.label}
        </option>
      ))}
    </>
  );
  const highlight = [
    selected,
    ...(impact.data?.upstream.map((n) => n.id) || []),
    ...(impact.data?.downstream.map((n) => n.id) || []),
  ];
  return (
    <section className="map-studio">
      <details className="studio-export-options">
        <summary>Share & export view</summary>
        <div className="row">
          <button
            className="secondary"
            onClick={() => {
              void navigator.clipboard
                .writeText(window.location.origin + data.sharePath)
                .then(() =>
                  setNotice(
                    "Workspace link copied. Sign-in and workspace access are required.",
                  ),
                )
                .catch(() =>
                  setNotice(window.location.origin + data.sharePath),
                );
            }}
          >
            Copy link
          </button>
          <button
            className="secondary"
            disabled={exportMap.isPending}
            onClick={() => exportMap.mutate()}
          >
            Export SVG
          </button>
          <button
            className="secondary"
            onClick={() =>
              download(
                "architecture-snapshot.json",
                JSON.stringify(data, null, 2),
              )
            }
          >
            Snapshot JSON
          </button>
        </div>
      </details>
      {!data.metadataAvailable && (
        <p className="notice">
          This map uses an older analyzer. Refresh the Git repository above or
          re-import its files to collect language, deployment, caching and
          pipeline metadata.
        </p>
      )}
      {(notice || save.error || exportMap.error) && (
        <p
          className={save.error || exportMap.error ? "error" : "notice"}
          role="status"
        >
          {save.error?.message || exportMap.error?.message || notice}
        </p>
      )}
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="studio-tabs">
          <TabsTrigger value="canvas">Explore architecture</TabsTrigger>
          <TabsTrigger value="intelligence">
            Reports & documentation
          </TabsTrigger>
          <label className="studio-more-tools">
            <span className="sr-only">Advanced map tools</span>
            <select
              className="field"
              value={
                ["scenarios", "costs", "snapshots"].includes(tab) ? tab : ""
              }
              onChange={(e) => setTab(e.target.value)}
            >
              <option value="" disabled>
                More tools
              </option>
              <option value="scenarios">What-if scenarios</option>
              <option value="costs">Cost & capacity</option>
              <option value="snapshots">Snapshots & proposed changes</option>
            </select>
          </label>
        </TabsList>
        <TabsContent value="canvas">
          <div
            className="studio-view-switch"
            role="group"
            aria-label="Architecture perspective"
          >
            {(
              [
                ["high-level", "Overview"],
                ["logical", "Services & flows"],
                ["deployment", "Deployment"],
              ] as const
            ).map(([view, title]) => (
              <button
                key={view}
                className={options.view === view ? "tag selected" : "tag"}
                aria-pressed={options.view === view}
                onClick={() => patchOptions({ view })}
              >
                {title}
              </button>
            ))}
          </div>
          <details className="studio-filter-options">
            <summary>View & filters</summary>
            <div className="studio-controls">
              <label>
                View
                <select
                  className="field"
                  value={options.view}
                  onChange={(e) =>
                    patchOptions({ view: e.target.value as Options["view"] })
                  }
                >
                  <option value="high-level">High-level architecture</option>
                  <option value="logical">Logical dependencies</option>
                  <option value="deployment">
                    Deployment & infrastructure
                  </option>
                </select>
              </label>
              <label>
                Boundaries
                <select
                  className="field"
                  value={options.groupBy}
                  onChange={(e) =>
                    patchOptions({
                      groupBy: e.target.value as Options["groupBy"],
                    })
                  }
                >
                  {[
                    "none",
                    "function",
                    "language",
                    "team",
                    "environment",
                    "namespace",
                    "custom",
                  ].map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Layout
                <select
                  className="field"
                  value={options.layout}
                  onChange={(e) =>
                    patchOptions({
                      layout: e.target.value as Options["layout"],
                    })
                  }
                >
                  <option value="hierarchical">Hierarchical</option>
                  <option value="tree">Tree</option>
                  <option value="swimlanes">Swimlanes</option>
                </select>
              </label>
              <label>
                Environment
                <select
                  className="field"
                  value={options.environment}
                  onChange={(e) =>
                    patchOptions({ environment: e.target.value })
                  }
                >
                  <option value="all">All declared environments</option>
                  {data.projection.environments.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
              <label>
                Search
                <input
                  className="field"
                  value={options.search}
                  onChange={(e) => patchOptions({ search: e.target.value })}
                  placeholder="Service, language, owner, cache"
                  maxLength={300}
                />
              </label>
            </div>
            <div className="row">
              <button
                className="secondary"
                disabled={!canEdit || !aiConfigured || grouping.isPending}
                onClick={() => grouping.mutate()}
              >
                Suggest boundaries with AI
              </button>
              {grouping.error && (
                <p role="alert" className="error">
                  {grouping.error.message}
                </p>
              )}
              {grouping.data && (
                <button
                  className="secondary"
                  onClick={() => {
                    const next = { ...annotations };
                    for (const [id, proposal] of Object.entries(
                      grouping.data!.annotations,
                    ))
                      next[id] = { ...next[id], ...proposal };
                    updateDraft({ annotations: next });
                    setKind("proposed");
                    setTab("snapshots");
                    setNotice(
                      grouping.data!.summary +
                        " Review and save this proposed snapshot, then choose Custom boundaries to display it.",
                    );
                  }}
                >
                  Attach proposed boundaries to snapshot
                </button>
              )}
            </div>
          </details>
          <div className="studio-legend">
            <span>● Frontend / services</span>
            <span>● Data / cache / queues</span>
            <span>→ Declared relationship</span>
            <span>
              {data.projection.visibleComponents} visible ·{" "}
              {data.projection.totalComponents} components
            </span>
            <button className="tool-link" onClick={() => studio.refetch()}>
              Auto-organize saved layout
            </button>
          </div>
          <div className="studio-explore-workspace">
            <div className="studio-explore-map">
              <div className="studio-grid no-inspector">
                <Suspense fallback={<p>Loading canvas…</p>}>
                  <ArchitectureCanvas
                    key={`${studio.dataUpdatedAt}:${options.view}:${options.groupBy}:${options.layout}`}
                    initialNodes={data.projection.nodes}
                    initialEdges={data.projection.edges}
                    highlight={highlight}
                    onSelect={(ids) =>
                      setSelected(
                        ids.find((id) =>
                          data.components.some((n) => n.id === id),
                        ) || "",
                      )
                    }
                    onPositions={(positions) => updateDraft({ positions })}
                  />
                </Suspense>
                {component && (
                  <Suspense fallback={<p>Loading details…</p>}>
                    <ServiceInspector
                      key={`${component.id}:${options.revision}`}
                      component={component}
                      annotation={annotations[component.id] || {}}
                      impact={impact.data}
                      canEdit={canEdit}
                      maxChars={data.limits.textMaxChars}
                      onChange={(value) =>
                        updateDraft({
                          annotations: {
                            ...annotations,
                            [component.id]: value,
                          },
                        })
                      }
                    />
                  </Suspense>
                )}
              </div>
            </div>
            <Suspense fallback={<p>Loading map copilot…</p>}>
              <MapCopilot
                key={`${mapId}:${options.revision}`}
                mapId={mapId}
                data={data}
                component={component}
                revision={options.revision}
                canEdit={canEdit}
                aiConfigured={aiConfigured}
                onInspect={setSelected}
              />
            </Suspense>
          </div>
          <details className="studio-component-picker">
            <summary>Browse components · {data.components.length}</summary>
            <div className="studio-components">
              <span className="muted">Inspect:</span>
              {data.components.map((n) => (
                <button
                  key={n.id}
                  className={selected === n.id ? "tag selected" : "tag"}
                  onClick={() => setSelected(n.id)}
                >
                  {n.label}{" "}
                  <small>{n.metadata?.primaryLanguage || "Unknown"}</small>
                </button>
              ))}
            </div>
          </details>
          <details className="studio-section">
            <summary>CI/CD and infrastructure inventory</summary>
            <p className="muted">
              Definitions only; no live cloud discovery or pipeline execution.
            </p>
            {data.pipelines.map((p) => (
              <p key={p.path}>
                <strong>{p.system}</strong> · {p.path}:{p.evidence.line}
              </p>
            ))}
            {data.infrastructure.map((i) => (
              <p key={`${i.evidence.path}:${i.name}`}>
                <strong>{i.name}</strong> · {i.provider} · {i.type} ·{" "}
                {i.evidence.path}:{i.evidence.line}
              </p>
            ))}
            {!data.pipelines.length && !data.infrastructure.length && (
              <p>
                No supported CI/CD or Terraform definitions detected in this
                import.
              </p>
            )}
          </details>
        </TabsContent>
        <TabsContent value="intelligence">
          <Suspense fallback={<p>Loading review tools…</p>}>
            <IntelligencePanel
              mapId={mapId}
              data={data}
              canEdit={canEdit}
              aiConfigured={aiConfigured}
              revision={options.revision}
            />
          </Suspense>
        </TabsContent>
        <TabsContent value="scenarios">
          <Suspense fallback={<p>Loading scenario tools…</p>}>
            <ScenarioPanel
              mapId={mapId}
              data={data}
              canEdit={canEdit}
              aiConfigured={aiConfigured}
              onPropose={(value) => {
                setScenario(value);
                setKind("proposed");
                setTab("snapshots");
                setNotice(
                  "Scenario attached to the next proposed snapshot. No application changes were made.",
                );
              }}
            />
          </Suspense>
        </TabsContent>
        <TabsContent value="costs">
          <Suspense fallback={<p>Loading cost tools…</p>}>
            <CostPanel mapId={mapId} data={data} canEdit={canEdit} />
          </Suspense>
          <div className="studio-section">
            <h3>Capacity review</h3>
            <p>
              Declared resource sizes alone do not establish
              over/under-provisioning. Collect representative k6 workload
              results, Prometheus utilization, throttling/OOM metrics and
              effective autoscaling configuration.
            </p>
            {data.audit.findings
              .filter(
                (f) =>
                  f.code === "resource-sizing-gap" ||
                  f.code === "single-replica",
              )
              .map((f) => (
                <p key={`${f.nodeId}:${f.code}:${f.evidence[0]?.path}`}>
                  <strong>
                    {data.components.find((n) => n.id === f.nodeId)?.label}:
                  </strong>{" "}
                  {f.detail}
                </p>
              ))}
          </div>
        </TabsContent>
        <TabsContent value="snapshots">
          <div className="studio-two-columns">
            <section className="studio-section">
              <span className="eyebrow">VERSIONED WORKSPACE CONTEXT</span>
              <h3>Save current or proposed state</h3>
              <p className="muted">
                Annotations and layout are encrypted in the backend database.
                Access follows workspace roles. Conflicting saves require a
                reload; imported repository evidence stays unchanged.
              </p>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void saveSnapshot();
                }}
              >
                <label className="field-label">
                  Snapshot label
                  <input
                    className="field"
                    required
                    value={label}
                    maxLength={300}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </label>
                <label className="field-label">
                  State
                  <select
                    className="field"
                    value={kind}
                    onChange={(e) =>
                      setKind(e.target.value as Revision["kind"])
                    }
                  >
                    <option value="current">Current state / annotations</option>
                    <option value="proposed">Proposed future state</option>
                  </select>
                </label>
                {scenario && (
                  <p className="notice">
                    Attached: {scenario.type} ·{" "}
                    {
                      data.components.find((n) => n.id === scenario.nodeId)
                        ?.label
                    }
                  </p>
                )}
                <button
                  className="primary"
                  disabled={!canEdit || save.isPending}
                >
                  Save snapshot
                </button>
              </form>
            </section>
            <section className="studio-section">
              <h3>Open saved state</h3>
              <select
                aria-label="Saved architecture snapshot"
                className="field"
                value={options.revision}
                onChange={(e) =>
                  patchOptions({ revision: Number(e.target.value) })
                }
              >
                {revisionOptions}
              </select>
              {data.revisions.map((r) => (
                <article className="studio-revision" key={r.id}>
                  <strong>
                    v{r.version} · {r.label}
                  </strong>
                  <p>
                    {r.kind} · {new Date(r.createdAt).toLocaleString()}
                  </p>
                </article>
              ))}
            </section>
          </div>
          <section className="studio-section">
            <h3>Compare states</h3>
            <div className="studio-form-grid">
              <label className="field-label">
                From
                <select
                  className="field"
                  value={compareFrom}
                  onChange={(e) => setCompareFrom(Number(e.target.value))}
                >
                  {revisionOptions}
                </select>
              </label>
              <label className="field-label">
                To
                <select
                  className="field"
                  value={compareTo}
                  onChange={(e) => setCompareTo(Number(e.target.value))}
                >
                  {revisionOptions}
                </select>
              </label>
            </div>
            {comparison.error && (
              <p className="error">{comparison.error.message}</p>
            )}
            {comparison.data && (
              <>
                <p>
                  {comparison.data.from} → {comparison.data.to}
                </p>
                {comparison.data.changes.map((c) => (
                  <article
                    className="studio-revision"
                    key={`${c.nodeId}:${c.field}`}
                  >
                    <strong>
                      {c.label} · {c.field}
                    </strong>
                    <p>
                      Before: {JSON.stringify(c.before)}
                      <br />
                      After: {JSON.stringify(c.after)}
                    </p>
                  </article>
                ))}
                <p>
                  Layout changed: {comparison.data.layoutChanged ? "Yes" : "No"}
                </p>
                <p>Scenario: {JSON.stringify(comparison.data.scenario)}</p>
                <p className="muted">{comparison.data.basis}</p>
              </>
            )}
          </section>
        </TabsContent>
      </Tabs>
      <details className="studio-footer-note">
        <summary>Map limitations</summary>
        {data.projection.limits}
        {draft
          ? " Unsaved annotations or layout changes: save a snapshot to share them."
          : ""}
      </details>
    </section>
  );
}

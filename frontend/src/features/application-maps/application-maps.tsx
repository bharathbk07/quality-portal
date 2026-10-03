"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/shared/api/client";
import { apiFetch } from "../auth/session";
import {
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
} from "react";
import {
  FolderOpen,
  GitBranch,
  Network,
  Download,
  RefreshCw,
  Sparkles,
  LoaderCircle,
  FileCode2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { download, type Workspace } from "../workspace/workspace";
const ProjectActions = lazy(() => import("./project-actions"));
const MapStudio = lazy(() => import("./map-studio"));
type Evidence = { path: string; line: number; detail: string };
type GraphNode = {
  id: string;
  label: string;
  kind: string;
  evidence: Evidence[];
};
type GraphEdge = {
  from: string;
  to: string;
  relation: string;
  confidence: string;
  evidence: Evidence[];
};
type Graph = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  mermaid: string;
  warnings: string[];
  stats: { files: number; bytes: number; nodes: number; edges: number };
  analyzerVersion: string;
};
type Enrichment = {
  summary: string;
  suggestions: {
    from: string;
    to: string;
    reason: string;
    evidence?: Pick<Evidence, "path" | "line">[];
  }[];
  mermaid: string;
  model: string;
};
type MapRecord = {
  analysis_version?: number;
  historical?: boolean;
  versions?: {
    version: number;
    source: { revision?: string };
    created_at: string;
  }[];
  id: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed";
  source: {
    kind: string;
    url?: string;
    ref?: string;
    revision?: string;
    scope?: string;
    paths?: string[];
  };
  result?: Graph;
  enrichment?: Enrichment;
  error?: string;
  created_at?: string;
};
type Policy = {
  allowedHosts: string[];
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxPathChars: number;
  uiPollMs: number;
  labelMaxChars: number;
  maxNodes: number;
  maxEdges: number;
  excludedDirs: string[];
  excludedFiles: string[];
  sourceExtensions: string[];
  configExtensions: string[];
  manifestNames: string[];
};
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(url, init);
  const data = (await response.json()) as T & { error?: string };
  if (!response.ok)
    throw new Error(data.error || "The request could not complete");
  return data;
}
function Diagram({
  source,
  onSvg,
}: {
  source: string;
  onSvg: (svg: string) => void;
}) {
  const target = useRef<HTMLDivElement>(null);
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const [error, setError] = useState("");
  const [zoom, setZoom] = useState(1);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const generation = useRef(0);
  const emitSvg = useEffectEvent(onSvg);
  useEffect(() => {
    let active = true;
    const renderId = `application-map-${id}-${++generation.current}`;
    void Promise.resolve().then(async () => {
      setError("");
      emitSvg("");
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          htmlLabels: false,
          flowchart: { htmlLabels: false, curve: "basis" },
          fontFamily: "Arial, sans-serif",
          suppressErrorRendering: true,
        });
        const { svg } = await mermaid.render(renderId, source);
        if (active && target.current) {
          const { default: DOMPurify } = await import("dompurify");
          const sanitized = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ["foreignObject"],
            FORBID_ATTR: ["href", "xlink:href"],
          });
          if (!active) return;
          target.current.innerHTML = sanitized;
          const bounds = target.current.querySelector("svg")?.viewBox.baseVal;
          if (bounds?.width && bounds?.height) {
            setSize({ width: bounds.width, height: bounds.height });
            const viewport = target.current.parentElement;
            setZoom(
              viewport
                ? Math.min(
                    1,
                    (viewport.clientWidth - 40) / bounds.width,
                    (viewport.clientHeight - 40) / bounds.height,
                  )
                : 1,
            );
          }
          emitSvg(sanitized);
        }
      } catch {
        if (active) {
          setError(
            "The diagram could not render. You can still view and export its Mermaid source.",
          );
          if (target.current) target.current.textContent = "";
        }
      }
    });
    return () => {
      active = false;
    };
  }, [source, id]);
  useEffect(() => {
    const viewport = target.current?.parentElement;
    if (!viewport || !size.width || !size.height) return;
    const observer = new ResizeObserver(() =>
      setZoom(
        Math.min(
          1,
          Math.max(0.05, (viewport.clientWidth - 40) / size.width),
          Math.max(0.05, (viewport.clientHeight - 40) / size.height),
        ),
      ),
    );
    observer.observe(viewport);
    return () => observer.disconnect();
  }, [size.width, size.height]);
  return (
    <>
      <div className="map-toolbar row">
        <span className="muted">
          Solid lines: repository evidence · dashed lines: AI suggestions
        </span>
        <div className="row">
          <button
            className="secondary"
            aria-label="Zoom out"
            disabled={zoom <= 0.1}
            onClick={() => setZoom((v) => Math.max(0.1, v - 0.25))}
          >
            <ZoomOut size={16} />
          </button>
          <button
            className="secondary"
            onClick={() => {
              const viewport = target.current?.parentElement;
              if (viewport && size.width)
                setZoom(
                  Math.min(
                    1,
                    (viewport.clientWidth - 40) / size.width,
                    (viewport.clientHeight - 40) / size.height,
                  ),
                );
            }}
          >
            Fit
          </button>
          <button
            className="secondary"
            aria-label="Reset zoom to actual size"
            onClick={() => setZoom(1)}
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            className="secondary"
            aria-label="Zoom in"
            disabled={zoom >= 3}
            onClick={() => setZoom((v) => Math.min(3, v + 0.25))}
          >
            <ZoomIn size={16} />
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="map-scroll">
        <div
          ref={target}
          className="map-diagram"
          style={
            size.width
              ? { width: size.width * zoom, height: size.height * zoom }
              : undefined
          }
          aria-label="Application architecture diagram"
          role="img"
        />
      </div>
    </>
  );
}
export function ApplicationMaps({
  w,
  onNavigate,
  initialMapId,
}: {
  w: Workspace;
  onNavigate: (view: string) => void;
  initialMapId?: string;
}) {
  const [snapshot, setSnapshot] = useState<MapRecord | null>(
    initialMapId && /^[a-f0-9-]{36}$/i.test(initialMapId)
      ? {
          id: initialMapId,
          name: "Shared application map",
          status: "completed",
          source: { kind: "git" },
        }
      : null,
  );
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [importScope, setImportScope] = useState("unknown");
  const [scopePaths, setScopePaths] = useState("");
  const [files, setFiles] = useState<{ path: string; content: string }[]>([]);
  const [selection, setSelection] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [mode, setMode] = useState("folder");
  const [nodeId, setNodeId] = useState("");
  const [showAi, setShowAi] = useState(false);
  const [svg, setSvg] = useState("");
  const [versionSelection, setVersionSelection] = useState({
    mapId: "",
    version: 0,
  });
  const client = useQueryClient();
  const scope = w.session?.workspace.id;
  const policyQuery = useQuery({
    queryKey: ["map-policy", scope],
    enabled: w.authenticated,
    queryFn: ({ signal }) => apiJson<Policy>("/api/maps/config", { signal }),
  });
  const policy = policyQuery.data ?? null;
  const listQuery = useQuery({
    queryKey: ["maps", scope],
    enabled: w.authenticated,
    queryFn: ({ signal }) =>
      apiJson<{ maps: MapRecord[] }>("/api/maps", { signal }),
  });
  const maps = listQuery.data?.maps ?? [];
  const selectedMapId = snapshot?.id || maps[0]?.id;
  const selectedVersion =
    versionSelection.mapId === selectedMapId ? versionSelection.version : 0;
  const detailQuery = useQuery({
    queryKey: ["map", scope, selectedMapId, selectedVersion],
    enabled: !!selectedMapId,
    queryFn: ({ signal }) =>
      apiJson<MapRecord>(
        "/api/maps/" +
          selectedMapId +
          (selectedVersion ? `?version=${selectedVersion}` : ""),
        { signal },
      ),
    refetchInterval: (query) =>
      ["queued", "running"].includes(query.state.data?.status ?? "")
        ? (policy?.uiPollMs ?? false)
        : false,
  });
  const current = detailQuery.data ?? snapshot;
  function setCurrent(record: MapRecord) {
    client.setQueryData(["map", scope, record.id, 0], record);
    setVersionSelection({ mapId: record.id, version: 0 });
    setSnapshot(record);
  }
  async function refresh() {
    await listQuery.refetch();
  }
  async function chooseFiles(input: FileList | null) {
    if (!input || !policy) return;
    setError("");
    setFiles([]);
    setSelection("Reading selected files…");
    try {
      const all = Array.from(input);
      const root = all[0]?.webkitRelativePath.split("/")[0];
      const relativePaths = all.map((file) =>
        file.webkitRelativePath
          ? root
            ? file.webkitRelativePath.slice(root.length + 1)
            : file.webkitRelativePath
          : file.name,
      );
      const approved = await api<{ paths: string[]; excluded: number }>(
        "/api/maps/selection",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ paths: relativePaths }),
        },
      );
      const allowed = new Set(approved.paths);
      const prepared = [];
      let total = 0;
      let skipped = 0;
      for (const file of all) {
        const relative = file.webkitRelativePath
          ? root
            ? file.webkitRelativePath.slice(root.length + 1)
            : file.webkitRelativePath
          : file.name;
        const filePath = relative;
        if (!allowed.has(filePath)) {
          skipped++;
          continue;
        }
        if (file.size > policy.maxFileBytes)
          throw new Error(
            "File exceeds the configured size limit: " + filePath,
          );
        total += file.size;
        if (total > policy.maxTotalBytes || prepared.length >= policy.maxFiles)
          throw new Error(
            "Select a smaller application directory; this selection exceeds the configured scan limits.",
          );
        const content = await file.text();
        if (content.includes("\0")) {
          skipped++;
          continue;
        }
        prepared.push({ path: filePath, content });
      }
      if (!prepared.length)
        throw new Error("No supported source or manifest files found.");
      setFiles(prepared);
      if (!name.trim()) setName(root || "Imported application");
      setSelection(
        `${prepared.length} files ready · ${Math.round(total / 1024)} KB · ${skipped} excluded files`,
      );
    } catch (e) {
      setSelection("");
      setError((e as Error).message);
    }
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const source =
        mode === "git"
          ? {
              kind: "git",
              url: url.trim(),
              scope: importScope,
              paths: scopePaths
                .split("\n")
                .map((p) => p.trim())
                .filter(Boolean),
              ...(ref.trim() ? { ref: ref.trim() } : {}),
            }
          : { kind: "upload", files, scope: importScope };
      const item = await api<MapRecord>("/api/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), source }),
      });
      setCurrent(item);
      await client.invalidateQueries({ queryKey: ["maps", scope] });
      setShowAi(false);
      setNodeId("");
      setFiles([]);
      setSelection("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function openMap(id: string) {
    setError("");
    try {
      setCurrent(await api<MapRecord>("/api/maps/" + id));
      setShowAi(false);
      setNodeId("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function enrich() {
    if (!current) return;
    setEnriching(true);
    setError("");
    try {
      const result = await api<Enrichment>(
        "/api/maps/" + current.id + "/enrich",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      setCurrent({ ...current, enrichment: result });
      await client.invalidateQueries({
        queryKey: ["map-studio", scope, current.id],
      });
      setShowAi(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setEnriching(false);
    }
  }
  const graph = current?.result;
  const selectedNode = graph?.nodes.find((n) => n.id === nodeId);
  const diagram =
    showAi && current?.enrichment ? current.enrichment.mermaid : graph?.mermaid;
  return (
    <>
      <div className="page-heading map-page-heading">
        <div>
          <h1>Application maps</h1>
        </div>
        <span className="tag">Static analysis · AI optional</span>
      </div>
      {!w.authenticated ? (
        <section className="panel empty">
          <Network size={42} />
          <h3>Connect your workspace to create a map</h3>
          <p className="muted">
            Repository analysis runs in the backend, and maps are saved in your
            workspace.
          </p>
          <button
            className="primary"
            style={{ marginTop: 20 }}
            onClick={() => onNavigate("Settings")}
          >
            Sign in to workspace
          </button>
        </section>
      ) : (
        <>
          <div className="map-input-grid">
            <details className="panel map-import" open={!maps.length}>
              <summary className="small-title">Add an application</summary>
              <div className="map-import-body">
                <p className="muted">
                  Choose a source directory or point to an HTTPS Git repository.
                </p>
                <form onSubmit={submit}>
                  <div className="map-import-identity">
                    <label className="field-label" htmlFor="map-name">
                      Application name
                    </label>
                    <input
                      id="map-name"
                      className="field"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                      placeholder="Your application"
                    />
                    <label className="field-label">
                      Import coverage
                      <select
                        className="field"
                        value={importScope}
                        onChange={(e) => setImportScope(e.target.value)}
                      >
                        <option value="unknown">
                          Unknown / exploratory scope
                        </option>
                        <option value="single-service">
                          Single service or legacy program
                        </option>
                        <option value="multiple-services">
                          Selected services / subsystem
                        </option>
                        <option value="system">
                          Intended whole application (unverified)
                        </option>
                      </select>
                    </label>
                    {mode === "git" && (
                      <label className="field-label">
                        Repository paths (optional, one per line)
                        <textarea
                          className="field"
                          value={scopePaths}
                          onChange={(e) => setScopePaths(e.target.value)}
                          placeholder="src/payments
docs/payments.md"
                        />
                        <span className="muted">
                          Only these files/directories are read. Include
                          relevant README/docs and deployment manifests.
                        </span>
                      </label>
                    )}
                  </div>
                  <Tabs
                    value={mode}
                    onValueChange={setMode}
                    className="artifact-tabs"
                  >
                    <TabsList>
                      <TabsTrigger value="folder">
                        <FolderOpen size={16} />
                        Repository folder
                      </TabsTrigger>
                      <TabsTrigger value="git">
                        <GitBranch size={16} />
                        Git URL
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="folder">
                      <div className="repository-drop">
                        <FolderOpen size={30} />
                        <strong>Choose the application directory</strong>
                        <p>
                          Common secret files, dependency folders, and build
                          output are excluded before upload.
                        </p>
                        <label className="secondary">
                          Choose folder
                          <input
                            type="file"
                            className="sr-only"
                            multiple
                            {...({
                              webkitdirectory: "",
                              directory: "",
                            } as React.InputHTMLAttributes<HTMLInputElement>)}
                            onChange={(e) => void chooseFiles(e.target.files)}
                            disabled={!w.canEdit || !policy || busy}
                          />
                        </label>
                        <label className="tool-link">
                          Or choose individual files
                          <input
                            type="file"
                            className="sr-only"
                            multiple
                            onChange={(e) => void chooseFiles(e.target.files)}
                            disabled={!w.canEdit || !policy || busy}
                          />
                        </label>
                        {selection && (
                          <span role="status" className="tag">
                            {selection}
                          </span>
                        )}
                      </div>
                    </TabsContent>
                    <TabsContent value="git">
                      <label className="field-label" htmlFor="repo-url">
                        Repository clone URL
                      </label>
                      <input
                        id="repo-url"
                        type="url"
                        className="field"
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                        placeholder="HTTPS repository URL"
                        required={mode === "git"}
                      />
                      <label className="field-label" htmlFor="repo-ref">
                        Branch or tag (optional)
                      </label>
                      <input
                        id="repo-ref"
                        className="field"
                        value={ref}
                        onChange={(e) => setRef(e.target.value)}
                        placeholder="Repository default branch"
                      />
                      <p className="muted" style={{ marginTop: 12 }}>
                        Allowed hosts:{" "}
                        {policy?.allowedHosts.join(", ") ||
                          "Loading configuration…"}
                        . For private repositories, an administrator configures
                        a server-side token.
                      </p>
                    </TabsContent>
                  </Tabs>
                  <button
                    className="primary"
                    style={{ marginTop: 20 }}
                    disabled={
                      !w.canEdit ||
                      busy ||
                      !policy ||
                      (mode === "folder" && !files.length) ||
                      (mode === "git" && !url.trim())
                    }
                  >
                    {busy ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <Network size={16} />
                    )}
                    Create application map
                  </button>
                </form>
              </div>
            </details>
            <section className="panel map-picker">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h2 className="small-title">Saved maps</h2>
                <button
                  className="secondary"
                  onClick={() => refresh().catch((e) => setError(e.message))}
                  aria-label="Refresh saved maps"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
              {!maps.length ? (
                <p className="muted">Import a repository to get started.</p>
              ) : (
                <label className="field-label">
                  <span className="sr-only">Application</span>
                  <select
                    className="field"
                    value={current?.id || selectedMapId || ""}
                    onChange={(e) => void openMap(e.target.value)}
                  >
                    {maps.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ·{" "}
                        {current?.id === m.id && !current.historical
                          ? current.status
                          : m.status}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </section>
          </div>
          {(error ||
            policyQuery.error ||
            listQuery.error ||
            detailQuery.error) && (
            <p role="alert" className="error" style={{ marginTop: 20 }}>
              {error ||
                policyQuery.error?.message ||
                listQuery.error?.message ||
                detailQuery.error?.message}
            </p>
          )}
          {current && (
            <section className="panel map-result" style={{ marginTop: 22 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <h2 className="small-title">{current.name}</h2>
                  <details className="map-source-meta">
                    <summary>Source details</summary>
                    <p className="muted">
                      {current.source.kind === "git"
                        ? current.source.url
                        : "Imported repository files"}
                      {current.source.revision &&
                        ` · commit ${current.source.revision.slice(0, 12)}`}
                    </p>
                  </details>
                </div>
                <div className="row">
                  {!!current.versions?.length && (
                    <label className="map-version-picker">
                      <span className="sr-only">Analysis version</span>
                      <select
                        aria-label="Analysis version"
                        className="field"
                        value={selectedVersion}
                        onChange={(e) => {
                          setVersionSelection({
                            mapId: current.id,
                            version: Number(e.target.value),
                          });
                          setShowAi(false);
                          setSvg("");
                        }}
                      >
                        <option value={0}>
                          Latest · v{current.versions[0].version}
                        </option>
                        {current.versions.slice(1).map((v) => (
                          <option key={v.version} value={v.version}>
                            v{v.version} ·{" "}
                            {new Date(v.created_at).toLocaleDateString()}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <span className={"map-status " + current.status}>
                    {current.status}
                  </span>
                  <button
                    className="secondary"
                    onClick={async (e) => {
                      const panel = e.currentTarget.closest(".map-result");
                      try {
                        if (document.fullscreenElement)
                          await document.exitFullscreen();
                        else await panel?.requestFullscreen();
                      } catch {
                        setError(
                          "Your browser could not expand the workspace.",
                        );
                      }
                    }}
                  >
                    Expand / exit workspace
                  </button>
                </div>
              </div>
              {["queued", "running"].includes(current.status) && (
                <div className="map-progress" role="status">
                  <LoaderCircle size={23} className="animate-spin" />
                  <div>
                    <strong>
                      {current.status === "queued"
                        ? "Waiting for the analysis worker"
                        : "Inspecting repository structure"}
                    </strong>
                    <p className="muted">
                      You can leave this screen and return to the saved map.
                    </p>
                  </div>
                </div>
              )}
              {current.error && current.status === "completed" && (
                <p className="notice" role="status">
                  Latest scan failed. Showing the last successful version (v
                  {current.analysis_version}): {current.error}
                </p>
              )}
              {current.status === "failed" && (
                <div className="error" role="alert">
                  {current.error || "Repository analysis could not complete."}
                </div>
              )}
              {graph && (
                <>
                  <div className="report-values">
                    <div>
                      <strong>{graph.stats.files}</strong>
                      <small>files analyzed</small>
                    </div>
                    <div>
                      <strong>{graph.stats.nodes}</strong>
                      <small>components</small>
                    </div>
                    <div>
                      <strong>{graph.stats.edges}</strong>
                      <small>evidence-backed connections</small>
                    </div>
                  </div>
                  <details className="map-guidance map-export-options">
                    <summary>Export, refresh & AI review</summary>
                    <div className="row map-actions">
                      <button
                        className="secondary"
                        onClick={() =>
                          download(current.name + ".mmd", diagram!)
                        }
                      >
                        <Download size={16} />
                        Mermaid
                      </button>
                      <button
                        className="secondary"
                        disabled={!svg}
                        onClick={() => download(current.name + ".svg", svg)}
                      >
                        <Download size={16} />
                        SVG
                      </button>
                      <button
                        className="secondary"
                        onClick={() =>
                          download(
                            current.name + ".json",
                            JSON.stringify(current, null, 2),
                          )
                        }
                      >
                        <Download size={16} />
                        Map JSON
                      </button>
                      {current.source.kind === "git" && (
                        <button
                          className="secondary"
                          disabled={!w.canEdit || current.historical || busy}
                          onClick={async () => {
                            setBusy(true);
                            setError("");
                            try {
                              const record = await api<MapRecord>("/api/maps", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({
                                  name: current.name,
                                  source: {
                                    kind: "git",
                                    url: current.source.url,
                                    scope: current.source.scope || "unknown",
                                    paths: current.source.paths || [],
                                    ...(current.source.ref
                                      ? { ref: current.source.ref }
                                      : {}),
                                  },
                                }),
                              });
                              setCurrent(record);
                              await refresh();
                            } catch (e) {
                              setError(
                                e instanceof Error
                                  ? e.message
                                  : "Repository refresh failed",
                              );
                            } finally {
                              setBusy(false);
                            }
                          }}
                        >
                          Refresh repository metadata
                        </button>
                      )}
                      <button
                        className="primary"
                        disabled={
                          !w.canEdit ||
                          current.historical ||
                          enriching ||
                          !w.ai.configured
                        }
                        onClick={() => void enrich()}
                      >
                        {enriching ? (
                          <LoaderCircle size={16} className="animate-spin" />
                        ) : (
                          <Sparkles size={16} />
                        )}
                        Enrich with AI
                      </button>
                      {!w.ai.configured && (
                        <button
                          className="tool-link"
                          onClick={() => onNavigate("Settings")}
                        >
                          Configure AI provider
                        </button>
                      )}
                    </div>
                    <details className="map-guidance">
                      <summary>AI data usage</summary>
                      <p className="muted">
                        AI enrichment sends component evidence and redacted,
                        retrieved README/Markdown excerpts to your configured
                        provider. Repository source bodies are not included.
                      </p>
                    </details>
                  </details>
                  {current.enrichment && (
                    <details
                      className="notice map-ai-review"
                      style={{ marginTop: 12 }}
                    >
                      <summary>AI review · unverified draft</summary>
                      <div
                        className="row"
                        style={{ justifyContent: "space-between" }}
                      >
                        <strong>
                          AI review · unverified · {current.enrichment.model}
                        </strong>
                        <button
                          className="secondary"
                          onClick={() => setShowAi((v) => !v)}
                        >
                          {showAi ? "Show static map" : "Show AI suggestions"}
                        </button>
                      </div>
                      <p className="ai-output" style={{ marginTop: 12 }}>
                        {current.enrichment.summary}
                      </p>
                      {current.enrichment.suggestions.length > 0 && (
                        <ul className="map-suggestions">
                          {current.enrichment.suggestions.map((s) => (
                            <li key={`${s.from}:${s.to}:${s.reason}`}>
                              {graph.nodes.find((n) => n.id === s.from)?.label}{" "}
                              → {graph.nodes.find((n) => n.id === s.to)?.label}:{" "}
                              {s.reason}
                              {s.evidence?.length ? (
                                <p className="map-evidence-path">
                                  {s.evidence
                                    .map((e) => `${e.path}:${e.line}`)
                                    .join(" · ")}
                                </p>
                              ) : null}
                            </li>
                          ))}
                        </ul>
                      )}
                    </details>
                  )}
                  <Suspense fallback={<p>Loading project actions…</p>}>
                    <ProjectActions
                      components={graph.nodes}
                      id={current.id}
                      name={current.name}
                      canEdit={w.canEdit && !current.historical}
                      isAdmin={w.isAdmin}
                      onChanged={async () => {
                        const updated = await api<MapRecord>(
                          `/api/maps/${current.id}`,
                        );
                        setCurrent(updated);
                        setSvg("");
                        setShowAi(false);
                      }}
                      onDeleted={async () => {
                        await refresh();
                        setSnapshot(null);
                        setSvg("");
                      }}
                    />
                  </Suspense>
                  <Tabs defaultValue="diagram" className="artifact-tabs">
                    <TabsList>
                      <TabsTrigger value="diagram">
                        <Network size={16} />
                        Canvas
                      </TabsTrigger>
                      <TabsTrigger value="mermaid">Mermaid</TabsTrigger>
                      <TabsTrigger value="evidence">Evidence</TabsTrigger>
                      <TabsTrigger value="source">
                        <FileCode2 size={16} />
                        Source
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="diagram">
                      {current.historical ? (
                        <>
                          <p className="notice">
                            Retained source version · read-only. Select Latest
                            to use the copilot or modify this application.
                          </p>
                          {diagram && (
                            <Diagram source={diagram} onSvg={setSvg} />
                          )}
                        </>
                      ) : (
                        <Suspense
                          fallback={<p>Loading architecture workspace…</p>}
                        >
                          <MapStudio
                            key={`${current.id}:${current.analysis_version}`}
                            mapId={current.id}
                            scope={scope}
                            canEdit={w.canEdit && !current.historical}
                            aiConfigured={w.ai.configured}
                          />
                        </Suspense>
                      )}
                    </TabsContent>
                    <TabsContent value="mermaid">
                      {diagram && <Diagram source={diagram} onSvg={setSvg} />}
                      <div className="map-component-list">
                        {graph.nodes.map((n) => (
                          <button
                            className={
                              "map-component " +
                              (nodeId === n.id ? "selected" : "")
                            }
                            key={n.id}
                            onClick={() => setNodeId(n.id)}
                          >
                            <span>{n.label}</span>
                            <small>{n.kind}</small>
                          </button>
                        ))}
                      </div>
                      {selectedNode && (
                        <div className="notice">
                          <strong>
                            {selectedNode.label} · {selectedNode.kind}
                          </strong>
                          {selectedNode.evidence.map((e) => (
                            <p
                              key={`${e.path}:${e.line}:${e.detail}`}
                              className="map-evidence-path"
                            >
                              {e.path}:{e.line} · {e.detail}
                            </p>
                          ))}
                        </div>
                      )}
                    </TabsContent>
                    <TabsContent value="evidence">
                      <div className="map-edge-list">
                        {graph.edges.length === 0 && (
                          <p className="muted">
                            No cross-component relationships were found in this
                            scope.
                          </p>
                        )}
                        {graph.edges.map((edge) => (
                          <article
                            key={`${edge.from}:${edge.to}:${edge.relation}`}
                          >
                            <strong>
                              {
                                graph.nodes.find((n) => n.id === edge.from)
                                  ?.label
                              }{" "}
                              →{" "}
                              {graph.nodes.find((n) => n.id === edge.to)?.label}
                            </strong>
                            <span className="tag">{edge.relation}</span>
                            {edge.evidence.map((e) => (
                              <p
                                className="map-evidence-path"
                                key={`${e.path}:${e.line}:${e.detail}`}
                              >
                                {e.path}:{e.line} · {e.detail}
                              </p>
                            ))}
                          </article>
                        ))}
                      </div>
                    </TabsContent>
                    <TabsContent value="source">
                      <pre className="code" style={{ marginTop: 16 }}>
                        {diagram}
                      </pre>
                    </TabsContent>
                  </Tabs>
                  <details className="map-warnings">
                    <summary>Analysis scope & limitations</summary>
                    {graph.warnings.map((warning) => (
                      <p className="muted" key={warning}>
                        {warning}
                      </p>
                    ))}
                  </details>
                </>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

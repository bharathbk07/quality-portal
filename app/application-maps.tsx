"use client";
import { useEffect, useId, useRef, useState } from "react";
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
import { eligibleFile, cleanPath } from "@/services/mapping/policy.mjs";
import { download, type Workspace } from "./workspace";
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
  suggestions: { from: string; to: string; reason: string }[];
  mermaid: string;
  model: string;
};
type MapRecord = {
  id: string;
  name: string;
  status: "queued" | "running" | "completed" | "failed";
  source: { kind: string; url?: string; ref?: string; revision?: string };
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
  const response = await fetch(url, init);
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
  useEffect(() => {
    let active = true;
    setError("");
    onSvg("");
    void (async () => {
      try {
        const { default: mermaid } = await import("mermaid");
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: "base",
          flowchart: { htmlLabels: false, curve: "basis" },
          fontFamily: "Arial, sans-serif",
          suppressErrorRendering: true,
        });
        const { svg } = await mermaid.render("application-map-" + id, source);
        if (active && target.current) {
          target.current.innerHTML = svg;
          onSvg(svg);
        }
      } catch {
        if (active) {
          setError(
            "The diagram could not render. You can still view and export its Mermaid source.",
          );
          if (target.current) target.current.textContent = "";
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [source, id]);
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
            disabled={zoom <= 0.5}
            onClick={() => setZoom((v) => Math.max(0.5, v - 0.25))}
          >
            <ZoomOut size={16} />
          </button>
          <button className="secondary" onClick={() => setZoom(1)}>
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
          style={{ width: `${zoom * 100}%` }}
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
}: {
  w: Workspace;
  onNavigate: (view: string) => void;
}) {
  const [policy, setPolicy] = useState<Policy | null>(null);
  const [maps, setMaps] = useState<MapRecord[]>([]);
  const [current, setCurrent] = useState<MapRecord | null>(null);
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [ref, setRef] = useState("");
  const [files, setFiles] = useState<{ path: string; content: string }[]>([]);
  const [selection, setSelection] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [enriching, setEnriching] = useState(false);
  const [mode, setMode] = useState("folder");
  const [nodeId, setNodeId] = useState("");
  const [showAi, setShowAi] = useState(false);
  const [svg, setSvg] = useState("");
  async function refresh() {
    const data = await api<{ maps: MapRecord[] }>("/api/maps");
    setMaps(data.maps);
  }
  useEffect(() => {
    if (!w.authenticated) return;
    let active = true;
    Promise.all([
      api<Policy>("/api/maps/config"),
      api<{ maps: MapRecord[] }>("/api/maps"),
    ])
      .then(([p, data]) => {
        if (active) {
          setPolicy(p);
          setMaps(data.maps);
        }
      })
      .catch((e) => active && setError(e.message));
    return () => {
      active = false;
    };
  }, [w.authenticated]);
  useEffect(() => {
    if (!current || !policy || !["queued", "running"].includes(current.status))
      return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const next = await api<MapRecord>("/api/maps/" + current!.id);
        if (!active) return;
        setCurrent(next);
        setMaps((old) =>
          old.map((m) =>
            m.id === next.id
              ? { ...m, status: next.status, error: next.error }
              : m,
          ),
        );
        if (["queued", "running"].includes(next.status))
          timer = setTimeout(poll, policy!.uiPollMs);
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    timer = setTimeout(poll, policy.uiPollMs);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [current?.id, current?.status, policy]);
  async function chooseFiles(input: FileList | null) {
    if (!input || !policy) return;
    setError("");
    setFiles([]);
    setSelection("Reading selected files…");
    try {
      const all = Array.from(input);
      const root = all[0]?.webkitRelativePath.split("/")[0];
      const prepared = [];
      let total = 0;
      let skipped = 0;
      for (const file of all) {
        const relative = file.webkitRelativePath
          ? root
            ? file.webkitRelativePath.slice(root.length + 1)
            : file.webkitRelativePath
          : file.name;
        const filePath = cleanPath(relative, policy);
        if (!eligibleFile(filePath, policy)) {
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
              ...(ref.trim() ? { ref: ref.trim() } : {}),
            }
          : { kind: "upload", files };
      const item = await api<MapRecord>("/api/maps", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), source }),
      });
      setCurrent(item);
      setMaps((old) => [item, ...old]);
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
      <div className="page-heading">
        <div>
          <div className="eyebrow">REPOSITORY TO ARCHITECTURE</div>
          <h1>Application maps</h1>
          <p>Understand your application before you test it.</p>
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
            <section className="panel">
              <h2 className="small-title">Add an application</h2>
              <p className="muted">
                Choose a source directory or point to an HTTPS Git repository.
              </p>
              <form onSubmit={submit}>
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
                          disabled={!policy || busy}
                        />
                      </label>
                      <label className="tool-link">
                        Or choose individual files
                        <input
                          type="file"
                          className="sr-only"
                          multiple
                          onChange={(e) => void chooseFiles(e.target.files)}
                          disabled={!policy || busy}
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
                      . For private repositories, an administrator configures a
                      server-side token.
                    </p>
                  </TabsContent>
                </Tabs>
                <button
                  className="primary"
                  style={{ marginTop: 20 }}
                  disabled={
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
            </section>
            <section className="panel">
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
                <p className="muted">
                  Your application maps will appear here after you submit a
                  repository.
                </p>
              ) : (
                <div className="map-history">
                  {maps.map((m) => (
                    <button
                      key={m.id}
                      className={
                        "map-history-item " +
                        (current?.id === m.id ? "selected" : "")
                      }
                      onClick={() => void openMap(m.id)}
                    >
                      <span>
                        <strong>{m.name}</strong>
                        <small>
                          {m.source.kind === "git"
                            ? "Git repository"
                            : "Imported files"}
                        </small>
                      </span>
                      <span className={"map-status " + m.status}>
                        {m.status}
                      </span>
                    </button>
                  ))}
                </div>
              )}
              <div className="divider" />
              <p className="muted">
                The map uses declared services, package boundaries, and relative
                source imports. Every detected connection includes file
                evidence. Repository code is inspected without running it.
              </p>
            </section>
          </div>
          {error && (
            <p role="alert" className="error" style={{ marginTop: 20 }}>
              {error}
            </p>
          )}
          {current && (
            <section className="panel map-result" style={{ marginTop: 22 }}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <h2 className="small-title">{current.name}</h2>
                  <p className="muted">
                    {current.source.kind === "git"
                      ? current.source.url
                      : "Imported repository files"}
                    {current.source.revision &&
                      ` · commit ${current.source.revision.slice(0, 12)}`}
                  </p>
                </div>
                <span className={"map-status " + current.status}>
                  {current.status}
                </span>
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
                  <div className="row map-actions">
                    <button
                      className="secondary"
                      onClick={() => download(current.name + ".mmd", diagram!)}
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
                    <button
                      className="primary"
                      disabled={enriching || !w.ai.configured}
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
                  <p className="muted" style={{ marginTop: 12 }}>
                    AI enrichment sends component labels and file evidence to
                    your configured provider. It does not send repository source
                    contents.
                  </p>
                  {current.enrichment && (
                    <div className="notice" style={{ marginTop: 18 }}>
                      <div
                        className="row"
                        style={{ justifyContent: "space-between" }}
                      >
                        <strong>AI review · {current.enrichment.model}</strong>
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
                          {current.enrichment.suggestions.map((s, i) => (
                            <li key={i}>
                              {graph.nodes.find((n) => n.id === s.from)?.label}{" "}
                              → {graph.nodes.find((n) => n.id === s.to)?.label}:{" "}
                              {s.reason}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}
                  <Tabs defaultValue="diagram" className="artifact-tabs">
                    <TabsList>
                      <TabsTrigger value="diagram">
                        <Network size={16} />
                        Application map
                      </TabsTrigger>
                      <TabsTrigger value="evidence">Evidence</TabsTrigger>
                      <TabsTrigger value="source">
                        <FileCode2 size={16} />
                        Mermaid source
                      </TabsTrigger>
                    </TabsList>
                    <TabsContent value="diagram">
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
                          {selectedNode.evidence.map((e, i) => (
                            <p key={i} className="map-evidence-path">
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
                        {graph.edges.map((edge, i) => (
                          <article key={i}>
                            <strong>
                              {
                                graph.nodes.find((n) => n.id === edge.from)
                                  ?.label
                              }{" "}
                              →{" "}
                              {graph.nodes.find((n) => n.id === edge.to)?.label}
                            </strong>
                            <span className="tag">{edge.relation}</span>
                            {edge.evidence.map((e, j) => (
                              <p className="map-evidence-path" key={j}>
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
                  <div className="map-warnings">
                    <h3 className="small-title">Analysis scope</h3>
                    {graph.warnings.map((warning, i) => (
                      <p className="muted" key={i}>
                        {warning}
                      </p>
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </>
  );
}

"use client";
import { apiFetch } from "../auth/session";
import { useState } from "react";

export type AIStatus = {
  configured: boolean;
  model: string | null;
  provider?: string;
  requestedProvider?: string;
  defaultReason?: string | null;
  providers?: {
    id: string;
    label: string;
    configured: boolean;
    model: string;
    mode: string;
    issue?: string | null;
  }[];
  monitoring?: {
    enabled: boolean;
    configured: boolean;
    project: string;
    captureContent: boolean;
    uiUrl: string;
    lastTrace: {
      id: string;
      status: string;
      requestId?: string;
      reason?: string;
    } | null;
  };
};

export function AIConnections({
  status,
  authenticated,
  refresh,
}: {
  status: AIStatus;
  authenticated: boolean;
  refresh: () => Promise<void>;
}) {
  const [busy, setBusy] = useState("");
  const [results, setResults] = useState<Record<string, string>>({});
  const [repository, setRepository] = useState("");
  const [ref, setRef] = useState("");
  const [prompt, setPrompt] = useState("");
  const [agentId, setAgentId] = useState("");
  async function call(id: string, path: string, body?: unknown) {
    setBusy(id);
    setResults((old) => ({ ...old, [id]: "" }));
    try {
      const r = await apiFetch("/api/assistant" + path, {
        method: body ? "POST" : "GET",
        headers: { "Content-Type": "application/json" },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
      const d = (await r.json()) as {
        error?: string;
        agent?: { id: string };
        [key: string]: unknown;
      };
      if (!r.ok) throw new Error(d.error || "Request failed");
      setResults((old) => ({
        ...old,
        [id]: d.connected
          ? "Connected successfully"
          : JSON.stringify(d, null, 2),
      }));
      if (d.agent?.id) setAgentId(d.agent.id);
      await refresh();
    } catch (e) {
      setResults((old) => ({ ...old, [id]: (e as Error).message }));
    } finally {
      setBusy("");
    }
  }
  return (
    <section className="panel">
      <h2 className="small-title">AI provider connections</h2>
      <p className="muted">
        Configure your provider using the connection tabs above, then check its
        availability here. Select a configured provider in any test copilot.
      </p>
      {status.defaultReason && (
        <p className="notice">
          {status.defaultReason}. Active provider: {status.provider}. Select it
          in AI defaults to make this permanent.
        </p>
      )}
      {status.providers?.map((p) => (
        <div
          key={p.id}
          style={{
            marginTop: 18,
            borderTop: "1px solid var(--border)",
            paddingTop: 14,
          }}
        >
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{p.label}</strong>
            <span className={p.configured ? "success" : "notice"}>
              {p.configured ? "Configured" : p.issue || "Setup required"}
            </span>
          </div>
          <p className="muted">
            {p.model || "Model not configured"} ·{" "}
            {p.mode === "agent" ? "Repository agent" : "Test copilot"}
          </p>
          <div style={{ marginTop: 12 }}>
            <button
              className="secondary"
              disabled={!authenticated || !p.configured || !!busy}
              onClick={() => call(p.id, "/test", { provider: p.id })}
            >
              {busy === p.id ? "Connecting…" : "Test connection"}
            </button>
          </div>
          {results[p.id] && (
            <p className="notice" role="status" style={{ marginTop: 12 }}>
              {results[p.id]}
            </p>
          )}
        </div>
      ))}
      <p className="muted" style={{ marginTop: 18 }}>
        Connection tests make a small model request and may incur provider
        usage. LM Studio and Ollama can run locally without an API key. Secrets
        are stored encrypted and used only by server adapters.
      </p>
      <div className="divider" />
      <h2 className="small-title">LangSmith monitoring</h2>
      <p
        className={
          status.monitoring?.enabled && status.monitoring.configured
            ? "success"
            : "notice"
        }
      >
        {status.monitoring?.enabled
          ? status.monitoring.configured
            ? "Tracing enabled"
            : "Tracing enabled · configuration incomplete"
          : "Tracing disabled"}
      </p>
      <p className="muted">
        Project: {status.monitoring?.project || "Unavailable"}. Traces include
        provider, model, latency, usage and failures. Prompt and response
        capture: {status.monitoring?.captureContent ? "enabled" : "redacted"}.
      </p>
      {status.monitoring?.lastTrace && (
        <p className="muted">
          Last trace: {status.monitoring.lastTrace.status} ·{" "}
          {status.monitoring.lastTrace.id}
          {status.monitoring.lastTrace.requestId && (
            <> · Request {status.monitoring.lastTrace.requestId}</>
          )}
          {status.monitoring.lastTrace.reason && (
            <> · {status.monitoring.lastTrace.reason}</>
          )}
        </p>
      )}
      {!status.monitoring?.captureContent && (
        <p className="muted">
          To inspect messages and answers, enable Capture prompts and responses
          in the LangSmith connection settings. Only new traces include content;
          existing metadata-only traces cannot recover it.
        </p>
      )}
      <button className="secondary" disabled={!authenticated} onClick={refresh}>
        Refresh status
      </button>
      {status.monitoring?.uiUrl && (
        <a
          className="tool-link"
          style={{ marginLeft: 16 }}
          href={status.monitoring.uiUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open LangSmith
        </a>
      )}
      <div className="divider" />
      <h2 className="small-title">Cursor repository task</h2>
      <p className="muted">
        Starts a cloud coding agent through cursor-sdk. Cursor can change the
        repository and push a new branch. Source control must be connected in
        Cursor. Review your task before launching.
      </p>
      <label className="field-label">
        Repository URL
        <input
          className="field"
          type="url"
          value={repository}
          onChange={(e) => setRepository(e.target.value)}
        />
      </label>
      <label className="field-label">
        Starting branch or commit
        <input
          className="field"
          value={ref}
          onChange={(e) => setRef(e.target.value)}
        />
      </label>
      <label className="field-label">
        Task
        <textarea
          className="field"
          rows={3}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <button
        className="primary"
        disabled={
          !authenticated ||
          !status.providers?.find((p) => p.id === "cursor")?.configured ||
          !repository ||
          !prompt ||
          !!busy
        }
        onClick={() =>
          call("agent", "/cursor/agents", { prompt, repository, ref })
        }
      >
        {busy === "agent" ? "Running repository task…" : "Launch Cursor task"}
      </button>
      {agentId && (
        <button
          className="secondary"
          style={{ marginLeft: 10 }}
          disabled={!!busy}
          onClick={() =>
            call("agent", "/cursor/agents/" + encodeURIComponent(agentId))
          }
        >
          Refresh agent
        </button>
      )}
      {results.agent && (
        <pre className="code" role="status" style={{ marginTop: 12 }}>
          {results.agent}
        </pre>
      )}
    </section>
  );
}

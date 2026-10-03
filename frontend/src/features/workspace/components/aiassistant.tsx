"use client";
import { apiFetch } from "../../auth/session";
import { useState } from "react";
import { Download, Sparkles, LoaderCircle } from "lucide-react";
import type { Workspace } from ".././hooks/use-workspace";
import { MarkdownContent } from "@/shared/markdown-content";
import { download } from "@/shared/download";
export function AIAssistant({
  w,
  scope,
  evidence,
}: {
  w: Workspace;
  scope: string;
  evidence?: string;
}) {
  const [provider, setProvider] = useState("");
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function ask() {
    setBusy(true);
    setError("");
    setResult("");
    try {
      const response = await apiFetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(provider ? { provider } : {}),
          prompt,
          scope,
          selected: w.selected,
          ...(w.contractId ? { contractId: w.contractId } : {}),
          ...(evidence ? { evidence } : {}),
        }),
      });
      const data = (await response.json()) as {
        error?: string;
        content: string;
      };
      if (!response.ok) throw new Error(data.error || "Request failed");
      setResult(data.content);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h2 className="small-title row">
          <Sparkles size={19} color="#26765c" /> Test copilot
        </h2>
        <span className="tag">
          {w.ai.configured ? w.ai.model : "Setup required"}
        </span>
      </div>
      <p className="muted">
        {w.ai.configured
          ? "Uses selected operation metadata and imported evidence. Review sensitive content before sending."
          : "Configure an AI provider in server settings to enable generation."}
      </p>
      {w.ai.defaultReason && (
        <p className="notice">
          {w.ai.defaultReason}. Active: {w.ai.provider}.
        </p>
      )}
      <label className="field-label" htmlFor={"provider-" + scope}>
        AI provider
      </label>
      <select
        id={"provider-" + scope}
        className="field"
        value={provider}
        onChange={(e) => setProvider(e.target.value)}
      >
        <option value="">
          Workspace default{w.ai.provider ? ` · ${w.ai.provider}` : ""}
        </option>
        {w.ai.providers
          ?.filter((p) => p.mode === "chat")
          .map((p) => (
            <option key={p.id} value={p.id} disabled={!p.configured}>
              {p.label}
              {p.configured ? "" : " · setup required"}
            </option>
          ))}
      </select>
      <label className="field-label" htmlFor={"prompt-" + scope}>
        What would you like to investigate?
      </label>
      <textarea
        id={"prompt-" + scope}
        className="field"
        rows={3}
        maxLength={w.config?.ai_prompt_max_chars}
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder={`Draft a ${scope} plan…`}
      />
      <button
        className="primary"
        style={{ marginTop: 15 }}
        disabled={
          !w.canEdit ||
          busy ||
          !(provider
            ? w.ai.providers?.find((p) => p.id === provider)?.configured
            : w.ai.configured)
        }
        onClick={ask}
      >
        {busy ? (
          <LoaderCircle size={16} className="animate-spin" />
        ) : (
          <Sparkles size={16} />
        )}{" "}
        {busy ? "Generating…" : "Generate with AI"}
      </button>
      <div aria-live="polite">
        {error && (
          <p className="error" style={{ marginTop: 16 }}>
            {error}
          </p>
        )}
        {result && (
          <>
            <div className="divider" />
            <span className="tag">AI draft · review required</span>
            <div className="ai-output" style={{ marginTop: 18 }}>
              <MarkdownContent content={result} />
            </div>
            <button
              className="secondary"
              style={{ marginTop: 16 }}
              onClick={() => download("ai-analysis.md", result)}
            >
              <Download size={16} /> Download analysis
            </button>
          </>
        )}
      </div>
    </section>
  );
}

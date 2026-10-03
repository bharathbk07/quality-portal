"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { studioApi } from "./studio-api";
import { MarkdownContent } from "@/shared/markdown-content";
import { download } from "@/shared/download";
import type { Studio, Ai } from "./studio-types";
export function AiDraft({ ai, error }: { ai?: Ai; error?: string }) {
  return (
    <>
      {error && (
        <p role="status" className="notice">
          {error}
        </p>
      )}
      {ai && (
        <section className="studio-ai-draft">
          <strong>AI draft · {ai.model} · requires review</strong>
          <MarkdownContent content={ai.text} />
          {ai.citations.map((c) => (
            <p
              className="map-evidence-path"
              key={`${c.nodeId}:${c.path}:${c.line}`}
            >
              {c.path}:{c.line}
            </p>
          ))}
        </section>
      )}
    </>
  );
}
export default function IntelligencePanel({
  mapId,
  data,
  canEdit,
  aiConfigured,
  revision,
}: {
  mapId: string;
  data: Studio;
  canEdit: boolean;
  aiConfigured: boolean;
  revision: number;
}) {
  const [useAi, setUseAi] = useState(false);
  const [docType, setDocType] = useState("readme");
  const document = useMutation({
    mutationFn: () => studioApi.document(mapId, docType, useAi, revision),
  });
  const review = useMutation({
    mutationFn: () => studioApi.audit(mapId, useAi),
  });
  const error = document.error || review.error;
  const audit = review.data?.result || data.audit;
  return (
    <div className="studio-intelligence">
      <details className="studio-footer-note">
        <summary>How reports use evidence and AI</summary>
        <p>
          Evidence-backed answers work without AI. Optional AI sends map
          metadata, annotations, retrieved redacted Markdown excerpts and your
          question to the configured provider; all generated text remains a
          draft.
        </p>
      </details>
      <label className="row">
        <input
          type="checkbox"
          checked={useAi}
          disabled={!aiConfigured || !canEdit}
          onChange={(e) => setUseAi(e.target.checked)}
        />{" "}
        Add AI explanation{" "}
        {aiConfigured ? "" : "· configure a provider to enable"}
      </label>
      {error && (
        <p className="error" role="alert">
          {error.message}
        </p>
      )}
      <div>
        <section className="studio-section">
          <span className="eyebrow">DOCUMENTATION</span>
          <h3>Generate an evidence-based draft</h3>
          <label className="field-label">
            Document type
            <select
              className="field"
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
            >
              <option value="readme">Architecture README</option>
              <option value="documentation-summary">
                Summarize imported Markdown
              </option>
              <option value="onboarding">Onboarding explanation</option>
              <option value="runbook">Operational review runbook</option>
              <option value="api">OpenAPI inventory shell</option>
            </select>
          </label>
          <button
            className="primary"
            disabled={!canEdit || document.isPending}
            onClick={() => document.mutate()}
          >
            Generate document
          </button>
          {document.data && (
            <>
              <p className="muted">
                {document.data.result.warning ||
                  "Draft from declared topology and saved owner annotations."}
              </p>
              <button
                className="secondary"
                onClick={() =>
                  download(
                    `${docType}.${document.data?.result.format === "yaml" ? "yaml" : "md"}`,
                    document.data!.result.content,
                  )
                }
              >
                Download draft
              </button>
              {document.data.result.format === "markdown" ? (
                <MarkdownContent content={document.data.result.content} />
              ) : (
                <pre className="code">{document.data.result.content}</pre>
              )}
              <AiDraft ai={document.data.ai} error={document.data.aiError} />
            </>
          )}
        </section>
      </div>
      <section className="studio-section">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <span className="eyebrow">ARCHITECTURE GAP REVIEW</span>
            <h3>Evidence, gaps & verification</h3>
          </div>
          <button
            className="secondary"
            disabled={!canEdit || review.isPending}
            onClick={() => review.mutate()}
          >
            Review architecture
          </button>
        </div>
        <div className="studio-findings">
          {audit.findings.map((f) => (
            <article key={`${f.nodeId}:${f.code}:${f.evidence[0]?.path}`}>
              <span className={`tag ${f.severity}`}>{f.severity}</span>
              <strong>
                {data.components.find((n) => n.id === f.nodeId)?.label} ·{" "}
                {f.title}
              </strong>
              <p>{f.detail}</p>
              {f.evidence.map((e) => (
                <p className="map-evidence-path" key={`${e.path}:${e.line}`}>
                  {e.path}:{e.line}
                </p>
              ))}
            </article>
          ))}
        </div>
        {audit.frameworks.map((f) => (
          <p className="muted" key={f.name}>
            <strong>{f.name}:</strong> {f.scope}
          </p>
        ))}
        {audit.limits.map((s) => (
          <p className="muted" key={s}>
            {s}
          </p>
        ))}
        <AiDraft ai={review.data?.ai} error={review.data?.aiError} />
      </section>
    </div>
  );
}

"use client";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ClipboardCheck, Download, Sparkles, LoaderCircle } from "lucide-react";
import { assessmentApi } from "./api";
import type { AssessmentResult } from "./types";
import { apiJson } from "@/shared/api/client";
import { download } from "@/shared/download";
import type { Workspace } from "@/features/workspace/workspace";
import { MarkdownContent } from "@/shared/markdown-content";
import { Heading } from "@/features/workspace/components/heading";
export function AssessmentPage({ w }: { w: Workspace }) {
  const client = useQueryClient();
  const [kind, setKind] = useState("readiness");
  const [name, setName] = useState("");
  const [intake, setIntake] = useState<Record<string, string>>({});
  const [mapId, setMapId] = useState("");
  const [contractId, setContractId] = useState("");
  const [result, setResult] = useState<AssessmentResult | null>(null);
  const scope = w.session?.workspace.id;
  const data = useQuery({
    queryKey: ["assessment-inputs", scope],
    queryFn: async ({ signal }) => {
      const [catalog, reports, maps, contracts] = await Promise.all([
        assessmentApi.catalog(signal),
        assessmentApi.list(signal),
        apiJson<{ maps: { id: string; name: string; status: string }[] }>(
          "/api/maps",
          { signal },
        ),
        apiJson<{
          contracts: {
            id: string;
            title?: string;
            document: { title: string };
          }[];
        }>("/api/contracts", { signal }),
      ]);
      return {
        catalog,
        reports: reports.reports,
        maps: maps.maps,
        contracts: contracts.contracts,
      };
    },
  });
  const generate = useMutation({
    mutationFn: (useAI: boolean) =>
      assessmentApi.create({
        name,
        kind,
        intake,
        useAI,
        ...(mapId ? { mapId } : {}),
        ...(contractId ? { contractId } : {}),
      }),
    onSuccess: async (r) => {
      setResult(r);
      await client.invalidateQueries({
        queryKey: ["assessment-inputs", scope],
      });
    },
  });
  const open = useMutation({
    mutationFn: assessmentApi.read,
    onSuccess: setResult,
  });
  const catalog = data.data?.catalog;
  const fields =
    catalog?.inputs.filter(
      (f) => f.applies.includes("all") || f.applies.includes(kind),
    ) ?? [];
  return (
    <>
      <Heading
        eyebrow="DIAGNOSE BEFORE YOU TEST"
        title="Assessments & reports"
        desc="Find risks and evidence gaps before testing."
      />
      <div className="notice">
        <ClipboardCheck size={18} /> Pre-test assessment · AI drafts require
        review.
      </div>
      {(data.error || open.error) && (
        <p className="error" role="alert">
          {data.error?.message || open.error?.message}
        </p>
      )}
      <details className="assessment-setup" open={!result}>
        <summary>Assessment inputs & saved reports</summary>
        <div className="detail-grid assessment-grid">
          <section className="panel">
            <h2 className="small-title">Prepare an assessment</h2>
            {!catalog ? (
              <p className="muted">Loading report requirements…</p>
            ) : (
              <>
                <label className="field-label" htmlFor="assessment-name">
                  Report name
                </label>
                <input
                  id="assessment-name"
                  className="field"
                  value={name}
                  maxLength={catalog.nameMaxChars}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Application · pre-test review"
                />
                <label className="field-label" htmlFor="assessment-kind">
                  Report type
                </label>
                <select
                  id="assessment-kind"
                  className="field"
                  value={kind}
                  onChange={(e) => setKind(e.target.value)}
                >
                  {catalog.reportKinds.map((k) => (
                    <option key={k.id} value={k.id}>
                      {k.label}
                    </option>
                  ))}
                </select>
                <p className="muted field-help">
                  {catalog.reportKinds.find((k) => k.id === kind)?.description}
                </p>
                <div className="assessment-sources">
                  <div>
                    <label
                      className="field-label"
                      htmlFor="assessment-contract"
                    >
                      API contract
                    </label>
                    <select
                      id="assessment-contract"
                      className="field"
                      value={contractId}
                      onChange={(e) => setContractId(e.target.value)}
                    >
                      <option value="">No contract attached</option>
                      {data.data?.contracts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.title || c.document.title}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label" htmlFor="assessment-map">
                      Application map
                    </label>
                    <select
                      id="assessment-map"
                      className="field"
                      value={mapId}
                      onChange={(e) => setMapId(e.target.value)}
                    >
                      <option value="">No map attached</option>
                      {data.data?.maps
                        .filter((m) => m.status === "completed")
                        .map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <p className="muted">
                  Missing information becomes an evidence gap in the report.
                  Enter sanitized context and references; omit credentials and
                  personal data.
                </p>
                {fields.map((f) => (
                  <div key={f.key}>
                    <label className="field-label" htmlFor={"intake-" + f.key}>
                      {f.label}
                    </label>
                    <textarea
                      id={"intake-" + f.key}
                      className="field"
                      rows={3}
                      maxLength={catalog.inputMaxChars}
                      placeholder={f.help}
                      value={intake[f.key] || ""}
                      onChange={(e) =>
                        setIntake((old) => ({
                          ...old,
                          [f.key]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
                <div className="row assessment-actions">
                  <button
                    className="primary"
                    disabled={!w.canEdit || !name.trim() || generate.isPending}
                    onClick={() => generate.mutate(false)}
                  >
                    {generate.isPending ? (
                      <LoaderCircle size={16} className="animate-spin" />
                    ) : (
                      <ClipboardCheck size={16} />
                    )}{" "}
                    Generate without AI
                  </button>
                  <button
                    className="secondary"
                    disabled={
                      !w.canEdit ||
                      !name.trim() ||
                      !w.ai.configured ||
                      generate.isPending
                    }
                    onClick={() => generate.mutate(true)}
                  >
                    <Sparkles size={16} /> Add AI suggestions
                  </button>
                </div>
                {!w.ai.configured && (
                  <p className="muted">
                    AI suggestions require a configured chat provider. You can
                    generate the rule-based report now.
                  </p>
                )}
                {generate.error && (
                  <p role="alert" className="error">
                    {generate.error.message}
                  </p>
                )}
              </>
            )}
          </section>
          <div className="stack">
            <section className="panel">
              <h2 className="small-title">Saved reports</h2>
              <p className="muted">
                Encrypted report content, scoped to this workspace.
              </p>
              {!data.data?.reports.length && (
                <p className="empty-state">
                  Create your first assessment to establish what needs
                  investigation.
                </p>
              )}
              {data.data?.reports.map((r) => (
                <button
                  key={r.id}
                  className="assessment-saved"
                  disabled={open.isPending}
                  onClick={() => open.mutate(r.id)}
                >
                  <strong>{r.name}</strong>
                  <small>
                    {r.kind} · {new Date(r.created_at).toLocaleDateString()}
                  </small>
                </button>
              ))}
            </section>
            <section className="panel">
              <h2 className="small-title">What reports can establish</h2>
              <p className="muted">
                Before execution: scope, missing requirements, static analysis
                limitations and risk hypotheses. After execution: use k6/JMeter,
                Prometheus/Jaeger, Playwright/Lighthouse, axe and Litmus
                evidence to confirm or reject those hypotheses.
              </p>
              <p className="muted">
                A supplied narrative is not a verified test result. Release and
                accessibility reports remain review plans until supporting
                evidence exists.
              </p>
            </section>
          </div>
        </div>
      </details>
      {result && (
        <section className="panel assessment-result" aria-live="polite">
          <div className="section-heading">
            <div>
              <span className="tag">Pre-test assessment · no execution</span>
              <h2>{result.report.name}</h2>
              <p>
                {result.report.readiness.supplied}/
                {result.report.readiness.total} relevant inputs supplied ·{" "}
                {result.report.readiness.missing} evidence gaps
              </p>
            </div>
            <div className="row">
              <button
                className="secondary"
                onClick={() =>
                  download("assessment-report.md", result.markdown)
                }
              >
                <Download size={16} /> Markdown
              </button>
              <button
                className="secondary"
                onClick={() =>
                  download(
                    "assessment-report.json",
                    JSON.stringify(result.report, null, 2),
                  )
                }
              >
                JSON
              </button>
            </div>
          </div>
          {result.aiError && <p className="notice">{result.aiError}</p>}
          <div className="assessment-findings">
            {result.report.findings.map((f) => (
              <article key={f.id} className="assessment-finding">
                <div className="row">
                  <span className="tag">{f.classification}</span>
                  <span className="role-pill">{f.priority} priority</span>
                </div>
                <h3>{f.title}</h3>
                <p>
                  <strong>Evidence:</strong> {f.evidence}
                </p>
                <p>
                  <strong>Suggested next step:</strong> {f.recommendation}
                </p>
                <p className="muted">{f.verification}</p>
              </article>
            ))}
          </div>
          <div className="divider" />
          <h3>Recommended investigations</h3>
          <div className="assessment-findings">
            {result.report.investigations.map((c) => (
              <article key={c.id} className="assessment-finding">
                <span className="tag">Planning suggestion · {c.tools}</span>
                <h3>{c.title}</h3>
                <p>{c.question}</p>
                <p>
                  <strong>Evidence needed:</strong> {c.requiredEvidence}
                </p>
                <p>{c.suggestion}</p>
              </article>
            ))}
          </div>
          {result.report.ai && (
            <div className="ai-output">
              <h3>AI suggestions · unverified draft</h3>
              <p className="muted">
                {result.report.ai.provider} · {result.report.ai.model}
              </p>
              <MarkdownContent content={result.report.ai.content} />
            </div>
          )}
          <div className="divider" />
          <details className="map-guidance">
            <summary>Review limitations</summary>
            <ul>
              {result.report.limitations.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </details>
        </section>
      )}
    </>
  );
}

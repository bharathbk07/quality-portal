"use client";
import { apiFetch } from "../../auth/session";
import { useState, useEffect } from "react";
import { Upload, Download, ExternalLink, BookOpen } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { Evidence } from ".././types";
import type { Workspace } from ".././hooks/use-workspace";
import { download } from "@/shared/download";
import { Heading } from "./heading";
import { AIAssistant } from "./aiassistant";
export function Discipline({ index, w }: { index: number; w: Workspace }) {
  const t = w.toolkits[index];
  const [p95, setP95] = useState(w.config!.default_p95_ms);
  const [vus, setVus] = useState(w.config!.default_virtual_users);
  const [saved, setSaved] = useState(false);
  const [evidence, setEvidence] = useState<Evidence | null>(null);
  const [error, setError] = useState("");
  const [content, setContent] = useState("");
  const [preparing, setPreparing] = useState(false);
  useEffect(() => {
    if (!w.canEdit) return;
    const lifecycle = new AbortController();
    void Promise.resolve().then(async () => {
      setPreparing(true);
      try {
        const r = await apiFetch("/api/artifacts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            discipline: index,
            ...(w.contractId ? { contractId: w.contractId } : {}),
            selected: w.selected,
            p95,
            vus,
          }),
          signal: lifecycle.signal,
        });
        const d = (await r.json()) as { content: string; error: string };
        if (!r.ok) throw new Error(d.error);
        if (!lifecycle.signal.aborted) setContent(d.content);
      } catch (e) {
        if (!lifecycle.signal.aborted) {
          setContent("");
          setError((e as Error).message);
        }
      } finally {
        if (!lifecycle.signal.aborted) setPreparing(false);
      }
    });
    return () => lifecycle.abort();
  }, [index, w.contractId, w.selected, p95, vus, w.canEdit]);
  return (
    <>
      <Heading eyebrow="OPEN-SOURCE TOOLKIT" title={t.name} desc={t.goal}>
        <span className="text-badge">{t.tools}</span>
      </Heading>
      <div className="detail-grid">
        <div>
          <section className="panel">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="small-title">Prepare your test</h2>
              <span className="tag">Not executed</span>
            </div>
            <p className="muted">
              {w.contract
                ? `${w.contract.title} · ${w.selected.length} operations in scope`
                : "Import an API contract for API-specific templates."}
            </p>
            {index === 0 && (
              <div className="row">
                <label className="field-label">
                  p95 budget (ms)
                  <input
                    className="field"
                    type="number"
                    min={1}
                    max={w.config!.max_p95_ms}
                    value={p95}
                    onChange={(e) =>
                      setP95(
                        Math.max(
                          1,
                          Math.min(
                            w.config!.max_p95_ms,
                            Number(e.target.value) || 1,
                          ),
                        ),
                      )
                    }
                  />
                </label>
                <label className="field-label">
                  Virtual users
                  <input
                    className="field"
                    type="number"
                    min={1}
                    max={w.config!.max_virtual_users}
                    value={vus}
                    onChange={(e) =>
                      setVus(
                        Math.max(
                          1,
                          Math.min(
                            w.config!.max_virtual_users,
                            Number(e.target.value) || 1,
                          ),
                        ),
                      )
                    }
                  />
                </label>
              </div>
            )}
            <ol className="instructions" style={{ marginTop: 18 }}>
              {t.steps.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <Tabs defaultValue="artifact" className="artifact-tabs">
              <TabsList>
                <TabsTrigger value="artifact">Tool artifact</TabsTrigger>
                <TabsTrigger value="run">Execution guide</TabsTrigger>
              </TabsList>
              <TabsContent value="artifact">
                <p className="muted" style={{ margin: "12px 0" }}>
                  Template · {t.artifact} · review and adapt before running
                </p>
                <pre className="code discipline-artifact">
                  {preparing
                    ? "Preparing artifact in the backend…"
                    : content ||
                      "Your workspace role allows you to review saved plans."}
                </pre>
              </TabsContent>
              <TabsContent value="run">
                <div className="notice" style={{ margin: "15px 0" }}>
                  Execution happens in your own environment. This portal does
                  not start a load test, browser test, or chaos experiment.
                </div>
                <pre className="code">{t.command}</pre>
                {(index === 3 || index === 5) && (
                  <p className="muted" style={{ marginTop: 14 }}>
                    Install Playwright and its browsers first. Set UI_TARGET in
                    your test environment. Your OpenAPI server may differ from
                    your UI URL.
                  </p>
                )}
                <a
                  className="tool-link row"
                  href={t.docs}
                  target="_blank"
                  rel="noreferrer"
                  style={{ marginTop: 18 }}
                >
                  Read official tool documentation <ExternalLink size={14} />
                </a>
              </TabsContent>
            </Tabs>
            <div className="row" style={{ marginTop: 20 }}>
              <button
                className="primary"
                disabled={!content || preparing}
                onClick={() => download(t.artifact, content)}
              >
                <Download size={16} /> Download artifact
              </button>
              <button
                className="secondary"
                disabled={!w.canEdit || !content || preparing}
                onClick={async () => {
                  try {
                    await w.savePlan({
                      discipline: index,
                      artifact: content,
                    });
                    setSaved(true);
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <BookOpen size={16} />
                {saved ? "Save another revision" : "Save to test plans"}
              </button>
            </div>
            {saved && (
              <p role="status" className="muted" style={{ marginTop: 10 }}>
                {w.authenticated
                  ? "Saved to PostgreSQL in your workspace."
                  : "Saved in this session. Download to keep a copy."}
              </p>
            )}
          </section>
          <section className="panel" style={{ marginTop: 20 }}>
            <h2 className="small-title">Bring back the evidence</h2>
            <p className="muted">
              Import a k6 summary, axe-core results, or Lighthouse JSON.
              Evidence is analyzed by the backend and is not persisted. AI
              receives a summary only when requested.
            </p>
            <label className="secondary" style={{ marginTop: 16 }}>
              <Upload size={16} /> Import result JSON
              <input
                className="sr-only"
                type="file"
                disabled={!w.canEdit}
                accept=".json"
                onChange={async (e) => {
                  try {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    if (file.size > w.config!.evidence_max_bytes)
                      throw new Error(
                        "Evidence exceeds the configured size limit.",
                      );
                    const r = await apiFetch("/api/evidence", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ report: await file.text() }),
                    });
                    const data = (await r.json()) as Evidence & {
                      error: string;
                    };
                    if (!r.ok) throw new Error(data.error);
                    setEvidence(data);
                    setError("");
                  } catch (e) {
                    setError((e as Error).message);
                    setEvidence(null);
                  }
                }}
              />
            </label>
            {error && (
              <p role="alert" className="error">
                {error}
              </p>
            )}
            {evidence && (
              <>
                <div className="divider" />
                <span className="tag">Imported · {evidence.tool}</span>
                <div className="report-values">
                  {evidence.facts.map(([label, value]) => (
                    <div key={label}>
                      <strong>{value}</strong>
                      <small>{label}</small>
                    </div>
                  ))}
                </div>
                <p className="muted">
                  Values are from your uploaded file. No execution or
                  authenticity verification is implied.
                </p>
              </>
            )}
          </section>
        </div>
        <div className="stack" style={{ alignContent: "start" }}>
          <AIAssistant
            key={index}
            w={w}
            scope={t.name.toLowerCase()}
            evidence={evidence?.summary}
          />
          <div className="notice">
            <strong>Your tools stay in charge.</strong>
            <br />
            Vivegam prepares artifacts and helps interpret evidence. {
              t.tools
            }{" "}
            provides execution and source-of-truth results.
          </div>
        </div>
      </div>
    </>
  );
}

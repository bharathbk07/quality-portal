"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { studioApi } from "./studio-api";
import { AiDraft } from "./intelligence-panel";
import type { Studio, Scenario } from "./studio-types";
export default function ScenarioPanel({
  mapId,
  data,
  canEdit,
  aiConfigured,
  onPropose,
}: {
  mapId: string;
  data: Studio;
  canEdit: boolean;
  aiConfigured: boolean;
  onPropose: (scenario: Scenario) => void;
}) {
  const [input, setInput] = useState<Scenario>({
    type: "outage",
    nodeId: data.components[0]?.id || "",
  });
  const [useAi, setUseAi] = useState(false);
  const run = useMutation({
    mutationFn: (scenario: Scenario) => studioApi.simulate(mapId, scenario, useAi),
  });
  return (
    <section className="studio-section">
      <span className="eyebrow">WHAT-IF WORKSPACE</span>
      <h3>Explore a change before testing</h3>
      <p className="notice">
        Structural simulation only. No application is stopped, traffic
        generated, data changed or resources resized. Failure propagation and
        performance remain hypotheses.
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          run.mutate({ ...input });
        }}
        className="studio-form-grid"
      >
        <label className="field-label">
          Scenario
          <select
            className="field"
            value={input.type}
            onChange={(e) =>
              setInput({ ...input, type: e.target.value as Scenario["type"] })
            }
          >
            <option value="outage">Kill-switch / hypothetical outage</option>
            <option value="traffic">Traffic spike</option>
            <option value="replace">Technology replacement</option>
          </select>
        </label>
        <label className="field-label">
          Component
          <select
            className="field"
            value={input.nodeId}
            onChange={(e) => setInput({ ...input, nodeId: e.target.value })}
          >
            {data.components.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label} · {n.kind}
              </option>
            ))}
          </select>
        </label>
        {input.type === "traffic" && (
          <label className="field-label">
            Traffic multiplier
            <input
              className="field"
              type="number"
              min={1}
              max={data.limits.maxMultiplier}
              step="any"
              required
              value={input.multiplier ?? ""}
              onChange={(e) =>
                setInput({ ...input, multiplier: Number(e.target.value) })
              }
            />
          </label>
        )}
        {input.type === "replace" && (
          <label className="field-label">
            Proposed technology
            <input
              className="field"
              maxLength={300}
              required
              value={input.replacement || ""}
              onChange={(e) =>
                setInput({ ...input, replacement: e.target.value })
              }
            />
          </label>
        )}
        <label className="row">
          <input
            type="checkbox"
            checked={useAi}
            disabled={!aiConfigured || !canEdit}
            onChange={(e) => setUseAi(e.target.checked)}
          />
          Add AI explanation
        </label>
        <button className="primary" disabled={!canEdit || run.isPending}>
          Analyze structural impact
        </button>
      </form>
      {run.error && (
        <p className="error" role="alert">
          {run.error.message}
        </p>
      )}
      {run.data && (
        <div className="studio-scenario-result">
          <span className="tag">Hypothetical · unverified</span>
          <h3>{run.data.result.title}</h3>
          <div className="studio-two-columns">
            <div>
              <strong>Potentially affected upstream</strong>
              <p>
                {run.data.result.impact.upstream
                  .map((n) => n.label)
                  .join(", ") || "None detected"}
              </p>
            </div>
            <div>
              <strong>Downstream review scope</strong>
              <p>
                {run.data.result.impact.downstream
                  .map((n) => n.label)
                  .join(", ") || "None detected"}
              </p>
            </div>
          </div>
          {run.data.result.findings.map((f) => (
            <p key={f}>{f}</p>
          ))}
          <h4>Evidence needed</h4>
          <ul>
            {run.data.result.requiredEvidence.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {run.data.result.assumptions.map((a) => (
            <p className="muted" key={a}>
              {a}
            </p>
          ))}
          <button className="secondary" onClick={() => run.variables && onPropose({ ...run.variables })}>
            Attach to proposed snapshot
          </button>
          <AiDraft ai={run.data.ai} error={run.data.aiError} />
        </div>
      )}
    </section>
  );
}

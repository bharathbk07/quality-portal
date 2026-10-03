"use client";
import { useState } from "react";
import type { Component, Annotation, Impact } from "./studio-types";
export default function ServiceInspector({
  component,
  annotation,
  impact,
  canEdit,
  maxChars,
  onChange,
}: {
  component: Component;
  annotation: Annotation;
  impact?: Impact;
  canEdit: boolean;
  maxChars: number;
  onChange: (value: Annotation) => void;
}) {
  const [draft, setDraft] = useState(annotation);
  const change = (key: keyof Annotation, value: string | string[]) => {
    const next = { ...draft, [key]: value };
    setDraft(next);
    onChange(next);
  };
  const m = component.metadata;
  return (
    <aside className="studio-inspector">
      <span className="eyebrow">COMPONENT DETAILS</span>
      <h3>{component.label}</h3>
      <p className="muted">
        {component.kind} · {m?.primaryLanguage || "Unknown language"}
      </p>
      {(component.kind === "database" ||
        !!component.databaseAccess?.length ||
        !!component.databaseTimeouts?.length) && (
        <details open>
          <summary>Database access & query templates</summary>
          {!!component.databaseNames?.length && (
            <p>Database: {component.databaseNames.join(", ")}</p>
          )}
          {!!component.databaseObjects?.length && (
            <div className="studio-fact">
              <strong>
                One database service · distinct schema / table objects
              </strong>
              {component.databaseObjects.map((o) => (
                <p key={`${o.database}:${o.schema}:${o.table}`}>
                  <code>
                    {[o.database, o.schema, o.table].filter(Boolean).join(".")}
                  </code>{" "}
                  ·{" "}
                  {o.consumerNames?.join(", ") ||
                    `${o.consumers.length} consumers`}
                  {!o.schema && " · default schema not declared"}
                </p>
              ))}
            </div>
          )}
          {component.databaseAccess?.map((q) => (
            <div className="studio-fact" key={q.id}>
              <pre className="database-query">
                <code>{q.query}</code>
              </pre>
              <p>
                {q.objects
                  .map((o) =>
                    [o.database, o.schema, o.table].filter(Boolean).join("."),
                  )
                  .join(" · ") || "Table identity requires runtime resolution"}
              </p>
              <p>
                {q.databaseIds.length
                  ? "Linked to the declared database dependency"
                  : "Database binding is ambiguous; no target assigned"}
              </p>
              <p className="muted">{q.classification}</p>
              <code>
                {q.evidence.path}:{q.evidence.line}
              </code>
            </div>
          ))}
          {component.databaseTimeouts?.map((t) => (
            <p key={`${t.evidence.path}:${t.evidence.line}:${t.name}`}>
              <code>{t.name}</code>: {t.value} {t.unit} · {t.evidence.path}:
              {t.evidence.line}
            </p>
          ))}
          <p className="muted">
            Round trips, executed parameters and database latency require a
            runtime trace. A static query template does not establish execution
            count or duration.
          </p>
        </details>
      )}
      <details open>
        <summary>Language, runtime & cache</summary>
        <p>
          {m?.languages
            ?.map((l) => `${l.name} (${l.fileCount} files)`)
            .join(" · ") || "Source ownership unknown"}
        </p>
        <p>
          {m?.runtimes?.map((r) => r.name).join(" · ") ||
            "Runtime not identified"}
        </p>
        {m?.caching?.length ? (
          m.caching.map((c) => (
            <div
              key={`${c.name}:${c.evidence.path}:${c.evidence.line}`}
              className="studio-fact"
            >
              <strong>{c.name}</strong>
              <p>
                {c.mechanism} · {c.certainty}
              </p>
              <code>
                {c.evidence.path}:{c.evidence.line}
              </code>
            </div>
          ))
        ) : (
          <p>
            No cache declaration detected. This does not prove caching is
            absent.
          </p>
        )}
      </details>
      <details open>
        <summary>Deployment & configuration</summary>
        {m?.deployments?.length ? (
          m.deployments.map((d) => (
            <div
              key={`${d.evidence.path}:${d.evidence.line}:${d.namespace}:${d.kind}`}
              className="studio-fact"
            >
              <strong>
                {d.platform} · {d.kind || "service"}
              </strong>
              <p>
                {d.environment} · {d.namespace || "namespace unknown"} ·{" "}
                {d.replicas === null
                  ? "replicas unspecified"
                  : `${d.replicas} replica(s)`}
              </p>
              {d.containers?.map((c) => (
                <div key={c.name}>
                  <code>{c.image}</code>
                  <p>
                    Requests: {JSON.stringify(c.requests)}
                    <br />
                    Limits: {JSON.stringify(c.limits)}
                  </p>
                  <p>
                    {c.ports
                      ?.map((p) => `${p.port}/${p.protocol}`)
                      .join(", ") || "No declared port"}
                  </p>
                  {c.healthChecks?.map((h) => (
                    <p key={`${h.type}:${h.path}`}>
                      {h.type}: {h.mechanism} {h.path} {h.port}
                    </p>
                  ))}
                </div>
              ))}
              {d.image && <code>{d.image}</code>}
              {d.buildContext && <p>Build context: {d.buildContext}</p>}
            </div>
          ))
        ) : (
          <p>No supported deployment definition detected.</p>
        )}
        {m?.serviceEndpoints?.map((s) => (
          <div className="studio-fact" key={`${s.name}:${s.namespace}`}>
            <strong>
              Service {s.name} · {s.type}
            </strong>
            <p>
              {s.ports
                .map((p) => `${p.port}/${p.protocol} → ${p.targetPort}`)
                .join(", ")}
            </p>
            <code>
              {s.evidence.path}:{s.evidence.line}
            </code>
          </div>
        ))}
        <p>
          Runtime flag names: {m?.runtimeFlags?.join(", ") || "Not identified"}.
          Values are withheld.
        </p>
      </details>
      <details open>
        <summary>Dependency impact</summary>
        <p>
          <strong>Upstream:</strong>{" "}
          {impact?.upstream.map((n) => n.label).join(", ") || "None detected"}
        </p>
        <p>
          <strong>Downstream:</strong>{" "}
          {impact?.downstream.map((n) => n.label).join(", ") || "None detected"}
        </p>
        <small>{impact?.basis || "Loading declared dependency paths…"}</small>
      </details>
      <details>
        <summary>Repository evidence</summary>
        {component.evidence.map((e) => (
          <p className="map-evidence-path" key={`${e.path}:${e.line}`}>
            {e.path}:{e.line} · {e.detail}
          </p>
        ))}
      </details>
      <details open>
        <summary>Owner annotations</summary>
        <p className="muted">
          Owner-supplied context. Save a snapshot to share these changes.
        </p>
        <label className="field-label">
          Team / primary contact
          <input
            className="field"
            value={draft.owner ?? m?.owner ?? ""}
            maxLength={300}
            disabled={!canEdit}
            onChange={(e) => change("owner", e.target.value)}
          />
        </label>
        <label className="field-label">
          Custom boundary
          <input
            className="field"
            value={draft.group || ""}
            maxLength={300}
            disabled={!canEdit}
            onChange={(e) => change("group", e.target.value)}
          />
        </label>
        <label className="field-label">
          Container description
          <textarea
            className="field"
            value={draft.groupDescription || ""}
            maxLength={maxChars}
            disabled={!canEdit}
            onChange={(e) => change("groupDescription", e.target.value)}
          />
        </label>
        <label className="field-label">
          Notes
          <textarea
            className="field"
            value={draft.notes || ""}
            maxLength={maxChars}
            disabled={!canEdit}
            onChange={(e) => change("notes", e.target.value)}
          />
        </label>
        <label className="field-label">
          Warning annotation
          <textarea
            className="field"
            value={draft.warning || ""}
            maxLength={maxChars}
            disabled={!canEdit}
            onChange={(e) => change("warning", e.target.value)}
          />
        </label>
        <label className="field-label">
          Documentation / runbooks (HTTPS, one per line)
          <textarea
            className="field"
            value={(draft.documentation || []).join("\n")}
            disabled={!canEdit}
            onChange={(e) =>
              change(
                "documentation",
                e.target.value
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <div className="row">
          <label className="field-label">
            Color
            <input
              type="color"
              value={draft.color || "#edf4f1"}
              disabled={!canEdit}
              onChange={(e) => change("color", e.target.value)}
            />
          </label>
          <label className="field-label">
            Icon
            <select
              className="field"
              value={draft.icon || component.kind}
              disabled={!canEdit}
              onChange={(e) => change("icon", e.target.value)}
            >
              {[
                "service",
                "frontend",
                "database",
                "cache",
                "queue",
                "gateway",
                "external",
              ].map((i) => (
                <option key={i}>{i}</option>
              ))}
            </select>
          </label>
        </div>
        {draft.documentation
          ?.filter((url) => url.startsWith("https://"))
          .map((url) => (
            <p key={url}>
              <a href={url} target="_blank" rel="noopener noreferrer">
                {url}
              </a>
            </p>
          ))}
      </details>
    </aside>
  );
}

"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiJson, jsonBody } from "@/shared/api/client";
export default function ProjectActions({
  id,
  components,
  name,
  canEdit,
  isAdmin,
  onChanged,
  onDeleted,
}: {
  id: string;
  components: { id: string; label: string }[];
  name: string;
  canEdit: boolean;
  isAdmin: boolean;
  onChanged: () => Promise<void>;
  onDeleted: () => Promise<void>;
}) {
  const [diagramType, setDiagramType] = useState("flowchart");
  const [entryId, setEntryId] = useState("");
  const [traceJson, setTraceJson] = useState("[]");
  const [direction, setDirection] = useState("LR");
  const [showDelete, setShowDelete] = useState(false);
  const [confirmName, setConfirmName] = useState("");
  const regenerate = useMutation({
    mutationFn: () =>
      apiJson(`/api/maps/${id}/regenerate`, {
        method: "POST",
        ...jsonBody({
          direction,
          diagramType,
          ...(entryId ? { entryId } : {}),
          ...(diagramType === "trace" ? { spans: JSON.parse(traceJson) } : {}),
        }),
      }),
    onSuccess: onChanged,
  });
  const remove = useMutation({
    mutationFn: () =>
      apiJson(`/api/maps/${id}`, {
        method: "DELETE",
        ...jsonBody({ confirmName }),
      }),
    onSuccess: onDeleted,
  });
  return (
    <details className="map-project-options">
      <summary>Diagram options & project actions</summary>
      <section className="map-project-actions">
        <label className="field-label">
          Diagram type
          <select
            className="field"
            value={diagramType}
            onChange={(e) => setDiagramType(e.target.value)}
          >
            <option value="flowchart">Architecture flowchart</option>
            <option value="sequence">Possible request sequence</option>
            <option value="swimlane">Request flow swimlanes</option>
            <option value="class">Declared classes (JS / TypeScript)</option>
            <option value="state">Declared JSON state machines</option>
            <option value="trace">Observed trace sequence</option>
          </select>
        </label>
        {(diagramType === "sequence" || diagramType === "swimlane") && (
          <label className="field-label">
            Entry service
            <select
              className="field"
              value={entryId}
              onChange={(e) => setEntryId(e.target.value)}
            >
              <option value="">Automatic frontend / gateway</option>
              {components.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.label}
                </option>
              ))}
            </select>
          </label>
        )}
        {diagramType === "trace" && (
          <label className="field-label">
            Normalized OpenTelemetry spans (JSON array)
            <textarea
              className="field"
              value={traceJson}
              onChange={(e) => setTraceJson(e.target.value)}
            />
            <span className="muted">
              Each span needs traceId, spanId, parentSpanId (optional), service,
              operation and numeric startTime. Optional durationMs, roundTrips
              and database (name, schema, table, query, timeoutMs) show reported
              database details. SQL literal values are redacted by the backend.
              Omit credentials and parameter payloads.
            </span>
          </label>
        )}
        <label className="field-label">
          Diagram direction
          <select
            className="field"
            value={direction}
            onChange={(e) => setDirection(e.target.value)}
          >
            <option value="LR">Left to right</option>
            <option value="TD">Top to bottom</option>
            <option value="RL">Right to left</option>
            <option value="BT">Bottom to top</option>
          </select>
        </label>
        <button
          className="secondary"
          disabled={!canEdit || regenerate.isPending}
          onClick={() => regenerate.mutate()}
        >
          Regenerate Mermaid diagram
        </button>
        <button
          className="secondary"
          disabled={!isAdmin}
          onClick={() => setShowDelete(!showDelete)}
        >
          Delete map project
        </button>
        <p className="muted">
          Regeneration uses stored evidence. Refresh the repository to discover
          code changes. Static sequences show possible paths, not observed
          execution. Class and state views require explicit declarations.
          Deletion requires a workspace administrator.
        </p>
        {regenerate.isSuccess && (
          <p className="notice" role="status">
            Mermaid regenerated from repository evidence.
          </p>
        )}
        {(regenerate.error || remove.error) && (
          <p className="error" role="alert">
            {regenerate.error?.message || remove.error?.message}
          </p>
        )}
        {showDelete && (
          <form
            className="studio-section"
            onSubmit={(e) => {
              e.preventDefault();
              remove.mutate();
            }}
          >
            <h3>Delete {name}?</h3>
            <p>
              This permanently removes this map, documentation context, AI
              enrichment and all snapshots. It does not delete the Git
              repository, tool configuration or previously generated independent
              assessment reports.
            </p>
            <label className="field-label">
              Type the exact project name
              <input
                className="field"
                required
                value={confirmName}
                onChange={(e) => setConfirmName(e.target.value)}
              />
            </label>
            <button
              className="primary"
              disabled={!isAdmin || confirmName !== name || remove.isPending}
            >
              Permanently delete map project
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => setShowDelete(false)}
            >
              Cancel
            </button>
          </form>
        )}
      </section>
    </details>
  );
}

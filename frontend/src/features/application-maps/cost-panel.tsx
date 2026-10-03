"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { studioApi } from "./studio-api";
import type { Studio, CostInput } from "./studio-types";
export default function CostPanel({
  mapId,
  data,
  canEdit,
}: {
  mapId: string;
  data: Studio;
  canEdit: boolean;
}) {
  const [currency, setCurrency] = useState("");
  const [hours, setHours] = useState("");
  const [nodeId, setNodeId] = useState(data.components[0]?.id || "");
  const [fields, setFields] = useState<Record<string, string>>({});
  const [items, setItems] = useState<CostInput["items"]>([]);
  const forecast = useMutation({
    mutationFn: () =>
      studioApi.cost(mapId, { currency, hours: Number(hours), items }),
  });
  const rateFields = [
    { key: "replicas", label: "Replica quantity" },
    { key: "cpuHour", label: "CPU core / hour" },
    { key: "memoryGiBHour", label: "GiB memory / hour" },
    { key: "flatHour", label: "Additional flat / hour" },
    { key: "storageGiBMonth", label: "GiB storage / month" },
    { key: "storageGiB", label: "Storage GiB / replica" },
  ];
  return (
    <section className="studio-section">
      <span className="eyebrow">CONDITIONAL COST FORECAST</span>
      <h3>Use your cloud pricing and resource evidence</h3>
      <p className="notice">
        Supply approved unit prices or a flat per-instance price. Nothing is
        inferred from a vendor name. This estimate excludes discounts,
        shared-host packing, egress, taxes and managed-service billing details.
        AI does not invent pricing.
      </p>
      <div className="studio-form-grid">
        <label className="field-label">
          Currency (ISO code)
          <input
            className="field"
            value={currency}
            maxLength={3}
            placeholder="Currency code"
            onChange={(e) => setCurrency(e.target.value.toUpperCase())}
          />
        </label>
        <label className="field-label">
          Billable hours / month
          <input
            className="field"
            type="number"
            min={1}
            max={data.limits.maxHours}
            value={hours}
            onChange={(e) => setHours(e.target.value)}
          />
        </label>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const item = {
            nodeId,
            ...Object.fromEntries(
              Object.entries(fields)
                .filter(([, v]) => v !== "")
                .map(([k, v]) => [k, Number(v)]),
            ),
          };
          setItems((current) => [
            ...current.filter((i) => i.nodeId !== nodeId),
            item,
          ]);
          setFields({});
        }}
      >
        <label className="field-label">
          Component
          <select
            className="field"
            value={nodeId}
            onChange={(e) => setNodeId(e.target.value)}
          >
            {data.components.map((n) => (
              <option value={n.id} key={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <div className="studio-form-grid">
          {rateFields.map((f) => (
            <label className="field-label" key={f.key}>
              {f.label}
              <input
                className="field"
                type="number"
                min={f.key === "replicas" ? 1 : 0}
                step={f.key === "replicas" ? 1 : "any"}
                value={fields[f.key] || ""}
                onChange={(e) =>
                  setFields({ ...fields, [f.key]: e.target.value })
                }
              />
            </label>
          ))}
        </div>
        <button className="secondary" disabled={!canEdit}>
          Add / replace pricing row
        </button>
      </form>
      {items.length > 0 && (
        <div className="studio-price-list">
          {items.map((i) => (
            <p key={i.nodeId}>
              <strong>
                {data.components.find((n) => n.id === i.nodeId)?.label}
              </strong>{" "}
              ·{" "}
              {JSON.stringify(
                Object.fromEntries(
                  Object.entries(i).filter(([k]) => k !== "nodeId"),
                ),
              )}{" "}
              <button
                className="tool-link"
                onClick={() =>
                  setItems(items.filter((x) => x.nodeId !== i.nodeId))
                }
              >
                Remove
              </button>
            </p>
          ))}
        </div>
      )}
      <button
        className="primary"
        disabled={
          !canEdit || forecast.isPending || !items.length || !currency || !hours
        }
        onClick={() => forecast.mutate()}
      >
        Calculate conditional forecast
      </button>
      {forecast.error && (
        <p role="alert" className="error">
          {forecast.error.message}
        </p>
      )}
      {forecast.data && (
        <>
          <div className="studio-summary">
            <strong>
              {forecast.data.result.total === null
                ? "Incomplete pricing"
                : `${forecast.data.result.currency} ${forecast.data.result.total.toFixed(2)} / month`}
            </strong>
            <p>
              {forecast.data.result.coverage.priced} of{" "}
              {forecast.data.result.coverage.submitted} submitted rows priced ·{" "}
              {forecast.data.result.coverage.mapComponents} mapped components.
              Priced subtotal: {forecast.data.result.currency}{" "}
              {forecast.data.result.pricedSubtotal.toFixed(2)}
            </p>
          </div>
          <div className="markdown-table">
            <table>
              <thead>
                <tr>
                  <th>Component / environment</th>
                  <th>Resources / replica</th>
                  <th>Quantity</th>
                  <th>Monthly estimate</th>
                  <th>Missing inputs</th>
                </tr>
              </thead>
              <tbody>
                {forecast.data.result.rows.map((r) => (
                  <tr key={r.nodeId}>
                    <td>
                      {r.label}
                      <br />
                      {r.environment}
                    </td>
                    <td>
                      {r.cpuCores ?? "?"} CPU · {r.memoryGiB ?? "?"} GiB
                    </td>
                    <td>{r.replicas ?? "?"}</td>
                    <td>
                      {r.monthly === null
                        ? "Unknown"
                        : `${forecast.data!.result.currency} ${r.monthly.toFixed(2)}`}
                    </td>
                    <td>{r.missing.join(", ") || "None"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {forecast.data.result.assumptions.map((a) => (
            <p className="muted" key={a}>
              {a}
            </p>
          ))}
        </>
      )}
    </section>
  );
}

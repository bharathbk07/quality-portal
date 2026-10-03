"use client";
import { Upload, FileCode2, FlaskConical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { Workspace } from ".././hooks/use-workspace";
import { Heading } from "./heading";
import { AIAssistant } from "./aiassistant";
export function ApiWorkspace({
  w,
  onNavigate,
}: {
  w: Workspace;
  onNavigate: (s: string) => void;
}) {
  return (
    <>
      <Heading
        eyebrow="CONTRACT TO COVERAGE"
        title="OpenAPI workspace"
        desc="Choose the operations that matter. Prepare your next test."
      >
        <button
          className="primary"
          disabled={!w.canEdit}
          onClick={() => w.setImportOpen(true)}
        >
          <Upload size={16} />
          {w.contract ? "Replace contract" : "Import OpenAPI"}
        </button>
      </Heading>
      {!w.contract ? (
        <div className="panel empty">
          <FileCode2 size={40} />
          <h3>Your API is the starting point</h3>
          <p className="muted">
            Import an OpenAPI 3.x JSON or YAML contract to discover operations.
          </p>
          <div
            className="row"
            style={{ justifyContent: "center", marginTop: 24 }}
          >
            <button
              className="primary"
              disabled={!w.canEdit}
              onClick={() => w.setImportOpen(true)}
            >
              Import a contract
            </button>
            <button
              className="secondary"
              disabled={!w.canEdit}
              onClick={() =>
                w.loadSpec(w.exampleSpec).catch((e) => window.alert(e.message))
              }
            >
              Explore example API
            </button>
          </div>
        </div>
      ) : (
        <div className="detail-grid">
          <section className="panel">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 className="small-title">{w.contract.title}</h2>
              <span className="tag">v{w.contract.version}</span>
            </div>
            <p className="muted">
              {w.contract.endpoints.length} operations · {w.selected.length}{" "}
              selected
            </p>
            <p className="muted" style={{ overflowWrap: "anywhere" }}>
              Server: {w.contract.server || "Not declared"}
            </p>
            <div className="divider" />
            <div className="row">
              <button
                className="secondary"
                onClick={() =>
                  w.setSelected(
                    w.contract!.endpoints.map((e) => e.method + " " + e.path),
                  )
                }
              >
                Select all
              </button>
              <button className="secondary" onClick={() => w.setSelected([])}>
                Clear selection
              </button>
            </div>
            {w.contract.endpoints.map((e) => {
              const id = e.method + " " + e.path;
              return (
                <label className="endpoint" key={id}>
                  <Checkbox
                    aria-label={id}
                    checked={w.selected.includes(id)}
                    onCheckedChange={(checked) =>
                      w.setSelected((old) =>
                        checked ? [...old, id] : old.filter((x) => x !== id),
                      )
                    }
                  />
                  <span className="method">{e.method}</span>
                  <div>
                    <code>{e.path}</code>
                    <p className="muted">{e.summary}</p>
                    {e.required.length > 0 && (
                      <small>Required: {e.required.join(", ")}</small>
                    )}
                  </div>
                </label>
              );
            })}
          </section>
          <div className="stack" style={{ alignContent: "start" }}>
            <section className="panel">
              <h2 className="small-title">Turn scope into a plan</h2>
              <p className="muted">
                Start with a performance template or ask AI to draft a strategy
                across all six disciplines.
              </p>
              <button
                className="primary"
                style={{ marginTop: 18 }}
                onClick={() => onNavigate("Performance")}
              >
                <FlaskConical size={16} /> Prepare performance tests
              </button>
            </section>
            <div className="notice">{w.contract.warnings.join(" ")}</div>
            <AIAssistant w={w} scope="cross-discipline test strategy" />
          </div>
        </div>
      )}
    </>
  );
}

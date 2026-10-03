"use client";
import { Download, BookOpen } from "lucide-react";
import type { Workspace } from ".././hooks/use-workspace";
import { download } from "@/shared/download";
import { Heading } from "./heading";
export function Plans({
  w,
  onNavigate,
}: {
  w: Workspace;
  onNavigate: (s: string) => void;
}) {
  return (
    <>
      <Heading
        eyebrow="REVIEW BEFORE EXECUTION"
        title="Test plans"
        desc={
          w.authenticated
            ? "Your prepared artifacts, stored in your workspace."
            : "Your prepared artifacts, kept in this browser session."
        }
      />
      {w.plans.length === 0 ? (
        <div className="panel empty">
          <BookOpen size={40} />
          <h3>Prepare your first test plan</h3>
          <p className="muted">
            Open a discipline, tailor a template, and save it here.
          </p>
          <button
            className="primary"
            style={{ marginTop: 20 }}
            onClick={() => onNavigate("Performance")}
          >
            Prepare a performance test
          </button>
        </div>
      ) : (
        <div className="stack">
          {w.plans.map((p, i) => (
            <section className="plan-card" key={p.id ?? p.name}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <h3>{p.name}</h3>
                <span className="tag">Draft · not executed</span>
              </div>
              <p className="muted">
                {p.created} · {w.toolkits[p.discipline].tools}
              </p>
              <div className="row">
                <button
                  className="primary"
                  onClick={() =>
                    download(w.toolkits[p.discipline].artifact, p.artifact)
                  }
                >
                  <Download size={16} /> Download artifact
                </button>
                <button
                  className="secondary"
                  disabled={!w.canEdit}
                  onClick={() =>
                    w.removePlan(i).catch((e) => window.alert(e.message))
                  }
                >
                  Remove draft
                </button>
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}

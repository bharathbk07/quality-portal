"use client";
import { apiJson } from "@/shared/api/client";
import { useQuery } from "@tanstack/react-query";
import { AdapterStatus } from "../../connections/adapter-status";
import { ExternalLink, CheckCircle2, Unplug } from "lucide-react";
import { Heading } from "./heading";
export function Connections() {
  const { data, error } = useQuery({
    queryKey: ["tool-connections"],
    queryFn: ({ signal }) =>
      apiJson<{
        tools: {
          name: string;
          purpose: string;
          url: string;
          connection: string;
        }[];
      }>("/api/connections", { signal }),
  });
  const tools = data?.tools ?? [];
  return (
    <>
      <Heading
        eyebrow="YOUR EXISTING STACK"
        title="Tool connections"
        desc="Open-source tools for execution. One place to reach them."
      />
      <AdapterStatus />
      <div className="notice" style={{ marginBottom: 22 }}>
        Connections are configured in{" "}
        <a href="/settings" className="tool-link">
          Workspace settings
        </a>{" "}
        and stored encrypted in PostgreSQL.
      </div>
      {error && (
        <p role="alert" className="error">
          {error.message}
        </p>
      )}
      <div className="domain-grid">
        {tools.map((t) => (
          <section className="panel tool-card" key={t.name}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3>{t.name}</h3>
              {t.connection ? (
                <CheckCircle2 size={19} color="#26765c" />
              ) : (
                <Unplug size={19} color="#9ca9ae" />
              )}
            </div>
            <p className="muted">{t.purpose}</p>
            <p className="muted">
              {t.connection || "No installation URL saved"}
            </p>
            <div className="row">
              <a
                className="tool-link"
                href={t.url}
                target="_blank"
                rel="noreferrer"
              >
                Documentation
              </a>
              {t.connection && (
                <a
                  className="tool-link row"
                  href={t.connection}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open tool <ExternalLink size={14} />
                </a>
              )}
              <a className="tool-link" href="/settings">
                Configure
              </a>
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

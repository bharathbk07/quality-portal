"use client";
import { apiJson } from "@/shared/api/client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
export function AdapterStatus() {
  const query = useQuery({
    queryKey: ["adapter-status"],
    queryFn: ({ signal }) =>
      apiJson<{ tools: { id: string; configured: boolean; mode: string }[] }>(
        "/api/tools",
        { signal },
      ),
  });
  const tools = query.data?.tools ?? [];
  const message =
    query.error?.message || "Server adapters · read-only telemetry";
  const [output, setOutput] = useState("");
  const [busy, setBusy] = useState(false);
  async function read(kind: string) {
    setBusy(true);
    try {
      const data = await apiJson("/api/tools/" + kind);
      setOutput(JSON.stringify(data, null, 2));
    } catch (e) {
      setOutput((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel" style={{ marginBottom: 22 }}>
      <h2 className="small-title">Integration service</h2>
      <p className="muted">{message}</p>
      {tools.length > 0 && (
        <>
          <div className="row" style={{ marginTop: 16 }}>
            {tools
              .filter((t) => t.mode === "read-only API")
              .map((t) => (
                <span className="tag" key={t.id}>
                  {t.id} · {t.configured ? "Configured" : "Not configured"}
                </span>
              ))}
          </div>
          <div className="row" style={{ marginTop: 16 }}>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => read("prometheus/summary")}
            >
              Read request rate
            </button>
            <button
              className="secondary"
              disabled={busy}
              onClick={() => read("jaeger/services")}
            >
              List traced services
            </button>
            <a
              className="tool-link"
              href="/api/docs"
              target="_blank"
              rel="noreferrer"
            >
              OpenAPI documentation
            </a>
          </div>
        </>
      )}
      {output && (
        <pre className="code" aria-live="polite" style={{ marginTop: 18 }}>
          {output}
        </pre>
      )}
    </section>
  );
}

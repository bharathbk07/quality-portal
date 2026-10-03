"use client";
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ArrowUp, Sparkles, Network, Download } from "lucide-react";
import { studioApi } from "./studio-api";
import { MarkdownContent } from "@/shared/markdown-content";
import { download } from "@/shared/download";
import type { Studio, Component, MapAction } from "./studio-types";

const actionNames: Record<MapAction["type"], string> = {
  impact: "Trace dependencies",
  outage: "Explore outage impact",
  audit: "Review architecture",
  readme: "Draft architecture brief",
  runbook: "Draft runbook",
};
type Reply = {
  question: string;
  text: string;
  citations: { path: string; line: number }[];
  actions: MapAction[];
  note?: string;
  traceId?: string | null;
  requestId?: string;
};

export default function MapCopilot({
  mapId,
  data,
  component,
  revision,
  canEdit,
  aiConfigured,
  onInspect,
}: {
  mapId: string;
  data: Studio;
  component?: Component;
  revision: number;
  canEdit: boolean;
  aiConfigured: boolean;
  onInspect: (id: string) => void;
}) {
  const [question, setQuestion] = useState("");
  const [useAi, setUseAi] = useState(false);
  const [replies, setReplies] = useState<Reply[]>([]);
  const append = (reply: Reply) =>
    setReplies((previous) => [...previous, reply]);
  const ask = useMutation({
    mutationFn: (input: string) =>
      studioApi.ask(
        mapId,
        component ? `${input}\nFocus component: ${component.label}` : input,
        useAi,
        revision,
      ),
    onSuccess: (response, input) => {
      append({
        question: input,
        text: response.ai?.text || response.result.answer,
        citations: response.ai?.citations || response.result.citations,
        actions: response.ai?.actions || [],
        traceId: response.ai?.traceId || response.aiTrace?.traceId,
        requestId: response.ai?.requestId || response.aiTrace?.requestId,
        note:
          response.aiError ||
          (response.ai
            ? `AI draft · ${response.ai.model}`
            : "Repository evidence"),
      });
      setQuestion("");
    },
  });
  const run = useMutation({
    mutationFn: async (action: MapAction): Promise<Reply> => {
      const title = actionNames[action.type];
      if (action.type === "impact" && action.nodeId) {
        const result = await studioApi.impact(mapId, action.nodeId);
        onInspect(action.nodeId);
        return {
          question: title,
          text: `### Dependencies\n\nUpstream: ${result.upstream.map((n) => n.label).join(", ") || "None detected"}\n\nDownstream: ${result.downstream.map((n) => n.label).join(", ") || "None detected"}\n\n${result.basis}`,
          citations: [],
          actions: [],
        };
      }
      if (action.type === "outage" && action.nodeId) {
        const response = await studioApi.simulate(
          mapId,
          { type: "outage", nodeId: action.nodeId },
          useAi,
        );
        return {
          question: title,
          text:
            response.ai?.text ||
            `### ${response.result.title}\n\n${response.result.findings.join("\n\n")}\n\n### Evidence needed\n\n${response.result.requiredEvidence.join("\n\n")}`,
          citations: response.ai?.citations || [],
          actions: [],
          traceId: response.ai?.traceId || response.aiTrace?.traceId,
          requestId: response.ai?.requestId || response.aiTrace?.requestId,
          note:
            response.aiError || "Hypothetical analysis · no fault injection",
        };
      }
      if (action.type === "audit") {
        const response = await studioApi.audit(mapId, useAi);
        return {
          question: title,
          text:
            response.ai?.text ||
            response.result.findings
              .map(
                (f) =>
                  `### ${data.components.find((n) => n.id === f.nodeId)?.label || "Application"}: ${f.title}\n\n${f.detail}`,
              )
              .join("\n\n") ||
            "No findings in the supported static checks.",
          citations:
            response.ai?.citations ||
            response.result.findings.flatMap((f) => f.evidence),
          actions: [],
          traceId: response.ai?.traceId || response.aiTrace?.traceId,
          requestId: response.ai?.requestId || response.aiTrace?.requestId,
          note:
            response.aiError || "Static review · findings require verification",
        };
      }
      if (action.type === "readme" || action.type === "runbook") {
        const response = await studioApi.document(
          mapId,
          action.type,
          useAi,
          revision,
        );
        return {
          question: title,
          text: response.ai?.text || response.result.content,
          citations: response.ai?.citations || [],
          actions: [],
          traceId: response.ai?.traceId || response.aiTrace?.traceId,
          requestId: response.ai?.requestId || response.aiTrace?.requestId,
          note: response.aiError || "Documentation draft",
        };
      }
      throw new Error("Select a component before running this analysis.");
    },
    onSuccess: append,
  });
  const busy = ask.isPending || run.isPending;
  const scope = component?.label || "this application";
  const actions: MapAction[] = component
    ? [
        { type: "impact", nodeId: component.id },
        { type: "outage", nodeId: component.id },
      ]
    : [{ type: "audit" }, { type: "readme" }];
  return (
    <aside className="map-copilot" aria-label="Map copilot">
      <div className="copilot-heading">
        <Sparkles size={18} />
        <h3>Map copilot</h3>
        <span className="tag">{useAi ? "AI + evidence" : "Evidence"}</span>
      </div>
      <p className="copilot-context">
        <Network size={14} />{" "}
        {component
          ? `Focused on ${component.label}`
          : `${data.components.length} components · repository context`}
      </p>
      <div className="copilot-actions">
        {actions.map((action) => (
          <button
            key={action.type}
            className="secondary"
            disabled={!canEdit || busy}
            onClick={() => run.mutate(action)}
          >
            {actionNames[action.type]}
          </button>
        ))}
      </div>
      <div className="copilot-thread" aria-live="polite">
        {!replies.length && (
          <div className="copilot-welcome">
            <h4>Understand the architecture.</h4>
            <p>
              Choose a component or ask about a request flow, deployment, cache
              or failure impact.
            </p>
            <button
              className="tool-link"
              disabled={!canEdit || busy}
              onClick={() =>
                ask.mutate(
                  `Explain the request flow through ${scope}, cite repository evidence and identify unknown boundaries.`,
                )
              }
            >
              Explain the request flow →
            </button>
          </div>
        )}
        {replies.map((reply, index) => (
          <article className="copilot-reply" key={`${index}:${reply.question}`}>
            <h4>{reply.question}</h4>
            <MarkdownContent content={reply.text} />
            <details>
              <summary>Evidence & provenance</summary>
              <p>{reply.note}</p>
              {reply.traceId && (
                <p className="map-evidence-path">
                  LangSmith trace: <code>{reply.traceId}</code>
                </p>
              )}
              {reply.requestId && (
                <p className="map-evidence-path">
                  Request: <code>{reply.requestId}</code>
                </p>
              )}
              {reply.traceId && (
                <p>
                  Find this trace ID in your configured LangSmith project.
                  Message content is available only when content capture is
                  enabled.
                </p>
              )}
              {reply.citations.map((c, i) => (
                <p
                  className="map-evidence-path"
                  key={`${i}:${c.path}:${c.line}`}
                >
                  {c.path}:{c.line}
                </p>
              ))}
              {!reply.citations.length && (
                <p>No file citations returned for this result.</p>
              )}
            </details>
            <div className="copilot-actions">
              {reply.actions.map((action, i) => (
                <button
                  key={`${i}:${action.type}`}
                  className="secondary"
                  disabled={!canEdit || busy}
                  onClick={() => run.mutate(action)}
                >
                  {actionNames[action.type]}
                </button>
              ))}
              <button
                className="tool-link"
                onClick={() => download("map-analysis.md", reply.text)}
              >
                <Download size={13} /> Export
              </button>
            </div>
          </article>
        ))}
        {busy && (
          <p className="copilot-working" role="status">
            {ask.isPending ? "Reading map evidence…" : "Running analysis…"}
          </p>
        )}
        {(ask.error || run.error) && (
          <p className="error" role="alert">
            {ask.error?.message || run.error?.message}
          </p>
        )}
      </div>
      <form
        className="copilot-composer"
        onSubmit={(e) => {
          e.preventDefault();
          ask.mutate(question);
        }}
      >
        <label className="sr-only" htmlFor="map-copilot-question">
          Ask about this application
        </label>
        <textarea
          id="map-copilot-question"
          className="field"
          placeholder={`Ask about ${scope}…`}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          maxLength={Math.max(
            1,
            data.limits.questionMaxChars -
              (component ? component.label.length + 20 : 0),
          )}
          required
          disabled={!canEdit || busy}
        />
        <div className="row">
          <label className="row">
            <input
              type="checkbox"
              checked={useAi}
              disabled={!canEdit || !aiConfigured || busy}
              onChange={(e) => setUseAi(e.target.checked)}
            />{" "}
            Use AI
          </label>
          <button
            className="primary"
            aria-label="Send map question"
            disabled={!canEdit || busy || !question.trim()}
          >
            <ArrowUp size={16} />
          </button>
        </div>
        <details className="copilot-privacy">
          <summary>
            {aiConfigured
              ? "Context & AI data use"
              : "Configure AI in Settings"}
          </summary>
          <p>
            AI receives map metadata, retrieved redacted documentation and the
            current question. Answers are drafts. Actions run only when
            selected; this workspace does not change deployments.
          </p>
        </details>
      </form>
    </aside>
  );
}

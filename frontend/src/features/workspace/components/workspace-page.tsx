"use client";
import { PortalShell } from "@/shared/portal-shell";
import { AssessmentPage } from "@/features/assessment/assessment-page";
import { AccessBoundary } from "../../auth/identity-ui";
import dynamic from "next/dynamic";
const ApplicationMaps = dynamic(
  () =>
    import("../../application-maps/application-maps").then(
      (m) => m.ApplicationMaps,
    ),
  { loading: () => <p className="muted">Loading application maps…</p> },
);
import { useState } from "react";
import {
  useWorkspace,
  ImportDialog,
  ApiWorkspace,
  Discipline,
  Plans,
  Connections,
  Settings,
} from "../workspace";
import {
  Activity,
  Gauge,
  Eye,
  MousePointer2,
  Zap,
  Accessibility,
  Sparkles,
  Upload,
  Layers3,
  Plug,
  FileCode2,
  ArrowUpRight,
} from "lucide-react";
const domains = [
  {
    name: "Performance",
    tool: "k6 · Apache JMeter",
    icon: Gauge,
    color: "#e7f3ed",
    ink: "#24754c",
    desc: "Build realistic workloads. Find your limits.",
  },
  {
    name: "Observability",
    tool: "Prometheus · Grafana",
    icon: Eye,
    color: "#edf0fd",
    ink: "#6364b4",
    desc: "Connect signals to the questions that matter.",
  },
  {
    name: "APM & tracing",
    tool: "OpenTelemetry · Jaeger",
    icon: Activity,
    color: "#fff2e6",
    ink: "#ad6726",
    desc: "Follow a request. Understand the bottleneck.",
  },
  {
    name: "UI / UX",
    tool: "Playwright · Lighthouse",
    icon: MousePointer2,
    color: "#edf3ff",
    ink: "#4c72b9",
    desc: "Check real journeys across browsers.",
  },
  {
    name: "Chaos & resilience",
    tool: "LitmusChaos",
    icon: Zap,
    color: "#fff0ed",
    ink: "#c56a4d",
    desc: "Explore failure. Build confidence in recovery.",
  },
  {
    name: "Accessibility",
    tool: "axe-core · Playwright",
    icon: Accessibility,
    color: "#f3edfc",
    ink: "#895aab",
    desc: "Make every journey work for everyone.",
  },
];
export default function Home({
  initialView = "Overview",
  initialMapId,
}: {
  initialView?: string;
  initialMapId?: string;
}) {
  const views = [
    "Overview",
    "Assessments & reports",
    "OpenAPI workspace",
    "Application maps",
    "Test plans",
    "Tool connections",
    ...domains.map((d) => d.name),
  ];
  const [view, setView] = useState(
    views.includes(initialView) ? initialView : "Overview",
  );
  const w = useWorkspace();
  return (
    <AccessBoundary w={w}>
      <PortalShell w={w} view={view} onNavigate={setView}>
        {view === "Overview" ? (
          <>
            <div className="page-heading">
              <div>
                <div className="eyebrow">QUALITY, CONNECTED</div>
                <h1>Your testing command center</h1>
                <p>Less tool switching. More confidence in every release.</p>
              </div>
              <div className="row">
                <button
                  className="secondary"
                  onClick={() => setView("Application maps")}
                >
                  <Layers3 size={16} /> Map a repository
                </button>
                <button
                  className="primary"
                  disabled={!w.canEdit}
                  onClick={() => w.setImportOpen(true)}
                >
                  <Upload size={16} /> Import OpenAPI
                </button>
              </div>
            </div>
            <section className="start-panel">
              <div>
                <span className="mini-label">
                  <Sparkles size={15} /> INTELLIGENCE MEETS YOUR TOOLCHAIN
                </span>
                <h2>
                  From API contract to
                  <br />a thoughtful test strategy.
                </h2>
                <p>
                  Bring your OpenAPI spec. Turn requirements into test plans,
                  <br className="desktop" /> tool-ready scripts, and the right
                  questions to investigate.
                </p>
                <button
                  className="dark-button"
                  onClick={() => setView("Assessments & reports")}
                >
                  Assess before testing <ArrowUpRight size={16} />
                </button>
              </div>
              <div className="workflow">
                <div className="flow-source">
                  <FileCode2 />
                  <span>
                    OpenAPI contract
                    <small>Your application’s starting point</small>
                  </span>
                  <span className="version">3.x</span>
                </div>
                <div className="flow-line" />
                <div className="flow-ai">
                  <Sparkles size={20} />
                  <span>AI-assisted test planning</span>
                </div>
                <div className="flow-line" />
                <div className="flow-tools">
                  <span>k6</span>
                  <span>Grafana</span>
                  <span>Playwright</span>
                  <span>+ more</span>
                </div>
                <small>EXECUTION STAYS IN YOUR EXISTING TOOLS</small>
              </div>
            </section>
            <div className="section-heading">
              <div>
                <h2>One workspace. Six disciplines.</h2>
                <p>Plan, prepare, and investigate with purpose-built tools.</p>
              </div>
              <span className="text-badge">6 toolkits available</span>
            </div>
            <div className="domain-grid">
              {domains.map((d, i) => (
                <button
                  className="domain-card"
                  key={d.name}
                  onClick={() => setView(d.name)}
                >
                  <div className="card-top">
                    <span
                      className="domain-icon"
                      style={{ background: d.color, color: d.ink }}
                    >
                      <d.icon size={22} />
                    </span>
                    <ArrowUpRight size={18} />
                  </div>
                  <h3>{d.name}</h3>
                  <p>{d.desc}</p>
                  <footer>
                    <span>{d.tool}</span>
                    <span className="card-index">0{i + 1}</span>
                  </footer>
                </button>
              ))}
            </div>
            <div className="bottom-note">
              <span>
                <Plug size={17} /> An orchestration layer for your stack. Your
                tools remain the source of truth.
              </span>
              <span>DESIGNED FOR TEST ENGINEERS</span>
            </div>
          </>
        ) : view === "Assessments & reports" ? (
          <AssessmentPage w={w} />
        ) : view === "OpenAPI workspace" ? (
          <ApiWorkspace w={w} onNavigate={setView} />
        ) : view === "Application maps" ? (
          <ApplicationMaps
            key={w.session?.workspace.id}
            w={w}
            onNavigate={setView}
            initialMapId={initialMapId}
          />
        ) : view === "Test plans" ? (
          <Plans w={w} onNavigate={setView} />
        ) : view === "Tool connections" ? (
          <Connections />
        ) : view === "Settings" ? (
          <Settings w={w} />
        ) : !w.config || !w.toolkits.length ? (
          <div className="notice">
            Loading application configuration. If this persists, start the
            service stack and refresh.
          </div>
        ) : (
          <Discipline
            key={view}
            index={domains.findIndex((d) => d.name === view)}
            w={w}
          />
        )}
      </PortalShell>
      <ImportDialog w={w} />
    </AccessBoundary>
  );
}

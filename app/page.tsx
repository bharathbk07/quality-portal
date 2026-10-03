"use client";
import { ApplicationMaps } from "./application-maps";
import { useState } from "react";
import {
  useWorkspace,
  ImportDialog,
  ApiWorkspace,
  Discipline,
  Plans,
  Connections,
  Settings,
} from "./workspace";
import {
  Activity,
  Gauge,
  Eye,
  Fingerprint,
  MousePointer2,
  Zap,
  Accessibility,
  Sparkles,
  Upload,
  Layers3,
  Plug,
  FileCode2,
  ArrowUpRight,
  BookOpen,
  Settings2,
} from "lucide-react";
import {
  SidebarProvider,
  Sidebar,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarInset,
  SidebarTrigger,
} from "@/components/ui/sidebar";
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
export default function Home() {
  const [view, setView] = useState("Overview");
  const w = useWorkspace();
  return (
    <SidebarProvider>
      <Sidebar className="portal-sidebar">
        <SidebarHeader>
          <div className="brand">
            <span className="brand-mark">
              <Layers3 size={23} />
            </span>
            vivegam<span className="brand-dot">/</span>
          </div>
          <div className="workspace">
            <span className="workspace-avatar">Q</span>
            <div>
              Quality workspace<small>Non-functional engineering</small>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-label">WORKSPACE</div>
          <SidebarMenu>
            {[
              { name: "Overview", icon: Layers3 },
              { name: "OpenAPI workspace", icon: FileCode2 },
              { name: "Application maps", icon: Layers3 },
              { name: "Test plans", icon: BookOpen },
              { name: "Tool connections", icon: Plug },
            ].map((n) => (
              <SidebarMenuItem key={n.name}>
                <SidebarMenuButton
                  isActive={view === n.name}
                  onClick={() => setView(n.name)}
                >
                  <n.icon />
                  <span>{n.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="nav-label">TESTING DISCIPLINES</div>
          <SidebarMenu>
            {domains.map((d) => (
              <SidebarMenuItem key={d.name}>
                <SidebarMenuButton onClick={() => setView(d.name)}>
                  <d.icon />
                  <span>{d.name}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarContent>
        <SidebarFooter>
          <div className="sidebar-note">
            <Fingerprint size={21} />
            <strong>Your tools. One workspace.</strong>
            <p>Built around the open-source tools you already trust.</p>
          </div>
          <SidebarMenuButton onClick={() => window.location.assign("/settings")}>
            <Settings2 />
            Workspace settings
          </SidebarMenuButton>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset>
        <header className="topbar">
          <div>
            <SidebarTrigger />
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{view}</strong>
          </div>
          <button className="secondary" onClick={() => window.location.assign("/settings")}>
            {w.authenticated ? "Workspace connected" : "Sign in to workspace"}
          </button>
        </header>
        <main className="content">
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
                    onClick={() => setView("OpenAPI workspace")}
                  >
                    Explore the workspace <ArrowUpRight size={16} />
                  </button>
                </div>
                <div className="workflow">
                  <div className="flow-source">
                    <FileCode2 />
                    <span>
                      OpenAPI contract
                      <small>Your application's starting point</small>
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
                  <p>
                    Plan, prepare, and investigate with purpose-built tools.
                  </p>
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
          ) : view === "OpenAPI workspace" ? (
            <ApiWorkspace w={w} onNavigate={setView} />
          ) : view === "Application maps" ? (
            <ApplicationMaps w={w} onNavigate={setView} />
          ) : view === "Test plans" ? (
            <Plans w={w} onNavigate={setView} />
          ) : view === "Tool connections" ? (
            <Connections />
          ) : view === "Settings" ? (
            <Settings w={w} />
          ) : !w.config ? (
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
        </main>
        <ImportDialog w={w} />
      </SidebarInset>
    </SidebarProvider>
  );
}

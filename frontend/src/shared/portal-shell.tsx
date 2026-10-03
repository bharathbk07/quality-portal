"use client";
import Link from "next/link";
import { useEffect } from "react";
import {
  Layers3,
  FileCode2,
  BookOpen,
  Plug,
  ClipboardCheck,
  Gauge,
  Eye,
  Activity,
  MousePointer2,
  Zap,
  Accessibility,
  Settings2,
  ShieldCheck,
  UserRound,
  Fingerprint,
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
import { SessionBar } from "@/features/auth/identity-ui";
import type { Workspace } from "@/features/workspace/workspace";
const workspaceItems = [
  { name: "Overview", icon: Layers3 },
  { name: "Assessments & reports", icon: ClipboardCheck },
  { name: "OpenAPI workspace", icon: FileCode2 },
  { name: "Application maps", icon: Layers3 },
  { name: "Test plans", icon: BookOpen },
  { name: "Tool connections", icon: Plug },
];
const disciplines = [
  { name: "Performance", icon: Gauge },
  { name: "Observability", icon: Eye },
  { name: "APM & tracing", icon: Activity },
  { name: "UI / UX", icon: MousePointer2 },
  { name: "Chaos & resilience", icon: Zap },
  { name: "Accessibility", icon: Accessibility },
];
export function PortalShell({
  w,
  view,
  children,
  onNavigate,
}: {
  w: Workspace;
  view: string;
  children: React.ReactNode;
  onNavigate?: (view: string) => void;
}) {
  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  }, [view]);

  function navigation(items: typeof workspaceItems) {
    return (
      <SidebarMenu>
        {items.map((n) => (
          <SidebarMenuItem key={n.name}>
            <SidebarMenuButton
              isActive={view === n.name}
              asChild={!onNavigate}
              onClick={onNavigate ? () => onNavigate(n.name) : undefined}
            >
              {onNavigate ? (
                <>
                  <n.icon />
                  <span>{n.name}</span>
                </>
              ) : (
                <Link href={"/?view=" + encodeURIComponent(n.name)}>
                  <n.icon />
                  <span>{n.name}</span>
                </Link>
              )}
            </SidebarMenuButton>
          </SidebarMenuItem>
        ))}
      </SidebarMenu>
    );
  }
  return (
    <SidebarProvider>
      <Sidebar className="portal-sidebar">
        <SidebarHeader>
          <Link href="/" className="brand">
            <span className="brand-mark">
              <Layers3 size={23} />
            </span>
            vivegam<span className="brand-dot">/</span>
          </Link>
          <div className="workspace">
            <span className="workspace-avatar">Q</span>
            <div>
              {w.session?.workspace.name}
              <small>Non-functional engineering</small>
            </div>
          </div>
        </SidebarHeader>
        <SidebarContent>
          <div className="nav-label">WORKSPACE</div>
          {navigation(workspaceItems)}
          <div className="nav-label">TESTING DISCIPLINES</div>
          {navigation(disciplines)}
        </SidebarContent>
        <SidebarFooter>
          <div className="sidebar-note">
            <Fingerprint size={21} />
            <strong>Your tools. One workspace.</strong>
            <p>Built around the open-source tools you already trust.</p>
          </div>
          <SidebarMenu>
            {w.isAdmin && (
              <>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={view === "Connections & intelligence"}
                  >
                    <Link href="/settings">
                      <Settings2 />
                      <span>Workspace settings</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    asChild
                    isActive={view === "Administration"}
                  >
                    <Link href="/admin">
                      <ShieldCheck />
                      <span>Administration</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </>
            )}
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                isActive={view === "Account & security"}
              >
                <Link href="/account">
                  <UserRound />
                  <span>Account & access</span>
                </Link>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </Sidebar>
      <SidebarInset className="min-w-0">
        <header className="topbar">
          <div>
            <SidebarTrigger />
            <span>Workspace</span>
            <span className="slash">/</span>
            <strong>{view}</strong>
          </div>
          <SessionBar w={w} />
        </header>
        <main className="content" key={view}>
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}

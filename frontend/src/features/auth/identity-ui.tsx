"use client";
import { PortalShell } from "@/shared/portal-shell";
import { usePathname } from "next/navigation";
import { useState } from "react";
import Link from "next/link";
import {
  Layers3,
  ChevronDown,
  LogOut,
  ShieldCheck,
  Settings2,
  UserRound,
  LoaderCircle,
} from "lucide-react";
import { apiFetch } from "./session";
import type { Workspace } from "../workspace/workspace";
export function SessionBar({ w }: { w: Workspace }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const s = w.session;
  if (!s) return null;
  return (
    <div className="session-bar">
      <label className="workspace-select">
        <Layers3 size={16} />
        <span className="sr-only">Active workspace</span>
        <select
          aria-label="Active workspace"
          value={s.workspace.id}
          disabled={busy}
          onChange={async (e) => {
            setBusy(true);
            try {
              const r = await apiFetch("/api/auth/workspace", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id: e.target.value }),
              });
              const d = (await r.json()) as { error: string };
              if (!r.ok) throw new Error(d.error);
              window.location.replace("/");
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {s.workspaces.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        {busy ? (
          <LoaderCircle size={14} className="animate-spin" />
        ) : (
          <ChevronDown size={14} />
        )}
      </label>
      <span className="role-pill">{s.workspace.role}</span>
      <details className="account-menu">
        <summary aria-label="Account menu">
          <span className="user-avatar">
            {s.user.displayName.charAt(0).toUpperCase()}
          </span>
          <span>{s.user.displayName}</span>
          <ChevronDown size={14} />
        </summary>
        <div className="account-dropdown">
          <strong>{s.user.displayName}</strong>
          <small>{s.user.username}</small>
          <Link href="/account">
            <UserRound size={16} />
            My account
          </Link>
          {w.isAdmin && (
            <>
              <Link href="/admin">
                <ShieldCheck size={16} />
                Administration
              </Link>
              <Link href="/settings">
                <Settings2 size={16} />
                Connections
              </Link>
            </>
          )}
          <button
            onClick={async () => {
              await apiFetch("/api/session", { method: "DELETE" });
              window.location.replace("/login");
            }}
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      </details>
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </div>
  );
}
export function AccessBoundary({
  w,
  children,
  admin = false,
}: {
  w: Workspace;
  children: React.ReactNode;
  admin?: boolean;
}) {
  if (!w.ready || !w.session)
    return (
      <main className="session-loading">
        <Layers3 className="animate-pulse" size={36} />
        <h2>
          {w.serviceError ? "Unable to connect" : "Opening your workspace"}
        </h2>
        <p className="muted">
          {w.serviceError || "Verifying your session and access…"}
        </p>
        {w.serviceError && (
          <button className="primary" onClick={() => window.location.reload()}>
            Retry connection
          </button>
        )}
      </main>
    );
  if (admin && !w.isAdmin)
    return (
      <main className="session-loading">
        <ShieldCheck size={36} />
        <h2>Administrator access required</h2>
        <Link href="/" className="primary">
          Return to workspace
        </Link>
      </main>
    );
  return <>{children}</>;
}
export function PageShell({
  w,
  children,
  admin = false,
}: {
  w: Workspace;
  children: React.ReactNode;
  admin?: boolean;
}) {
  const path = usePathname();
  const view =
    path === "/admin"
      ? "Administration"
      : path === "/settings"
        ? "Connections & intelligence"
        : "Account & security";
  return (
    <AccessBoundary w={w} admin={admin}>
      <PortalShell w={w} view={view}>
        {children}
      </PortalShell>
    </AccessBoundary>
  );
}

"use client";
import { useState } from "react";
import { KeyRound, ShieldCheck, CheckCircle2 } from "lucide-react";
import { useWorkspace } from "../../workspace/workspace";
import { PageShell } from "../../auth/identity-ui";
import { apiFetch, rememberSession, type Session } from "../../auth/session";
export default function Account() {
  const w = useWorkspace();
  const [current, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <PageShell w={w}>
      <div className="page-heading">
        <div>
          <div className="eyebrow">YOUR IDENTITY</div>
          <h1>Account & security</h1>
          <p>Manage your sign-in and review your workspace access.</p>
        </div>
        <ShieldCheck size={30} />
      </div>
      {w.session?.user.mustChangePassword && (
        <div className="notice">
          Your administrator created a temporary password. Choose your own
          password to open your workspace.
        </div>
      )}
      <div className="detail-grid">
        <section className="panel">
          <h2 className="small-title">{w.session?.user.displayName}</h2>
          <p className="muted">{w.session?.user.username}</p>
          <div className="divider" />
          <h3>Workspace access</h3>
          {w.session?.workspaces.map((x) => (
            <div key={x.id} className="access-row">
              <span>{x.name}</span>
              <span className="role-pill">{x.role}</span>
            </div>
          ))}
        </section>
        <section className="panel">
          <h2 className="small-title row">
            <KeyRound size={20} />
            Change password
          </h2>
          {w.session?.user.localAccount ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setError("");
                setSuccess(false);
                if (password !== confirm) {
                  setError("New passwords do not match");
                  return;
                }
                setBusy(true);
                try {
                  const r = await apiFetch("/api/auth/password", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      currentPassword: current,
                      password,
                    }),
                  });
                  const d = (await r.json()) as Session & { error: string };
                  if (!r.ok) throw new Error(d.error);
                  rememberSession(d);
                  setCurrent("");
                  setPassword("");
                  setConfirm("");
                  setSuccess(true);
                  await w.sync();
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <p className="muted">
                Use a long, unique passphrase. Changing your password signs out
                your other sessions.
              </p>
              <label htmlFor="current" className="field-label">
                Current password
              </label>
              <input
                id="current"
                className="field"
                type="password"
                autoComplete="current-password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                required
              />
              <label htmlFor="new" className="field-label">
                New password
              </label>
              <input
                id="new"
                className="field"
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <label htmlFor="confirm" className="field-label">
                Confirm new password
              </label>
              <input
                id="confirm"
                className="field"
                type="password"
                autoComplete="new-password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
              />
              {error && (
                <p role="alert" className="error">
                  {error}
                </p>
              )}
              {success && (
                <p role="status" className="success row">
                  <CheckCircle2 size={18} />
                  Password changed. Your other sessions have been revoked.
                </p>
              )}
              <button
                className="primary"
                style={{ marginTop: 20 }}
                disabled={busy}
              >
                {busy ? "Updating…" : "Update password"}
              </button>
            </form>
          ) : (
            <p className="muted">
              Your organization manages your password and MFA through its
              identity provider.
            </p>
          )}
        </section>
      </div>
    </PageShell>
  );
}

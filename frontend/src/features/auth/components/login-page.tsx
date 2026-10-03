"use client";
import { useState } from "react";
import {
  Layers3,
  ArrowRight,
  ShieldCheck,
  KeyRound,
  Eye,
  EyeOff,
  LoaderCircle,
  Activity,
  GitBranch,
  Sparkles,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { authApi } from "../services/auth-api";
export default function Login() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const { data: methods } = useQuery({
    queryKey: ["auth-methods"],
    queryFn: ({ signal }) => authApi.methods(signal),
  });
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const d = await authApi.login(username, password);
      window.location.assign(d.user.mustChangePassword ? "/account" : "/");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <a className="brand" href="/login">
          <span className="brand-mark">
            <Layers3 size={24} />
          </span>
          vivegam<span className="brand-dot">/</span>
        </a>
        <div className="login-story-content">
          <span className="login-eyebrow">
            THE QUALITY ENGINEERING WORKSPACE
          </span>
          <h1>
            Confidence in
            <br />
            every release.
          </h1>
          <p>
            Your testing stack, connected.
            <br />
            Your teams, working as one.
          </p>
          <div className="login-visual" aria-hidden="true">
            <div className="visual-orbit orbit-one" />
            <div className="visual-orbit orbit-two" />
            <div className="visual-core">
              <Layers3 size={38} />
            </div>
            <div className="visual-node node-one">
              <Activity size={20} />
              <span>Observe</span>
            </div>
            <div className="visual-node node-two">
              <GitBranch size={20} />
              <span>Understand</span>
            </div>
            <div className="visual-node node-three">
              <Sparkles size={20} />
              <span>Accelerate</span>
            </div>
          </div>
          <div className="login-proof">
            <ShieldCheck size={18} />
            <span>
              Workspace isolation · Enterprise identity · Role-based access
            </span>
          </div>
        </div>
        <small className="login-footer">
          Built around the open-source tools you trust.
        </small>
      </section>
      <section className="login-form-side">
        <div className="login-card">
          <span className="login-icon">
            <KeyRound size={24} />
          </span>
          <div className="eyebrow">WELCOME TO YOUR WORKSPACE</div>
          <h2>Sign in to Vivegam</h2>
          <p className="muted">Make your next release a confident one.</p>
          <form onSubmit={submit}>
            <label className="field-label" htmlFor="username">
              Username
            </label>
            <input
              id="username"
              className="field"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Your username"
              required
              autoFocus
              disabled={busy}
            />
            <label className="field-label" htmlFor="password">
              Password
            </label>
            <div className="password-input">
              <input
                id="password"
                className="field"
                type={visible ? "text" : "password"}
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter your password"
                required
                disabled={busy}
              />
              <button
                type="button"
                aria-label={visible ? "Hide password" : "Show password"}
                onClick={() => setVisible(!visible)}
              >
                {visible ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
            {error && (
              <p className="error login-error" role="alert">
                {error}
              </p>
            )}
            <button className="primary login-submit" disabled={busy}>
              {busy ? (
                <LoaderCircle className="animate-spin" size={18} />
              ) : (
                <>
                  Sign in
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="login-divider">
            <span>or continue with your organization</span>
          </div>
          <a
            aria-disabled={!methods?.sso.enabled}
            className={
              "secondary sso-button " +
              (!methods?.sso.enabled ? "is-disabled" : "")
            }
            href={methods?.sso.enabled ? "/api/auth/sso/start" : undefined}
          >
            <ShieldCheck size={18} />
            {methods?.sso.label || "Enterprise SSO"}
          </a>
          <p className="login-help">
            {methods?.sso.enabled
              ? "Sign in securely with your organization’s identity provider."
              : "Enterprise SSO becomes available when your administrator connects your identity provider."}
          </p>
          <div className="login-support">
            Need access? Contact your workspace administrator.
          </div>
        </div>
      </section>
    </main>
  );
}

"use client";
import { useState } from "react";
import {
  ShieldCheck,
  Users,
  Layers3,
  Plus,
  History,
  KeyRound,
  CheckCircle2,
} from "lucide-react";
import { useWorkspace } from "../../workspace/workspace";
import { PageShell } from "../../auth/identity-ui";
import { apiFetch } from "../../auth/session";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiJson } from "@/shared/api/client";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
type User = {
  id: string;
  username: string;
  display_name: string;
  role?: string;
  disabled: boolean;
  is_super_admin: boolean;
  local_account: boolean;
};
type Audit = {
  id: string;
  action: string;
  actor: string;
  details: Record<string, unknown>;
  created_at: string;
};
type SSO = {
  enabled: boolean;
  label: string;
  issuer: string;
  clientId: string;
  hasSecret: boolean;
  domains: string;
  jit: boolean;
  callbackUrl: string;
};
const roleDetails = [
  ["viewer", "Read contracts, plans, maps and tool status."],
  ["developer", "Prepare artifacts and run repository coding agents."],
  ["tester", "Prepare tests, analyze evidence and generate AI strategies."],
  ["admin", "Manage workspace connections, users and role assignments."],
];
export default function Administration() {
  const w = useWorkspace();
  const [ssoDraft, setSso] = useState<SSO | null>(null);
  const [secret, setSecret] = useState("");
  const [workspaceName, setWorkspaceName] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("viewer");
  const [addId, setAddId] = useState("");
  const [lookup, setLookup] = useState("");
  const [addRole, setAddRole] = useState("viewer");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const client = useQueryClient();
  const scope = w.session?.workspace.id;
  const isSuperAdmin = w.session?.user.isSuperAdmin === true;
  const administration = useQuery({
    queryKey: ["administration", scope, isSuperAdmin],
    enabled: w.isAdmin && !w.session?.user.mustChangePassword,
    queryFn: async ({ signal }) => {
      const [members, events, users, sso] = await Promise.all([
        apiJson<{ members: User[] }>("/api/identity/members", { signal }),
        apiJson<{ events: Audit[] }>("/api/identity/audit", { signal }),
        isSuperAdmin
          ? apiJson<{ users: User[] }>("/api/identity/users", { signal })
          : Promise.resolve({ users: [] }),
        isSuperAdmin
          ? apiJson<SSO>("/api/auth/sso/config", { signal })
          : Promise.resolve(null),
      ]);
      return {
        members: members.members,
        events: events.events,
        users: users.users,
        sso,
      };
    },
  });
  const members = administration.data?.members ?? [];
  const events = administration.data?.events ?? [];
  const users = administration.data?.users ?? [];
  const sso = ssoDraft ?? administration.data?.sso ?? null;
  async function load() {
    await client.invalidateQueries({ queryKey: ["administration", scope] });
  }
  async function mutate(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await apiFetch(path, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const d = (await r.json()) as {
        error: string;
        members: User[];
        events: Audit[];
        users: User[];
      } & SSO;
      if (!r.ok) throw new Error(d.error);
      setMessage("Changes saved.");
      await load();
      return d;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  }
  return (
    <PageShell w={w} admin>
      <div className="page-heading">
        <div>
          <div className="eyebrow">ACCESS & GOVERNANCE</div>
          <h1>Workspace administration</h1>
          <p>Manage users, roles, workspaces and SSO.</p>
        </div>
        <span className="text-badge">
          <ShieldCheck size={16} />
          {w.session?.user.isSuperAdmin
            ? "Platform administrator"
            : "Workspace administrator"}
        </span>
      </div>
      {(error || administration.error) && (
        <div role="alert" className="error admin-feedback">
          {error || administration.error?.message}
        </div>
      )}
      {message && (
        <div role="status" className="success admin-feedback row">
          <CheckCircle2 size={18} />
          {message}
        </div>
      )}
      <Tabs defaultValue="members" className="admin-tabs">
        <TabsList>
          <TabsTrigger value="members">
            <Users size={16} />
            Members
          </TabsTrigger>
          <TabsTrigger value="workspaces">
            <Layers3 size={16} />
            Workspaces
          </TabsTrigger>
          <TabsTrigger value="users">
            <Plus size={16} />
            User accounts
          </TabsTrigger>
          {w.session?.user.isSuperAdmin && (
            <TabsTrigger value="sso">
              <KeyRound size={16} />
              Enterprise SSO
            </TabsTrigger>
          )}
          <TabsTrigger value="audit">
            <History size={16} />
            Audit history
          </TabsTrigger>
        </TabsList>
        <TabsContent value="members">
          <section className="panel">
            <div className="section-heading">
              <div>
                <h2>Members of {w.session?.workspace.name}</h2>
                <p className="muted">
                  Permissions are evaluated on each request. Role changes take
                  effect immediately.
                </p>
              </div>
              <span className="tag">{members.length} members</span>
            </div>
            <div className="table-scroll">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>Member</th>
                    <th>Identity</th>
                    <th>Workspace role</th>
                    <th>Access</th>
                  </tr>
                </thead>
                <tbody>
                  {members.map((u) => (
                    <tr key={u.id}>
                      <td>
                        <div className="member-cell">
                          <span className="user-avatar">
                            {u.display_name[0]?.toUpperCase()}
                          </span>
                          <div>
                            <strong>{u.display_name}</strong>
                            <small>{u.username}</small>
                          </div>
                        </div>
                      </td>
                      <td>
                        {u.local_account ? "Password" : "Enterprise SSO"}
                        {u.is_super_admin && (
                          <small className="muted">
                            Platform administrator
                          </small>
                        )}
                      </td>
                      <td>
                        <select
                          aria-label={"Role for " + u.display_name}
                          className="field role-select"
                          value={u.role}
                          disabled={busy}
                          onChange={async (e) => {
                            if (
                              await mutate(
                                "/api/identity/members/" + u.id,
                                "PUT",
                                { role: e.target.value },
                              )
                            )
                              await w.sync();
                          }}
                        >
                          {roleDetails.map(([name]) => (
                            <option key={name}>{name}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        {u.disabled ? (
                          <span className="tag">Disabled</span>
                        ) : (
                          <span className="success">Active</span>
                        )}
                        {!w.session?.workspaces.find(
                          (x) => x.id === w.session?.workspace.id,
                        )?.is_default && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              mutate("/api/identity/members/" + u.id, "DELETE")
                            }
                          >
                            Remove access
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {
              <form
                className="invite-row"
                onSubmit={async (e) => {
                  e.preventDefault();
                  let id = addId;
                  if (!w.session?.user.isSuperAdmin) {
                    const user = await mutate("/api/identity/lookup", "POST", {
                      username: lookup,
                    });
                    if (!user) return;
                    id = (user as unknown as { id: string }).id;
                  }
                  if (
                    await mutate("/api/identity/members/" + id, "PUT", {
                      role: addRole,
                    })
                  ) {
                    setAddId("");
                    setLookup("");
                  }
                }}
              >
                <label className="field-label">
                  Add existing user
                  {w.session?.user.isSuperAdmin ? (
                    <select
                      className="field"
                      value={addId}
                      onChange={(e) => setAddId(e.target.value)}
                      required
                    >
                      <option value="">Select a user</option>
                      {users
                        .filter(
                          (x) =>
                            !x.disabled && !members.some((m) => m.id === x.id),
                        )
                        .map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.display_name} · {x.username}
                          </option>
                        ))}
                    </select>
                  ) : (
                    <input
                      className="field"
                      value={lookup}
                      onChange={(e) => setLookup(e.target.value)}
                      placeholder="Exact username"
                      required
                    />
                  )}
                </label>
                <label className="field-label">
                  Workspace role
                  <select
                    className="field"
                    value={addRole}
                    onChange={(e) => setAddRole(e.target.value)}
                  >
                    {roleDetails.map(([r]) => (
                      <option key={r}>{r}</option>
                    ))}
                  </select>
                </label>
                <button
                  className="primary"
                  disabled={busy || (!addId && !lookup)}
                >
                  Add member
                </button>
              </form>
            }
          </section>
          <div className="role-grid">
            {roleDetails.map(([name, desc]) => (
              <section className="panel" key={name}>
                <span className="role-pill">{name}</span>
                <p className="muted">{desc}</p>
              </section>
            ))}
          </div>
        </TabsContent>
        <TabsContent value="workspaces">
          <div className="detail-grid">
            <section className="panel">
              <h2>Your workspaces</h2>
              {w.session?.workspaces.map((x) => (
                <div key={x.id} className="access-row">
                  <div>
                    <strong>{x.name}</strong>
                    <small className="muted">
                      {x.is_default
                        ? "Default · all users receive viewer access"
                        : "Dedicated team workspace"}
                    </small>
                  </div>
                  <span className="role-pill">{x.role}</span>
                </div>
              ))}
            </section>
            <section className="panel">
              <h2>Create a workspace</h2>
              <p className="muted">
                Contracts, plans, maps and encrypted connections are isolated.
                You become its administrator.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await mutate("/api/identity/workspaces", "POST", {
                      name: workspaceName,
                    })
                  ) {
                    setWorkspaceName("");
                    await w.sync();
                  }
                }}
              >
                <label htmlFor="workspace-name" className="field-label">
                  Workspace name
                </label>
                <input
                  id="workspace-name"
                  className="field"
                  value={workspaceName}
                  onChange={(e) => setWorkspaceName(e.target.value)}
                  required
                />
                <button
                  className="primary"
                  style={{ marginTop: 20 }}
                  disabled={busy}
                >
                  <Plus size={16} />
                  Create workspace
                </button>
              </form>
            </section>
          </div>
        </TabsContent>
        <TabsContent value="users">
          <div className="detail-grid">
            <section className="panel">
              <h2>Create a user account</h2>
              <p className="muted">
                New users receive viewer access to the default workspace and the
                role you choose here. They change their temporary password on
                first sign-in.
              </p>
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (
                    await mutate("/api/identity/users", "POST", {
                      username,
                      displayName,
                      password,
                      role,
                    })
                  ) {
                    setUsername("");
                    setDisplayName("");
                    setPassword("");
                  }
                }}
              >
                <label htmlFor="new-name" className="field-label">
                  Display name
                </label>
                <input
                  id="new-name"
                  className="field"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
                <label htmlFor="new-username" className="field-label">
                  Username
                </label>
                <input
                  id="new-username"
                  className="field"
                  autoComplete="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
                <label htmlFor="temporary-password" className="field-label">
                  Temporary password
                </label>
                <input
                  id="temporary-password"
                  className="field"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <label className="field-label" htmlFor="initial-role">
                  Role in this workspace
                </label>
                <select
                  id="initial-role"
                  className="field"
                  value={role}
                  onChange={(e) => setRole(e.target.value)}
                >
                  {roleDetails.map(([r]) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
                <button
                  className="primary"
                  style={{ marginTop: 20 }}
                  disabled={busy}
                >
                  Create user
                </button>
              </form>
            </section>
            <section className="panel">
              <h2>Account lifecycle</h2>
              <p className="muted">
                Passwords are stored as Argon2id hashes. Disabling an account
                revokes its active sessions.
              </p>
              {w.session?.user.isSuperAdmin ? (
                <div>
                  {users.map((u) => (
                    <div className="access-row" key={u.id}>
                      <div>
                        <strong>{u.display_name}</strong>
                        <small className="muted">{u.username}</small>
                      </div>
                      {u.is_super_admin ? (
                        <span className="role-pill">Protected</span>
                      ) : (
                        <button
                          className="secondary"
                          disabled={busy}
                          onClick={() =>
                            mutate("/api/identity/users/" + u.id, "PUT", {
                              disabled: !u.disabled,
                            })
                          }
                        >
                          {u.disabled ? "Enable" : "Disable"}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="notice">
                  Your platform administrator manages global account status.
                </div>
              )}
            </section>
          </div>
        </TabsContent>
        {sso && (
          <TabsContent value="sso">
            <div className="detail-grid">
              <section className="panel">
                <h2>Connect your identity provider</h2>
                <p className="muted">
                  OpenID Connect authorization code flow with PKCE. Supports
                  providers such as Keycloak, Microsoft Entra ID, Okta and
                  Auth0.
                </p>
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    const { hasSecret, callbackUrl, ...config } = sso;
                    void hasSecret;
                    void callbackUrl;
                    if (
                      await mutate("/api/auth/sso/config", "PUT", {
                        ...config,
                        ...(secret ? { clientSecret: secret } : {}),
                      })
                    )
                      setSecret("");
                  }}
                >
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={sso.enabled}
                      onChange={(e) =>
                        setSso({ ...sso, enabled: e.target.checked })
                      }
                    />
                    Enable enterprise SSO
                  </label>
                  {[
                    ["label", "Sign-in button label"],
                    ["issuer", "OIDC issuer URL"],
                    ["clientId", "Client ID"],
                    ["domains", "Allowed email domains (comma-separated)"],
                  ].map(([key, label]) => (
                    <label key={key} className="field-label">
                      {label}
                      <input
                        className="field"
                        value={String(sso[key as keyof SSO])}
                        onChange={(e) =>
                          setSso({ ...sso, [key]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                  <label className="field-label">
                    Client secret
                    <input
                      className="field"
                      type="password"
                      autoComplete="new-password"
                      value={secret}
                      onChange={(e) => setSecret(e.target.value)}
                      placeholder={
                        sso.hasSecret
                          ? "Saved securely · leave blank to preserve"
                          : "Enter client secret"
                      }
                    />
                  </label>
                  <label className="toggle-label">
                    <input
                      type="checkbox"
                      checked={sso.jit}
                      onChange={(e) =>
                        setSso({ ...sso, jit: e.target.checked })
                      }
                    />
                    Enroll verified identities from allowed domains
                  </label>
                  <button className="primary" disabled={busy}>
                    Save SSO configuration
                  </button>
                </form>
              </section>
              <section className="panel">
                <h2>Identity provider setup</h2>
                <p className="muted">
                  Register a confidential OIDC application with this exact
                  callback URL.
                </p>
                <code className="callback-url">{sso.callbackUrl}</code>
                <div className="divider" />
                <p className="muted">
                  Request scopes: openid, profile, email. Configure MFA,
                  conditional access and session policies at your identity
                  provider.
                </p>
                <div className="notice">
                  New SSO users receive viewer access to the default workspace.
                  Administrators grant additional workspace roles. Local and SSO
                  accounts are never automatically linked by email.
                </div>
              </section>
            </div>
          </TabsContent>
        )}
        <TabsContent value="audit">
          <section className="panel">
            <h2>Access audit history</h2>
            <p className="muted">
              Membership, workspace and account changes in this workspace.
            </p>
            {events.length ? (
              events.map((e) => (
                <div className="audit-row" key={e.id}>
                  <History size={17} />
                  <div>
                    <strong>{e.action.replaceAll(".", " ")}</strong>
                    <p className="muted">
                      {e.actor || "System"} ·{" "}
                      {new Date(e.created_at).toLocaleString()}
                    </p>
                    <small>{JSON.stringify(e.details)}</small>
                  </div>
                </div>
              ))
            ) : (
              <div className="empty muted">No access changes recorded yet.</div>
            )}
          </section>
        </TabsContent>
      </Tabs>
    </PageShell>
  );
}

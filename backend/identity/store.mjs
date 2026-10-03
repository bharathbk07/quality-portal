import { capabilities } from "./permissions.mjs";
import {
  encryptSettings,
  decryptSettings,
  encryptionKey,
} from "../settings/store.mjs";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { number, value, optional } from "../shared/config.mjs";
export { roles } from "./permissions.mjs";
export const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode, expose: true });
const digest = (token) => createHash("sha256").update(token).digest("hex");
export function passwordPolicy(password, env = process.env) {
  if (
    typeof password !== "string" ||
    !password.trim() ||
    optional("identity", "password_blocklist", env)
      .split(",")
      .some((p) => p.toLowerCase() === password.toLowerCase())
  )
    throw fail(
      "Choose a unique passphrase that is not a commonly used password",
    );
  if (
    typeof password !== "string" ||
    password.length < number("identity", "password_min_chars", env) ||
    password.length > number("validation", "password_max_chars", env)
  )
    throw fail(
      `Password must contain ${number("identity", "password_min_chars", env)}–${number("validation", "password_max_chars", env)} characters.`,
    );
}
export async function passwordHash(password, env = process.env) {
  passwordPolicy(password, env);
  return hash(password, {
    algorithm: 2,
    memoryCost: number("identity", "argon_memory_kib", env),
    timeCost: number("identity", "argon_time_cost", env),
    parallelism: number("identity", "argon_parallelism", env),
  });
}
export async function migrateIdentity(db, env = process.env) {
  const c = await db.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      "SELECT pg_advisory_xact_lock(hashtext('vivegam.identity.migration'))",
    );
    await c.query(`CREATE TABLE IF NOT EXISTS workspaces(id uuid PRIMARY KEY,name text NOT NULL,is_default boolean NOT NULL DEFAULT false,created_at timestamptz NOT NULL DEFAULT now());
 CREATE UNIQUE INDEX IF NOT EXISTS one_default_workspace ON workspaces(is_default) WHERE is_default;
 CREATE TABLE IF NOT EXISTS users(id uuid PRIMARY KEY,username text NOT NULL UNIQUE,display_name text NOT NULL,password_hash text,is_super_admin boolean NOT NULL DEFAULT false,disabled boolean NOT NULL DEFAULT false,must_change_password boolean NOT NULL DEFAULT false,failed_logins integer NOT NULL DEFAULT 0,locked_until timestamptz,issuer text,subject text,created_at timestamptz NOT NULL DEFAULT now(),UNIQUE(issuer,subject));
 CREATE TABLE IF NOT EXISTS workspace_members(workspace_id uuid REFERENCES workspaces(id),user_id uuid REFERENCES users(id),role text NOT NULL CHECK(role IN ('admin','viewer','developer','tester')),PRIMARY KEY(workspace_id,user_id));
 CREATE TABLE IF NOT EXISTS auth_sessions(token_hash text PRIMARY KEY,user_id uuid REFERENCES users(id),workspace_id uuid REFERENCES workspaces(id),method text NOT NULL,expires_at timestamptz NOT NULL,last_seen timestamptz NOT NULL DEFAULT now(),created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS auth_sessions_user ON auth_sessions(user_id);
 CREATE TABLE IF NOT EXISTS identity_audit(id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,actor_id uuid,workspace_id uuid,action text NOT NULL,details jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now());
 CREATE TABLE IF NOT EXISTS sso_flows(id text PRIMARY KEY,state text NOT NULL,payload jsonb NOT NULL,expires_at timestamptz NOT NULL);
 CREATE TABLE IF NOT EXISTS workspace_agents(id text PRIMARY KEY,workspace_id uuid REFERENCES workspaces(id),created_at timestamptz NOT NULL DEFAULT now());`);
    let workspace = (
      await c.query("SELECT id FROM workspaces WHERE is_default")
    ).rows[0];
    if (!workspace) {
      workspace = { id: randomUUID() };
      await c.query(
        "INSERT INTO workspaces(id,name,is_default) VALUES($1,$2,true)",
        [workspace.id, value("identity", "default_workspace_name", env)],
      );
    }
    for (const table of [
      "contracts",
      "plans",
      "application_maps",
      "audit_events",
      "workspace_settings",
    ]) {
      await c.query(
        `ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES workspaces(id)`,
      );
      await c.query(
        `UPDATE ${table} SET workspace_id=$1 WHERE workspace_id IS NULL`,
        [workspace.id],
      );
      await c.query(
        `ALTER TABLE ${table} ALTER COLUMN workspace_id SET NOT NULL`,
      );
      await c.query(
        `CREATE INDEX IF NOT EXISTS ${table}_workspace ON ${table}(workspace_id)`,
      );
    }
    await c.query(
      "ALTER TABLE workspace_settings ADD COLUMN IF NOT EXISTS encryption_version integer NOT NULL DEFAULT 1",
    );
    for (const row of (
      await c.query(
        "SELECT * FROM workspace_settings WHERE encryption_version=1",
      )
    ).rows) {
      const e = encryptSettings(
        `${row.workspace_id}:${row.id}`,
        decryptSettings(row, encryptionKey(env)),
        encryptionKey(env),
      );
      await c.query(
        "UPDATE workspace_settings SET ciphertext=$3,iv=$4,tag=$5,encryption_version=2 WHERE workspace_id=$1 AND id=$2",
        [row.workspace_id, row.id, e.ciphertext, e.iv, e.tag],
      );
    }
    await c.query(
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1",
    );
    await c.query(
      "ALTER TABLE auth_sessions ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1",
    );
    await c.query(
      "ALTER TABLE workspace_settings DROP CONSTRAINT IF EXISTS workspace_settings_pkey",
    );
    await c.query(
      "ALTER TABLE workspace_settings ADD PRIMARY KEY(workspace_id,id)",
    );
    const username = optional(
      "identity",
      "bootstrap_admin_username",
      env,
    ).toLowerCase();
    if (!username)
      throw new Error("Bootstrap administrator username is required");
    if (
      !(await c.query("SELECT id FROM users WHERE is_super_admin")).rows.length
    ) {
      const password = env.SUPER_ADMIN_PASSWORD || env.ADMIN_PASSWORD;
      if (!password)
        throw new Error(
          "SUPER_ADMIN_PASSWORD is required for initial administrator bootstrap",
        );
      const id = randomUUID();
      await c.query(
        "INSERT INTO users(id,username,display_name,password_hash,is_super_admin) VALUES($1,$2,$3,$4,true)",
        [
          id,
          username,
          value("identity", "bootstrap_admin_display_name", env),
          await passwordHash(password, env),
        ],
      );
      await c.query(
        "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
        [workspace.id, id],
      );
    }
    await c.query("COMMIT");
    return workspace.id;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
export function identityStore(db, env = process.env) {
  const ttl = number("security", "session_ttl_seconds", env),
    idle = number("identity", "session_idle_seconds", env);
  async function audit(
    actor,
    action,
    details = {},
    workspaceId = actor?.workspace_id,
  ) {
    await db.query(
      "INSERT INTO identity_audit(actor_id,workspace_id,action,details) VALUES($1,$2,$3,$4)",
      [actor?.id || null, workspaceId || null, action, JSON.stringify(details)],
    );
  }
  async function session(
    userId,
    method = "local",
    expectedVersion,
    workspaceId,
  ) {
    const w = (
      await db.query(
        "SELECT w.id FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 AND ($2::uuid IS NULL OR w.id=$2) ORDER BY w.is_default DESC,w.created_at LIMIT 1",
        [userId, workspaceId || null],
      )
    ).rows[0];
    const user = (
      await db.query(
        "SELECT auth_version FROM users WHERE id=$1 AND NOT disabled",
        [userId],
      )
    ).rows[0];
    if (!user) throw fail("Account access has been disabled", 401);
    const version = expectedVersion ?? user.auth_version;
    const token = randomBytes(32).toString("base64url");
    await db.query(
      "DELETE FROM auth_sessions WHERE expires_at<now() OR (user_id=$1 AND last_seen < now()-($2::int*interval '1 second'))",
      [userId, idle],
    );
    const inserted = await db.query(
      "INSERT INTO auth_sessions(token_hash,user_id,workspace_id,method,expires_at,auth_version) SELECT $1,id,$3,$4,now()+($5::int*interval '1 second'),auth_version FROM users WHERE id=$2 AND NOT disabled AND auth_version=$6 RETURNING token_hash",
      [digest(token), userId, w.id, method, ttl, version],
    );
    if (!inserted.rows.length)
      throw fail("Your credentials changed. Sign in again.", 401);
    await db.query(
      "DELETE FROM auth_sessions WHERE user_id=$1 AND token_hash IN (SELECT token_hash FROM auth_sessions WHERE user_id=$1 ORDER BY created_at DESC OFFSET $2)",
      [userId, number("identity", "session_max_active", env)],
    );
    return { token, ...(await resolve(token)) };
  }
  async function resolve(token) {
    if (typeof token !== "string" || token.length > 128)
      throw fail("Sign in to your workspace", 401);
    const r = await db.query(
      `SELECT u.id,u.username,u.display_name,u.is_super_admin,u.must_change_password,u.password_hash IS NOT NULL AS local_account,s.workspace_id,s.method,m.role,w.name AS workspace_name FROM auth_sessions s JOIN users u ON u.id=s.user_id AND u.auth_version=s.auth_version JOIN workspace_members m ON m.user_id=u.id AND m.workspace_id=s.workspace_id JOIN workspaces w ON w.id=s.workspace_id WHERE s.token_hash=$1 AND s.expires_at>now() AND s.last_seen>now()-($2::int*interval '1 second') AND NOT u.disabled`,
      [digest(token), idle],
    );
    if (!r.rows[0]) throw fail("Sign in to your workspace", 401);
    await db.query(
      "UPDATE auth_sessions SET last_seen=now() WHERE token_hash=$1",
      [digest(token)],
    );
    const u = r.rows[0];
    const workspaces = (
      await db.query(
        "SELECT w.id,w.name,w.is_default,m.role FROM workspaces w JOIN workspace_members m ON m.workspace_id=w.id WHERE m.user_id=$1 ORDER BY w.is_default DESC,w.name",
        [u.id],
      )
    ).rows;
    return {
      authenticated: true,
      permissions: capabilities(u.role),
      user: {
        id: u.id,
        username: u.username,
        displayName: u.display_name,
        isSuperAdmin: u.is_super_admin,
        localAccount: u.local_account,
        mustChangePassword: u.must_change_password,
      },
      workspace: { id: u.workspace_id, name: u.workspace_name, role: u.role },
      workspaces,
      method: u.method,
    };
  }
  async function login(username, password) {
    const u = (
      await db.query("SELECT * FROM users WHERE username=$1", [
        String(username || "")
          .trim()
          .toLowerCase(),
      ])
    ).rows[0];
    // A real Argon2 verification is performed for unknown usernames as well.
    const valid = await verify(
      u?.password_hash || (await dummyHash),
      String(password || ""),
    );
    if (
      !u ||
      !valid ||
      u.disabled ||
      !u.password_hash ||
      (u.locked_until && new Date(u.locked_until) > new Date())
    ) {
      if (u)
        await db.query(
          `UPDATE users SET failed_logins=failed_logins+1,locked_until=CASE WHEN failed_logins+1 >= $2 THEN now()+($3::int*interval '1 second') ELSE locked_until END WHERE id=$1`,
          [
            u.id,
            number("identity", "login_lock_attempts", env),
            number("identity", "login_lock_seconds", env),
          ],
        );
      await audit(null, "login.failed", {});
      throw fail(
        "Invalid username or password. Try again later if your account is locked.",
        401,
      );
    }
    await db.query(
      "UPDATE users SET failed_logins=0,locked_until=NULL WHERE id=$1",
      [u.id],
    );
    await audit(u, "login.succeeded");
    return session(u.id, "local", u.auth_version);
  }
  const dummyHash = hash(randomBytes(32).toString("hex"), {
    algorithm: 2,
    memoryCost: number("identity", "argon_memory_kib", env),
    timeCost: number("identity", "argon_time_cost", env),
    parallelism: number("identity", "argon_parallelism", env),
  });
  return {
    session,
    resolve,
    login,
    audit,
    async logout(token) {
      await db.query("DELETE FROM auth_sessions WHERE token_hash=$1", [
        digest(token),
      ]);
    },
    async switchWorkspace(token, id) {
      const s = await resolve(token);
      if (!s.workspaces.some((w) => w.id === id))
        throw fail("Workspace access denied", 403);
      await db.query(
        "UPDATE auth_sessions SET workspace_id=$2 WHERE token_hash=$1",
        [digest(token), id],
      );
      return resolve(token);
    },
    async changePassword(token, current, password) {
      const s = await resolve(token);
      const u = (await db.query("SELECT * FROM users WHERE id=$1", [s.user.id]))
        .rows[0];
      if (!u.password_hash)
        throw fail("Your password is managed by your SSO provider", 403);
      if (!(await verify(u.password_hash, String(current || ""))))
        throw fail("Current password is incorrect", 400);
      if (await verify(u.password_hash, String(password || "")))
        throw fail("Choose a different password");
      const encoded = await passwordHash(password, env);
      const c = await db.connect();
      try {
        await c.query("BEGIN");
        const updated = await c.query(
          "UPDATE users SET password_hash=$2,must_change_password=false,auth_version=auth_version+1 WHERE id=$1 AND auth_version=$3 RETURNING auth_version",
          [u.id, encoded, u.auth_version],
        );
        if (!updated.rowCount)
          throw fail("Your credentials changed. Sign in again.", 401);
        await c.query("DELETE FROM auth_sessions WHERE user_id=$1", [u.id]);
        await c.query("COMMIT");
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
      await audit(u, "password.changed");
      return session(u.id, "local", u.auth_version + 1, s.workspace.id);
    },
  };
}

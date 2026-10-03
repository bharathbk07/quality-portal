import * as repository from "../database/repositories/identity.mjs";
import { capabilities } from "./permissions.mjs";
import { randomUUID } from "node:crypto";
import { identityStore, passwordHash, roles, fail } from "./store.mjs";
import { number } from "../shared/config.mjs";
export function permission(session, path, method) {
  const role = session.workspace.role;
  const access = capabilities(role);
  if (
    session.user.mustChangePassword &&
    !["/auth/session", "/auth/password", "/auth/logout"].includes(path)
  )
    throw fail("Change your temporary password before continuing", 403);
  if (
    path.startsWith("/identity/") ||
    (path.startsWith("/settings") && path !== "/settings/runtime")
  ) {
    if (!access.canManage)
      throw fail("Workspace administrator access required", 403);
  }
  if (method === "DELETE" && path.startsWith("/maps/") && !access.canManage)
    throw fail("Workspace administrator access required to delete map projects",403);
  if (path.startsWith("/auth/sso/config") && !session.user.isSuperAdmin)
    throw fail("Platform administrator access required", 403);
  if (path.startsWith("/assistant/cursor/") && !access.canUseAgents)
    throw fail("Developer or administrator access required", 403);
  if (
    !["GET", "HEAD"].includes(method) &&
    !access.canWrite &&
    !path.startsWith("/auth/")
  )
    throw fail("Your workspace role is read-only", 403);
}
export function registerIdentity(app, db, env) {
  const store = identityStore(db, env);
  app.decorateRequest("identity", null);
  app.decorateRequest("workspaceId", null);
  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (
      path.startsWith("/health/") ||
      path === "/metrics" ||
      [
        "/auth/login",
        "/auth/methods",
        "/auth/sso/start",
        "/auth/sso/callback",
      ].includes(path)
    )
      return;
    if (path === "/settings/runtime") {
      const id = req.headers["x-workspace-id"];
      if (
        !id ||
        !/^[\da-f-]{36}$/i.test(id) ||
        !(await repository.selectWorkspaces(db, [id])).rows
          .length
      )
        return reply.code(403).send({ error: "Workspace context is required" });
      req.workspaceId = id;
      return;
    }
    const s = await store.resolve(req.headers["x-session-token"]);
    permission(s, path, req.method);
    req.identity = s;
    req.workspaceId = s.workspace.id;
  });
  const token = (req) => req.headers["x-session-token"];
  app.post(
    "/auth/login",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["username", "password"],
          properties: {
            username: {
              type: "string",
              minLength: 1,
              maxLength: number("identity", "name_max_chars", env),
            },
            password: {
              type: "string",
              minLength: 1,
              maxLength: number("validation", "password_max_chars", env),
            },
          },
        },
      },
    },
    (req) => store.login(req.body.username, req.body.password),
  );
  app.get("/auth/session", (req) => req.identity);
  app.post("/auth/logout", async (req) => {
    await store.logout(token(req));
    return { authenticated: false };
  });
  app.post(
    "/auth/workspace",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
      },
    },
    (req) => store.switchWorkspace(token(req), req.body.id),
  );
  app.post(
    "/auth/password",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["currentPassword", "password"],
          properties: {
            currentPassword: {
              type: "string",
              maxLength: number("validation", "password_max_chars", env),
            },
            password: {
              type: "string",
              maxLength: number("validation", "password_max_chars", env),
            },
          },
        },
      },
    },
    (req) =>
      store.changePassword(
        token(req),
        req.body.currentPassword,
        req.body.password,
      ),
  );
  const actor = (req) => ({
    id: req.identity.user.id,
    workspace_id: req.workspaceId,
  });
  const name = {
    type: "string",
    minLength: 1,
    maxLength: number("identity", "name_max_chars", env),
  };
  app.get("/identity/workspaces", async (req) => ({
    workspaces: req.identity.workspaces,
  }));
  app.post(
    "/identity/workspaces",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["name"],
          properties: { name },
        },
      },
    },
    async (req) => {
      if (!req.body.name.trim()) throw fail("Workspace name is required");
      const id = randomUUID();
      const c = await db.connect();
      try {
        await repository.beginTransaction(c);
        await repository.insertWorkspaces(c, [
          id,
          req.body.name.trim(),
        ]);
        await repository.insertWorkspaceMembers(c, [id, req.identity.user.id]);
        await repository.commitTransaction(c);
      } catch (e) {
        await repository.rollbackTransaction(c);
        throw e;
      } finally {
        c.release();
      }
      await store.audit(actor(req), "workspace.created", {
        id,
        name: req.body.name,
      });
      return { id, name: req.body.name };
    },
  );
  app.get("/identity/members", async (req) => ({
    members: (
      await repository.selectUsers(db, [req.workspaceId, number("identity", "identity_list_limit", env)])
    ).rows,
  }));
  app.post(
    "/identity/lookup",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["username"],
          properties: {
            username: {
              type: "string",
              minLength: 1,
              maxLength: number("identity", "name_max_chars", env),
            },
          },
        },
      },
    },
    async (req) => {
      const u = (
        await repository.selectUsers2(db, [req.body.username.trim().toLowerCase()])
      ).rows[0];
      if (!u) throw fail("Active user not found", 404);
      return u;
    },
  );
  app.get("/identity/users", async (req) => {
    if (!req.identity.user.isSuperAdmin)
      throw fail("Platform administrator access required", 403);
    return {
      users: (
        await repository.selectUsers3(db, [number("identity", "identity_list_limit", env)])
      ).rows,
    };
  });
  app.post(
    "/identity/users",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["username", "displayName", "password"],
          properties: {
            username: { ...name, pattern: "^[A-Za-z0-9][A-Za-z0-9._@-]*$" },
            displayName: name,
            password: {
              type: "string",
              maxLength: number("validation", "password_max_chars", env),
            },
            role: { type: "string", enum: roles },
          },
        },
      },
    },
    async (req) => {
      if (!req.body.displayName.trim()) throw fail("Display name is required");
      const id = randomUUID(),
        encoded = await passwordHash(req.body.password, env),
        c = await db.connect();
      try {
        await repository.beginTransaction(c);
        await repository.insertUsers(c, [
            id,
            req.body.username.toLowerCase(),
            req.body.displayName.trim(),
            encoded,
          ]);
        await repository.insertWorkspaceMembers2(c, [id]);
        await repository.insertWorkspaceMembers3(c, [req.workspaceId, id, req.body.role || "viewer"]);
        await repository.commitTransaction(c);
      } catch (e) {
        await repository.rollbackTransaction(c);
        if (e.code === "23505")
          throw fail("Username is already registered", 409);
        throw e;
      } finally {
        c.release();
      }
      await store.audit(actor(req), "user.created", {
        userId: id,
        role: req.body.role || "viewer",
      });
      return { id };
    },
  );
  app.put(
    "/identity/members/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["role"],
          additionalProperties: false,
          properties: { role: { type: "string", enum: roles } },
        },
      },
    },
    async (req) => {
      const c = await db.connect();
      try {
        await repository.beginTransaction(c);
        await repository.selectWorkspaces2(c, [
          req.workspaceId,
        ]);
        const target = (
          await repository.selectUsers4(c, [req.params.id])
        ).rows[0];
        if (!target) throw fail("Active user not found", 404);
        if (target.is_super_admin && !req.identity.user.isSuperAdmin)
          throw fail("Platform administrator membership is protected", 403);
        const m = (
          await repository.selectWorkspaceMembers(c, [req.workspaceId])
        ).rows;
        if (
          m.find((x) => x.user_id === req.params.id)?.role === "admin" &&
          req.body.role !== "admin" &&
          m.filter((x) => x.role === "admin" && !x.disabled).length <= 1
        )
          throw fail("Keep at least one workspace administrator", 409);
        await repository.insertWorkspaceMembers3(c, [req.workspaceId, req.params.id, req.body.role]);
        await repository.commitTransaction(c);
      } catch (e) {
        await repository.rollbackTransaction(c);
        throw e;
      } finally {
        c.release();
      }
      await store.audit(actor(req), "membership.changed", {
        userId: req.params.id,
        role: req.body.role,
      });
      return { saved: true };
    },
  );
  app.delete("/identity/members/:id", async (req) => {
    if (!/^[\da-f-]{36}$/i.test(req.params.id)) throw fail("Invalid user ID");
    const c = await db.connect();
    try {
      await repository.beginTransaction(c);
      const w = (
        await repository.selectWorkspaces3(c, [req.workspaceId])
      ).rows[0];
      if (w.is_default)
        throw fail(
          "Default workspace membership cannot be removed. Set viewer access instead.",
          409,
        );
      const m = (
        await repository.selectWorkspaceMembers2(c, [req.workspaceId, req.params.id])
      ).rows[0];
      if (m?.is_super_admin && !req.identity.user.isSuperAdmin)
        throw fail("Platform administrator membership is protected", 403);
      if (
        m?.role === "admin" &&
        (
          await repository.selectWorkspaceMembers3(c, [req.workspaceId])
        ).rows[0].count <= 1
      )
        throw fail("Keep at least one workspace administrator", 409);
      await repository.deleteWorkspaceMembers(c, [req.workspaceId, req.params.id]);
      await repository.deleteAuthSessions(c, [req.workspaceId, req.params.id]);
      await repository.commitTransaction(c);
    } catch (e) {
      await repository.rollbackTransaction(c);
      throw e;
    } finally {
      c.release();
    }
    await store.audit(actor(req), "membership.removed", {
      userId: req.params.id,
    });
    return { deleted: true };
  });
  app.put(
    "/identity/users/:id",
    {
      schema: {
        params: {
          type: "object",
          required: ["id"],
          properties: { id: { type: "string", format: "uuid" } },
        },
        body: {
          type: "object",
          required: ["disabled"],
          additionalProperties: false,
          properties: { disabled: { type: "boolean" } },
        },
      },
    },
    async (req) => {
      if (!req.identity.user.isSuperAdmin)
        throw fail("Platform administrator access required", 403);
      const c = await db.connect();
      try {
        await repository.beginTransaction(c);
        await repository.selectWorkspaces4(c, [req.params.id]);
        const u = (
          await repository.selectUsers5(c, [
            req.params.id,
          ])
        ).rows[0];
        if (!u) throw fail("User not found", 404);
        if (u.is_super_admin)
          throw fail("Bootstrap administrator cannot be disabled", 409);
        if (req.body.disabled) {
          const orphan = (
            await repository.selectWorkspaceMembers4(c, [req.params.id])
          ).rows;
          if (orphan.length)
            throw fail(
              "Assign another active administrator to this user’s workspaces first",
              409,
            );
        }
        await repository.updateUsers(c, [req.params.id, req.body.disabled]);
        await repository.deleteAuthSessions2(c, [
          req.params.id,
        ]);
        await repository.commitTransaction(c);
      } catch (e) {
        await repository.rollbackTransaction(c);
        throw e;
      } finally {
        c.release();
      }
      await store.audit(actor(req), "user.status.changed", {
        userId: req.params.id,
        disabled: req.body.disabled,
      });
      return { saved: true };
    },
  );
  app.get("/identity/audit", async (req) => ({
    events: (
      await repository.selectIdentityAudit(db, [
          req.workspaceId,
          number("identity", "identity_list_limit", env),
          req.identity.user.isSuperAdmin,
        ])
    ).rows,
  }));
  return store;
}

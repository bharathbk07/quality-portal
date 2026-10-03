import { apiJson, jsonBody, rememberSession } from "@/shared/api/client";
import type { Session } from "../session";
export const authApi = {
  async session(signal?: AbortSignal): Promise<Session> {
    const session = await apiJson<Session>("/api/session", { signal });
    rememberSession(session);
    return session;
  },
  methods: (signal?: AbortSignal) =>
    apiJson<{ sso: { enabled: boolean; label: string } }>("/api/auth/methods", {
      signal,
    }),
  async login(username: string, password: string): Promise<Session> {
    const session = await apiJson<Session>("/api/session", {
      method: "POST",
      ...jsonBody({ username, password }),
    });
    rememberSession(session);
    return session;
  },
  switchWorkspace: (id: string) =>
    apiJson("/api/auth/workspace", { method: "POST", ...jsonBody({ id }) }),
  logout: () => apiJson("/api/session", { method: "DELETE" }),
};

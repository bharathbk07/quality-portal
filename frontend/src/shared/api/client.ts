import type { Session } from "@/features/auth/session";
let csrfToken = "";
let timeoutMs: number | undefined;
let pendingSession: Promise<void> | undefined;
let onSessionExpired: (() => void) | undefined;
export function configureApi(timeout: number, expired?: () => void) {
  timeoutMs = timeout;
  onSessionExpired = expired;
}
function sessionExpired() {
  csrfToken = "";
  onSessionExpired?.();
}
export function rememberSession(session: Session) {
  csrfToken = session.csrfToken;
}
export class ApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}
export async function apiFetch(input: string, init: RequestInit = {}) {
  if (!input.startsWith("/api/"))
    throw new Error("Only portal API paths are allowed");
  const signInAttempt =
    input === "/api/session" && init.method?.toUpperCase() === "POST";
  const timeout = timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined;
  const signal =
    init.signal && timeout
      ? AbortSignal.any([init.signal, timeout])
      : init.signal || timeout;
  const headers = new Headers(init.headers);
  if (
    init.method &&
    !["GET", "HEAD"].includes(init.method.toUpperCase()) &&
    !signInAttempt
  ) {
    if (!csrfToken) {
      pendingSession ||= fetch("/api/session", {
        cache: "no-store",
        credentials: "same-origin",
        signal,
      })
        .then(async (r) => {
          if (r.status === 401) sessionExpired();
          if (!r.ok) throw new ApiError("Sign in to continue", r.status);
          rememberSession(await r.json());
        })
        .finally(() => {
          pendingSession = undefined;
        });
      await pendingSession;
    }
    headers.set("x-csrf-token", csrfToken);
  }
  const response = await fetch(input, {
    ...init,
    signal,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (response.status === 401 && !signInAttempt) sessionExpired();
  return response;
}
export async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await apiFetch(path, init);
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(
      typeof data.error === "string" ? data.error : "Request failed",
      response.status,
    );
  return data as T;
}
export function jsonBody(body: unknown): RequestInit {
  return {
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

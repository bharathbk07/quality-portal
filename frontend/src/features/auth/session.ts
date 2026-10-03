export type Session = {
  authenticated: true;
  permissions: { canWrite: boolean; canManage: boolean; canUseAgents: boolean };
  csrfToken: string;
  user: {
    id: string;
    username: string;
    displayName: string;
    isSuperAdmin: boolean;
    localAccount: boolean;
    mustChangePassword: boolean;
  };
  workspace: {
    id: string;
    name: string;
    role: "admin" | "viewer" | "developer" | "tester";
  };
  workspaces: { id: string; name: string; role: string; is_default: boolean }[];
  method: string;
};
export { apiFetch, rememberSession } from "@/shared/api/client";

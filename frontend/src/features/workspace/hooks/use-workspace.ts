"use client";
import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/shared/api/client";
import { authApi } from "@/features/auth/services/auth-api";
import { workspaceApi, type ImportedContract } from "../services/workspace-api";
import type { AIStatus } from "@/features/connections/ai-connections";
export type Plan = {
  id?: string;
  name: string;
  discipline: number;
  artifact: string;
  created: string;
};
export function useWorkspace() {
  const client = useQueryClient();
  const identity = useQuery({
    queryKey: ["identity"],
    queryFn: async ({ signal }) => {
      const [session, config] = await Promise.all([
        authApi.session(signal),
        workspaceApi.config(signal),
      ]);
      return { session, config };
    },
  });
  const session = identity.data?.session ?? null;
  const scope = session?.workspace.id;
  const enabled = !!session && !session.user.mustChangePassword;
  const workspace = useQuery({
    queryKey: ["workspace", scope],
    enabled,
    queryFn: ({ signal }) => workspaceApi.read(signal),
  });
  const [imported, setImported] = useState<ImportedContract | null>(null);
  const [selection, updateSelection] = useState<string[] | undefined>();
  const [importOpen, setImportOpen] = useState(false);
  const first = workspace.data?.contracts[0];
  const contract = imported?.contract ?? first?.document ?? null;
  const contractId = imported?.id ?? first?.id;
  const selected =
    selection ?? imported?.defaultSelection ?? first?.defaultSelection ?? [];
  function setSelected(value: string[] | ((old: string[]) => string[])) {
    updateSelection((old) =>
      typeof value === "function" ? value(old ?? selected) : value,
    );
  }
  const plans = workspace.data?.plans ?? [];
  useEffect(() => {
    if (identity.error instanceof ApiError && identity.error.status === 401)
      window.location.replace("/login");
    if (
      session?.user.mustChangePassword &&
      window.location.pathname !== "/account"
    )
      window.location.replace("/account");
  }, [identity.error, session?.user.mustChangePassword]);
  async function sync() {
    await identity.refetch();
    await client.invalidateQueries({ queryKey: ["workspace", scope] });
  }
  async function loadSpec(spec: string) {
    const data = await workspaceApi.importContract(spec);
    setImported(data);
    updateSelection(undefined);
    await client.invalidateQueries({ queryKey: ["workspace", scope] });
    return data.contract;
  }
  async function savePlan(plan: Pick<Plan, "discipline" | "artifact">) {
    await workspaceApi.savePlan({
      ...plan,
      ...(contractId ? { contractId } : {}),
    });
    await client.invalidateQueries({ queryKey: ["workspace", scope] });
  }
  async function removePlan(index: number) {
    const plan = plans[index];
    if (plan?.id) await workspaceApi.removePlan(plan.id);
    await client.invalidateQueries({ queryKey: ["workspace", scope] });
  }
  return {
    toolkits: workspace.data?.toolkits ?? [],
    exampleSpec: workspace.data?.exampleSpec ?? "",
    contractId,
    session,
    ready: !identity.isPending && (!enabled || !workspace.isPending),
    canEdit: session?.permissions.canWrite === true,
    isAdmin: session?.permissions.canManage === true,
    config: identity.data?.config ?? null,
    contract,
    selected,
    setSelected,
    plans,
    importOpen,
    setImportOpen,
    ai: workspace.data?.ai ?? ({ configured: false, model: null } as AIStatus),
    loadSpec,
    authenticated: !!session,
    sync,
    savePlan,
    removePlan,
    serviceError: identity.error?.message || workspace.error?.message || "",
  };
}
export type Workspace = ReturnType<typeof useWorkspace>;

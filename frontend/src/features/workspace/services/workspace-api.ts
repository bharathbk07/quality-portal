import { apiJson, ApiError, jsonBody } from "@/shared/api/client";
import type { AIStatus } from "@/features/connections/ai-connections";
import type { Contract, RuntimeConfig, Toolkit } from "../types";
import type { Plan } from "../hooks/use-workspace";
export type ImportedContract = {
  id: string;
  contract: Contract;
  defaultSelection: string[];
};
export type StoredContract = {
  id: string;
  document: Contract;
  defaultSelection: string[];
};
export const workspaceApi = {
  config: (signal?: AbortSignal) =>
    apiJson<RuntimeConfig>("/api/config", { signal }),
  async read(signal?: AbortSignal) {
    const [ai, plans, contracts, toolkit] = await Promise.all([
      apiJson<AIStatus>("/api/assistant", { signal }).catch((error) => {
        if (error instanceof ApiError && error.status >= 500)
          return { configured: false, model: null } as AIStatus;
        throw error;
      }),
      apiJson<{ plans: Plan[] }>("/api/plans", { signal }),
      apiJson<{ contracts: StoredContract[] }>("/api/contracts", { signal }),
      apiJson<{ toolkits: Toolkit[]; exampleSpec: string }>("/api/toolkits", {
        signal,
      }),
    ]);
    return {
      ai,
      plans: plans.plans,
      contracts: contracts.contracts,
      ...toolkit,
    };
  },
  importContract: (spec: string) =>
    apiJson<ImportedContract>("/api/contracts", {
      method: "POST",
      ...jsonBody({ spec }),
    }),
  savePlan: (
    body: Pick<Plan, "discipline" | "artifact"> & { contractId?: string },
  ) => apiJson<Plan>("/api/plans", { method: "POST", ...jsonBody(body) }),
  removePlan: (id: string) => apiJson("/api/plans/" + id, { method: "DELETE" }),
};

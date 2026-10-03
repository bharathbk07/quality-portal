import { apiJson, jsonBody } from "@/shared/api/client";
import type {
  Studio,
  Options,
  Impact,
  Revision,
  WithAi,
  Scenario,
  ScenarioResult,
  CostInput,
  CostResult,
} from "./studio-types";
const post = <T>(url: string, body: unknown) =>
  apiJson<T>(url, { method: "POST", ...jsonBody(body) });
export const studioApi = {
  grouping: (id: string) =>
    post<{
      summary: string;
      groups: { name: string; nodeIds: string[] }[];
      annotations: Record<string, { group: string }>;
      classification: string;
      model: string;
    }>(`/api/maps/${id}/grouping`, {}),
  export: (id: string, options: Options) =>
    apiJson<{ svg: string }>(
      `/api/maps/${id}/export?${new URLSearchParams(Object.entries(options).map(([k, v]) => [k, String(v)]))}`,
    ),
  compare: (id: string, from: number, to: number) =>
    apiJson<{
      from: string;
      to: string;
      changes: {
        nodeId: string;
        label: string;
        field: string;
        before: unknown;
        after: unknown;
      }[];
      layoutChanged: boolean;
      scenario: { before: Scenario | null; after: Scenario | null };
      basis: string;
    }>(
      `/api/maps/${id}/compare?${new URLSearchParams({ from: String(from), to: String(to) })}`,
    ),
  load: (id: string, options: Options, signal?: AbortSignal) =>
    apiJson<Studio>(
      `/api/maps/${id}/studio?${new URLSearchParams(Object.entries(options).map(([k, v]) => [k, String(v)]))}`,
      { signal },
    ),
  impact: (id: string, nodeId: string, signal?: AbortSignal) =>
    apiJson<Impact>(
      `/api/maps/${id}/impact?${new URLSearchParams({ nodeId })}`,
      { signal },
    ),
  save: (
    id: string,
    body: Omit<Revision, "id" | "version" | "createdAt"> & {
      expectedVersion: number;
    },
  ) => post<{ version: number }>(`/api/maps/${id}/revisions`, body),
  simulate: (id: string, scenario: Scenario, useAi: boolean) =>
    post<WithAi<ScenarioResult>>(`/api/maps/${id}/simulate`, {
      scenario,
      useAi,
    }),
  ask: (id: string, question: string, useAi: boolean, revision: number) =>
    post<
      WithAi<{ answer: string; citations: { path: string; line: number }[] }>
    >(`/api/maps/${id}/knowledge`, { question, useAi, revision }),
  document: (id: string, type: string, useAi: boolean, revision: number) =>
    post<WithAi<{ format: string; content: string; warning?: string }>>(
      `/api/maps/${id}/documentation`,
      { type, useAi, revision },
    ),
  audit: (id: string, useAi: boolean) =>
    post<WithAi<Studio["audit"]>>(`/api/maps/${id}/audit`, { useAi }),
  cost: (id: string, input: CostInput) =>
    post<WithAi<CostResult>>(`/api/maps/${id}/cost`, input),
};

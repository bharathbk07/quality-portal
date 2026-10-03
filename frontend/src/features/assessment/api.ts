import { apiJson, jsonBody } from "@/shared/api/client";
import type { AssessmentCatalog, AssessmentResult } from "./types";
export const assessmentApi = {
  catalog: (signal?: AbortSignal) =>
    apiJson<AssessmentCatalog>("/api/assessments/catalog", { signal }),
  list: (signal?: AbortSignal) =>
    apiJson<{
      reports: { id: string; name: string; kind: string; created_at: string }[];
    }>("/api/assessments", { signal }),
  read: (id: string) => apiJson<AssessmentResult>("/api/assessments/" + id),
  create: (input: {
    name: string;
    kind: string;
    intake: Record<string, string>;
    useAI: boolean;
    contractId?: string;
    mapId?: string;
  }) =>
    apiJson<AssessmentResult>("/api/assessments", {
      method: "POST",
      ...jsonBody(input),
    }),
};

// Public API DTOs only. No parsing, authorization, persistence or secrets belong here.
export type Endpoint = {
  method: string;
  path: string;
  summary: string;
  required: string[];
};
export type Contract = {
  title: string;
  version: string;
  server: string;
  endpoints: Endpoint[];
  warnings: string[];
};
export type RuntimeConfig = {
  default_p95_ms: number;
  default_virtual_users: number;
  max_virtual_users: number;
  max_p95_ms: number;
  test_duration: string;
  error_rate_budget: number;
  iteration_pause_seconds: number;
  contract_max_bytes: number;
  evidence_max_bytes: number;
  max_operations: number;
  ai_prompt_max_chars: number;
  ai_context_max_chars: number;
};
export type Toolkit = {
  name: string;
  tools: string;
  slug: string;
  docs: string;
  goal: string;
  steps: string[];
  artifact: string;
  command: string;
};
export type Evidence = { tool: string; facts: string[][]; summary: string };

export type AssessmentReport = {
  id: string;
  name: string;
  kind: string;
  stage: string;
  source: string;
  createdAt: string;
  readiness: { supplied: number; total: number; missing: number };
  findings: {
    id: string;
    title: string;
    classification: string;
    evidence: string;
    recommendation: string;
    priority: string;
    verification: string;
  }[];
  investigations: {
    id: string;
    title: string;
    question: string;
    tools: string;
    requiredEvidence: string;
    suggestion: string;
  }[];
  limitations: string[];
  ai: null | { content: string; provider: string; model: string };
};
export type AssessmentResult = {
  report: AssessmentReport;
  markdown: string;
  aiError?: string | null;
};
export type AssessmentCatalog = {
  reportKinds: { id: string; label: string; description: string }[];
  inputs: { key: string; label: string; help: string; applies: string[] }[];
  inputMaxChars: number;
  nameMaxChars: number;
};

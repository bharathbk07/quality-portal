import type { Node, Edge } from "@xyflow/react";
export type Evidence = { path: string; line: number; detail?: string };
export type Annotation = {
  owner?: string;
  notes?: string;
  warning?: string;
  group?: string;
  groupDescription?: string;
  color?: string;
  icon?: string;
  documentation?: string[];
};
export type Container = {
  name: string;
  image: string;
  ports: { port: number; protocol: string }[];
  requests: Record<string, string>;
  limits: Record<string, string>;
  healthChecks: {
    type: string;
    path: string;
    port: string | number | null;
    mechanism: string;
  }[];
  security: Record<string, boolean | null>;
};
export type Deployment = {
  platform: string;
  kind?: string;
  namespace?: string;
  environment: string;
  replicas: number | null;
  containers?: Container[];
  image?: string;
  buildContext?: string;
  healthCheck?: boolean;
  evidence: Evidence;
};
export type Component = {
  id: string;
  label: string;
  kind: string;
  evidence: Evidence[];
  databaseNames?: string[];
  databaseAccess?: {
    id: string;
    query: string;
    databaseIds: string[];
    candidateDatabaseIds: string[];
    objects: {
      database: string | null;
      schema: string | null;
      table: string;
    }[];
    evidence: Evidence;
    classification: string;
    roundTrips: number | null;
    latencyMs: number | null;
  }[];
  databaseObjects?: {
    database: string | null;
    schema: string | null;
    table: string;
    consumers: string[];
    consumerNames: string[];
  }[];
  databaseTimeouts?: {
    name: string;
    value: number;
    unit: string;
    evidence: Evidence;
  }[];
  metadata?: {
    primaryLanguage: string;
    languages: { name: string; fileCount: number }[];
    runtimes: { name: string; evidence: Evidence }[];
    sourceRoots: string[];
    caching: {
      name: string;
      mechanism: string;
      certainty: string;
      evidence: Evidence;
    }[];
    deployments: Deployment[];
    serviceEndpoints?: {
      name: string;
      type: string;
      namespace: string;
      ports: { port: number; targetPort: number | string; protocol: string }[];
      evidence: Evidence;
    }[];
    ports: { port: number; protocol: string }[];
    healthChecks: {
      type: string;
      path: string;
      port: number | string | null;
      mechanism: string;
    }[];
    runtimeFlags: string[];
    owner: string;
  };
};
export type NodeData = {
  description?: string;
  label: string;
  kind?: string;
  subtitle?: string;
  members?: string[];
  color?: string;
  icon?: string;
  hasCache?: boolean;
  hasWarning?: boolean;
  owner?: string;
};
export type CanvasNode = Node<NodeData>;
export type CanvasEdge = Edge<{ confidence: string; evidence: Evidence[] }>;
export type Impact = {
  nodeId: string;
  upstream: { id: string; label: string; kind: string }[];
  downstream: { id: string; label: string; kind: string }[];
  basis: string;
};
export type Finding = {
  nodeId: string;
  code: string;
  severity: string;
  title: string;
  detail: string;
  evidence: Evidence[];
  classification: string;
};
export type Scenario = {
  type: "outage" | "traffic" | "replace";
  nodeId: string;
  multiplier?: number;
  replacement?: string;
};
export type ScenarioResult = {
  title: string;
  type: string;
  nodeId: string;
  impact: Impact;
  findings: string[];
  assumptions: string[];
  requiredEvidence: string[];
  classification: string;
};
export type MapAction = {
  type: "impact" | "outage" | "audit" | "readme" | "runbook";
  nodeId?: string;
};
export type Ai = {
  actions?: MapAction[];
  text: string;
  model: string;
  traceId?: string | null;
  requestId?: string;
  citations: { nodeId: string; path: string; line: number }[];
  classification: string;
};
export type WithAi<T> = {
  result: T;
  ai?: Ai;
  aiTrace?: { traceId: string | null; requestId: string; model: string };
  aiError?: string;
};
export type Options = {
  view: "high-level" | "logical" | "deployment";
  groupBy:
    | "none"
    | "function"
    | "language"
    | "team"
    | "environment"
    | "namespace"
    | "custom";
  layout: "hierarchical" | "tree" | "swimlanes";
  search: string;
  environment: string;
  revision: number;
};
export type Revision = {
  id: string;
  version: number;
  label: string;
  kind: "current" | "proposed";
  createdAt: string;
  annotations: Record<string, Annotation>;
  positions: Record<string, { x: number; y: number }>;
  view: Options["view"];
  groupBy: Options["groupBy"];
  layout: Options["layout"];
  scenario?: Scenario;
};
export type Studio = {
  mapId: string;
  metadataAvailable: boolean;
  projection: {
    view: string;
    groupBy: string;
    layout: string;
    environments: string[];
    nodes: CanvasNode[];
    edges: CanvasEdge[];
    visibleComponents: number;
    totalComponents: number;
    limits: string;
  };
  components: Component[];
  pipelines: { system: string; path: string; evidence: Evidence }[];
  infrastructure: {
    type: string;
    name: string;
    provider: string;
    evidence: Evidence;
  }[];
  audit: {
    findings: Finding[];
    frameworks: { name: string; scope: string }[];
    limits: string[];
  };
  annotations: Record<string, Annotation>;
  revision: Revision | null;
  latestVersion: number;
  revisions: Revision[];
  limits: {
    textMaxChars: number;
    questionMaxChars: number;
    maxMultiplier: number;
    maxHours: number;
  };
  sharePath: string;
};
export type CostInput = {
  currency: string;
  hours: number;
  items: {
    nodeId: string;
    replicas?: number;
    cpuHour?: number;
    memoryGiBHour?: number;
    flatHour?: number;
    storageGiBMonth?: number;
    storageGiB?: number;
  }[];
};
export type CostResult = {
  currency: string;
  hours: number;
  rows: {
    nodeId: string;
    label: string;
    environment: string;
    replicas: number | null;
    cpuCores: number | null;
    memoryGiB: number | null;
    monthly: number | null;
    missing: string[];
  }[];
  total: number | null;
  pricedSubtotal: number;
  coverage: { priced: number; submitted: number; mapComponents: number };
  assumptions: string[];
};

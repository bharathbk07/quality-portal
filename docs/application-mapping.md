# Evidence-based application maps

Repository imports inspect files without executing application code. Maps pin the Git commit so evidence can be checked against the same revision. AI is optional and never replaces the static map.

## Kubernetes discovery

The analyzer reads multi-document YAML, Deployment/StatefulSet/DaemonSet workloads, Service selectors, ConfigMaps, literal environment variables, and ConfigMap references. Skaffold build artifacts connect images to source directories; Maven Jib projects narrow shared build contexts to individual services. Only an unambiguous selector resolves a Service to a workload. Secret resources and secret environment values are never added to the graph.

`repository_kubernetes_manifest_dirs` in `deployment/configuration.ini` (or its environment override) selects preferred manifest directories when present. The default configuration selects `kubernetes-manifests`. Alternate deployments are excluded and reported as a scope warning. Without a matching preferred directory, resources remain separated by manifest directory and namespace. Helm templates, Kustomize expansion, runtime overrides and external endpoints are not inferred.

Inherited ConfigMap endpoints need a source reference before becoming a connection. Spring Boot datasource settings can also establish a framework-configured connection when the owned Maven project declares Spring Boot. These are declared/reference relationships, not proof of live traffic. File paths and line numbers accompany connections; the full map JSON retains the evidence.

## Bank of Anthos verification

Sample: https://github.com/GoogleCloudPlatform/bank-of-anthos.git

The default Kubernetes deployment produces nine components: frontend, ledgerwriter, balancereader, transactionhistory, userservice, contacts, ledger-db, accounts-db, loadgenerator. Twelve configured connections cover the frontend's five service endpoints, ledgerwriter's balance lookup, three ledger datasource connections, two accounts datasource connections, and loadgenerator's frontend target. The alternate ledger monolith is excluded from this deployment map.

## AI review and rendering

The external prompt asks for scope, uncertainty, verification steps, and conservative hypotheses. Every suggested edge must reference existing endpoint evidence; invented nodes, invented file references, duplicate connections, and oversized responses are rejected by the backend. An empty suggestion list is valid when the declared topology already explains the evidence. Repository labels and evidence are treated as untrusted data.

Mermaid uses root-level `htmlLabels: false` so labels are SVG text. Sanitization still forbids foreignObject and link attributes. Each render gets a distinct ID. The viewport uses intrinsic SVG dimensions with scrolling, zoom, actual-size reset and a Fit control, rather than stretching diagrams to the panel width.

No static or AI-assisted map guarantees runtime completeness. Validate uncertain connections with traces, effective deployment configuration and owner review before designing fault injection or load tests.

## Request flows and Mermaid views

Use **Diagram type** beside regeneration, then open **Mermaid diagram**. Architecture flowchart preserves topology; possible request sequence and request swimlanes traverse outgoing call, endpoint and routing evidence from the selected entry service. Startup dependencies and imports are excluded. Static traversal is a possible path: it does not establish execution, branch ordering, parallelism, retries, or latency. Cycles are bounded and unresolved destinations require more source/configuration or telemetry.

Observed trace sequence accepts a normalized JSON array of OpenTelemetry spans from one trace: `traceId` (32 hex characters), `spanId` (16 hex characters), optional `parentSpanId`, `service`, `operation`, and numeric `startTime` using the same time unit. Export service names, span identifiers, operation names and timing only. Do not paste credentials, request bodies, user attributes or sensitive operation names. Parent-child relationships and timestamps establish the displayed call order; a missing parent is marked explicitly. This is an import/view, not an instrumentation replacement for OpenTelemetry or an APM platform. Only the sanitized diagram is saved; raw spans are not persisted or sent to AI. No response arrows or durations are invented.

Class view extracts JavaScript/TypeScript AST class names, declared methods and uniquely resolved inheritance. State view accepts explicit JSON machine declarations with `initial`, `states`, and string or `{target}` entries under `on`. Unsupported languages/state frameworks report missing evidence; service nodes are never turned into fabricated UML classes or states. Refresh older maps before using newly discovered details.

Database discovery adds literal names from supported database environment variables, paired Kubernetes environment values, database URI paths with a matching database service host, and SQL `CREATE DATABASE` declarations with an unambiguous database owner. Credentials and full connection strings are discarded. Multiple candidates, templated values and missing declarations remain unresolved rather than guessed. The service identity remains visible alongside resolved database names.

### Endpoint labels

Diagrams display resolved HTTP methods and URL paths, not the internal `configured endpoint` relationship category. Python AST inspection resolves supported literal, environment-backed `.format()` and f-string configuration, `requests`/`httpx` calls, and explicitly declared `ApiRequest` method defaults. Source is parsed without imports or execution. Credentials, query strings and fragments are omitted. Path parameters remain templates, for example `GET /balances/{account_id}`. Ambiguous/dynamic values remain **Request path unresolved**; refresh the repository to collect new endpoint evidence. JavaScript literal HTTP calls and Compose URL paths also carry endpoint labels. Endpoint parsing requires the configured Python executable; Docker service images include Python. Missing parsers preserve a partial map with a warning.

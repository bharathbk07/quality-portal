# Architecture studio

Application maps now provide interactive logical, high-level and deployment views. The canvas supports pan, zoom, minimap, node dragging, hierarchical and swimlane layouts, search and environment filters. Boundaries can group components by function, language, namespace, environment, team or reviewed custom annotations.

Refresh a repository map to discover the newer metadata. Existing maps are preserved. Static discovery records source evidence for supported languages, dependency declarations, cache patterns, Kubernetes/Compose configuration, exposed service ports, probes, flags (names only), resource requests, CI definitions and literal Terraform resource declarations. These are repository declarations, not proof of live deployments or runtime behaviour. Unsupported and dynamic relationships remain unknown.

Selecting a component shows its evidence and upstream/downstream dependency reachability. Users can attach owners, documentation, notes, warnings, colours and icons. Backend-generated SVG and JSON exports preserve the current filtered view. Workspace links require sign-in and workspace authorization.

## Analysis and AI

Knowledge answers, onboarding narratives, README/runbook drafts, configuration review findings, dependency impact and outage/traffic/replacement scenarios work without AI. Optional AI explanations and suggested boundaries use the configured provider, validated evidence citations and external prompt files. Suggestions cannot replace the static graph or execute infrastructure changes. Provider failure preserves deterministic results.

Reviews identify missing information and potential risks; they do not certify compliance. Simulations describe structural reachability and hypotheses, not measured failure propagation or predicted performance. API documentation is an explicitly incomplete OpenAPI shell: repository topology does not justify inventing operations or request/response schemas.

Conditional cloud estimates require user-supplied prices, currency, hours and replicas. Missing resource requests remain unknown. Estimates exclude provider-specific packing, discounts, network traffic and other unprovided charges. No current cloud price or capacity prediction is fabricated. Production sizing needs workload, SLO and observed utilization evidence.

## Revisions and security

Current/proposed snapshots persist reviewed annotations, positions, view configuration and optional hypothetical scenarios. Snapshots use AES-256-GCM encryption bound to workspace, map and revision IDs. Backend validation enforces IDs, limits and safe documentation URLs. Transaction locks and expected-version checks reject conflicting saves. Current-versus-proposed comparisons show annotation/scenario/layout changes; they do not represent deployed infrastructure mutations. Collaboration uses authorized workspace access and versioned snapshots, not live multi-user cursor synchronization.

The browser calls the BFF only. Core owns discovery, layouts, impact, cost arithmetic, validation, encryption and persistence; existing session, CSRF and workspace RBAC checks remain in force.

## Scoped discovery and documentation context

Imports can declare a single service/program, multiple services/subsystem, intended system or unknown scope. HTTPS Git imports accept relative file/directory prefixes before file/size selection; include relevant deployment and documentation paths explicitly. Every graph remains partial until validated against running infrastructure. COBOL/PL-I program declarations and literal COBOL CALL/JCL EXEC PGM references are supported conservatively; unresolved programs appear as external nodes. Dynamic calls, copybook/preprocessor expansion, CICS transactions, mainframe catalogs and live systems require supplied evidence and specialized adapters. Additional language extensions and AI framework dependency declarations improve metadata discovery; they do not promise complete semantic analysis for every language.

Markdown is indexed into bounded chunks after common credential/email redaction. README files are prioritized. The chunk index is encrypted in PostgreSQL using authenticated map/workspace binding; only path/line references are included in the public graph. Backend lexical relevance retrieval supplies bounded excerpts to optional AI calls. This small repository context does not require an embedding/vector database. Redaction is defensive filtering, not a guarantee that arbitrary documents contain no sensitive data; import only documents approved for the configured provider. AI narrative prompts now require named components, concrete evidence, documented intent versus implementation, contradictions, uncertainty and specific verification steps. Use “Summarize imported Markdown” in Knowledge & review to inspect retrieved excerpts and request an AI summary. Older maps require re-import/refresh to obtain this context.

Named custom boundaries also accept descriptions, stored in encrypted snapshots. Local Docker containers have meaningful names and OCI title/description labels. `CONTAINER_NAME_PREFIX` overrides the local naming prefix; existing Compose project and named volumes are preserved. Fixed container names are for the local single-instance deployment, not a multi-replica orchestration strategy.

“Regenerate Mermaid diagram” rebuilds the diagram from stored graph evidence with a selected direction; it does not fetch repository changes. Regeneration clears prior AI enrichment so its diagram cannot override the newly generated diagram. “Delete map project” requires a workspace administrator and exact project-name confirmation. The backend transaction removes the map, encrypted document context, enrichment, pending input and all snapshots, retaining an audit event. An in-flight worker cannot recreate a deleted map because completion updates are fenced by map ID/worker token. Independent assessment reports, Git repositories, tool configuration and workspace membership are not deleted.

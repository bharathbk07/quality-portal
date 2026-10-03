# Connection diagnosis and pre-test reports

## Connection failures addressed

The saved Gemini credentials were present, but AI defaults still selected an unconfigured compatible provider. AI status and generation now share a backend resolver: an explicit provider selection never falls back; an incomplete default uses a configured chat provider with a visible explanation. Select Gemini in AI defaults to make that preference permanent.

Runtime settings previously substituted empty strings for unsaved endpoint/model-version/project fields even though the settings UI showed INI defaults. Both paths now resolve the same configuration. Secrets remain workspace database values, never returned to the browser. Explicitly cleared fields remain cleared.

LangSmith API and dashboard URLs have different purposes. Tracing uses the API endpoint for the account region. US, EU and APAC API origins are approved in the shipped operator configuration. Dashboard origins are not granted API egress permission. Custom or self-hosted endpoints still require operator configuration; arbitrary destinations, credential-bearing URLs and redirects remain blocked. Provider forms include endpoint guidance; save errors identify the offending field.

## Assessment flow

1. Choose a report type and name.
2. Optionally attach an existing OpenAPI contract and completed application map from the current workspace.
3. Provide application objectives and journeys, environment/topology, workload/data assumptions, SLOs, telemetry, recovery controls, browser/accessibility targets, existing sanitized evidence and scope/ownership.
4. Generate without AI for deterministic evidence gaps, contract warnings, map limitations and risk hypotheses. Generation does not run tests, scans, repository code or external testing tools.
5. Optionally add AI suggestions. Only the assessment snapshot is sent through the existing provider gateway. Provider failure preserves a usable deterministic report. AI text remains a labeled unverified draft and cannot replace deterministic findings.
6. Review recommended investigations and their required evidence. Export Markdown or JSON and validate using the existing open-source tools.

Reports: pre-test readiness; performance risk; observability/APM coverage; resilience/dependency risk; UI/UX review plan; accessibility review plan; release decision brief.

A report separates observed configuration, missing information and hypotheses. Supplied baseline text is not parsed as independently verified tool evidence. A release brief is not a release approval, and an accessibility plan is not a compliance certificate. Before execution the portal identifies what needs investigation; it cannot prove runtime performance or resilience defects.

## Data and access

Input sizes and report-list limits come from `[assessment]` in `deployment/configuration.ini`. Intake keys and report types are validated in both BFF and core. Unknown input fields are rejected. Source lookups and report reads/listing are scoped to the authenticated workspace. Viewers can read but cannot generate. Report content uses authenticated AES-256-GCM encryption with workspace/report-bound associated data; listing metadata contains only name, type and date. Database migration `006-assessment-reports` adds the table and index.

All authenticated pages now use the same sidebar, account/workspace controls, header, content spacing and navigation. The login page retains the matching identity design outside the authenticated shell. Motion respects reduced-motion preferences.

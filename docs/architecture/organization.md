# Workspace organization

The root is the command entry point. Run npm and Docker Compose commands here; keep `.env` here. Runtime configuration is `deployment/configuration.ini`. Existing database volumes and credentials are preserved.

```text
frontend/
  src/app/                     Next.js routes, layout, browser-safe composition
  src/features/
    auth/                      Login, session display, account navigation
    account/                   Local password-change form
    administration/            Workspace membership and SSO configuration UI
    workspace/components/      Contract, discipline, evidence, saved-plan widgets
    workspace/hooks/           Query-owned server state and local UI selections
    application-maps/          Repository import and sanitized diagram display
    connections/               Optional integration settings forms
  src/shared/                  API client, query provider, downloads
  src/components/ui/           Shared UI primitives
  src/vendor/                  Required third-party stylesheet and license
middleware/bff/                Public API boundary, cookie sessions, CSRF, rate limits
backend/
  core/                        API orchestration and testing domain engine
  identity/                    Authentication, authorization, SSO, workspace rules
  settings/                    Encrypted integration configuration and safe catalog
  database/
    repositories/              Parameter-bound Drizzle data access
    migrations/                Ordered, versioned database changes
    pool.mjs                   Bounded PostgreSQL connection pool and timeouts
    migrate.mjs                Advisory-locked migration ledger/checksums
  mapping/                     Static analyzer and leased background worker
  adapters/integration/        Tool/API adapters and Python AI gateway
  ai/src/vivegam_ai/
    api/                       Provider-independent HTTP routes
    schemas/                   Pydantic request and response contracts
    services/                  AI generation policy and capacity control
    adapters/                  Direct native provider SDKs
    security/                  Egress transport policy and input redaction
    observability/             Bounded LangSmith delivery
    config/                    Environment/INI plus scoped DB runtime settings
  shared/                      Internal HTTP, operational config, prompt loading
prompts/
  ai/                          Assistant instructions and plan templates
  application-maps/            Graph-enrichment instructions
  evaluations/                 Deterministic offline safety cases
deployment/
  compose.yaml                 Local service/network/container topology
  docker/                      Node and Python images
  infrastructure/              Gateway, database bootstrap, Prometheus
  configuration.ini            Non-secret operational settings
  legacy-sites/                Archived alternative hosting scaffold; not built
scripts/                       Local setup, development and smoke commands
tests/                        Unit, security and PostgreSQL integration checks
 artifacts/                    Saved verification evidence
```

## Frontend rules

The frontend has no database or provider credentials. API responses and permissions are server-authoritative; disabled UI controls are only presentation. Feature hooks use TanStack Query with cancellation, deduplication, bounded retries and memory-only caches. Independent requests run concurrently. Route files are thin composition wrappers. The workspace hook is separate from individual UI widgets. Next.js Strict Mode and React Compiler are enabled; the diagram feature and Mermaid are loaded on demand. Mermaid runs in strict mode and its SVG is sanitized with DOMPurify, with external SVG links and foreign objects forbidden.

The central same-origin Fetch wrapper owns cookies, CSRF headers, error contracts and configurable timeouts. Mutations never retry automatically. No query cache is persisted to localStorage. Workspace keys scope cached data. Switching workspace performs a full page transition so the previous scope is discarded.

## Backend and database rules

BFF sessions remain opaque, HttpOnly, and server-revocable. Every request resolves membership from the database. Role changes and account disablement take effect immediately. This is intentional; replacing these sessions with long-lived stateless JWTs would weaken revocation. Public traffic reaches the BFF through Traefik. The frontend has no database-network access. Internal services use service authentication; outbound adapters use an operator-maintained host policy, no redirects and bounded responses.

Route handlers delegate SQL to repositories. Drizzle composes bound parameters from repository-owned statements; user values never become SQL identifiers or query text. The pool has configurable connection, idle and statement timeouts. Startup migrations use a global advisory lock and `schema_migrations` ledger. Applied migration checksums must stay unchanged; add a new version rather than editing a recorded migration. Existing older tables are upgraded idempotently. Development PostgreSQL checks use isolated schemas.

The repository scan queue remains PostgreSQL-backed with bounded admission, leases, retries, fencing tokens, and input cleanup. Heavy repository analysis never runs in a browser. Introducing a second Redis/Celery queue without a Python distributed workload would duplicate that mechanism.

## AI rules and limits

Direct native SDK adapters stay behind a provider-independent generation service. Vendor timeouts, retry limits and output-token budgets come from server configuration. Generation has global and workspace concurrency limits; schema checks reject malformed provider envelopes and oversized output. Provider-specific billing alerts still need to be configured in the provider account.

Templates are version-controlled under `prompts/`, mounted read-only by Compose, and loaded at request time. `PROMPTS_DIR` can choose another server directory. LangSmith metadata includes the system-prompt SHA-256 fingerprint. Repository enrichment independently validates every returned node/edge before accepting model output. Draft prose remains prose, not an executable command or trusted assertion.

Common email, SSN, credential, bearer-token and private-key patterns are redacted before generation and tracing. This deterministic filter does not identify every possible form of PII. Do not submit sensitive datasets assuming complete anonymization. Context is explicitly untrusted and generated output cannot bypass RBAC or execute tools automatically. Trace content capture remains off by default.

The portal currently uses bounded complete responses, not token streaming. It does not yet implement embeddings, RAG, semantic caching, per-token billing quotas, or model-based guardrail evaluation. Those require concrete product requirements, selected models and workspace-specific retention/cost policies; they are not silently approximated by the deterministic safety tests. Native Cursor tasks are bounded background SDK operations, while durable repository scans use the leased database queue.

## Verification commands

From the root:

```sh
npm run check
npm run test:python
npm run build:frontend
docker compose config --quiet
docker compose up --build -d
docker compose exec -T core node --input-type=module < tests/identity-postgres.mjs
```

For Python setup: create `backend/ai/.venv`, then install `backend/ai/requirements-dev.lock.txt`. `npm run lint:python` uses Ruff, `npm run typecheck:python` checks all Python source with Mypy, and Pytest runs the native SDK and policy tests. The production image installs only the runtime lock file.

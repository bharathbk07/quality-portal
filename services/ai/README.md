# Python AI service

Requests follow gateway → BFF → core → integration → Python SDK adapters. The AI service has no published port. Its internal endpoints require `SERVICE_TOKEN`.

Packages: `google-genai` for native Gemini generation, `anthropic` for Claude Messages, `openai` for OpenAI and LM Studio/compatible servers, `ollama` for native Ollama chat, `cursor-sdk` for repository agents, and `langsmith` for tracing. Versions and transitive dependencies are pinned in `requirements.lock.txt`.

## Configure connections

Open `/settings`, sign in, and select the AI providers tab. Each provider has its own tab for endpoint, model and API key. Select the default in AI defaults. All values are encrypted in PostgreSQL; saved secrets are never returned to the browser. The Python service reads current settings from core over an internal authenticated connection on each request. Changes take effect without restarting the service.

Startup settings (service authentication, internal core URL, timeouts and operational limits) remain in environment/configuration files. Provider connections are optional and do not block startup. Configuration-file endpoint defaults prefill forms; unsaved defaults do not activate connections.

Google uses its native API root, Claude uses its native API root, and OpenAI/LM Studio use a base URL including `/v1`. Ollama uses its server root. LM Studio and local Ollama do not require an API key unless their server enables authentication. Inside Docker, `host.docker.internal` reaches a server on the host. The copilot can select any configured chat provider per request; repository AI enrichment uses the saved default provider.

## LangSmith

Use the LangSmith settings tab to enable tracing, enter an API key, select the regional endpoint and project, and optionally specify a workspace ID.

The LangSmith Python SDK submits completed runs from a bounded background queue. Runs include start/end timestamps, provider/model, request correlation, normalized token usage, and sanitized failures. Delivery errors never fail a successful AI call. Workspace settings reports the most recent delivery state; this state is process-local and resets on restart. LangSmith remains the monitoring source of truth.

Prompt and response content are redacted unless prompt and response capture is enabled in the LangSmith tab. Token metrics and model metadata remain available while content is redacted. Provider SDK exceptions are reduced to exception class names in traces to avoid exporting raw request details.

## Cursor

Enter your API key and model in the Cursor tab. The package's bundled SDK bridge starts automatically in configured temporary workspace storage. To connect to a separately managed bridge, enter its URL and bridge token in the Cursor tab.

Workspace settings has a separate repository-task form. Launching explicitly starts a cloud coding agent against the specified HTTPS repository and optional starting ref. Source control must be connected in Cursor. The adapter disables automatic PR creation and work on the current branch. The cloud agent may push changes to a new branch.

The launch request returns agent/run IDs promptly. A bounded background worker waits for the run, traces completion/failure, and closes SDK resources. Refresh agent status to inspect the durable cloud agent. Restarting the portal loses its local worker state; the cloud agent can still be inspected in Cursor. Do not resubmit a task merely because the browser connection was interrupted.

## Local development and tests

```sh
python3 -m venv services/ai/.venv
services/ai/.venv/bin/pip install -r services/ai/requirements.lock.txt
services/ai/.venv/bin/python -m unittest discover -s tests -p 'test_ai.py' -v
```

Tests exercise the actual generation SDKs and LangSmith SDK against local mock HTTP servers, plus Cursor cloud configuration and resource cleanup with a mocked SDK bridge. They do not call live AI accounts.

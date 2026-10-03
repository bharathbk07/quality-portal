import re
from contextvars import copy_context
from urllib.parse import urlsplit

from fastapi import FastAPI, Request

from vivegam_ai.adapters.providers import ProviderError, Providers
from vivegam_ai.config.settings import Settings
from vivegam_ai.observability.monitoring import Monitoring
from vivegam_ai.schemas.generation import (
    CursorTask,
    Generate,
    GenerationResponse,
    Probe,
    validate_request,
)
from vivegam_ai.security.redaction import redact_sensitive
from vivegam_ai.services.generation import GenerationService


def register_routes(
    app: FastAPI, s: Settings, providers: Providers, monitoring: Monitoring
) -> None:
    generation = GenerationService(s, providers, monitoring)

    @app.get("/health/live")
    def health():
        return {"status": "ok", "service": "ai-python"}

    @app.get("/ai/status")
    def status(request: Request):
        s.refresh()
        p = providers.resolve_chat()
        return dict(
            configured=p["configured"] and p["mode"] == "chat",
            model=p["model"] or None,
            provider=p["id"],
            requestedProvider=s.get("ai", "ai_provider"),
            defaultReason="Using an available provider because the selected default is incomplete"
            if p["id"] != s.get("ai", "ai_provider") else None,
            providers=providers.public_profiles(),
            monitoring=monitoring.status(),
        )

    def invoke(name, inputs, operation, request, agent=False):
        s.refresh()
        p = providers.profile(name)
        return monitoring.invoke(
            name,
            p["model"],
            inputs,
            operation,
            request.headers.get("x-correlation-id"),
            agent=agent,
        )

    @app.post("/ai/generate", response_model=GenerationResponse)
    def generate(body: Generate, request: Request):
        validate_request(body, s)
        return generation.generate(
            body.provider, body.prompt, body.context, request.headers.get("x-correlation-id")
        )

    @app.post("/ai/test")
    def test_provider(body: Probe, request: Request):
        return invoke(
            body.provider,
            {"probe": True},
            lambda: providers.test(body.provider),
            request,
            body.provider == "cursor",
        )

    @app.post("/ai/cursor/agents")
    def cursor_task(body: CursorTask, request: Request):
        validate_request(body, s)
        if s.boolean("ai", "ai_redact_sensitive"):
            body = body.model_copy(update={"prompt": redact_sensitive(body.prompt)})
        parsed = urlsplit(body.repository)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or parsed.query
            or parsed.fragment
        ):
            raise ProviderError("Use an HTTPS repository URL without credentials", 400)
        context = copy_context()
        return invoke(
            "cursor",
            body.model_dump(),
            lambda: providers.cursor_task(
                body.prompt,
                body.repository,
                body.ref,
                observe=lambda operation: context.copy().run(
                    invoke, "cursor", body.model_dump(), operation, request, True
                ),
            ),
            request,
            True,
        )

    @app.get("/ai/cursor/agents/{agent_id}")
    def cursor_status(agent_id: str, request: Request):
        s.refresh()
        if not re.fullmatch(r"bc-[a-zA-Z0-9-]+", agent_id):
            raise ProviderError("Invalid Cursor agent ID", 400)
        p = providers.require("cursor")
        with providers.cursor_client() as client:
            result = client.agents.get(agent_id, api_key=p["key"])
            return {
                "agent": {
                    "id": result.agent_id,
                    "name": result.name,
                    "status": result.status,
                    "summary": result.summary,
                }
            }

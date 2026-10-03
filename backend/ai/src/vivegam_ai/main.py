import hmac
import json
import logging
from contextlib import asynccontextmanager
from time import monotonic
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from vivegam_ai.adapters.providers import ProviderError, Providers
from vivegam_ai.api.routes import register_routes
from vivegam_ai.config.settings import Settings
from vivegam_ai.observability.monitoring import Monitoring

logger = logging.getLogger("vivegam.ai")


def build_app(
    settings: Settings | None = None,
    providers: Providers | None = None,
    monitoring: Monitoring | None = None,
) -> FastAPI:
    s = settings or Settings()
    if not s.secret("SERVICE_TOKEN"):
        raise RuntimeError("SERVICE_TOKEN is required")
    provider_service = providers or Providers(s)
    trace_service = monitoring or Monitoring(s)

    @asynccontextmanager
    async def lifespan(app):
        yield
        provider_service.close()
        trace_service.close()

    app = FastAPI(
        title="Vivegam Python AI adapters",
        lifespan=lifespan,
        docs_url=None,
        redoc_url=None,
        openapi_url=None,
    )

    @app.middleware("http")
    async def authentication(request: Request, next_handler):
        start = monotonic()
        if request.url.path != "/health/live":
            if not hmac.compare_digest(
                request.headers.get("x-service-token", ""), s.secret("SERVICE_TOKEN")
            ):
                return JSONResponse({"error": "Internal authentication required"}, status_code=401)
            try:
                workspace = str(UUID(request.headers.get("x-workspace-id", "")))
            except ValueError:
                return JSONResponse({"error": "Valid workspace scope is required"}, status_code=400)
            s.workspace.set(workspace)
        s.runtime = {}
        limit = s.integer("security", "body_limit_bytes")
        if request.method == "POST":
            chunks, total = [], 0
            async for chunk in request.stream():
                total += len(chunk)
                if total > limit:
                    return JSONResponse({"error": "Request body too large"}, status_code=413)
                chunks.append(chunk)
            request._body = b"".join(chunks)
        response = await next_handler(request)
        logger.info(
            json.dumps(
                {
                    "event": "ai_request",
                    "method": request.method,
                    "status": response.status_code,
                    "duration_ms": round((monotonic() - start) * 1000),
                }
            )
        )
        return response

    @app.exception_handler(ProviderError)
    async def provider_error(request, exc):
        return JSONResponse({"error": exc.message}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({"error": "Invalid request payload"}, status_code=400)

    @app.exception_handler(Exception)
    async def sdk_error(request, exc):
        logger.error(json.dumps({"event": "ai_failure", "type": type(exc).__name__}))
        return JSONResponse(
            {
                "error": "AI SDK request failed. Check provider credentials, model access and endpoint."
            },
            status_code=502,
        )

    register_routes(app, s, provider_service, trace_service)
    return app


if __name__ == "__main__":
    import uvicorn

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    settings = Settings()
    uvicorn.run(
        build_app(settings),
        host=settings.get("services", "bind_host"),
        port=settings.integer("services", "ai_port"),
    )

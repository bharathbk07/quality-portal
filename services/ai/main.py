from contextlib import asynccontextmanager
import hmac
import re
from urllib.parse import urlsplit
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from pydantic import BaseModel, ConfigDict, Field
from config import Settings
from providers import Providers, ProviderError
from monitoring import Monitoring


def build_app(settings=None, providers=None, monitoring=None):
    s = settings or Settings()
    if not s.secret('SERVICE_TOKEN'):
        raise RuntimeError('SERVICE_TOKEN is required')
    providers = providers or Providers(s)
    monitoring = monitoring or Monitoring(s)

    @asynccontextmanager
    async def lifespan(app):
        yield
        providers.close()
        monitoring.close()

    app = FastAPI(title='Vivegam Python AI adapters', lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware('http')
    async def authentication(request, next_handler):
        if request.url.path != '/health/live' and not hmac.compare_digest(request.headers.get('x-service-token', ''), s.secret('SERVICE_TOKEN')):
            return JSONResponse({'error': 'Internal authentication required'}, status_code=401)
        limit = s.integer('security', 'body_limit_bytes')
        if request.method == 'POST':
            body = await request.body()
            if len(body) > limit:
                return JSONResponse({'error': 'Request body too large'}, status_code=413)
        return await next_handler(request)

    @app.exception_handler(ProviderError)
    async def provider_error(request, exc):
        return JSONResponse({'error': exc.message}, status_code=exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return JSONResponse({'error': 'Invalid request payload'}, status_code=400)

    @app.exception_handler(Exception)
    async def sdk_error(request, exc):
        return JSONResponse({'error': 'AI SDK request failed. Check provider credentials, model access and endpoint.'}, status_code=502)

    class Generate(BaseModel):
        model_config = ConfigDict(extra='forbid')
        provider: str | None = None
        prompt: str = Field(min_length=1, max_length=s.integer('public', 'ai_prompt_max_chars'))
        context: str = Field(max_length=s.integer('public', 'ai_context_max_chars'))

    class Probe(BaseModel):
        model_config = ConfigDict(extra='forbid')
        provider: str

    class CursorTask(BaseModel):
        model_config = ConfigDict(extra='forbid')
        prompt: str = Field(min_length=1, max_length=s.integer('public', 'ai_prompt_max_chars'))
        repository: str = Field(max_length=s.integer('validation', 'endpoint_max_chars'))
        ref: str = Field(default='', max_length=s.integer('repository', 'repository_max_path_chars'))

    @app.get('/health/live')
    def health():
        return {'status': 'ok', 'service': 'ai-python'}

    @app.get('/ai/status')
    def status():
        s.refresh()
        p = providers.profile(s.get('ai', 'ai_provider'))
        return dict(configured=p['configured'] and p['mode'] == 'chat', model=p['model'] or None,
                    provider=p['id'], providers=providers.public_profiles(), monitoring=monitoring.status())

    def invoke(name, inputs, operation, request, agent=False):
        s.refresh()
        p = providers.profile(name)
        return monitoring.invoke(name, p['model'], inputs, operation, request.headers.get('x-correlation-id'), agent=agent)

    @app.post('/ai/generate')
    def generate(body: Generate, request: Request):
        s.refresh()
        name = body.provider or s.get('ai', 'ai_provider')
        return invoke(name, body.model_dump(), lambda: providers.generate(name, body.prompt, body.context), request)

    @app.post('/ai/test')
    def test_provider(body: Probe, request: Request):
        return invoke(body.provider, {'probe': True}, lambda: providers.test(body.provider), request, body.provider == 'cursor')

    @app.post('/ai/cursor/agents')
    def cursor_task(body: CursorTask, request: Request):
        parsed = urlsplit(body.repository)
        if parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment:
            raise ProviderError('Use an HTTPS repository URL without credentials', 400)
        return invoke('cursor', body.model_dump(), lambda: providers.cursor_task(body.prompt, body.repository, body.ref, observe=lambda operation: invoke('cursor', body.model_dump(), operation, request, True)), request, True)

    @app.get('/ai/cursor/agents/{agent_id}')
    def cursor_status(agent_id: str):
        s.refresh()
        if not re.fullmatch(r'bc-[a-zA-Z0-9-]+', agent_id):
            raise ProviderError('Invalid Cursor agent ID', 400)
        p = providers.require('cursor')
        with providers.cursor_client() as client:
            result = client.agents.get(agent_id, api_key=p['key'])
            return {'agent': {'id': result.agent_id, 'name': result.name, 'status': result.status, 'summary': result.summary}}

    return app


if __name__ == '__main__':
    import uvicorn
    settings = Settings()
    uvicorn.run(build_app(settings), host=settings.get('services', 'bind_host'), port=settings.integer('services', 'ai_port'))

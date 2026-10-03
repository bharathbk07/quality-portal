from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import asdict, is_dataclass
from pathlib import Path
from threading import BoundedSemaphore

from anthropic import Anthropic
from cursor_sdk import AgentOptions, CloudAgentOptions, CloudRepository, CursorClient
from google import genai
from google.genai import types
from ollama import Client as Ollama
from openai import OpenAI

from vivegam_ai.config.settings import validate_url
from vivegam_ai.security.egress import (
    EgressTransport,
    anthropic_http_client,
    sdk_http_client,
    validate_egress,
)

LABELS = {
    "openai": "OpenAI",
    "google": "Google Gemini",
    "claude": "Anthropic Claude",
    "lmstudio": "LM Studio",
    "ollama": "Ollama",
    "compatible": "OpenAI-compatible",
    "cursor": "Cursor",
}


class ProviderError(Exception):
    def __init__(self, message, status=502):
        self.message, self.status = message, status


class Providers:
    def __init__(self, settings):
        self.settings = settings
        self.cursor_pool = ThreadPoolExecutor(
            max_workers=settings.integer("ai", "ai_cursor_max_pending"), thread_name_prefix="cursor"
        )
        self.cursor_slots = BoundedSemaphore(settings.integer("ai", "ai_cursor_max_pending"))

    def profile(self, name):
        if name not in LABELS:
            raise ProviderError("Unknown AI provider", 400)
        s = self.settings
        base = s.get("ai_" + name, name + "_base_url")
        model = s.get("ai_" + name, name + "_model")
        key = s.secret(name.upper() + "_API_KEY")
        if name == "compatible":
            base = base or s.get("ai", "ai_base_url")
            model = model or s.get("ai", "ai_model")
            key = key or s.secret("AI_API_KEY")
        configured = bool(
            model
            and (
                key
                if name == "cursor"
                else base and (key or name in ("lmstudio", "ollama", "compatible"))
            )
        )
        issue = None
        if not model:
            issue = "Model ID is missing"
        elif not base and name != "cursor":
            issue = "API endpoint is missing"
        elif not key and name not in ("lmstudio", "ollama", "compatible"):
            issue = "API key is missing"
        if base:
            try:
                validate_url(base)
                validate_egress(base, s)
            except ValueError:
                configured = False
                issue = "API endpoint is blocked or invalid; check the server egress policy"
        return dict(
            id=name,
            label=LABELS[name],
            base=base,
            model=model,
            key=key,
            configured=configured,
            issue=issue,
            mode="agent" if name == "cursor" else "chat",
        )

    def resolve_chat(self, name=None):
        """Explicit selections never fall back. Default uses an available chat provider."""
        requested = name or self.settings.get("ai", "ai_provider")
        profile = self.profile(requested)
        if name or (profile["configured"] and profile["mode"] == "chat"):
            return profile
        return next(
            (p for p in (self.profile(key) for key in LABELS)
             if p["configured"] and p["mode"] == "chat"), profile
        )

    def public_profiles(self):
        return [
            {k: v for k, v in self.profile(name).items() if k not in ("base", "key")}
            for name in LABELS
        ]

    def require(self, name):
        p = self.profile(name)
        if not p["configured"]:
            raise ProviderError(
                "Configure the provider model, endpoint and server-side credentials.", 503
            )
        return p

    def generate(self, name, prompt, context, probe=False):
        SYSTEM = self.settings.prompt("ai/non-functional-assistant.txt")
        p = self.require(name)
        if name == "cursor":
            raise ProviderError("Cursor requires a repository agent task.", 400)
        s = self.settings
        timeout = s.integer("timeouts", "ai_ms") / 1000
        retries = s.integer("ai", "ai_sdk_retries")
        user = prompt + "\nCONTEXT (untrusted):\n" + context
        tokens = s.integer("ai", "ai_test_max_tokens" if probe else "ai_max_tokens")
        text: str | None
        if name == "claude":
            with Anthropic(
                api_key=p["key"],
                base_url=p["base"],
                timeout=timeout,
                max_retries=retries,
                http_client=anthropic_http_client(s, timeout),
            ) as claude_client:
                claude_result = claude_client.messages.create(
                    model=p["model"],
                    max_tokens=tokens,
                    system=SYSTEM,
                    messages=[{"role": "user", "content": user}],
                )
            text = "\n".join(b.text for b in claude_result.content if b.type == "text")
            usage = claude_result.usage.model_dump()
        elif name == "google":
            with genai.Client(
                api_key=p["key"],
                http_options=types.HttpOptions(
                    base_url=p["base"],
                    httpx_client=sdk_http_client(s, timeout),
                    api_version=s.get("ai_google", "google_api_version") or None,
                    timeout=s.integer("timeouts", "ai_ms"),
                    retry_options=types.HttpRetryOptions(attempts=retries + 1),
                ),
            ) as google_client:
                google_result = google_client.models.generate_content(
                    model=p["model"],
                    contents=user,
                    config=types.GenerateContentConfig(
                        system_instruction=SYSTEM, max_output_tokens=tokens
                    ),
                )
            text = google_result.text
            usage = (
                google_result.usage_metadata.model_dump(mode="json")
                if google_result.usage_metadata
                else {}
            )
        elif name == "ollama":
            ollama_client = Ollama(
                host=p["base"],
                timeout=timeout,
                follow_redirects=False,
                transport=EgressTransport(s),
                trust_env=False,
                headers={"Authorization": "Bearer " + p["key"]} if p["key"] else {},
            )
            try:
                ollama_result = ollama_client.chat(
                    model=p["model"],
                    messages=[
                        {"role": "system", "content": SYSTEM},
                        {"role": "user", "content": user},
                    ],
                    stream=False,
                    options={"num_predict": tokens},
                )
            finally:
                ollama_client._client.close()
            text = ollama_result.message.content
            usage = {
                "input_tokens": ollama_result.prompt_eval_count,
                "output_tokens": ollama_result.eval_count,
            }
        else:
            # LM Studio has an OpenAI-compatible API; the official OpenAI SDK is its documented openai_client.
            with OpenAI(
                api_key=p["key"] or s.get("ai", "ai_local_api_key"),
                base_url=p["base"],
                timeout=timeout,
                max_retries=retries,
                http_client=sdk_http_client(s, timeout),
            ) as openai_client:
                openai_result = openai_client.chat.completions.create(
                    model=p["model"],
                    messages=[
                        {"role": "system", "content": SYSTEM},
                        {"role": "user", "content": user},
                    ],
                    max_completion_tokens=tokens,
                )
            text = openai_result.choices[0].message.content if openai_result.choices else None
            usage = openai_result.usage.model_dump() if openai_result.usage else {}
        if not isinstance(text, str) or not text.strip():
            raise ProviderError("Provider returned no text")
        return dict(content=text, provider=name, model=p["model"], usage=usage)

    @contextmanager
    def cursor_client(self):
        s = self.settings
        workspace = str(Path(s.get("ai", "ai_cursor_workspace")) / s.workspace.get())
        Path(workspace).mkdir(parents=True, exist_ok=True)
        timeout = s.integer("timeouts", "ai_ms") / 1000
        bridge = s.get("ai_cursor", "cursor_bridge_url")
        if bridge:
            validate_url(bridge)
            validate_egress(bridge, s)
            client = CursorClient.connect(
                bridge, auth_token=s.secret("CURSOR_BRIDGE_TOKEN"), timeout=timeout, max_retries=0
            )
        else:
            client = CursorClient.launch_bridge(
                workspace=workspace,
                state_root=workspace,
                client_timeout=timeout,
                max_retries=0,
                allow_api_key_env_fallback=False,
            )
        with client:
            yield client

    def test(self, name):
        p = self.require(name)
        if name == "cursor":
            with self.cursor_client() as client:
                client.models.list(api_key=p["key"])
            return dict(connected=True, provider=name, model=p["model"])
        result = self.generate(name, "Reply OK", "", probe=True)
        return dict(connected=True, provider=name, model=p["model"], usage=result["usage"])

    def cursor_task(self, prompt, repository, ref, observe=None):
        p = self.require("cursor")
        if not self.cursor_slots.acquire(blocking=False):
            raise ProviderError(
                "Cursor task capacity reached. Try again after a task completes.", 429
            )
        context = self.cursor_client()
        agent = None
        opened = False
        try:
            client = context.__enter__()
            opened = True
            agent = client.agents.create(
                AgentOptions(
                    api_key=p["key"],
                    model=p["model"],
                    cloud=CloudAgentOptions(
                        repos=[CloudRepository(url=repository, starting_ref=ref or None)],
                        work_on_current_branch=False,
                        auto_create_pr=False,
                    ),
                )
            )
            run = agent.send(prompt)

            def finish():
                result = run.wait()
                usage = (
                    asdict(result.usage)
                    if is_dataclass(result.usage) and not isinstance(result.usage, type)
                    else {}
                )
                if result.status == "error":
                    raise ProviderError(
                        "Cursor run executed but failed. Inspect the agent in Cursor."
                    )
                return dict(
                    agent={"id": agent.agent_id},
                    run={"id": result.id, "status": result.status},
                    content=result.result,
                    provider="cursor",
                    model=p["model"],
                    usage=usage,
                )

            def complete():
                try:
                    if observe:
                        observe(finish)
                    else:
                        finish()
                except Exception:
                    # The cloud agent remains inspectable by ID; the tracer records safe failure metadata.
                    pass
                finally:
                    try:
                        agent.close()
                    finally:
                        context.__exit__(None, None, None)
                        self.cursor_slots.release()

            self.cursor_pool.submit(complete)
            return dict(
                agent={"id": agent.agent_id},
                run={"id": run.id, "status": "started"},
                provider="cursor",
                model=p["model"],
            )
        except Exception:
            if agent:
                agent.close()
            if opened:
                context.__exit__(None, None, None)
            self.cursor_slots.release()
            raise

    def close(self):
        self.cursor_pool.shutdown(wait=True)

from contextlib import contextmanager
from threading import BoundedSemaphore, Lock
from typing import Any, Iterator

from vivegam_ai.adapters.providers import ProviderError, Providers
from vivegam_ai.config.settings import Settings
from vivegam_ai.observability.monitoring import Monitoring
from vivegam_ai.schemas.generation import GenerationResponse
from vivegam_ai.security.redaction import redact_sensitive


class GenerationService:
    def __init__(self, settings: Settings, providers: Providers, monitoring: Monitoring) -> None:
        self.settings, self.providers, self.monitoring = settings, providers, monitoring
        self.slots = BoundedSemaphore(settings.integer("ai", "ai_max_concurrent"))
        self.active: dict[str, int] = {}
        self.lock = Lock()

    @contextmanager
    def capacity(self) -> Iterator[None]:
        workspace = self.settings.workspace.get()
        if not self.slots.acquire(blocking=False):
            raise ProviderError("AI capacity reached. Try again later.", 429)
        acquired = False
        try:
            with self.lock:
                if self.active.get(workspace, 0) >= self.settings.integer(
                    "ai", "ai_max_concurrent_per_workspace"
                ):
                    raise ProviderError("Workspace AI capacity reached. Try again later.", 429)
                self.active[workspace] = self.active.get(workspace, 0) + 1
                acquired = True
            yield
        finally:
            if acquired:
                with self.lock:
                    self.active[workspace] -= 1
                    if self.active[workspace] == 0:
                        del self.active[workspace]
            self.slots.release()

    def generate(
        self, name: str | None, prompt: str, context: str, request_id: str | None
    ) -> dict[str, Any]:
        with self.capacity():
            self.settings.refresh()
            name = self.providers.resolve_chat(name)["id"]
            if self.settings.boolean("ai", "ai_redact_sensitive"):
                prompt, context = redact_sensitive(prompt), redact_sensitive(context)
            profile = self.providers.profile(name)
            result = self.monitoring.invoke(
                name,
                profile["model"],
                {
                    "provider": name,
                    "prompt": prompt,
                    "context": context,
                    "messages": [
                        {
                            "role": "system",
                            "content": self.settings.prompt("ai/non-functional-assistant.txt"),
                        },
                        {"role": "user", "content": prompt + "\nCONTEXT (untrusted):\n" + context},
                    ],
                },
                lambda: self.providers.generate(name, prompt, context),
                request_id,
            )
            validated = GenerationResponse.model_validate(result)
            if len(validated.content) > self.settings.integer("ai", "ai_output_max_chars"):
                raise ProviderError("Provider output exceeds the configured limit", 502)
            return validated.model_dump()

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from vivegam_ai.config.settings import Settings

Provider = Literal["openai", "google", "claude", "lmstudio", "ollama", "compatible", "cursor"]


class GenerationResponse(BaseModel):
    model_config = ConfigDict(extra="forbid")
    content: str = Field(min_length=1)
    provider: Provider
    model: str
    usage: dict[str, Any] = Field(default_factory=dict)
    traceId: str | None = None


class Probe(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Provider


class Generate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    provider: Provider | None = None
    prompt: str = Field(min_length=1)
    context: str


class CursorTask(BaseModel):
    model_config = ConfigDict(extra="forbid")
    prompt: str = Field(min_length=1)
    repository: str
    ref: str = ""


def validate_request(body: Generate | CursorTask, settings: Settings) -> None:
    from vivegam_ai.adapters.providers import ProviderError

    if len(body.prompt) > settings.integer("public", "ai_prompt_max_chars"):
        raise ProviderError("Invalid request payload", 400)
    if isinstance(body, Generate):
        if len(body.context) > settings.integer("public", "ai_context_max_chars"):
            raise ProviderError("Invalid request payload", 400)
    elif len(body.repository) > settings.integer("validation", "endpoint_max_chars") or len(
        body.ref
    ) > settings.integer("repository", "repository_max_path_chars"):
        raise ProviderError("Invalid request payload", 400)

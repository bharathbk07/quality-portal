import json
import sys
from pathlib import Path
from threading import Event, Thread
from unittest.mock import MagicMock

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend/ai/src"))
from vivegam_ai.config.settings import Settings
from vivegam_ai.adapters.providers import ProviderError
from vivegam_ai.services.generation import GenerationService
from vivegam_ai.security.redaction import redact_sensitive


def settings(**env):
    value = Settings(env={"AI_PROVIDER":"compatible", **env})
    value.refresh = lambda: None
    value.workspace.set("workspace-A")
    return value


def gateway(s):
    providers, monitor = MagicMock(), MagicMock()
    providers.profile.return_value = {"model":"test"}
    providers.resolve_chat.return_value = {"id":"compatible", "model":"test"}
    providers.generate.return_value = {"content":"draft", "provider":"compatible", "model":"test", "usage":{}}
    monitor.invoke.side_effect = lambda name, model, inputs, operation, request_id: operation()
    return GenerationService(s, providers, monitor), providers, monitor


def test_offline_prompt_safety_and_redaction_cases():
    suite = json.loads((ROOT / "prompts/evaluations/safety-cases.json").read_text())
    prompt = settings().prompt("ai/non-functional-assistant.txt")
    for instruction in suite["requiredInstructions"]:
        assert instruction in prompt
    for case in suite["redactionCases"]:
        assert case["forbidden"] not in redact_sensitive(case["input"])


def test_provider_and_trace_receive_redacted_values():
    service, providers, monitor = gateway(settings())
    service.generate(None, "email tester@example.com", "api_key=secret-value", None)
    args = providers.generate.call_args.args
    assert "tester@example.com" not in args[1]
    assert "secret-value" not in args[2]
    assert "tester@example.com" not in str(monitor.invoke.call_args)


def test_private_keys_are_removed_as_a_whole():
    assert "hidden-key-data" not in redact_sensitive("-----BEGIN PRIVATE KEY-----\nhidden-key-data\n-----END PRIVATE KEY-----")


def test_capacity_is_bounded_and_released_after_failures():
    service, providers, _ = gateway(settings(AI_MAX_CONCURRENT="1", AI_MAX_CONCURRENT_PER_WORKSPACE="1"))
    entered, release = Event(), Event()
    def hold():
        with service.capacity():
            entered.set()
            release.wait(5)
    thread = Thread(target=hold)
    thread.start()
    assert entered.wait(5)
    try:
        with pytest.raises(ProviderError) as error:
            service.generate(None, "test", "", None)
        assert error.value.status == 429
    finally:
        release.set()
        thread.join(5)
    providers.generate.side_effect = RuntimeError("private upstream exception")
    with pytest.raises(RuntimeError):
        service.generate(None, "test", "", None)
    providers.generate.side_effect = None
    assert service.generate(None, "test", "", None)["content"] == "draft"


def test_output_size_and_contract_are_enforced():
    service, providers, _ = gateway(settings(AI_OUTPUT_MAX_CHARS="4"))
    with pytest.raises(ProviderError) as error:
        service.generate(None, "test", "", None)
    assert error.value.status == 502
    providers.generate.return_value = {"content":"ok", "model":"test", "usage":{}}
    with pytest.raises(ValueError):
        service.generate(None, "test", "", None)


def test_prompt_path_cannot_escape_prompt_directory():
    with pytest.raises(ValueError):
        settings().prompt("../.env")


def test_quoted_json_credentials_and_nested_trace_values_are_redacted():
    from vivegam_ai.security.redaction import redact_payload
    cleaned = redact_sensitive('{"password":"private-password","client_secret": "private-client-secret"}')
    assert "private-password" not in cleaned
    assert "private-client-secret" not in cleaned
    assert json.loads(cleaned)["password"] == "[REDACTED]"
    result = redact_payload({"api_key":"top-level-secret", "outputs":[{"email":"person@example.com"}]})
    assert "top-level-secret" not in str(result)
    assert "person@example.com" not in str(result)


def test_default_chat_resolves_configured_google_but_explicit_provider_does_not_fallback():
    from vivegam_ai.adapters.providers import Providers
    s = settings()
    s.runtime = {"GOOGLE_API_KEY":"test-secret", "GOOGLE_MODEL":"test-model", "AI_PROVIDER":"compatible"}
    p = Providers(s)
    try:
        assert p.profile("google")["configured"]
        assert p.resolve_chat()["id"] == "google"
        assert p.resolve_chat("compatible")["id"] == "compatible"
        assert not p.resolve_chat("compatible")["configured"]
        s.runtime = {"AI_PROVIDER":"google", "GOOGLE_API_KEY":"test-secret", "GOOGLE_MODEL":"test-model", "GOOGLE_BASE_URL":"https://unapproved.example"}
        assert not p.profile("google")["configured"]
        assert "blocked" in p.profile("google")["issue"]
    finally:
        p.close()

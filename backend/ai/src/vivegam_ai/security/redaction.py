"""Deterministic redaction of common PII and credentials before provider and trace delivery.
This is a defense in depth filter, not a guarantee of complete PII detection.
"""

import re
from typing import Any

PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    (
        re.compile(r"-----BEGIN [^-]*PRIVATE KEY-----.*?-----END [^-]*PRIVATE KEY-----", re.S),
        "[REDACTED PRIVATE KEY]",
    ),
    (re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b"), "[REDACTED EMAIL]"),
    (re.compile(r"\b\d{3}-\d{2}-\d{4}\b"), "[REDACTED SSN]"),
    (re.compile(r"(?i)(?:bearer\s+)[A-Za-z0-9._~+/=-]+"), "Bearer [REDACTED]"),
    (
        re.compile(
            r"(?i)((?:password|api[_-]?key|access[_-]?token|client[_-]?secret)[\"']?\s*[:=]\s*[\"']?)[^\s,\"'}]+"
        ),
        r"\1[REDACTED]",
    ),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{12,}\b"), "[REDACTED API KEY]"),
)


def redact_sensitive(text: str) -> str:
    for pattern, replacement in PATTERNS:
        text = pattern.sub(replacement, text)
    return text


def redact_payload(value: Any) -> Any:
    if isinstance(value, str):
        return redact_sensitive(value)
    if isinstance(value, dict):
        sensitive_keys = {"password", "api_key", "apikey", "access_token", "client_secret"}
        return {
            key: "[REDACTED]" if str(key).lower() in sensitive_keys else redact_payload(item)
            for key, item in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [redact_payload(item) for item in value]
    return value

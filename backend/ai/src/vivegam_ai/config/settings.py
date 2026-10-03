import configparser
import os
from contextvars import ContextVar
from pathlib import Path
from urllib.parse import urlsplit

import httpx


class Settings:
    def __init__(self, env=None, path=None):
        self.env = os.environ if env is None else env
        self._runtime: ContextVar[dict[str, str]] = ContextVar("runtime", default={})
        self.workspace = ContextVar("workspace", default="")
        self.ini = configparser.ConfigParser(interpolation=None)
        filename = (
            path
            or self.env.get("CONFIG_FILE")
            or Path(__file__).resolve().parents[5] / "deployment/configuration.ini"
        )
        if not self.ini.read(filename):
            raise RuntimeError("Configuration file is unavailable")

    def prompt(self, name: str) -> str:
        directory = Path(
            self.env.get("PROMPTS_DIR") or Path(__file__).resolve().parents[5] / "prompts"
        )
        file = (directory / name).resolve()
        if not file.is_relative_to(directory.resolve()):
            raise ValueError("Invalid prompt path")
        return file.read_text(encoding="utf-8").strip()

    @property
    def runtime(self):
        return self._runtime.get()

    @runtime.setter
    def runtime(self, values):
        self._runtime.set(values)

    def get(self, section: str, key: str) -> str:
        if key.upper() in self.runtime:
            return self.runtime[key.upper()]
        return str(self.env.get(key.upper()) or self.ini.get(section, key, fallback=""))

    def integer(self, section: str, key: str) -> int:
        value = int(self.get(section, key))
        if value < 0:
            raise ValueError(f"Invalid configuration: {key}")
        return value

    def secret(self, key: str) -> str:
        return self.runtime.get(key, self.env.get(key, ""))

    def refresh(self) -> None:
        base = validate_url(self.get("services", "settings_service_url"))
        with httpx.Client(
            timeout=self.integer("timeouts", "service_ms") / 1000, follow_redirects=False
        ) as client:
            response = client.get(
                base.rstrip("/") + "/settings/runtime",
                headers={
                    "x-service-token": self.secret("SERVICE_TOKEN"),
                    "x-workspace-id": self.workspace.get(),
                },
            )
            response.raise_for_status()
            data = response.json()
        if not isinstance(data.get("values"), dict) or any(
            not isinstance(k, str) or not isinstance(v, str) for k, v in data["values"].items()
        ):
            raise ValueError("Invalid runtime connection configuration")
        self.runtime = data["values"]

    def boolean(self, section: str, key: str) -> bool:
        return self.get(section, key).lower() == "true"


def validate_url(url: str) -> str:
    parsed = urlsplit(url)
    if (
        parsed.scheme not in ("http", "https")
        or not parsed.hostname
        or parsed.username
        or parsed.password
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError("Invalid configured provider URL")
    return url

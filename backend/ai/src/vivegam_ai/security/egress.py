"""Backend-only, operator-managed destination policy and bounded SDK transports."""

from urllib.parse import urlsplit

import httpx
import httpx2
import requests


def validate_egress(url, settings):
    parsed = urlsplit(str(url))
    host = (parsed.hostname or "").lower()
    allowed = [x.strip().lower() for x in settings.get("egress", "allowed_hosts").split(",")]
    http_hosts = [x.strip().lower() for x in settings.get("egress", "http_hosts").split(",")]

    def matches(entry):
        return (
            host.endswith(entry[1:]) and host != entry[2:]
            if entry.startswith("*.")
            else host == entry
        )

    if (
        parsed.scheme not in ("http", "https")
        or parsed.username
        or parsed.password
        or parsed.fragment
        or not any(matches(x) for x in allowed)
    ):
        raise ValueError("Destination is not permitted by backend egress policy")
    if parsed.scheme == "http" and host not in http_hosts:
        raise ValueError("This destination requires HTTPS")
    return str(url)


class LimitedStream(httpx.SyncByteStream):
    def __init__(self, stream, limit):
        self.stream, self.limit = stream, limit

    def __iter__(self):
        total = 0
        for chunk in self.stream:
            total += len(chunk)
            if total > self.limit:
                self.close()
                raise ValueError("Adapter response exceeds configured limit")
            yield chunk

    def close(self):
        self.stream.close()


class EgressTransport(httpx.BaseTransport):
    def __init__(self, settings):
        self.settings = settings
        self.transport = httpx.HTTPTransport(retries=0)

    def handle_request(self, request):
        validate_egress(request.url, self.settings)
        response = self.transport.handle_request(request)
        response.stream = LimitedStream(
            response.stream, self.settings.integer("egress", "response_max_bytes")
        )
        return response

    def close(self):
        self.transport.close()


def sdk_http_client(settings, timeout):
    return httpx.Client(
        transport=EgressTransport(settings),
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
    )


class EgressSession(requests.Session):
    def __init__(self, settings):
        super().__init__()
        self.settings = settings
        self.trust_env = False

    def send(self, request, **kwargs):
        validate_egress(request.url, self.settings)
        kwargs["allow_redirects"] = False
        return super().send(request, **kwargs)


class LimitedStream2(httpx2.SyncByteStream):
    def __init__(self, stream, limit):
        self.wrapped = LimitedStream(stream, limit)

    def __iter__(self):
        yield from self.wrapped

    def close(self):
        self.wrapped.close()


class EgressTransport2(httpx2.BaseTransport):
    def __init__(self, settings):
        self.settings = settings
        self.transport = httpx2.HTTPTransport(retries=0)

    def handle_request(self, request):
        validate_egress(request.url, self.settings)
        response = self.transport.handle_request(request)
        response.stream = LimitedStream2(
            response.stream, self.settings.integer("egress", "response_max_bytes")
        )
        return response

    def close(self):
        self.transport.close()


def anthropic_http_client(settings, timeout):
    return httpx2.Client(
        transport=EgressTransport2(settings),
        timeout=timeout,
        follow_redirects=False,
        trust_env=False,
    )

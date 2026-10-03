from concurrent.futures import ThreadPoolExecutor
from contextvars import copy_context
from datetime import datetime, timezone
from hashlib import sha256
from threading import BoundedSemaphore
from uuid import uuid4

from langsmith import Client
from urllib3.util.retry import Retry

from vivegam_ai.security.egress import EgressSession, validate_egress
from vivegam_ai.security.redaction import redact_payload


class Monitoring:
    """Bounded background SDK delivery; tracing failures do not fail generation."""

    def __init__(self, settings):
        self.s = settings
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="langsmith")
        self.slots = BoundedSemaphore(settings.integer("langsmith", "langsmith_max_pending"))
        self.traces = {}

    @property
    def last_trace(self):
        return self.traces.get(self.s.workspace.get())

    def status(self):
        s = self.s
        configured = bool(
            s.secret("LANGSMITH_API_KEY")
            and s.get("langsmith", "langsmith_endpoint")
            and s.get("langsmith", "langsmith_project")
        )
        issue = None
        if not configured:
            issue = "API key, API endpoint and project are required"
        elif configured:
            try:
                validate_egress(s.get("langsmith", "langsmith_endpoint"), s)
            except ValueError:
                configured = False
                issue = "Tracing API endpoint is blocked by the server egress policy"
        return dict(
            issue=issue,
            enabled=s.boolean("langsmith", "langsmith_tracing"),
            configured=configured,
            project=s.get("langsmith", "langsmith_project"),
            captureContent=s.boolean("langsmith", "langsmith_capture_content"),
            uiUrl=s.get("langsmith", "langsmith_ui_url"),
            lastTrace=self.traces.get(s.workspace.get()),
        )

    def invoke(self, provider, model, inputs, operation, request_id, agent=False):
        status = self.status()
        trace_id = uuid4()
        request_id = request_id or str(uuid4())
        start = datetime.now(timezone.utc)
        output, error = {}, None
        try:
            output = operation()
            return {**output, "traceId": str(trace_id) if status["enabled"] else None}
        except Exception as exc:
            # Never export raw SDK exceptions: they may contain URLs, prompts or credentials.
            error = type(exc).__name__
            raise
        finally:
            if status["enabled"]:
                raw_usage = output.get("usage", {})
                input_tokens = (
                    raw_usage.get(
                        "input_tokens",
                        raw_usage.get("prompt_tokens", raw_usage.get("prompt_token_count", 0)),
                    )
                    or 0
                )
                output_tokens = (
                    raw_usage.get(
                        "output_tokens",
                        raw_usage.get(
                            "completion_tokens", raw_usage.get("candidates_token_count", 0)
                        ),
                    )
                    or 0
                )
                usage_metadata = {
                    "input_tokens": input_tokens,
                    "output_tokens": output_tokens,
                    "total_tokens": input_tokens + output_tokens,
                }
                run = dict(
                    id=trace_id,
                    name="portal." + provider,
                    trace_id=trace_id,
                    tags=[
                        "vivegam",
                        provider,
                        "content-captured" if status["captureContent"] else "metadata-only",
                    ],
                    run_type="chain" if agent else "llm",
                    inputs=redact_payload(inputs)
                    if status["captureContent"]
                    else {"redacted": True},
                    outputs={
                        **(
                            redact_payload(output)
                            if status["captureContent"]
                            else {"redacted": True}
                        ),
                        "usage_metadata": usage_metadata,
                    },
                    start_time=start,
                    end_time=datetime.now(timezone.utc),
                    error=error,
                    extra={
                        "metadata": {
                            "ls_provider": provider,
                            "ls_model_name": model,
                            "prompt_version": sha256(
                                (
                                    self.s.prompt("ai/non-functional-assistant.txt")
                                    + "\n"
                                    + str(inputs.get("prompt", ""))
                                ).encode()
                            ).hexdigest(),
                            "workspace_id": self.s.workspace.get(),
                            "content_capture": status["captureContent"],
                            "request_id": request_id,
                            "usage": output.get("usage", {}),
                        },
                        "invocation_params": {"model": model},
                    },
                )
                if status["configured"] and self.slots.acquire(blocking=False):
                    self.traces[self.s.workspace.get()] = {
                        "id": str(trace_id),
                        "requestId": request_id,
                        "status": "queued",
                        "captureContent": status["captureContent"],
                    }
                    self.executor.submit(copy_context().run, self.deliver, run)
                else:
                    self.traces[self.s.workspace.get()] = {
                        "id": str(trace_id),
                        "requestId": request_id,
                        "status": "failed",
                        "reason": "queue_full_or_not_configured",
                    }

    def deliver(self, run):
        try:
            s = self.s
            session = EgressSession(s)
            validate_egress(s.get("langsmith", "langsmith_endpoint"), s)
            client = Client(
                session=session,
                api_url=s.get("langsmith", "langsmith_endpoint"),
                api_key=s.secret("LANGSMITH_API_KEY"),
                workspace_id=s.secret("LANGSMITH_WORKSPACE_ID") or None,
                auto_batch_tracing=False,
                timeout_ms=s.integer("timeouts", "langsmith_ms"),
                retry_config=Retry(total=0),
            )
            try:
                # Separate SDK create/update guarantees that failures carry an end timestamp.
                client.create_run(
                    name=run["name"],
                    inputs=run["inputs"],
                    run_type=run["run_type"],
                    project_name=s.get("langsmith", "langsmith_project"),
                    id=run["id"],
                    start_time=run["start_time"],
                    extra=run["extra"],
                    trace_id=run["trace_id"],
                    tags=run["tags"],
                )
                client.update_run(
                    run["id"],
                    end_time=run["end_time"],
                    outputs=run["outputs"],
                    error=run["error"],
                    extra=run["extra"],
                    trace_id=run["trace_id"],
                )
            finally:
                client.close()
                session.close()
            self.complete(run, "delivered")
        except Exception as exc:
            self.complete(run, "failed", type(exc).__name__)
        finally:
            self.slots.release()

    def complete(self, run, status, reason=None):
        workspace = self.s.workspace.get()
        current = self.traces.get(workspace, {})
        if current.get("id") == str(run["id"]):
            self.traces[workspace] = {
                **current,
                "status": status,
                **({"reason": reason} if reason else {}),
            }

    def close(self):
        self.executor.shutdown(wait=True)

from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import BoundedSemaphore
from uuid import uuid4
from langsmith import Client
from urllib3.util.retry import Retry


class Monitoring:
    """Bounded background SDK delivery; tracing failures do not fail generation."""
    def __init__(self, settings):
        self.s = settings
        self.executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix='langsmith')
        self.slots = BoundedSemaphore(settings.integer('langsmith', 'langsmith_max_pending'))
        self.last_trace = None

    def status(self):
        s = self.s
        return dict(enabled=s.boolean('langsmith', 'langsmith_tracing'),
                    configured=bool(s.secret('LANGSMITH_API_KEY') and s.get('langsmith', 'langsmith_endpoint') and s.get('langsmith', 'langsmith_project')),
                    project=s.get('langsmith', 'langsmith_project'), captureContent=s.boolean('langsmith', 'langsmith_capture_content'),
                    uiUrl=s.get('langsmith', 'langsmith_ui_url'), lastTrace=self.last_trace)

    def invoke(self, provider, model, inputs, operation, request_id, agent=False):
        status = self.status()
        trace_id = uuid4()
        start = datetime.now(timezone.utc)
        output, error = {}, None
        try:
            output = operation()
            return {**output, 'traceId': str(trace_id) if status['enabled'] else None}
        except Exception as exc:
            # Never export raw SDK exceptions: they may contain URLs, prompts or credentials.
            error = type(exc).__name__
            raise
        finally:
            if status['enabled']:
                raw_usage = output.get('usage', {})
                input_tokens = raw_usage.get('input_tokens', raw_usage.get('prompt_tokens', raw_usage.get('prompt_token_count', 0))) or 0
                output_tokens = raw_usage.get('output_tokens', raw_usage.get('completion_tokens', raw_usage.get('candidates_token_count', 0))) or 0
                usage_metadata = {'input_tokens': input_tokens, 'output_tokens': output_tokens, 'total_tokens': input_tokens + output_tokens}
                run = dict(id=trace_id, name='portal.' + provider, run_type='chain' if agent else 'llm',
                           inputs=inputs if status['captureContent'] else {'redacted': True},
                           outputs={**(output if status['captureContent'] else {'redacted': True}), 'usage_metadata': usage_metadata},
                           start_time=start, end_time=datetime.now(timezone.utc), error=error,
                           extra={'metadata': {'ls_provider': provider, 'ls_model_name': model,
                                   'request_id': request_id, 'usage': output.get('usage', {})},
                                  'invocation_params': {'model': model}})
                if status['configured'] and self.slots.acquire(blocking=False):
                    self.last_trace = {'id': str(trace_id), 'status': 'queued'}
                    self.executor.submit(self.deliver, run)
                else:
                    self.last_trace = {'id': str(trace_id), 'status': 'failed'}

    def deliver(self, run):
        try:
            s = self.s
            client = Client(api_url=s.get('langsmith', 'langsmith_endpoint'), api_key=s.secret('LANGSMITH_API_KEY'),
                        workspace_id=s.secret('LANGSMITH_WORKSPACE_ID') or None, auto_batch_tracing=False,
                        timeout_ms=s.integer('timeouts', 'langsmith_ms'), retry_config=Retry(total=0))
            try:
                # Separate SDK create/update guarantees that failures carry an end timestamp.
                client.create_run(name=run['name'], inputs=run['inputs'], run_type=run['run_type'],
                                  project_name=s.get('langsmith', 'langsmith_project'), id=run['id'],
                                  start_time=run['start_time'], extra=run['extra'])
                client.update_run(run['id'], end_time=run['end_time'], outputs=run['outputs'], error=run['error'], extra=run['extra'])
            finally:
                client.close()
            self.last_trace = {'id': str(run['id']), 'status': 'delivered'}
        except Exception:
            self.last_trace = {'id': str(run['id']), 'status': 'failed'}
        finally:
            self.slots.release()

    def close(self):
        self.executor.shutdown(wait=True)

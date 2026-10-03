import json
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest.mock import MagicMock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'services/ai'))
from config import Settings
from providers import Providers, ProviderError
from monitoring import Monitoring
from main import build_app
from fastapi.testclient import TestClient


class Handler(BaseHTTPRequestHandler):
    requests = []
    fail = False

    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{}')

    def do_PATCH(self):
        return self.do_POST()

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))))
        self.requests.append((self.path, {k.lower():v for k,v in self.headers.items()}, body))
        if self.fail:
            self.send_response(503)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{"error":{"message":"private-provider-details"}}')
            return
        if self.path == '/v1/messages':
            data = {'id':'msg_test','type':'message','role':'assistant','model':'test-model','content':[{'type':'text','text':'SDK draft'}],
                    'stop_reason':'end_turn','usage':{'input_tokens':7,'output_tokens':3}}
        elif ':generateContent' in self.path:
            data = {'candidates':[{'content':{'role':'model','parts':[{'text':'SDK draft'}]},'finishReason':'STOP'}],
                    'usageMetadata':{'promptTokenCount':7,'candidatesTokenCount':3,'totalTokenCount':10}}
        elif self.path == '/api/chat':
            data = {'model':'test-model','created_at':'2026-01-01T00:00:00Z','message':{'role':'assistant','content':'SDK draft'},'done':True,'prompt_eval_count':7,'eval_count':3}
        else:
            data = {'id':'test','object':'chat.completion','created':1,'model':'test-model','choices':[{'index':0,'finish_reason':'stop','message':{'role':'assistant','content':'SDK draft'}}],
                    'usage':{'prompt_tokens':7,'completion_tokens':3,'total_tokens':10}}
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())


class AITests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        cls.worker = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.worker.start()
        cls.base = f'http://127.0.0.1:{cls.server.server_port}'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def settings(self, **overrides):
        s = Settings(env={'SERVICE_TOKEN':'internal-test-token','AI_PROVIDER':'compatible',**overrides})
        s.refresh = lambda: None
        return s

    def setUp(self):
        Handler.requests.clear()
        Handler.fail = False

    def test_direct_sdks_native_payloads_and_usage(self):
        for name in ['openai','google','claude','lmstudio','ollama','compatible']:
            with self.subTest(provider=name):
                base = self.base + ('/v1' if name in ('openai','lmstudio','compatible') else '')
                settings = self.settings(**{name.upper()+'_BASE_URL':base,name.upper()+'_MODEL':'test-model',name.upper()+'_API_KEY':'server-only-secret'})
                result = Providers(settings).generate(name, 'Draft performance plan', 'untrusted data')
                self.assertEqual(result['content'], 'SDK draft')
                self.assertTrue(result['usage'])
                path, headers, body = Handler.requests[-1]
                self.assertNotIn('server-only-secret', json.dumps(result))
                if name == 'google':
                    self.assertIn(':generateContent', path)
                    self.assertIn('contents', body)
                elif name == 'claude':
                    self.assertEqual(path, '/v1/messages')
                    self.assertEqual(headers.get('x-api-key'), 'server-only-secret')
                    self.assertEqual(body['max_tokens'], 4096)
                elif name == 'ollama':
                    self.assertEqual(path, '/api/chat')
                else:
                    self.assertEqual(path, '/v1/chat/completions')

    def test_local_no_key_legacy_config_and_unknown_provider(self):
        p = Providers(self.settings(AI_BASE_URL=self.base+'/v1',AI_MODEL='test-model'))
        self.assertEqual(p.generate('compatible','Plan','')['content'],'SDK draft')
        self.assertFalse(p.profile('claude')['configured'])
        with self.assertRaises(ProviderError):
            p.profile('unknown')
        p = Providers(self.settings(LMSTUDIO_BASE_URL='file:///secret',LMSTUDIO_MODEL='test'))
        self.assertFalse(p.profile('lmstudio')['configured'])

    def test_api_auth_validation_and_sanitized_errors(self):
        s = self.settings(AI_BASE_URL=self.base+'/v1',AI_MODEL='test-model')
        monitor = Monitoring(s)
        with TestClient(build_app(s,monitoring=monitor), raise_server_exceptions=False) as client:
            self.assertEqual(client.get('/ai/status').status_code,401)
            headers={'x-service-token':'internal-test-token'}
            self.assertNotIn('server-only-secret',client.get('/ai/status',headers=headers).text)
            self.assertEqual(client.post('/ai/generate',headers=headers,json={'prompt':'test'}).status_code,400)
            self.assertEqual(client.post('/ai/generate',headers=headers,json={'prompt':'x','context':'','provider':'unknown'}).status_code,400)
            self.assertEqual(client.post('/ai/cursor/agents',headers=headers,json={'prompt':'x','repository':'https://user:secret@example.com/repo'}).status_code,400)
            Handler.fail=True
            r=client.post('/ai/generate',headers=headers,json={'prompt':'x','context':''})
            self.assertEqual(r.status_code,502)
            self.assertNotIn('private-provider-details',r.text)

    def test_langsmith_sdk_redaction_failure_and_usage(self):
        for fail in [False,True]:
            with self.subTest(delivery_failure=fail):
                s=self.settings(LANGSMITH_TRACING='true',LANGSMITH_API_KEY='trace-secret')
                monitor=Monitoring(s)
                client=MagicMock()
                if fail: client.create_run.side_effect=RuntimeError('offline')
                with patch('monitoring.Client',return_value=client):
                    output=monitor.invoke('google','test-model',{'prompt':'sensitive'},lambda:{'content':'private output','usage':{'input_tokens':7}},'request-123')
                    monitor.close()
                self.assertTrue(output['traceId'])
                args=client.create_run.call_args.kwargs
                self.assertEqual(args['inputs'],{'redacted':True})
                self.assertEqual(args['extra']['metadata']['usage']['input_tokens'],7)
                self.assertEqual(monitor.last_trace['status'],'failed' if fail else 'delivered')
                if not fail:self.assertTrue(client.update_run.call_args.kwargs['outputs']['redacted'])

    def test_real_langsmith_sdk_http_delivery(self):
        s=self.settings(LANGSMITH_TRACING='true',LANGSMITH_API_KEY='trace-secret',LANGSMITH_ENDPOINT=self.base)
        monitor=Monitoring(s)
        monitor.invoke('openai','configured-model',{'prompt':'hidden'},lambda:{'content':'hidden','usage':{'prompt_tokens':7,'completion_tokens':3}},'request')
        monitor.close()
        self.assertEqual(monitor.last_trace['status'],'delivered')
        calls=[entry for entry in Handler.requests if entry[0].startswith('/runs')]
        self.assertEqual(len(calls),2)
        self.assertEqual(calls[0][1]['x-api-key'],'trace-secret')
        self.assertEqual(calls[1][2]['outputs']['usage_metadata']['total_tokens'],10)
        self.assertNotIn('hidden',json.dumps(calls))

    def test_runtime_settings_refresh_supersedes_optional_environment(self):
        s=Settings(env={'SERVICE_TOKEN':'internal-test-token','OPENAI_API_KEY':'legacy-secret'})
        response=MagicMock();response.json.return_value={'values':{'OPENAI_API_KEY':'saved-secret','OPENAI_MODEL':'db-model','OPENAI_BASE_URL':'http://local.example/v1'}}
        with patch('config.httpx.Client') as client:
            client.return_value.__enter__.return_value.get.return_value=response
            s.refresh()
        self.assertEqual(s.secret('OPENAI_API_KEY'),'saved-secret')
        self.assertEqual(s.get('ai_openai','openai_model'),'db-model')
        response.json.return_value={'values':{'OPENAI_API_KEY':''}}
        with patch('config.httpx.Client') as client:
            client.return_value.__enter__.return_value.get.return_value=response
            s.refresh()
        self.assertEqual(s.secret('OPENAI_API_KEY'),'')

    def test_trace_provider_error_is_completed_without_raw_details(self):
        s=self.settings(LANGSMITH_TRACING='true',LANGSMITH_API_KEY='trace-secret',LANGSMITH_CAPTURE_CONTENT='true')
        monitor=Monitoring(s);client=MagicMock()
        def fail():raise RuntimeError('secret provider response')
        with patch('monitoring.Client',return_value=client):
            with self.assertRaises(RuntimeError):monitor.invoke('claude','model',{'prompt':'test'},fail,'request')
            monitor.close()
        self.assertEqual(client.update_run.call_args.kwargs['error'],'RuntimeError')
        self.assertIsNotNone(client.update_run.call_args.kwargs['end_time'])

    def test_cursor_sdk_cloud_runtime_and_cleanup(self):
        s=self.settings(CURSOR_MODEL='configured-model',CURSOR_API_KEY='cursor-secret')
        p=Providers(s);client=MagicMock();agent=MagicMock();run=MagicMock()
        client.__enter__.return_value=client
        client.agents.create.return_value=agent
        agent.send.return_value=run
        run.wait.return_value.id='run-test';run.wait.return_value.status='finished';run.wait.return_value.result='Analysis'
        agent.agent_id='bc-test';run.id='run-test'
        with patch('providers.CursorClient.launch_bridge',return_value=client):
            result=p.cursor_task('Review repository','https://github.com/org/repo','main')
            p.close()
        opts=client.agents.create.call_args.args[0]
        self.assertIsNone(opts.local)
        self.assertEqual(opts.cloud.repos[0].starting_ref,'main')
        self.assertFalse(opts.cloud.auto_create_pr)
        run.wait.assert_called_once()
        client.__exit__.assert_called_once()
        self.assertEqual(result['run']['status'],'started')
        agent.close.assert_called_once()


if __name__ == '__main__':
    unittest.main()

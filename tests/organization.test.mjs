import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {renderPrompt} from '../backend/shared/prompts.mjs';
import {value} from '../backend/shared/config.mjs';
test('API routes keep SQL in repositories and prompt templates outside logic', async()=> {
 for(const file of ['backend/core/app.mjs','backend/identity/routes.mjs','backend/mapping/routes.mjs']) {
  const source=await readFile(file,'utf8');
  assert.doesNotMatch(source,/\.query\s*\(/,file+' contains a database query');
 }
 assert.match(renderPrompt('ai/test-plan.txt',{scope:'performance'}),/performance plan/);
 assert.throws(()=>renderPrompt('../.env'),/Invalid prompt path/);
 assert.throws(()=>renderPrompt('ai/test-plan.txt'),/Missing prompt parameter/);
});
test('INI preserves the complete CSP and timeout settings',()=> {
 assert.match(value('frontend_delivery','content_security_policy'),/script-src/);
 assert.match(value('frontend_delivery','content_security_policy'),/frame-ancestors/);
 assert.ok(Number(value('public','api_timeout_ms'))>0);
});

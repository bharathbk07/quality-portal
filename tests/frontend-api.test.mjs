import test from 'node:test';
import assert from 'node:assert/strict';
import {apiFetch, configureApi, rememberSession} from '../frontend/src/shared/api/client.ts';
test('protected 401s invalidate the session; incorrect login credentials stay on the form', async t=> {
 const original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original;configureApi(1000);});
 let expired=0;
 configureApi(1000,()=>{expired++;});
 globalThis.fetch=async()=>Response.json({error:'Sign in'}, {status:401});
 await apiFetch('/api/maps');
 assert.equal(expired,1);
 await apiFetch('/api/session',{method:'POST'});
 assert.equal(expired,1);
});
test('API mutations stay same-origin and carry the in-memory CSRF token', async t=> {
 const original=globalThis.fetch;
 t.after(()=>{globalThis.fetch=original;configureApi(1000);});
 let sent;
 configureApi(1000);
 rememberSession({csrfToken:'test-csrf'});
 globalThis.fetch=async(path,options)=>{sent={path,options};return Response.json({ok:true});};
 await apiFetch('/api/plans',{method:'POST',body:'{}'});
 assert.equal(sent.options.credentials,'same-origin');
 assert.equal(sent.options.headers.get('x-csrf-token'),'test-csrf');
 assert.equal(sent.options.cache,'no-store');
 await apiFetch('/api/session',{method:'DELETE'});
 assert.equal(sent.options.headers.get('x-csrf-token'),'test-csrf');
 await assert.rejects(()=>apiFetch('https://external.example/api'),/portal API/);
});

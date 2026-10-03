import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {encryptSettings,decryptSettings,encryptionKey,createSettingsStore,registerSettingsRoutes} from '../services/settings/store.mjs';
import {createService} from '../services/shared/http.mjs';
import {buildBff} from '../services/bff/app.mjs';

const env={SETTINGS_ENCRYPTION_KEY:randomBytes(32).toString('base64')};
function database(){
  const saved=new Map();
  return {saved,async query(sql,args){
    if(sql.startsWith('SELECT'))return {rows:args?[saved.get(args[0])].filter(Boolean):[...saved.values()]};
    if(sql.startsWith('INSERT')){const [id,ciphertext,iv,tag,version]=args,old=saved.get(id);if(old&&old.version!==version)return {rows:[]};const row={id,ciphertext,iv,tag,version:(old?.version||0)+1,updated_at:new Date().toISOString()};saved.set(id,row);return {rows:[{version:row.version}]};}
    throw new Error('Unexpected SQL');
  }};
}

test('AES-256-GCM encrypts every setting with a fresh nonce; tampering, wrong keys and row substitution fail',()=>{
  const key=encryptionKey(env),values={OPENAI_API_KEY:'test-private-key',OPENAI_MODEL:'test-model'};
  const a=encryptSettings('openai',values,key),b=encryptSettings('openai',values,key);
  assert.notEqual(a.iv,b.iv);assert.ok(!JSON.stringify(a).includes('test-private-key'));assert.ok(!JSON.stringify(a).includes('test-model'));
  assert.deepEqual(decryptSettings({id:'openai',...a},key),values);
  assert.throws(()=>decryptSettings({id:'google',...a},key));
  assert.throws(()=>decryptSettings({id:'openai',...a},randomBytes(32)));
  const bad=Buffer.from(a.ciphertext,'base64');bad[0]^=1;
  assert.throws(()=>decryptSettings({id:'openai',...a,ciphertext:bad.toString('base64')},key));
  assert.throws(()=>encryptionKey({}));
});

test('public settings mask saved secrets, preserve omitted secrets, clear explicitly, and reject stale writes',async()=>{
  const db=database(),store=createSettingsStore(db,env);
  await store.save('openai',{version:0,values:{OPENAI_MODEL:'configured-model',OPENAI_API_KEY:'test-private-key'}});
  const view=await store.list();assert.ok(!JSON.stringify(view).includes('test-private-key'));
  const fields=view.groups.find(g=>g.id==='openai').fields;
  assert.equal(fields.find(f=>f.key==='OPENAI_API_KEY').hasValue,true);
  assert.equal((await store.runtime()).OPENAI_API_KEY,'test-private-key');
  assert.ok(!JSON.stringify([...db.saved.values()]).includes('configured-model'));
  await store.save('openai',{version:1,values:{OPENAI_MODEL:'updated-model'}});
  assert.equal((await store.runtime()).OPENAI_API_KEY,'test-private-key');
  await assert.rejects(store.save('openai',{version:1,values:{OPENAI_MODEL:'stale'}}),e=>e.statusCode===409);
  await store.save('openai',{version:2,values:{OPENAI_API_KEY:null}});
  assert.equal((await store.runtime()).OPENAI_API_KEY,'');
  await assert.rejects(store.save('openai',{version:3,values:{SERVICE_TOKEN:'injected'}}));
  await assert.rejects(store.save('openai',{version:3,values:{OPENAI_BASE_URL:'https://key:password@example.test'}}));
  await assert.rejects(store.save('langsmith',{version:0,values:{LANGSMITH_TRACING:'invalid'}}));
});

test('settings APIs require internal authentication, validate writes and return no-store masked responses',async t=>{
  const app=createService('test',{secret:'internal-test',logger:false});registerSettingsRoutes(app,database(),env);t.after(()=>app.close());
  assert.equal((await app.inject('/settings/runtime')).statusCode,401);
  const headers={'x-service-token':'internal-test'};
  const write=await app.inject({method:'PUT',url:'/settings/google',headers,payload:{version:0,values:{GOOGLE_API_KEY:'hidden-test-key',GOOGLE_MODEL:'test-model'}}});assert.equal(write.statusCode,200);
  const view=await app.inject({url:'/settings',headers});assert.ok(!view.body.includes('hidden-test-key'));
  assert.equal((await app.inject({url:'/settings/runtime',headers})).json().values.GOOGLE_API_KEY,'hidden-test-key');
  assert.equal((await app.inject({url:'/settings/runtime',headers})).headers['cache-control'],'no-store');
  assert.equal((await app.inject({method:'PUT',url:'/settings/google',headers,payload:{values:{}}})).statusCode,400);
});

test('BFF never exposes decrypted runtime settings and requires sessions for settings forms',async t=>{
  const app=await buildBff({logger:false,env:{ADMIN_PASSWORD:'test-password',SESSION_SECRET:'test-session-secret',PUBLIC_ORIGINS:'http://localhost:8088'}});t.after(()=>app.close());
  assert.equal((await app.inject('/api/settings')).statusCode,401);
  const login=await app.inject({method:'POST',url:'/api/session',payload:{password:'test-password'}});
  const headers={cookie:login.headers['set-cookie']};
  assert.equal((await app.inject({url:'/api/settings/runtime',headers})).statusCode,404);
  assert.equal((await app.inject({method:'PUT',url:'/api/settings/openai',headers:{...headers,origin:'https://untrusted.example'},payload:{version:0,values:{}}})).statusCode,403);
});

import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {catalog,settingsBody} from './catalog.mjs';
import {optional,number} from '../shared/config.mjs';

function fail(message,statusCode=400){return Object.assign(new Error(message),{statusCode,expose:true});}
export function encryptionKey(env){
  const raw=env.SETTINGS_ENCRYPTION_KEY;
  if(!raw||!/^[A-Za-z0-9+/]{43}=$/.test(raw))throw new Error('SETTINGS_ENCRYPTION_KEY must be a 32-byte base64 key');
  const key=Buffer.from(raw,'base64');
  if(key.length!==32)throw new Error('SETTINGS_ENCRYPTION_KEY must be a 32-byte base64 key');
  return key;
}
export function encryptSettings(id,values,key){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);
  cipher.setAAD(Buffer.from('vivegam:settings:'+id));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(values),'utf8'),cipher.final()]);
  return {ciphertext:ciphertext.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}
export function decryptSettings(row,key){
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(row.iv,'base64'));
  decipher.setAAD(Buffer.from('vivegam:settings:'+row.id));
  decipher.setAuthTag(Buffer.from(row.tag,'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.ciphertext,'base64')),decipher.final()]).toString('utf8'));
}
export async function migrateSettings(db){
  await db.query(`CREATE TABLE IF NOT EXISTS workspace_settings (
    id text PRIMARY KEY, ciphertext text NOT NULL, iv text NOT NULL, tag text NOT NULL,
    version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()
  )`);
}
export function createSettingsStore(db,env){
  const key=encryptionKey(env);
  function definition(id){const group=catalog.find(g=>g.id===id);if(!group)throw fail('Unknown settings group',404);return group;}
  async function rows(){return (await db.query('SELECT id,ciphertext,iv,tag,version,updated_at FROM workspace_settings')).rows;}
  function defaults(group){return Object.fromEntries(group.fields.filter(f=>f.type!=='secret').map(f=>[f.key,optional(f.section,f.key.toLowerCase(),env)]));}
  function resolve(group,row){return {...defaults(group),...(row?decryptSettings(row,key):{})};}
  return {
    async runtime(){const saved=await rows();return Object.fromEntries(catalog.flatMap(group=>{const row=saved.find(r=>r.id===group.id),values=row?decryptSettings(row,key):{};return group.fields.map(f=>[f.key,values[f.key]??(f.key==='AI_PROVIDER'?optional('ai','ai_provider',env):f.type==='boolean'?'false':'')]);}));},
    async list(){const saved=await rows();return {groups:catalog.map(group=>{const row=saved.find(r=>r.id===group.id),values=resolve(group,row);return {...group,version:row?.version||0,updatedAt:row?.updated_at||null,fields:group.fields.map(f=>({...f,...(f.type==='secret'?{hasValue:Boolean(values[f.key])}:{value:values[f.key]||''})}))};})};},
    async save(id,body){
      const group=definition(id);
      const old=(await db.query('SELECT id,ciphertext,iv,tag,version FROM workspace_settings WHERE id=$1',[id])).rows[0];
      if((old?.version||0)!==body.version)throw fail('Settings changed in another session. Reload before saving.',409);
      const values=old?decryptSettings(old,key):{};
      for(const [name,input] of Object.entries(body.values)){
        const f=group.fields.find(f=>f.key===name);if(!f)throw fail('Unsupported settings field');
        if(input===null){values[name]='';continue;}
        if(typeof input!=='string'||input.length>number('validation','settings_value_max_chars'))throw fail('Invalid settings value');
        const val=f.type==='secret'?input:input.trim();
        if(f.type==='boolean'&&!['true','false'].includes(val))throw fail('Use true or false for '+f.label);
        if(f.type==='select'&&!f.choices.some(c=>c.value===val))throw fail('Invalid '+f.label);
        if(f.type==='url'&&val){let url;try{url=new URL(val);}catch{throw fail('Invalid '+f.label);}if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw fail('Use an HTTP(S) URL without credentials, query or fragment for '+f.label);}
        values[name]=val;
      }
      const encrypted=encryptSettings(id,values,key);
      const result=await db.query(`INSERT INTO workspace_settings(id,ciphertext,iv,tag,version) VALUES($1,$2,$3,$4,1)
        ON CONFLICT(id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,iv=EXCLUDED.iv,tag=EXCLUDED.tag,version=workspace_settings.version+1,updated_at=now()
        WHERE workspace_settings.version=$5 RETURNING version`,[id,encrypted.ciphertext,encrypted.iv,encrypted.tag,body.version]);
      if(!result.rows[0])throw fail('Settings changed in another session. Reload before saving.',409);
      return {saved:true,version:result.rows[0].version};
    }
  };
}
export function registerSettingsRoutes(app,db,env,cache){
  const store=createSettingsStore(db,env);
  app.get('/settings',async()=>store.list());
  app.put('/settings/:id',{schema:{body:settingsBody}},async req=>{const result=await store.save(req.params.id,req.body);if(req.params.id==='telemetry'&&cache){await Promise.allSettled(['/tools/prometheus/summary','/tools/jaeger/services'].map(path=>cache.del('adapter:'+path)));}return result;});
  // Service-token authenticated, never exposed by the BFF's public route allowlist.
  app.get('/settings/runtime',async(_req,reply)=>{reply.header('Cache-Control','no-store');return {values:await store.runtime()};});
}

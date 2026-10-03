import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
async function sourceFiles(dir){const entries=await readdir(dir,{withFileTypes:true});const result=[];for(const e of entries){const path=dir+'/'+e.name;if(e.isDirectory())result.push(...await sourceFiles(path));else if(/\.(tsx?|mjs)$/.test(path))result.push(path);}return result;}
test('client modules contain UI and API calls but no database, crypto, SDK or domain-engine imports',async()=>{
 for(const file of await sourceFiles('frontend/src')){
  const source=await readFile(file,'utf8');if(!/^['"]use client['"]/m.test(source))continue;
  const imports=[...source.matchAll(/import\s+(?!type\s)[\s\S]*?from\s+['"]([^'"]+)['"]/g)].map(x=>x[1]);
  for(const dependency of imports)assert.ok(!/(?:backend|middleware)\/|lib\/quality|^(pg|redis|openai|anthropic|openid-client|@node-rs\/argon2|node:)/.test(dependency),`${file} imports backend dependency ${dependency}`);
  assert.doesNotMatch(source,/\b(?:parseContract|parseEvidence|artifactFor|validateGitUrl|analyzeRepository)\s*\(/,`${file} executes a domain engine`);
  assert.doesNotMatch(source,/process\.env\.(?:DATABASE_URL|POSTGRES_PASSWORD|SERVICE_TOKEN|SESSION_SECRET|SETTINGS_ENCRYPTION_KEY)/,`${file} accesses backend secrets`);
 }
});

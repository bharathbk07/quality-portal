// Optional deployed-database verification. Every write is rolled back.
import pg from 'pg';
import assert from 'node:assert/strict';
import {createSettingsStore} from './backend/settings/store.mjs';
const client=new pg.Client({connectionString:process.env.DATABASE_URL});
await client.connect();
try{
  await client.query('BEGIN');
  const workspace=(await client.query('SELECT id FROM workspaces WHERE is_default')).rows[0].id;
  const store=createSettingsStore(client,process.env,workspace);
  const before=await store.list(),group=before.groups.find(g=>g.id==='compatible');
  const sentinel='temporary-sdk-verification-secret';
  await store.save('compatible',{version:group.version,values:{COMPATIBLE_MODEL:'temporary-test-model',COMPATIBLE_API_KEY:sentinel,COMPATIBLE_BASE_URL:'http://localhost:1234/v1'}});
  const row=(await client.query('SELECT * FROM workspace_settings WHERE id=$1',['compatible'])).rows[0];
  assert.ok(!JSON.stringify(row).includes(sentinel));
  assert.ok(!JSON.stringify(row).includes('temporary-test-model'));
  assert.equal((await store.runtime()).COMPATIBLE_API_KEY,sentinel);
  assert.ok(!JSON.stringify(await store.list()).includes(sentinel));
  await assert.rejects(store.save('compatible',{version:group.version,values:{COMPATIBLE_MODEL:'stale'}}),e=>e.statusCode===409);
  console.log('PostgreSQL verification passed: encrypted row, masked public values, runtime decryption, optimistic locking. All writes rolled back.');
}finally{
  await client.query('ROLLBACK');
  await client.end();
}

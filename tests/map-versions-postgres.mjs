// Run inside the core container: docker compose exec -T core node --input-type=module < tests/map-versions-postgres.mjs
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createPool } from "./backend/database/pool.mjs";
import { createService } from "./backend/shared/http.mjs";
import { registerMapRoutes } from "./backend/mapping/routes.mjs";
import { processMapJob } from "./backend/mapping/worker.mjs";
import { projectIdentity } from "./backend/mapping/project-identity.mjs";
const db = createPool();
const workspaceId = randomUUID();
const otherWorkspaceId = randomUUID();
const userId = randomUUID();
const app = createService("map-version-check", {internal:false,logger:false});
app.addHook("preHandler", async req => {req.workspaceId = req.headers["test-workspace"] || workspaceId;req.identity={user:{id:userId}};});
registerMapRoutes(app,{db,upstream:async()=>{throw new Error("No external calls in version tests");}});
const files = [{path:"package.json",content:JSON.stringify({name:"version-fixture",dependencies:{express:"4"}})}];
const submit = (name="Version retention check")=>app.inject({method:"POST",url:"/maps",payload:{name,source:{kind:"upload",files}}});
try {
  await db.query("INSERT INTO workspaces(id,name) VALUES($1,'Disposable version test'),($2,'Disposable isolation test')",[workspaceId,otherWorkspaceId]);
  assert.equal(projectIdentity("one",{kind:"git",url:"https://github.com/Org/repo.git",ref:"main",paths:["src"]}),projectIdentity("renamed",{kind:"git",url:"https://github.com/Org/repo",ref:"feature",paths:["src"]}));
  assert.notEqual(projectIdentity("one",{kind:"git",url:"https://github.com/Org/repo",paths:["src"]}),projectIdentity("one",{kind:"git",url:"https://github.com/Org/repo",paths:["other"]}));
  await db.query("INSERT INTO users(id,username,display_name) VALUES($1,$2,'Disposable test user')",[userId,`version-test-${userId}`]);
  let id;
  for (let version=1;version<=3;version++) {
    const response=await submit();assert.equal(response.statusCode,202,response.body);
    id ||= response.json().id;assert.equal(response.json().id,id);
    const duplicate=await submit();assert.equal(duplicate.statusCode,409);
    const token=randomUUID();
    const job=(await db.query("UPDATE application_maps SET status='running',worker_token=$2 WHERE id=$1 RETURNING *",[id,token])).rows[0];
    await processMapJob(job,{db,token});
    const row=(await db.query("SELECT status,analysis_version FROM application_maps WHERE id=$1",[id])).rows[0];
    assert.equal(row.status,"completed");assert.equal(row.analysis_version,version);
  }
  const versions=(await db.query("SELECT version FROM map_analysis_versions WHERE map_id=$1 ORDER BY version DESC",[id])).rows.map(r=>r.version);
  assert.deepEqual(versions,[3,2]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM application_maps WHERE workspace_id=$1",[workspaceId])).rows[0].n,1);
  const historical=await app.inject({method:"GET",url:`/maps/${id}?version=2`});assert.equal(historical.statusCode,200,historical.body);assert.equal(historical.json().historical,true);
  assert.equal((await app.inject({method:"GET",url:`/maps/${id}?version=1`})).statusCode,404);
  assert.equal((await app.inject({method:"GET",url:`/maps/${id}?version=2`,headers:{"test-workspace":otherWorkspaceId}})).statusCode,404);
  const fenced=(await db.query("SELECT * FROM application_maps WHERE id=$1",[id])).rows[0];
  await processMapJob({...fenced,input:{kind:"upload",files}},{db,token:randomUUID()});
  assert.equal((await db.query("SELECT analysis_version FROM application_maps WHERE id=$1",[id])).rows[0].analysis_version,3);
  await submit();
  const failedToken=randomUUID();
  const failedJob=(await db.query("UPDATE application_maps SET status='running',worker_token=$2 WHERE id=$1 RETURNING *",[id,failedToken])).rows[0];
  await processMapJob({...failedJob,input:{kind:"upload",files:[{path:"../bad",content:"x"}]}},{db,token:failedToken});
  const preserved=(await db.query("SELECT status,analysis_version,error FROM application_maps WHERE id=$1",[id])).rows[0];
  assert.equal(preserved.status,"completed");assert.equal(preserved.analysis_version,3);assert.ok(preserved.error);
  for(let version=1;version<=3;version++) {
    const response=await app.inject({method:"POST",url:`/maps/${id}/revisions`,payload:{expectedVersion:version-1,label:`Snapshot ${version}`,kind:"current",annotations:{},positions:{}}});
    assert.equal(response.statusCode,201,response.body);
  }
  assert.deepEqual((await db.query("SELECT version FROM map_studio_revisions WHERE map_id=$1 ORDER BY version DESC",[id])).rows.map(r=>r.version),[3,2]);
  console.log("PASS: stable project ID, duplicate-job rejection, rolling two-version analysis and snapshot retention, historical reads, workspace isolation and fencing; failed scans preserve the last successful version");
} finally {
  await app.close();
  await db.query("DELETE FROM audit_events WHERE workspace_id=ANY($1::uuid[])",[[workspaceId,otherWorkspaceId]]);
  await db.query("DELETE FROM map_studio_revisions WHERE workspace_id=ANY($1::uuid[])",[[workspaceId,otherWorkspaceId]]);
  await db.query("DELETE FROM application_maps WHERE workspace_id=ANY($1::uuid[])",[[workspaceId,otherWorkspaceId]]);
  await db.query("DELETE FROM workspaces WHERE id=ANY($1::uuid[])",[[workspaceId,otherWorkspaceId]]);
  await db.query("DELETE FROM users WHERE id=$1",[userId]);
  await db.end();
}

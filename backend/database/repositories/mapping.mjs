import { executeStatement } from "../query.mjs";
// SQL belongs to data access. Values always use PostgreSQL parameter binding; never interpolate request data.
export function selectApplicationMaps(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT * FROM (SELECT DISTINCT ON (COALESCE(project_identity,id::text)) id,name,source,status,error,created_at,updated_at,analysis_version,result IS NOT NULL AS has_result,enrichment IS NOT NULL AS has_enrichment FROM application_maps WHERE workspace_id=$2 ORDER BY COALESCE(project_identity,id::text),created_at DESC) AS projects ORDER BY updated_at DESC LIMIT $1",
    values,
  );
}
export function selectApplicationMaps2(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT id,name,source,status,error,result,enrichment,analysis_version,created_at,updated_at FROM application_maps WHERE id=$1 AND workspace_id=$2",
    values,
  );
}
export function beginTransaction(connection, values = []) {
  return executeStatement(connection, "BEGIN", values);
}
export function selectTransaction(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT pg_advisory_xact_lock(hashtext('vivegam.mapping.queue'))",
    values,
  );
}
export function selectApplicationMaps3(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT count(*)::int AS count FROM application_maps WHERE status IN ('queued','running')",
    values,
  );
}
export function rollbackTransaction(connection, values = []) {
  return executeStatement(connection, "ROLLBACK", values);
}
export function insertApplicationMaps(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO application_maps(id,name,source,status,input,workspace_id,project_identity) VALUES($1,$2,$3,'queued',$4,$5,$6)",
    values,
  );
}
export function insertAuditEvents(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO audit_events(action,entity_id,workspace_id) VALUES($1,$2,$3)",
    values,
  );
}
export function commitTransaction(connection, values = []) {
  return executeStatement(connection, "COMMIT", values);
}
export function selectApplicationMaps4(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT result,status,analysis_version FROM application_maps WHERE id=$1 AND workspace_id=$2",
    values,
  );
}
export function updateApplicationMaps(connection, values = []) {
  return executeStatement(
    connection,
    "UPDATE application_maps SET enrichment=$2,updated_at=now() WHERE id=$1 AND workspace_id=$3 AND analysis_version=$4 AND status='completed' RETURNING id",
    values,
  );
}

export function selectDocumentation(db, values) {
  return executeStatement(
    db,
    "SELECT documentation_context FROM application_maps WHERE id=$1 AND workspace_id=$2",
    values,
  );
}
export function updateDiagram(db, values) {
  return executeStatement(
    db,
    "UPDATE application_maps SET result=jsonb_set(result, '{mermaid}', to_jsonb($3::text)), enrichment=NULL, updated_at=now() WHERE id=$1 AND workspace_id=$2 RETURNING id",
    values,
  );
}
export function lockProject(db, values) {
  return executeStatement(
    db,
    "SELECT id,name FROM application_maps WHERE id=$1 AND workspace_id=$2 FOR UPDATE",
    values,
  );
}
export function deleteSnapshots(db, values) {
  return executeStatement(
    db,
    "DELETE FROM map_studio_revisions WHERE map_id=$1 AND workspace_id=$2",
    values,
  );
}
export function deleteProject(db, values) {
  return executeStatement(
    db,
    "DELETE FROM application_maps WHERE id=$1 AND workspace_id=$2",
    values,
  );
}

export const findProject = (db, values) =>
  executeStatement(
    db,
    "SELECT id,name,status FROM application_maps WHERE workspace_id=$1 AND project_identity=$2 ORDER BY created_at DESC LIMIT 1 FOR UPDATE",
    values,
  );
export const requeueProject = (db, values) =>
  executeStatement(
    db,
    "WITH saved AS (INSERT INTO map_analysis_versions(map_id,workspace_id,version,source,result,enrichment,documentation_context) SELECT id,workspace_id,analysis_version,source,result,enrichment,documentation_context FROM application_maps WHERE id=$1 AND workspace_id=$5 AND result IS NOT NULL AND analysis_version>0 ON CONFLICT(map_id,version) DO UPDATE SET source=EXCLUDED.source,result=EXCLUDED.result,enrichment=EXCLUDED.enrichment,documentation_context=EXCLUDED.documentation_context) UPDATE application_maps SET name=$2,source=$3,input=$4,status='queued',attempts=0,error=NULL,worker_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND workspace_id=$5",
    values,
  );
export const listAnalysisVersions = (db, values) =>
  executeStatement(
    db,
    "SELECT version,source,created_at FROM map_analysis_versions WHERE map_id=$1 AND workspace_id=$2 ORDER BY version DESC LIMIT $3",
    values,
  );
export const readAnalysisVersion = (db, values) =>
  executeStatement(
    db,
    "SELECT version AS analysis_version,source,result,enrichment,created_at FROM map_analysis_versions WHERE map_id=$1 AND workspace_id=$2 AND version=$3",
    values,
  );

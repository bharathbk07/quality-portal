import { executeStatement } from "../query.mjs";
// SQL belongs to data access. Values always use PostgreSQL parameter binding; never interpolate request data.
export function createWorkspaceSettings(connection, values = []) {
  return executeStatement(
    connection,
    "CREATE TABLE IF NOT EXISTS workspace_settings (\n    id text PRIMARY KEY, ciphertext text NOT NULL, iv text NOT NULL, tag text NOT NULL,\n    version integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now()\n  )",
    values,
  );
}
export function selectWorkspaceSettings(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT * FROM workspace_settings WHERE workspace_id=$1",
    values,
  );
}
export function selectWorkspaceSettings2(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT * FROM workspace_settings WHERE id=$1 AND workspace_id=$2",
    values,
  );
}
export function insertWorkspaceSettings(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO workspace_settings(id,ciphertext,iv,tag,version,workspace_id,encryption_version) VALUES($1,$2,$3,$4,1,$6,2)\n        ON CONFLICT(workspace_id,id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,iv=EXCLUDED.iv,tag=EXCLUDED.tag,version=workspace_settings.version+1,updated_at=now()\n        WHERE workspace_settings.version=$5 RETURNING version",
    values,
  );
}

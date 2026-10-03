import { executeStatement } from "../query.mjs";
// SQL belongs to data access. Values always use PostgreSQL parameter binding; never interpolate request data.
export function createIdentityConfiguration(connection, values = []) {
  return executeStatement(
    connection,
    "CREATE TABLE IF NOT EXISTS identity_configuration(id text PRIMARY KEY,ciphertext text NOT NULL,iv text NOT NULL,tag text NOT NULL)",
    values,
  );
}
export function selectIdentityConfiguration(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT * FROM identity_configuration WHERE id=$1",
    values,
  );
}
export function insertIdentityConfiguration(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO identity_configuration(id,ciphertext,iv,tag) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET ciphertext=EXCLUDED.ciphertext,iv=EXCLUDED.iv,tag=EXCLUDED.tag",
    values,
  );
}
export function deleteSsoFlows(connection, values = []) {
  return executeStatement(
    connection,
    "DELETE FROM sso_flows WHERE expires_at<now()",
    values,
  );
}
export function insertSsoFlows(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO sso_flows(id,state,payload,expires_at) VALUES($1,$2,$3,now()+($4::int*interval '1 second'))",
    values,
  );
}
export function deleteSsoFlows2(connection, values = []) {
  return executeStatement(
    connection,
    "DELETE FROM sso_flows WHERE id=$1 AND expires_at>now() RETURNING *",
    values,
  );
}
export function selectUsers(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT * FROM users WHERE issuer=$1 AND subject=$2",
    values,
  );
}
export function beginTransaction(connection, values = []) {
  return executeStatement(connection, "BEGIN", values);
}
export function insertUsers(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO users(id,username,display_name,issuer,subject) VALUES($1,$2,$3,$4,$5) ON CONFLICT(issuer,subject) DO UPDATE SET subject=EXCLUDED.subject RETURNING *",
    values,
  );
}
export function insertWorkspaceMembers(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO workspace_members(workspace_id,user_id,role) SELECT id,$1,'viewer' FROM workspaces WHERE is_default ON CONFLICT DO NOTHING",
    values,
  );
}
export function commitTransaction(connection, values = []) {
  return executeStatement(connection, "COMMIT", values);
}
export function rollbackTransaction(connection, values = []) {
  return executeStatement(connection, "ROLLBACK", values);
}

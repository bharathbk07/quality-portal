import { executeStatement } from "../query.mjs";
// SQL belongs to data access. Values always use PostgreSQL parameter binding; never interpolate request data.
export function selectWorkspaces(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT id FROM workspaces WHERE id=$1",
    values,
  );
}
export function beginTransaction(connection, values = []) {
  return executeStatement(connection, "BEGIN", values);
}
export function insertWorkspaces(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO workspaces(id,name) VALUES($1,$2)",
    values,
  );
}
export function insertWorkspaceMembers(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,'admin')",
    values,
  );
}
export function commitTransaction(connection, values = []) {
  return executeStatement(connection, "COMMIT", values);
}
export function rollbackTransaction(connection, values = []) {
  return executeStatement(connection, "ROLLBACK", values);
}
export function selectUsers(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT u.id,u.username,u.display_name,u.disabled,u.is_super_admin,m.role,u.password_hash IS NOT NULL AS local_account FROM users u JOIN workspace_members m ON m.user_id=u.id WHERE m.workspace_id=$1 ORDER BY u.display_name LIMIT $2",
    values,
  );
}
export function selectUsers2(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT id,display_name FROM users WHERE username=$1 AND NOT disabled",
    values,
  );
}
export function selectUsers3(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT id,username,display_name,disabled,is_super_admin,password_hash IS NOT NULL AS local_account FROM users ORDER BY display_name LIMIT $1",
    values,
  );
}
export function insertUsers(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO users(id,username,display_name,password_hash,must_change_password) VALUES($1,$2,$3,$4,true)",
    values,
  );
}
export function insertWorkspaceMembers2(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO workspace_members(workspace_id,user_id,role) SELECT id,$1,'viewer' FROM workspaces WHERE is_default",
    values,
  );
}
export function insertWorkspaceMembers3(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO workspace_members(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT(workspace_id,user_id) DO UPDATE SET role=EXCLUDED.role",
    values,
  );
}
export function selectWorkspaces2(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT id FROM workspaces WHERE id=$1 FOR UPDATE",
    values,
  );
}
export function selectUsers4(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT id,is_super_admin FROM users WHERE id=$1 AND NOT disabled",
    values,
  );
}
export function selectWorkspaceMembers(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT m.user_id,m.role,u.disabled FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1",
    values,
  );
}
export function selectWorkspaces3(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT is_default FROM workspaces WHERE id=$1 FOR UPDATE",
    values,
  );
}
export function selectWorkspaceMembers2(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT m.role,u.is_super_admin FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.user_id=$2",
    values,
  );
}
export function selectWorkspaceMembers3(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT count(*)::int AS count FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=$1 AND m.role='admin' AND NOT u.disabled",
    values,
  );
}
export function deleteWorkspaceMembers(connection, values = []) {
  return executeStatement(
    connection,
    "DELETE FROM workspace_members WHERE workspace_id=$1 AND user_id=$2",
    values,
  );
}
export function deleteAuthSessions(connection, values = []) {
  return executeStatement(
    connection,
    "DELETE FROM auth_sessions WHERE workspace_id=$1 AND user_id=$2",
    values,
  );
}
export function selectWorkspaces4(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT w.id FROM workspaces w WHERE EXISTS(SELECT 1 FROM workspace_members m WHERE m.workspace_id=w.id AND m.user_id=$1) ORDER BY w.id FOR UPDATE",
    values,
  );
}
export function selectUsers5(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT is_super_admin FROM users WHERE id=$1",
    values,
  );
}
export function selectWorkspaceMembers4(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT m.workspace_id FROM workspace_members m WHERE m.user_id=$1 AND m.role='admin' AND NOT EXISTS(SELECT 1 FROM workspace_members other JOIN users u ON u.id=other.user_id WHERE other.workspace_id=m.workspace_id AND other.role='admin' AND other.user_id<>m.user_id AND NOT u.disabled)",
    values,
  );
}
export function updateUsers(connection, values = []) {
  return executeStatement(
    connection,
    "UPDATE users SET disabled=$2,auth_version=auth_version+1 WHERE id=$1",
    values,
  );
}
export function deleteAuthSessions2(connection, values = []) {
  return executeStatement(
    connection,
    "DELETE FROM auth_sessions WHERE user_id=$1",
    values,
  );
}
export function selectIdentityAudit(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT a.id,a.action,a.details,a.created_at,u.username AS actor FROM identity_audit a LEFT JOIN users u ON u.id=a.actor_id WHERE (a.workspace_id=$1 OR ($3::boolean AND a.workspace_id IS NULL)) ORDER BY a.created_at DESC LIMIT $2",
    values,
  );
}

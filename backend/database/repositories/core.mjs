import { executeStatement } from "../query.mjs";
// SQL belongs to data access. Values always use PostgreSQL parameter binding; never interpolate request data.
export function selectTransaction(connection, values = []) {
  return executeStatement(connection, "SELECT 1", values);
}
export function insertWorkspaceAgents(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO workspace_agents(id,workspace_id) VALUES($1,$2)",
    values,
  );
}
export function selectWorkspaceAgents(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT id FROM workspace_agents WHERE id=$1 AND workspace_id=$2",
    values,
  );
}
export function selectContracts(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT document FROM contracts WHERE id=$1 AND workspace_id=$2",
    values,
  );
}
export function selectContracts2(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT id,title,document,created_at FROM contracts WHERE workspace_id=$2 ORDER BY created_at DESC LIMIT $1",
    values,
  );
}
export function insertContracts(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO contracts(id,title,document,workspace_id) VALUES($1,$2,$3,$4)",
    values,
  );
}
export function selectPlans(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT id,name,discipline,artifact,created_at AS created FROM plans WHERE workspace_id=$2 ORDER BY created_at DESC LIMIT $1",
    values,
  );
}
export function selectContracts3(connection, values = []) {
  return executeStatement(
    connection,
    "SELECT title FROM contracts WHERE id=$1 AND workspace_id=$2",
    values,
  );
}
export function beginTransaction(connection, values = []) {
  return executeStatement(connection, "BEGIN", values);
}
export function insertPlans(connection, values = []) {
  return executeStatement(
    connection,
    "INSERT INTO plans(id,name,discipline,artifact,workspace_id) VALUES($1,$2,$3,$4,$5) RETURNING id,name,discipline,artifact,created_at AS created",
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
export function rollbackTransaction(connection, values = []) {
  return executeStatement(connection, "ROLLBACK", values);
}
export function deletePlans(connection, values = []) {
  return executeStatement(
    connection,
    "DELETE FROM plans WHERE id=$1 AND workspace_id=$2 RETURNING id",
    values,
  );
}

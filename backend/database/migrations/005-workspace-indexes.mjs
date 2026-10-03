export async function migrate(db) {
  await db.query(`
 CREATE INDEX IF NOT EXISTS contracts_workspace_created_idx ON contracts(workspace_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS plans_workspace_created_idx ON plans(workspace_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS maps_workspace_created_idx ON application_maps(workspace_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS audit_workspace_created_idx ON audit_events(workspace_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS identity_audit_workspace_created_idx ON identity_audit(workspace_id,created_at DESC);
 CREATE INDEX IF NOT EXISTS members_user_workspace_idx ON workspace_members(user_id,workspace_id);
 CREATE INDEX IF NOT EXISTS sso_flows_expiry_idx ON sso_flows(expires_at);
 `);
}

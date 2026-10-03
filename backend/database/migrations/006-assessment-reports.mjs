export async function migrate(db){
 await db.query(`CREATE TABLE IF NOT EXISTS assessment_reports (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES workspaces(id),name text NOT NULL,kind text NOT NULL,
 ciphertext text NOT NULL,iv text NOT NULL,tag text NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
 CREATE INDEX IF NOT EXISTS assessment_reports_workspace_idx ON assessment_reports(workspace_id,created_at DESC);`);
}

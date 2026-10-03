import { projectIdentity } from "../../mapping/project-identity.mjs";
export async function migrate(db) {
  await db.query(
    "ALTER TABLE application_maps ADD COLUMN IF NOT EXISTS project_identity text, ADD COLUMN IF NOT EXISTS analysis_version integer NOT NULL DEFAULT 0",
  );
  await db.query(`CREATE TABLE IF NOT EXISTS map_analysis_versions (
    map_id uuid NOT NULL REFERENCES application_maps(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL, version integer NOT NULL CHECK(version > 0),
    source jsonb NOT NULL, result jsonb NOT NULL, enrichment jsonb, documentation_context jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(map_id,version)
  )`);
  const rows = (
    await db.query(
      "SELECT id,name,source,result FROM application_maps WHERE project_identity IS NULL",
    )
  ).rows;
  for (const row of rows) {
    await db.query(
      "UPDATE application_maps SET project_identity=$2,analysis_version=CASE WHEN result IS NOT NULL THEN 1 ELSE 0 END WHERE id=$1",
      [row.id, projectIdentity(row.name, row.source)],
    );
  }
  await db.query(
    "INSERT INTO map_analysis_versions(map_id,workspace_id,version,source,result,enrichment,documentation_context,created_at) SELECT id,workspace_id,analysis_version,source,result,enrichment,documentation_context,updated_at FROM application_maps WHERE result IS NOT NULL AND analysis_version > 0 ON CONFLICT DO NOTHING",
  );
  await db.query(
    "CREATE INDEX IF NOT EXISTS application_maps_identity_idx ON application_maps(workspace_id,project_identity)",
  );
}

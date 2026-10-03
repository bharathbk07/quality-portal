export async function migrate(db) {
  await db.query(`CREATE UNIQUE INDEX IF NOT EXISTS application_maps_workspace_identity_idx ON application_maps(id,workspace_id);
    CREATE TABLE IF NOT EXISTS map_studio_revisions (
    id uuid PRIMARY KEY, map_id uuid NOT NULL REFERENCES application_maps(id),
    workspace_id uuid NOT NULL REFERENCES workspaces(id), version integer NOT NULL,
    created_by uuid NOT NULL REFERENCES users(id), kind text NOT NULL CHECK(kind IN ('current','proposed')),
    ciphertext text NOT NULL, iv text NOT NULL, tag text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(map_id,workspace_id,version),
    FOREIGN KEY(map_id,workspace_id) REFERENCES application_maps(id,workspace_id));
    CREATE INDEX IF NOT EXISTS map_studio_workspace_idx ON map_studio_revisions(workspace_id,map_id,version DESC);`);
}

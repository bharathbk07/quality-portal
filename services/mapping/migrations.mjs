// Idempotent, transactional startup migration. Advisory locking coordinates API and worker startup.
export async function migrateMapping(db) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext('vivegam.mapping.migrations'))",
    );
    await client.query(`CREATE TABLE IF NOT EXISTS application_maps (
 id uuid PRIMARY KEY, name text NOT NULL, source jsonb NOT NULL,
 status text NOT NULL CHECK(status IN ('queued','running','completed','failed')),
 input jsonb, result jsonb, enrichment jsonb, error text,
 attempts integer NOT NULL DEFAULT 0, worker_token uuid, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
)`);
    await client.query(
      "CREATE INDEX IF NOT EXISTS application_maps_queue_idx ON application_maps(status, created_at)",
    );
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

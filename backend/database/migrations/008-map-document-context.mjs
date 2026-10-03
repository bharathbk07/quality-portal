export async function migrate(db) {
  await db.query('ALTER TABLE application_maps ADD COLUMN IF NOT EXISTS documentation_context jsonb');
}

import { migrate as mapVersions } from "./migrations/009-map-analysis-versions.mjs";
import { migrate as mapDocuments } from "./migrations/008-map-document-context.mjs";
import { migrate as mapStudio } from "./migrations/007-map-studio.mjs";
import { migrate as assessment } from "./migrations/006-assessment-reports.mjs";
import { migrate as base } from "./migrations/000-core-tables.mjs";
import { migrate as indexes } from "./migrations/005-workspace-indexes.mjs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { migrate as mapping } from "./migrations/001-application-maps.mjs";
import { migrate as settings } from "./migrations/002-encrypted-settings.mjs";
import { migrate as identity } from "./migrations/003-identity-workspaces.mjs";
import { migrate as sso } from "./migrations/004-enterprise-sso.mjs";
import { createPool } from "./pool.mjs";
export const migrations = [
  ["000-core-tables", base],
  ["001-application-maps", mapping],
  ["002-encrypted-settings", settings],
  ["003-identity-workspaces", identity],
  ["004-enterprise-sso", sso],
  ["005-workspace-indexes", indexes],
  ["006-assessment-reports", assessment],
  ["007-map-studio", mapStudio],
  ["008-map-document-context", mapDocuments],
  ["009-map-analysis-versions", mapVersions],
];
export async function runMigrations(db, env = process.env) {
  const lock = await db.connect();
  try {
    await lock.query(
      "SELECT pg_advisory_lock(hashtext('vivegam.schema.registry'))",
    );
    await lock.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(id text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const [id, migrate] of migrations) {
      const checksum = createHash("sha256")
        .update(migrate.toString())
        .digest("hex");
      const old = (
        await lock.query("SELECT checksum FROM schema_migrations WHERE id=$1", [
          id,
        ])
      ).rows[0];
      if (old) {
        if (old.checksum !== checksum)
          throw new Error(
            "Applied migration changed: " + id + ". Add a new migration.",
          );
        continue;
      }
      await migrate(db, env);
      await lock.query(
        "INSERT INTO schema_migrations(id,checksum) VALUES($1,$2)",
        [id, checksum],
      );
    }
  } finally {
    try {
      await lock.query(
        "SELECT pg_advisory_unlock(hashtext('vivegam.schema.registry'))",
      );
    } finally {
      lock.release();
    }
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const db = createPool();
  try {
    await runMigrations(db);
    console.log("Database migrations applied");
  } finally {
    await db.end();
  }
}

import { readFileSync } from "node:fs";
export async function migrate(db) {
  await db.query(
    readFileSync(
      new URL(
        "../../../deployment/infrastructure/postgres/001-init.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
}

import {migrateSettings,encryptionKey} from "../settings/store.mjs";
import { migrateMapping } from "../mapping/migrations.mjs";
import { number } from "../shared/config.mjs";
import pg from "pg";
import { createClient } from "redis";
import { buildCore } from "./app.mjs";
import { start } from "../shared/http.mjs";
encryptionKey(process.env);
const db = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: number("storage", "pool_max"),
});
const cache = createClient({ url: process.env.REDIS_URL });
cache.on("error", (e) => console.error("Redis unavailable:", e.message));
await cache.connect();
await migrateMapping(db);
await migrateSettings(db);
const app = buildCore({ db, cache });
app.addHook("onClose", async () => {
  await db.end();
  await cache.quit();
});
await start(app, process.env.PORT || number("services", "core_port"));

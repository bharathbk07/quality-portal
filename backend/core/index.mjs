import {runMigrations} from "../database/migrate.mjs";
import {encryptionKey} from "../settings/store.mjs";
import {createPool} from "../database/pool.mjs";
import { number } from "../shared/config.mjs";
import { createClient } from "redis";
import { buildCore } from "./app.mjs";
import { start } from "../shared/http.mjs";
encryptionKey(process.env);
const db = createPool();
const cache = createClient({ url: process.env.REDIS_URL });
cache.on("error", () => console.error(JSON.stringify({event:"cache_unavailable"})));
await cache.connect();
await runMigrations(db);
const app = buildCore({ db, cache });
app.addHook("onClose", async () => {
  await db.end();
  await cache.quit();
});
await start(app, process.env.PORT || number("services", "core_port"));

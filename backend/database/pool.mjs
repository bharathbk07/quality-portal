import pg from "pg";
import { number } from "../shared/config.mjs";
export function createPool(env = process.env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  return new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: number("storage", "pool_max", env),
    connectionTimeoutMillis: number("storage", "connection_timeout_ms", env),
    idleTimeoutMillis: number("storage", "idle_timeout_ms", env),
    statement_timeout: number("storage", "statement_timeout_ms", env),
  });
}

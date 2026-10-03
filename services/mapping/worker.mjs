import { randomUUID } from "node:crypto";
import pg from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { number, value } from "../shared/config.mjs";
import { callService } from "../shared/http.mjs";
import { mappingConfig } from "./config.mjs";
import { analyzeRepository } from "./analyzer.mjs";
import { migrateMapping } from "./migrations.mjs";
export async function processMapJob(
  job,
  { db, env = process.env, fetchRepository, token },
) {
  const policy = mappingConfig(env);
  let source = job.source;
  let files = job.input.files;
  let warnings = [];
  try {
    if (job.input.kind === "git") {
      const remote = await fetchRepository(job.input);
      files = remote.files;
      source = remote.source;
      warnings = remote.warnings || [];
    }
    const result = analyzeRepository(files, policy);
    result.warnings.unshift(...warnings);
    await db.query(
      "UPDATE application_maps SET status='completed',result=$2,source=$3,input=NULL,error=NULL,worker_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND worker_token=$4",
      [job.id, JSON.stringify(result), JSON.stringify(source), token],
    );
  } catch (error) {
    const safe =
      error?.statusCode >= 500
        ? "Repository integration could not complete the scan. Check adapter availability and access."
        : error.message || "Repository analysis failed";
    await db.query(
      "UPDATE application_maps SET status='failed',error=$2,input=NULL,worker_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND worker_token=$3",
      [job.id, safe, token],
    );
  }
}
export async function runWorker(env = process.env) {
  const db = new pg.Pool({
    connectionString: env.DATABASE_URL,
    max: number("storage", "pool_max", env),
  });
  await migrateMapping(db);
  let stopping = false;
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, () => {
      stopping = true;
    });
  console.log("Application-map worker ready");
  while (!stopping) {
    try {
      await db.query(
        "UPDATE application_maps SET status='failed',input=NULL,error='Worker recovery limit reached',worker_token=NULL,lease_until=NULL,updated_at=now() WHERE status='running' AND lease_until < now() AND attempts >= $1",
        [number("repository", "repository_max_attempts", env)],
      );
      const token = randomUUID();
      const claimed = await db.query(
        `UPDATE application_maps SET status='running',attempts=attempts+1,worker_token=$1,lease_until=now()+($2::int * interval '1 millisecond'),updated_at=now() WHERE id=(SELECT id FROM application_maps WHERE status='queued' OR (status='running' AND lease_until < now() AND attempts < $3) ORDER BY created_at LIMIT 1 FOR UPDATE SKIP LOCKED) RETURNING *`,
        [
          token,
          number("repository", "repository_lease_ms", env),
          number("repository", "repository_max_attempts", env),
        ],
      );
      if (!claimed.rows.length) {
        await delay(number("repository", "repository_worker_poll_ms", env));
        continue;
      }
      const job = claimed.rows[0];
      const heartbeat = setInterval(
        () => {
          void db
            .query(
              "UPDATE application_maps SET lease_until=now()+($2::int * interval '1 millisecond') WHERE id=$1 AND worker_token=$3",
              [job.id, number("repository", "repository_lease_ms", env), token],
            )
            .catch(() => {});
        },
        number("repository", "repository_heartbeat_ms", env),
      );
      try {
        await processMapJob(job, {
          db,
          env,
          token,
          fetchRepository: (source) =>
            callService(
              value("services", "integration_url", env),
              "/repositories/read",
              {
                method: "POST",
                body: source,
                token: env.SERVICE_TOKEN,
                timeout: number(
                  "repository",
                  "repository_scan_timeout_ms",
                  env,
                ),
              },
            ),
        });
      } finally {
        clearInterval(heartbeat);
      }
    } catch (error) {
      console.error(
        "Map worker operation failed:",
        error.code || "service_error",
      );
      await delay(number("repository", "repository_worker_poll_ms", env));
    }
  }
  await db.end();
}

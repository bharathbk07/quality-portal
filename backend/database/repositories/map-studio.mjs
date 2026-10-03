import { executeStatement } from "../query.mjs";
export const listRevisions = (db, mapId, workspaceId, limit) =>
  executeStatement(
    db,
    "SELECT * FROM map_studio_revisions WHERE map_id=$1 AND workspace_id=$2 ORDER BY version DESC LIMIT $3",
    [mapId, workspaceId, limit],
  );
export const insertRevision = (db, v) =>
  executeStatement(
    db,
    "INSERT INTO map_studio_revisions(id,map_id,workspace_id,version,created_by,kind,ciphertext,iv,tag) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,version,kind,created_at",
    v,
  );
export const lockMap = (db, mapId, workspaceId) =>
  executeStatement(db, "SELECT pg_advisory_xact_lock(hashtext($1))", [
    workspaceId + ":" + mapId,
  ]);

export const pruneRevisions = (db,mapId,workspaceId,minimumVersion) => executeStatement(db,"DELETE FROM map_studio_revisions WHERE map_id=$1 AND workspace_id=$2 AND version <= $3",[mapId,workspaceId,minimumVersion]);

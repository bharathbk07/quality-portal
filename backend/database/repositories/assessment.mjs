import { executeStatement } from "../query.mjs";
export const listReports = (db, workspace, limit) =>
  executeStatement(
    db,
    "SELECT id,name,kind,created_at FROM assessment_reports WHERE workspace_id=$1 ORDER BY created_at DESC LIMIT $2",
    [workspace, limit],
  );
export const findReport = (db, id, workspace) =>
  executeStatement(
    db,
    "SELECT * FROM assessment_reports WHERE id=$1 AND workspace_id=$2",
    [id, workspace],
  );
export const saveReport = (db, r) =>
  executeStatement(
    db,
    "INSERT INTO assessment_reports(id,workspace_id,name,kind,ciphertext,iv,tag) VALUES($1,$2,$3,$4,$5,$6,$7)",
    [r.id, r.workspace, r.name, r.kind, r.ciphertext, r.iv, r.tag],
  );

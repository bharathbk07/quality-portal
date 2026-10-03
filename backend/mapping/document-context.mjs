import { number } from "../shared/config.mjs";
import {
  encryptionKey,
  encryptSettings,
  decryptSettings,
} from "../settings/store.mjs";
import * as repository from "../database/repositories/mapping.mjs";
export function redactDocument(text) {
  return text
    .replace(/-----BEGIN[\s\S]*?-----END[^\n]*-----/g, "[REDACTED]")
    .replace(
      /\b(?:sk-|AIza|ghp_|github_pat_)[A-Za-z0-9_-]{15,}/g,
      "[REDACTED]",
    )
    .replace(
      /(\b(?:password|passwd|api[_ -]?key|secret|token)["']?\s*[:=]\s*)(?:\[REDACTED\]|"[^"\n]*"|'[^'\n]*'|[^\s,}\]]+)/gi,
      "$1[REDACTED]",
    )
    .replace(/https?:\/\/[^\s/@]+:[^\s/@]+@/g, "https://[REDACTED]@")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED EMAIL]");
}
export function indexDocumentation(files, env = process.env) {
  let remaining = number("map_documents", "max_total_chars", env);
  return files
    .filter((f) => /\.mdx?$/i.test(f.path))
    .sort((a,b)=>Number(/(^|\/)readme\.md$/i.test(b.path))-Number(/(^|\/)readme\.md$/i.test(a.path)) || a.path.length-b.path.length || a.path.localeCompare(b.path))
    .slice(0, number("map_documents", "max_files", env))
    .flatMap((f) => {
      if (remaining <= 0) return [];
      const length = Math.min(
        remaining,
        number("map_documents", "max_file_chars", env),
      );
      const content = redactDocument(f.content).slice(0, length);
      remaining -= content.length;
      const chunks = [];
      const lines = content.split("\n");
      let text = "",
        start = 1;
      const flush = () => {
        if (text.trim())
          chunks.push({
            path: f.path,
            line: start,
            text: text.trim(),
            classification: "Documentation claim; not runtime proof",
          });
        text = "";
      };
      lines.forEach((line, i) => {
        if (
          text.length + line.length >
          number("map_documents", "chunk_chars", env)
        ) {
          flush();
          start = i + 1;
        }
        text += line + "\n";
      });
      flush();
      return chunks;
    });
}
export function retrieveDocumentation(
  chunks,
  question = "",
  env = process.env,
) {
  const words = new Set(
    question.toLowerCase().match(/[\p{L}\p{N}_-]{3,}/gu) || [],
  );
  let remaining = number("map_documents", "context_chars", env);
  return chunks
    .map((c, i) => ({
      c,
      i,
      score: [...words].filter((w) =>
        (c.path + " " + c.text).toLowerCase().includes(w),
      ).length,
    }))
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .slice(0, number("map_documents", "context_chunks", env))
    .flatMap(({ c }) => {
      if (remaining <= 0) return [];
      const text = c.text.slice(0, remaining);
      remaining -= text.length;
      return [{ ...c, text }];
    });
}
export function encryptDocumentation(id, workspaceId, chunks, env) {
  return chunks.length
    ? encryptSettings(
        `map-documents:${workspaceId}:${id}`,
        { chunks },
        encryptionKey(env),
      )
    : null;
}
export async function documentContext(
  db,
  id,
  workspaceId,
  question,
  env = process.env,
) {
  const row = (await repository.selectDocumentation(db, [id, workspaceId]))
    .rows[0];
  if (!row?.documentation_context) return [];
  const chunks = decryptSettings(
    { ...row.documentation_context, id: `map-documents:${workspaceId}:${id}` },
    encryptionKey(env),
  ).chunks;
  return retrieveDocumentation(chunks, question, env);
}

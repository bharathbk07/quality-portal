import { createHash } from "node:crypto";

// A branch/commit is a version of a project; a different imported subsystem is a different map.
export function projectIdentity(name, source) {
  let identity;
  if (source.kind === "git") {
    const url = new URL(source.url);
    const repository = `${url.hostname.toLowerCase()}${url.pathname.replace(/\/+$/, "").replace(/\.git$/i, "")}`;
    identity = {
      kind: "git",
      repository,
      paths: [...new Set(source.paths || [])].sort(),
    };
  } else {
    identity = {
      kind: "upload",
      name: name.trim().normalize("NFKC").toLowerCase(),
    };
  }
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

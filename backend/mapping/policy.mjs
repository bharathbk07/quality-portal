// Shared input rules; intentionally browser-compatible. Never reads repository code as executable input.
export function cleanPath(input, policy) {
  if (
    typeof input !== "string" ||
    input.length > policy.maxPathChars ||
    /[\x00-\x1f\x7f]/.test(input)
  )
    throw new Error("Invalid repository file path");
  const path = input.replaceAll("\\", "/").replace(/^\.\//, "");
  if (
    !path ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    path.split("/").some((p) => !p || p === "." || p === "..")
  )
    throw new Error(
      "Repository paths must be relative without parent traversal",
    );
  return path;
}
export function eligibleFile(path, policy) {
  const parts = path.toLowerCase().split("/");
  const name = parts.at(-1);
  if (parts.some((p) => policy.excludedDirs.includes(p))) return false;
  if (
    /^\.env(?:\.|$)/.test(name) ||
    /(?:^|[._-])(?:secret|secrets|credential|credentials|id_rsa|id_ed25519)(?:[._-]|$)/.test(
      name,
    ) ||
    /\.(pem|key|p12|pfx|jks|keystore)$/.test(name)
  )
    return false;
  if (policy.excludedFiles.includes(name)) return false;
  return (
    policy.manifestNames.includes(name) ||
    /^dockerfile(?:\.|$)/.test(name) ||
    [...policy.sourceExtensions, ...policy.configExtensions].some((ext) =>
      name.endsWith(ext),
    )
  );
}
export function validateFiles(input, policy) {
  if (!Array.isArray(input) || !input.length)
    throw new Error("Choose repository source files to analyze");
  if (input.length > policy.maxFiles)
    throw new Error(
      `The selection exceeds ${policy.maxFiles} files. Select a smaller application directory.`,
    );
  const files = [];
  const paths = new Set();
  let bytes = 0;
  let excluded = 0;
  for (const entry of input) {
    const path = cleanPath(entry.path, policy);
    if (paths.has(path)) throw new Error("Duplicate repository path: " + path);
    paths.add(path);
    if (!eligibleFile(path, policy)) {
      excluded++;
      continue;
    }
    if (typeof entry.content !== "string" || entry.content.includes("\0"))
      throw new Error("Expected text content for " + path);
    const size = new TextEncoder().encode(entry.content).byteLength;
    if (size > policy.maxFileBytes)
      throw new Error("File exceeds the configured size limit: " + path);
    bytes += size;
    if (bytes > policy.maxTotalBytes)
      throw new Error(
        "Repository content exceeds the configured total size limit. Select a smaller application directory.",
      );
    files.push({ path, content: entry.content });
  }
  if (!files.length)
    throw new Error("No supported source or manifest files were found");
  return { files, bytes, excluded };
}

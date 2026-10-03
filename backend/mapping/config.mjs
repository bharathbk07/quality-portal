import { number, value } from "../shared/config.mjs";
export function mappingConfig(env = process.env) {
  const n = (key) => number("repository", "repository_" + key, env);
  const s = (key) => value("repository", "repository_" + key, env);
  const list = (key) =>
    s(key)
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
  return {
    allowedHosts: list("allowed_hosts"),
    maxFiles: n("max_files"),
    maxFileBytes: n("max_file_bytes"),
    maxTotalBytes: n("max_total_bytes"),
    maxPathChars: n("max_path_chars"),
    maxNodes: n("max_nodes"),
    maxEdges: n("max_edges"),
    uiPollMs: n("ui_poll_ms"),
    labelMaxChars: n("label_max_chars"),
    excludedDirs: list("excluded_dirs"),
    excludedFiles: list("excluded_files"),
    sourceExtensions: list("source_extensions"),
    configExtensions: list("config_extensions"),
    manifestNames: list("manifest_names"),
    manifestExtensions: list("manifest_extensions"),
    databasePatterns: list("database_patterns"),
    cachePatterns: list("cache_patterns"),
    queuePatterns: list("queue_patterns"),
    gatewayPatterns: list("gateway_patterns"),
    frontendDependencies: list("frontend_dependencies"),
    backendDependencies: list("backend_dependencies"),
    storageDependencies: list("storage_dependencies"),
    kubernetesManifestDirs: list("kubernetes_manifest_dirs"),
    direction: s("diagram_direction"),
  };
}

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { value, number } from "../shared/config.mjs";
import { cleanPath, eligibleFile, validateFiles } from "./policy.mjs";
export function validateGitUrl(input, policy) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new Error("Use an HTTPS Git repository URL");
  }
  if (
    url.protocol !== "https:" ||
    /^https:\/\/[^/?#]*:/.test(input) ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    isIP(url.hostname) ||
    !policy.allowedHosts.includes(url.hostname.toLowerCase())
  )
    throw new Error(
      "Repository host must be allowlisted, use HTTPS, and contain no credentials, port, query, or fragment",
    );
  if (
    !/^\/[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)+\/?$/.test(url.pathname) ||
    url.pathname.split("/").some((p) => p === "." || p === "..")
  )
    throw new Error("Use the repository clone URL, not a branch or file URL");
  return url;
}
function publicAddress(address) {
  if (address.includes(":"))
    return (
      !/^(::|fc|fd|fe8|fe9|fea|feb|ff)/i.test(address) &&
      !address.startsWith("2001:db8:")
    );
  const [a, b] = address.split(".").map(Number);
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}
export async function runGit(args, { cwd, env, timeout, maxBytes, input }) {
  return new Promise((resolve, reject) => {
    const child = spawn(value("repository", "repository_git_binary"), args, {
      cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      detached: process.platform !== "win32",
    });
    const chunks = [];
    let size = 0;
    let failure;
    function kill(message) {
      if (failure) return;
      failure = new Error(message);
      try {
        if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {}
    }
    const timer = setTimeout(
      () => kill("Repository operation exceeded its time limit"),
      timeout,
    );
    child.stdout.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes)
        kill("Repository operation exceeded its output limit");
      else chunks.push(chunk);
    });
    // Drain and discard Git diagnostics: remote output may contain secrets or control sequences.
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Git executable could not be started"));
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0)
        reject(
          new Error(
            "Git import failed. Check the URL, branch, access, and repository size.",
          ),
        );
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export async function readGitRepository(input, policy, env = process.env) {
  const url = validateGitUrl(input.url, policy);
  const prefixes = (input.paths || []).map(p => cleanPath(p, policy));
  const addresses = await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some((r) => !publicAddress(r.address)))
    throw new Error("Repository host resolved to a non-public network address");
  const ref = input.ref?.trim();
  if (
    ref &&
    (!/^[A-Za-z0-9][A-Za-z0-9_./-]*$/.test(ref) ||
      ref.includes("..") ||
      ref.endsWith("/") ||
      ref.endsWith(".lock"))
  )
    throw new Error("Invalid branch or tag name");
  const root = await mkdtemp(path.join(tmpdir(), "vivegam-map-"));
  const repo = path.join(root, "repository");
  const childEnv = {
    PATH: env.PATH || process.env.PATH,
    HOME: root,
    LANG: "C.UTF-8",
    GIT_TERMINAL_PROMPT: "0",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_ALLOW_PROTOCOL: "https",
    GIT_LFS_SKIP_SMUDGE: "1",
  };
  const config = [
    ["core.hooksPath", "/dev/null"],
    ["http.followRedirects", "false"],
    ["protocol.allow", "never"],
    ["protocol.https.allow", "always"],
    ["credential.helper", ""],
    ["core.quotePath", "false"],
  ];
  if (
    env.GIT_HTTP_TOKEN &&
    url.hostname === value("repository", "repository_auth_host", env)
  )
    config.push([
      "http.extraHeader",
      "Authorization: Basic " +
        Buffer.from(
          value("repository", "repository_auth_username", env) +
            ":" +
            env.GIT_HTTP_TOKEN,
        ).toString("base64"),
    ]);
  childEnv.GIT_CONFIG_COUNT = String(config.length);
  config.forEach(([k, v], i) => {
    childEnv["GIT_CONFIG_KEY_" + i] = k;
    childEnv["GIT_CONFIG_VALUE_" + i] = v;
  });
  const limits = {
    env: childEnv,
    timeout: number("repository", "repository_command_timeout_ms", env),
    maxBytes: number("repository", "repository_tree_max_bytes", env),
  };
  try {
    await runGit(
      [
        "clone",
        "--bare",
        "--depth",
        "1",
        "--single-branch",
        "--no-tags",
        ...(ref ? ["--branch", ref] : []),
        "--",
        url.toString(),
        repo,
      ],
      {
        ...limits,
        cwd: root,
        timeout: number("repository", "repository_clone_timeout_ms", env),
      },
    );
    const revision = (
      await runGit(["rev-parse", "HEAD"], { ...limits, cwd: repo })
    )
      .toString()
      .trim();
    const tree = await runGit(["ls-tree", "-rlz", "HEAD"], {
      ...limits,
      cwd: repo,
    });
    const selected = [];
    let excluded = 0;
    let oversized = 0;
    let total = 0;
    for (const record of tree.toString("utf8").split("\0").filter(Boolean)) {
      const match = /^(\d+) blob ([a-f0-9]+)\s+(\d+)\t([\s\S]+)$/.exec(record);
      if (!match || !["100644", "100755"].includes(match[1])) {
        excluded++;
        continue;
      }
      const file = cleanPath(match[4], policy);
      if (prefixes.length && !prefixes.some(p => file === p || file.startsWith(p + "/"))) continue;
      if (!eligibleFile(file, policy)) {
        excluded++;
        continue;
      }
      const bytes = Number(match[3]);
      if (bytes > policy.maxFileBytes) {
        oversized++;
        continue;
      }
      total += bytes;
      if (total > policy.maxTotalBytes || selected.length >= policy.maxFiles)
        throw new Error(
          "Repository exceeds configured analysis limits. Import a smaller directory instead.",
        );
      selected.push({ oid: match[2], path: file, size: bytes });
    }
    if (!selected.length)
      throw new Error("No supported repository files were found");
    const blobs = await runGit(["cat-file", "--batch"], {
      ...limits,
      cwd: repo,
      maxBytes:
        policy.maxTotalBytes +
        number("repository", "repository_tree_max_bytes", env),
      input: selected.map((x) => x.oid).join("\n") + "\n",
    });
    let offset = 0;
    const files = [];
    for (const item of selected) {
      const end = blobs.indexOf(10, offset);
      if (end < 0) throw new Error("Invalid Git blob response");
      const header = blobs.subarray(offset, end).toString().split(" ");
      const size = Number(header[2]);
      if (header[0] !== item.oid || header[1] !== "blob" || size !== item.size)
        throw new Error("Git blob size mismatch");
      offset = end + 1;
      const content = blobs.subarray(offset, offset + size).toString("utf8");
      offset += size + 1;
      if (content.includes("\0")) {
        excluded++;
        continue;
      }
      files.push({ path: item.path, content });
    }
    validateFiles(files, policy);
    return {
      files,
      source: { kind: "git", url: url.toString(), ref: ref || null, revision, paths: prefixes, scope: input.scope || "unknown" },
      warnings: [
        `${excluded} excluded, binary, symlink, or submodule entries skipped.`,
        ...(oversized
          ? [`${oversized} oversized files skipped; this map is partial.`]
          : []),
      ],
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

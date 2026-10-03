import { value, number } from "./config.mjs";
const fail = (message, statusCode = 400) =>
  Object.assign(new Error(message), { statusCode, expose: true });
function matches(host, entry) {
  return entry.startsWith("*.")
    ? host.endsWith(entry.slice(1)) && host !== entry.slice(2)
    : host === entry;
}
export function validateEgress(input, env = process.env) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw fail("Invalid adapter URL");
  }
  const host = url.hostname.toLowerCase();
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw fail("Use an HTTP(S) adapter URL without credentials or fragments");
  if (
    !value("egress", "allowed_hosts", env)
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .some((x) => matches(host, x))
  )
    throw fail(
      "Adapter host is not permitted by the backend egress policy. Ask your operator to add the approved host.",
      403,
    );
  if (
    url.protocol === "http:" &&
    !value("egress", "http_hosts", env)
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .includes(host)
  )
    throw fail("This adapter requires HTTPS", 403);
  return url;
}
export async function egressFetch(
  input,
  init = {},
  env = process.env,
  fetcher = fetch,
) {
  validateEgress(String(input), env);
  const response = await fetcher(input, { ...init, redirect: "error" });
  const max = number("egress", "response_max_bytes", env),
    length = response.headers.get("content-length");
  if (length && Number(length) > max) {
    await response.body?.cancel();
    throw fail("Adapter response exceeds the configured limit", 502);
  }
  if (!response.body) return response;
  const reader = response.body.getReader(),
    chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > max) {
        await reader.cancel();
        throw fail("Adapter response exceeds the configured limit", 502);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return new Response(Buffer.concat(chunks), {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

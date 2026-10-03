import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
export function promptDirectory() {
  return resolve(
    process.env.PROMPTS_DIR ||
      fileURLToPath(new URL("../../prompts", import.meta.url)),
  );
}
export function renderPrompt(name, values = {}) {
  const root = promptDirectory();
  const file = resolve(root, name);
  if (!file.startsWith(root + sep)) throw new Error("Invalid prompt path");
  return readFileSync(file, "utf8")
    .trim()
    .replace(/\{\{([a-zA-Z]+)\}\}/g, (_, key) => {
      if (!(key in values)) throw new Error("Missing prompt parameter: " + key);
      return String(values[key]);
    });
}

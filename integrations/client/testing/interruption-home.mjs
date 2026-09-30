import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

// Only cloning synthetic fixtures uses this helper; no production history is rewritten.
export async function rewriteHome(root, previous, destination = root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) await rewriteHome(path, previous, destination);
    else if (entry.isFile() && entry.name.endsWith(".json")) {
      const text = await readFile(path, "utf8");
      await writeFile(path, text.split(previous).join(destination));
    }
  }
}

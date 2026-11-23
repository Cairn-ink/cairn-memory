import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const codename = String.fromCharCode(119, 51);
const forbidden = new RegExp(
  String.raw`\b${codename}\b|${codename}-fingerprint-key-id|${codename}:raw-shingles:|${codename}:v1-exact(?:\x00|\\(?:0|x00|u0000))`,
  "i",
);

async function scan(dir, hits) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (dir !== root || entry.name !== "node_modules") await scan(path, hits);
    } else if (entry.isFile()) {
      const lines = (await readFile(path, "utf8")).split("\n");
      for (const [index, line] of lines.entries()) {
        if (forbidden.test(line)) hits.push(`${relative(root, path)}:${index + 1}`);
      }
    }
  }
}

test("core package files contain no hosted codename or HMAC domains", async () => {
  const hits = [];
  await scan(root, hits);
  assert.deepEqual(hits, []);
});

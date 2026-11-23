import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const codename = String.fromCharCode(119, 51);
// The hosted domain labels and any codename-prefixed identifier. A bare short
// token is not matched: it also occurs as an ordinary id in unrelated fixtures.
const forbidden = new RegExp(
  String.raw`${codename}-fingerprint-key-id|${codename}:raw-shingles:|${codename}:v1-exact(?:\x00|\\(?:0|x00|u0000))|\b${codename}[-:][a-z]|FAKE-[A-Z-]*${codename}`,
  "i",
);

// Shipped source, plus the privacy tests and fixtures this guard belongs to.
const roots = ["src", "test/fixtures/privacy"];
const privacyTest = (name) => /^privacy-.*\.(?:mjs|json)$|^hosted-codename\.test\.mjs$/u.test(name);

function scanLines(path, hits) {
  return readFile(path, "utf8").then((text) => {
    for (const [index, line] of text.split("\n").entries()) {
      if (forbidden.test(line)) hits.push(`${relative(root, path)}:${index + 1}`);
    }
  });
}

async function scan(dir, hits) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) await scan(path, hits);
    else if (entry.isFile()) await scanLines(path, hits);
  }
}

test("core source and privacy tests contain no hosted codename or HMAC domains", async () => {
  const hits = [];
  for (const dir of roots) await scan(join(root, dir), hits);
  const tests = await readdir(join(root, "test"), { withFileTypes: true });
  for (const entry of tests) {
    if (entry.isFile() && privacyTest(entry.name)) await scanLines(join(root, "test", entry.name), hits);
  }
  assert.deepEqual(hits, []);
});

test("the codename guard catches each hosted label form (negative control)", () => {
  for (const line of [
    `sign(key, "${codename}-fingerprint-key-id")`,
    `sign(key, \`${codename}:raw-shingles:\${userId}\`)`,
    `"${codename}:v1-exact\\0"`,
    `const KEY = "FAKE-CONFORMANCE-ONLY-${codename.toUpperCase()}-KEY";`,
  ]) assert.ok(forbidden.test(line), line);
  assert.equal(forbidden.test('{"id":"' + codename + '","role":"user"}'), false);
});

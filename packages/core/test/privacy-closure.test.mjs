import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Static and dynamic `node:` specifiers, plus CommonJS require calls.
const NODE_SPECIFIER = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']node:/u;
const REQUIRE_CALL = /\brequire\s*\(/u;

function violations(source) {
  const found = [];
  if (NODE_SPECIFIER.test(source)) found.push("node: specifier");
  if (REQUIRE_CALL.test(source)) found.push("require");
  return found;
}

function shippedFiles() {
  const { files } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.ok(Array.isArray(files) && files.length > 0);
  const list = [];
  for (const entry of files) {
    const path = join(root, entry);
    if (statSync(path).isDirectory()) {
      for (const file of readdirSync(path, { recursive: true, withFileTypes: true })) {
        if (file.isFile()) list.push(join(file.parentPath, file.name));
      }
    } else {
      list.push(path);
    }
  }
  return list;
}

test("shipped core files have no node: specifiers or require calls", () => {
  const files = shippedFiles();
  assert.ok(files.length > 0);
  for (const file of files) assert.deepEqual(violations(readFileSync(file, "utf8")), [], file);
});

test("the shipped-file scan catches each banned form (negative control)", () => {
  assert.deepEqual(violations('import { types } from "node:util";'), ["node: specifier"]);
  assert.deepEqual(violations("const m = await import('node:fs');"), ["node: specifier"]);
  assert.deepEqual(violations('import "node:crypto";'), ["node: specifier"]);
  assert.deepEqual(violations('const fs = require("fs");'), ["require"]);
  assert.deepEqual(violations('import { redactV1 } from "./privacy/redact.mjs";'), []);
});

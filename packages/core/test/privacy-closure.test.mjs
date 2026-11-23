import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// Static, dynamic and side-effect `node:` specifiers in any quote style, plus
// CommonJS require calls. Comments are blanked first so that a comment between
// tokens cannot hide a form. A line comment starts only at a line start or after
// whitespace, so "https://…" inside a string is never treated as a comment.
const NODE_SPECIFIER = /(?:\bfrom|\bimport)\s*(?:\(\s*)?["'`]node:/u;
const REQUIRE_CALL = /\brequire\s*\(/u;

function withoutComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, " ")
    .replace(/(^|\s)\/\/[^\n]*/gu, "$1");
}

function violations(source) {
  const code = withoutComments(source);
  const found = [];
  if (NODE_SPECIFIER.test(code)) found.push("node: specifier");
  if (REQUIRE_CALL.test(code)) found.push("require");
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
  assert.deepEqual(violations('import { types } from /* comment */ "node:util";'), ["node: specifier"]);
  assert.deepEqual(violations("const m = await import(`node:fs`);"), ["node: specifier"]);
  assert.deepEqual(violations('import"node:crypto";'), ["node: specifier"]);
  assert.deepEqual(violations('const fs = require /* comment */ ("fs");'), ["require"]);
  assert.deepEqual(violations('const fs = require // comment\n("fs");'), ["require"]);
  assert.deepEqual(violations('const u = "https://example.test"; await import("node:fs");'), ["node: specifier"]);
  assert.deepEqual(violations('import { redactV1 } from "./privacy/redact.mjs";'), []);
  assert.deepEqual(violations('// import "node:fs" in a comment only'), []);
});

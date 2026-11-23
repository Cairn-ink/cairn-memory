import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// A regex cannot parse JavaScript, so this check does not try to tell code from
// comments or strings. Shipped core files may not contain the text `node:` or
// the word `require` anywhere, in code, comments or strings. Every literal
// import or require form is caught that way, however it is spaced or quoted.
// A specifier assembled at run time (for example "no" + "de:fs") is out of
// reach of any static scan; the closure rule in phase0.test.mjs and review
// cover that.
const NODE_TEXT = /node:/u;
const REQUIRE_WORD = /\brequire\b/u;

function violations(source) {
  const found = [];
  if (NODE_TEXT.test(source)) found.push("node: specifier");
  if (REQUIRE_WORD.test(source)) found.push("require");
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
  assert.deepEqual(violations('const note = " // sample"; await import("node:path");'), ["node: specifier"]);
  assert.deepEqual(violations('const fs = require// attached\n("fs");'), ["require"]);
  assert.deepEqual(violations('const fs = await import(// attached\n"node:fs"\n);'), ["node: specifier"]);
  assert.deepEqual(violations('import { types } from// attached\n"node:util";'), ["node: specifier"]);
  assert.deepEqual(violations("const n = `outer ${`inner // sample ${await import(\"node:path\")}`}`;"), ["node: specifier"]);
  assert.deepEqual(violations("const m = await import(`${`node:fs`}`);"), ["node: specifier"]);
  assert.deepEqual(violations('module["require"]("path");'), ["require"]);
  assert.deepEqual(violations('module.require?.("path");'), ["require"]);
  assert.deepEqual(violations('const start = "/*";\nawait import("node:fs");'), ["node: specifier"]);
  assert.deepEqual(violations('import { redactV1 } from "./privacy/redact.mjs";'), []);
  // Comments and strings count too: the text itself is banned.
  assert.deepEqual(violations('// import "node:fs" in a comment only'), ["node: specifier"]);
});

import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

// A regex cannot parse JavaScript, so this check does not try to tell code from
// comments or strings. The package is "type": "module", and in an ES module
// `require` and `module` do not exist, so a built-in can be reached only through
// a `node:` specifier, `createRequire` or `process.getBuiltinModule`. Shipped
// core files may not contain the text `node:` or either loader name anywhere,
// in code, comments or strings, and no shipped file may be CommonJS (.cjs).
// The scan reads the text both as written and with escapes decoded.
// A specifier assembled at run time (for example "no" + "de:fs") is out of
// reach of any static scan; the closure rule in phase0.test.mjs and review
// cover that.
const NODE_TEXT = /node:/u;
const LOADER_NAMES = /\b(?:createRequire|getBuiltinModule)\b/u;
const COMMONJS_FILE = /\.cjs$/u;

// Module code is strict, so legacy octal escapes cannot occur.
const SINGLE_ESCAPES = Object.freeze({ b: "\b", f: "\f", n: "\n", r: "\r", t: "\t", v: "\v", 0: "\0" });
const LINE_TERMINATORS = new Set(["\n", "\r", "\u2028", "\u2029"]);
const isHex = (text) => text.length > 0 && /^[0-9a-fA-F]+$/u.test(text);

// One left-to-right pass over every backslash, as JavaScript reads string and
// identifier escapes: line continuations vanish, \u{...} (any number of leading
// zeros), \uXXXX and \xXX become their code point, the single-character escapes
// become their control character, and any other escaped character stands for
// itself (identity escapes such as \: or \q).
function unescaped(source) {
  let out = "";
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (char !== "\\" || i + 1 >= source.length) { out += char; continue; }
    const next = source[i + 1];
    if (LINE_TERMINATORS.has(next)) {
      i += next === "\r" && source[i + 2] === "\n" ? 2 : 1;
      continue;
    }
    if (next === "u" && source[i + 2] === "{") {
      const close = source.indexOf("}", i + 3);
      const digits = close < 0 ? "" : source.slice(i + 3, close);
      const code = isHex(digits) ? Number.parseInt(digits, 16) : Number.NaN;
      if (code <= 0x10ffff) { out += String.fromCodePoint(code); i = close; continue; }
    } else if (next === "u" && isHex(source.slice(i + 2, i + 6)) && source.slice(i + 2, i + 6).length === 4) {
      out += String.fromCharCode(Number.parseInt(source.slice(i + 2, i + 6), 16));
      i += 5;
      continue;
    } else if (next === "x" && isHex(source.slice(i + 2, i + 4)) && source.slice(i + 2, i + 4).length === 2) {
      out += String.fromCharCode(Number.parseInt(source.slice(i + 2, i + 4), 16));
      i += 3;
      continue;
    }
    out += Object.hasOwn(SINGLE_ESCAPES, next) ? SINGLE_ESCAPES[next] : next;
    i += 1;
  }
  return out;
}

function violations(source) {
  const found = [];
  const texts = [source, unescaped(source)];
  if (texts.some((text) => NODE_TEXT.test(text))) found.push("node: specifier");
  if (texts.some((text) => LOADER_NAMES.test(text))) found.push("loader");
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

test("shipped core files have no node: specifiers, built-in loaders or CommonJS files", () => {
  const { type } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
  assert.equal(type, "module");
  const files = shippedFiles();
  assert.ok(files.length > 0);
  for (const file of files) {
    assert.equal(COMMONJS_FILE.test(file), false, file);
    assert.deepEqual(violations(readFileSync(file, "utf8")), [], file);
  }
});

test("the shipped-file scan catches each banned form (negative control)", () => {
  const node = ["node: specifier"];
  const loader = ["loader"];
  for (const source of [
    'import { types } from "node:util";',
    "const m = await import('node:fs');",
    'import "node:crypto";',
    'import"node:crypto";',
    'import { types } from /* comment */ "node:util";',
    "const m = await import(`node:fs`);",
    'const u = "https://example.test"; await import("node:fs");',
    'const note = " // sample"; await import("node:path");',
    'const fs = await import(// attached\n"node:fs"\n);',
    'import { types } from// attached\n"node:util";',
    "const n = `outer ${`inner // sample ${await import(\"node:path\")}`}`;",
    "const m = await import(`${`node:fs`}`);",
    'const start = "/*";\nawait import("node:fs");',
    'await import("n\\u006fde:fs");',
    'import "node\\x3afs";',
    'await import("no\\\nde:fs");',
    'await import("no\\\r\nde:fs");',
    'await import("node\\:fs");',
    'await import("\\u{000006e}ode:fs");',
    'await import("\\u{6E}\\x6fde:fs");',
    'await import("node\\u003afs");',
    '// import "node:fs" in a comment only',
  ]) assert.deepEqual(violations(source), node, source);
  for (const source of [
    'import { createRequire } from "./x.mjs";',
    "const load = globalThis.process.getBuiltinModule;",
    'process?.["getBuiltinModule"]?.("fs");',
    'const r = create\\u0052equire(import.meta.url);',
    'process.getBuiltin\\u{004D}odule("fs");',
    'process["getBuiltin\\Module"]("fs");',
  ]) assert.deepEqual(violations(source), loader, source);
  // In an ES module `require` is not defined and loads nothing; prose may use the word.
  for (const source of [
    'const fs = require("fs");',
    'const s = "prefix\\nrequ\\u0069re";',
    'const s = "a\\\\nrequire";',
    'const ns = "project\\u0000" + id;',
    'import { redactV1 } from "./privacy/redact.mjs";',
  ]) assert.deepEqual(violations(source), [], source);
  assert.equal(COMMONJS_FILE.test("src/legacy/loader.cjs"), true);
  assert.equal(COMMONJS_FILE.test("src/privacy/redact.mjs"), false);
});

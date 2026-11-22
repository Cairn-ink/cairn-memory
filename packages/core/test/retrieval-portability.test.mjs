import assert from "node:assert/strict";
import { appendFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const source = fileURLToPath(new URL("../src/retrieval/", import.meta.url));
const forbidden = /node:|\b(?:Buffer|process|fs|TextEncoder)\b|\b(?:require|import)\s*\(/u;

// Type imports in JSDoc are inert. The scan still catches dynamic imports in executable source.
function checkPortability(root) {
  const files = readdirSync(root, { recursive: true }).filter(name => /\.(?:mjs|mts|js|ts)$/u.test(name));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = readFileSync(join(root, file), "utf8").replace(/\/\*\*[\s\S]*?\*\//g, "");
    const match = forbidden.exec(source);
    assert.equal(match, null, file + " contains " + match?.[0]);
  }
}

test("retrieval sources use only portable runtime APIs", () => checkPortability(source));

test("the portability scan rejects a forbidden runtime token in a scratch copy", () => {
  const scratch = mkdtempSync(join(tmpdir(), "retrieval-portability-"));
  try {
    cpSync(source, scratch, { recursive: true });
    appendFileSync(join(scratch, "tokenize.mjs"), "\nvoid Buffer;\n");
    assert.throws(() => checkPortability(scratch), /tokenize\.mjs contains Buffer/);
  } finally {
    for (const name of readdirSync(scratch, { recursive: true }).reverse()) {
      const path = join(scratch, name);
      if (/\.(?:mjs|mts|js|ts)$/u.test(name)) unlinkSync(path);
      else rmdirSync(path);
    }
    rmdirSync(scratch);
  }
});

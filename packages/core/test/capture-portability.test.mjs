import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, readFileSync, writeFileSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const source = fileURLToPath(new URL('../src/capture/', import.meta.url));
const banned = [
  ['node:', /node:/u],
  ['Buffer', /\bBuffer\b/u],
  ['process', /\bprocess\b/u],
  ['performance', /\bperformance\b/u],
  ['require(', /\brequire\s*\(/u],
  ['import(', /\bimport\s*\(/u],
  ['setTimeout', /\bsetTimeout\b/u],
  ['setInterval', /\bsetInterval\b/u],
  ['fs', /\bfs\b/u],
];

function checkCaptureTree(root) {
  const files = readdirSync(root, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
  assert.ok(files.length > 0, 'capture source files');
  for (const file of files) {
    const path = join(file.parentPath, file.name);
    const text = readFileSync(path, 'utf8');
    const violations = banned.filter(([, pattern]) => pattern.test(text)).map(([token]) => token);
    assert.equal(violations.length, 0, relative(root, path) + ' uses ' + violations.join(', '));
  }
}

test('capture sources use no host imports, globals or timers', () => {
  checkCaptureTree(source);
});

test('capture portability check rejects a scratch copy with an injected host token', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'capture-portability-'));
  const file = join(scratch, 'deadline.mjs');
  try {
    copyFileSync(join(source, 'deadline.mjs'), file);
    assert.doesNotThrow(() => checkCaptureTree(scratch));
    writeFileSync(file, readFileSync(file, 'utf8') + '\nvoid performance;\n');
    assert.throws(() => checkCaptureTree(scratch), /deadline\.mjs uses performance/u);
  } finally {
    try { unlinkSync(file); }
    finally { rmdirSync(scratch); }
  }
});

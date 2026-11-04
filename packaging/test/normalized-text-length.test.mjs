import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { buildArtifact } from '../build.mjs';

test('packed core/index exports bounded-text helpers without an installation', t => {
  const artifact = buildArtifact();
  t.after(() => rmSync(dirname(artifact.artifactPath), { recursive: true, force: true }));
  const directory = mkdtempSync(join(tmpdir(), 'cairn-packed-normalized-length-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  execFileSync('tar', ['-xzf', artifact.artifactPath, '-C', directory]);
  return import(pathToFileURL(join(directory, 'package/core/index.mjs')).href).then(core => {
    assert.equal(core.normalizeBoundedText('  Ａ…\n中  '), 'A... 中');
    assert.equal(core.normalizedTextLength('  Ａ…\n中  '), 6);
    assert.throws(() => core.normalizedTextLength(''), error =>
      error instanceof core.MemoryStoreError && error.code === 'invalid_text');
  });
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import * as generated from '../src/capture/generated/prompts.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const script = 'scripts/generate-capture-prompts.mjs';
const modulePath = 'src/capture/generated/prompts.mjs';
const markdown = (name) => readFileSync(join(root, 'prompts', name + '.md'));

function runCheck(directory) {
  const result = spawnSync(process.execPath, [join(directory, script), '--check'], { encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.signal, null);
  return result;
}

for (const [name, exportName] of [
  ['extract-retained-sources', 'EXTRACT_RETAINED_SOURCES_PROMPT'],
  ['extract-source-windows', 'EXTRACT_SOURCE_WINDOWS_PROMPT'],
  ['qualify-memories', 'QUALIFY_MEMORIES_PROMPT'],
  ['reconcile-memories', 'RECONCILE_MEMORIES_PROMPT'],
]) {
  test(exportName + ' preserves the Markdown bytes', () => {
    assert.deepEqual(Buffer.from(generated[exportName]), markdown(name));
  });
}

test('inline qualification uses the shared guide and wrapper with one blank line', () => {
  const shared = markdown('qualify-candidates-shared').toString().trimEnd();
  const wrapper = markdown('qualify-candidates').toString().trimEnd();
  assert.equal(generated.QUALIFY_CANDIDATES_INLINE_PROMPT, shared + '\n\n' + wrapper);
});

test('capture prompt generator check passes for committed sources', () => {
  const { status, stderr } = runCheck(root);
  assert.equal(status, 0, stderr);
});

test('capture prompt generator check rejects a one-byte change in a scratch copy', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'capture-prompts-'));
  try {
    const prompts = readdirSync(join(root, 'prompts')).map((name) => join('prompts', name));
    for (const path of [script, modulePath, ...prompts]) {
      const copy = join(scratch, path);
      mkdirSync(dirname(copy), { recursive: true });
      copyFileSync(join(root, path), copy);
    }
    const copy = join(scratch, modulePath);
    const baseline = runCheck(scratch);
    assert.equal(baseline.status, 0, baseline.stderr);
    const bytes = readFileSync(copy);
    const offset = bytes.indexOf('EXTRACT_RETAINED_SOURCES_PROMPT');
    assert.ok(offset >= 0);
    bytes[offset] ^= 1;
    writeFileSync(copy, bytes);
    const { status, stderr } = runCheck(scratch);
    assert.equal(status, 1, stderr);
    assert.match(stderr, /Generated capture prompts are stale/u);
  } finally {
    const entries = readdirSync(scratch, { recursive: true, withFileTypes: true });
    for (const entry of entries.filter((entry) => !entry.isDirectory())) {
      unlinkSync(join(entry.parentPath, entry.name));
    }
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => join(entry.parentPath, entry.name));
    directories.sort((first, second) => second.length - first.length);
    for (const directory of directories) rmdirSync(directory);
    rmdirSync(scratch);
  }
});

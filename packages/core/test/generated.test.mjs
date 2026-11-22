import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { EXTRACT_MEMORIES_PROMPT } from '../src/generated/extract-memories-prompt.mjs';

const markdown = new URL('../../../core/prompts/extract-memories.md', import.meta.url);
const generated = new URL('../src/generated/extract-memories-prompt.mjs', import.meta.url);
const generator = fileURLToPath(new URL('../scripts/generate.mjs', import.meta.url));
const run = (script, ...args) => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });

test('generated extraction prompt preserves the canonical Markdown bytes', () => {
  assert.deepEqual(Buffer.from(EXTRACT_MEMORIES_PROMPT), readFileSync(markdown));
  const result = run(generator, '--check');
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
});

test('generator rejects stale output without rewriting it and regenerates identical bytes', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'memory-core-generator-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const prompts = join(workspace, 'core/prompts');
  const scripts = join(workspace, 'packages/core/scripts');
  const generatedDir = join(workspace, 'packages/core/src/generated');
  for (const path of [prompts, scripts, generatedDir]) mkdirSync(path, { recursive: true });
  const scriptCopy = join(scripts, 'generate.mjs');
  const output = join(generatedDir, 'extract-memories-prompt.mjs');
  copyFileSync(generator, scriptCopy);
  copyFileSync(markdown, join(prompts, 'extract-memories.md'));
  writeFileSync(output, 'stale\n');
  const stale = run(scriptCopy, '--check');
  assert.ifError(stale.error);
  assert.equal(stale.status, 1, stale.stderr);
  assert.equal(readFileSync(output, 'utf8'), 'stale\n');
  const rebuilt = run(scriptCopy);
  assert.ifError(rebuilt.error);
  assert.equal(rebuilt.status, 0, rebuilt.stderr);
  assert.deepEqual(readFileSync(output), readFileSync(generated));
});

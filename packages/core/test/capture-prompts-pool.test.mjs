import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { QUALIFY_CANDIDATES_POOL_PROMPT, QUALIFY_CANDIDATES_SHARED_PROMPT } from '../src/capture/generated/prompts.mjs';

const markdown = name => readFileSync(new URL(`../prompts/qualify-candidates-${name}.md`, import.meta.url));
const shared = markdown('shared');
const pool = markdown('pool');

test('generated qualification prompts preserve the source bytes with the specified trim', () => {
  assert.deepEqual(Buffer.from(QUALIFY_CANDIDATES_SHARED_PROMPT), Buffer.from(shared.toString('utf8').trimEnd()));
  const generatedWrapper = QUALIFY_CANDIDATES_POOL_PROMPT.slice(QUALIFY_CANDIDATES_SHARED_PROMPT.length + 2);
  assert.deepEqual(Buffer.from(generatedWrapper + '\n'), pool);
});

test('the pool prompt is composed from the shared guide and wrapper with one blank line', () => {
  assert.equal(QUALIFY_CANDIDATES_POOL_PROMPT, `${shared.toString('utf8').trimEnd()}\n\n${pool.toString('utf8').trimEnd()}`);
});

test('wire uses the generated pool prompt without an inlined wrapper', () => {
  const wire = readFileSync(new URL('../src/capture/wire.mjs', import.meta.url), 'utf8');
  assert.ok(wire.includes('${QUALIFY_CANDIDATES_POOL_PROMPT}'));
  assert.ok(!wire.includes(pool.toString('utf8').split('`', 1)[0]));
});

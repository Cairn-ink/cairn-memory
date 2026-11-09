import assert from 'node:assert/strict';
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { harness, oldTime, row } from './capture-window-harness.mjs';

const plugin = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  { name: 'zero start cursor', file: 'scripts/hook.mjs', before: 'cursor ?? { offset: size,', after: 'cursor ?? { offset: 0,',
    label: 'own start boundary', async probe(t, hookPath) {
      const f = await harness(t, { hookPath }); await f.write(row('copied')); await f.run('start');
      await appendFile(f.transcript, row('new', new Date().toISOString())); await f.run('capture');
      assert.deepEqual(f.captures.flatMap(body => body.messages.map(message => message.id)), ['new'], this.label);
    } },
  { name: 'ignored first-prompt cutoff', file: 'scripts/hook.mjs', before: 'if (fallback && markers.firstPromptAt)', after: 'if (false && markers.firstPromptAt)',
    label: 'first-prompt boundary', async probe(t, hookPath) {
      const f = await harness(t, { hookPath }); await f.write(row('copied')); await f.run('recall');
      await appendFile(f.transcript, row('new', new Date().toISOString())); await f.run('capture');
      assert.deepEqual(f.captures.flatMap(body => body.messages.map(message => message.id)), ['new'], this.label);
    } },
  { name: 'always-false initial', file: 'scripts/hook.mjs', before: 'const initial = cursor?.pendingEnd !== undefined ? windowInitial === true : fallback;', after: 'const initial = false;',
    label: 'initial on every retry slice', async probe(t, hookPath) {
      const f = await harness(t, { hookPath, fail: (_body, attempt) => attempt === 1 });
      await f.write(Array.from({ length: 25 }, (_, n) => row(`message-${n}`)).join(''));
      await f.run('capture'); await f.run('capture');
      assert.equal(f.captures.length, 3);
      assert.ok(f.captures.every(body => body.window?.initial === true), this.label);
    } },
  { name: 'retry-varying window ID', file: 'scripts/hook.mjs', before: 'JSON.stringify([hookInput.session_id, windowStart])', after: 'JSON.stringify([hookInput.session_id, windowStart, observedAt])',
    label: 'frozen retry window ID', async probe(t, hookPath) {
      const f = await harness(t, { hookPath, fail: (_body, attempt) => attempt === 1 });
      await f.write(row('message')); await f.run('capture'); await f.run('capture');
      assert.match(f.captures[0].window?.id ?? '', /^[a-f0-9]{64}$/, this.label);
      assert.equal(f.captures[0].window.id, f.captures[1].window.id, this.label);
    } },
  { name: 'message time from hook clock', file: 'lib/transcript.mjs', before: 'occurred_at: record.timestamp', after: 'occurred_at: new Date().toISOString()',
    label: 'exact source timestamp', async probe(t, hookPath) {
      const f = await harness(t, { hookPath }); await f.write(row('message')); await f.run('capture');
      assert.equal(f.captures[0].messages[0].occurred_at, oldTime, this.label);
    } },
  { name: 'numbering includes skipped batches', file: 'scripts/hook.mjs', before: 'slice: index - group + 1,', after: 'slice: Math.floor(window.findIndex(message => message.id === batch[0].id) / 24) + 1,',
    label: 'sent-only slice numbering', async probe(t, hookPath) {
      const f = await harness(t, { hookPath });
      await f.write(Array.from({ length: 24 }, (_, n) => row(`machine-${n}`, oldTime, { isMeta: true })).join('') + row('new'));
      await f.run('capture');
      assert.deepEqual(f.captures.map(body => [body.window?.slice, body.window?.slices]), [[1, 1]], this.label);
    } },
];

for (const mutation of cases) test(`capture contract catches ${mutation.name}`, async t => {
  // The same behavioral probe must pass on the actual runtime before its one
  // source mutation is allowed to count as a detected failure.
  await mutation.probe(t);
  const workspace = createTestWorkspace(t, { prefix: 'capture-mutant-' });
  const copy = join(workspace.path, 'plugin'); await mkdir(copy);
  for (const directory of ['lib', 'scripts']) await cp(join(plugin, directory), join(copy, directory), { recursive: true });
  const path = join(copy, mutation.file), source = await readFile(path, 'utf8');
  assert.equal(source.split(mutation.before).length - 1, 1, 'mutation target must be unique');
  await writeFile(path, source.replace(mutation.before, mutation.after));
  let caught;
  await assert.rejects(mutation.probe(t, join(copy, 'scripts/hook.mjs')), error => {
    caught = error;
    return error.code === 'ERR_ASSERTION' && error.message.includes(mutation.label);
  }, `mutation survived: ${mutation.name}`);
  t.diagnostic(`caught assertion: ${mutation.label}; code=${caught.code}`);
});

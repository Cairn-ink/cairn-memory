import assert from 'node:assert/strict';
import { appendFile, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { forgetThenFork, harness, oldTime, row } from './capture-window-harness.mjs';

const plugin = fileURLToPath(new URL('../', import.meta.url));
const cases = [
  { name: 'forget fork time replaced by arrival', file: 'lib/transcript.mjs',
    before: 'occurred_at: record.timestamp', after: 'occurred_at: new Date().toISOString()',
    label: 'forget fork original source times', async probe(t, hookPath) { await forgetThenFork(t, hookPath); } },
  { name: 'unvalidated source time', file: 'lib/transcript.mjs',
    before: 'sourceTimestamp(record.timestamp)', after: 'typeof record.timestamp === "string"',
    label: 'invalid source time omitted', async probe(t, hookPath) {
      const f = await harness(t, { hookPath, strictTimes: true });
      await f.write(row('message', 'not-a-date')); await f.run('capture');
      assert.equal(Object.hasOwn(f.captures[0].messages[0], 'occurred_at'), false, this.label);
      assert.equal((await f.state()).pendingEnd, undefined, this.label);
    } },
  { name: 'zero start cursor', file: 'scripts/hook.mjs', before: 'offset: size, generation, discardUntilNewline: size > 0', after: 'offset: 0, generation, discardUntilNewline: size > 0',
    label: 'own start boundary', async probe(t, hookPath) {
      const f = await harness(t, { hookPath }); await f.write(row('copied')); await f.run('start-boundary');
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
  { name: 'no first-prompt margin', file: 'scripts/hook.mjs',
    before: 'Date.parse(firstPromptAt) - FIRST_PROMPT_MARGIN_MS', after: 'Date.parse(firstPromptAt)',
    label: 'current prompt survives startup latency', async probe(t, hookPath) {
      const f = await harness(t, { hookPath, observedAt: '2026-01-02T03:04:05.100Z' });
      await f.write(row('first', '2026-01-02T03:04:05.000Z')); await f.run('recall'); await f.run('capture');
      assert.deepEqual(f.captures.flatMap(b => b.messages.map(m => m.id)), ['first'], this.label);
    } },
  { name: 'late EOF despite first-prompt marker', file: 'scripts/hook.mjs',
    before: 'if (cursor || markers.startOffset !== undefined || markers.firstPromptAt || markers.captureSeen) return;',
    after: 'if (cursor || markers.startOffset !== undefined || markers.captureSeen) return;',
    label: 'late boundary preserves prompt', async probe(t, hookPath) {
      const f = await harness(t, { hookPath }); await f.write(''); await f.run('recall');
      await f.write(row('first', new Date().toISOString())); await f.run('start-boundary'); await f.run('capture');
      assert.deepEqual(f.captures.flatMap(b => b.messages.map(m => m.id)), ['first'], this.label);
    } },
  { name: 'empty capture leaves no evidence', file: 'scripts/hook.mjs',
    before: 'if (!markers.captureSeen) {', after: 'if (false) {',
    label: 'empty capture protects later bytes', async probe(t, hookPath) {
      const f = await harness(t, { hookPath }); await f.write(''); await f.run('capture');
      await f.write(row('first')); await f.run('start-boundary'); await f.run('capture');
      assert.deepEqual(f.captures.flatMap(b => b.messages.map(m => m.id)), ['first'], this.label);
      assert.equal(f.captures[0].window.initial, true, this.label);
    } },
  { name: 'later recall marker used after capture', file: 'scripts/hook.mjs',
    before: 'if (current.captureSeen === true) return;', after: 'if (false) return;',
    label: 'late recall cannot skip earlier turns', async probe(t, hookPath) {
      const f = await harness(t, { hookPath }); await f.write(''); await f.run('capture');
      await f.write(row('first')); await f.run('recall'); await f.run('capture');
      assert.deepEqual(f.captures.flatMap(b => b.messages.map(m => m.id)), ['first'], this.label);
      assert.equal(f.captures[0].window.initial, true, this.label);
    } },
  { name: 'slice beyond total accepted', file: 'lib/hosted-contract.mjs',
    before: 'value.window.slice > value.window.slices', after: 'false',
    label: 'slice must not exceed total', async probe(_t, hookPath) {
      const path = hookPath ? pathToFileURL(join(hookPath, '../../lib/hosted-contract.mjs')) : new URL('../lib/hosted-contract.mjs', import.meta.url);
      const { conforms } = await import(path);
      const body = { client: 'claude-code', event_id: 'synthetic-event', session_id: 'session',
        messages: [{ id: 'message', role: 'user', content: 'Synthetic message' }], window: { id: 'a', slice: 1, slices: 1, initial: true } };
      assert.equal(conforms('capture-request', body), true, this.label);
      assert.equal(conforms('capture-request', { ...body, window: { ...body.window, slice: 2 } }), false, this.label);
    } },
  { name: 'grouping cap ignored', file: 'scripts/hook.mjs',
    before: 'Math.floor(index / CAPTURE_WINDOW_SLICES) * CAPTURE_WINDOW_SLICES',
    after: '0', label: 'grouping limit respected', async probe(t, hookPath) {
      const f = await harness(t, { hookPath, groupingLimit: 2 });
      await f.write(Array.from({ length: 49 }, (_, n) => row(`message-${n}`)).join('')); await f.run('capture');
      assert.deepEqual(f.captures.map(b => [b.window.slice, b.window.slices]), [[1, 2], [2, 2], [1, 1]], this.label);
      assert.notEqual(f.captures[0].window.id, f.captures[2].window.id, this.label);
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

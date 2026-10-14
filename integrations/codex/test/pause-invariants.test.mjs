import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, header, item } from './helpers.mjs';
import { runWorker, establishPauseBoundary } from '../worker.mjs';
import { readControlState, setPaused } from '../../client/control-state.mjs';
import { withFileLock } from '../../client/file-lock.mjs';

// The three pause invariants, at the worker. These use only modules that every
// earlier version of this branch has, so they also run against those versions.
// Plugins that predate control.json pause by creating only the `paused` marker and
// resume by deleting it.
const PAUSED = 'Written while paused';
const run = f => runWorker(f.binding, { guard: f.guard, transport: f.transport });
const sent = f => [...f.receiver.values()].flatMap(x => x.messages.map(m => m.content));
const marker = f => join(f.root, 'paused');
const legacyPause = f => writeFile(marker(f), 'paused\n', { mode: 0o600 });
const legacyResume = f => unlink(marker(f));
const held = (f, work) => withFileLock(join(f.root, 'control.lock'), work, { timeoutMs: 2_000 });
async function neverSent(f) {
  for (let i = 0; i < 3; i++) await run(f);
  assert.ok(!JSON.stringify(f.calls).includes(PAUSED), 'paused text was sent');
}
// A session already captured once, so its cursor sits on the current generation;
// `control` first gives the root a control.json, otherwise it has none.
async function seen(t, { control = true } = {}) {
  const f = await fixture(t);
  if (control) { await setPaused(f.root, true); await setPaused(f.root, false); }
  await run(f);
  await appendFile(f.path, item('Before pause'));
  await run(f);
  assert.deepEqual(sent(f), ['Before pause']);
  return f;
}

test('invariant 1: the 0.5.3 draft repro (stamped activation, unseen session from 2,000 ms, observed legacy pause)', async t => {
  const f = await fixture(t);
  await setPaused(f.root, true);
  const { generation } = await setPaused(f.root, false);
  await writeFile(join(f.root, 'control.json'), JSON.stringify({ version: 1, paused: false, generation, activeSince: 1_000 }));
  await legacyPause(f);
  await writeFile(f.path, header({ timestamp: '1970-01-01T00:00:02.000Z' }) + item(PAUSED));
  assert.equal((await run(f)).status, 'paused');
  await legacyResume(f);
  await neverSent(f);
});

for (const [name, afterResume] of [['during the pause', false], ['during the pause and the first run after it', true]])
  test(`invariant 1: an observed legacy pause with control.lock held ${name}`, async t => {
    const f = await seen(t);
    await legacyPause(f);
    await appendFile(f.path, item(PAUSED, 1));
    await held(f, async () => { assert.equal((await run(f)).status, 'paused'); });
    await legacyResume(f);
    if (afterResume) await held(f, async () => { await run(f); });
    await neverSent(f);
  });

for (const [name, setup] of [
  ['an existing cursor', t => seen(t)],
  ['an existing cursor after a resume while active', async t => {
    const f = await seen(t);
    await setPaused(f.root, false);
    return f;
  }],
  ['a root without control.json and an existing cursor', t => seen(t, { control: false })],
  ['a root without control.json and an unseen session', t => fixture(t, { observed: false })],
]) test(`invariant 1: a legacy pause no Codex run observes, with ${name}`, async t => {
  const f = await setup(t);
  await legacyPause(f);
  await appendFile(f.path, item(PAUSED, 1));
  await legacyResume(f);
  await neverSent(f);
});

test('invariant 1: a pause and resume through control.json', async t => {
  const f = await seen(t);
  await setPaused(f.root, true);
  await appendFile(f.path, item(PAUSED, 1));
  assert.equal((await run(f)).status, 'paused');
  await setPaused(f.root, false);
  await neverSent(f);
});

for (const [name, pause, resume] of [
  ['deleting the legacy marker', legacyPause, legacyResume],
  ['setPaused (either tool)', f => setPaused(f.root, true), f => setPaused(f.root, false)],
]) test(`invariant 2: ${name} resumes every tool, and Codex never rewrites control.json`, async t => {
  const f = await seen(t);
  await pause(f);
  const shared = await readFile(join(f.root, 'control.json'), 'utf8');
  await appendFile(f.path, item(PAUSED, 1));
  assert.equal((await run(f)).status, 'paused');
  assert.equal(await readFile(join(f.root, 'control.json'), 'utf8'), shared);
  await resume(f);
  assert.equal((await readControlState(f.root)).paused, false);
  // Resume semantics: the first run after it is the boundary; later text is captured.
  await run(f);
  await appendFile(f.path, item('After resume', 2));
  await run(f);
  assert.deepEqual(sent(f), ['Before pause', 'After resume']);
});

for (const [name, pause, resume] of [
  ['setPaused', f => setPaused(f.root, true), f => setPaused(f.root, false)],
  ['the legacy marker', legacyPause, legacyResume],
]) test(`invariant 3: a session that begins after a resume through ${name} keeps its first turn`, async t => {
  const f = await fixture(t, { text: '', observed: false });
  await pause(f);await resume(f);
  // Codex writes the header and runs UserPromptSubmit before it records the prompt.
  await writeFile(f.path, header());
  await establishPauseBoundary(f.binding);
  await appendFile(f.path, item('First turn'));
  await run(f);
  assert.deepEqual(sent(f), ['First turn']);
});

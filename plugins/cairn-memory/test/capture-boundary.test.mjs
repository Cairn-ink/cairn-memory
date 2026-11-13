import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { join } from 'node:path';
import test from 'node:test';
import { setPaused } from '../lib/control-state.mjs';
import { withFileLock } from '../lib/file-lock.mjs';
import { forgetThenFork, harness, oldTime, row } from './capture-window-harness.mjs';

test('start boundaries exclude copied UUIDs and timestamps from the first capture', async t => {
  const f = await harness(t);
  const copied = row('copied-1') + row('copied-2');
  await f.write(copied); await boundedStart(f, { source: 'resume' });
  assert.deepEqual(await readdir(f.dataDir), ['sessions']);
  assert.equal(f.captures.length, 0);
  let state;
  try { state = await f.state(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await appendFile(f.transcript, row('new', new Date().toISOString()));
  await f.run('capture');
  assert.deepEqual(f.captures.flatMap(body => body.messages.map(m => m.id)), ['new']);
  assert.equal(state.startOffset, Buffer.byteLength(copied));
  assert.equal(state.offset, state.startOffset); assert.ok(Date.parse(state.startedAt));
});

async function boundedStart(f, extra = {}) {
  let timer;
  try {
    await Promise.race([f.run('start-boundary', extra), new Promise((_, reject) => {
      timer = setTimeout(() => reject(new assert.AssertionError({ message: 'start lock acquisition is bounded' })), 1500);
    })]);
  } finally { clearTimeout(timer); }
}

test('existing cursors return without waiting for a held capture lock', { timeout: 5000 }, async t => {
  const f = await harness(t); await f.write(row('old'));
  await mkdir(dirname(f.statePath), { recursive: true });
  const original = { offset: 0, generation: 'initial', pendingEnd: Buffer.byteLength(row('old')), windowInitial: true };
  await writeFile(f.statePath, JSON.stringify(original));
  await withFileLock(f.statePath + '.lock', async () => {
    const before = performance.now();
    await boundedStart(f, { source: 'resume' });
    assert.ok(performance.now() - before < 1500);
    assert.deepEqual(await f.state(), original);
  });
  await f.run('capture'); assert.equal(f.captures[0].messages[0].id, 'old');
});

test('recall fallback skips only the dated copied prefix when start did not run', async t => {
  const f = await harness(t); await f.write(row('copied-1') + row('copied-2'));
  await f.run('recall');
  let marker;
  try { marker = await f.state(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await appendFile(f.transcript, row('new', new Date().toISOString()) + row('late-old-date', oldTime));
  await f.run('capture');
  assert.deepEqual(f.captures.flatMap(body => body.messages.map(m => m.id)), ['new', 'late-old-date']);
  assert.ok(Date.parse(marker.firstPromptAt));
});

test('recall skips a busy first-capture lock and publishes once after release', { timeout: 15000 }, async t => {
  const f = await harness(t); await f.write('');
  await withFileLock(f.statePath + '.lock', async () => {
    await f.run('recall');
    await assert.rejects(readFile(f.statePath, 'utf8'), { code: 'ENOENT' });
  });
  await f.run('recall');
  const first = await readFile(f.statePath, 'utf8');
  assert.ok(JSON.parse(first).firstPromptAt);
  await f.run('recall');
  assert.equal(await readFile(f.statePath, 'utf8'), first);
  assert.equal(f.recalls.length, 3);
});

test('recall adds one marker to an existing start cursor and preserves its boundary', async t => {
  const f = await harness(t); await f.write(''); await f.run('start-boundary');
  const before = await f.state();
  await f.run('recall');
  const marked = await f.state();
  assert.ok(Date.parse(marked.firstPromptAt));
  const { firstPromptAt, ...cursor } = marked;
  assert.deepEqual(cursor, before);
  await f.run('recall');
  assert.deepEqual(await f.state(), marked);
});

test('recall never waits to add a marker to a cursor held by capture', { timeout: 15000 }, async t => {
  const f = await harness(t); await f.write(''); await f.run('start-boundary');
  const before = await f.state();
  await withFileLock(f.statePath + '.lock', async () => {
    await f.run('recall');
    assert.deepEqual(await f.state(), before);
  });
  await f.run('recall');
  assert.ok(Date.parse((await f.state()).firstPromptAt));
});

test('missing and empty transcripts at start permit the complete first turn', async t => {
  for (const exists of [false, true]) {
    const f = await harness(t); if (exists) await f.write('');
    await f.run('start-boundary');
    if (exists) assert.equal((await f.state()).startOffset, 0);
    await f.write(row('first', new Date().toISOString())); await f.run('capture');
    assert.deepEqual(f.captures.flatMap(body => body.messages.map(m => m.id)), ['first']);
  }
});

test('partial copied EOF is discarded through its newline', async t => {
  const f = await harness(t); const partial = row('copied').trimEnd().slice(0, -1);
  await f.write(partial); await f.run('start-boundary');
  assert.equal((await f.state()).discardUntilNewline, true);
  await appendFile(f.transcript, '}\n' + row('new', new Date().toISOString())); await f.run('capture');
  assert.deepEqual(f.captures[0].messages.map(m => m.id), ['new']);
});

test('compact and same-id resume preserve pending bytes and the original start marker', async t => {
  for (const source of ['compact', 'resume']) {
    const f = await harness(t); await f.write(''); await f.run('start-boundary');
    const original = await f.state(); await appendFile(f.transcript, row('pending'));
    await f.run('start-boundary', { source });
    assert.equal((await f.state()).offset, 0);
    assert.equal((await f.state()).startedAt, original.startedAt);
    await f.run('capture'); assert.equal(f.captures[0].messages[0].id, 'pending');
  }
});

test('a startOffset without a usable cursor still establishes the byte boundary', async t => {
  const f = await harness(t); const copied = row('copied');
  await f.write(copied + row('new'));
  await mkdir(dirname(f.statePath), { recursive: true });
  await writeFile(f.statePath, JSON.stringify({ startOffset: Buffer.byteLength(copied), startedAt: oldTime }));
  await f.run('capture'); assert.deepEqual(f.captures[0].messages.map(m => m.id), ['new']);
});

// Exact UTF-8 bytes, including both LF terminators: [0,119), [119,235).
const firstTurn = '{"type":"user","uuid":"u1","timestamp":"2026-11-10T00:00:00.000Z","message":{"content":"Remember my new preference."}}\n' +
  '{"type":"assistant","uuid":"a1","timestamp":"2026-11-10T00:00:01.000Z","message":{"content":"I will remember it."}}\n';
const promptTime = '2026-11-10T00:00:00.100Z';
function sentTurn(f) {
  assert.deepEqual(f.captures.flatMap(b => b.messages.map(m => m.id)), ['u1', 'a1']);
  assert.ok(f.captures.every(b => b.window.initial === true));
  assert.deepEqual(f.captures.flatMap(b => b.messages.map(m => m.occurred_at)),
    ['2026-11-10T00:00:00.000Z', '2026-11-10T00:00:01.000Z']);
}
test('the first submitted record before recall process startup is retained', async t => {
  assert.equal(Buffer.byteLength(firstTurn), 235);
  assert.equal(Buffer.byteLength(firstTurn.split('\n')[0] + '\n'), 119);
  const f = await harness(t, { observedAt: promptTime });
  await f.write(firstTurn); await f.run('recall');
  assert.equal((await f.state()).firstPromptAt, promptTime);
  await f.run('capture'); sentTurn(f);
});
for (const emptyCapture of [false, true]) test(`delayed boundary after recall preserves turn; empty capture=${emptyCapture}`, async t => {
  const f = await harness(t, { observedAt: promptTime });
  await f.write(''); await f.run('recall');
  if (emptyCapture) await f.run('capture');
  await f.write(firstTurn); await f.run('start'); await f.run('start-boundary'); await f.run('capture'); sentTurn(f);
});
test('empty capture prevents a late boundary from claiming EOF without recall', async t => {
  const f = await harness(t); await f.write(''); await f.run('capture');
  assert.equal((await f.state()).captureSeen, true);
  await f.write(firstTurn); await f.run('start'); await f.run('start-boundary'); await f.run('capture'); sentTurn(f);
});
test('a later recall after an empty capture cannot supply a skipping marker', async t => {
  const f = await harness(t, { observedAt: '2026-11-10T01:00:00.000Z' });
  // First recall loses its try-only attempt while a start stat has no file.
  await withFileLock(f.statePath + '.lock', async () => { await f.run('recall'); });
  await f.write(''); await f.run('capture');
  await f.write(firstTurn); await f.run('recall'); await f.run('capture'); sentTurn(f);
});
test('only a copied prefix older than the ten-minute margin is withheld', async t => {
  const f = await harness(t, { observedAt: promptTime });
  await f.write(row('outside', '2026-11-09T23:50:00.099Z') +
    row('edge', '2026-11-09T23:50:00.100Z') + row('inside', '2026-11-09T23:59:00.000Z') + firstTurn);
  await f.run('recall'); await f.run('capture');
  assert.deepEqual(f.captures.flatMap(b => b.messages.map(m => m.id)), ['edge', 'inside', 'u1', 'a1']);
  assert.ok(f.captures.every(b => b.window.initial === true));
});
test('new boundary fails open promptly on lock contention', { timeout: 5000 }, async t => {
  const f = await harness(t); await f.write(row('copied'));
  await withFileLock(f.statePath + '.lock', async () => {
    const before = performance.now(); await boundedStart(f);
    assert.ok(performance.now() - before < 1500);
    await assert.rejects(readFile(f.statePath), { code: 'ENOENT' });
  });
});
test('SessionStart has a synchronous local boundary and separate async work', async () => {
  const config = JSON.parse(await readFile(new URL('../hooks/hooks.json', import.meta.url), 'utf8'));
  const hooks = config.hooks.SessionStart.flatMap(entry => entry.hooks);
  assert.deepEqual(Object.fromEntries(Object.entries(config.hooks).map(([name, groups]) =>
    [name, groups.flatMap(group => group.hooks).length])),
    { SessionStart: 2, UserPromptSubmit: 1, Stop: 1, PreCompact: 1 });
  assert.deepEqual(hooks.map(h => h.args?.[1]), ['start-boundary', 'start']);
  const boundary = hooks.find(h => h.args?.[1] === 'start-boundary');
  assert.ok(boundary); assert.notEqual(boundary.async, true); assert.equal(boundary.timeout, 2);
  assert.equal(hooks.find(h => h.args?.[1] === 'start').async, true);
});

test('invalid session state leaves the start boundary unknown and retains the turn', async t => {
  for (const bytes of ['{', 'null']) {
    const f = await harness(t); await f.write(firstTurn);
    await mkdir(dirname(f.statePath), { recursive: true });
    await writeFile(f.statePath, bytes);
    await f.run('start-boundary');
    assert.equal(await readFile(f.statePath, 'utf8'), bytes);
    await f.run('capture'); sentTurn(f);
  }
});

test('remember then forget then new-id fork retains copied times and initial classification', async t => {
  await forgetThenFork(t);
});

for (const prompt of [false, true]) test(`pending start excludes recently copied history; recall=${prompt}`, async t => {
  const startedAt = '2026-11-10T00:05:00.000Z';
  const f = await harness(t, { observedAt: startedAt });
  await f.run('recall', { session_id: 'synthetic-observer' });
  await setPaused(f.dataDir, true); await setPaused(f.dataDir, false);
  await f.run('start-boundary');
  if (prompt) await f.run('recall');
  await f.write(row('copied-user', '2026-11-10T00:04:00.000Z') +
    row('copied-assistant', '2026-11-10T00:04:01.000Z', { type: 'assistant' }) +
    row('first-user', startedAt) + row('first-assistant', startedAt, { type: 'assistant' }));
  await f.run('capture');
  assert.deepEqual(f.captures.flatMap(body => body.messages.map(m => m.id)), ['first-user', 'first-assistant']);
  assert.ok(f.captures.every(body => body.window.initial === true));
  assert.equal((await f.state()).startPending, undefined);
});

test('pending start clock tolerance retains its edge and later old-dated records', async t => {
  const f = await harness(t, { observedAt: '2026-11-10T00:05:00.000Z' });
  await f.run('recall', { session_id: 'synthetic-observer' });
  await setPaused(f.dataDir, true); await setPaused(f.dataDir, false);
  await f.run('start-boundary'); await f.run('recall');
  await f.write(row('copied', '2026-11-10T00:04:54.999Z') +
    row('tolerance-edge', '2026-11-10T00:04:55.000Z') + row('later-old', oldTime));
  await f.run('capture');
  assert.deepEqual(f.captures.flatMap(body => body.messages.map(m => m.id)), ['tolerance-edge', 'later-old']);
});

test('malformed pending start fields carry no post-pause authority', async t => {
  for (const invalid of [{ startPending: 'true' }, { startGeneration: 1 }, { startGeneration: '' },
    { startedAt: 1 }, { startedAt: 'invalid' }, { startedAt: undefined }]) {
    const f = await harness(t);
    await setPaused(f.dataDir, true); const control = await setPaused(f.dataDir, false);
    await mkdir(dirname(f.statePath), { recursive: true });
    await writeFile(f.statePath, JSON.stringify({ startPending: true, startGeneration: control.generation,
      startedAt: new Date().toISOString(), ...invalid }));
    await f.run('recall'); await f.write(row('untrusted', new Date().toISOString())); await f.run('capture');
    assert.deepEqual(f.captures, []);
  }
});

test('invalid control state and a lost start lock cannot create pending authority', async t => {
  const f = await harness(t);
  await f.run('recall', { session_id: 'synthetic-observer' });
  await writeFile(join(f.dataDir, 'control.json'), '{');
  await f.run('start-boundary'); await assert.rejects(f.state(), { code: 'ENOENT' });
  await setPaused(f.dataDir, true); await setPaused(f.dataDir, false);
  await withFileLock(f.statePath + '.lock', async () => {
    await boundedStart(f); await assert.rejects(f.state(), { code: 'ENOENT' });
  });
  await f.run('recall'); await f.write(row('lost-start', new Date().toISOString())); await f.run('capture');
  assert.deepEqual(f.captures, []);
});


test('pending start stays content-free through recall and an empty capture until a real cursor retires it', async t => {
  const startedAt = '2026-11-10T00:05:00.000Z';
  const f = await harness(t, { observedAt: startedAt });
  await f.run('recall', { session_id: 'synthetic-observer' });
  await setPaused(f.dataDir, true); const control = await setPaused(f.dataDir, false);
  await f.run('start-boundary');
  const pending = { startPending: true, startGeneration: control.generation, startedAt };
  assert.deepEqual(await f.state(), pending);
  await f.run('recall'); await f.write(''); await f.run('capture');
  assert.deepEqual(await f.state(), { ...pending, firstPromptAt: startedAt, captureSeen: true });
  await f.write(row('first', startedAt));
  for (const source of ['startup', 'resume', 'compact']) await f.run('start-boundary', { source });
  assert.deepEqual(await f.state(), { ...pending, firstPromptAt: startedAt, captureSeen: true });
  await f.run('capture');
  assert.deepEqual(f.captures.flatMap(body => body.messages.map(m => m.id)), ['first']);
  const state = await f.state();
  assert.equal(state.startPending, undefined); assert.equal(state.startGeneration, undefined);
  assert.equal(state.startedAt, startedAt); assert.equal(state.offset, Buffer.byteLength(row('first', startedAt)));
});

test('an exhausted SessionStart budget leaves no post-pause start authority', async t => {
  const f = await harness(t, { mutateRuntime: source => {
    const needle = 'const START_BOUNDARY_BUDGET_MS = 300;';
    assert.equal(source.split(needle).length, 2);
    return source.replace(needle, 'const START_BOUNDARY_BUDGET_MS = 0;');
  } });
  await f.run('recall', { session_id: 'synthetic-observer' });
  await setPaused(f.dataDir, true); await setPaused(f.dataDir, false);
  await boundedStart(f); await assert.rejects(f.state(), { code: 'ENOENT' });
  await f.run('recall'); await f.write(row('budget-exit', new Date().toISOString())); await f.run('capture');
  assert.deepEqual(f.captures, []);
});

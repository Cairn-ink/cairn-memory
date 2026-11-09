import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import test from 'node:test';
import { withFileLock } from '../lib/file-lock.mjs';
import { harness, oldTime, row } from './capture-window-harness.mjs';

test('start boundaries exclude copied UUIDs and timestamps from the first capture', async t => {
  const f = await harness(t);
  const copied = row('copied-1') + row('copied-2');
  await f.write(copied); await boundedStart(f, { source: 'resume' });
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
  const boundary = hooks.find(h => h.args?.[1] === 'start-boundary');
  assert.ok(boundary); assert.notEqual(boundary.async, true); assert.equal(boundary.timeout, 2);
  assert.equal(hooks.find(h => h.args?.[1] === 'start').async, true);
});

import assert from 'node:assert/strict';
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import test from 'node:test';
import { withFileLock } from '../lib/file-lock.mjs';
import { harness, oldTime, row } from './capture-window-harness.mjs';

test('start boundaries exclude copied UUIDs and timestamps from the first capture', async t => {
  const f = await harness(t);
  const copied = row('copied-1') + row('copied-2');
  await f.write(copied); await f.run('start-boundary', { source: 'resume' });
  let state;
  try { state = await f.state(); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await appendFile(f.transcript, row('new', new Date().toISOString()));
  await f.run('capture');
  assert.deepEqual(f.captures.flatMap(body => body.messages.map(m => m.id)), ['new']);
  assert.equal(state.startOffset, Buffer.byteLength(copied));
  assert.equal(state.offset, state.startOffset); assert.ok(Date.parse(state.startedAt));
});

test('existing cursors return without waiting for a held capture lock', { timeout: 5000 }, async t => {
  const f = await harness(t); await f.write(row('old'));
  await mkdir(dirname(f.statePath), { recursive: true });
  const original = { offset: 0, generation: 'initial', pendingEnd: Buffer.byteLength(row('old')), windowInitial: true };
  await writeFile(f.statePath, JSON.stringify(original));
  await withFileLock(f.statePath + '.lock', async () => {
    const before = performance.now();
    await f.run('start-boundary', { source: 'resume' });
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

test('new boundary fails open promptly on lock contention', { timeout: 5000 }, async t => {
  const f = await harness(t); await f.write(row('copied'));
  await withFileLock(f.statePath + '.lock', async () => {
    const before = performance.now(); await f.run('start-boundary');
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

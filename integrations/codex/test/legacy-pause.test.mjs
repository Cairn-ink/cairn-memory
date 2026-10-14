import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile, readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, header, item } from './helpers.mjs';
import { runWorker } from '../worker.mjs';
import { readControlState, setPaused } from '../../client/control-state.mjs';

// Plugins that predate control.json pause by creating only the `paused` marker and
// resume by deleting it. These use only modules that predate this fix, so they
// also run against the code before it.
const marker = f => join(f.root, 'paused');
const pause = f => writeFile(marker(f), 'paused\n', { mode: 0o600 });
const run = f => runWorker(f.binding, { guard: f.guard, transport: f.transport });
const captured = f => [...f.receiver.values()].flatMap(x => x.messages.map(m => m.content));
const size = async f => Buffer.byteLength(await readFile(f.path));

test('reviewer scenario: activation at 1,000 ms, legacy pause, unseen session from 2,000 ms, marker removed: nothing paused is uploaded', async t => {
  const f = await fixture(t);
  await setPaused(f.root, true);
  const { generation } = await setPaused(f.root, false);
  // The activation stamp an earlier 0.5.3 draft trusted; a released control ignores it.
  await writeFile(join(f.root, 'control.json'), JSON.stringify({ version: 1, paused: false, generation, activeSince: 1_000 }));
  await pause(f);
  await writeFile(f.path, header({ timestamp: '1970-01-01T00:00:02.000Z' }) + item('Written while paused'));
  assert.equal((await run(f)).status, 'paused');
  await unlink(marker(f));
  await run(f);
  assert.equal(f.calls.length, 0);assert.deepEqual(captured(f), []);
  // Only an explicit resume lifts it, and the first run after it is the boundary.
  await setPaused(f.root, false);
  assert.equal((await run(f)).status, 'pause_boundary');
  assert.equal((await f.cursor()).skipped.pause_boundary, await size(f));
  await appendFile(f.path, item('After resume', 1));
  await run(f);
  assert.deepEqual(captured(f), ['After resume']);
});

test('a session already captured before a legacy pause uploads nothing written during it', async t => {
  const f = await fixture(t);
  await setPaused(f.root, true); await setPaused(f.root, false);
  assert.equal((await run(f)).status, 'pause_boundary');
  await appendFile(f.path, item('Before pause'));
  await run(f);
  await pause(f);
  await appendFile(f.path, item('Written while paused', 1));
  assert.equal((await run(f)).status, 'paused');
  await unlink(marker(f));
  await run(f);
  assert.deepEqual(captured(f), ['Before pause']);
  await setPaused(f.root, false);
  assert.equal((await run(f)).status, 'pause_boundary');
  await appendFile(f.path, item('After resume', 2));
  await run(f);
  assert.deepEqual(captured(f), ['Before pause', 'After resume']);
});

test('a legacy pause before any control.json still keeps paused text out', async t => {
  const f = await fixture(t);
  assert.equal((await readControlState(f.root)).generation, 'initial');
  await pause(f);
  await writeFile(f.path, header() + item('Written while paused'));
  assert.equal((await run(f)).status, 'paused');
  await unlink(marker(f));
  await run(f);
  assert.deepEqual(captured(f), []);
  await setPaused(f.root, false);
  assert.equal((await run(f)).status, 'pause_boundary');
  assert.deepEqual(captured(f), []);
});

test('a legacy pause no Codex run observed leaves an unseen session behind the first boundary', async t => {
  const f = await fixture(t);
  await setPaused(f.root, true);
  const { generation } = await setPaused(f.root, false);
  await writeFile(join(f.root, 'control.json'), JSON.stringify({ version: 1, paused: false, generation, activeSince: 1_000 }));
  await pause(f);
  await writeFile(f.path, header({ timestamp: '1970-01-01T00:00:02.000Z' }) + item('Written while paused'));
  await unlink(marker(f));
  assert.equal((await run(f)).status, 'pause_boundary');
  assert.equal(f.calls.length, 0);
  await appendFile(f.path, item('After the boundary', 1));
  await run(f);
  assert.deepEqual(captured(f), ['After the boundary']);
});

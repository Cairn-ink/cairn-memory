import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './helpers.mjs';
import { holdMarkerPause } from '../pause-marker.mjs';
import { establishPauseBoundary } from '../worker.mjs';
import { readControlState, setPaused } from '../../client/control-state.mjs';

const control = f => join(f.root, 'control.json');
const bytes = f => readFile(control(f), 'utf8').catch(error => error.code);

test('only a marker-only pause is written down, under the generation it already reads as', async t => {
  const f = await fixture(t);
  // Active, with or without control.json: nothing to keep.
  await holdMarkerPause(f.root);assert.equal(await bytes(f), 'ENOENT');
  await setPaused(f.root, true);
  const paused = await bytes(f);
  // A control.json pause is already durable.
  await holdMarkerPause(f.root);assert.equal(await bytes(f), paused);
  const { generation } = await setPaused(f.root, false);
  const active = await bytes(f);
  await writeFile(join(f.root, 'paused'), 'paused\n', { mode: 0o600 });
  const reading = await readControlState(f.root);
  assert.equal(reading.paused, true);assert.notEqual(reading.generation, generation);
  await holdMarkerPause(f.root);
  assert.deepEqual(JSON.parse(await bytes(f)), { version: 1, paused: true, generation: reading.generation });
  assert.deepEqual(await readControlState(f.root), reading);
  // Deleting the marker no longer resumes; an explicit resume does, without the old generation.
  await unlink(join(f.root, 'paused'));
  assert.deepEqual(await readControlState(f.root), reading);
  const resumed = await setPaused(f.root, false);
  assert.equal(resumed.paused, false);assert.notEqual(resumed.generation, generation);
  assert.notEqual(await bytes(f), active);
});

test('a marker before any control.json, and SessionStart during it, keep the pause', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'paused'), 'paused\n', { mode: 0o600 });
  assert.equal((await establishPauseBoundary(f.binding)).status, 'paused');
  const stored = JSON.parse(await bytes(f));
  assert.equal(stored.paused, true);assert.match(stored.generation, /^legacy-[a-f0-9]{64}$/);
  await unlink(join(f.root, 'paused'));
  assert.equal((await readControlState(f.root)).paused, true);
});

test('invalid control state is left alone', async t => {
  const f = await fixture(t);
  await writeFile(control(f), '{', { mode: 0o600 });
  await writeFile(join(f.root, 'paused'), 'paused\n', { mode: 0o600 });
  await holdMarkerPause(f.root);
  assert.equal(await bytes(f), '{');
});

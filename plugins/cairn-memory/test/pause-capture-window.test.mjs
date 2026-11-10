import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFile, writeFile } from 'node:fs/promises';
import test from 'node:test';
import { harness, row } from './capture-window-harness.mjs';

const active = { paused: false, generation: 0, enforced: true };
const time = '2026-11-10T00:00:00.123456789+08:00';
const ids = f => f.captures.flatMap(body => body.messages.map(message => message.id));

test('hosted pause blocks a session window; resumed EOF precedes correctly timed sends', { timeout: 20000 }, async t => {
  let remote = active;
  const f = await harness(t, { pauseState: () => remote });
  await f.write(''); await f.run('start-boundary'); await f.run('recall');
  const skipped = row('paused-window', time);
  await appendFile(f.transcript, skipped);
  remote = { ...active, paused: true, generation: 1 };
  await f.run('capture'); assert.equal(f.captures.length, 0, 'paused_window_zero_posts');
  remote = { ...active, generation: 2 };
  await f.run('capture'); assert.equal(f.captures.length, 0, 'resume_window_eof');
  assert.equal((await f.state()).offset, Buffer.byteLength(skipped));
  await appendFile(f.transcript, row('resumed-window', time));
  const before = Date.now(); await f.run('capture'); const after = Date.now();
  assert.deepEqual(ids(f), ['resumed-window'], 'resumed_window_actual_send');
  const body = f.captures[0];
  assert.deepEqual(body.window, {
    id: createHash('sha256').update(JSON.stringify([f.sessionId, Buffer.byteLength(skipped)])).digest('hex'),
    slice: 1, slices: 1, initial: false,
  });
  assert.equal(body.messages[0].occurred_at, time);
  assert.ok(Date.parse(body.sent_at) >= before && Date.parse(body.sent_at) <= after);
});

for (const pause of [false, true]) test(`POSIX new session start/prompt/Stop with pause=${pause}`, { timeout: 20000 }, async t => {
  let remote = active;
  const f = await harness(t, { pauseState: () => remote });
  const prefix = row('copied-prefix', time);
  await f.write(prefix); await f.run('start-boundary'); await f.run('recall');
  assert.equal((await f.state()).startOffset, Buffer.byteLength(prefix));
  await appendFile(f.transcript, row('first-turn', time));
  if (pause) {
    remote = { ...active, paused: true, generation: 1 };
    await f.run('capture'); assert.equal(f.captures.length, 0, 'posix_paused_zero_posts');
    remote = { ...active, generation: 2 };
  }
  await f.run('capture');
  assert.deepEqual(ids(f), pause ? [] : ['first-turn'], 'posix_first_turn_boundary_precedence');
  if (pause) {
    await appendFile(f.transcript, row('later-turn', time)); await f.run('capture');
    assert.deepEqual(ids(f), ['later-turn'], 'posix_resume_actual_send');
  }
});

test('portable early captureSeen crash preserves prior authority until the EOF decision', { timeout: 25000 }, async t => {
  let remote = active;
  const f = await harness(t, { portable: true, pauseState: () => remote,
    mutateRuntime(source) {
      const needle = '\n  const size = (await stat(transcriptPath)).size;';
      assert.equal(source.split(needle).length, 2);
      return source.replace(needle, '\n  if (action === \'capture-detached\') process.exit(0);' + needle);
    },
  });
  await f.write(''); await f.run('capture'); // Establish verified authority at EOF.
  const verified = await f.state();
  // Reproduce a start cursor carrying authority but no capture marker.
  delete verified.captureSeen;
  await writeFile(f.statePath, JSON.stringify(verified));
  await f.run('recall');
  remote = { ...active, paused: true, generation: 1 };
  await f.run('capture');
  const skipped = row('portable-paused-period', time);
  await appendFile(f.transcript, skipped);
  remote = { ...active, generation: 2 };
  await f.run('capture-detached', { capture_generation: verified.generation });
  const crashed = await f.state();
  assert.equal(crashed.captureSeen, true);
  assert.equal(crashed.offset, verified.offset, 'crash_precedes_eof_decision');
  assert.equal(crashed.hostedTarget, verified.hostedTarget);
  await f.run('capture');
  assert.deepEqual(ids(f), [], 'portable_crash_resume_zero_paused_bytes');
  assert.equal(crashed.hostedGeneration, 0, 'early_marker_must_not_refresh_authority');
  assert.equal((await f.state()).offset, Buffer.byteLength(skipped));
  await appendFile(f.transcript, row('portable-later', time)); await f.run('capture');
  assert.deepEqual(ids(f), ['portable-later'], 'portable_crash_actual_later_send');
});

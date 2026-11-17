import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { appendFile, readdir, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readControlState, setPaused } from '../lib/control-state.mjs';
import { withFileLock } from '../lib/file-lock.mjs';
import { harness, oldTime, row } from './capture-window-harness.mjs';

const active = { paused: false, generation: 0, enforced: true };
const ids = f => f.captures.flatMap(body => body.messages.map(message => message.id));

test('unknown hosted pending birth stays conservative',
  { timeout: 20000 }, async t => {
    const f = await harness(t);
    await setPaused(f.dataDir, true); await setPaused(f.dataDir, false);
    await f.run('start-boundary');
    await assert.rejects(f.state(), { code: 'ENOENT' });
    assert.equal(f.requests.length, 0);
    await appendFile(f.transcript, row('unknown-birth', new Date().toISOString()));
    await f.run('capture');
    assert.deepEqual(ids(f), []);
  });

for (const invalid of ['missing', 'malformed', 'unenforced']) test(`diagnostic availability cannot replace ${invalid} hosted authority`,
  { timeout: 20000 }, async t => {
    const f = await harness(t);
    await f.run('recall', { session_id: 'synthetic-observer' });
    const directory = join(f.dataDir, 'hosted-pause');
    const names = (await readdir(directory)).filter(name => name.endsWith('.json'));
    assert.equal(names.length, 1);
    const authority = join(directory, names[0]);
    if (invalid === 'missing') await unlink(authority);
    else await writeFile(authority, invalid === 'malformed' ? '{' : JSON.stringify({ ...active, enforced: false }));
    await f.run('start-boundary');
    await assert.rejects(f.state(), { code: 'ENOENT' });
  });

test('hosted-paused pending birth grants no authority',
  { timeout: 20000 }, async t => {
    let remote = { ...active, paused: true, generation: 1 };
    const f = await harness(t, { pauseState: () => remote });
    await f.run('recall', { session_id: 'synthetic-observer' });
    const before = await readControlState(f.dataDir);
    assert.equal(before.paused, false, 'no local pause participates');
    const requests = f.requests.length;
    await f.run('start-boundary');
    assert.equal(f.requests.length, requests, 'birth check makes no network request');
    await appendFile(f.transcript, row('paused-text', new Date().toISOString()));
    remote = { ...remote, paused: false }; // Ordinary resume keeps the generation.
    await f.run('capture');
    assert.equal((await readControlState(f.dataDir)).generation, before.generation);
    assert.deepEqual(ids(f), [], 'paused-period text must never be sent');
    await unlink(f.transcript);
    await f.run('start-boundary', { session_id: 'synthetic-after-resume' });
    await appendFile(f.transcript, row('after-resume', new Date().toISOString()));
    await f.run('capture', { session_id: 'synthetic-after-resume' });
    assert.deepEqual(ids(f), ['after-resume'], 'validated active birth sends its first turn');
  });

test('invalid endpoint cannot authorize hosted-paused pending birth', { timeout: 20000 }, async t => {
  let remote = { ...active, paused: true, generation: 1 };
  const f = await harness(t, { pauseState: () => remote });
  await f.run('recall', { session_id: 'synthetic-observer' });
  const before = await readControlState(f.dataDir);
  assert.equal(before.paused, false, 'hosted pause leaves local control active');
  const requests = f.requests.length;
  const child = spawn(process.execPath, [
    fileURLToPath(new URL('../scripts/hook.mjs', import.meta.url)), 'start-boundary',
  ], {
    env: { HOME: f.workspace.path, CLAUDE_PLUGIN_DATA: f.dataDir,
      CLAUDE_PLUGIN_OPTION_API_ENDPOINT: 'http://invalid.example',
      CLAUDE_PLUGIN_OPTION_API_TOKEN: 'synthetic-token', CLAUDE_PLUGIN_OPTION_TELEMETRY: 'false' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => stdout += chunk);
  child.stderr.on('data', chunk => stderr += chunk);
  const closed = new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', resolve);
  });
  f.workspace.defer(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
  });
  child.stdin.end(JSON.stringify({ session_id: f.sessionId, transcript_path: f.transcript,
    cwd: '/synthetic/project', source: 'startup', hook_event_name: 'SessionStart' }));
  assert.equal(await closed, 0, stderr);
  assert.equal(stdout, ''); assert.equal(stderr, '');
  assert.equal(f.requests.length, requests, 'invalid endpoint birth makes no network request');
  const birth = await f.state().catch(error => {
    if (error.code !== 'ENOENT') throw error;
  });
  await appendFile(f.transcript, row('paused-text', new Date().toISOString()));
  remote = { ...remote, paused: false }; // Repair endpoint via the ordinary harness; keep generation.
  await f.run('capture');
  assert.equal((await readControlState(f.dataDir)).generation, before.generation);
  assert.deepEqual({ sent: ids(f), pending: birth?.startPending === true },
    { sent: [], pending: false }, 'invalid hosted configuration grants no pending authority');
  assert.equal((await f.state()).startPending, undefined);
});

test('existing-transcript birth before any hosted observation retains its boundary', { timeout: 20000 }, async t => {
  const f = await harness(t);
  await setPaused(f.dataDir, true); const activeControl = await setPaused(f.dataDir, false);
  await f.write(''); await f.run('start-boundary');
  assert.equal(f.requests.length, 0);
  assert.equal((await f.state()).generation, activeControl.generation);
  assert.equal((await f.state()).startOffset, 0);
  await appendFile(f.transcript, row('active-text', new Date().toISOString()));
  await f.run('capture'); assert.deepEqual(ids(f), ['active-text']);
});

test('existing-transcript hosted-pause residual remains unchanged with active local control', { timeout: 20000 }, async t => {
  let remote = { ...active, paused: true, generation: 1 };
  const f = await harness(t, { pauseState: () => remote });
  await f.run('recall', { session_id: 'synthetic-observer' });
  const before = await readControlState(f.dataDir);
  assert.equal(before.paused, false);
  await f.write('');
  const requests = f.requests.length;
  await f.run('start-boundary');
  assert.equal(f.requests.length, requests);
  const boundary = await f.state();
  assert.equal(boundary.startOffset, 0);
  assert.equal(boundary.generation, before.generation);
  await appendFile(f.transcript, row('residual-text', new Date().toISOString()));
  remote = { ...remote, paused: false };
  await f.run('capture');
  assert.equal((await readControlState(f.dataDir)).generation, before.generation);
  // This pre-existing hosted-only gap is documented for a separate follow-up.
  assert.deepEqual(ids(f), ['residual-text']);
});

test('existing-transcript birth during local pause cannot authorize paused text', { timeout: 20000 }, async t => {
  const f = await harness(t);
  await f.run('recall', { session_id: 'synthetic-observer' });
  const paused = await setPaused(f.dataDir, true);
  await f.write(''); await f.run('start-boundary');
  await appendFile(f.transcript, row('local-paused-text', new Date().toISOString()));
  const resumed = await setPaused(f.dataDir, false);
  assert.equal(resumed.generation, paused.generation);
  await f.run('capture');
  assert.deepEqual(ids(f), []);
  await appendFile(f.transcript, row('later-active-text', new Date().toISOString()));
  await f.run('capture');
  assert.deepEqual(ids(f), ['later-active-text']);
});

for (const pending of [false, true]) test(`copied prefix remains filtered across captures; pending=${pending}`,
  { timeout: 20000 }, async t => {
    const f = await harness(t);
    await f.run('recall', { session_id: 'synthetic-observer' });
    if (pending) {
      await setPaused(f.dataDir, true); await setPaused(f.dataDir, false);
      await f.run('start-boundary');
    }
    await f.run('recall');
    await f.write(row('copied-first', oldTime));
    let queued;
    const observations = () => f.requests.filter(request => request.url.endsWith('/pause-state')).length;
    await withFileLock(f.statePath + '.lock', async () => {
      const before = observations();
      queued = Promise.all([f.run('capture'), f.run('capture')]);
      queued.catch(() => {});
      for (let attempt = 0; attempt < 200 && observations() < before + 2; attempt++) await delay(10);
      assert.ok(observations() >= before + 2, 'both captures entered before releasing the session lock');
    });
    await queued; assert.deepEqual(ids(f), []);
    await appendFile(f.transcript, row('copied-second', oldTime));
    await f.run('capture'); assert.deepEqual(ids(f), [], 'EOF cannot retire copied-prefix filtering');
    await appendFile(f.transcript, row('copied-third', oldTime) + row('fresh-turn', new Date().toISOString()));
    // Both workers serialize on the session lock; the follower must retain the cutoff.
    await Promise.all([f.run('capture'), f.run('capture')]);
    assert.deepEqual(ids(f), ['fresh-turn']);
    await appendFile(f.transcript, row('later-old-date', oldTime));
    await f.run('capture');
    assert.deepEqual(ids(f), ['fresh-turn', 'later-old-date'], 'accepted new turn ends prefix filtering');
  });

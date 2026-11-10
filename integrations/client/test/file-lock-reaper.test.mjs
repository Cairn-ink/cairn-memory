import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { link, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { withFileLock } from '../file-lock.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const driver = fileURLToPath(new URL('./fixtures/file-lock-reaper-crash.mjs', import.meta.url));
function child(t, args) {
  const process = spawn(globalThis.process.execPath, args, { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  process.stderr.on('data', bytes => { stderr += bytes; });
  const done = new Promise((resolve, reject) => {
    process.once('error', reject);
    process.once('close', (code, signal) => resolve({ code, signal, stderr }));
  });
  t.after(async () => {
    if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL');
    await done;
  });
  return { process, done };
}
for (const name of ['capture.lock', 'state.lock', 'control.lock']) {
  test(`${name} recovers a reaper killed after election and before dead-owner cleanup`, { timeout: 10000 }, async t => {
    const workspace = createTestWorkspace(t);
    const path = join(workspace.path, name);
    const original = child(t, ['-e', '']);
    assert.equal((await original.done).code, 0);
    const owner = { pid: original.process.pid, token: randomUUID() };
    const ownerPath = `${path}.owner-${owner.pid}-${owner.token}`;
    await writeFile(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
    await link(ownerPath, path);
    const reaper = child(t, [driver, path]);
    await Promise.race([
      new Promise(resolve => reaper.process.once('message', resolve)),
      reaper.done.then(result => { throw Error('reaper_exited_before_election: ' + JSON.stringify(result)); }),
    ]);
    const marker = `${path}.reap-${owner.token}`;
    assert.equal(JSON.parse(await readFile(marker, 'utf8')).pid, reaper.process.pid);
    assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), owner);
    assert.equal(await withFileLock(path, () => { throw Error('live_reaper_displaced'); },
      { timeoutMs: 40, pollMs: 5 }), false, 'live_reaper_is_never_displaced');
    reaper.process.kill('SIGKILL');
    assert.equal((await reaper.done).signal, 'SIGKILL');
    let entered = 0;
    assert.equal(await withFileLock(path, () => { entered++; }, { timeoutMs: 400, pollMs: 5 }),
      true, 'later_contender_recovers_crashed_reaper');
    assert.equal(entered, 1);
    assert.equal(await withFileLock(path, () => { entered++; }, { timeoutMs: 400, pollMs: 5 }), true);
    assert.equal(entered, 2, 'successor_lock_survives_recovery');

    // Repeat with a crash inside takeover's own election, before removing the
    // first reaper marker. The same protocol must recover the next level.
    owner.token = randomUUID();
    await writeFile(path, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
    const first = child(t, [driver, path]);
    await Promise.race([new Promise(resolve => first.process.once('message', resolve)),
      first.done.then(() => { throw Error('first_reaper_exited'); })]);
    first.process.kill('SIGKILL');
    assert.equal((await first.done).signal, 'SIGKILL');
    const firstMarker = `${path}.reap-${owner.token}`;
    const second = child(t, [driver, path, firstMarker]);
    await Promise.race([new Promise(resolve => second.process.once('message', resolve)),
      second.done.then(() => { throw Error('nested_reaper_exited'); })]);
    assert.equal(JSON.parse(await readFile(firstMarker, 'utf8')).pid, first.process.pid);
    assert.equal(await withFileLock(path, () => { throw Error('live_nested_reaper_displaced'); },
      { timeoutMs: 40, pollMs: 5, signal: AbortSignal.timeout(200) }),
      false, 'live_nested_reaper_preserves_bounded_acquisition');
    second.process.kill('SIGKILL');
    assert.equal((await second.done).signal, 'SIGKILL');
    assert.equal(await withFileLock(path, () => { entered++; }, { timeoutMs: 400, pollMs: 5 }),
      true, 'nested_crashed_reaper_is_recoverable');
    assert.equal(entered, 3);

    // Freeze a stale contender's original-owner read. Another contender reaps
    // and acquires a successor before that stale snapshot can proceed.
    owner.token = randomUUID();
    await writeFile(path, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
    let announce, resume;
    const ready = new Promise(resolve => { announce = resolve; });
    const released = new Promise(resolve => { resume = resolve; });
    let firstRead = true;
    const stale = withFileLock(path, () => { throw Error('stale_contender_entered'); }, {
      timeoutMs: 150, pollMs: 5, read: async (name, ...args) => {
        const bytes = await readFile(name, ...args);
        if (name === path && firstRead) { firstRead = false; announce(); await released; }
        return bytes;
      },
    });
    try {
      await ready;
      assert.equal(await withFileLock(path, async () => {
        const successor = await readFile(path, 'utf8');
        resume();
        assert.equal(await stale, false, 'stale_contender_cannot_displace_live_successor');
        assert.equal(await readFile(path, 'utf8'), successor, 'successor_token_unchanged');
      }, { timeoutMs: 400, pollMs: 5 }), true);
    } finally { resume(); await stale; }

  });
}

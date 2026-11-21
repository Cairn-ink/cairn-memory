import test from 'node:test';
import assert from 'node:assert/strict';
import { watch, statSync } from 'node:fs';
import { fork } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import fs from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { canonical } from '../local-daemon-identity.mjs';
import { runDaemonCommand } from '../local-daemon-liveness.mjs';
import { workspace, until, ok } from './local-daemon-support.mjs';

const prefix = bootstrap => 'd-' + createHash('sha256').update(canonical(bootstrap.identity)).digest('hex').slice(0, 32);
const matches = base => new RegExp('^' + base + '\\.(stamp|json)\\.tmp-[a-f0-9]{24}$');
async function serve(w, bootstrap, options = {}, beforePublication) {
  const candidate = w.child({ role: 'candidate', bootstrap, ...options }); candidate.release();
  if (beforePublication) {
    await until(() => candidate.messages.some(message => message.kind === 'temp-scan-closed'), 'cleanup closes before new endpoint publication');
    try { await beforePublication(); }
    finally { candidate.process.send({ kind: 'release-temp-scan-close' }); }
  }
  await until(w.descriptor, 'next lifetime holder publishes');
  const session = w.forward(); session.release();
  assert.equal((await w.connect(session)).owner.pid, candidate.process.pid);
  ok(await session.tool('remember_memory', { content: 'synthetic crash temp recovery', kind: 'fact' }));
  return candidate;
}
for (const mode of ['deterministic', 'real-watch']) test('stamp crash recovery after ' + mode + ' SIGKILL', { timeout: 22000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap(), directory = join(w.root, 'run', 'cairn-memory');
  const pattern = matches(prefix(bootstrap));
  const candidate = w.child({ role: 'candidate', bootstrap, stampWriteBarrier: mode === 'deterministic' });
  let watcher, killed = false;
  if (mode === 'real-watch') {
    // No daemon instrumentation in this case: kill on the kernel's actual
    // temp-creation event, before its ordinary write/fsync/rename completes.
    watcher = watch(directory, (_event, name) => {
      if (killed || !pattern.test(String(name))) return;
      try { if (!statSync(join(directory, String(name))).isFile()) return; }
      catch (error) { if (error.code === 'ENOENT') return; throw error; }
      killed = candidate.process.kill('SIGKILL');
    });
  }
  try {
    candidate.release();
    if (mode === 'deterministic') { await until(() => candidate.messages.some(message => message.kind === 'stamp-write-pending'), 'real stamp bytes await completion'); killed = candidate.process.kill('SIGKILL'); }
    await until(() => candidate.exit, 'killed holder exits');
    assert.equal(killed, true); assert.equal(candidate.exit.signal, 'SIGKILL');
  } finally { watcher?.close(); }
  const before = (await fs.readdir(directory)).filter(name => pattern.test(name));
  assert.ok(before.length > 0, 'SIGKILL actually left an endpoint temp');
  await serve(w, bootstrap);
  await until(async () => !(await fs.readdir(directory)).some(name => pattern.test(name)), 'new holder finishes its own queued stamp');
  // The live holder may begin its next stamp write after the wait above; only
  // the temps the killed holder left must be gone.
  assert.deepEqual((await fs.readdir(directory)).filter(name => before.includes(name)), [], 'next acquisition removes every matching crash temp');
  t.diagnostic(JSON.stringify({ mode, crashTemps: before.length, exit: candidate.exit }));
});

test('cleanup leaves nonmatches, other identities and invalid temps; reports only in the log and serves', { timeout: 18000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap(), directory = join(w.root, 'run', 'cairn-memory'), base = prefix(bootstrap);
  const names = [base + '.stamp.tmp-bad', 'd-' + 'e'.repeat(32) + '.stamp.tmp-' + 'a'.repeat(24), base + '.stamp.tmp-' + 'b'.repeat(24), base + '.log.tmp-' + 'c'.repeat(24), 'identity-v1.key.tmp-' + 'd'.repeat(24)];
  for (const name of names) await fs.writeFile(join(directory, name), 'synthetic', { mode: 0o600 });
  await fs.chmod(join(directory, names[2]), 0o644);
  await serve(w, bootstrap);
  for (const name of names) assert.equal(await fs.readFile(join(directory, name), 'utf8'), 'synthetic');
  await until(async () => (await fs.readFile(join(directory, base + '.log'), 'utf8')).includes('daemon_temp_invalid'), 'invalid-temp code is logged');
  let output = '';
  await runDaemonCommand(['status'], { root: join(w.root, 'run'), write: text => { output += text; } });
  assert.ok(!output.includes('daemon_temp_')); assert.ok(!output.includes(directory));
  assert.ok(!w.children.some(child => /daemon_temp_/.test(child.stderr)), 'cleanup diagnostics never reach stderr');
});

test('257 matching temps stop at the 256-match bound, log overflow and serve', { timeout: 18000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap(), directory = join(w.root, 'run', 'cairn-memory'), base = prefix(bootstrap);
  const pattern = matches(base);
  for (let index = 0; index < 257; index++) {
    const name = base + '.json.tmp-' + index.toString(16).padStart(24, '0');
    await fs.writeFile(join(directory, name), 'synthetic', { mode: 0o600 });
  }
  await serve(w, bootstrap, { observeTempScan: true, tempScanClock: true, holdTempScanClose: true }, async () => {
    assert.equal((await fs.readdir(directory)).filter(name => pattern.test(name)).length, 1);
  });
  await until(async () => (await fs.readFile(join(directory, base + '.log'), 'utf8')).includes('daemon_temp_overflow'), 'overflow code is logged');
});

test('directory scan streams at most 4096 entries and awaits close before serving', { timeout: 18000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap(), directory = join(w.root, 'run', 'cairn-memory'), base = prefix(bootstrap);
  for (let index = 0; index < 4097; index++) await fs.writeFile(join(directory, 'synthetic-' + index), 'synthetic', { mode: 0o600 });
  const candidate = w.child({ role: 'candidate', bootstrap, observeTempScan: true }); candidate.release();
  await until(w.descriptor, 'bounded scan still publishes');
  assert.equal(candidate.messages.find(message => message.kind === 'temp-scan-closed')?.reads, 4096);
  assert.equal((await fs.readdir(directory)).filter(name => name.startsWith('synthetic-')).length, 4097);
  await until(async () => (await fs.readFile(join(directory, base + '.log'), 'utf8')).includes('daemon_temp_overflow'), 'directory-entry overflow is logged');
});

test('one-second scheduling budget never abandons an outstanding unlink or directory close', { timeout: 18000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap(), directory = join(w.root, 'run', 'cairn-memory'), base = prefix(bootstrap);
  const path = join(directory, base + '.stamp.tmp-' + '9'.repeat(24));
  await fs.writeFile(path, 'synthetic', { mode: 0o600 });
  const candidate = w.child({ role: 'candidate', bootstrap, cleanupUnlinkBarrier: true, observeTempScan: true }); candidate.release();
  await until(() => candidate.messages.some(message => message.kind === 'temp-unlink-pending'), 'cleanup started the real unlink');
  await delay(1100);
  assert.ok(await fs.lstat(join(directory, base + '.lock')));
  assert.equal(await w.descriptor(), undefined); assert.equal(candidate.exit, null);
  candidate.process.send({ kind: 'release-temp-unlink' });
  await until(w.descriptor, 'cleanup settles before publication');
  assert.ok(candidate.messages.some(message => message.kind === 'temp-scan-closed'));
  await assert.rejects(fs.lstat(path), { code: 'ENOENT' });
  await until(async () => (await fs.readFile(join(directory, base + '.log'), 'utf8')).includes('daemon_temp_budget'), 'expired scheduling budget is logged');
});

async function scanFailureCandidate(t, w, bootstrap, mode) {
  const process = fork(new URL('./fixtures/local-daemon-temp-scan.mjs', import.meta.url), ['child'], {
    execArgv: [], env: {}, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const events = []; let exit, stderr = '';
  process.on('message', event => events.push(event));
  process.stderr.on('data', bytes => { stderr += bytes; });
  process.once('exit', (code, signal) => { exit = { code, signal }; });
  t.after(async () => {
    // Refusal disconnects IPC before the seam child's natural exit completes.
    const deadline = performance.now() + 10000;
    while (!exit && performance.now() < deadline) await delay(20);
    if (!exit) process.kill('SIGTERM');
    await until(() => exit, 'scan seam child is reaped');
    assert.equal(exit.code, 0, stderr);
  });
  process.send({ bootstrap, mode });
  return { events, exited: () => exit };
}

for (const mode of ['opendir', 'read', 'close']) test('scan ' + mode + ' failure logs daemon_temp_scan and serves a Memory write', { timeout: 18000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap(), directory = join(w.root, 'run', 'cairn-memory'), base = prefix(bootstrap);
  await fs.writeFile(join(directory, base + '.stamp.tmp-' + 'a'.repeat(24)), 'synthetic', { mode: 0o600 });
  const candidate = await scanFailureCandidate(t, w, bootstrap, mode);
  await until(w.descriptor, 'non-directory scan failure still publishes', 7000);
  assert.ok(candidate.events.some(event => event.kind === 'scan-error' && event.operation === mode));
  if (mode !== 'opendir') assert.ok(candidate.events.some(event => event.kind === 'scan-close-completed'), 'real directory close completed before publication');
  if (mode === 'read') assert.equal(candidate.events.find(event => event.kind === 'scan-error').reads, 1, 'read fails mid-stream');
  const session = w.forward(); session.release(); await w.connect(session);
  ok(await session.tool('remember_memory', { content: 'synthetic scan failure recovery', kind: 'fact' }));
  await until(async () => (await fs.readFile(join(directory, base + '.log'), 'utf8')).includes('daemon_temp_scan'), 'scan code logged');
  let status = '';
  assert.equal(await runDaemonCommand(['status'], { root: join(w.root, 'run'), write: value => { status += value; } }), 0);
  assert.equal(status.includes('daemon_temp_scan'), false, 'cleanup scan code stays log-only');
  assert.equal(w.children.some(child => child.stderr.includes('daemon_temp_scan')), false);
});

for (const mode of ['validate', 'directory', 'startup-directory']) test('pinned directory change refuses through existing validation: ' + mode, { timeout: 15000 }, async t => {
  const w = await workspace(t), bootstrap = await w.bootstrap(), directory = join(w.root, 'run', 'cairn-memory'), base = prefix(bootstrap);
  await fs.writeFile(join(directory, base + '.stamp.tmp-' + 'b'.repeat(24)), 'synthetic', { mode: 0o600 });
  const candidate = await scanFailureCandidate(t, w, bootstrap, mode);
  const refusal = await until(() => candidate.events.find(event => event.kind === 'startup-refused'), 'startup returns its directory refusal');
  assert.equal(refusal.code, 'daemon_directory_changed');
  assert.match(refusal.stack, /at validate .*local-daemon-state\.mjs:/, 'same runtimeDirectory.validate code path as ordinary startup validation');
  assert.equal(refusal.sameObject, mode !== 'startup-directory', 'cleanup propagates the exact error object; baseline startup bypasses cleanup catch');
  assert.equal(await w.descriptor(), undefined);
  if (mode !== 'validate') assert.ok(candidate.events.some(event => event.kind === 'scan-close-completed'));
  t.diagnostic(JSON.stringify({ mode, refusal }));
});

test('cleanup preserves every initial validate failure object', async () => {
  const { cleanupSeam } = await import('./fixtures/local-daemon-temp-scan.mjs');
  const { cleanupTemps } = await cleanupSeam();
  for (const code of ['ENOENT', 'daemon_filesystem', 'daemon_directory_changed']) {
    const expected = Object.assign(Error('synthetic'), { code });
    await assert.rejects(cleanupTemps({ validate: async () => { throw expected; } }, { stamp: '/synthetic/d-' + 'a'.repeat(32) + '.stamp' }, () => {}), error => error === expected);
  }
});


test('cleanup preserves directory-coded IO errors and per-file validate failures unchanged', async () => {
  const { cleanupSeam } = await import('./fixtures/local-daemon-temp-scan.mjs');
  const { cleanupTemps } = await cleanupSeam(), opendir = fs.opendir;
  const base = 'd-' + 'a'.repeat(32), paths = { stamp: '/synthetic/' + base + '.stamp' };
  try {
    for (const operation of ['opendir', 'read', 'close', 'validate']) {
      const expected = Object.assign(Error('synthetic'), { code: operation === 'validate' ? 'ENOENT' : 'daemon_directory_changed' });
      let validations = 0, closed = false;
      const directory = { path: '/synthetic', validate: async () => { if (operation === 'validate' && ++validations === 2) throw expected; } };
      fs.opendir = async () => {
        if (operation === 'opendir') throw expected;
        return {
          read: async () => {
            if (operation === 'read') throw expected;
            return operation === 'validate' ? { name: base + '.stamp.tmp-' + 'b'.repeat(24) } : null;
          },
          close: async () => { await delay(10); closed = true; if (operation === 'close') throw expected; },
        };
      };
      syncBuiltinESMExports();
      const reports = [];
      await assert.rejects(cleanupTemps(directory, paths, code => reports.push(code)), error => error === expected);
      assert.equal(closed, operation !== 'opendir', 'started directory close is awaited even on refusal');
      assert.deepEqual(reports, [], 'directory failures retain existing refusal reporting');
    }
  } finally { fs.opendir = opendir; syncBuiltinESMExports(); }
});

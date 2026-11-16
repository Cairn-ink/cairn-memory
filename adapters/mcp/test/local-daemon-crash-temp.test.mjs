import test from 'node:test';
import assert from 'node:assert/strict';
import { watch, statSync } from 'node:fs';
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
  assert.deepEqual((await fs.readdir(directory)).filter(name => pattern.test(name)), [], 'next acquisition removes every matching crash temp');
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

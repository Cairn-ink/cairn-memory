// Offline destructive harness. The test process is outside every targeted
// session/group; all children and packs are disposable synthetic fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, open, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture } from './fixtures/pack.mjs';
import { verifyPack } from '../pack.mjs';
import { signalGroup, groupExists } from '../process.mjs';
async function processInfo(pid) {
  try {
    if (process.platform === 'linux') {
      const s = await readFile('/proc/' + pid + '/stat', 'utf8'), fields = s.slice(s.lastIndexOf(')') + 2).split(' ');
      return { state: fields[0], group: Number(fields[2]), session: Number(fields[3]) };
    }
    const [group, session, state] = execFileSync('/bin/ps', ['-o', 'pgid=,sess=,stat=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(/\s+/);
    // Darwin ps exposes an opaque session identifier, not a numeric SID.
    return { group: Number(group), session, state };
  } catch { return null; }
}
const live = info => info && !/^[ZX]/.test(info.state);
async function waitFor(check, name) {
  const deadline = Date.now() + 30000;
  for (;;) { const value = await check(); if (value) return value; if (Date.now() >= deadline) throw Error('liveness_watchdog:' + name); await delay(20); }
}
async function json(path) { try { return JSON.parse(await readFile(path, 'utf8')); } catch { return null; } }
for (const mode of ['blocked-load', 'blocked-inference']) for (const kill of ['parent-pid', 'caller-group']) {
  test('L08 supervisor-survival assertion races successful cleanup: ' + mode + ' / ' + kill, async t => {
    const f = await fixture(), pack = await verifyPack(f.root, { catalog: f.catalog });
    const report = join(f.parent, 'registration.json'), gate = join(f.parent, 'entered.json');
    const stdout = await open(join(f.parent, 'caller.out'), 'wx'), stderr = await open(join(f.parent, 'caller.err'), 'wx');
    const caller = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/caller.mjs', import.meta.url)), f.root, report, gate, mode, pack.manifestHash, JSON.stringify(pack.fence)], { detached: true, shell: false, stdio: ['ignore', stdout.fd, stderr.fd] });
    let registration, closed = false; caller.on('close', () => { closed = true; });
    t.after(async () => {
      if (!closed) signalGroup(caller.pid, 'SIGKILL');
      registration ??= await json(report);
      if (registration) {
        if (live(await processInfo(registration.inference))) signalGroup(registration.inference, 'SIGKILL');
        await waitFor(async () => !groupExists(registration.inference), 'cleanup-inference');
        if (live(await processInfo(registration.supervisor))) signalGroup(registration.supervisor, 'SIGKILL');
        await waitFor(async () => !live(await processInfo(registration.supervisor)), 'cleanup-supervisor');
      } else {
        const spawned = await json(report + '.spawn');
        if (spawned?.supervisor) await waitFor(async () => !live(await processInfo(spawned.supervisor)), 'cleanup-pre-registration-supervisor');
      }
      await waitFor(() => closed, 'cleanup-caller');
      await stdout.close(); await stderr.close();
      await rm(f.parent, { recursive: true, force: true });
    });
    registration = await waitFor(() => json(report), 'registration');
    const entered = await waitFor(() => json(gate), 'native-entry'); assert.equal(entered.pid, registration.inference);
    const callerInfo = await processInfo(caller.pid), supervisorInfo = await processInfo(registration.supervisor), inferenceInfo = await processInfo(registration.inference), harnessInfo = await processInfo(process.pid);
    assert.equal(callerInfo.group, caller.pid); assert.equal(supervisorInfo.group, registration.supervisor); if (process.platform === 'linux') assert.equal(supervisorInfo.session, registration.supervisor); assert.equal(inferenceInfo.group, registration.inference);
    assert.equal(new Set([callerInfo.group, supervisorInfo.group, inferenceInfo.group, harnessInfo.group]).size, 4);
    assert.notEqual(callerInfo.session, supervisorInfo.session);
    if (kill === 'parent-pid') process.kill(caller.pid, 'SIGKILL'); else signalGroup(caller.pid, 'SIGKILL');
    await waitFor(async () => !groupExists(registration.inference), 'inference-group-disappearance');
    await waitFor(async () => !live(await processInfo(registration.supervisor)), 'supervisor-exit');
    // Assert after cleanup has completed, so descheduling cannot turn prompt
    // successful cleanup into a failure of an instantaneous liveness check.
    assert.deepEqual(await json(gate + '.supervisor-eof'), { supervisor: registration.supervisor, inference: registration.inference });
    await waitFor(() => closed, 'caller-reaped');
    assert.equal(await json(report + '.error'), null); // Parent never resumed/finished native work.
  });
}

for (const mode of ['registration-race', 'unexpected-supervisor']) {
  test('L08 ' + mode + ' retains an external cleanup owner', async t => {
    const f = await fixture(), pack = await verifyPack(f.root, { catalog: f.catalog });
    const report = join(f.parent, 'registration.json'), gate = join(f.parent, 'entered.json');
    const out = await open(join(f.parent, 'caller.out'), 'wx'), err = await open(join(f.parent, 'caller.err'), 'wx');
    const caller = spawn(process.execPath, [fileURLToPath(new URL('./fixtures/caller.mjs', import.meta.url)), f.root, report, gate, mode === 'registration-race' ? mode : 'blocked-inference', pack.manifestHash, JSON.stringify(pack.fence)], { detached: true, shell: false, stdio: ['ignore', out.fd, err.fd] });
    let group, supervisor, closed = false; caller.on('close', () => { closed = true; });
    t.after(async () => {
      if (!closed) signalGroup(caller.pid, 'SIGKILL');
      if (group) {
        if (live(await processInfo(group))) signalGroup(group, 'SIGKILL');
        await waitFor(async () => !groupExists(group), 'cleanup-inference');
      }
      if (supervisor && live(await processInfo(supervisor))) signalGroup(supervisor, 'SIGKILL');
      if (supervisor) await waitFor(async () => !live(await processInfo(supervisor)), 'cleanup-supervisor');
      await waitFor(() => closed, 'cleanup-caller');
      await out.close(); await err.close();
      await rm(f.parent, { recursive: true, force: true });
    });
    const spawned = await waitFor(() => json(report + '.spawn'), 'caller-spawn'); supervisor = spawned.supervisor;
    const entered = await waitFor(() => json(gate), 'child-registration-or-native-entry'); group = entered.pid;
    const info = await processInfo(group), callerInfo = await processInfo(caller.pid), supervisorInfo = await processInfo(supervisor);
    assert.notEqual(info.group, callerInfo.group); assert.notEqual(info.group, supervisorInfo.group);
    if (mode === 'registration-race') { assert.equal(await json(report), null); signalGroup(caller.pid, 'SIGKILL'); }
    else { process.kill(supervisor, 'SIGKILL'); await waitFor(() => json(report + '.error'), 'live-parent-cleanup'); assert.equal((await json(report + '.error')).code, 'child_crash'); }
    await waitFor(async () => !groupExists(group), 'inference-group-disappearance');
    await waitFor(async () => !live(await processInfo(supervisor)), 'supervisor-exit');
    await waitFor(() => closed, 'caller-reaped');
  });
}

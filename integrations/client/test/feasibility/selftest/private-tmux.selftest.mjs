// Offline self-test for the interactive driver's supervision: signals, the
// ledger-write failure, the timer deadline and bounded tmux calls, with fake
// hosts in a real private tmux server and a fake tmux client that never exits
// (see tmux-fixtures.mjs). Only names that 81145ff also exports are imported,
// so each regression here can be run against that commit.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { writeLedger } from '../lib/ledger.mjs';
import { createWaiter, launchPrivateTmux, tmux } from '../lib/private-tmux.mjs';
import { createInterruptGuard } from '../lib/supervise.mjs';
import { alive, ESCALATE_MS, fakeTmux, killRecorded, quote, serverUp, setup, STUBBORN } from './tmux-fixtures.mjs';

test('a signal mid-reply ends the wait at once, reaches the pane group, escalates, and the server is stopped', async t => {
  const run = setup(t);
  const host = await run.launch();
  await run.ready(host);
  const { host: hostPid, grandchild } = run.pids();
  // The driver is waiting for a reply that never comes when the signal arrives.
  const reply = run.waitFor(async () => (await host.pane()).includes('OK1'), 10_000, 'reply');
  setTimeout(() => run.signals.emit('SIGINT'), 100);
  await assert.rejects(reply, /interrupted:SIGINT/);
  const started = Date.now();
  await host.teardown();
  assert.ok(Date.now() - started < ESCALATE_MS + 3_000, 'teardown is bounded');
  assert.equal(run.guard.interrupted, 'SIGINT');
  assert.ok(run.signalsSeen().includes('SIGINT'), 'the host received the forwarded signal');
  assert.equal(alive(hostPid), false);
  assert.equal(alive(grandchild), false);
  assert.equal(await serverUp(run.socket), false);
  assert.ok(run.socketGone(), 'the private socket file is removed');
});


test('a failed ledger write after launch kills the pane group and the private server, then rethrows', async t => {
  const run = setup(t);
  let launched = null;
  const started = Date.now();
  await assert.rejects(run.launch(async value => {
    launched = value;
    await run.waitFor(run.hostReady, 10_000, 'host ready');
    // A real ledger write that fails: its directory does not exist.
    writeLedger(join(run.workspace.path, 'missing-root'), { runs: [{ tmux: value }] });
  }), error => error.code === 'ENOENT' && /ledger\.json/.test(error.message));
  assert.ok(Date.now() - started < 10_000 + ESCALATE_MS + 3_000, 'teardown is bounded');
  assert.ok(launched?.panePid > 0 && launched?.serverPid > 0);
  const { host: hostPid, grandchild } = run.pids();
  // SIGTERM comes first; when the pane's shell exits the kernel may add SIGHUP.
  // The host ignores both, so only the SIGKILL escalation can have ended it.
  assert.equal(run.signalsSeen()[0], 'SIGTERM');
  assert.equal(alive(hostPid), false);
  assert.equal(alive(grandchild), false);
  assert.equal(alive(launched.serverPid), false);
  assert.equal(await serverUp(run.socket), false);
  assert.ok(run.socketGone(), 'the private socket file is removed');
});


test('a signal before launch prevents tmux from starting', async t => {
  const run = setup(t);
  run.signals.emit('SIGTERM');
  await assert.rejects(run.launch(), /interrupted_before_launch:SIGTERM/);
  await delay(200);
  assert.equal(await serverUp(run.socket), false);
  assert.equal(run.hostReady(), false);
});


test('the overall deadline bounds every wait', async t => {
  const guard = createInterruptGuard({ signals: new EventEmitter() });
  const waitFor = createWaiter({ guard, deadline: Date.now() + 150, intervalMs: 20 });
  t.after(() => waitFor.dispose?.());
  const started = Date.now();
  await assert.rejects(waitFor(() => false, 60_000, 'never'), /deadline_exceeded/);
  assert.ok(Date.now() - started < 1_000);
});


test('a 10 ms deadline fails a check that would only succeed after 61 ms', async t => {
  const waitFor = createWaiter({ guard: createInterruptGuard({ signals: new EventEmitter() }), deadline: Date.now() + 10,
    intervalMs: 5 });
  t.after(() => waitFor.dispose?.());
  await assert.rejects(waitFor(async () => { await delay(61); return true; }, 10_000, 'slow check'), /deadline_exceeded/);
});


test('a check that never settles is ended by the deadline timer, which tears the host down', { timeout: 20_000 }, async t => {
  const run = setup(t);
  const host = await run.launch();
  await run.ready(host);
  const { host: hostPid, grandchild } = run.pids();
  let expiries = 0;
  const bounded = createWaiter({ guard: run.guard, deadline: Date.now() + 500, intervalMs: 50,
    onExpire: () => { expiries++; return host.teardown(); } });
  t.after(() => bounded.dispose?.());
  const started = Date.now();
  // A transcript read or tmux call that never returns.
  await assert.rejects(bounded(() => new Promise(() => {}), 60_000, 'reply'), /deadline_exceeded/);
  assert.ok(Date.now() - started < 1_500, 'rejected on the deadline, not after the check');
  assert.equal(expiries, 1);
  await host.teardown(); // joins the teardown the deadline started
  assert.equal(alive(hostPid), false);
  assert.equal(alive(grandchild), false);
  assert.equal(await serverUp(run.socket), false);
  assert.ok(run.socketGone(), 'the private socket file is removed');
});


test('a tmux client that never exits is killed within its bound', { timeout: 20_000 }, async t => {
  const fake = fakeTmux(t);
  const started = Date.now();
  const result = await tmux(`f0-selftest-${randomBytes(6).toString('hex')}`, ['list-sessions'], { timeoutMs: 300 });
  assert.ok(Date.now() - started < 1_500, 'the call returned within its bound');
  assert.equal(result.timedOut, true);
  assert.equal(result.status, null);
  assert.deepEqual(fake.pids(), [result.pid]);
  assert.equal(alive(result.pid), false);
});


test('a launch whose tmux client never exits is killed within its bound and rejects', { timeout: 20_000 }, async t => {
  const fake = fakeTmux(t);
  const guard = createInterruptGuard({ signals: new EventEmitter(), escalateMs: ESCALATE_MS });
  guard.install();
  t.after(() => guard.dispose());
  const started = Date.now();
  await assert.rejects(launchPrivateTmux({ socket: `f0-selftest-${randomBytes(6).toString('hex')}`, command: 'true',
    cwd: fake.workspace.path, guard, pidFile: join(fake.workspace.path, 'pane.pid'), escalateMs: ESCALATE_MS,
    callTimeoutMs: 300 }), /tmux_new_session_failed:timeout/);
  assert.ok(Date.now() - started < 3_000, 'launch and teardown returned within their bounds');
  const pids = fake.pids();
  assert.ok(pids.length >= 1);
  for (const pid of pids) assert.equal(alive(pid), false);
});


test('a launch whose tmux client stalls after the pane started still stops the pane group', { timeout: 20_000 }, async t => {
  const fake = fakeTmux(t, { startsPane: true });
  const guard = createInterruptGuard({ signals: new EventEmitter(), escalateMs: ESCALATE_MS });
  guard.install();
  const script = join(fake.workspace.path, 'stubborn.cjs');
  writeFileSync(script, STUBBORN);
  const pidsFile = join(fake.workspace.path, 'pids.json');
  const pidFile = join(fake.workspace.path, 'pane.pid');
  const groups = new Set();
  t.after(() => {
    guard.dispose();
    killRecorded(groups, true);
  });
  const launching = launchPrivateTmux({ socket: `f0-selftest-${randomBytes(6).toString('hex')}`, cwd: fake.workspace.path,
    command: [process.execPath, script, pidsFile, join(fake.workspace.path, 'signals.log')].map(quote).join(' '),
    guard, pidFile, escalateMs: ESCALATE_MS, callTimeoutMs: 1_500 });
  // Record the pane's group for cleanup as soon as the pane has written it.
  for (let i = 0; i < 100 && !existsSync(pidsFile); i++) await delay(20);
  groups.add(Number(readFileSync(pidFile, 'utf8')));
  await assert.rejects(launching, /tmux_new_session_failed:timeout/);
  const { host: hostPid, grandchild } = JSON.parse(readFileSync(pidsFile, 'utf8'));
  assert.equal(alive(hostPid), false);
  assert.equal(alive(grandchild), false);
  for (const pid of fake.pids()) assert.equal(alive(pid), false);
});


test('an aborted run kills a pending tmux client at once', { timeout: 20_000 }, async t => {
  const fake = fakeTmux(t);
  const controller = new AbortController();
  setTimeout(() => controller.abort(new Error('deadline_exceeded')), 100);
  const started = Date.now();
  const result = await tmux(`f0-selftest-${randomBytes(6).toString('hex')}`, ['capture-pane', '-p'],
    { timeoutMs: 10_000, signal: controller.signal });
  assert.ok(Date.now() - started < 1_500, 'the call ended on the abort, not its 10 s bound');
  assert.equal(result.aborted, true);
  assert.equal(result.status, null);
  assert.equal(alive(result.pid), false);
  assert.deepEqual(fake.pids(), [result.pid]);
});

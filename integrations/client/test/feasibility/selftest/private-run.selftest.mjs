// Offline self-test for `runPrivateTmux`, the interactive driver's whole run:
// the deadline is armed before launch, and the host is always torn down, even
// when a step or the launch callback never settles. Fake hosts run in a real
// private tmux server, or behind in-process tmux clients (see tmux-fixtures.mjs).
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../../../../tools/testing/workspace.mjs';
import { launchPrivateTmux, runPrivateTmux } from '../lib/private-tmux.mjs';
import { createInterruptGuard } from '../lib/supervise.mjs';
import { alive, ESCALATE_MS, instantTmux, quote, serverUp, setup, STUBBORN } from './tmux-fixtures.mjs';

const supervisedRun = (run, { deadline, drive }) => runPrivateTmux({ ...run.launchOptions(), deadline, drive, intervalMs: 50 });

test('a run whose step never settles is stopped by its deadline, with the host torn down', { timeout: 20_000 }, async t => {
  const run = setup(t);
  let steps = 0;
  const started = Date.now();
  const outcome = await supervisedRun(run, { deadline: Date.now() + 2_500, drive: async ({ host, waitFor }) => {
    await waitFor(async () => run.hostReady() && (await host.pane()).includes('thinking'), 10_000, 'host ready');
    steps++;
    // A transcript read or tmux call that never returns.
    await waitFor(() => new Promise(() => {}), 60_000, 'reply');
    steps++;
  } });
  assert.ok(Date.now() - started < 2_500 + ESCALATE_MS + 3_000, 'the run ended on its deadline, teardown included');
  assert.equal(outcome.launched, true);
  assert.equal(outcome.stopped, 'deadline_exceeded');
  assert.match(outcome.failure.message, /deadline_exceeded/);
  assert.equal(steps, 1);
  const { host: hostPid, grandchild } = run.pids();
  assert.equal(alive(hostPid), false);
  assert.equal(alive(grandchild), false);
  assert.equal(await serverUp(run.socket), false);
  assert.ok(run.socketGone(), 'the private socket file is removed');
});


test('a run whose step fails before the deadline still tears the host down', { timeout: 20_000 }, async t => {
  const run = setup(t);
  const outcome = await supervisedRun(run, { deadline: Date.now() + 15_000, drive: async ({ host, waitFor }) => {
    await waitFor(async () => run.hostReady() && (await host.pane()).includes('thinking'), 10_000, 'host ready');
    await waitFor(async () => (await host.pane()).includes('OK1'), 300, 'reply one');
  } });
  assert.equal(outcome.launched, true);
  assert.equal(outcome.stopped, null);
  assert.match(outcome.failure.message, /timeout_waiting_for:reply one/);
  const { host: hostPid, grandchild } = run.pids();
  assert.equal(alive(hostPid), false);
  assert.equal(alive(grandchild), false);
  assert.equal(await serverUp(run.socket), false);
});

/** A real synthetic host behind in-process tmux clients, with a guard driven by an emitter. */
function instantLaunch(t) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-private-run-' });
  const signals = new EventEmitter();
  const guard = createInterruptGuard({ signals, escalateMs: ESCALATE_MS });
  guard.install();
  t.after(() => guard.dispose());
  const script = join(workspace.path, 'stubborn.cjs');
  writeFileSync(script, STUBBORN);
  const pidsFile = join(workspace.path, 'pids.json');
  const command = [process.execPath, script, pidsFile, join(workspace.path, 'signals.log')].map(quote).join(' ');
  const { pane } = instantTmux(t, { paneCommand: command, cwd: workspace.path });
  const options = { socket: 'f0-selftest-instant', cwd: workspace.path, guard, escalateMs: ESCALATE_MS,
    pidFile: join(workspace.path, 'pane.pid'), command };
  // Killed and reaped: the pane exited and its pid no longer names a process.
  const gone = child => child !== undefined && (child.exitCode !== null || child.signalCode !== null) && !alive(child.pid);
  const grandchild = () => (existsSync(pidsFile) ? JSON.parse(readFileSync(pidsFile, 'utf8')).grandchild : null);
  return { signals, guard, options, pidsFile, pane, gone, grandchild };
}

// The launch callback is where the driver writes its ledger; nothing may wait for it.
const never = () => new Promise(() => {});

test('a launch callback that never settles cannot hold the run: a 10 ms deadline kills and reaps the host', { timeout: 10_000 }, async t => {
  const run = instantLaunch(t);
  let callbacks = 0;
  const started = Date.now();
  const outcome = await runPrivateTmux({ ...run.options, deadline: Date.now() + 10, intervalMs: 5,
    onLaunch: async () => { callbacks++; await never(); },
    drive: async () => { throw new Error('drive_must_not_run'); } });
  assert.ok(Date.now() - started < ESCALATE_MS + 3_000, 'the run ended within its bound');
  assert.equal(callbacks, 1, 'the deadline fired while the launch callback was pending');
  assert.equal(outcome.launched, false);
  assert.equal(outcome.stopped, 'deadline_exceeded');
  assert.match(outcome.failure.message, /deadline_exceeded/);
  assert.ok(run.gone(run.pane), 'the host was killed and reaped');
  const grandchild = run.grandchild();
  if (grandchild) assert.equal(alive(grandchild), false);
});

test('a signal while the launch callback is pending tears the launch down and rejects', { timeout: 10_000 }, async t => {
  const run = instantLaunch(t);
  const launching = launchPrivateTmux({ ...run.options, onLaunch: never });
  // Let the host come fully up (with its grandchild) before the signal arrives.
  for (let i = 0; i < 250 && !run.grandchild(); i++) await delay(20);
  assert.ok(run.grandchild(), 'the synthetic host started');
  const started = Date.now();
  run.signals.emit('SIGTERM');
  await assert.rejects(launching, /interrupted:SIGTERM/);
  assert.ok(Date.now() - started < ESCALATE_MS + 3_000, 'the launch rejected within its bound');
  assert.ok(run.gone(run.pane), 'the host was killed and reaped');
  assert.equal(alive(run.grandchild()), false);
});

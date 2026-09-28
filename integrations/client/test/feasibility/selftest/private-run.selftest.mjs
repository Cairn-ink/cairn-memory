// Offline self-test for `runPrivateTmux`, the interactive driver's whole run:
// the deadline is armed before launch, and the host is always torn down, even
// when a step never settles. Fake hosts run in a real private tmux server
// (see tmux-fixtures.mjs).
import assert from 'node:assert/strict';
import test from 'node:test';
import { runPrivateTmux } from '../lib/private-tmux.mjs';
import { alive, ESCALATE_MS, serverUp, setup } from './tmux-fixtures.mjs';

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

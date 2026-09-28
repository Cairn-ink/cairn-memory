// Offline self-test for the interactive driver's supervision, with fake hosts in
// a real private tmux server (its own -L socket, no configuration). Each test
// records its socket and the pane's process group and removes exactly those
// afterwards, never by matching process names.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from '../../../../../tools/testing/workspace.mjs';
import { writeLedger } from '../lib/ledger.mjs';
import { createWaiter, launchPrivateTmux, tmux } from '../lib/private-tmux.mjs';
import { createInterruptGuard } from '../lib/supervise.mjs';

// A fake host that records and ignores every terminating signal, starts a
// grandchild that ignores them too, and never finishes its reply.
const STUBBORN = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => fs.appendFileSync(process.argv[3], signal + '\\n'));
const child = spawn(process.execPath, ['-e', "for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
fs.writeFileSync(process.argv[2], JSON.stringify({ host: process.pid, grandchild: child.pid }));
console.log('thinking');
setInterval(() => {}, 1000);
`;

const ESCALATE_MS = 300;
const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const serverUp = socket => tmux(socket, 'list-sessions').status === 0;
const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

function setup(t) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-private-tmux-' });
  const socket = `f0-selftest-${randomBytes(6).toString('hex')}`;
  const signals = new EventEmitter();
  const guard = createInterruptGuard({ signals, escalateMs: ESCALATE_MS });
  guard.install();
  const script = join(workspace.path, 'stubborn.cjs');
  writeFileSync(script, STUBBORN);
  const pidsFile = join(workspace.path, 'pids.json');
  const signalLog = join(workspace.path, 'signals.log');
  const groups = new Set();
  const socketPaths = new Set();
  t.after(() => {
    guard.dispose();
    for (const pgid of groups) { try { process.kill(-pgid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
    tmux(socket, 'kill-server');
    for (const path of socketPaths) { try { unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; } }
  });
  const waitFor = createWaiter({ guard, deadline: Date.now() + 20_000, intervalMs: 50 });
  const launch = onLaunch => launchPrivateTmux({ socket, cwd: workspace.path, guard, escalateMs: ESCALATE_MS,
    command: [process.execPath, script, pidsFile, signalLog].map(quote).join(' '),
    onLaunch: async launched => {
      groups.add(launched.panePid);
      socketPaths.add(launched.socketPath);
      await onLaunch?.(launched);
    } });
  const hostReady = () => existsSync(pidsFile) && readFileSync(pidsFile, 'utf8').includes('grandchild');
  const pids = () => JSON.parse(readFileSync(pidsFile, 'utf8'));
  const signalsSeen = () => (existsSync(signalLog) ? readFileSync(signalLog, 'utf8').trim().split('\n') : []);
  const socketGone = () => [...socketPaths].every(path => !existsSync(path));
  return { workspace, socket, signals, guard, waitFor, launch, hostReady, pids, signalsSeen, socketGone };
}

test('a signal mid-reply is forwarded to the pane group, escalated, and the private server is stopped', async t => {
  const run = setup(t);
  const host = await run.launch();
  await run.waitFor(() => run.hostReady() && host.pane().includes('thinking'), 10_000, 'host ready');
  const { host: hostPid, grandchild } = run.pids();
  // The driver is waiting for a reply that never comes when the signal arrives.
  const reply = run.waitFor(() => host.pane().includes('OK1'), 10_000, 'reply');
  setTimeout(() => run.signals.emit('SIGINT'), 100);
  await assert.rejects(reply, /interrupted:SIGINT/);
  const started = Date.now();
  await host.teardown();
  assert.ok(Date.now() - started < ESCALATE_MS + 3_000, 'teardown is bounded');
  assert.equal(run.guard.interrupted, 'SIGINT');
  assert.ok(run.signalsSeen().includes('SIGINT'), 'the host received the forwarded signal');
  assert.equal(alive(hostPid), false);
  assert.equal(alive(grandchild), false);
  assert.equal(serverUp(run.socket), false);
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
  assert.ok(launched?.panePid > 0);
  const { host: hostPid, grandchild } = run.pids();
  // SIGTERM comes first; when the pane's shell exits the kernel may add SIGHUP.
  // The host ignores both, so only the SIGKILL escalation can have ended it.
  assert.equal(run.signalsSeen()[0], 'SIGTERM');
  assert.equal(alive(hostPid), false);
  assert.equal(alive(grandchild), false);
  assert.equal(serverUp(run.socket), false);
  assert.ok(run.socketGone(), 'the private socket file is removed');
});

test('a signal before launch prevents tmux from starting', async t => {
  const run = setup(t);
  run.signals.emit('SIGTERM');
  await assert.rejects(run.launch(), /interrupted_before_launch:SIGTERM/);
  await delay(200);
  assert.equal(serverUp(run.socket), false);
  assert.equal(run.hostReady(), false);
});

test('the overall deadline bounds every wait', async () => {
  const guard = createInterruptGuard({ signals: new EventEmitter() });
  const waitFor = createWaiter({ guard, deadline: Date.now() + 150, intervalMs: 20 });
  const started = Date.now();
  await assert.rejects(waitFor(() => false, 60_000, 'never'), /timeout_waiting_for:never/);
  assert.ok(Date.now() - started < 1_000);
});

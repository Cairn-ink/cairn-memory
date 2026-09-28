// Offline self-test with fake hosts: orchestrator signals reach the host's
// whole process group, escalate after the bound, and the launch is persisted
// before waiting.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../../../tools/testing/workspace.mjs';
import { createInterruptGuard, superviseHost, TERMINATING_SIGNALS } from '../lib/supervise.mjs';

// A fake host that ignores SIGTERM (recording each one) and starts a grandchild that ignores it too.
const STUBBORN = `
const { spawn } = require('node:child_process');
process.on('SIGTERM', () => { if (process.argv[2]) require('node:fs').appendFileSync(process.argv[2], 'SIGTERM\\n'); });
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
require('node:fs').writeFileSync(process.argv[1], JSON.stringify({ host: process.pid, grandchild: child.pid }));
console.log('ready');
setInterval(() => {}, 1000);
`;
const POLITE = "console.log('ready'); setInterval(() => {}, 1000);";

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };

function start(t, script, { signals = new EventEmitter(), timeoutMs = 20_000, escalateMs = 300 } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-supervise-' });
  const pidsFile = join(workspace.path, 'pids.json');
  const launchFile = join(workspace.path, 'launch.json');
  const guard = createInterruptGuard({ signals, escalateMs });
  guard.install();
  t.after(() => guard.dispose());
  let onReady;
  const ready = new Promise(resolve => { onReady = resolve; });
  const result = superviseHost({ command: process.execPath, args: ['-e', script, pidsFile], cwd: workspace.path,
    env: { PATH: process.env.PATH }, guard, timeoutMs, escalateMs,
    // Stand-in for the ledger write that must happen before waiting.
    onSpawn: launch => writeFileSync(launchFile, JSON.stringify(launch)),
    onStdoutLine: line => { if (line === 'ready') onReady(); } });
  return { guard, signals, ready, result, pidsFile, launchFile };
}

test('SIGTERM to the orchestrator reaches the host group and escalates to SIGKILL', async t => {
  const run = start(t, STUBBORN);
  await run.ready;
  assert.equal(existsSync(run.launchFile), true, 'launch persisted before the signal');
  const pids = JSON.parse(readFileSync(run.pidsFile, 'utf8'));
  const started = Date.now();
  run.signals.emit('SIGTERM');
  const result = await run.result;
  assert.equal(result.interrupted, 'SIGTERM');
  assert.equal(result.signal, 'SIGKILL');
  assert.ok(Date.now() - started < 5_000);
  assert.equal(alive(pids.host), false);
  for (let i = 0; i < 40 && alive(pids.grandchild); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(alive(pids.grandchild), false, 'grandchild in the host group is gone');
});

test('a host that honours SIGINT stops without escalation', async t => {
  const run = start(t, POLITE, { escalateMs: 10_000 });
  await run.ready;
  const started = Date.now();
  run.signals.emit('SIGINT');
  const result = await run.result;
  assert.equal(result.interrupted, 'SIGINT');
  assert.equal(result.signal, 'SIGINT');
  assert.ok(Date.now() - started < 5_000);
});

test('a signal before launch prevents the launch', async t => {
  const signals = new EventEmitter();
  const guard = createInterruptGuard({ signals, escalateMs: 100 });
  guard.install();
  t.after(() => guard.dispose());
  signals.emit('SIGHUP');
  let spawned = false;
  await assert.rejects(superviseHost({ command: process.execPath, args: ['-e', POLITE], cwd: process.cwd(), env: {},
    guard, timeoutMs: 1_000, onSpawn: () => { spawned = true; } }), /interrupted_before_launch:SIGHUP/);
  assert.equal(spawned, false);
});

test('the timeout stops a host that ignores SIGTERM', async t => {
  const run = start(t, STUBBORN, { timeoutMs: 500, escalateMs: 300 });
  const result = await run.result;
  assert.equal(result.timedOut, true);
  assert.equal(result.interrupted, null);
  const pids = JSON.parse(readFileSync(run.pidsFile, 'utf8'));
  for (let i = 0; i < 40 && alive(pids.grandchild); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(alive(pids.host) || alive(pids.grandchild), false);
});

test('dispose removes every signal handler', () => {
  const signals = new EventEmitter();
  const guard = createInterruptGuard({ signals });
  guard.install();
  assert.ok(TERMINATING_SIGNALS.every(signal => signals.listenerCount(signal) === 1));
  guard.dispose();
  assert.ok(TERMINATING_SIGNALS.every(signal => signals.listenerCount(signal) === 0));
});

test('a failing launch write (ENOSPC) terminates, escalates and reaps the host, then rejects', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'f0-supervise-onspawn-' });
  const pidsFile = join(workspace.path, 'pids.json');
  const signalsFile = join(workspace.path, 'signals.log');
  const signals = new EventEmitter();
  const guard = createInterruptGuard({ signals, escalateMs: 400 });
  guard.install();
  t.after(() => guard.dispose());
  let closedAfter = null;
  const started = Date.now();
  await assert.rejects(superviseHost({ command: process.execPath, args: ['-e', STUBBORN, pidsFile, signalsFile],
    cwd: workspace.path, env: { PATH: process.env.PATH }, guard, timeoutMs: 60_000, escalateMs: 400,
    onSpawn: () => {
      // Stand-in for a slow ledger write: wait until the host has installed its handler, then fail.
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      for (let i = 0; i < 250 && !existsSync(pidsFile); i++) Atomics.wait(sleeper, 0, 0, 20);
      throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    } }), error => { closedAfter = Date.now() - started; return error.code === 'ENOSPC'; });
  const pids = JSON.parse(readFileSync(pidsFile, 'utf8'));
  assert.match(readFileSync(signalsFile, 'utf8'), /SIGTERM/, 'the host received SIGTERM');
  assert.equal(alive(pids.host), false, 'the host was killed and reaped');
  for (let i = 0; i < 40 && alive(pids.grandchild); i++) await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(alive(pids.grandchild), false, 'the host group is gone');
  assert.ok(closedAfter >= 400 && closedAfter < 10_000, `escalated after the bound (${closedAfter} ms)`);
});

test('a host that exits on SIGTERM is reaped without waiting for the bound when the launch write fails', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'f0-supervise-onspawn-polite-' });
  const guard = createInterruptGuard({ signals: new EventEmitter(), escalateMs: 5_000 });
  guard.install();
  t.after(() => guard.dispose());
  const started = Date.now();
  let pid;
  await assert.rejects(superviseHost({ command: process.execPath, args: ['-e', POLITE], cwd: workspace.path,
    env: { PATH: process.env.PATH }, guard, timeoutMs: 60_000, escalateMs: 5_000,
    onSpawn: launch => { pid = launch.pid; throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); } }), /no space/);
  assert.ok(Date.now() - started < 4_000);
  assert.equal(alive(pid), false);
});

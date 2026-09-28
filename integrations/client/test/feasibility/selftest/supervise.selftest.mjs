// Offline self-test with fake hosts: orchestrator signals reach the host's
// whole process group, escalate after the bound, and the launch is persisted
// before waiting.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
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

// Like STUBBORN, but writes one full line and a final partial line, then closes stdout and keeps running.
const PARTIAL = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
process.on('SIGTERM', () => fs.appendFileSync(process.argv[2], 'SIGTERM\\n'));
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
fs.writeFileSync(process.argv[1], JSON.stringify({ host: process.pid, grandchild: child.pid }));
fs.writeSync(1, 'line one\\npartial-without-newline');
fs.closeSync(1);
setInterval(() => {}, 1000);
`;
const CHATTY = "console.log('a'); console.log('b'); console.log('c'); setInterval(() => {}, 1000);";

const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };

/**
 * Each fake host leads its own process group (pgid = pid). Tests record that id
 * and kill exactly that group afterwards, so a broken supervisor cannot leave a
 * fake host behind; F0_SELFTEST_PGID_LOG, when set, also receives the ids.
 */
function recordGroup(t) {
  const groups = new Set();
  t.after(() => {
    for (const pgid of groups) { try { process.kill(-pgid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; } }
  });
  return pgid => {
    groups.add(pgid);
    if (process.env.F0_SELFTEST_PGID_LOG) appendFileSync(process.env.F0_SELFTEST_PGID_LOG, `${pgid}\n`);
  };
}

const waitGone = async pid => { for (let i = 0; i < 40 && alive(pid); i++) await new Promise(resolve => setTimeout(resolve, 50)); };

function start(t, script, { signals = new EventEmitter(), timeoutMs = 20_000, escalateMs = 300 } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-supervise-' });
  const pidsFile = join(workspace.path, 'pids.json');
  const launchFile = join(workspace.path, 'launch.json');
  const guard = createInterruptGuard({ signals, escalateMs });
  guard.install();
  t.after(() => guard.dispose());
  const record = recordGroup(t);
  let onReady;
  const ready = new Promise(resolve => { onReady = resolve; });
  const result = superviseHost({ command: process.execPath, args: ['-e', script, pidsFile], cwd: workspace.path,
    env: { PATH: process.env.PATH }, guard, timeoutMs, escalateMs,
    // Stand-in for the ledger write that must happen before waiting.
    onSpawn: launch => { record(launch.pid); writeFileSync(launchFile, JSON.stringify(launch)); },
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
  const record = recordGroup(t);
  let closedAfter = null;
  const started = Date.now();
  await assert.rejects(superviseHost({ command: process.execPath, args: ['-e', STUBBORN, pidsFile, signalsFile],
    cwd: workspace.path, env: { PATH: process.env.PATH }, guard, timeoutMs: 60_000, escalateMs: 400,
    onSpawn: launch => {
      record(launch.pid);
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
  const record = recordGroup(t);
  const started = Date.now();
  let pid;
  await assert.rejects(superviseHost({ command: process.execPath, args: ['-e', POLITE], cwd: workspace.path,
    env: { PATH: process.env.PATH }, guard, timeoutMs: 60_000, escalateMs: 5_000,
    onSpawn: launch => { pid = launch.pid; record(pid); throw Object.assign(new Error('no space'), { code: 'ENOSPC' }); } }), /no space/);
  assert.ok(Date.now() - started < 4_000);
  assert.equal(alive(pid), false);
});

/** Supervise a fake host whose callbacks may fail; returns what the test needs to check the outcome. */
function failingRun(t, script, callbacks, escalateMs = 400) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-supervise-callback-' });
  const pidsFile = join(workspace.path, 'pids.json');
  const signalsFile = join(workspace.path, 'signals.log');
  const guard = createInterruptGuard({ signals: new EventEmitter(), escalateMs });
  guard.install();
  t.after(() => guard.dispose());
  const record = recordGroup(t);
  const started = Date.now();
  const result = superviseHost({ command: process.execPath, args: ['-e', script, pidsFile, signalsFile], cwd: workspace.path,
    env: { PATH: process.env.PATH }, guard, timeoutMs: 60_000, escalateMs,
    onSpawn: launch => record(launch.pid), ...callbacks });
  return { result, pidsFile, signalsFile, started };
}

async function assertTerminatedStubborn(run, escalateMs = 400) {
  const elapsed = Date.now() - run.started;
  const pids = JSON.parse(readFileSync(run.pidsFile, 'utf8'));
  assert.match(readFileSync(run.signalsFile, 'utf8'), /SIGTERM/, 'the host received SIGTERM first');
  assert.ok(elapsed >= escalateMs, `SIGKILL only after the ${escalateMs} ms bound (${elapsed} ms)`);
  assert.equal(alive(pids.host), false, 'the host was killed and reaped');
  await waitGone(pids.grandchild);
  assert.equal(alive(pids.grandchild), false, 'the whole host group is gone');
}

test('a failing streamed-line callback (ENOSPC) terminates, escalates and reaps a stubborn host, then rejects',
  { timeout: 20_000 }, async t => {
    const lines = [];
    const run = failingRun(t, STUBBORN, { onStdoutLine: line => {
      lines.push(line);
      // Stand-in for the thread-binding ledger write failing when `thread.started` arrives.
      if (line === 'ready') throw Object.assign(new Error('no space left on device'), { code: 'ENOSPC' });
    } });
    await assert.rejects(run.result, error => error.code === 'ENOSPC');
    await assertTerminatedStubborn(run);
    assert.deepEqual(lines, ['ready']);
  });

test('a failing final partial-line callback terminates, escalates and reaps a stubborn host, then rejects',
  { timeout: 20_000 }, async t => {
    const lines = [];
    const run = failingRun(t, PARTIAL, { onStdoutLine: line => {
      lines.push(line);
      if (line === 'partial-without-newline') throw Object.assign(new Error('final line failed'), { code: 'ENOSPC' });
    } });
    await assert.rejects(run.result, /final line failed/);
    await assertTerminatedStubborn(run);
    assert.deepEqual(lines, ['line one', 'partial-without-newline']);
  });

test('the call settles once: later lines are not delivered after the first failure, and a host exiting during cleanup is fine',
  { timeout: 20_000 }, async t => {
    const seen = [];
    const run = failingRun(t, CHATTY, { onStdoutLine: line => {
      seen.push(line);
      throw new Error(`failure on ${line}`);
    } }, 5_000);
    await assert.rejects(run.result, /failure on a/);
    assert.deepEqual(seen, ['a']);
    assert.ok(Date.now() - run.started < 4_000, 'a host that exits on SIGTERM is not held for the bound');
  });

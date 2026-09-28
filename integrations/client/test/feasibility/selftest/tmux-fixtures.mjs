// Fixtures for the private tmux self-tests; not a test file itself. Fake hosts
// run in a real private tmux server (its own -L socket, no configuration), and a
// fake tmux client never exits. Each test records its socket, the pane's process
// group and every fake client's pid, and removes exactly those afterwards, never
// by matching process names.
import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, lstatSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../../../tools/testing/workspace.mjs';
import { createWaiter, launchPrivateTmux, tmux } from '../lib/private-tmux.mjs';
import { createInterruptGuard } from '../lib/supervise.mjs';

// A fake host that records and ignores every terminating signal, starts a
// grandchild that ignores them too, and never finishes its reply.
export const STUBBORN = `
const fs = require('node:fs');
const { spawn } = require('node:child_process');
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, () => fs.appendFileSync(process.argv[3], signal + '\\n'));
const child = spawn(process.execPath, ['-e', "for (const s of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(s, () => {}); setInterval(() => {}, 1000)"], { stdio: 'ignore' });
fs.writeFileSync(process.argv[2], JSON.stringify({ host: process.pid, grandchild: child.pid }));
console.log('thinking');
setInterval(() => {}, 1000);
`;

export const ESCALATE_MS = 300;
export const alive = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
export const serverUp = async socket => (await tmux(socket, ['list-sessions'])).status === 0;
export const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
export const killRecorded = (ids, group) => {
  for (const id of ids) {
    try { process.kill(group ? -id : id, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  }
};

export function setup(t) {
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
  const servers = new Set();
  // Where tmux(1) puts the socket without TMUX_TMPDIR, in case the launch never reports it.
  const socketPaths = new Set([`/tmp/tmux-${process.getuid()}/${socket}`]);
  const waitFor = createWaiter({ guard, deadline: Date.now() + 20_000, intervalMs: 50 });
  t.after(async () => {
    waitFor.dispose();
    guard.dispose();
    killRecorded(groups, true);
    await tmux(socket, ['kill-server']);
    killRecorded(servers, false);
    for (const path of socketPaths) {
      try { if (lstatSync(path).isSocket()) unlinkSync(path); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  });
  const launchOptions = onLaunch => ({ socket, cwd: workspace.path, guard, escalateMs: ESCALATE_MS,
    pidFile: join(workspace.path, 'pane.pid'), command: [process.execPath, script, pidsFile, signalLog].map(quote).join(' '),
    onLaunch: async launched => {
      groups.add(launched.panePid);
      servers.add(launched.serverPid);
      socketPaths.add(launched.socketPath);
      await onLaunch?.(launched);
    } });
  const launch = onLaunch => launchPrivateTmux(launchOptions(onLaunch));
  const hostReady = () => existsSync(pidsFile) && readFileSync(pidsFile, 'utf8').includes('grandchild');
  const pids = () => JSON.parse(readFileSync(pidsFile, 'utf8'));
  const signalsSeen = () => (existsSync(signalLog) ? readFileSync(signalLog, 'utf8').trim().split('\n') : []);
  const socketGone = () => [...socketPaths].every(path => !existsSync(path));
  const ready = host => waitFor(async () => hostReady() && (await host.pane()).includes('thinking'), 10_000, 'host ready');
  return { workspace, socket, signals, guard, waitFor, launch, launchOptions, ready, hostReady, pids, signalsSeen,
    socketGone };
}

/**
 * A `tmux` first on PATH that records its pid and never exits, ignoring SIGTERM
 * and SIGHUP. With `startsPane`, `new-session` first starts its pane command in
 * a new session, as tmux does, and only then stalls.
 */
export function fakeTmux(t, { startsPane = false } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'f0-fake-tmux-' });
  const bin = join(workspace.path, 'bin');
  mkdirSync(bin);
  const pidLog = join(workspace.path, 'fake-tmux.pids');
  const pane = startsPane
    ? 'case " $* " in *" new-session "*) for last; do :; done; setsid /bin/sh -c "$last" </dev/null >/dev/null 2>&1 & ;; esac\n'
    : '';
  writeFileSync(join(bin, 'tmux'), `#!/bin/sh\necho "$$" >> ${quote(pidLog)}\n${pane}exec ${quote(process.execPath)} -e `
    + `"process.on('SIGTERM', () => {}); process.on('SIGHUP', () => {}); setInterval(() => {}, 1000)"\n`, { mode: 0o755 });
  const originalPath = process.env.PATH;
  process.env.PATH = `${bin}:${originalPath}`;
  const seen = new Set();
  const pids = () => {
    if (existsSync(pidLog)) for (const line of readFileSync(pidLog, 'utf8').split('\n')) if (line) seen.add(Number(line));
    return [...seen];
  };
  t.after(() => {
    process.env.PATH = originalPath;
    killRecorded(seen, false);
  });
  return { workspace, pids };
}

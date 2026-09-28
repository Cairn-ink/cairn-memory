// A host process in a private tmux server (its own -L socket), supervised from
// launch: the interrupt guard forwards signals to the pane's process group, and a
// failing launch callback (the ledger write) tears everything down before the
// error is rethrown. Teardown is bounded: SIGTERM to the pane group, SIGKILL after
// the bound, then the private server is stopped and its socket, at the exact path
// the server reported, is removed. The server never reads the person's tmux
// configuration (-f /dev/null).
import { spawnSync } from 'node:child_process';
import { lstatSync, unlinkSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export function tmux(socket, ...args) {
  // SHELL fixes the server's default shell, which runs the pane command.
  const result = spawnSync('tmux', ['-f', '/dev/null', '-L', socket, ...args],
    { encoding: 'utf8', env: { ...process.env, SHELL: '/bin/sh' } });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

const groupAlive = pid => signalGroup(pid, 0);

/**
 * Launch `command` (a shell string) as the only pane of a new session on the
 * private `socket`. `guard` must already be installed; `onLaunch` runs after the
 * pane exists and may persist the launch.
 */
export async function launchPrivateTmux({ socket, command, cwd, guard, onLaunch = () => {}, escalateMs = 5_000,
  width = 200, height = 50 }) {
  if (guard.interrupted) throw new Error(`interrupted_before_launch:${guard.interrupted}`);
  const created = tmux(socket, 'new-session', '-d', '-P', '-F', '#{session_id} #{pane_pid} #{socket_path}',
    '-x', String(width), '-y', String(height), '-c', cwd, command);
  if (created.status !== 0) throw new Error(`tmux_new_session_failed:${created.stderr.trim()}`);
  const [session, pane, ...rest] = created.stdout.trim().split(' ');
  const panePid = Number(pane);
  const socketPath = rest.join(' ');
  // tmux starts each pane in its own session, so its pid is also its process group.
  guard.attach(panePid);
  let torn = null;
  const teardown = () => (torn ??= (async () => {
    const deadline = Date.now() + escalateMs;
    signalGroup(panePid, 'SIGTERM');
    while (groupAlive(panePid) && Date.now() < deadline) await delay(50);
    if (groupAlive(panePid)) signalGroup(panePid, 'SIGKILL');
    for (let i = 0; i < 40 && groupAlive(panePid); i++) await delay(50);
    tmux(socket, 'kill-server');
    for (let i = 0; i < 40 && tmux(socket, 'list-sessions').status === 0; i++) await delay(50);
    // tmux 3.2a leaves the socket file behind; remove it only once the server is gone.
    if (tmux(socket, 'list-sessions').status !== 0) {
      try { if (lstatSync(socketPath).isSocket()) unlinkSync(socketPath); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  })());
  try { await onLaunch({ socket, socketPath, session, panePid }); }
  catch (error) {
    await teardown();
    throw error;
  }
  return {
    socket, socketPath, session, panePid, teardown,
    pane: () => tmux(socket, 'capture-pane', '-p', '-t', session, '-S', '-80').stdout,
    keys: (...keyArgs) => tmux(socket, 'send-keys', '-t', session, ...keyArgs),
    alive: () => tmux(socket, 'has-session', '-t', session).status === 0,
  };
}

/**
 * Poll `check` (sync or async) until it is true. Throws on an interrupt, the
 * step's own bound, or the run's overall `deadline`, whichever comes first.
 */
export function createWaiter({ guard, deadline, intervalMs = 500 }) {
  return async (check, timeoutMs, label) => {
    const stepDeadline = Math.min(Date.now() + timeoutMs, deadline);
    while (Date.now() < stepDeadline) {
      if (guard.interrupted) throw new Error(`interrupted:${guard.interrupted}`);
      if (await check()) return true;
      await delay(intervalMs);
    }
    if (guard.interrupted) throw new Error(`interrupted:${guard.interrupted}`);
    throw new Error(`timeout_waiting_for:${label}`);
  };
}

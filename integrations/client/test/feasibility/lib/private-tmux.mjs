// A host process in a private tmux server (its own -L socket), supervised from
// launch. Every tmux call is an asynchronous client process with its own
// timeout, which kills the client, so no call can block supervision. The run's
// deadline is a timer: when it fires the host is torn down and every wait
// rejects, whatever check, tmux call or launch callback is still pending. The
// teardown exists before anything is spawned, so nothing waits for the launch
// to settle. The interrupt guard forwards signals to the pane's process group,
// and a failing launch callback (the ledger write) tears everything down before
// the error is rethrown.
//
// Teardown is bounded: SIGTERM to the pane's group, SIGKILL after the bound;
// then `kill-server`, and the server pid tmux reported gets the same escalation;
// then the socket is removed at its exact path once the server is gone. The
// pane records its own pid before it becomes the host, so a launch whose tmux
// client fails after the pane started can still be torn down. The server never
// reads the person's tmux configuration (-f /dev/null) and runs panes with /bin/sh.
import { spawn } from 'node:child_process';
import { lstatSync, readFileSync, unlinkSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export const TMUX_CALL_TIMEOUT_MS = 5_000;

const quote = value => `'${String(value).replace(/'/g, `'\\''`)}'`;

function tmuxEnv() {
  const env = { ...process.env, SHELL: '/bin/sh' };
  for (const name of ['TMUX', 'TMUX_PANE', 'TMUX_TMPDIR']) delete env[name];
  return env;
}

/** Where tmux(1) puts a `-L` socket when TMUX_TMPDIR is unset, as it is for these calls. */
export const defaultSocketPath = socket => `/tmp/tmux-${process.getuid()}/${socket}`;

/**
 * Run one tmux client call. The client is killed with SIGKILL when `timeoutMs`
 * passes or `signal` aborts. Always resolves; `status` is null unless the
 * client exited on its own.
 */
export function tmux(socket, args, { timeoutMs = TMUX_CALL_TIMEOUT_MS, signal } = {}) {
  return new Promise(resolve => {
    if (signal?.aborted) {
      resolve({ status: null, stdout: '', stderr: '', timedOut: false, aborted: true, pid: null });
      return;
    }
    const child = spawn('tmux', ['-f', '/dev/null', '-L', socket, ...args], { env: tmuxEnv(), stdio: ['ignore', 'pipe', 'pipe'] });
    const out = [];
    const err = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stderr.on('data', chunk => err.push(chunk));
    let timedOut = false;
    let aborted = false;
    let settled = false;
    let grace = null;
    const kill = () => { if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL'); };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutMs);
    const onAbort = () => { aborted = true; kill(); };
    signal?.addEventListener('abort', onAbort, { once: true });
    const finish = (status, spawnError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(grace);
      signal?.removeEventListener('abort', onAbort);
      child.stdout.destroy();
      child.stderr.destroy();
      resolve({ status: timedOut || aborted ? null : status, stdout: Buffer.concat(out).toString('utf8'),
        stderr: spawnError ? spawnError.message : Buffer.concat(err).toString('utf8'), timedOut, aborted,
        pid: child.pid ?? null });
    };
    child.on('error', error => finish(null, error));
    // A process that inherited the client's pipes must not hold the call open.
    child.on('exit', status => { grace = setTimeout(() => finish(status), 250); });
    child.on('close', status => finish(status));
  });
}

function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

function signalProcess(pid, signal) {
  try { process.kill(pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

/** The process group of `pid` from /proc/<pid>/stat, or null once it is gone. */
function processGroup(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    return Number(stat.slice(stat.lastIndexOf(')') + 1).trim().split(' ')[2]);
  } catch { return null; }
}

/** The pid the pane wrote, only while it still leads its own process group. */
function recordedPanePid(pidFile) {
  let text;
  try { text = readFileSync(pidFile, 'utf8').trim(); } catch { return null; }
  if (!/^[1-9][0-9]*$/.test(text)) return null;
  const pid = Number(text);
  return pid > 1 && processGroup(pid) === pid ? pid : null;
}

async function until(done, ms) {
  const deadline = Date.now() + ms;
  while (!done() && Date.now() < deadline) await delay(50);
  return done();
}

async function stopGroup(pgid, escalateMs) {
  signalGroup(pgid, 'SIGTERM');
  if (!(await until(() => !signalGroup(pgid, 0), escalateMs))) signalGroup(pgid, 'SIGKILL');
  await until(() => !signalGroup(pgid, 0), 2_000);
}

async function stopProcess(pid, escalateMs) {
  if (await until(() => !signalProcess(pid, 0), escalateMs)) return;
  signalProcess(pid, 'SIGTERM');
  if (!(await until(() => !signalProcess(pid, 0), escalateMs))) signalProcess(pid, 'SIGKILL');
  await until(() => !signalProcess(pid, 0), 2_000);
}

/** `promise`, unless `signal` aborts or `guard` receives a signal first. */
function untilStopped(promise, { signal, guard }) {
  let cleanup = () => {};
  const stopped = new Promise((_, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const onAbort = () => reject(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    cleanup = () => signal?.removeEventListener('abort', onAbort);
    guard.whenInterrupted?.then(received => reject(new Error(`interrupted:${received}`)));
  });
  return Promise.race([promise, stopped]).finally(cleanup);
}

/**
 * Launch `command` (a shell string) as the only pane of a new session on the
 * private `socket`. `guard` must already be installed. The teardown exists
 * before anything is spawned and is handed to `onSpawn` at once, so a caller
 * can always stop the launch without waiting for it; a teardown while
 * `new-session` is pending kills that client first. `signal` (the run's
 * deadline or interrupt) aborts pending tmux calls; teardown never uses it.
 * `onLaunch` runs after the pane exists and may persist the launch. Waiting for
 * it ends at once when `signal` aborts or the guard receives a signal, and then
 * the launch is torn down and rejects.
 */
export async function launchPrivateTmux({ socket, command, cwd, guard, pidFile, signal, onSpawn = () => {},
  onLaunch = () => {}, escalateMs = 5_000, callTimeoutMs = TMUX_CALL_TIMEOUT_MS, width = 200, height = 50 }) {
  if (typeof pidFile !== 'string') throw new Error('pid_file_required');
  if (guard.interrupted) throw new Error(`interrupted_before_launch:${guard.interrupted}`);
  if (signal?.aborted) throw new Error(`aborted_before_launch:${signal.reason?.message ?? 'aborted'}`);
  // A pid left by an earlier launch must never be taken for this pane's.
  try { unlinkSync(pidFile); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const call = (args, options) => tmux(socket, args, { timeoutMs: callTimeoutMs, ...options });
  const state = { session: null, panePid: null, serverPid: null, socketPath: defaultSocketPath(socket) };
  // The new-session client stops on the run's signal or on teardown.
  const spawning = new AbortController();
  const forward = () => spawning.abort(signal.reason);
  signal?.addEventListener('abort', forward, { once: true });
  let creating = null;

  let torn = null;
  // Only the server pid tmux itself reported is ever signalled; without it the
  // server gets `kill-server` alone.
  const teardown = () => (torn ??= (async () => {
    spawning.abort(new Error('teardown'));
    if (creating) await creating;
    state.panePid ??= recordedPanePid(pidFile);
    if (state.panePid) await stopGroup(state.panePid, escalateMs);
    const killed = await call(['kill-server']);
    if (!state.panePid) {
      // A pane that started while the launch call was failing.
      state.panePid = recordedPanePid(pidFile);
      if (state.panePid) await stopGroup(state.panePid, escalateMs);
    }
    if (state.serverPid) await stopProcess(state.serverPid, escalateMs);
    const serverGone = state.serverPid ? !signalProcess(state.serverPid, 0)
      : killed.status !== null && (await call(['list-sessions'])).status === 1;
    // tmux 3.2a leaves the socket file behind; remove it only once the server is gone.
    if (serverGone) {
      try { if (lstatSync(state.socketPath).isSocket()) unlinkSync(state.socketPath); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  })());
  onSpawn(teardown);

  creating = call(['new-session', '-d', '-P', '-F', '#{session_id} #{pane_pid} #{pid} #{socket_path}',
    '-x', String(width), '-y', String(height), '-c', cwd, `printf '%s\\n' "$$" > ${quote(pidFile)} && exec ${command}`],
  { signal: spawning.signal }).then(created => {
    signal?.removeEventListener('abort', forward);
    if (created.status === 0) {
      const [session, pane, server, ...rest] = created.stdout.trim().split(' ');
      Object.assign(state, { session, panePid: Number(pane), serverPid: Number(server),
        socketPath: rest.join(' ') || state.socketPath });
    } else {
      // The pane may have started even though the client did not report it.
      state.panePid = recordedPanePid(pidFile);
    }
    // tmux starts each pane in its own session, so its pid is also its process group.
    if (state.panePid) guard.attach(state.panePid);
    return created;
  });
  const created = await creating;
  if (created.status !== 0) {
    await teardown();
    const cause = created.timedOut ? 'timeout' : created.aborted ? 'aborted' : created.stderr.trim();
    throw new Error(`tmux_new_session_failed:${cause}`);
  }
  try {
    await untilStopped(Promise.resolve().then(() => onLaunch({ socket, socketPath: state.socketPath,
      session: state.session, panePid: state.panePid, serverPid: state.serverPid })), { signal, guard });
  } catch (error) {
    await teardown();
    throw error;
  }
  return {
    socket, socketPath: state.socketPath, session: state.session, panePid: state.panePid, serverPid: state.serverPid,
    teardown,
    pane: async () => (await call(['capture-pane', '-p', '-t', state.session, '-S', '-80'], { signal })).stdout,
    keys: (...keyArgs) => call(['send-keys', '-t', state.session, ...keyArgs], { signal }),
    alive: async () => (await call(['has-session', '-t', state.session], { signal })).status === 0,
  };
}

/**
 * The run's waits. The overall `deadline` is a timer armed here, before launch:
 * when it fires, `onExpire` runs (the driver tears the host down) and every
 * pending or later wait rejects with `deadline_exceeded`, whatever check or
 * tmux call is still pending. A signal the guard receives rejects them the same
 * way. Each wait also has its own bound, on a timer too. `waitFor.signal`
 * aborts with the same reason, `waitFor.race` applies it to any promise, and
 * `waitFor.dispose` disarms the deadline.
 */
export function createWaiter({ guard, deadline, intervalMs = 500, onExpire = () => {} }) {
  const controller = new AbortController();
  const abort = reason => { if (!controller.signal.aborted) controller.abort(new Error(reason)); };
  const aborted = new Promise((_, reject) => {
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
  });
  aborted.catch(() => {});
  const timer = setTimeout(() => {
    abort('deadline_exceeded');
    // The driver awaits the same idempotent teardown afterwards, where a failure surfaces.
    Promise.resolve().then(onExpire).catch(() => {});
  }, Math.max(0, deadline - Date.now()));
  guard.whenInterrupted?.then(signal => abort(`interrupted:${signal}`));
  const race = promise => Promise.race([promise, aborted]);
  const waitFor = (check, timeoutMs, label) => race(new Promise((resolve, reject) => {
    if (controller.signal.aborted) return;
    let done = false;
    const finish = (settle, value) => {
      if (done) return;
      done = true;
      clearTimeout(step);
      controller.signal.removeEventListener('abort', stop);
      settle(value);
    };
    const step = setTimeout(() => finish(reject, new Error(`timeout_waiting_for:${label}`)), timeoutMs);
    // The race has already rejected; this only stops polling.
    const stop = () => finish(() => {});
    controller.signal.addEventListener('abort', stop, { once: true });
    (async () => {
      while (!done) {
        const ok = await check();
        if (done) return;
        if (ok) { finish(resolve, true); return; }
        await delay(intervalMs);
      }
    })().catch(error => finish(reject, error));
  }));
  waitFor.signal = controller.signal;
  waitFor.race = race;
  waitFor.dispose = () => clearTimeout(timer);
  return waitFor;
}

/**
 * One supervised run: the deadline is armed before the launch, `drive` runs the
 * steps with the host, the run's `waitFor` and an abortable `pause`, and the
 * host is always torn down before this resolves. The teardown exists before
 * tmux spawns anything, so neither the deadline nor the final cleanup ever
 * waits for the launch or its callback to settle. When the deadline fires, the
 * teardown starts at once and the run ends, whatever step is still pending; a
 * guard signal ends it the same way. Resolves with what happened: whether the
 * launch completed, the first failure, and the reason the run was stopped.
 */
export async function runPrivateTmux({ guard, deadline, drive, intervalMs, ...launchOptions }) {
  let teardown = null;
  const waitFor = createWaiter({ guard, deadline, intervalMs, onExpire: () => teardown?.() });
  const pause = ms => delay(ms, undefined, { signal: waitFor.signal });
  let launched = false;
  let failure = null;
  try {
    const launching = launchPrivateTmux({ ...launchOptions, guard, signal: waitFor.signal,
      onSpawn: stop => { teardown = stop; } });
    const host = await waitFor.race(launching);
    launched = true;
    await waitFor.race(drive({ host, waitFor, pause }));
  } catch (error) {
    failure = error;
  } finally {
    // Idempotent: joins a teardown the deadline or a failed launch already started.
    await teardown?.();
    waitFor.dispose();
  }
  return { launched, failure, stopped: waitFor.signal.aborted ? waitFor.signal.reason.message : null };
}

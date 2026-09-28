// Host supervision for the orchestrator. The host runs in its own process
// group; SIGINT, SIGTERM and SIGHUP sent to the orchestrator are forwarded to
// that group and escalate to SIGKILL after a bound, so an interrupted
// orchestrator never leaves a subscription process running.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

export const TERMINATING_SIGNALS = ['SIGINT', 'SIGTERM', 'SIGHUP'];
export const SIGNAL_EXIT = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

function signalGroup(pid, signal) {
  try { process.kill(-pid, signal); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
}

const groupAlive = pid => signalGroup(pid, 0);

/**
 * Install for the whole step, before any child starts. A signal that arrives
 * before launch prevents the launch; one that arrives after is forwarded.
 */
export function createInterruptGuard({ signals = process, escalateMs = 5_000 } = {}) {
  let received = null;
  let pid = null;
  let escalation = null;
  const forward = signal => {
    if (!pid) return;
    signalGroup(pid, signal);
    escalation ??= setTimeout(() => signalGroup(pid, 'SIGKILL'), escalateMs);
  };
  const handlers = new Map(TERMINATING_SIGNALS.map(signal => [signal, () => { received ??= signal; forward(signal); }]));
  return {
    install() { for (const [signal, handler] of handlers) signals.on(signal, handler); },
    attach(childPid) { pid = childPid; if (received) forward(received); },
    get interrupted() { return received; },
    /** After the host exits, wait for its whole group to go, escalating once the bound passes. */
    async settle() {
      if (!pid || !received) return;
      const deadline = Date.now() + escalateMs;
      while (groupAlive(pid) && Date.now() < deadline) await delay(50);
      if (groupAlive(pid)) signalGroup(pid, 'SIGKILL');
      for (let i = 0; i < 40 && groupAlive(pid); i++) await delay(50);
    },
    dispose() {
      for (const [signal, handler] of handlers) signals.removeListener(signal, handler);
      if (escalation) clearTimeout(escalation);
    },
  };
}

/** SIGTERM the host's group, SIGKILL it once `escalateMs` passes, and wait until the host is reaped. */
async function terminateGroup(pid, closed, escalateMs) {
  signalGroup(pid, 'SIGTERM');
  const exited = await Promise.race([closed.then(() => true), delay(escalateMs).then(() => false)]);
  if (!exited || groupAlive(pid)) signalGroup(pid, 'SIGKILL');
  await closed;
  for (let i = 0; i < 40 && groupAlive(pid); i++) await delay(50);
}

/**
 * Run one host process. Supervision (signal forwarding and the deadline) is in
 * place from the moment of spawn, before any caller code runs. `onSpawn` then
 * persists the launch; if it throws, the host is terminated and reaped and the
 * error is rethrown. `onStdoutLine` sees each stdout line.
 */
export async function superviseHost({ command, args, cwd, env, stdin = '', guard, timeoutMs, escalateMs = 5_000,
  probeInterruptAfterMs, onSpawn = () => {}, onStdoutLine = () => {} }) {
  if (guard.interrupted) throw new Error(`interrupted_before_launch:${guard.interrupted}`);
  const child = spawn(command, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const startedAt = Date.now();
  const closed = new Promise(resolve => child.once('close', (exitCode, signal) => resolve({ exitCode, signal })));
  const spawnError = new Promise(resolve => child.once('error', resolve));
  guard.attach(child.pid);
  let timedOut = false;
  let probeInterruptAt = null;
  const timers = [];
  timers.push(setTimeout(() => {
    timedOut = true;
    signalGroup(child.pid, 'SIGTERM');
    timers.push(setTimeout(() => signalGroup(child.pid, 'SIGKILL'), escalateMs));
  }, timeoutMs));
  const out = [];
  const err = [];
  let firstOutputAt = null;
  let pending = '';
  child.stdout.on('data', chunk => {
    firstOutputAt ??= Date.now();
    out.push(chunk);
    pending += chunk.toString('utf8');
    const parts = pending.split('\n');
    pending = parts.pop();
    for (const line of parts) onStdoutLine(line);
  });
  child.stderr.on('data', chunk => err.push(chunk));
  child.stdin.on('error', () => {});
  if (child.pid) {
    try { onSpawn({ pid: child.pid, startedAt }); }
    catch (error) {
      for (const timer of timers) clearTimeout(timer);
      await terminateGroup(child.pid, closed, escalateMs);
      throw error;
    }
  }
  // The prompt is written only after the launch is persisted.
  child.stdin.end(stdin);
  // Deliberate teardown probe: signal the host's own group mid-response.
  if (probeInterruptAfterMs) {
    timers.push(setTimeout(() => { probeInterruptAt = Date.now(); signalGroup(child.pid, 'SIGTERM'); }, probeInterruptAfterMs));
  }
  const outcome = await Promise.race([
    closed,
    spawnError.then(error => ({ exitCode: null, signal: null, error: error.code ?? String(error) })),
  ]);
  if (pending) onStdoutLine(pending);
  for (const timer of timers) clearTimeout(timer);
  await guard.settle();
  if (timedOut && child.pid && groupAlive(child.pid)) signalGroup(child.pid, 'SIGKILL');
  return { ...outcome, pid: child.pid ?? null, startedAt, exitAt: Date.now(), timedOut, probeInterruptAt,
    interrupted: guard.interrupted, firstOutputAt, stdout: Buffer.concat(out), stderr: Buffer.concat(err) };
}

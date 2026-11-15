import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';

const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const addListener = EventTarget.prototype.addEventListener, removeListener = EventTarget.prototype.removeEventListener;

const stages = new Set(['input', 'request', 'config_snapshot', 'authority_check', 'credential_check',
  'home_check', 'runtime_check', 'probe', 'spawn', 'child_exit', 'reply', 'deadline']);
const signals = new Set(['SIGHUP', 'SIGINT', 'SIGQUIT', 'SIGILL', 'SIGTRAP', 'SIGABRT', 'SIGBUS',
  'SIGEMT', 'SIGINFO', 'SIGFPE', 'SIGKILL', 'SIGUSR1', 'SIGSEGV', 'SIGUSR2', 'SIGPIPE', 'SIGALRM', 'SIGTERM',
  'SIGSTKFLT', 'SIGCHLD', 'SIGCONT', 'SIGSTOP', 'SIGTSTP', 'SIGTTIN', 'SIGTTOU', 'SIGURG',
  'SIGXCPU', 'SIGXFSZ', 'SIGVTALRM', 'SIGPROF', 'SIGWINCH', 'SIGIO', 'SIGPWR', 'SIGSYS']);
export class LocalCaptureTransportError extends Error {
  constructor(uncertain = false, stage = 'input', outcome) {
    super('local_capture_transport_failed'); this.code = 'local_capture_transport_failed'; this.uncertain = uncertain;
    // Only fixed labels and numeric/signal outcomes cross this boundary. Never
    // retain the underlying error, child diagnostics, paths or environment.
    this.stage = stages.has(stage) ? stage : 'input';
    if (outcome) {
      this.exitCode = Number.isInteger(outcome.exitCode) ? outcome.exitCode : null;
      this.signal = signals.has(outcome.signal) ? outcome.signal : null;
    }
  }
}

// One operation owns preparation, both child shapes and their actual close.
export function localProcessScope(deadlineMs, signal) {
  // A forged/proxied brand must refuse before allocating any timer. Native
  // methods also avoid caller-owned signal accessors during setup and cleanup.
  if (signal !== undefined) {
    if (types.isProxy(signal)) throw new LocalCaptureTransportError(false);
    aborted.call(signal);
  }
  const end = performance.now() + deadlineMs, workEnd = end - 2000;
  let failed = false, uncertain = false, terminate;
  const stop = () => { failed = true; terminate?.(); };
  const timer = setTimeout(stop, Math.max(0, workEnd - performance.now()));
  if (signal !== undefined) addListener.call(signal, 'abort', stop, { once: true });
  function check() {
    if (signal !== undefined && aborted.call(signal) || failed || performance.now() >= workEnd) {
      failed = true; throw new LocalCaptureTransportError(uncertain, 'deadline');
    }
  }
  return {
    check,
    get uncertain() { return uncertain; },
    close() { clearTimeout(timer); if (signal !== undefined) removeListener.call(signal, 'abort', stop); },
    async run(executable, args, env, input, { probe = false } = {}) {
      check();
      let child;
      try { child = spawn(executable, args, { shell: false, detached: false, env, stdio: ['pipe', 'pipe', 'pipe'] }); }
      catch { failed = true; throw new LocalCaptureTransportError(uncertain, probe ? 'probe' : 'spawn'); }
      // An ENOENT/permission spawn failure with no PID is known not-started.
      // Once the OS allocates the capture child, delivery is conservatively uncertain.
      if (!probe && Number.isInteger(child.pid)) uncertain = true;
      const output = [], stdoutLimit = probe ? 128 : 262144, stderrLimit = probe ? 128 : 65536;
      let stdoutBytes = 0, stderrBytes = 0, stdinFinished = false, closed = false, spawnFailed = false, escalation, probeTimer;
      const kill = () => {
        if (closed) return;
        try { child.kill('SIGTERM'); } catch { /* No arbitrary process error leaves this boundary. */ }
        escalation ??= setTimeout(() => { if (!closed) { try { child.kill('SIGKILL'); } catch {} } }, 1000);
      };
      const fail = () => { failed = true; kill(); };
      const spawnFail = () => { spawnFailed = true; fail(); };
      terminate = kill;
      if (probe) probeTimer = setTimeout(fail, Math.min(2000, Math.max(0, workEnd - performance.now())));
      const stdout = chunk => { stdoutBytes += chunk.byteLength; if (stdoutBytes > stdoutLimit) fail(); else if (!failed) output.push(chunk); };
      const stderr = chunk => { stderrBytes += chunk.byteLength; if (stderrBytes > stderrLimit) fail(); };
      const finish = () => { stdinFinished = true; };
      child.stdout.on('data', stdout); child.stderr.on('data', stderr);
      child.stdout.on('error', fail); child.stderr.on('error', fail); child.stdin.on('error', fail);
      child.stdin.once('finish', finish);
      try {
        const done = new Promise(resolve => {
          child.once('error', spawnFail);
          child.once('close', (code, signal) => { closed = true; resolve({ code, signal }); });
        });
        try { child.stdin.end(input); } catch { fail(); }
        const outcome = await done;
        if (outcome.code !== 0 || outcome.signal !== null || !stdinFinished) failed = true;
        try { check(); }
        catch { throw new LocalCaptureTransportError(uncertain, probe ? 'probe' : spawnFailed ? 'spawn' : 'child_exit',
          { exitCode: outcome.code, signal: outcome.signal }); }
        return Buffer.concat(output);
      } finally {
        clearTimeout(probeTimer); clearTimeout(escalation); terminate = undefined;
        child.stdout.off('data', stdout); child.stderr.off('data', stderr);
        child.stdout.off('error', fail); child.stderr.off('error', fail); child.stdin.off('error', fail);
        child.stdin.off('finish', finish); child.off('error', spawnFail);
      }
    },
  };
}

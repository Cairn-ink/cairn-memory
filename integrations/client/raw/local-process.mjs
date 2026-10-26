import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { types } from 'node:util';

const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const addListener = EventTarget.prototype.addEventListener, removeListener = EventTarget.prototype.removeEventListener;

export class LocalCaptureTransportError extends Error {
  constructor(uncertain = false) {
    super('local_capture_transport_failed'); this.code = 'local_capture_transport_failed'; this.uncertain = uncertain;
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
      failed = true; throw new LocalCaptureTransportError(uncertain);
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
      catch { failed = true; throw new LocalCaptureTransportError(uncertain); }
      // An ENOENT/permission spawn failure with no PID is known not-started.
      // Once the OS allocates the capture child, delivery is conservatively uncertain.
      if (!probe && Number.isInteger(child.pid)) uncertain = true;
      const output = [], stdoutLimit = probe ? 128 : 262144, stderrLimit = probe ? 128 : 65536;
      let stdoutBytes = 0, stderrBytes = 0, stdinFinished = false, closed = false, escalation, probeTimer;
      const kill = () => {
        if (closed) return;
        try { child.kill('SIGTERM'); } catch { /* No arbitrary process error leaves this boundary. */ }
        escalation ??= setTimeout(() => { if (!closed) { try { child.kill('SIGKILL'); } catch {} } }, 1000);
      };
      const fail = () => { failed = true; kill(); };
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
          child.once('error', fail);
          child.once('close', (code, signal) => { closed = true; resolve({ code, signal }); });
        });
        try { child.stdin.end(input); } catch { fail(); }
        const outcome = await done;
        if (outcome.code !== 0 || outcome.signal !== null || !stdinFinished) failed = true;
        check();
        return Buffer.concat(output);
      } finally {
        clearTimeout(probeTimer); clearTimeout(escalation); terminate = undefined;
        child.stdout.off('data', stdout); child.stderr.off('data', stderr);
        child.stdout.off('error', fail); child.stderr.off('error', fail); child.stdin.off('error', fail);
        child.stdin.off('finish', finish); child.off('error', fail);
      }
    },
  };
}

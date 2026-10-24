import { spawn } from 'node:child_process';
import { Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { refusal } from './common.mjs';
// Child stdio pipes are stream sockets on the supported POSIX targets. Poll
// the lifeline through libuv; fs.createReadStream leaves a blocking read in
// the worker pool, which can prevent process.exit from finishing while the
// supervisor still holds the writer open and waits for the child's exit.
export const openLifeline = (fd = 3) => new Socket({ fd, readable: true, writable: false });
export function childEnvironment(threads = 4) {
  const env = { OMP_NUM_THREADS: String(threads), OPENBLAS_NUM_THREADS: String(threads), MKL_NUM_THREADS: String(threads), HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip' };
  // Do not forward PATH, NODE_*, DYLD_*, LD_*, HOME, npm or credentials.
  for (const key of ['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) if (typeof process.env[key] === 'string') env[key] = process.env[key];
  return env;
}
export const groupExists = pid => { try { process.kill(-pid, 0); return true; } catch (e) { return e.code !== 'ESRCH'; } };
export const signalGroup = (pid, signal) => { try { process.kill(-pid, signal); } catch (e) { if (e.code !== 'ESRCH') throw refusal('child_crash'); } };
export async function reapGroup(pid, isClosed) {
  signalGroup(pid, 'SIGTERM');
  let escalated = false; const escalation = setTimeout(() => { escalated = true; try { signalGroup(pid, 'SIGKILL'); } catch { /* Keep slot quarantined until disappearance. */ } }, 250);
  try {
    while (!isClosed() || groupExists(pid)) {
      await delay(25);
      // Once KILL was required, repeat only to handle registration races;
      // capacity is never released on a timer or kill request alone.
      if (escalated && groupExists(pid)) { try { signalGroup(pid, 'SIGKILL'); } catch { /* Quarantine. */ } }
    }
  } finally { clearTimeout(escalation); }
}
export function spawnNode(runner, args, { stdio, threads = 4, env = childEnvironment(threads) } = {}) {
  if (process.platform !== 'linux' && process.platform !== 'darwin') throw refusal('model_runtime_unavailable');
  return spawn(process.execPath, [runner, ...args], { detached: true, shell: false, env, stdio });
}

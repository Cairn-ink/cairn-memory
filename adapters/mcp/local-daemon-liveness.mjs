// Linux OS metadata only; no environment, store or SQLite access.
import { readFileSync, readlinkSync, statSync } from 'node:fs';
import { withFileLock } from '../../integrations/client/file-lock.mjs';
import { canonical } from './local-daemon-identity.mjs';
import { DAEMON_UNRESPONSIVE_MS } from './local-daemon-wire.mjs';
import { readPrivate, checkedEntry, refuse } from './local-daemon-state.mjs';

export function processStart(pid) {
  try {
    const source = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = source.slice(source.lastIndexOf(')') + 2).trim().split(/\s+/);
    if (!/^\d+$/.test(fields[19] ?? '')) throw refuse('daemon_liveness');
    // Zombies have completed all work and cannot retain SQLite handles.
    return { start: fields[19], zombie: fields[0] === 'Z' };
  } catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return null; throw refuse('daemon_liveness'); }
}
export function localProcessIdentity() {
  return { pid: process.pid, start: processStart(process.pid).start,
    boot: readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim(),
    namespace: readlinkSync('/proc/self/ns/pid') };
}
export function startAwareAlive(owner, live = localProcessIdentity(), read = processStart) {
  if (!Number.isSafeInteger(owner?.pid) || owner.pid < 1 || typeof owner.start !== 'string' || !owner.boot || !owner.namespace) throw refuse('daemon_liveness');
  if (owner.boot !== live.boot) return false;
  if (owner.namespace !== live.namespace) throw refuse('daemon_namespace');
  const current = read(owner.pid);
  return current !== null && !current.zombie && current.start === owner.start;
}

// Linux CLOCK_MONOTONIC: comparable between processes on this boot; excludes
// suspended time. Never use the wall clock to decide that an owner is stale.
export const daemonMonotonicMs = () => Number(process.hrtime.bigint() / 1000000n);
export async function readDaemonHeartbeat(directory, paths, descriptor) {
  const text = await readPrivate(directory, paths.stamp, { missing: true });
  if (!text) return;
  let stamp; try { stamp = JSON.parse(text); } catch { throw refuse('daemon_stamp'); }
  if (stamp.incarnation !== descriptor.incarnation || canonical(stamp.owner) !== canonical(descriptor.owner) || stamp.build !== descriptor.identity.build) return;
  if (stamp.version !== 1 ||
      !Number.isSafeInteger(stamp.monotonicMs) || stamp.monotonicMs < 0 ||
      !Number.isSafeInteger(stamp.attachedSessions) || stamp.attachedSessions < 0 || stamp.attachedSessions > 64 ||
      !Array.isArray(stamp.codes) || stamp.codes.length > 8 || stamp.codes.some(code => !/^daemon_[a-z_]+$/.test(code))) throw refuse('daemon_stamp');
  return stamp;
}
export function verifiedOwner(owner, live = localProcessIdentity(), uid = process.getuid()) {
  if (!startAwareAlive(owner, live)) return false;
  try { return statSync(`/proc/${owner.pid}`).uid === uid; }
  catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') return false; throw refuse('daemon_liveness'); }
}
export async function takeOver(directory, paths, observed, {
  staleMs = DAEMON_UNRESPONSIVE_MS, deadline = performance.now() + 10000,
  graceMs = 5000, alive = owner => verifiedOwner(owner), signal = (owner, code) => process.kill(owner.pid, code),
  afterLock = async () => {}, afterTerm = async () => {},
} = {}) {
  const stale = stamp => daemonMonotonicMs() - stamp.monotonicMs > staleMs;
  const stamp = await readDaemonHeartbeat(directory, paths, observed);
  if (!stamp || !stale(stamp) || !alive(observed.owner)) return false;
  const incarnation = observed.incarnation, owner = canonical(observed.owner), live = localProcessIdentity();
  return withFileLock(paths.takeover, async () => {
    await afterLock(); // Programmatic test seam; never bootstrap/argv/environment.
    const text = await readPrivate(directory, paths.ready, { missing: true });
    if (!text) return;
    const current = JSON.parse(text), fresh = await readDaemonHeartbeat(directory, paths, current);
    if (current.incarnation !== incarnation || canonical(current.owner) !== owner ||
        !fresh || !stale(fresh) || !alive(current.owner)) return;
    if (performance.now() >= deadline) return;
    // Each signal has its own immediate start/boot/namespace/uid verification.
    if (!alive(current.owner)) return;
    try { signal(current.owner, 'SIGTERM'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await afterTerm();
    const grace = performance.now() + graceMs;
    while (alive(current.owner) && performance.now() < grace) await new Promise(resolve => setTimeout(resolve, 20));
    if (alive(current.owner)) {
      try { signal(current.owner, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    while (alive(current.owner)) await new Promise(resolve => setTimeout(resolve, 20));
    // Election/reapEndpoint belong to the lifetime lock, after releasing this one.
  }, { timeoutMs: Math.max(0, deadline - performance.now()), deadlineMs: deadline, pollMs: 20, context: live,
    isAlive: (_pid, owner) => startAwareAlive(owner, live), validateOwner: owner => { startAwareAlive(owner, live); },
    validatePath: path => checkedEntry(directory, path, { missing: true }),
    read: path => readPrivate(directory, path, { missing: true }),
  });
}

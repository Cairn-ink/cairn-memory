// Linux OS metadata only; no environment, store or SQLite access.
import { readFileSync, readlinkSync } from 'node:fs';
import { refuse } from './local-daemon-state.mjs';

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

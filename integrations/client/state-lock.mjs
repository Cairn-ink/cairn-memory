// Private process-owned locks for new profiles. Claude's released lock is unchanged.
import { withFileLock } from './file-lock.mjs';
import { checkedPath, hostDirectory, privateDirectory, privateRead } from './private-state.mjs';
import { localLiveness } from './pairing.mjs';
import { dirname } from 'node:path';

export function ownerAlive(owner, live) {
  if (!live?.namespace || live.boot === undefined || !owner?.namespace || owner.boot === undefined)
    throw new Error('pid_namespace_unverified');
  const different = typeof live.boot === 'number' && typeof owner.boot === 'number'
    ? Math.abs(live.boot - owner.boot) > 2000 : live.boot !== owner.boot;
  if (different) return false;
  if (live.namespace !== owner.namespace) throw new Error('pid_namespace_unverified');
  return live.isAlive(owner.pid);
}

// Read-only eligibility precedes identity creation; it never creates a root,
// acquires a lock or publishes state on the warm recall path.
export async function checkStateLock(path, { liveness, hostParent = false, signal } = {}) {
  signal?.throwIfAborted();
  const live = liveness ?? await localLiveness();
  ownerAlive({ pid: process.pid, namespace: live.namespace, boot: live.boot }, live);
  if (hostParent) {
    const parent = await hostDirectory(dirname(path), { create: false });
    if (parent !== undefined && parent !== dirname(path)) throw new Error('state_path_changed');
  } else await checkedPath(dirname(path), { directory: true, missing: true });
  await checkedPath(path, { missing: true });
  signal?.throwIfAborted();
  return live;
}

export async function stateLock(path, work, { liveness, timeoutMs = 250, deadlineMs = Infinity, signal, hostParent = false } = {}) {
  signal?.throwIfAborted();
  const live = liveness ?? await localLiveness();
  ownerAlive({ pid: process.pid, namespace: live.namespace, boot: live.boot }, live);
  // A host-root lock is taken only at the canonical root, so every alias of one
  // root shares one gate and a retargeted alias cannot reach another root's.
  if (hostParent) {
    if (await hostDirectory(dirname(path)) !== dirname(path)) throw new Error('state_path_changed');
  } else await privateDirectory(dirname(path));
  await checkedPath(path, { missing: true });
  let value;
  const acquired = await withFileLock(path, async () => { value = await work(live); }, {
    timeoutMs, deadlineMs, pollMs: 10, signal, context: { namespace: live.namespace, boot: live.boot },
    isAlive: (_pid, owner) => ownerAlive(owner, live),
    validateOwner: async owner => { ownerAlive(owner, live); },
    validatePath: p => checkedPath(p, { missing: true }),
    read: p => privateRead(p, { missing: true }),
  });
  if (!acquired) throw new Error('state_busy');
  return value;
}

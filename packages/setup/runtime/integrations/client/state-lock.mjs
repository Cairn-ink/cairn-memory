// Private process-owned locks for new profiles. Claude's released lock is unchanged.
import { withFileLock } from './file-lock.mjs';
import { checkedPath, privateDirectory, privateRead } from './private-state.mjs';
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

export async function stateLock(path, work, { liveness, timeoutMs = 250 } = {}) {
  const live = liveness ?? await localLiveness();
  ownerAlive({ pid: process.pid, namespace: live.namespace, boot: live.boot }, live);
  await privateDirectory(dirname(path));
  await checkedPath(path, { missing: true });
  let value;
  const acquired = await withFileLock(path, async () => { value = await work(live); }, {
    timeoutMs, pollMs: 10, context: { namespace: live.namespace, boot: live.boot },
    isAlive: (_pid, owner) => ownerAlive(owner, live),
    validateOwner: async owner => { ownerAlive(owner, live); },
    validatePath: p => checkedPath(p, { missing: true }),
    read: p => privateRead(p, { missing: true }),
  });
  if (!acquired) throw new Error('state_busy');
  return value;
}

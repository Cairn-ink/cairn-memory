// Local native settings only; private lock files retain the shared lock checks.
import { withFileLock } from '../file-lock.mjs';
import { checkedPath, privateRead } from '../private-state.mjs';
import { ownerAlive } from '../state-lock.mjs';
import { localLiveness } from '../pairing.mjs';
import { dirname } from 'node:path';
import { nativeDirectory } from './local-setup-files.mjs';

export async function nativeSettingsLock(path, request, work, { liveness, timeoutMs = 250 } = {}) {
  const live = liveness ?? await localLiveness();
  ownerAlive({ pid: process.pid, namespace: live.namespace, boot: live.boot }, live);
  await nativeDirectory(dirname(path), request);
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

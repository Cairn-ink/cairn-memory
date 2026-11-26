import { readFile, readlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { withFileLock } from '../../integrations/client/file-lock.mjs';
import { checkedPath, privateDirectory, privateRead } from '../../integrations/client/private-state.mjs';

// Share the installer lock protocol and Linux boot/namespace identity. The
// checkout activation requires Linux leases and never installs this path on
// another platform.
export async function captureLock(path, work, { signal } = {}) {
  signal?.throwIfAborted();
  if (process.platform !== 'linux') throw new Error('pid_namespace_unverified');
  const boot = (await readFile('/proc/sys/kernel/random/boot_id', 'utf8')).trim();
  const namespace = await readlink('/proc/self/ns/pid');
  if (!boot || !namespace) throw new Error('pid_namespace_unverified');
  const isAlive = (pid, owner) => {
    if (typeof owner.boot !== 'string' || typeof owner.namespace !== 'string') throw new Error('pid_namespace_unverified');
    if (owner.boot !== boot) return false;
    if (owner.namespace !== namespace) throw new Error('pid_namespace_unverified');
    try { process.kill(pid, 0); return true; }
    catch (error) { return error.code !== 'ESRCH'; }
  };
  await privateDirectory(dirname(path));
  await checkedPath(path, { missing: true });
  let value;
  const acquired = await withFileLock(path, async () => { value = await work(); }, {
    timeoutMs: 250, pollMs: 10, signal, context: { boot, namespace }, isAlive,
    validateOwner: async owner => { isAlive(owner.pid, owner); },
    validatePath: p => checkedPath(p, { missing: true }),
    read: p => privateRead(p, { missing: true }),
  });
  if (!acquired) throw new Error('state_busy');
  return value;
}

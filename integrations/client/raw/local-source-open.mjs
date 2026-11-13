import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { isAbsolute, normalize } from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { openSource } from '../../codex/source.mjs';

const checkpoints = new AsyncLocalStorage();
// Trusted-code test scope only; no profile, hook input or CLI can supply it.
export const withLocalSourceOpenCheckpoint = (checkpoint, work) => checkpoints.run(checkpoint, work);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const directory = stat => stat.isDirectory() && !stat.isSymbolicLink();
const changed = () => { throw new Error('source_changed'); };

// Without openat, post-verification is a series of separate lstat calls, not
// one atomic check. A concurrent process can still get a redirected fd past
// it by toggling one ancestor in at least three timed renames: symlink before
// the final open, original before checking that ancestor, symlink again before
// lstat of the final path, then restore. Such a process needs write access to
// the user's own directories (the same user or root) and could read transcripts
// directly anyway. The window does not cross a privilege boundary; it weakens
// only the Linux guarantee against an attacker swapping directories mid-open.
export async function openLocalSource(path) {
  if (process.platform === 'linux') return openSource(path);
  if (process.platform !== 'darwin') throw new Error('source_platform_unverified');
  if (typeof path !== 'string' || !isAbsolute(path) || normalize(path) !== path ||
      path.length > 8192 || path.includes('\0')) throw new Error('invalid_source_path');
  const components = path.slice(1).split('/'), ancestors = [];
  let prefix = '/', file;
  try {
    for (let i = 0; i < components.length; i++) {
      const before = await lstat(prefix);
      if (!directory(before)) changed();
      const handle = await open(prefix, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
      ancestors.push({ path: prefix, handle, stat: before });
      const pinned = await handle.stat();
      if (!pinned.isDirectory() || !same(before, pinned)) changed();
      await checkpoints.getStore()?.('ancestor', { path: prefix, index: i });
      prefix = prefix === '/' ? '/' + components[i] : prefix + '/' + components[i];
    }
    file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = await file.stat();
    if (!stat.isFile() || (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
        !Number.isSafeInteger(stat.size)) throw new Error('invalid_source_file');
    await checkpoints.getStore()?.('opened', { path });
    try {
      for (const ancestor of ancestors) {
        const current = await lstat(ancestor.path);
        if (!directory(current) || !same(current, ancestor.stat)) changed();
      }
      const current = await lstat(path);
      if (current.isSymbolicLink() || !current.isFile() || !same(current, stat)) changed();
    } catch { changed(); }
    await Promise.all(ancestors.map(ancestor => ancestor.handle.close()));
    ancestors.length = 0;
    return file;
  } catch (error) {
    await file?.close();
    await Promise.all(ancestors.map(ancestor => ancestor.handle.close()));
    throw error;
  }
}

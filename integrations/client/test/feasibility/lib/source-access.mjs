// Source ownership for hooks, workers, analysis and cleanup. A transcript is
// the harness's own only when its session belongs to a launch the orchestrator
// recorded, and its path is the exact host location derived from that launch.
// Hook input is never trusted for either fact.
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, rmdir, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize } from 'node:path';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
// A Codex thread must be created within its launch, allowing for clock granularity.
const BINDING_SLACK_MS = 5_000;

export const defaultFs = { lstat, open, readdir, realpath, rmdir, unlink };

/** Claude names its per-project directory after the working directory. */
export const claudeProjectDir = (home, cwd) => join(home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));

/** Milliseconds encoded in a UUIDv7; null for any other value. */
export function uuidV7Millis(id) {
  if (typeof id !== 'string' || !UUID.test(id) || id[14] !== '7') return null;
  return parseInt(id.replace(/-/g, '').slice(0, 12), 16);
}

const pad = value => String(value).padStart(2, '0');

/** Codex 0.157.1 dates rollouts by local creation time: `YYYY/MM/DD` and `YYYY-MM-DDTHH-MM-SS`. */
export function localRolloutStamp(millis) {
  const date = new Date(millis);
  const day = [date.getFullYear(), pad(date.getMonth() + 1), pad(date.getDate())];
  return { dir: day.join('/'), stamp: `${day.join('-')}T${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}` };
}

/** The harness launch that owns a host session, from orchestrator-written ledger facts only. */
export function ownerLaunch(ledger, host, sessionId) {
  if (typeof sessionId !== 'string' || !UUID.test(sessionId)) return { reason: 'invalid_session_id' };
  for (const run of ledger?.runs ?? []) {
    if (run.host !== host || !run.launch || !Number.isFinite(run.launch.startedAt)) continue;
    if (host === 'claude' && run.launch.sessionId === sessionId) return { run };
    if (host === 'codex' && run.binding?.threadId === sessionId && run.binding.source === 'thread.started') {
      const created = uuidV7Millis(sessionId);
      const end = run.launch.exitAt ?? Number.POSITIVE_INFINITY;
      if (created === null || created < run.launch.startedAt - BINDING_SLACK_MS || created > end + BINDING_SLACK_MS) {
        return { reason: 'binding_outside_launch_window' };
      }
      return { run };
    }
  }
  return { reason: 'not_a_harness_session' };
}

/** Exact host locations for one owned session, derived from the launch, never from hook input. */
export function expectedSourcePaths(host, home, launch, sessionId) {
  if (host === 'claude') return [join(claudeProjectDir(home, launch.cwd), `${sessionId}.jsonl`)];
  const created = uuidV7Millis(sessionId);
  if (created === null) return [];
  // The file name uses the creation second; allow a boundary second either side.
  return [-1_000, 0, 1_000].map(offset => {
    const { dir, stamp } = localRolloutStamp(created + offset);
    return join(home, '.codex', 'sessions', dir, `rollout-${stamp}-${sessionId}.jsonl`);
  });
}

/**
 * Filesystem rules shared by readers and cleanup: the parent resolves to
 * itself (no symlinked ancestor), the entry is not a symlink, has the expected
 * kind and belongs to this user.
 */
export async function verifyPlainEntry(path, kind, { fs = defaultFs, uid = process.getuid?.() } = {}) {
  const parent = dirname(path);
  let resolved;
  try { resolved = await fs.realpath(parent); } catch { return { ok: false, reason: 'source_unavailable' }; }
  if (resolved !== parent) return { ok: false, reason: 'symlinked_parent' };
  let stat;
  try { stat = await fs.lstat(path); }
  catch (error) { return { ok: false, reason: error?.code === 'ENOENT' ? 'source_unavailable' : 'source_error' }; }
  if (stat.isSymbolicLink()) return { ok: false, reason: 'symlink' };
  if (kind === 'file' ? !stat.isFile() : !stat.isDirectory()) return { ok: false, reason: `not_${kind}` };
  if (uid !== undefined && stat.uid !== uid) return { ok: false, reason: 'foreign_owner' };
  return { ok: true, stat };
}

/**
 * Decide whether a hook-supplied transcript may be read. Ownership, working
 * directory and location are checked from ledger facts alone; then the pause
 * barrier; only then the filesystem.
 */
export async function authorizeSource({ host, sessionId, suppliedPath, suppliedCwd, ledger, home, isPaused,
  fs = defaultFs, uid = process.getuid?.() }) {
  const owner = ownerLaunch(ledger, host, sessionId);
  if (!owner.run) return { ok: false, reason: owner.reason };
  if (suppliedCwd !== owner.run.launch.cwd) return { ok: false, reason: 'cwd_mismatch' };
  if (typeof suppliedPath !== 'string') return { ok: false, reason: 'transcript_unavailable' };
  if (!expectedSourcePaths(host, home, owner.run.launch, sessionId).includes(suppliedPath)) {
    return { ok: false, reason: 'unexpected_location' };
  }
  if (await isPaused()) return { ok: false, reason: 'paused' };
  const entry = await verifyPlainEntry(suppliedPath, 'file', { fs, uid });
  if (!entry.ok) return entry;
  return { ok: true, path: suppliedPath, home, run: owner.run, size: entry.stat.size,
    identity: { dev: entry.stat.dev, ino: entry.stat.ino } };
}

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
// O_NONBLOCK keeps a FIFO planted at the path from blocking the open; it is refused below.
const FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const within = (path, root) => typeof root === 'string' && (path === root || path.startsWith(`${root}/`));

/**
 * Open an absolute path one component at a time from `/`. Each directory is
 * opened with O_DIRECTORY | O_NOFOLLOW relative to the directory handle already
 * held, through `/proc/self/fd/<n>/<name>` (Linux's openat(2) for Node), and the
 * file relative to its parent's handle with O_NOFOLLOW. No component can be a
 * symlink, and swapping or renaming any of them after it is opened cannot
 * redirect a later step. Directories at or below `ownedRoot` must belong to `uid`.
 */
async function openBeneathRoot(path, { ownedRoot, uid, fs }) {
  if (!isAbsolute(path) || normalize(path) !== path || path.endsWith('/')) throw new Error('source_path_not_canonical');
  const names = path.split('/').slice(1);
  let directory = await fs.open('/', DIRECTORY_FLAGS);
  let reached = '';
  try {
    for (const name of names.slice(0, -1)) {
      let next;
      try { next = await fs.open(`/proc/self/fd/${directory.fd}/${name}`, DIRECTORY_FLAGS); }
      catch (error) {
        // ENOTDIR or ELOOP: the component is now a symlink or not a directory.
        if (error?.code !== 'ENOTDIR' && error?.code !== 'ELOOP') throw error;
        throw Object.assign(new Error('source_changed'), { code: error.code });
      }
      await directory.close();
      directory = next;
      reached = `${reached}/${name}`;
      if (within(reached, ownedRoot) && uid !== undefined && (await directory.stat()).uid !== uid) {
        throw new Error('source_changed');
      }
    }
    return await fs.open(`/proc/self/fd/${directory.fd}/${names.at(-1)}`, FILE_FLAGS);
  } finally {
    await directory.close();
  }
}

/**
 * Open the authorized source through a chain of verified directory handles, and
 * confirm on the open handle that it is the regular, owned file whose inode was
 * authorized. What is read is what was checked, whatever happens to the path
 * between authorization and the open.
 */
export async function openAuthorizedSource(authorization, fs = defaultFs, uid = process.getuid?.()) {
  const handle = await openBeneathRoot(authorization.path, { ownedRoot: authorization.home, uid, fs });
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || (uid !== undefined && stat.uid !== uid) || stat.dev !== authorization.identity.dev
      || stat.ino !== authorization.identity.ino) {
      throw new Error('source_changed');
    }
    return handle;
  } catch (error) {
    await handle.close();
    throw error;
  }
}

/**
 * Read a whole owned source through a verified handle. Returns '' while it does
 * not exist yet. A symlink, a symlinked parent or another owner is refused before
 * anything is opened. A swap after those checks, at any point up to the open, is
 * refused by the component-by-component open or by the checks on its handle.
 * Either way nothing is read.
 */
export async function readOwnedSource({ host, sessionId, path, cwd, ledger, home, fs = defaultFs }) {
  const authorization = await authorizeSource({ host, sessionId, suppliedPath: path, suppliedCwd: cwd, ledger, home,
    isPaused: async () => false, fs });
  if (!authorization.ok) {
    if (authorization.reason === 'source_unavailable') return '';
    throw new Error(`source_refused:${authorization.reason}`);
  }
  const handle = await openAuthorizedSource(authorization, fs);
  try {
    const { size } = await handle.stat();
    const buffer = Buffer.alloc(size);
    let position = 0;
    while (position < size) {
      const { bytesRead } = await handle.read(buffer, position, size - position, position);
      if (!bytesRead) break;
      position += bytesRead;
    }
    return buffer.subarray(0, position).toString('utf8');
  } finally { await handle.close(); }
}

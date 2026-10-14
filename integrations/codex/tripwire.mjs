import { randomBytes } from 'node:crypto';
import { lstat, readFile, readlink, symlink, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { withFileLock } from '../client/file-lock.mjs';
import { privateWrite } from '../client/private-state.mjs';
import { readControlState } from '../client/control-state.mjs';

// A pause made only with the legacy `paused` marker leaves no trace once the marker
// is deleted, and the pre-pause generation comes back. Codex therefore keeps that
// path as a dangling symlink to WITNESS. Pausing through the marker (setPaused, an
// older plugin or by hand) writes through it and creates WITNESS, which reads as
// paused exactly as before; every resume deletes the symlink. Codex sends text only
// while the tripwire it armed is intact, and each cursor carries the arm token it
// was observed under. A broken tripwire is re-armed with a new token, so every
// session starts again at its next observation and nothing written meanwhile is sent.
export const WITNESS = '.paused-tripwire';
const paths = root => ({ marker: join(root, 'paused'), witness: join(root, WITNESS),
  record: join(root, 'codex-tripwire.json'), lock: join(root, 'control.lock') });
const absent = path => lstat(path).then(() => false, error => {
  if (error?.code === 'ENOENT') return true;
  throw error;
});

async function recorded(path) {
  try {
    const value = JSON.parse(await readFile(path, 'utf8'));
    return value?.version === 1 && /^[a-f0-9]{32}$/.test(value.token) ? value.token : null;
  } catch { return null; }
}

async function ours(marker) {
  try { return (await lstat(marker)).isSymbolicLink() && await readlink(marker) === WITNESS; }
  catch { return false; }
}

// The token of an intact tripwire, or null. Arming writes the record before the
// symlink, and the record is read on both sides of the path checks, so an old
// token is never paired with a new symlink.
async function intact(p) {
  const token = await recorded(p.record);
  if (!token || !await ours(p.marker) || !await absent(p.witness).catch(() => false)) return null;
  return await recorded(p.record) === token ? token : null;
}

// Runs under control.lock, which setPaused also holds while it writes the marker.
async function arm(root, p) {
  const control = await readControlState(root);
  if (control.paused || !control.valid) return { control, token: null };
  const token = await intact(p);
  if (token) return { control, token };
  const fresh = randomBytes(16).toString('hex');
  if (await ours(p.marker) && await absent(p.witness)) {
    // Our symlink with no witness, under a lost or stale record: a new token is enough.
    await privateWrite(p.record, JSON.stringify({ version: 1, token: fresh }));
    return { control, token: fresh };
  }
  // Anything else at the marker path is left alone; Codex stays paused.
  if (!await absent(p.marker)) return { control, token: null };
  await unlink(p.witness).catch(error => { if (error?.code !== 'ENOENT') throw error; });
  await privateWrite(p.record, JSON.stringify({ version: 1, token: fresh }));
  await symlink(WITNESS, p.marker);
  return { control, token: fresh };
}

// The shared control state plus the arm token cursors must carry. When the
// tripwire cannot be (re)armed now, Codex reads as paused.
export async function codexControl(root) {
  const control = await readControlState(root);
  if (control.paused || !control.valid) return { ...control, arm: null };
  const p = paths(root);
  const token = await intact(p).catch(() => null);
  if (token) return { ...control, arm: token };
  let result = null;
  const acquired = await withFileLock(p.lock, async () => { result = await arm(root, p); },
    { timeoutMs: 250, pollMs: 10 }).catch(() => false);
  if (!acquired || !result?.token) return { ...(result?.control ?? control), paused: true, arm: null };
  return { ...result.control, arm: result.token };
}

// startIfActive, plus the same intact tripwire the cursor was observed under.
export async function startIfArmed(root, generation, token, start) {
  let operation;
  let started = false;
  const p = paths(root);
  const acquired = await withFileLock(p.lock, async () => {
    const current = await readControlState(root);
    if (current.paused || current.generation !== generation || !token ||
        await intact(p).catch(() => null) !== token) return;
    operation = Promise.resolve(start());
    operation.catch(() => {});
    started = true;
  }, { timeoutMs: 250, pollMs: 10 });
  return { acquired, started, operation };
}

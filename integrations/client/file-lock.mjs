import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

const OWNER_PATTERN = /^([1-9][0-9]*)-([a-f0-9-]{36})$/;

function wait(milliseconds, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, milliseconds);
    const abort = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(signal.reason); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM proves that a process owns the pid even if it cannot be signalled.
    return error?.code !== "ESRCH";
  }
}

async function readOwner(path, read = readFile) {
  try {
    const owner = JSON.parse(await read(path, "utf8"));
    if (
      !Number.isSafeInteger(owner?.pid) ||
      owner.pid <= 0 ||
      typeof owner?.token !== "string" ||
      !OWNER_PATTERN.test(`${owner.pid}-${owner.token}`)
    ) {
      return undefined;
    }
    return owner;
  } catch {
    return undefined;
  }
}

async function reapDeadOwner(path, owner, processIsAlive, context, read, signal, reaperRoot = path) {
  signal?.throwIfAborted();
  if (processIsAlive(owner.pid, owner) !== false) return;

  // A token-specific marker elects one live reaper. Only a definitively dead
  // reaper may be displaced, through the same election protocol on its marker.
  // Recursive markers fence delayed contenders at every recovery level.
  // Every level uses the original lock prefix and a unique owner token, so
  // repeated recovery crashes cannot exhaust the filesystem leaf-name limit.
  const reaperPath = `${reaperRoot}.reap-${owner.token}`;
  const reaperToken = randomUUID();
  const reaperOwner = { pid: process.pid, token: reaperToken, ...context };
  const reaperOwnerPath = `${reaperPath}.owner-${process.pid}-${reaperToken}`;
  await writeFile(reaperOwnerPath, JSON.stringify(reaperOwner), {
    mode: 0o600,
    flag: "wx",
  });
  let elected = false;
  try {
    // One recovery attempt per acquisition poll. A live nested reaper must
    // yield back to the outer deadline, rather than spin on its dead parent.
    for (let attempt = 0; !elected; attempt++) {
      signal?.throwIfAborted();
      try {
        await link(reaperOwnerPath, reaperPath);
        elected = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const reaper = await readOwner(reaperPath, read);
        // Malformed/unknown and live ownership remain fail-closed. EPERM is
        // live, exactly as for the original lock; elapsed time grants nothing.
        if (attempt > 0 || !reaper || processIsAlive(reaper.pid, reaper) !== false) return;
        await reapDeadOwner(reaperPath, reaper, processIsAlive, context, read, signal, reaperRoot);
      }
    }
  } finally {
    if (!elected) await unlink(reaperOwnerPath).catch(() => {});
  }
  const current = await readOwner(path, read);
  // Election commits this tiny recovery step. Cancellation must not strand a
  // dead lock behind its permanent marker; finish the token check and cleanup
  // before the acquisition loop observes abort. Never unlink a successor.
  if (
    current?.pid === owner.pid &&
    current.token === owner.token &&
    processIsAlive(current.pid, current) === false
  ) {
    await unlink(path).catch(() => {});
    await unlink(`${path}.owner-${owner.pid}-${owner.token}`).catch(() => {});
  }
  // Keep the elected marker permanently. A later contender can never mistake
  // a successor lock for this dead owner's lock. If this reaper dies, a later
  // contender may recover its marker before repeating the original token check.
  // Markers and their tiny owner files contain no content or path data.
}

/**
 * Run work while holding a process-owned filesystem lock.
 *
 * Lock ownership never expires based on elapsed time. A definitively dead
 * owner may be recovered, and token-specific cleanup cannot unlink a newer
 * owner's lock. Returns false when the bounded acquisition window expires.
 * With tryOnly, a contended path returns false without polling or reaping.
 */
export async function withFileLock(
  path,
  work,
  { tryOnly = false, timeoutMs = 30_000, deadlineMs = Infinity, pollMs = 100, context, validateOwner = async () => {},
    isAlive = processIsAlive, validatePath = async () => {}, read = readFile, signal } = {},
) {
  signal?.throwIfAborted();
  if (performance.now() >= deadlineMs) return false;
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const owner = { pid: process.pid, token, ...context };
  const ownerPath = `${path}.owner-${owner.pid}-${token}`;
  let acquired = false, ownerCreated = false;
  try {
    signal?.throwIfAborted();
    await writeFile(ownerPath, JSON.stringify(owner), { mode: 0o600, flag: 'wx' });
    ownerCreated = true;
    // The absolute caller deadline includes setup. Existing callers without one
    // retain their acquisition window after owner publication.
    const deadline = Math.min(performance.now() + timeoutMs, deadlineMs);
    while (!acquired && (tryOnly || performance.now() < deadline)) {
      signal?.throwIfAborted();
      try {
        await link(ownerPath, path);
        acquired = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        // A best-effort publisher may try once without waiting or reaping.
        if (tryOnly) return false;
        await validatePath(path);
        const existing = await readOwner(path, read);
        if (existing) await validateOwner(existing);
        if (existing) await reapDeadOwner(path, existing, isAlive, context, read, signal);
        if (!acquired) await wait(pollMs, signal);
      }
    }
    signal?.throwIfAborted();
    if (!acquired || performance.now() >= deadlineMs) return false;
    await work();
    return true;
  } finally {
    if (acquired) {
      const current = await readOwner(path, read);
      if (current?.pid === owner.pid && current.token === token) {
        await unlink(path).catch(() => {});
      }
    }
    if (ownerCreated) await unlink(ownerPath).catch(() => {});
  }
}

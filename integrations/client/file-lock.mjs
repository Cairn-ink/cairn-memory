import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const OWNER_PATTERN = /^([1-9][0-9]*)-([a-f0-9-]{36})$/;

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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

async function readOwner(path) {
  try {
    const owner = JSON.parse(await readFile(path, "utf8"));
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

async function reapDeadOwner(path, owner) {
  if (processIsAlive(owner.pid)) return;

  // A token-specific marker elects exactly one reaper. It prevents a
  // delayed contender from unlinking a successor after another contender has
  // already recovered this dead owner's lock.
  const reaperPath = `${path}.reap-${owner.token}`;
  const reaperToken = randomUUID();
  const reaperOwner = { pid: process.pid, token: reaperToken };
  const reaperOwnerPath = `${reaperPath}.owner-${process.pid}-${reaperToken}`;
  await writeFile(reaperOwnerPath, JSON.stringify(reaperOwner), {
    mode: 0o600,
    flag: "wx",
  });
  try {
    await link(reaperOwnerPath, reaperPath);
  } catch (error) {
    if (error?.code === "EEXIST") {
      await unlink(reaperOwnerPath).catch(() => {});
      return;
    }
    await unlink(reaperOwnerPath).catch(() => {});
    throw error;
  }
  const current = await readOwner(path);
  if (
    current?.pid === owner.pid &&
    current.token === owner.token &&
    !processIsAlive(current.pid)
  ) {
    await unlink(path).catch(() => {});
    await unlink(`${path}.owner-${owner.pid}-${owner.token}`).catch(() => {});
  }
  // Keep the elected marker permanently. A later contender can never mistake
  // a successor lock for this dead owner's lock, even if the elected reaper
  // itself is interrupted. The marker and its tiny owner file contain no
  // content or path data.
}

/**
 * Run work while holding a process-owned filesystem lock.
 *
 * Lock ownership never expires based on elapsed time. A definitively dead
 * owner may be recovered, and token-specific cleanup cannot unlink a newer
 * owner's lock. Returns false when the bounded acquisition window expires.
 */
export async function withFileLock(
  path,
  work,
  { timeoutMs = 30_000, pollMs = 100 } = {},
) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const token = randomUUID();
  const owner = { pid: process.pid, token };
  const ownerPath = `${path}.owner-${owner.pid}-${token}`;
  await writeFile(ownerPath, JSON.stringify(owner), {
    mode: 0o600,
    flag: "wx",
  });

  const deadline = Date.now() + timeoutMs;
  let acquired = false;
  try {
    while (!acquired && Date.now() < deadline) {
      try {
        await link(ownerPath, path);
        acquired = true;
      } catch (error) {
        if (error?.code !== "EEXIST") throw error;
        const existing = await readOwner(path);
        if (existing) await reapDeadOwner(path, existing);
        if (!acquired) await wait(pollMs);
      }
    }
    if (!acquired) return false;
    await work();
    return true;
  } finally {
    if (acquired) {
      const current = await readOwner(path);
      if (current?.pid === owner.pid && current.token === token) {
        await unlink(path).catch(() => {});
      }
    }
    await unlink(ownerPath).catch(() => {});
  }
}

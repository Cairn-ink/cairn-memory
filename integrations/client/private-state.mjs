// Owner-only local state. Only ENOENT means absence; never follow symlinks.
import { constants } from "node:fs";
import { AsyncLocalStorage } from "node:async_hooks";
import { lstat, mkdir, open, link, rename, unlink, realpath } from "node:fs/promises";
import { dirname, basename, isAbsolute, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";

// A deterministic test seam at durable state writes; inert outside its async scope.
const writeObservers = new AsyncLocalStorage();
export const withWriteObserver = (observer, work) => writeObservers.run(observer, work);
export async function notifyWrite(path, kind = "write") {
  await writeObservers.getStore()?.({ path, kind });
}

// History-free Windows standalone must retain 0.1.1 behavior (codex-client.md,
// CX-2 resolved permission rules). Native Windows cannot enforce POSIX 0600 modes;
// portable reads are limited to standalone creator/publication files. Pairing stays
// unsupported there, and all coordination/binding paths retain strict checks.
export async function checkedPath(
  path,
  { directory = false, missing = false, portable = false, ownerId = process.getuid?.() } = {},
) {
  if (!isAbsolute(path) || resolve(path) !== path) throw new Error("invalid_state_path");
  // Ancestors belong to the host/user (for example macOS /var or ~/.claude).
  // Canonicalize them; only the Cairn-owned leaf must not be a symlink.
  let canonical;
  let info;
  try {
    canonical = join(await realpath(dirname(path)), basename(path));
    info = await lstat(canonical);
  } catch (error) {
    if (missing && error.code === "ENOENT") return undefined;
    throw error;
  }
  if (info.isSymbolicLink()) throw new Error("state_symlink");
  if (directory ? !info.isDirectory() : !info.isFile()) {
    throw new Error("invalid_state_type");
  }
  if (ownerId !== undefined && info.uid !== ownerId) {
    throw new Error("state_owner");
  }
  if (
    !(portable && process.platform === "win32") &&
    (info.mode & 0o777) !== (directory ? 0o700 : 0o600)
  ) {
    throw new Error("state_permissions");
  }
  return info;
}

export async function privateDirectory(path, options = {}) {
  if (!(await checkedPath(path, { ...options, directory: true, missing: true }))) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    await notifyWrite(path, "directory");
  }
  await checkedPath(path, { ...options, directory: true });
}
export async function privateRead(
  path, { missing = false, portable = false, ownerId = process.getuid?.() } = {},
) {
  // Atomic metadata replacement can race the read-only discovery preceding a
  // setup lock. Retry a changed inode, but never relax ownership or permissions.
  for (let attempt = 0; attempt < 8; attempt++) {
    const before = await checkedPath(path, { missing, portable, ownerId });
    if (!before) return undefined;
    let file;
    try {
      file = await open(
        join(await realpath(dirname(path)), basename(path)),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
    } catch (error) {
      if (missing && error.code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const after = await file.stat();
      if (after.ino !== before.ino || after.dev !== before.dev) continue;
      if (
        !after.isFile() ||
        (ownerId !== undefined && after.uid !== ownerId) ||
        (!(portable && process.platform === "win32") && (after.mode & 0o777) !== 0o600)
      )
        throw new Error("state_changed");
      if (after.size > 64 * 1024) throw new Error("state_too_large");
      return await file.readFile("utf8");
    } finally {
      await file.close();
    }
  }
  throw new Error("state_changed");
}
export async function syncDirectory(path) {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
export async function privateWrite(
  path,
  bytes,
  { exclusive = false, checkpoint = async () => {}, ownerId = process.getuid?.(),
    portable = false } = {},
) {
  await privateDirectory(dirname(path), { ownerId, portable });
  await checkedPath(path, { missing: true, ownerId, portable });
  const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`;
  const file = await open(temporary, "wx", 0o600);
  try {
    try {
      await file.writeFile(bytes);
      await file.sync();
    } finally {
      await file.close();
    }
    await checkpoint("temporary-written");
    if (exclusive) {
      try {
        await link(temporary, path);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    } else await rename(temporary, path);
    // Native Windows has no portable directory fsync. Its released standalone
    // publication contract uses the flushed file and atomic rename instead.
    if (!(portable && process.platform === "win32")) await syncDirectory(dirname(path));
    await checkpoint("published");
    await notifyWrite(path);
  } finally {
    await unlink(temporary).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

// All private-entry probes preserve uncertainty. Callers decide policy from facts.
export async function probeEntry(
  path,
  { read = () => lstat(path), controlledParent = false } = {},
) {
  try {
    const value = await read();
    return value === undefined ? { state: "absent" } : { state: "present", value };
  } catch (error) {
    if (error.code === "ENOENT") return { state: "absent" };
    if (error.code === "ENOTDIR" && controlledParent) return { state: "absent" };
    return { state: "unknown", code: error.code ?? error.message, error };
  }
}

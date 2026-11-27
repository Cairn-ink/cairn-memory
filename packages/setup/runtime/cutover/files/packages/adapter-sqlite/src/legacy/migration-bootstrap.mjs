import { createHash } from "node:crypto";
import { chmodSync, closeSync, fsyncSync, linkSync, mkdtempSync, openSync, readdirSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BOOTSTRAP_FILENAME } from "../migrate/layout.mjs";
import { assertPrivateDirectory, entry, privateLocation } from "./paths.mjs";
import { LegacyRefusal } from "./refusal.mjs";

function refuse() {
  throw new LegacyRefusal("legacy_unsafe_path");
}

function prefix(path) {
  const label = createHash("sha256").update(basename(path)).digest("hex");
  return ".sqlite-migration-" + label + "-";
}

function syncParent(parent) {
  const fd = openSync(parent, "r");
  try { fsyncSync(fd); }
  finally { closeSync(fd); }
}

export function targetExists(path) {
  const location = privateLocation(path);
  const stat = entry(location.path);
  if (!stat) return false;
  if (!stat.isFile() || stat.uid !== BigInt(process.getuid?.() ?? -1) || (stat.mode & 0o7777n) !== 0o600n) refuse();
  return true;
}

// A live publisher owns its own directory. Only reap this destination's
// abandoned bootstraps, including the second name of an already linked file.
export function cleanMigrationBootstraps(target) {
  const location = privateLocation(target);
  const tag = prefix(location.path);
  const names = new Set(["", "-wal", "-shm", "-journal"].map(suffix => BOOTSTRAP_FILENAME + suffix));
  let removed = false;
  for (const name of readdirSync(location.parent)) {
    if (!name.startsWith(tag)) continue;
    const pid = /^(\d{1,10})-[A-Za-z0-9]{6}$/u.exec(name.slice(tag.length))?.[1];
    if (!pid || +pid < 1 || +pid > 0x7fffffff) continue;
    try { process.kill(+pid, 0); continue; }
    catch (error) { if (error.code !== "ESRCH") continue; }
    const directory = join(location.parent, name);
    if (!entry(directory)) continue;
    assertPrivateDirectory(directory);
    location.check();
    const children = readdirSync(directory);
    if (children.some(child => !names.has(child) || !entry(join(directory, child))?.isFile())) refuse();
    rmSync(directory, { recursive: true, force: true });
    removed = true;
  }
  if (removed) syncParent(location.parent);
}

export async function installMigrationTarget(target, initialize) {
  const location = privateLocation(target);
  const directory = mkdtempSync(join(location.parent, prefix(location.path) + process.pid + "-"));
  try {
    const file = join(directory, BOOTSTRAP_FILENAME);
    new DatabaseSync(file).close();
    chmodSync(file, 0o600);
    await initialize(file);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      if (entry(file + suffix)) throw new LegacyRefusal("legacy_incomplete");
    }
    location.check();
    try { linkSync(file, target); }
    catch (error) {
      if (error.code !== "EEXIST" || !targetExists(target)) throw error;
    }
    syncParent(location.parent);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    syncParent(location.parent);
  }
}

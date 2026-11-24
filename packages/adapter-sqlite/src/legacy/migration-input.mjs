import { chmodSync, closeSync, fsyncSync, linkSync, mkdtempSync, openSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createContentReadMemo, receiptReadSafety } from "../../../../core/content-safety.mjs";
import { contentSafetyInventory } from "../../../../core/content-safety-migration.mjs";
import { identifier } from "../../../../core/validation.mjs";
import { verifyLegacyBackupAgainstSource } from "./backup.mjs";
import { readLegacySnapshot } from "./inventory.mjs";
import { entry, privateLocation } from "./paths.mjs";
import { LegacyRefusal } from "./refusal.mjs";

export { LegacyRefusal };

export function refuse(code) {
  throw new LegacyRefusal(code);
}

function rows(db, sql, ...args) {
  const statement = db.prepare(sql);
  statement.setReadBigInts(true);
  return statement.all(...args);
}

export function readMigrationInput(input) {
  const { path, destination, expectedStoreId } = input;
  const { inventory, file } = readLegacySnapshot(path, { expectedStoreId });
  if (![18, 29].includes(inventory.physical)) refuse("legacy_cross_version");
  const target = privateLocation(destination);
  if (target.parent !== privateLocation(file.path).parent || target.path === file.path ||
      ["-wal", "-shm", "-journal"].some(suffix => target.path.endsWith(suffix))) {
    refuse("legacy_unsafe_path");
  }
  const proof = verifyLegacyBackupAgainstSource(input);
  file.check();
  const db = new DatabaseSync(file.path, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; BEGIN");
    if (db.prepare("PRAGMA journal_mode").get().journal_mode !== "delete") refuse("legacy_unsafe_path");
    if (contentSafetyInventory(db) !== proof.logicalDigest) refuse("legacy_backup_stale");
    const memories = rows(db, "SELECT * FROM memories ORDER BY id");
    const byId = new Map(memories.map(row => [row.id, row]));
    const memo = createContentReadMemo(db);
    const receipts = rows(db, "SELECT * FROM receipts ORDER BY memory_id, created_at, id");
    let withheldReceipts = 0;
    const visibleReceipts = receipts.filter(receipt => {
      const memory = byId.get(receipt.memory_id);
      const namespace = { ownerId: memory.owner_id, scope: memory.scope, projectId: memory.project_id || null };
      const allowed = receiptReadSafety(db, { namespace, receipt, memo }).allowed;
      if (!allowed) withheldReceipts++;
      return allowed;
    });
    const result = {
      storeId: inventory.storeId, physical: inventory.physical, logicalDigest: proof.logicalDigest,
      target: target.path, checkSource: file.check, withheldReceipts,
      memories, receipts: visibleReceipts,
      denials: rows(db, "SELECT * FROM suppressed ORDER BY owner_id, scope, project_id, fingerprint"),
      namespaceEpochs: rows(db, "SELECT * FROM namespace_epochs ORDER BY owner_id, scope, project_id"),
      history: rows(db, "SELECT * FROM memory_supersessions ORDER BY previous_memory_id"),
      episodeControls: rows(db, "SELECT * FROM episode_controls ORDER BY owner_id, scope, project_id"),
      consent: inventory.localControls
        ? rows(db, "SELECT * FROM local_capture_controls ORDER BY owner_id, scope, project_id, client") : [],
      rawControls: inventory.raw ? rows(db, "SELECT * FROM raw_capture_controls ORDER BY owner_id, client") : [],
    };
    file.check();
    return result;
  } catch (error) {
    if (error instanceof LegacyRefusal) throw error;
    if ([5, 6].includes(error.errcode & 255)) refuse("legacy_busy");
    refuse("legacy_incomplete");
  } finally {
    db.close();
  }
}

export function legacyIdentifier(value) {
  try { return identifier(value); }
  catch { return refuse("legacy_incomplete"); }
}

export function targetExists(path) {
  const location = privateLocation(path);
  const stat = entry(location.path);
  if (!stat) return false;
  // A crash between link and unlink can leave the private bootstrap link.
  if (!stat.isFile() || stat.uid !== BigInt(process.getuid?.() ?? -1) || (stat.mode & 0o7777n) !== 0o600n) {
    refuse("legacy_unsafe_path");
  }
  return true;
}

// Initialize under a private name; publish by linking only after SQLite
// has closed and checkpointed. A concurrent publisher cannot be overwritten.
export async function installMigrationTarget(target, bootstrapName, initialize) {
  const location = privateLocation(target);
  const directory = mkdtempSync(join(location.parent, ".sqlite-migration-"));
  try {
    const file = join(directory, bootstrapName);
    new DatabaseSync(file).close();
    chmodSync(file, 0o600);
    await initialize(file);
    for (const suffix of ["-wal", "-shm", "-journal"]) {
      if (entry(file + suffix)) refuse("legacy_incomplete");
    }
    location.check();
    try { linkSync(file, target); }
    catch (error) {
      if (error.code !== "EEXIST" || !targetExists(target)) throw error;
    }
    const fd = openSync(location.parent, "r");
    try { fsyncSync(fd); }
    finally { closeSync(fd); }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

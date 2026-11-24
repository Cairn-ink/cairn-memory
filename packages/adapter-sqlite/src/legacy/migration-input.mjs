import { DatabaseSync } from "node:sqlite";
import { contentReadSafety, createContentReadMemo, receiptReadSafety } from "../../../../core/content-safety.mjs";
import { contentSafetyInventory } from "../../../../core/content-safety-migration.mjs";
import { attestContentSafety } from "../../../../core/content-safety-schema.mjs";
import { identifier } from "../../../../core/validation.mjs";
import { verifyLegacyBackupAgainstSource } from "./backup.mjs";
import { readInspectMigrationInput } from "./inspect-evidence.mjs";
import { readIdentity, readLegacySnapshot } from "./inventory.mjs";
import { readLegacyArchive } from "./migration-archive.mjs";
import { legacyReceiptHasRawAncestry, readRawPrivacy } from "./migration-raw.mjs";
import { privateLocation } from "./paths.mjs";
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
  if (![18, 29, 48, 53].includes(inventory.physical)) refuse("legacy_cross_version");
  if (inventory.privacy.raw?.savedSealFormats.some(({ format }) => format !== "local-plain-v1")) {
    refuse("legacy_raw_format_unrepresentable");
  }
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
    const safety = inventory.suppressionRevision ? {
      facts: rows(db, "SELECT * FROM content_suppressions ORDER BY owner_id, epoch_hi, epoch_lo"),
      reservations: rows(db, "SELECT * FROM content_identity_reservations ORDER BY owner_id, scope, project_id, kind, stable_key"),
      epochs: rows(db, "SELECT * FROM owner_suppression_epochs ORDER BY owner_id"),
    } : null;
    if (safety) attestContentSafety(db, inventory.physical);
    const memo = createContentReadMemo(db);
    const memories = rows(db, "SELECT * FROM memories ORDER BY id").map(row => {
      if (!safety || row.deleted === 1n || row.review_state === "awaiting") return row;
      const namespace = { ownerId: row.owner_id, scope: row.scope, projectId: row.project_id || null };
      const read = contentReadSafety(db, { namespace, memo, intent: "history",
        ref: { type: "memory", memoryId: row.id, revision: Number(row.revision), namespace } });
      return read.allowed ? row : { ...row, deleted: 1n, content: null };
    });
    const byId = new Map(memories.map(row => [row.id, row]));
    const rawPrivacy = readRawPrivacy(db, inventory);
    const hasRawAncestry = rawPrivacy && legacyReceiptHasRawAncestry(db, rawPrivacy.key);
    const receipts = rows(db, "SELECT rowid AS inspect_position, * FROM receipts ORDER BY memory_id, created_at, id");
    let withheldReceipts = 0;
    const rawAncestryEmpty = new Map();
    const visibleReceipts = receipts.filter(({ inspect_position: _position, ...receipt }) => {
      const memory = byId.get(receipt.memory_id);
      const namespace = { ownerId: memory.owner_id, scope: memory.scope, projectId: memory.project_id || null };
      const allowed = memory.deleted !== 1n && receiptReadSafety(db, { namespace, receipt, memo }).allowed;
      if (!allowed) withheldReceipts++;
      else if (hasRawAncestry) rawAncestryEmpty.set(receipt.id, !hasRawAncestry(memory, receipt));
      return allowed;
    });
    const archive = readLegacyArchive(db, file, rawPrivacy, visibleReceipts);
    const admissions = db.prepare(`SELECT owner_id, scope, project_id, client, event_id,
      state FROM admission_claims ORDER BY owner_id, scope, project_id, client, event_id`).all();
    const registered = inventory.raw ? db.prepare(`SELECT owner_id, scope, project_id, client,
      event_id FROM raw_capture_events ORDER BY owner_id, scope, project_id, client, event_id`).all() : [];
    const namespaceEpochs = rows(db, "SELECT * FROM namespace_epochs ORDER BY owner_id, scope, project_id");
    const history = rows(db, "SELECT * FROM memory_supersessions ORDER BY previous_memory_id");
    const inspect = readInspectMigrationInput(db, {
      cursorSecret: readIdentity(db, inventory.storeId).cursorSecret,
      receipts: visibleReceipts, namespaceEpochs, history, memo,
    });
    const result = {
      storeId: inventory.storeId, physical: inventory.physical, logicalDigest: proof.logicalDigest,
      target: target.path, checkSource: file.check, withheldReceipts,
      memories, receipts: visibleReceipts,
      denials: rows(db, "SELECT * FROM suppressed ORDER BY owner_id, scope, project_id, fingerprint"),
      namespaceEpochs, history, inspect: {
        ...inspect,
        evidence: inspect.evidence.filter(item => byId.get(item.id)?.deleted === 0n),
        rawAncestryEmpty,
      },
      episodeControls: rows(db, "SELECT * FROM episode_controls ORDER BY owner_id, scope, project_id"),
      consent: inventory.localControls
        ? rows(db, "SELECT * FROM local_capture_controls ORDER BY owner_id, scope, project_id, client") : [],
      rawControls: inventory.raw ? rows(db, "SELECT * FROM raw_capture_controls ORDER BY owner_id, client") : [],
      rawPrivacy, archive, admissions, registered, safety, localRawPrivacy: inventory.localRawPrivacy,
      dropped: Object.fromEntries(Object.entries({
        rawConversations: "raw_conversations", rawMessages: "raw_messages", rawParts: "raw_parts",
        rawEvents: "raw_events", rawCaptureEvents: "raw_capture_events", rawSourceMaps: "raw_source_maps",
        rawReceiptLineage: "raw_receipt_lineage", rawReceiptOrigins: "raw_receipt_origins",
        episodes: "session_episodes", stagedEvidence: "staged_capture_evidence",
        cards: "private_cards", submittedNotes: "card_notes", captureAdmissions: "admission_claims",
      }).map(([category, table]) => [category,
        db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = ?").get(table)
          ? db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n - (archive.counts[category] ?? 0) : 0])),
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

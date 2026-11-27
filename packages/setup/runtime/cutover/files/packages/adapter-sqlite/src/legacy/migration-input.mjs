import { DatabaseSync } from "node:sqlite";
import { bindReceiptMarkerKeys, contentReadSafety, createContentReadMemo, receiptReadSafety } from "../../../../core/content-safety.mjs";
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
    const retiredReceiptIds = new Set();
    if (inventory.privacy.suppressions.receiptDenials > 0) {
      bindReceiptMarkerKeys(db);
      // The legacy address digest includes the role. The replacement denies
      // the whole source tuple, so match either role at the retained address.
      const marked = db.prepare(`SELECT DISTINCT r.id FROM receipts r
        JOIN memories m ON m.id = r.memory_id
        CROSS JOIN json_each('["user","assistant"]') role
        CROSS JOIN json_each(receipt_marker_keys(r.receipt_key, r.client, r.session_id, r.event_id, role.value)) key
        JOIN suppressed s ON (s.owner_id, s.scope, s.project_id, s.fingerprint) =
          (m.owner_id, m.scope, m.project_id, key.value)`);
      for (const { id } of marked.iterate()) retiredReceiptIds.add(id);
    }
    const receipts = rows(db, "SELECT rowid AS inspect_position, * FROM receipts ORDER BY memory_id, created_at, id");
    let withheldReceipts = 0;
    const withheldPlacement = new Set();
    const hiddenReceiptIds = [];
    const rawAncestryEmpty = new Map();
    // Evaluate the legacy inspect decision inside the final attested snapshot.
    // A retired shared receipt retains its lineage even when a second check
    // independently denies its excerpt.
    const storedReceipts = receipts.flatMap(row => {
      const { inspect_position: _position, ...receipt } = row;
      const memory = byId.get(receipt.memory_id);
      const namespace = { ownerId: memory.owner_id, scope: memory.scope, projectId: memory.project_id || null };
      const allowed = memory.deleted !== 1n && receiptReadSafety(db, { namespace, receipt, memo }).allowed;
      const retired = memory.deleted !== 1n && retiredReceiptIds.has(receipt.id);
      if (!allowed || retired) withheldReceipts++;
      if (!allowed) {
        hiddenReceiptIds.push([namespace, receipt.id]);
        withheldPlacement.add(receipt.memory_id);
        if (!retired) return [];
        if (hasRawAncestry) rawAncestryEmpty.set(receipt.id, false);
        return [{ ...row, excerpt: "" }];
      }
      if (hasRawAncestry) rawAncestryEmpty.set(receipt.id, !hasRawAncestry(memory, receipt));
      return [row];
    });
    const archive = readLegacyArchive(db, file, rawPrivacy, storedReceipts);
    const admissions = db.prepare(`SELECT owner_id, scope, project_id, client, event_id,
      state FROM admission_claims ORDER BY owner_id, scope, project_id, client, event_id`).all();
    const registered = inventory.raw ? db.prepare(`SELECT owner_id, scope, project_id, client,
      event_id FROM raw_capture_events ORDER BY owner_id, scope, project_id, client, event_id`).all() : [];
    const namespaceEpochs = rows(db, "SELECT * FROM namespace_epochs ORDER BY owner_id, scope, project_id");
    const history = rows(db, "SELECT * FROM memory_supersessions ORDER BY previous_memory_id");
    const inspect = readInspectMigrationInput(db, {
      cursorSecret: readIdentity(db, inventory.storeId).cursorSecret,
      receipts: storedReceipts, namespaceEpochs, history, memo,
    });
    const result = {
      storeId: inventory.storeId, physical: inventory.physical, logicalDigest: proof.logicalDigest,
      target: target.path, checkSource: file.check, withheldReceipts,
      memories, receipts: storedReceipts, hiddenReceiptIds, retiredReceiptIds,
      placement: {
        topics: rows(db, "SELECT * FROM mocs ORDER BY canonical_title, id"),
        edges: rows(db, "SELECT * FROM moc_edges ORDER BY parent_id, child_id"),
        sources: rows(db, "SELECT * FROM moc_title_sources ORDER BY moc_id, memory_id"),
        members: rows(db, "SELECT * FROM moc_memory_refs ORDER BY moc_id, memory_id"),
        conflicts: rows(db, "SELECT * FROM memory_conflicts ORDER BY left_memory_id, right_memory_id, source"),
        completed: rows(db, `SELECT c.owner_id, c.scope, c.project_id,
          json_extract(f.value, '$.memoryId') AS id, json_extract(f.value, '$.revision') AS revision
          FROM capture_initial_classification c, json_each(c.final_refs) f
          WHERE c.status = 'applied' AND EXISTS (SELECT 1 FROM json_each(c.selected_refs) s
            WHERE json_extract(s.value, '$.memoryId') = json_extract(f.value, '$.memoryId'))`),
        withheld: withheldPlacement,
      },
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

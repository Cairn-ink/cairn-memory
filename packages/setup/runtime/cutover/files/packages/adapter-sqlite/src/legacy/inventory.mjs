import { DatabaseSync } from 'node:sqlite';
import { verifyCardLineageCommitmentsInside } from '../../../../core/card-lineage.mjs';
import { APPLICATION_ID } from '../../../../core/database.mjs';
import { contentSafetyInventory } from '../../../../core/content-safety-migration.mjs';
import { cardLineageRevision, receiptEventTimeEnabled } from '../../../../core/content-safety-schema.mjs';
import { probeRollbackJournal } from '../../../../core/sqlite-journal-probe.mjs';
import { identifier } from '../../../../core/validation.mjs';
import { pinColdFile } from './paths.mjs';
import { assertLegacyLayout, LegacyRefusal } from './refusal.mjs';
import { attestLegacySchema } from './schema.mjs';

const hexDigest = /^[0-9a-f]{64}$/;
const count = (db, table, where = '1') => db.prepare(`SELECT count(*) AS n FROM ${table} WHERE ${where}`).get().n;
const digestColumn = column => `length(${column}) = 64 AND ${column} NOT GLOB '*[^0-9a-f]*'`;

export function readIdentity(db, expectedStoreId) {
  const stores = db.prepare('SELECT singleton,store_id,cursor_secret FROM store_metadata LIMIT 2').all();
  const episodes = db.prepare('SELECT singleton,secret FROM episode_identity LIMIT 2').all();
  if (stores.length !== 1 || stores[0].singleton !== 1 || !hexDigest.test(stores[0].cursor_secret) ||
      episodes.length !== 1 || episodes[0].singleton !== 1 || !hexDigest.test(episodes[0].secret)) {
    throw new LegacyRefusal('legacy_incomplete');
  }
  const storeId = identifier(stores[0].store_id);
  if (expectedStoreId !== undefined && storeId !== expectedStoreId) throw new LegacyRefusal('legacy_foreign_store');
  return { storeId, cursorSecret: stores[0].cursor_secret };
}

function assertIntegrity(db) {
  if (db.prepare('PRAGMA integrity_check(1)').get()?.integrity_check !== 'ok') {
    throw new LegacyRefusal('legacy_integrity_mismatch');
  }
  const foreignKeys = db.prepare('PRAGMA foreign_key_check');
  foreignKeys.setReadBigInts(true);
  if (foreignKeys.get()) throw new LegacyRefusal('legacy_integrity_mismatch');
}

function assertCurrentCardLineage(db, identity) {
  // Apply the migration's current-body rule with the reader's commitment check.
  // A verified header may still describe unknown historical ancestry.
  const cards = db.prepare(`SELECT id, owner_id AS ownerId, scope, NULLIF(project_id, '') AS projectId
    FROM private_cards WHERE state IN ('draft', 'confirmed')`);
  for (const { id, ownerId, scope, projectId } of cards.iterate()) {
    verifyCardLineageCommitmentsInside(db, identity, { ownerId, scope, projectId }, id);
  }
}

// A content-safety owner fence is the end of a contiguous unsigned 64-bit
// sequence. Do the arithmetic in SQLite's separate high/low limbs.
function assertSuppressionEpochs(db) {
  const gap = db.prepare(`SELECT 1 FROM content_suppressions f
    WHERE (f.epoch_hi != 0 OR f.epoch_lo != 1) AND NOT EXISTS (
      SELECT 1 FROM content_suppressions p WHERE p.owner_id = f.owner_id
        AND p.epoch_hi = f.epoch_hi - (f.epoch_lo = 0)
        AND p.epoch_lo = CASE f.epoch_lo WHEN 0 THEN 4294967295 ELSE f.epoch_lo - 1 END
    ) LIMIT 1`).get();
  const mismatch = db.prepare(`SELECT 1 FROM owner_suppression_epochs e WHERE
    ((e.epoch_hi != 0 OR e.epoch_lo != 0) AND NOT EXISTS (
      SELECT 1 FROM content_suppressions f
      WHERE (f.owner_id, f.epoch_hi, f.epoch_lo) = (e.owner_id, e.epoch_hi, e.epoch_lo)
    )) OR EXISTS (SELECT 1 FROM content_suppressions f
      WHERE f.owner_id = e.owner_id AND (f.epoch_hi, f.epoch_lo) > (e.epoch_hi, e.epoch_lo)) LIMIT 1`).get();
  if (gap || mismatch) throw new LegacyRefusal('legacy_incomplete');
}

function rawSealSummary(db) {
  const invalid = db.prepare(`SELECT 1 FROM raw_parts WHERE saved = 1 AND
    (length(sealed) = 0 OR (format = 'local-plain-v1' AND
      (key_version IS NOT NULL OR length(sealed) != byte_count))) LIMIT 1`).get();
  if (invalid) throw new LegacyRefusal('legacy_incomplete');
  const groups = db.prepare(`SELECT format, key_version AS keyVersion, count(*) AS parts
    FROM raw_parts WHERE saved = 1 GROUP BY format, key_version ORDER BY format, key_version`).all();
  const formats = new Map();
  for (const { format, keyVersion, parts } of groups) {
    if (format === 'envelope-aes-256-gcm-v1' && !/^[\x21-\x7e]{1,64}$/.test(keyVersion ?? '') ||
        format !== 'local-plain-v1' && format !== 'envelope-aes-256-gcm-v1') {
      throw new LegacyRefusal('legacy_incomplete');
    }
    const summary = formats.get(format) ?? { format, parts: 0, keyVersions: 0 };
    summary.parts += parts;
    if (keyVersion !== null) summary.keyVersions++;
    formats.set(format, summary);
  }
  return Object.freeze([...formats.values()].map(summary => Object.freeze(summary)));
}

function readPrivacy(db, layout, localRawPrivacy) {
  const suppressions = Object.freeze({
    legacyDenials: count(db, 'suppressed'),
    receiptDenials: count(db, 'suppressed', "fingerprint GLOB 'rs1:*'"),
    facts: layout.suppressionRevision ? count(db, 'content_suppressions') : null,
    ownerEpochs: layout.suppressionRevision ? count(db, 'owner_suppression_epochs') : null,
    identityReservations: layout.suppressionRevision ? count(db, 'content_identity_reservations') : null,
  });
  const memoryTombstones = count(db, 'memories', 'deleted = 1');
  if (db.prepare(`SELECT 1 FROM suppressed WHERE fingerprint GLOB 'rs1:*' AND NOT (
    substr(fingerprint,1,6) IN ('rs1:i:', 'rs1:a:') AND ${digestColumn('substr(fingerprint,7)')})
    LIMIT 1`).get()) throw new LegacyRefusal('legacy_receipt_marker_unrepresentable');
  const invalidFingerprint = db.prepare(`SELECT 1 FROM memories WHERE NOT (${digestColumn('fingerprint')})
    UNION ALL SELECT 1 FROM suppressed WHERE fingerprint NOT GLOB 'rs1:*' AND NOT (${digestColumn('fingerprint')})
    LIMIT 1`).get();
  if (invalidFingerprint) throw new LegacyRefusal('legacy_incomplete');
  if (db.prepare(`SELECT 1 FROM memories m WHERE deleted = 1 AND (
    NOT EXISTS (SELECT 1 FROM suppressed s WHERE (s.owner_id,s.scope,s.project_id,s.fingerprint) =
      (m.owner_id,m.scope,m.project_id,m.fingerprint)) OR EXISTS (
    SELECT 1 FROM receipts WHERE memory_id = m.id)) LIMIT 1`).get()) throw new LegacyRefusal('legacy_incomplete');
  if (layout.suppressionRevision) assertSuppressionEpochs(db);
  if (localRawPrivacy && db.prepare(`SELECT 1 FROM local_raw_uuid_fences
    WHERE NOT (${digestColumn('uuid_hash')}) LIMIT 1`).get()) throw new LegacyRefusal('legacy_incomplete');

  return Object.freeze({
    // The retained native evidence is structurally coherent. No supported
    // cell proves that pre-attestation hard deletions have a retained record.
    historyComplete: false,
    historicalCoverage: 'retained-evidence-only',
    suppressions,
    fingerprints: Object.freeze({
      memoryRows: count(db, 'memories'),
      legacyExactDenials: suppressions.legacyDenials - suppressions.receiptDenials,
    }),
    forgetLogs: Object.freeze({
      memoryTombstones,
      rawDeletionActions: layout.rawDeletion ? count(db, 'raw_deletion_actions') : null,
      rawDeletionEffects: layout.rawDeletion ? count(db, 'raw_deletion_effects') : null,
    }),
    pause: Object.freeze({
      scopedControls: count(db, 'episode_controls'),
      pausedScopes: count(db, 'episode_controls', 'paused = 1'),
      disabledScopes: count(db, 'episode_controls', 'enabled = 0'),
      localConsentControls: layout.localControls ? count(db, 'local_capture_controls') : null,
      localAutomaticCaptureDisabled: layout.localControls
        ? count(db, 'local_capture_controls', 'automatic_capture_enabled = 0') : null,
    }),
    raw: layout.raw ? Object.freeze({
      savedSealFormats: rawSealSummary(db),
      unsavedParts: count(db, 'raw_parts', 'saved = 0'),
      receiptSpans: layout.rawLineage ? count(db, 'raw_receipt_lineage') : null,
      excludedSpans: layout.rawLineage ? count(db, 'raw_source_exclusions') : null,
      sessionFences: layout.rawCapture ? count(db, 'raw_session_fences') : null,
      hashedSessionFences: layout.rawCapture ? count(db, 'raw_session_fences',
        `substr(session_key,1,3) = 's1:' AND ${digestColumn('substr(session_key,4)')}`) : null,
      hideWindows: localRawPrivacy ? count(db, 'local_raw_hide_windows') : null,
      uuidFences: localRawPrivacy ? count(db, 'local_raw_uuid_fences') : null,
      pendingUuidJobs: localRawPrivacy ? count(db, 'local_raw_uuid_jobs', 'complete = 0') : null,
      uuidBackfillComplete: localRawPrivacy
        ? db.prepare('SELECT 1 FROM local_raw_uuid_backfill WHERE singleton = 1 AND complete = 1').get() !== undefined : null,
    }) : null,
  });
}

function readFailure(error) {
  if (error instanceof LegacyRefusal) return error;
  if (error?.code === 'storage_busy' || [5, 6].includes(error?.errcode & 255)) {
    return new LegacyRefusal('legacy_busy');
  }
  if ((error?.errcode & 255) === 26) return new LegacyRefusal('legacy_foreign_store');
  if ((error?.errcode & 255) === 11) return new LegacyRefusal('legacy_integrity_mismatch');
  return new LegacyRefusal('legacy_incomplete');
}

// An offline snapshot. Probe in the engine's isolated child first so opening a
// clean WAL header cannot create SHM/WAL companions as an inventory side effect.
export function readLegacySnapshot(path, { expectedStoreId, digest = false } = {}) {
  if (expectedStoreId !== undefined) {
    try { identifier(expectedStoreId); }
    catch { throw new LegacyRefusal('legacy_invalid_input'); }
  }
  const file = pinColdFile(path);
  let db;
  try {
    if (file.stat.size === 0n) throw new LegacyRefusal('legacy_incomplete');
    const probe = probeRollbackJournal(file.path, { uncached: true });
    if (probe.code === 26 || probe.code === 11 || probe.code === 5 || probe.code === 6) {
      throw readFailure({ errcode: probe.code });
    }
    if (probe.mode !== 'delete') throw new LegacyRefusal('legacy_unsafe_path');
    file.check();
    db = new DatabaseSync(file.path, { readOnly: true });
    db.exec('PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; BEGIN');
    if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') throw new LegacyRefusal('legacy_unsafe_path');
    if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID) {
      throw new LegacyRefusal('legacy_foreign_store');
    }
    const { user_version: physical } = db.prepare('PRAGMA user_version').get();
    assertLegacyLayout(physical);
    const { layout, localRawPrivacy } = attestLegacySchema(db, physical);
    const identity = readIdentity(db, expectedStoreId);
    assertIntegrity(db);
    const lineageRevision = cardLineageRevision(layout);
    if (lineageRevision === 1) assertCurrentCardLineage(db, identity);
    const inventory = Object.freeze({
      ...layout, storeId: identity.storeId, complete: true, localRawPrivacy,
      cardLineageRevision: lineageRevision,
      receiptEventTime: receiptEventTimeEnabled(layout),
      privacy: readPrivacy(db, layout, localRawPrivacy),
    });
    const logicalDigest = digest ? contentSafetyInventory(db) : undefined;
    db.exec('COMMIT');
    db.close();
    db = undefined;
    file.check();
    return { inventory, logicalDigest, file };
  } catch (error) {
    throw readFailure(error);
  } finally {
    db?.close();
  }
}

export function inventoryLegacyStore(path, options) {
  return readLegacySnapshot(path, options).inventory;
}

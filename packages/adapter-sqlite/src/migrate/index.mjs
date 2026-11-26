import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CoreError } from "@cairn-ink/core";
import { cleanMigrationBootstraps, installMigrationTarget, targetExists } from "../legacy/migration-bootstrap.mjs";
import { LegacyRefusal, refuse, readMigrationInput } from "../legacy/migration-input.mjs";
import { installContextReadSchema } from "../schema/context-read.mjs";
import { installInspectSchema } from "../schema/inspect.mjs";
import { INITIALIZE_STORE, SQLITE_APPLICATION_ID, SQLITE_PHYSICAL_VERSION, STORAGE_SCHEMA } from "../schema/layout.mjs";
import { sha256 } from "../storage-values.mjs";
import { openMigrationUnitOfWork } from "../uow.mjs";
import { BOOTSTRAP_FILENAME, MIGRATION_SCHEMA } from "./layout.mjs";
import { convertPlacement } from "./placement.mjs";
import { encodeEvidence, planMigration } from "./plan.mjs";

/** @import { SQLInputValue } from "node:sqlite" */
/** @import { LegacyInput, MigrationInput } from "../legacy/migration-input.mjs" */
/** @import { Connection } from "../storage-values.mjs" */
/** @typedef {"initialized" | "memories" | "privacy" | "verified"} Checkpoint */
/** @typedef {ReturnType<typeof planMigration>} Plan */

const owner = "schema";
const schemaQuery = "SELECT type, name, tbl_name, sql FROM sqlite_schema ORDER BY type, name";
const migrationSchema = STORAGE_SCHEMA + MIGRATION_SCHEMA + INITIALIZE_STORE;

/** @param {Plan} plan @param {LegacyInput} source */
function rawPrivacyRows(plan, source, copying = false) {
  const { rawPrivacy, archive } = source;
  const exactOnly = new Set(copying ? [] : rawPrivacy?.exactOnlyUuidRules);
  const rules = rawPrivacy?.rules.filter(tuple => !exactOnly.has(tuple)) ?? [];
  return [...rules, ...archive.reservations, ...plan.closed];
}

/** @param {Plan} plan @param {LegacyInput} source */
function phases(plan, source, copying = false) {
  return [
    [
      ["cairn_memories", plan.memoryRows],
      ["cairn_receipts", plan.receiptRows],
      ["cairn_index_revisions", plan.revisions],
    ],
    [
      ["cairn_legacy_denials", plan.markers],
      ["cairn_suppression_epochs", plan.epochs],
      ["cairn_suppression_facts", plan.safety.facts],
      ["cairn_migrated_safety", plan.safety.rows],
      ["cairn_pause", plan.pause],
      ["cairn_raw_fences", source.rawPrivacy?.fences ?? []],
      ["cairn_migrated_raw_privacy", rawPrivacyRows(plan, source, copying)],
      ["cairn_raw_messages", source.archive.rows],
      ["cairn_raw_anchors", plan.anchors],
      ["cairn_migrated_raw_maps", source.archive.maps],
    ],
  ].map(phase => /** @type {Array<[string, SQLInputValue[][]]>} */ (phase));
}

/** @param {Pick<DatabaseSync, "prepare">} db */
function migrationRecord(db) {
  if (db.prepare("PRAGMA application_id").get()?.application_id !== SQLITE_APPLICATION_ID ||
      db.prepare("PRAGMA user_version").get()?.user_version !== SQLITE_PHYSICAL_VERSION ||
      !db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'cairn_migration'").get()) {
    return refuse("legacy_foreign_store");
  }
  return db.prepare(`SELECT m.*, s.store_id, s.session_hash_key
    FROM cairn_migration m JOIN cairn_store s USING (singleton) WHERE singleton = 1`).get();
}

/**
 * The UoW uses CoreError at its port boundary. Keep maintenance refusal codes
 * for the caller after a failing write has rolled back.
 * @template T
 * @param {ReturnType<typeof openMigrationUnitOfWork>} connection
 * @param {(db: Connection) => T} work
 */
async function migrationWrite({ uow, port }, work) {
  /** @type {LegacyRefusal | undefined} */
  let refusal;
  try {
    return await uow.run(owner, {}, tx => port(tx, owner, { write: true }, db => {
      try { return work(db); }
      catch (error) {
        if (!(error instanceof LegacyRefusal)) throw error;
        refusal = error;
        throw new CoreError("storage_error");
      }
    }));
  } catch (error) {
    if (refusal) throw refusal;
    throw error;
  }
}

/** @param {ReturnType<typeof migrationRecord>} record @param {LegacyInput} source @param {Plan} [plan] */
function checkRecord(record, source, plan) {
  if (!record || record.store_id !== source.storeId) return refuse("legacy_foreign_store");
  if (record.source_digest !== source.logicalDigest || record.source_version !== source.physical) refuse("legacy_backup_stale");
  if (typeof record.migration_id !== "string" || !/^[0-9a-f-]{36}$/u.test(record.migration_id) ||
      typeof record.session_hash_key !== "string" || !/^[0-9a-f]{64}$/u.test(record.session_hash_key) ||
      (source.rawPrivacy && record.session_hash_key !== source.rawPrivacy.key) ||
      typeof record.checkpoint !== "number" || !Number.isInteger(record.checkpoint) ||
      record.checkpoint < 0 || record.checkpoint > 3 ||
      (record.checkpoint === 3 ? typeof record.attestation !== "string" ||
        !/^[0-9a-f]{64}$/u.test(record.attestation) : record.attestation !== null) ||
      (plan && record.source_evidence !== plan.evidence)) return refuse("legacy_incomplete");
  return { migrationId: record.migration_id, checkpoint: record.checkpoint,
    sessionKey: record.session_hash_key, attestation: record.attestation };
}

function expectedSchema() {
  const db = new DatabaseSync(":memory:");
  try {
    db.exec(migrationSchema);
    return db.prepare(schemaQuery).all();
  } finally {
    db.close();
  }
}

/** @param {SQLInputValue[][]} tuples */
function tableDigest(tuples) {
  const encoded = tuples.map(tuple => encodeEvidence(tuple.map(value => typeof value === "number" ? BigInt(value) : value)));
  return sha256(JSON.stringify(encoded.sort()));
}

/** @param {Connection} db @param {string} table @param {SQLInputValue[][]} tuples */
function verifyTable(db, table, tuples) {
  const target = db.prepare(`SELECT * FROM "${table}"`);
  target.setReadBigInts(true);
  const digest = tableDigest(target.all().map(row => Object.values(row)));
  if (digest !== tableDigest(tuples)) return refuse("legacy_integrity_mismatch");
  return digest;
}

/** @param {Connection} db @param {string} table @param {SQLInputValue[][]} tuples */
function insertRows(db, table, tuples) {
  if (!tuples.length) return;
  const insert = db.prepare(`INSERT INTO ${table} VALUES (${tuples[0].map(() => "?").join(", ")})`);
  for (const tuple of tuples) insert.run(...tuple);
}

/** @param {LegacyInput} source @param {Plan} plan @param {string} target */
function reportCutoverEvidence(source, plan, target) {
  const db = new DatabaseSync(target, { readOnly: true });
  try {
    db.exec("PRAGMA query_only = ON; PRAGMA trusted_schema = OFF; BEGIN");
    const record = checkRecord(migrationRecord(db), source, plan);
    if (record.checkpoint !== 3) refuse("legacy_incomplete");
    let uuidFences = 0;
    for (const [table, tuples] of phases(plan, source)[1]) {
      if (!["cairn_raw_fences", "cairn_migrated_raw_privacy", "cairn_pause"].includes(table)) continue;
      const query = db.prepare(`SELECT * FROM "${table}"`);
      query.setReadBigInts(true);
      const actual = query.all();
      const digest = tableDigest(actual.map(row => Object.values(row)));
      if (digest !== tableDigest(tuples)) {
        // Earlier attestations included the full privacy copy. Verify that
        // exact population when reporting evidence for a completed replay.
        if (table !== "cairn_migrated_raw_privacy" || digest !== tableDigest(rawPrivacyRows(plan, source, true))) {
          refuse("legacy_integrity_mismatch");
        }
      }
      if (table === "cairn_migrated_raw_privacy") uuidFences = actual.filter(row => row.kind === "uuid").length;
    }
    const raw = source.rawPrivacy;
    const rules = raw?.rules ?? [];
    return {
      rawDeletionEvidence: {
        sessionFences: raw?.fences.length ?? 0,
        hideWindows: rules.filter(row => row[3] === "window").length,
        uuidFences,
        excludedSpans: rules.filter(row => row[3] === "span").length,
        rawDeletionActions: raw?.actions.length ?? 0,
        rawDeletionEffects: raw?.effects.length ?? 0,
      },
      captureControls: {
        namespaces: source.episodeControls.map(row => ({
          ownerId: row.owner_id, scope: row.scope, projectId: row.project_id || null,
          generation: row.generation, paused: row.paused === 1n, enabled: row.enabled === 1n,
        })),
        disabledAutomaticCapture: source.consent.filter(row => row.automatic_capture_enabled === 0n).length,
        rawControls: source.rawControls.length,
        pausedOwners: plan.pausedOwners,
        digest: sha256(encodeEvidence([source.episodeControls, source.consent, source.rawControls])),
      },
    };
  } finally { db.close(); }
}

/**
 * Verify the schema, complete row populations, identity, and database
 * integrity in the very transaction that makes the file eligible to open.
 * @param {Connection} db @param {LegacyInput} source @param {Plan} plan
 * @param {ReturnType<typeof checkRecord>} record @param {ReturnType<typeof expectedSchema>} schema
 */
function verify(db, source, plan, record, schema) {
  const actual = db.prepare(schemaQuery).all();
  if (JSON.stringify(actual) !== JSON.stringify(schema) ||
      db.prepare("PRAGMA integrity_check(1)").get()?.integrity_check !== "ok" ||
      db.prepare("PRAGMA foreign_key_check").get()) return refuse("legacy_integrity_mismatch");
  const expected = new Map(phases(plan, source).flat());
  expected.set("cairn_raw_anchors", [...plan.anchors, ...source.archive.fencedAnchors]);
  expected.set("cairn_store", [[1, source.storeId, record.sessionKey]]);
  const digests = [];
  for (const { type, name } of schema) {
    if (type !== "table" || name === "cairn_migration") continue;
    digests.push([name, verifyTable(db, String(name), expected.get(String(name)) ?? [])]);
  }
  return sha256(encodeEvidence([record.migrationId, source.logicalDigest, schema, plan.evidence, digests]));
}

/**
 * Convert the current cold source into a sibling CNXT file. Keep the host's
 * quiescence barrier held until this call returns. The backup proves freshness
 * and is never the conversion source. The caller owns activation.
 * @param {MigrationInput & { onCheckpoint?: (name: Checkpoint, migrationId: string) => void, reportCutoverEvidence?: boolean }} input
 */
export async function migrateLegacyStore(input) {
  const source = readMigrationInput(input);
  const { target } = source;
  if (basename(target) === BOOTSTRAP_FILENAME) refuse("legacy_unsafe_path");
  const plan = planMigration(source);
  const schema = expectedSchema();
  cleanMigrationBootstraps(target);
  if (!targetExists(target)) {
    const migrationId = randomUUID();
    await installMigrationTarget(target, async filename => {
      const connection = openMigrationUnitOfWork(filename);
      try {
        await migrationWrite(connection, db => {
          db.exec(migrationSchema);
          db.prepare("UPDATE cairn_store SET store_id = ?").run(source.storeId);
          if (source.rawPrivacy) db.prepare("UPDATE cairn_store SET session_hash_key = ?").run(source.rawPrivacy.key);
          db.prepare("INSERT INTO cairn_migration VALUES (1, ?, ?, ?, 0, ?, NULL)")
            .run(migrationId, source.physical, source.logicalDigest, plan.evidence);
        });
      } finally {
        await connection.close();
      }
      source.checkSource();
    });
  }

  // Refuse unrelated or mismatched destinations before opening a writer.
  const reader = new DatabaseSync(target, { readOnly: true });
  let observed;
  try { observed = checkRecord(migrationRecord(reader), source, plan); }
  finally { reader.close(); }
  const result = {
    migrationId: observed.migrationId, storeId: source.storeId, sourceLayout: source.physical,
    memories: plan.memoryRows.length, receipts: plan.receiptRows.length, denials: plan.markers.length,
    withheldReceipts: plan.withheldReceipts, pausedOwners: plan.pausedOwners,
    rawFences: source.rawPrivacy?.fences.length ?? 0,
    rawPrivacyFacts: source.rawPrivacy ? source.rawPrivacy.rules.length - source.rawPrivacy.exactOnlyUuidRules.length : 0,
    archived: source.archive.counts, ledger: plan.ledger, safetyFacts: source.safety?.facts.length ?? 0,
    identityReservations: source.safety?.reservations.length ?? 0, dropped: source.dropped,
  };
  /** @param {string} attestation */
  const completed = attestation => ({ ...result, attestation,
    ...(input.reportCutoverEvidence ? reportCutoverEvidence(source, plan, target) : {}) });
  if (observed.checkpoint === 3) return completed(String(observed.attestation));

  const connection = openMigrationUnitOfWork(target);
  const { migrationId } = result;
  let attestation;
  try {
    if (observed.checkpoint === 0) input.onCheckpoint?.("initialized", migrationId);
    const steps = phases(plan, source, true);
    for (const [index, name] of /** @type {const} */ ([[0, "memories"], [1, "privacy"]])) {
      source.checkSource();
      const advanced = await migrationWrite(connection, db => {
        const record = checkRecord(migrationRecord(db), source, plan);
        if (record.migrationId !== migrationId || record.checkpoint < index) refuse("legacy_incomplete");
        if (record.checkpoint > index) return false;
        for (const [table, tuples] of steps[index]) insertRows(db, table, tuples);
        db.prepare("UPDATE cairn_migration SET checkpoint = ?").run(index + 1);
        return true;
      });
      if (advanced) input.onCheckpoint?.(name, migrationId);
    }
    source.checkSource();
    const [proof, advanced] = await migrationWrite(connection, db => {
      const record = checkRecord(migrationRecord(db), source, plan);
      if (record.migrationId !== migrationId || record.checkpoint < 2) return refuse("legacy_incomplete");
      if (record.checkpoint === 3) return [String(record.attestation), false];
      // Include the opaque anchors when resuming a target whose copy phases
      // were already committed. Verification covers them in this transaction.
      if (source.archive.fencedAnchors.length) {
        const insert = db.prepare("INSERT INTO cairn_raw_anchors VALUES (?, ?, ?, ?, ?, ?, ?)");
        for (const tuple of source.archive.fencedAnchors) insert.run(...tuple);
      }
      // Rewrite the copy phase's redundant UUID evidence only when the exact
      // anchors and final attestation can commit with the removal.
      if (source.rawPrivacy?.exactOnlyUuidRules.length) {
        const remove = db.prepare(`DELETE FROM cairn_migrated_raw_privacy
          WHERE owner_id=? AND namespace_key=? AND client_key=? AND kind=? AND selector=? AND body=?`);
        for (const rule of source.rawPrivacy.exactOnlyUuidRules) {
          if (remove.run(...rule).changes !== 1) return refuse("legacy_integrity_mismatch");
        }
      }
      let proof = verify(db, source, plan, record, schema);
      installInspectSchema(db, source.inspect, () => {
        const { tables, evidence } = convertPlacement(db, source, record.sessionKey);
        const digests = [];
        for (const [table, rows] of Object.entries(tables)) {
          insertRows(db, table, rows);
          if (rows.length) digests.push([table, verifyTable(db, table, rows)]);
        }
        if (digests.length) {
          if (db.prepare("PRAGMA foreign_key_check").get()) return refuse("legacy_integrity_mismatch");
          proof = sha256(encodeEvidence([proof, digests]));
        }
        return evidence;
      });
      installContextReadSchema(db);
      db.prepare("UPDATE cairn_migration SET checkpoint = 3, attestation = ?").run(proof);
      return [proof, true];
    });
    if (advanced) input.onCheckpoint?.("verified", migrationId);
    attestation = proof;
  } finally {
    await connection.close();
  }
  // Close the migration connection before reopening the target for the cutover proof.
  return completed(attestation);
}

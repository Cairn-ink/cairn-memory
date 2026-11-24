import { randomUUID } from "node:crypto";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CoreError } from "@cairn-ink/core";
import { cleanMigrationBootstraps, installMigrationTarget, targetExists } from "../legacy/migration-bootstrap.mjs";
import { LegacyRefusal, refuse, readMigrationInput } from "../legacy/migration-input.mjs";
import { INITIALIZE_STORE, SQLITE_APPLICATION_ID, SQLITE_PHYSICAL_VERSION, STORAGE_SCHEMA } from "../schema/layout.mjs";
import { sha256 } from "../storage-values.mjs";
import { openMigrationUnitOfWork } from "../uow.mjs";
import { BOOTSTRAP_FILENAME, MIGRATION_SCHEMA } from "./layout.mjs";
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
function phases(plan, source) {
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
      ["cairn_migrated_raw_privacy", [...(source.rawPrivacy?.rules ?? []), ...source.archive.reservations, ...plan.closed]],
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
  expected.set("cairn_store", [[1, source.storeId, record.sessionKey]]);
  const digests = [];
  for (const { type, name } of schema) {
    if (type !== "table" || name === "cairn_migration") continue;
    const target = db.prepare(`SELECT * FROM "${String(name)}"`);
    target.setReadBigInts(true);
    const digest = tableDigest(target.all().map(row => Object.values(row)));
    if (digest !== tableDigest(expected.get(String(name)) ?? [])) return refuse("legacy_integrity_mismatch");
    digests.push([name, digest]);
  }
  return sha256(encodeEvidence([record.migrationId, source.logicalDigest, schema, plan.evidence, digests]));
}

/**
 * Convert the current cold source into a sibling CNXT file. Keep the host's
 * quiescence barrier held until this call returns. The backup proves freshness
 * and is never the conversion source. The caller owns activation.
 * @param {MigrationInput & { onCheckpoint?: (name: Checkpoint, migrationId: string) => void }} input
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
    rawFences: source.rawPrivacy?.fences.length ?? 0, rawPrivacyFacts: source.rawPrivacy?.rules.length ?? 0,
    archived: source.archive.counts, ledger: plan.ledger, safetyFacts: source.safety?.facts.length ?? 0,
    identityReservations: source.safety?.reservations.length ?? 0, dropped: source.dropped,
  };
  if (observed.checkpoint === 3) return { ...result, attestation: String(observed.attestation) };

  const connection = openMigrationUnitOfWork(target);
  const { migrationId } = result;
  try {
    if (observed.checkpoint === 0) input.onCheckpoint?.("initialized", migrationId);
    const steps = phases(plan, source);
    for (const [index, name] of /** @type {const} */ ([[0, "memories"], [1, "privacy"]])) {
      source.checkSource();
      const advanced = await migrationWrite(connection, db => {
        const record = checkRecord(migrationRecord(db), source, plan);
        if (record.migrationId !== migrationId || record.checkpoint < index) refuse("legacy_incomplete");
        if (record.checkpoint > index) return false;
        for (const [table, tuples] of steps[index]) {
          if (!tuples.length) continue;
          const insert = db.prepare(`INSERT INTO ${table} VALUES (${tuples[0].map(() => "?").join(", ")})`);
          for (const tuple of tuples) insert.run(...tuple);
        }
        db.prepare("UPDATE cairn_migration SET checkpoint = ?").run(index + 1);
        return true;
      });
      if (advanced) input.onCheckpoint?.(name, migrationId);
    }
    source.checkSource();
    const [attestation, advanced] = await migrationWrite(connection, db => {
      const record = checkRecord(migrationRecord(db), source, plan);
      if (record.migrationId !== migrationId || record.checkpoint < 2) return refuse("legacy_incomplete");
      if (record.checkpoint === 3) return [String(record.attestation), false];
      const proof = verify(db, source, plan, record, schema);
      db.prepare("UPDATE cairn_migration SET checkpoint = 3, attestation = ?").run(proof);
      return [proof, true];
    });
    if (advanced) input.onCheckpoint?.("verified", migrationId);
    return { ...result, attestation };
  } finally {
    await connection.close();
  }
}

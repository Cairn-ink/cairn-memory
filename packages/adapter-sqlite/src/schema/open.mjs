import { chmodSync, realpathSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { CoreError } from "@cairn-ink/core";
import { toSqliteError } from "../errors.mjs";
import { assertMigrationComplete, assertServingFilename } from "../migrate/guard.mjs";
import { readMigratedControls } from "../migrate/capture-controls.mjs";
import { openAdapterUnitOfWork } from "../uow.mjs";
import { CONTEXT_READ_TABLES, installContextReadSchema } from "./context-read.mjs";
import { INSPECT_TABLES, installInspectSchema } from "./inspect.mjs";
import { INITIALIZE_STORE, SQLITE_APPLICATION_ID, SQLITE_PHYSICAL_VERSION, STORAGE_SCHEMA } from "./layout.mjs";

/** @typedef {Pick<DatabaseSync, "prepare">} Reader */

const layoutTables = [
  "cairn_store", "cairn_memories", "cairn_receipts", "cairn_procedural_tags", "cairn_suppression_facts",
  "cairn_suppression_epochs", "cairn_legacy_denials", "cairn_pause",
  "cairn_capture_claims", "cairn_capture_outbox", "cairn_capture_abandoned_tokens", "cairn_index_revisions",
  "cairn_raw_messages", "cairn_raw_fences", "cairn_raw_anchors",
  "cairn_migrated_raw_privacy", "cairn_migrated_safety", "cairn_migrated_raw_maps",
];

/** @param {Reader} db */
function readSessionHashKey(db) {
  const identities = db.prepare("SELECT singleton, store_id, session_hash_key FROM cairn_store LIMIT 2").all();
  const [identity] = identities;
  if (identities.length !== 1 || identity.singleton !== 1 ||
      typeof identity.store_id !== "string" || !identity.store_id ||
      typeof identity.session_hash_key !== "string" || !/^[0-9a-f]{64}$/u.test(identity.session_hash_key)) {
    throw new CoreError("storage_error");
  }
  return identity.session_hash_key;
}

/** Return the session hash key for an attested store, or null for an empty store.
 * @param {Reader} db
 */
function classifyStore(db) {
  const app = db.prepare("PRAGMA application_id").get()?.application_id;
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  if (db.prepare("PRAGMA encoding").get()?.encoding !== "UTF-8") throw new CoreError("storage_error");
  if (app === 0 && version === 0 && !db.prepare("SELECT 1 FROM sqlite_schema LIMIT 1").get()) return null;
  if (app !== SQLITE_APPLICATION_ID || version !== SQLITE_PHYSICAL_VERSION) {
    throw new CoreError("storage_error");
  }
  const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all();
  const migrated = tables.some(table => table.name === "cairn_migration");
  const expected = [...layoutTables, ...INSPECT_TABLES, ...CONTEXT_READ_TABLES, ...(migrated ? ["cairn_migration"] : [])];
  if (tables.length !== expected.length || !expected.every(name => tables.some(table => table.name === name))) {
    throw new CoreError("storage_error");
  }
  if (migrated) assertMigrationComplete(db);
  const identity = db.prepare("SELECT singleton, cursor_secret FROM cairn_inspect_identity LIMIT 2").all();
  if (identity.length !== 1 || identity[0].singleton !== 1 ||
      typeof identity[0].cursor_secret !== "string" || !/^[0-9a-f]{64}$/u.test(identity[0].cursor_secret)) {
    throw new CoreError("storage_error");
  }
  const legacyRawHashing = migrated && db.prepare(
    "SELECT json_type(source_evidence, '$.legacyRawHashing') AS kind FROM cairn_migration").get()?.kind === "true";
  const controls = migrated ? readMigratedControls(db) : undefined;
  return { sessionHashKey: readSessionHashKey(db), legacyRawHashing, controls };
}

/** @param {string} filename */
function preflight(filename) {
  if (typeof filename !== "string" || !filename || filename === ":memory:" ||
      filename.startsWith("file:") || filename.includes("\0")) throw new CoreError("invalid_input");
  assertServingFilename(filename);
  try {
    if (!statSync(filename).isFile()) throw new CoreError("invalid_input");
    assertServingFilename(realpathSync(filename));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== "ENOENT") throw error;
    return false;
  }
  // Classify the header, tables and identity in one read snapshot before the
  // writer can change journal mode.
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    db.exec("BEGIN");
    classifyStore(db);
  } finally {
    db.close();
  }
  return true;
}

/** @param {string} filename */
export async function openStorage(filename) {
  try {
    if (!preflight(filename)) {
      new DatabaseSync(filename).close();
      chmodSync(filename, 0o600);
    }
  } catch (error) {
    throw toSqliteError(error);
  }
  const connection = openAdapterUnitOfWork(filename);
  const owner = "schema";
  try {
    const identity = await connection.uow.run(owner, {}, (tx) =>
      connection.port(tx, owner, { write: true }, (db) => {
        const existingKey = classifyStore(db);
        db.exec("PRAGMA secure_delete = ON");
        if (existingKey === null) {
          db.exec(STORAGE_SCHEMA + INITIALIZE_STORE);
          installInspectSchema(db);
          installContextReadSchema(db);
        }
        return existingKey ?? { sessionHashKey: readSessionHashKey(db), legacyRawHashing: false, controls: undefined };
      }));
    return { ...connection, ...identity };
  } catch (error) {
    await connection.close();
    throw error;
  }
}

import { chmodSync, realpathSync, statSync } from "node:fs";
import { basename } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CoreError } from "@cairn-ink/core";
import { toSqliteError } from "../errors.mjs";
import { BOOTSTRAP_FILENAME } from "../migrate/layout.mjs";
import { openSqliteUnitOfWork } from "../uow.mjs";
import { INITIALIZE_STORE, SQLITE_APPLICATION_ID, SQLITE_PHYSICAL_VERSION, STORAGE_SCHEMA } from "./layout.mjs";

/** @typedef {Pick<DatabaseSync, "prepare">} Reader */

const layoutTables = [
  "cairn_store", "cairn_memories", "cairn_receipts", "cairn_suppression_facts",
  "cairn_suppression_epochs", "cairn_legacy_denials", "cairn_pause",
  "cairn_capture_claims", "cairn_capture_outbox", "cairn_capture_abandoned_tokens", "cairn_index_revisions",
  "cairn_raw_messages", "cairn_raw_fences", "cairn_raw_anchors",
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
  if (tables.length !== layoutTables.length + Number(migrated) ||
      !layoutTables.every(name => tables.some(table => table.name === name))) {
    throw new CoreError("storage_error");
  }
  if (migrated) {
    const record = db.prepare("SELECT singleton, checkpoint, attestation FROM cairn_migration LIMIT 2").all();
    if (record.length !== 1 || record[0].singleton !== 1 || record[0].checkpoint !== 3 ||
        typeof record[0].attestation !== "string" || !/^[0-9a-f]{64}$/u.test(record[0].attestation)) {
      throw new CoreError("storage_error");
    }
  }
  return readSessionHashKey(db);
}

/** @param {string} filename */
function preflight(filename) {
  if (typeof filename !== "string" || !filename || filename === ":memory:" ||
      filename.startsWith("file:") || filename.includes("\0")) throw new CoreError("invalid_input");
  if (basename(filename) === BOOTSTRAP_FILENAME) throw new CoreError("storage_error");
  try {
    if (!statSync(filename).isFile()) throw new CoreError("invalid_input");
    if (basename(realpathSync(filename)) === BOOTSTRAP_FILENAME) throw new CoreError("storage_error");
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
  const connection = openSqliteUnitOfWork(filename);
  const owner = "schema";
  try {
    const sessionHashKey = await connection.uow.run(owner, {}, (tx) =>
      connection.port(tx, owner, { write: true }, (db) => {
        const existingKey = classifyStore(db);
        if (existingKey === null) db.exec(STORAGE_SCHEMA + INITIALIZE_STORE);
        db.exec("PRAGMA secure_delete = ON");
        return existingKey ?? readSessionHashKey(db);
      }));
    return { ...connection, sessionHashKey };
  } catch (error) {
    await connection.close();
    throw error;
  }
}

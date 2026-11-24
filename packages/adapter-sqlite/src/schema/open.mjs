import { chmodSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { CoreError } from "@cairn-ink/core";
import { toSqliteError } from "../errors.mjs";
import { openSqliteUnitOfWork } from "../uow.mjs";
import { INITIALIZE_STORE, SQLITE_APPLICATION_ID, SQLITE_PHYSICAL_VERSION, STORAGE_SCHEMA } from "./layout.mjs";

/** @typedef {Pick<DatabaseSync, "prepare">} Reader */

const layoutTables = [
  "cairn_store", "cairn_memories", "cairn_receipts", "cairn_suppression_facts",
  "cairn_suppression_epochs", "cairn_legacy_denials", "cairn_pause",
];

/** @param {Reader} db */
function isFresh(db) {
  const app = db.prepare("PRAGMA application_id").get()?.application_id;
  const version = db.prepare("PRAGMA user_version").get()?.user_version;
  if (app === 0 && version === 0 && !db.prepare("SELECT 1 FROM sqlite_schema LIMIT 1").get()) return true;
  if (app !== SQLITE_APPLICATION_ID || version !== SQLITE_PHYSICAL_VERSION) {
    throw new CoreError("storage_error");
  }
  return false;
}

/** @param {string} filename */
function preflight(filename) {
  if (typeof filename !== "string" || !filename || filename === ":memory:" ||
      filename.startsWith("file:") || filename.includes("\0")) throw new CoreError("invalid_input");
  let exists = true;
  try {
    if (!statSync(filename).isFile()) throw new CoreError("invalid_input");
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error)?.code !== "ENOENT") throw error;
    exists = false;
  }
  // Preflight older and foreign stores read-only before the writer can change
  // journal mode. A new, empty file contains no data until the UoW commits.
  const db = new DatabaseSync(filename, { readOnly: exists });
  try {
    isFresh(db);
  } finally {
    db.close();
  }
  if (!exists) chmodSync(filename, 0o600);
}

/** @param {string} filename */
export async function openStorage(filename) {
  try {
    preflight(filename);
  } catch (error) {
    throw toSqliteError(error);
  }
  const connection = openSqliteUnitOfWork(filename);
  const owner = "schema";
  try {
    const sessionHashKey = await connection.uow.run(owner, {}, (tx) =>
      connection.port(tx, owner, { write: true }, (db) => {
        if (isFresh(db)) db.exec(STORAGE_SCHEMA + INITIALIZE_STORE);
        if (db.prepare("PRAGMA encoding").get()?.encoding !== "UTF-8") throw new CoreError("storage_error");
        db.exec("PRAGMA secure_delete = ON");
        const tables = db.prepare("SELECT name FROM sqlite_schema WHERE type = 'table'").all();
        if (!layoutTables.every(name => tables.some(table => table.name === name))) {
          throw new CoreError("storage_error");
        }
        const identity = db.prepare("SELECT store_id, session_hash_key FROM cairn_store WHERE singleton = 1").get();
        if (typeof identity?.store_id !== "string" || !identity.store_id ||
            typeof identity.session_hash_key !== "string" || !/^[0-9a-f]{64}$/u.test(identity.session_hash_key)) {
          throw new CoreError("storage_error");
        }
        return identity.session_hash_key;
      }));
    return { ...connection, sessionHashKey };
  } catch (error) {
    await connection.close();
    throw error;
  }
}

import { CoreError } from "@cairn-ink/core";
import { BOOTSTRAP_FILENAME } from "./layout.mjs";
import { basename } from "node:path";

/** @param {Pick<import("node:sqlite").DatabaseSync, "prepare">} db */
export function assertMigrationComplete(db) {
  if (!db.prepare("SELECT 1 FROM sqlite_schema WHERE type = 'table' AND name = 'cairn_migration'").get()) return;
  const rows = db.prepare("SELECT singleton, checkpoint, attestation FROM cairn_migration LIMIT 2").all();
  if (rows.length !== 1 || rows[0].singleton !== 1 || rows[0].checkpoint !== 3 ||
      typeof rows[0].attestation !== "string" || !/^[0-9a-f]{64}$/u.test(rows[0].attestation)) {
    throw new CoreError("storage_error");
  }
}

/** @param {string} filename */
export function assertServingFilename(filename) {
  if (basename(filename) === BOOTSTRAP_FILENAME) throw new CoreError("storage_error");
}

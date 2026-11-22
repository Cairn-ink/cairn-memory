import { CoreError } from "../../core/src/index.mjs";

/** @import { SourceRef } from "../../core/src/ports/common.d.ts" */
/** @typedef {Exclude<SourceRef["kind"], "capture">} StoredSourceKind */

/** @param {SourceRef["kind"]} kind @returns {StoredSourceKind} */
export function storedSourceKind(kind) {
  return kind === "capture" ? "plugin" : kind;
}

/** @param {StoredSourceKind} kind @returns {SourceRef["kind"]} */
export function readSourceKind(kind) {
  // Both legacy plugin writes and core captures share the same stored value.
  return kind;
}

/** @param {import("../../core/src/ports/memory-store.d.ts").InsertRow} row */
export function requireEmbedding(row) {
  if (row.embedding === null) throw new CoreError("invalid_input");
  return row.embedding;
}

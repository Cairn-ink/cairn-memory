import { CoreError } from "../../core/src/index.mjs";

/** @param {import("../../core/src/ports/memory-store.d.ts").InsertRow} row */
export function requireEmbedding(row) {
  if (row.embedding === null) throw new CoreError("invalid_input");
  return row.embedding;
}

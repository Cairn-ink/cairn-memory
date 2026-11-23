import { CoreError } from "@cairn-ink/core";

/** @typedef {import("@cairn-ink/core/ports").InsertRow} InsertRow */
/** @typedef {import("@cairn-ink/core/ports").Receipt} Receipt */
/** @typedef {import("@cairn-ink/core/ports").DuplicateMerge} DuplicateMerge */
/** @typedef {import("@cairn-ink/core/ports").DuplicateQuery} DuplicateQuery */

const kinds = ["fact", "preference", "decision", "instruction", "context"];
const origins = ["explicit", "inferred"];
const sources = ["capture", "mcp", "web", "import", "plugin"];
const roles = ["user", "assistant"];

/** @param {unknown} value */
const nonempty = (value) => typeof value === "string" && value.length > 0;
/** @param {unknown} value */
const nullableString = (value) => value === null || typeof value === "string";
/** @param {unknown} value */
const isTextHash = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);

function invalid() {
  throw new CoreError("invalid_input");
}

/** @param {number} nowMs */
export function validateTime(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) invalid();
}

/** @param {DuplicateMerge} merge */
export function validateMerge(merge) {
  if (!merge || !Number.isFinite(merge.confidence) || merge.confidence < 0 || merge.confidence > 1 ||
    (merge.kind !== undefined && !kinds.includes(merge.kind)) ||
    (merge.origin !== undefined && !origins.includes(merge.origin))) invalid();
}

/** @param {import("@cairn-ink/core/ports").SourceRef} source */
export function validateSource(source) {
  if (!source || !sources.includes(source.kind) || !nullableString(source.client) ||
    !nullableString(source.sessionId)) invalid();
}

/** @param {number[] | Float32Array} vector */
function validateVector(vector) {
  if (!(Array.isArray(vector) || vector instanceof Float32Array) || vector.length === 0) invalid();
  for (const component of vector) {
    if (!Number.isFinite(component)) invalid();
  }
}

/** @param {readonly DuplicateQuery[]} batch */
export function validateDuplicateBatch(batch) {
  if (!Array.isArray(batch)) invalid();
  for (const query of batch) {
    if (!query || typeof query !== "object" || !isTextHash(query.textHash) ||
      (query.legacyHash !== undefined && !isTextHash(query.legacyHash))) invalid();
    if (query.embedding !== undefined && query.embedding !== null) validateVector(query.embedding);
  }
}

/** @param {InsertRow} row */
export function copyContent(row) {
  validateMerge(row);
  const { kind, origin, text, textHash, confidence, source, embedding } = row;
  if (!kinds.includes(kind) || !origins.includes(origin) || !nonempty(text) ||
    !isTextHash(textHash)) invalid();
  validateSource(source);

  /** @type {{model: string, vector: number[]} | null} */
  let copy = null;
  if (embedding !== null) {
    if (!embedding || !nonempty(embedding.model)) invalid();
    validateVector(embedding.vector);
    copy = { model: embedding.model, vector: Array.from(embedding.vector) };
  }
  return { kind, origin, text, textHash, confidence,
    source: { kind: source.kind, client: source.client, sessionId: source.sessionId }, embedding: copy };
}

/** @param {readonly Receipt[]} previous @param {readonly Receipt[]} receipts */
export function attachReceipts(previous, receipts) {
  if (!Array.isArray(receipts)) invalid();
  /** @param {Receipt} receipt */
  const key = (receipt) => JSON.stringify([receipt.client, receipt.sessionId, receipt.messageId]);
  const seen = new Set(previous.map(key));
  const result = [...previous];
  for (const receipt of receipts) {
    if (!receipt || !nonempty(receipt.client) || !nonempty(receipt.sessionId) ||
      !nonempty(receipt.messageId) || !roles.includes(receipt.role) ||
      (receipt.occurredAtMs !== null && !Number.isFinite(receipt.occurredAtMs))) invalid();
    const { client, sessionId, messageId, role, occurredAtMs } = receipt;
    const id = key(receipt);
    if (!seen.has(id)) {
      seen.add(id);
      result.push({ client, sessionId, messageId, role, occurredAtMs });
    }
  }
  return result;
}

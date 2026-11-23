import { CoreError, isErrorCode } from "@cairn-ink/core";

/** @typedef {import("@cairn-ink/core/ports").InsertRow} InsertRow */
/** @typedef {import("@cairn-ink/core/ports").Receipt} Receipt */
/** @typedef {import("@cairn-ink/core/ports").DuplicateMerge} DuplicateMerge */
/** @typedef {import("@cairn-ink/core/ports").DuplicateQuery} DuplicateQuery */

const kinds = ["fact", "preference", "decision", "instruction", "context"];
const origins = ["explicit", "inferred"];
const sources = ["capture", "mcp", "web", "import", "plugin"];
const roles = ["user", "assistant"];

// The intrinsic getter reads the typed-array brand across realms and ignores custom tags.
const typedArrayTag = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Float32Array.prototype), Symbol.toStringTag,
)?.get;

/** @param {unknown} value */
const nonempty = (value) => typeof value === "string" && value.length > 0;
/** @param {unknown} value */
const nullableString = (value) => value === null || typeof value === "string";
/** @param {unknown} value */
const isTextHash = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);

function invalid() {
  throw new CoreError("invalid_input");
}

/** @param {import("@cairn-ink/core/ports").CaptureKey} key */
export function copyCaptureKey(key) {
  if (!key || !key.scope || !nonempty(key.scope.owner) || !nullableString(key.scope.namespace ?? null) ||
    !nonempty(key.client) || !nonempty(key.sessionId) || !nonempty(key.eventId) ||
    typeof key.payloadDigest !== "string" || !/^[0-9a-f]{64}$/.test(key.payloadDigest)) invalid();
  const { scope: { owner, namespace }, client, sessionId, eventId, payloadDigest } = key;
  return { scope: { owner, namespace: namespace ?? null }, client, sessionId, eventId, payloadDigest };
}

/** @param {readonly import("@cairn-ink/core/ports").CaptureMessage[]} messages */
export function validateCaptureMessages(messages) {
  if (!Array.isArray(messages)) invalid();
  for (const message of messages) {
    if (!message || typeof message.id !== "string" || message.id.length > 512 || !roles.includes(message.role) ||
      typeof message.content !== "string" ||
      (message.occurredAtMs !== null && !Number.isSafeInteger(message.occurredAtMs))) invalid();
  }
}

/** @param {{code: string, retryable: boolean}} failure */
export function copyCaptureFailure(failure) {
  if (!failure || !isErrorCode(failure.code) || typeof failure.retryable !== "boolean") invalid();
  return { code: failure.code, retryable: failure.retryable };
}

/** @param {readonly import("@cairn-ink/core/ports").FinishItem[]} items */
export function copyFinishItems(items) {
  if (!Array.isArray(items)) invalid();
  return Array.from(items, (item) => {
    if (!item || (item.embedding !== null && !isFloat32Vector(item.embedding?.vector))) invalid();
    const row = copyContent({
      kind: item.kind, origin: "inferred", text: item.content, textHash: item.textHash,
      confidence: item.confidence, source: { kind: "capture", client: null, sessionId: null },
      embedding: item.embedding,
    });
    return { row, receipts: copyReceipts(item.receipts) };
  });
}

/** @param {number} nowMs */
export function validateTime(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) invalid();
}

/** @param {import("@cairn-ink/core/ports").Scope} scope */
export function writeNamespace({ namespace }) {
  if (!nullableString(namespace)) invalid();
  return namespace;
}

/** @param {string} id */
export function validateMemoryId(id) {
  if (typeof id !== "string") invalid();
}

/** @param {DuplicateMerge} merge */
function validateMerge(merge) {
  if (!merge || !Number.isFinite(merge.confidence) || merge.confidence < 0 || merge.confidence > 1 ||
    (merge.kind !== undefined && !kinds.includes(merge.kind)) ||
    (merge.origin !== undefined && !origins.includes(merge.origin))) invalid();
}

/** @param {DuplicateMerge} merge */
export function copyMerge(merge) {
  validateMerge(merge);
  const { confidence, kind, origin } = merge;
  return { confidence, kind, origin };
}

/** @param {import("@cairn-ink/core/ports").SourceRef} source */
export function validateSource(source) {
  if (!source || !sources.includes(source.kind) || !nullableString(source.client) ||
    !nullableString(source.sessionId)) invalid();
}

/** @param {unknown} vector @returns {vector is Float32Array} */
export function isFloat32Vector(vector) {
  return ArrayBuffer.isView(vector) && typedArrayTag?.call(vector) === "Float32Array";
}

/** @param {number[] | Float32Array} vector */
export function validateVector(vector) {
  if (!(Array.isArray(vector) || isFloat32Vector(vector)) || vector.length === 0) invalid();
  for (const component of vector) {
    if (!Number.isFinite(component)) invalid();
  }
}

/** @param {number} limit */
export function validateLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) invalid();
}

/** @param {import("@cairn-ink/core/ports").RetrievalScope} scope */
export function validateReadSet({ namespaces, clients }) {
  if (!Array.isArray(namespaces) || namespaces.length === 0) invalid();
  const seen = new Set();
  for (const namespace of namespaces) {
    if (!nullableString(namespace) || seen.has(namespace)) invalid();
    seen.add(namespace);
  }
  if (clients !== undefined) {
    if (!Array.isArray(clients)) invalid();
    for (const client of clients) {
      if (typeof client !== "string") invalid();
    }
  }
}

/** @param {readonly import("@cairn-ink/core/ports").ItemRef[]} refs */
export function validateRefs(refs) {
  if (!Array.isArray(refs)) invalid();
  for (const ref of refs) {
    if (!ref || typeof ref !== "object" || !["memory", "raw", "card"].includes(ref.type) ||
      typeof ref.id !== "string" || !nullableString(ref.namespace)) invalid();
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

/** @param {readonly Receipt[]} receipts */
export function copyReceipts(receipts) {
  if (!Array.isArray(receipts)) invalid();
  return Array.from(receipts, (receipt) => {
    if (!receipt || !nonempty(receipt.client) || !nonempty(receipt.sessionId) ||
      !nonempty(receipt.messageId) || !roles.includes(receipt.role) ||
      (receipt.occurredAtMs !== null && !Number.isFinite(receipt.occurredAtMs))) invalid();
    const { client, sessionId, messageId, role, occurredAtMs } = receipt;
    return { client, sessionId, messageId, role, occurredAtMs };
  });
}

/** @param {readonly Receipt[]} previous @param {readonly Receipt[]} receipts */
export function attachReceipts(previous, receipts) {
  /** @param {Receipt} receipt */
  const key = (receipt) => JSON.stringify([receipt.client, receipt.sessionId, receipt.messageId]);
  const seen = new Set(previous.map(key));
  const result = [...previous];
  for (const receipt of receipts) {
    const id = key(receipt);
    if (!seen.has(id)) {
      seen.add(id);
      result.push(receipt);
    }
  }
  return result;
}

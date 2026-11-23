import { CoreError, isErrorCode, validateSuppressionFact } from "@cairn-ink/core";

/** @typedef {import("@cairn-ink/core/ports").InsertRow} InsertRow */
/** @typedef {import("@cairn-ink/core/ports").Receipt} Receipt */
/** @typedef {import("@cairn-ink/core/ports").DuplicateMerge} DuplicateMerge */
/** @typedef {import("@cairn-ink/core/ports").DuplicateQuery} DuplicateQuery */
/** @typedef {Omit<DuplicateQuery, "embedding"> & {embedding?: number[] | null}} CanonicalQuery */

const kinds = ["fact", "preference", "decision", "instruction", "context"];
const origins = ["explicit", "inferred"];
const sources = ["capture", "mcp", "web", "import", "plugin"];
const roles = ["user", "assistant"];

const typedArrayPrototype = Object.getPrototypeOf(Float32Array.prototype);
const typedArrayTag = Object.getOwnPropertyDescriptor(typedArrayPrototype, Symbol.toStringTag)?.get;
const typedArrayBuffer = Object.getOwnPropertyDescriptor(typedArrayPrototype, "buffer")?.get;
const typedArrayOffset = Object.getOwnPropertyDescriptor(typedArrayPrototype, "byteOffset")?.get;
const typedArrayLength = Object.getOwnPropertyDescriptor(typedArrayPrototype, "length")?.get;

/** @param {unknown} value */
const nonempty = (value) => typeof value === "string" && value.length > 0;
/** @param {unknown} value */
const nullableString = (value) => value === null || typeof value === "string";
/** @param {unknown} value */
const isTextHash = (value) => typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);

/** @returns {never} */
function invalid() {
  throw new CoreError("invalid_input");
}

/** @param {import("@cairn-ink/core/ports").CaptureKey} key @param {string | undefined} owner
 * @param {string | null | undefined} namespace
 */
export function copyCaptureKey(key, owner, namespace) {
  if (!key) invalid();
  const { client, sessionId, eventId, payloadDigest } = key;
  if (typeof owner !== "string" || owner.length === 0 || !nullableString(namespace ?? null) || !nonempty(client) ||
      !nonempty(sessionId) || !nonempty(eventId) || typeof payloadDigest !== "string" ||
      !/^[0-9a-f]{64}$/.test(payloadDigest)) invalid();
  return { scope: { owner, namespace: namespace ?? null }, client, sessionId, eventId, payloadDigest };
}

/** Read indexed data once and ignore caller-provided traversal methods.
 * @template T @param {readonly T[]} values
 * @param {{strictKeys?: boolean, allowEntries?: boolean, maxLength?: number}} [options] @returns {T[]}
 */
export function snapshotArray(values, { strictKeys = false, allowEntries = false, maxLength = 0xffff_ffff } = {}) {
  const snapshot = [];
  try {
    if (!Array.isArray(values)) invalid();
    const descriptor = Object.getOwnPropertyDescriptor(values, "length");
    if (!descriptor || !Object.hasOwn(descriptor, "value")) invalid();
    const length = descriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || length > maxLength ||
        !Object.is(length, Reflect.get(values, "length"))) invalid();
    const keys = new Set(Reflect.ownKeys(values));
    // Existing callers may supply traversal overrides. These properties are never read.
    for (const method of [!strictKeys ? Symbol.iterator : undefined, allowEntries ? "entries" : undefined]) {
      if (method !== undefined && keys.delete(method) && !Object.getOwnPropertyDescriptor(values, method)) invalid();
    }
    if (!keys.delete("length") || keys.size !== length) invalid();
    for (let index = 0; index < length; index++) {
      const key = String(index);
      if (!keys.has(key) || !(key in values)) invalid();
      const slot = Object.getOwnPropertyDescriptor(values, key);
      // The property read only checks for conflicting proxy traps.
      if (!slot || !Object.hasOwn(slot, "value") ||
          !Object.is(slot.value, Reflect.get(values, key)) || (strictKeys && !slot.enumerable)) invalid();
      snapshot.push(slot.value);
    }
  } catch {
    invalid();
  }
  return snapshot;
}

/** @param {import("@cairn-ink/core").TextDigest[] | undefined} digests */
function copyDigests(digests) {
  if (digests === undefined) return undefined;
  try {
    const copy = snapshotArray(digests).map((digest) => {
      if (!digest || typeof digest !== "object" || Array.isArray(digest)) invalid();
      /** @param {keyof typeof digest} key */
      const field = (key) => Object.getOwnPropertyDescriptor(digest, key)?.value;
      return {
        alg: field("alg"), value: field("value"), pipeline: field("pipeline"),
        redactionVersion: field("redactionVersion"), keyId: field("keyId"),
      };
    });
    validateSuppressionFact({
      kind: "text", mode: "exact", origin: "forget", owner: "validation", actionId: "validation",
      text: { digests: copy },
    });
    return copy;
  } catch {
    invalid();
  }
}

/** @param {readonly import("@cairn-ink/core/ports").CaptureMessage[]} messages */
export function captureMessageTimes(messages) {
  /** @type {Array<number | null>} */
  const times = [];
  for (const message of snapshotArray(messages)) {
    if (!message || typeof message.id !== "string" || message.id.length > 512 || !roles.includes(message.role) ||
      typeof message.content !== "string") invalid();
    const { occurredAtMs } = message;
    if (occurredAtMs !== null && !Number.isSafeInteger(occurredAtMs)) invalid();
    times.push(occurredAtMs);
  }
  return times;
}

/** @param {{code: string, retryable: boolean}} failure */
export function copyCaptureFailure(failure) {
  if (!failure || !isErrorCode(failure.code) || typeof failure.retryable !== "boolean") invalid();
  return { code: failure.code, retryable: failure.retryable };
}

/** @param {readonly import("@cairn-ink/core/ports").FinishItem[]} items @param {boolean} embeddingRequiredOnInsert */
export function copyFinishItems(items, embeddingRequiredOnInsert) {
  return snapshotArray(items).map((item) => {
    if (!item) invalid();
    const row = copyContent({
      kind: item.kind, origin: "inferred", text: item.content, textHash: item.textHash,
      confidence: item.confidence, source: { kind: "capture", client: null, sessionId: null },
      embedding: item.embedding, digests: item.digests,
    }, "capture", embeddingRequiredOnInsert);
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

/**
 * Capture the values once, with the input shapes accepted by each port.
 * @param {unknown} vector
 * @param {"memory" | "capture" | "passage" | "fact"} [format]
 * @returns {number[]}
 */
export function readEmbedding(vector, format = "memory") {
  /** @type {number[]} */
  let values = [];
  try {
    if (Array.isArray(vector) && format !== "capture") {
      values = snapshotArray(vector);
      if (!values.every(Number.isFinite)) invalid();
    } else {
      const tag = typedArrayTag?.call(vector);
      if (format === "fact" || (tag !== "Float32Array" && !(format === "passage" && tag === "Float64Array"))) invalid();
      const View = tag === "Float64Array" ? Float64Array : Float32Array;
      const length = typedArrayLength?.call(vector);
      const view = new View(typedArrayBuffer?.call(vector), typedArrayOffset?.call(vector), length);
      for (let index = 0; index < length; index++) {
        const value = view[index];
        if (!Number.isFinite(value)) invalid();
        values.push(value);
      }
    }
  } catch {
    invalid();
  }
  if (values.length === 0 && format !== "fact" && !(format === "passage" && Array.isArray(vector))) invalid();
  return values;
}

/** @param {number} limit */
export function validateLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1) invalid();
}

/** @param {string} owner @param {Omit<import("@cairn-ink/core/ports").RetrievalScope, "owner">} scope */
export function copyReadScope(owner, { namespaces, clients }) {
  const namespaceList = snapshotArray(namespaces);
  if (namespaceList.length === 0) invalid();
  const seen = new Set();
  for (const namespace of namespaceList) {
    if (!nullableString(namespace) || seen.has(namespace)) invalid();
    seen.add(namespace);
  }
  const clientList = clients === undefined ? undefined : snapshotArray(clients);
  if (clientList?.some((client) => typeof client !== "string")) invalid();
  return { owner, namespaces: namespaceList, clients: clientList };
}

/** @param {readonly import("@cairn-ink/core/ports").ItemRef[]} refs */
export function copyRefs(refs) {
  return snapshotArray(refs).map((ref) => {
    if (!ref || typeof ref !== "object") invalid();
    const { type, id, namespace } = ref;
    if (!["memory", "raw", "card"].includes(type) || typeof id !== "string" || !nullableString(namespace)) invalid();
    return { type, id, namespace };
  });
}

/** @param {readonly DuplicateQuery[]} batch @returns {CanonicalQuery[]} */
export function copyDuplicateBatch(batch) {
  return snapshotArray(batch).map((query) => {
    if (!query || typeof query !== "object") invalid();
    const { textHash, legacyHash, embedding, digests } = query;
    if (!isTextHash(textHash) || (legacyHash !== undefined && !isTextHash(legacyHash))) invalid();
    return { textHash, legacyHash, digests: copyDigests(digests),
      embedding: embedding == null ? embedding : readEmbedding(embedding) };
  });
}

/** @param {InsertRow} row @param {"memory" | "capture"} format @param {boolean} embeddingRequiredOnInsert */
export function copyContent(row, format, embeddingRequiredOnInsert) {
  validateMerge(row);
  const { kind, origin, text, textHash, confidence, source, embedding, digests } = row;
  if (embeddingRequiredOnInsert && embedding === null) invalid();
  if (!kinds.includes(kind) || !origins.includes(origin) || !nonempty(text) ||
    !isTextHash(textHash)) invalid();
  validateSource(source);

  /** @type {{model: string, vector: number[]} | null} */
  let copy = null;
  if (embedding !== null) {
    if (!embedding) invalid();
    const { model, vector } = embedding;
    if (!nonempty(model)) invalid();
    copy = { model, vector: readEmbedding(vector, format) };
  }
  return { kind, origin, text, textHash, confidence, digests: copyDigests(digests),
    source: { kind: source.kind, client: source.client, sessionId: source.sessionId }, embedding: copy };
}

/** @param {readonly Receipt[]} receipts */
export function copyReceipts(receipts) {
  return snapshotArray(receipts).map((receipt) => {
    if (!receipt) invalid();
    const { client, sessionId, messageId, role, occurredAtMs } = receipt;
    if (!nonempty(client) || !nonempty(sessionId) || !nonempty(messageId) || !roles.includes(role) ||
      (occurredAtMs !== null && !Number.isFinite(occurredAtMs))) invalid();
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

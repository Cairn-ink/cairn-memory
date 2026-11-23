import { CoreError, validateSuppressionFact } from "../../core/src/index.mjs";
import { requireEmbedding, storedSourceKind } from "./memory-metadata.mjs";
import { requireLiveRun } from "./uow.mjs";

/** @import { DuplicateMerge, DuplicateQuery, InsertRow, ItemRef, Receipt, RetrievalScope, SourceRef, Tx } from "../../core/src/ports/index.d.ts" */

const KINDS = ["fact", "preference", "decision", "instruction", "context"];
const ORIGINS = ["explicit", "inferred"];
const SOURCES = ["capture", "mcp", "web", "import", "plugin"];
const ROLES = ["user", "assistant"];
const UNPAIRED_SURROGATE = /[\uD800-\uDFFF]/u;
const HASH = /^sha256:[0-9a-f]{64}$/u;

/** @returns {never} */
export function invalid() {
  throw new CoreError("invalid_input");
}

/** @param {Tx} tx @param {{owner: string}} scope @param {boolean} [write] */
export function guardOwner(tx, scope, write) {
  requireLiveRun(tx, write);
  if (scope?.owner !== tx.owner) throw new CoreError("internal_error");
}

/** @param {unknown} value @returns {value is string} */
export function pgText(value) {
  return typeof value === "string" && !value.includes("\0") && !UNPAIRED_SURROGATE.test(value);
}

/** @param {unknown} value @returns {string} */
export function inputText(value) {
  if (!pgText(value)) invalid();
  return value;
}

/** @param {unknown} namespace @param {boolean} [allowNonNull] @returns {string | null} */
export function namespaceKey(namespace, allowNonNull = true) {
  if (namespace === null) return null;
  if (!allowNonNull || typeof namespace !== "string" || UNPAIRED_SURROGATE.test(namespace)) invalid();
  // JSON encoding keeps the NUL separator of engine namespaces out of PostgreSQL text.
  return JSON.stringify(namespace);
}

/** @template T @param {readonly T[]} input @returns {T[]} */
export function copyArray(input) {
  if (!Array.isArray(input)) invalid();
  const result = [];
  const length = input.length;
  for (let i = 0; i < length; i++) {
    const item = Object.getOwnPropertyDescriptor(input, i);
    if (!item || !Object.hasOwn(item, "value")) invalid();
    result.push(item.value);
  }
  return result;
}

/** @param {number} ms */
export function writeTime(ms) {
  if (!Number.isSafeInteger(ms) || ms < 0) invalid();
  return BigInt(ms) * 1000n;
}

/** @param {SourceRef} source */
export function copySource(source) {
  if (!source) invalid();
  const { kind, client, sessionId } = source;
  if (!SOURCES.includes(kind)) invalid();
  return {
    kind: storedSourceKind(kind),
    client: client === null ? null : inputText(client),
    sessionId: sessionId === null ? null : inputText(sessionId),
  };
}

/** @param {DuplicateMerge} merge */
export function copyMerge(merge) {
  if (!merge) invalid();
  const { confidence, kind, origin } = merge;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1 ||
      (kind !== undefined && !KINDS.includes(kind)) ||
      (origin !== undefined && !ORIGINS.includes(origin))) invalid();
  return { confidence, kind, origin };
}

/** @param {DuplicateQuery["digests"]} digests */
function copyDigests(digests) {
  if (digests === undefined) return undefined;
  const copy = copyArray(digests).map((digest) => {
    if (!digest) invalid();
    const { alg, value, pipeline, redactionVersion, keyId } = digest;
    if (keyId !== null) inputText(keyId);
    return { alg, value, pipeline, redactionVersion, keyId };
  });
  validateSuppressionFact({
    kind: "text", mode: "exact", origin: "forget", owner: "validation", actionId: "validation",
    text: { digests: copy },
  });
  return copy;
}

/** @param {number[] | Float32Array} input */
function copyVector(input) {
  if (!Array.isArray(input) && !(input instanceof Float32Array)) invalid();
  const values = Array.isArray(input) ? copyArray(input) : Array.from(input);
  if (values.length === 0 || !values.every(Number.isFinite)) invalid();
  return values;
}

/** @param {InsertRow} row */
export function copyContent(row) {
  const { confidence, kind, origin } = copyMerge(row);
  const { text, textHash, source, digests } = row;
  if (kind === undefined || origin === undefined || !inputText(text) ||
      typeof textHash !== "string" || !HASH.test(textHash)) invalid();
  const embedding = requireEmbedding(row);
  if (!embedding) invalid();
  const { model, vector } = embedding;
  const values = copyVector(vector).map(Math.fround);
  if (!inputText(model) || values.length !== 1536 || !values.every(Number.isFinite)) invalid();
  return { kind, origin, confidence, text, textHash, digests: copyDigests(digests),
    source: copySource(source), model, vector: JSON.stringify(values) };
}

/** @param {readonly DuplicateQuery[]} batch */
export function copyQueries(batch) {
  return copyArray(batch).map((entry) => {
    if (!entry) invalid();
    const { textHash, legacyHash, digests, embedding } = entry;
    if (typeof textHash !== "string" || !HASH.test(textHash) ||
        (legacyHash !== undefined && (typeof legacyHash !== "string" || !HASH.test(legacyHash)))) invalid();
    return { textHash, legacyHash, digests: copyDigests(digests),
      embedding: embedding == null ? embedding : copyVector(embedding) };
  });
}

/** @param {readonly Receipt[]} receipts */
export function copyReceipts(receipts) {
  return copyArray(receipts).map((receipt) => {
    if (!receipt) invalid();
    const { client, sessionId, messageId, role, occurredAtMs } = receipt;
    if (!inputText(client) || !inputText(sessionId) || !inputText(messageId) || !ROLES.includes(role) ||
        (occurredAtMs !== null && !Number.isFinite(occurredAtMs))) invalid();
    return { client, sessionId, messageId, role, occurredAtMs };
  });
}

/** @param {string} owner @param {Omit<RetrievalScope, "owner">} scope */
export function copyReadScope(owner, { namespaces, clients, window }) {
  const keys = copyArray(namespaces).map(namespace => namespaceKey(namespace));
  if (keys.length === 0 || new Set(keys).size !== keys.length) invalid();
  const clientList = clients === undefined ? null : copyArray(clients).map(inputText);
  let since = null;
  let until = null;
  if (window !== undefined) {
    if (!window || typeof window !== "object" || Array.isArray(window)) invalid();
    const { sinceMs, untilMs } = window;
    if ((sinceMs !== undefined && (!Number.isSafeInteger(sinceMs) || sinceMs < 0)) ||
        (untilMs !== undefined && (!Number.isSafeInteger(untilMs) || untilMs < 0)) ||
        (sinceMs !== undefined && untilMs !== undefined && sinceMs >= untilMs)) invalid();
    since = sinceMs ?? null;
    until = untilMs ?? null;
  }
  return { owner, keys, clients: clientList, since, until, hasWindow: window !== undefined };
}

/** @param {readonly ItemRef[]} refs */
export function copyRefs(refs) {
  return copyArray(refs).map((ref) => {
    if (!ref) invalid();
    const { id, type, namespace } = ref;
    if (type !== "memory" && type !== "raw" && type !== "card") invalid();
    return { ref: { id: inputText(id), type, namespace }, key: namespaceKey(namespace) };
  });
}

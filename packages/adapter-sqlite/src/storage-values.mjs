import { createHash } from "node:crypto";
import {
  boundedText, cleanContent, CoreError, normalizeForHash, prepareCoreText,
  PRIVACY_REDACTION_VERSIONS, redactV1, validateSuppressionFact,
} from "@cairn-ink/core";

/** @import { TextDigest } from "@cairn-ink/core" */
/** @import { DuplicateMerge, DuplicateQuery, InsertRow, Receipt, Scope, SourceRef } from "@cairn-ink/core/ports" */
/** @typedef {ReturnType<typeof import("./uow.mjs").openSqliteUnitOfWork>["port"]} Port */
/** @typedef {Parameters<Parameters<Port>[3]>[0]} Connection */

const kinds = ["fact", "preference", "decision", "instruction", "context"];
const origins = ["explicit", "inferred"];
const sources = ["capture", "mcp", "web", "import", "plugin"];

/** @returns {never} */
export function invalidInput() {
  throw new CoreError("invalid_input");
}

/** @param {string} owner */
export function ownerKey(owner) {
  // Reject ill-formed Unicode before SQLite can coalesce it with a literal U+FFFD.
  if (typeof owner !== "string" || !owner || /[\uD800-\uDFFF]/u.test(owner)) invalidInput();
  return owner;
}

/** @param {Scope} scope */
export function scopeKey({ owner, namespace }) {
  if (namespace !== null && (typeof namespace !== "string" || !namespace)) invalidInput();
  // The port's namespace tuple contains NUL. JSON keeps the bytes intact on
  // both Node versions and distinguishes null from every string.
  return /** @type {const} */ ([ownerKey(owner), JSON.stringify(namespace)]);
}

/** @param {unknown} value */
const nonempty = value => typeof value === "string" && value.length > 0;
/** @param {unknown} value */
const textHash = value => typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);

/** @param {string} value */
export const sha256 = value => createHash("sha256").update(value).digest("hex");

/** @param {string} id */
export function validateId(id) {
  if (!nonempty(id) || /[\u0000\uD800-\uDFFF]/u.test(id)) invalidInput();
}

/** @param {number} nowMs */
export function writeTime(nowMs) {
  if (!Number.isSafeInteger(nowMs) || nowMs < 0) invalidInput();
  return { updatedAtMs: nowMs, updatedAtUs: BigInt(nowMs) * 1000n };
}

/** @param {SourceRef} source */
export function validateSource(source) {
  if (!source || !sources.includes(source.kind) ||
      (source.client !== null && typeof source.client !== "string") ||
      (source.sessionId !== null && typeof source.sessionId !== "string")) invalidInput();
}

/** @param {DuplicateMerge} merge */
export function validateMerge(merge) {
  if (!merge || !Number.isFinite(merge.confidence) || merge.confidence < 0 || merge.confidence > 1 ||
      (merge.kind !== undefined && !kinds.includes(merge.kind)) ||
      (merge.origin !== undefined && !origins.includes(merge.origin))) invalidInput();
}

/** @param {number[] | Float32Array} vector */
function copyVector(vector) {
  if (!Array.isArray(vector) && !(vector instanceof Float32Array)) invalidInput();
  const copy = Array.from(vector);
  if (!copy.length || !copy.every(Number.isFinite)) invalidInput();
  return copy;
}

/** @param {readonly TextDigest[]} digests */
function copyDigests(digests) {
  if (!Array.isArray(digests)) invalidInput();
  const copy = Array.from(digests, ({ alg, value, pipeline, redactionVersion, keyId }) =>
    ({ alg, value, pipeline, redactionVersion, keyId }));
  validateSuppressionFact({
    owner: "validation", actionId: "validation", origin: "import", kind: "text", mode: "exact",
    text: { digests: copy },
  });
  return copy;
}

/** @param {string} hash @param {TextDigest["pipeline"]} pipeline @returns {TextDigest} */
function alias(hash, pipeline) {
  return {
    alg: "sha256", value: hash.slice(7), pipeline, keyId: null,
    redactionVersion: pipeline === "core" ? PRIVACY_REDACTION_VERSIONS.core : PRIVACY_REDACTION_VERSIONS.v1,
  };
}

/** @param {TextDigest[]} digests @param {TextDigest} digest */
function addDigest(digests, digest) {
  if (!digests.some(({ alg, value }) => alg === digest.alg && value === digest.value)) digests.push(digest);
}

/** @param {Pick<DuplicateQuery, "textHash" | "legacyHash" | "digests">} query */
export function digestAliases({ textHash, legacyHash, digests }) {
  const result = [alias(textHash, "core")];
  if (legacyHash) addDigest(result, alias(legacyHash, "engine-legacy"));
  for (const digest of digests ?? []) addDigest(result, digest);
  return result;
}

/** @param {InsertRow} row */
export function encodeContent(row) {
  validateMerge(row);
  const { kind, origin, text, textHash: hash, source, confidence, embedding } = row;
  if (!kinds.includes(kind) || !origins.includes(origin) || !nonempty(text) || !textHash(hash)) invalidInput();
  validateSource(source);
  if (embedding !== null && (!embedding || !nonempty(embedding.model))) invalidInput();
  const provided = row.digests === undefined ? undefined : copyDigests(row.digests);
  let legacy = provided?.find(digest => digest.alg === "sha256" && digest.pipeline === "engine-legacy")?.value;
  if (!legacy) {
    // Core's engineLegacyDigest uses boundedText + lowercase; WebCrypto's async
    // digest cannot run inside the SQLite transaction.
    try {
      legacy = sha256(boundedText(text, 4_000).toLowerCase());
    } catch (error) {
      if (!(error instanceof CoreError) || error.code !== "invalid_text") throw error;
    }
  }
  const legacyHash = legacy ? "sha256:" + legacy : undefined;
  const digests = provided ?? [alias("sha256:" + sha256(normalizeForHash(prepareCoreText(text))), "core")];
  if (!provided) addDigest(digests, alias("sha256:" + sha256(normalizeForHash(redactV1(cleanContent(text)))), "hosted-v1"));
  const body = {
    kind, origin, text, confidence, source: { kind: source.kind, client: source.client, sessionId: source.sessionId },
    digests: digestAliases({ textHash: hash, legacyHash, digests }),
    embedding: embedding && { model: embedding.model, vector: copyVector(embedding.vector) },
  };
  return { body, textHash: hash, legacyHash: legacyHash ?? null };
}

/** @param {readonly DuplicateQuery[]} batch */
export function validateBatch(batch) {
  if (!Array.isArray(batch)) invalidInput();
  return Array.from(batch, ({ textHash: hash, legacyHash, embedding, digests }) => {
    if (!textHash(hash) || (legacyHash !== undefined && !textHash(legacyHash))) invalidInput();
    return {
      textHash: hash, legacyHash, embedding: embedding == null ? embedding : copyVector(embedding),
      digests: digests === undefined ? undefined : copyDigests(digests),
    };
  });
}

/** @param {readonly Receipt[]} receipts */
export function copyReceipts(receipts) {
  if (!Array.isArray(receipts)) invalidInput();
  return Array.from(receipts, ({ client, sessionId, messageId, role, occurredAtMs }) => {
    if (!nonempty(client) || !nonempty(sessionId) || !nonempty(messageId) || !["user", "assistant"].includes(role) ||
        (occurredAtMs !== null && !Number.isFinite(occurredAtMs))) invalidInput();
    return { client, sessionId, messageId, role, occurredAtMs };
  });
}

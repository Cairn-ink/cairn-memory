// Contract: every stored value (slot, slot hash, body, lookup columns, digest
// rows) is derived only from a snapshot that is itself validated. The snapshot is
// a fresh graph of plain objects and arrays built by one pass over the caller's
// fact; each field and array length comes from one property-descriptor lookup
// (never a get). An input object reached twice yields two independent copies,
// both validated, so what is stored is always exactly what was validated. The
// snapshot keeps no state between calls.
import { CoreError, compareUtf8, factBody, validateSuppressionFact } from "../../core/src/index.mjs";

/** @import { SuppressionFact, TextDigest } from "../../core/src/suppression-fact.mjs" */

const encoder = new TextEncoder();
const MAX_FLOAT4 = 3.4028234663852886e38;

/** @typedef {(value: unknown) => unknown} SnapshotField */

/** @returns {never} */
function invalidInput() {
  throw new CoreError("invalid_input");
}

/** @type {SnapshotField} */
function copyString(value) {
  if (typeof value !== "string") invalidInput();
  return value;
}

/** @type {SnapshotField} */
function copyNumber(value) {
  if (typeof value !== "number") invalidInput();
  return value;
}

/** @param {SnapshotField} copy @returns {SnapshotField} */
function optional(copy) {
  return (value) => value === undefined ? undefined : copy(value);
}

/** @param {SnapshotField} copy @returns {SnapshotField} */
function nullable(copy) {
  return (value) => value === null ? null : copy(value);
}

/** @param {unknown} value @returns {asserts value is object} */
function assertPlainObject(value) {
  if (value === null || typeof value !== "object") invalidInput();
  const prototype = Object.getPrototypeOf(value);
  if (Array.isArray(value) || (prototype !== null && prototype !== Object.prototype)) invalidInput();
}

/** @param {object} value @param {string} key @returns {unknown} */
function readField(value, key) {
  const field = Object.getOwnPropertyDescriptor(value, key);
  if (!field?.enumerable || !Object.hasOwn(field, "value")) invalidInput();
  // One reflective read per field: the descriptor's value is the value we keep.
  return field.value;
}

/**
 * @param {object} value
 * @param {Record<string, SnapshotField>} fields
 * @param {Record<string, unknown>} snapshot
 */
function copyFields(value, fields, snapshot) {
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => !Object.hasOwn(fields, key))) invalidInput();
  for (const key of keys) {
    if (typeof key === "string" && !Object.hasOwn(snapshot, key)) {
      snapshot[key] = fields[key](readField(value, key));
    }
  }
  return snapshot;
}

/** @param {unknown} value @param {Record<string, SnapshotField>} fields */
function copyObject(value, fields) {
  assertPlainObject(value);
  return copyFields(value, fields, Object.create(null));
}

/** @param {SnapshotField} copy @returns {SnapshotField} */
function arrayOf(copy) {
  return (value) => {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalidInput();
    const lengthField = Object.getOwnPropertyDescriptor(value, "length");
    if (!lengthField || !Object.hasOwn(lengthField, "value")) invalidInput();
    const length = lengthField.value;
    const keys = new Set(Reflect.ownKeys(value));
    if (!Number.isSafeInteger(length) || length < 0 || keys.size !== length + 1) invalidInput();
    const snapshot = [];
    for (let i = 0; i < length; i++) {
      const key = String(i);
      if (!keys.has(key)) invalidInput();
      const element = Object.getOwnPropertyDescriptor(value, key);
      if (!element || !Object.hasOwn(element, "value")) invalidInput();
      snapshot.push(copy(element.value));
    }
    return snapshot;
  };
}

const digestFields = {
  alg: copyString,
  value: copyString,
  pipeline: copyString,
  redactionVersion: copyNumber,
  keyId: nullable(copyString),
};
const textFields = {
  digests: arrayOf((value) => copyObject(value, digestFields)),
  shingles: optional(nullable(arrayOf(copyString))),
  embedding: optional(nullable(arrayOf(copyNumber))),
  keyId: optional(nullable(copyString)),
};
const sourceMemoryFields = { id: copyString, createdAtMs: copyNumber };
const sessionFields = {
  client: copyString,
  // Core requires exactly one of these own fields.
  sessionId: copyString,
  sessionKeyHash: copyString,
};
const windowFields = { startMs: copyNumber, endMs: copyNumber };
const baseFields = {
  kind: copyString,
  owner: copyString,
  namespace: optional(nullable(copyString)),
  actionId: copyString,
  origin: copyString,
};
const factFields = {
  identity: { ...baseFields, memoryId: copyString, throughRevision: optional(copyNumber) },
  text: {
    ...baseFields, mode: copyString,
    text: (/** @type {unknown} */ value) => copyObject(value, textFields),
    sourceMemory: optional(nullable((value) => copyObject(value, sourceMemoryFields))),
  },
  session: {
    ...baseFields,
    session: (/** @type {unknown} */ value) => copyObject(value, sessionFields),
  },
  window: {
    ...baseFields, client: nullable(copyString),
    window: (/** @type {unknown} */ value) => copyObject(value, windowFields),
    unknownTime: optional((value) => {
      if (value !== true) invalidInput();
      return value;
    }),
    anchor: optional(copyString),
  },
  rawSpan: {
    ...baseFields, sessionKeyHash: copyString, messageKey: copyString,
    startUtf16: copyNumber, endUtf16: copyNumber, contentDigest: copyString,
  },
};

/** @param {unknown} fact */
function snapshotFact(fact) {
  try {
    assertPlainObject(fact);
    const kind = readField(fact, "kind");
    if (typeof kind !== "string" || !Object.hasOwn(factFields, kind)) invalidInput();
    const snapshot = Object.create(null);
    snapshot.kind = kind;
    return copyFields(fact, factFields[/** @type {keyof typeof factFields} */ (kind)], snapshot);
  } catch {
    // Reflection on a revoked proxy or a throwing trap is invalid input too.
    invalidInput();
  }
}

/** @param {readonly TextDigest[]} digests */
export function canonicalDigests(digests) {
  return [...digests].sort((a, b) => (
    compareUtf8(a.alg, b.alg) || compareUtf8(a.value, b.value)
  ));
}

/**
 * The slot is the canonical JSON array [namespace ?? null, ...target]. The target is
 * the same in every store; pipeline, redactionVersion and keyId are not part of it.
 * @param {SuppressionFact} fact The validated snapshot.
 */
function encodeSlot(fact) {
  return JSON.stringify([fact.namespace ?? null, ...slotTarget(fact)]);
}

/** @param {SuppressionFact} fact The validated snapshot. @returns {unknown[]} */
function slotTarget(fact) {
  switch (fact.kind) {
    case "identity":
      return ["identity", fact.memoryId, fact.throughRevision ?? null];
    case "text": {
      const target = canonicalDigests(fact.text.digests).map(({ alg, value }) => [alg, value]);
      return ["text", fact.mode, target, fact.sourceMemory?.id ?? null];
    }
    case "session": {
      const { session } = fact;
      return "sessionId" in session
        ? ["session", session.client, "id", session.sessionId]
        : ["session", session.client, "hash", session.sessionKeyHash];
    }
    case "window":
      return [
        "window", fact.client, fact.window.startMs, fact.window.endMs, fact.unknownTime === true, fact.anchor ?? null,
      ];
    case "rawSpan":
      return ["rawSpan", fact.sessionKeyHash, fact.messageKey, fact.startUtf16, fact.endUtf16];
  }
}

/** @param {unknown} value A value in the snapshot. */
function assertStorableValues(value) {
  // Unicode mode matches surrogate code units only when they are unpaired.
  if (typeof value === "string" && /[\u0000\uD800-\uDFFF]/u.test(value)) invalidInput();
  if (typeof value === "number" && !Number.isFinite(value)) invalidInput();
  if (value !== null && typeof value === "object") {
    for (const field of Object.values(value)) assertStorableValues(field);
  }
}

/** @param {SuppressionFact} fact The snapshot already checked by core. */
function assertStorableFact(fact) {
  assertStorableValues(fact);
  if (fact.kind === "text") {
    const { digests, embedding, shingles, keyId } = fact.text;
    if (digests.some(({ redactionVersion }) => redactionVersion > 2147483647)) invalidInput();
    if (fact.mode === "full") {
      if (embedding != null && (embedding.length !== 1536 || embedding.some((x) => Math.abs(x) > MAX_FLOAT4))) {
        invalidInput();
      }
      if (shingles?.length && !keyId) invalidInput();
    }
  }
  const slot = encodeSlot(fact);
  if (encoder.encode(slot).byteLength > 8192) invalidInput();
  return slot;
}

/** @param {unknown} candidate */
function prepareFact(candidate) {
  const fact = validateSuppressionFact(snapshotFact(candidate));
  return { fact, slot: assertStorableFact(fact) };
}

/** @param {SuppressionFact} fact */
export function factSlot(fact) {
  return prepareFact(fact).slot;
}

/** @param {unknown} candidate */
export async function buildFactStorage(candidate) {
  const { fact, slot } = prepareFact(candidate);
  const mode = fact.kind === "text" ? fact.mode : null;
  const lookup = fact.kind === "text" && mode === "full" ? fact.text : null;
  return {
    fact,
    owner: fact.owner,
    actionId: fact.actionId,
    origin: fact.origin,
    kind: fact.kind,
    mode,
    slot,
    slotHash: await slotHash(slot),
    body: factBody(fact),
    embedding: lookup?.embedding == null ? null : JSON.stringify(lookup.embedding),
    shingles: lookup?.shingles?.length ? lookup.shingles : null,
    keyId: lookup?.keyId ?? null,
    digests: fact.kind === "text" ? fact.text.digests : [],
  };
}

/** @param {string} slot */
export async function slotHash(slot) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(slot));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Snapshot the caller's fact once, validate that snapshot, and derive every
// storage value from it. Never read the caller's fact again after snapshotting.
// Each field is read through one property-descriptor lookup, and an object or
// array reached twice within one fact is refused, so no input can show the
// snapshot two different values.
import { CoreError, compareUtf8, factBody, validateSuppressionFact } from "../../core/src/index.mjs";

/** @import { SuppressionFact, TextDigest } from "../../core/src/suppression-fact.mjs" */

const encoder = new TextEncoder();
const MAX_FLOAT4 = 3.4028234663852886e38;

/** @typedef {(value: unknown) => unknown} SnapshotField */

/** Objects already copied by the snapshot in progress; an object reached twice is refused. */
/** @type {WeakSet<object> | null} */
let snapshotSeen = null;

/** @param {object} value */
function claimOnce(value) {
  if (snapshotSeen === null || snapshotSeen.has(value)) invalidInput();
  snapshotSeen.add(value);
}

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
  claimOnce(value);
  return copyFields(value, fields, Object.create(null));
}

/** @param {SnapshotField} copy @returns {SnapshotField} */
function arrayOf(copy) {
  return (value) => {
    if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) invalidInput();
    claimOnce(value);
    const length = value.length;
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
  snapshotSeen = new WeakSet();
  try {
    assertPlainObject(fact);
    claimOnce(fact);
    const kind = readField(fact, "kind");
    if (typeof kind !== "string" || !Object.hasOwn(factFields, kind)) invalidInput();
    const snapshot = Object.create(null);
    snapshot.kind = kind;
    return copyFields(fact, factFields[/** @type {keyof typeof factFields} */ (kind)], snapshot);
  } catch {
    // Reflection on a revoked proxy or a throwing trap is invalid input too.
    invalidInput();
  } finally {
    snapshotSeen = null;
  }
}

/** @param {readonly TextDigest[]} digests */
export function canonicalDigests(digests) {
  return [...digests].sort((a, b) => (
    compareUtf8(a.pipeline, b.pipeline) || compareUtf8(a.alg, b.alg) || compareUtf8(a.value, b.value)
  ));
}

/** @param {SuppressionFact} fact The validated snapshot. */
function encodeSlot(fact) {
  switch (fact.kind) {
    case "identity":
      return JSON.stringify(["identity", fact.memoryId, fact.throughRevision ?? null]);
    case "text": {
      const target = canonicalDigests(fact.text.digests).map(({ alg, value }) => [alg, value]);
      return JSON.stringify(["text", fact.mode, target]);
    }
    case "session": {
      const { session } = fact;
      return JSON.stringify("sessionId" in session
        ? ["session", session.client, "id", session.sessionId]
        : ["session", session.client, "hash", session.sessionKeyHash]);
    }
    case "window":
      return JSON.stringify([
        "window", fact.client, fact.window.startMs, fact.window.endMs, fact.unknownTime === true, fact.anchor ?? null,
      ]);
    case "rawSpan":
      return JSON.stringify(["rawSpan", fact.sessionKeyHash, fact.messageKey, fact.startUtf16, fact.endUtf16]);
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

import { CoreError, compareUtf8 } from "../../core/src/index.mjs";

/** @import { SuppressionFact, TextDigest } from "../../core/src/suppression-fact.mjs" */

const encoder = new TextEncoder();
const MAX_FLOAT4 = 3.4028234663852886e38;

/** @typedef {(value: unknown) => void} FieldCheck */

/** @returns {never} */
function invalidInput() {
  throw new CoreError("invalid_input");
}

/** @type {FieldCheck} */
function checkString(value) {
  // Unicode mode matches surrogate code units only when they are unpaired.
  if (typeof value !== "string" || /[\u0000\uD800-\uDFFF]/u.test(value)) invalidInput();
}

/** @type {FieldCheck} */
function checkNumber(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) invalidInput();
}

/** @param {FieldCheck} check @returns {FieldCheck} */
function optional(check) {
  return (value) => { if (value !== undefined) check(value); };
}

/** @param {FieldCheck} check @returns {FieldCheck} */
function nullable(check) {
  return (value) => { if (value !== null) check(value); };
}

/** @param {unknown} value @param {Record<string, FieldCheck>} fields */
function checkObject(value, fields) {
  if (value === null || typeof value !== "object") invalidInput();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) invalidInput();
  if (Reflect.ownKeys(value).some((key) => !Object.hasOwn(fields, key))) invalidInput();
  for (const [key, check] of Object.entries(fields)) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (field && (!field.enumerable || !Object.hasOwn(field, "value"))) invalidInput();
    check(field?.value);
  }
}

/** @param {FieldCheck} check @returns {FieldCheck} */
function arrayOf(check) {
  return (value) => {
    if (!Array.isArray(value)) invalidInput();
    if (Object.getPrototypeOf(value) !== Array.prototype || Reflect.ownKeys(value).length !== value.length + 1) {
      invalidInput();
    }
    for (let i = 0; i < value.length; i++) {
      const element = Object.getOwnPropertyDescriptor(value, i);
      if (!element || !Object.hasOwn(element, "value")) invalidInput();
      check(element.value);
    }
  };
}

const digestFields = {
  alg: checkString,
  value: checkString,
  pipeline: checkString,
  redactionVersion: checkNumber,
  keyId: nullable(checkString),
};
const textFields = {
  digests: arrayOf((value) => checkObject(value, digestFields)),
  shingles: optional(nullable(arrayOf(checkString))),
  embedding: optional(nullable(arrayOf(checkNumber))),
  keyId: optional(nullable(checkString)),
};
const sourceMemoryFields = { id: checkString, createdAtMs: checkNumber };
const sessionIdFields = { client: checkString, sessionId: checkString };
const sessionHashFields = { client: checkString, sessionKeyHash: checkString };
const windowFields = { startMs: checkNumber, endMs: checkNumber };
const baseFields = {
  kind: checkString,
  owner: checkString,
  namespace: optional(nullable(checkString)),
  actionId: checkString,
  origin: checkString,
};
const factFields = {
  identity: { ...baseFields, memoryId: checkString, throughRevision: optional(checkNumber) },
  text: {
    ...baseFields, mode: checkString,
    text: (/** @type {unknown} */ value) => checkObject(value, textFields),
    sourceMemory: optional(nullable((value) => checkObject(value, sourceMemoryFields))),
  },
  session: {
    ...baseFields,
    session: (/** @type {unknown} */ value) => {
      const hasId = value !== null && typeof value === "object" && Object.hasOwn(value, "sessionId");
      checkObject(value, hasId ? sessionIdFields : sessionHashFields);
    },
  },
  window: {
    ...baseFields, client: nullable(checkString),
    window: (/** @type {unknown} */ value) => checkObject(value, windowFields),
    unknownTime: optional((value) => { if (value !== true) invalidInput(); }),
    anchor: optional(checkString),
  },
  rawSpan: {
    ...baseFields, sessionKeyHash: checkString, messageKey: checkString,
    startUtf16: checkNumber, endUtf16: checkNumber, contentDigest: checkString,
  },
};

/** @param {readonly TextDigest[]} digests */
export function canonicalDigests(digests) {
  return [...digests].sort((a, b) => (
    compareUtf8(a.pipeline, b.pipeline) || compareUtf8(a.alg, b.alg) || compareUtf8(a.value, b.value)
  ));
}

/** @param {SuppressionFact} fact A fact already checked by assertStorableFact. */
export function factSlot(fact) {
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

/** @param {SuppressionFact} fact A fact already checked by core's validator. */
export function assertStorableFact(fact) {
  checkObject(fact, factFields[fact.kind]);
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
  if (encoder.encode(factSlot(fact)).byteLength > 8192) invalidInput();
}

/** @param {string} slot */
export async function slotHash(slot) {
  const hash = await crypto.subtle.digest("SHA-256", encoder.encode(slot));
  return Array.from(new Uint8Array(hash), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

import { CoreError, factHidesRow, legacyExactMac, prepareCoreText, withholdsAnyPassage } from "../../core/src/index.mjs";
import { fingerprintMemoryPassages } from "../../core/src/privacy/fingerprint.mjs";
import { copyPositions } from "./capture-input.mjs";
import { HOSTED_FINGERPRINT_LABELS } from "./fingerprint-labels.mjs";

/** @import { CaptureMessage, RawCapture } from "../../core/src/ports/capture.d.ts" */
/** @import { Scope } from "../../core/src/ports/common.d.ts" */
/** @import { StoredFact } from "../../core/src/suppression-fact.mjs" */
/** @import { RawOptions } from "./raw-options.d.mts" */

/** @param {Parameters<NonNullable<RawCapture["importArchive"]>>[4]} options @param {number} length */
export function copyWithheldPositions(options, length) {
  if (options === undefined) return new Set();
  if (!options || typeof options !== "object") throw new CoreError("invalid_input");
  const prototype = Object.getPrototypeOf(options);
  const slot = Object.getOwnPropertyDescriptor(options, "withheld");
  if ((prototype !== Object.prototype && prototype !== null) ||
      Reflect.ownKeys(options).length !== Number(slot !== undefined) ||
      ("withheld" in options) !== (slot !== undefined)) throw new CoreError("invalid_input");
  if (!slot) return new Set();
  if (!Object.hasOwn(slot, "value") || !Object.is(slot.value, options.withheld) ||
      !Array.isArray(slot.value) || slot.value.length > length) throw new CoreError("invalid_input");
  const positions = copyPositions(slot.value);
  if (positions.some(position => position >= length)) throw new CoreError("invalid_input");
  return new Set(positions);
}

/** @param {readonly StoredFact[]} facts @param {{scope: Scope, client: string, sessionId: string}} source
 * @param {RawOptions["hashSessionKey"]} hashSessionKey */
export function rawSpanFilter(facts, { scope, client, sessionId }, hashSessionKey) {
  const spans = facts.filter(({ fact }) => fact.kind === "rawSpan" && (fact.namespace ?? null) === scope.namespace);
  if (!spans.length) return () => false;
  let hash = "";
  try {
    hash = hashSessionKey?.(client, sessionId) ?? "";
  } catch {
    // The matcher treats unavailable session evidence as ineligible.
  }
  /** @param {Pick<CaptureMessage, "id">} message @param {number} [storedLength] */
  const withheld = ({ id }, storedLength) => spans.some(stored => {
    const { fact } = stored;
    // Raw imports are whole-message replays, including shorter copies of the original span.
    return fact.kind === "rawSpan" && factHidesRow(stored, {
      type: "raw", scope, source: { client, sessionId }, sessionKeyHash: hash, messageKey: id,
      startUtf16: storedLength === undefined ? fact.startUtf16 : 0,
      endUtf16: storedLength ?? fact.endUtf16,
    }) !== false;
  });
  return withheld;
}

/** @param {readonly StoredFact[]} factRows @param {Scope} scope @param {RawOptions["fingerprintKeys"]} fingerprintKeys */
export function createImportTextFilter(factRows, scope, fingerprintKeys) {
  const facts = factRows.flatMap(({ fact }) =>
    fact.kind === "text" && (fact.namespace ?? null) === scope.namespace ? [fact] : []);
  if (!facts.length) return () => false;
  /** @type {Promise<Awaited<ReturnType<NonNullable<RawOptions["fingerprintKeys"]>>>> | undefined} */
  let keyRead;
  return async (/** @type {string} */ content) => {
    try {
      const keys = await (keyRead ??= Promise.resolve(fingerprintKeys?.(scope.owner) ?? []));
      const hosted = keys.flatMap(({ key, pipeline }) => pipeline === "hosted-v1" ? [{
        alg: "hmac", keyId: key.id, label: pipeline,
        mac: (/** @type {string} */ text) => legacyExactMac(text, key, HOSTED_FINGERPRINT_LABELS),
      }] : []);
      const prepared = prepareCoreText(content);
      const byKey = [...new Map(keys.map(({ key }) => [key.id, key])).values()];
      const variants = await Promise.all((byKey.length ? byKey : [null]).map(key =>
        fingerprintMemoryPassages(content, prepared, key, undefined, hosted)));
      const exact = variants.flat().flatMap(({ digests }) => digests);
      return facts.some(fact => {
        const index = byKey.findIndex(key => key.id === fact.text.keyId);
        const passages = variants[Math.max(0, index)].map(passage => ({ ...passage, digests: exact }));
        const exactOnly = !byKey.length && fact.text.keyId == null && fact.text.shingles == null &&
          fact.text.digests.every(({ alg, keyId }) => alg === "sha256" && keyId === null);
        return withholdsAnyPassage(passages, [exactOnly ? { ...fact, mode: "exact" } : fact]);
      });
    } catch {
      return true;
    }
  };
}

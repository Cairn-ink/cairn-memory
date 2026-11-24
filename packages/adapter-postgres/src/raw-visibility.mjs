import {
  allDigests, coreDigest, factHidesRow, legacyExactMac, passageShingles, PRIVACY_REDACTION_VERSIONS, redactV1,
} from "../../core/src/index.mjs";
import { normalizeForHash, prepareCoreText } from "../../core/src/privacy/text.mjs";
import { createCaptureProofs, readLineageFence } from "./capture-source.mjs";
import { HOSTED_FINGERPRINT_LABELS } from "./fingerprint-labels.mjs";
import { inputText, invalid } from "./memory-input.mjs";
import { readVisibilityFacts } from "./memory-visibility.mjs";

/** @import { FactMatchRow, FingerprintKey } from "../../core/src/index.mjs" */
/** @import { RawSegment } from "../../core/src/ports/index.d.ts" */
/** @import { CaptureOptions } from "./capture.d.mts" */
/** @import { Query } from "./memory-rows.mjs" */
/** @typedef {Pick<CaptureOptions, "lineageSecret" | "hashSessionKey"> & {
 *   fingerprintKeys?: (owner: string) => readonly FingerprintKey[] | Promise<readonly FingerprintKey[]>
 * }} RawReadOptions */

const MAX_MESSAGE_UNITS = 20_000;

/** @param {RawReadOptions} options */
export function createRawVisibility({ lineageSecret, hashSessionKey, fingerprintKeys }) {
  if (!inputText(lineageSecret)) invalid();
  const captureProofs = createCaptureProofs(lineageSecret);
  const policy = { hashSessionKey };

  /** @param {Query} query @param {string} owner */
  return async function rawVisibility(query, owner) {
    const scope = { owner, namespace: null };
    const facts = (await readVisibilityFacts(query, owner, { rawSpans: true }))
      .filter(({ fact }) => fact.namespace == null);
    const textFacts = facts.filter(({ fact }) => fact.kind === "text");
    const otherFacts = facts.filter(({ fact }) => fact.kind !== "text");
    const spans = facts.some(({ fact }) => fact.kind === "rawSpan");
    const sessionFacts = facts.flatMap(({ fact }) => fact.kind === "session" ? [fact.session] : []);
    const hasHostedMac = textFacts.some(({ fact }) =>
      fact.kind === "text" && fact.text.digests.some(digest => digest.alg === "hmac" && digest.pipeline === "hosted-v1"));
    const lineage = readLineageFence(query, owner, captureProofs, sessionFacts, hashSessionKey);
    /** @type {Promise<readonly FingerprintKey[]> | undefined} */
    let keys;

    /** @param {RawSegment} segment */
    async function visible({ client, sessionId, messageId, content, occurredAtMs }) {
      /** @type {FactMatchRow} */
      const row = { type: "raw", scope, source: {
        client, sessionId, occurredAtMs: occurredAtMs === null ? null : Math.floor(occurredAtMs),
      }, sessionKeyHash: "", messageKey: messageId, startUtf16: 0, endUtf16: content.length };
      try {
        if (spans) row.sessionKeyHash = hashSessionKey?.(client, sessionId) ?? "";
        if (otherFacts.some(fact => factHidesRow(fact, row, policy) !== false)) return false;
        if (!textFacts.length) return true;
        if (content.length > MAX_MESSAGE_UNITS) return false;
        const digests = await allDigests(content);
        const activeKeys = await (keys ??= Promise.resolve(fingerprintKeys?.(owner) ?? []));
        const legacyPassages = new Map([redactV1(content), redactV1(content.normalize("NFKC"))]
          .map(text => [normalizeForHash(text), text]));
        for (const key of activeKeys) {
          digests.push(await coreDigest(content, key));
          if (hasHostedMac) {
            for (const text of legacyPassages.values()) {
              digests.push({ alg: "hmac", keyId: key.id, pipeline: "hosted-v1",
                redactionVersion: PRIVACY_REDACTION_VERSIONS.v1,
                value: await legacyExactMac(text, key, HOSTED_FINGERPRINT_LABELS) });
            }
          }
        }
        row.digests = digests;
        const passages = new Map([content, ...legacyPassages.values(), prepareCoreText(content)]
          .map(text => [normalizeForHash(text), text]));
        /** @type {Map<string, string[][]>} */
        const shingles = new Map();
        for (const stored of textFacts) {
          const { fact } = stored;
          if (fact.kind !== "text") continue;
          const rowShingles = fact.mode === "full" && fact.text.shingles != null;
          // Exact matches take precedence, and a store with no shingle evidence keeps its digest policy.
          if (factHidesRow(stored, row, { rowShingles: false }) !== false) return false;
          if (!rowShingles) continue;
          const key = activeKeys.find(({ id }) => id === fact.text.keyId);
          if (!key) return false;
          let values = shingles.get(key.id);
          if (!values) {
            values = await Promise.all([...passages.values()].map(text => passageShingles(text, key, HOSTED_FINGERPRINT_LABELS)));
            shingles.set(key.id, values);
          }
          if (values.some(shingles => factHidesRow(stored, { ...row, keyId: key.id, shingles }, policy) !== false)) return false;
        }
        return true;
      } catch {
        return false;
      }
    }

    /** @param {readonly RawSegment[]} segments */
    return async function visibleBatch(segments) {
      const withheld = await lineage(segments);
      const result = [];
      for (const [position, segment] of segments.entries()) {
        if (!withheld[position] && await visible(segment)) result.push(segment);
      }
      return result;
    };
  };
}

import {
  allDigests, coreDigest, factHidesRow, legacyExactMac, PRIVACY_REDACTION_VERSIONS, redactV1,
} from "../../core/src/index.mjs";
import { createCaptureProofs, lineageWithheld } from "./capture-source.mjs";
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

/** @param {RawReadOptions} options */
export function createRawVisibility({ lineageSecret, hashSessionKey, fingerprintKeys }) {
  if (!inputText(lineageSecret)) invalid();
  const captureProofs = createCaptureProofs(lineageSecret);
  const policy = { hashSessionKey, rowShingles: false };

  /** @param {Query} query @param {string} owner */
  return async function rawVisibility(query, owner) {
    const scope = { owner, namespace: null };
    const facts = (await readVisibilityFacts(query, owner, { rawSpans: true }))
      .filter(({ fact }) => fact.namespace == null);
    const textFacts = facts.filter(({ fact }) => fact.kind === "text");
    const spans = facts.some(({ fact }) => fact.kind === "rawSpan");
    const sessionFacts = facts.flatMap(({ fact }) => fact.kind === "session" ? [fact.session] : []);
    const hasHostedMac = textFacts.some(({ fact }) =>
      fact.kind === "text" && fact.text.digests.some(digest => digest.alg === "hmac" && digest.pipeline === "hosted-v1"));
    const { rows } = await query("SELECT DISTINCT client FROM capture_raw_fences WHERE user_id = $1", [owner]);
    const fencedClients = new Set(rows.map(row => row.client));
    /** @type {Promise<readonly FingerprintKey[]> | undefined} */
    let keys;

    /** @param {RawSegment} segment */
    return async function visible({ client, sessionId, messageId, content, occurredAtMs }) {
      /** @type {FactMatchRow} */
      const row = { type: "raw", scope, source: {
        client, sessionId, occurredAtMs: occurredAtMs === null ? null : Math.floor(occurredAtMs),
      }, sessionKeyHash: "", messageKey: messageId, startUtf16: 0, endUtf16: content.length };
      try {
        if (spans) row.sessionKeyHash = hashSessionKey?.(client, sessionId) ?? "";
        if (textFacts.length) {
          const digests = await allDigests(content);
          for (const key of await (keys ??= Promise.resolve(fingerprintKeys?.(owner) ?? []))) {
            digests.push(await coreDigest(content, key));
            if (hasHostedMac) {
              digests.push({ alg: "hmac", keyId: key.id, pipeline: "hosted-v1",
                redactionVersion: PRIVACY_REDACTION_VERSIONS.v1,
                value: await legacyExactMac(redactV1(content), key, HOSTED_FINGERPRINT_LABELS) });
            }
          }
          row.digests = digests;
        }
      } catch {
        return false;
      }
      if (facts.some(fact => factHidesRow(fact, row, policy) !== false)) return false;
      const ancestors = sessionFacts.filter(session => session.client === client);
      if (!fencedClients.has(client) && !ancestors.length) return true;
      const sessions = new Set(ancestors.flatMap(session => "sessionId" in session ? [session.sessionId] : []));
      const hashes = new Set(ancestors.flatMap(session => "sessionKeyHash" in session ? [session.sessionKeyHash] : []));
      const key = { scope, client, sessionId };
      const proofs = await captureProofs(key, [{ id: messageId, content }]);
      return !await lineageWithheld(query, key, proofs, sessions, hashes, hashSessionKey);
    };
  };
}

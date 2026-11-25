import {
  allDigests, coreDigest, coreFingerprintLabels, factHidesRow, fingerprintLegacyCapture,
  normalizeForHash, PRIVACY_REDACTION_VERSIONS, redactHostedCurrent, redactV1,
} from "../../core/src/index.mjs";
import { sha256Hex } from "../../core/src/privacy/fingerprint.mjs";
import { decodeRequest, hostedTime, jsonbSource } from "./capture-input.mjs";
import { HOSTED_FINGERPRINT_LABELS } from "./fingerprint-labels.mjs";
import { conversationSessions } from "./raw-session.mjs";

/** @import { Scope } from "../../core/src/ports/common.d.ts" */
/** @import { PassageFingerprint } from "../../core/src/ports/privacy.d.ts" */
/** @import { StoredFact, TextFact, TextDigest } from "../../core/src/suppression-fact.mjs" */
/** @import { Connection } from "./driver.mjs" */
/** @import { RawOptions } from "./raw-options.d.mts" */
/** @typedef {Connection["query"]} Query */
/** @typedef {{client: string, sessionId: string}} Session */
/** @typedef {Session & {messageId?: string}} SourceAddress */
/** @typedef {{id: string, content: string, occurred_at?: string, normalized_empty?: true,
 *   legacy_fingerprint?: {text_hmac: string, key_id: string, shingles: string[]}, document_ill_formed?: true}} LedgerMessage */

const HOSTED_TIME = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;

/** @param {unknown} value */
function validHostedTime(value) {
  if (typeof value !== "string" || value.length > 64) return false;
  const match = HOSTED_TIME.exec(value);
  if (!match || value !== match[0]) return false;
  const year = Number(match[1]), month = Number(match[2]), day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const ms = Date.parse(value);
  return day <= days[month - 1] && Number.isFinite(ms) && hostedTime(ms) !== null;
}

/** @param {string} content @param {NonNullable<LedgerMessage["legacy_fingerprint"]> | undefined} legacy
 * @param {Awaited<ReturnType<NonNullable<RawOptions["fingerprintKeys"]>>>} keys
 * @param {readonly StoredFact<TextFact>[]} facts @param {Scope} scope */
async function definitelyWithheld(content, legacy, keys, facts, scope) {
  if (content === "") return false;
  /** @type {PassageFingerprint[]} */
  const passages = [];
  /** @type {TextDigest[]} */
  const aliases = await allDigests(content);
  const { v1: redactionVersion } = PRIVACY_REDACTION_VERSIONS;
  for (const variant of new Set([content, redactV1(content), redactHostedCurrent(content)].map(normalizeForHash))) {
    const digests = [...aliases, /** @type {const} */ ({
      alg: "sha256", pipeline: "hosted-v1", value: await sha256Hex(variant), keyId: null, redactionVersion,
    })];
    passages.push({ digests, shingles: null, keyId: null });
    for (const { key, pipeline } of keys) {
      const labels = pipeline === "core" ? coreFingerprintLabels : HOSTED_FINGERPRINT_LABELS;
      const { text_hmac, shingles } = await fingerprintLegacyCapture(variant, key, labels);
      const keyed = pipeline === "core" ? await coreDigest(content, key) : null;
      passages.push({
        digests: [...digests, { alg: "hmac", pipeline, value: text_hmac, keyId: key.id, redactionVersion },
          ...(keyed ? [keyed] : [])],
        shingles, keyId: key.id,
      });
    }
  }
  if (legacy) {
    passages.push({
      digests: [{ alg: "hmac", pipeline: "hosted-v1", value: legacy.text_hmac, keyId: legacy.key_id, redactionVersion }],
      shingles: legacy.shingles, keyId: legacy.key_id,
    });
  }
  return facts.some((fact) => passages.some((passage) => factHidesRow(fact, { type: "raw", scope, sessionKeyHash: "", messageKey: "", startUtf16: 0, endUtf16: content.length, ...passage }) === true));
}

/** @param {Query} query @param {Scope} scope @param {readonly SourceAddress[]} addresses */
export async function dropSourceQuantities(query, scope, addresses) {
  if (!addresses.length) return false;
  const sessions = new Map();
  const targets = [];
  for (const { client, sessionId, messageId } of addresses) {
    const key = JSON.stringify([client, sessionId]);
    if (!sessions.has(key)) sessions.set(key, await conversationSessions(query, scope, { client, sessionId }));
    for (const address of sessions.get(key)) {
      targets.push({ client: address.client, session_id: address.sessionId, message_id: messageId });
    }
  }
  const { rows: [result] } = await query(`WITH removed AS (
    DELETE FROM core_quantity_ledger l
    USING jsonb_to_recordset($2::jsonb) AS target(client text, session_id text, message_id text)
    WHERE l.user_id = $1 AND l.core_namespace IS NULL
      AND (l.source_client, l.source_session_id) = (target.client, target.session_id)
      AND (target.message_id IS NULL OR l.source_message_id = target.message_id)
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM removed) AS changed`, [scope.owner, JSON.stringify(targets)]);
  return result.changed;
}

/** @param {Query} query @param {Scope} scope @param {readonly StoredFact<TextFact>[]} facts
 * @param {RawOptions["fingerprintKeys"]} fingerprintKeys */
export async function purgeRawText(query, scope, facts, fingerprintKeys) {
  if (!facts.length) return { rawDeleted: 0, ledgerBlanked: 0, ledgerChanged: false };
  const keys = await fingerprintKeys?.(scope.owner) ?? [];
  /** @param {LedgerMessage} message */
  const matches = ({ content, legacy_fingerprint }) => definitelyWithheld(content, legacy_fingerprint, keys, facts, scope);
  let rawDeleted = 0;
  /** @type {string | null} */
  let after = null;
  for (;;) {
    const { rows } = await query(`SELECT id, content FROM raw_messages
      WHERE user_id = $1 AND ($2::text IS NULL OR id > $2)
      ORDER BY id LIMIT 100`, [scope.owner, after]);
    if (!rows.length) break;
    const ids = [];
    for (const row of rows) if (await matches(row)) ids.push(row.id);
    if (ids.length) {
      const { rows: deleted } = await query(`DELETE FROM raw_messages
        WHERE user_id = $1 AND id = ANY($2::text[])
        RETURNING client, session_id AS "sessionId", message_id AS "messageId"`,
      [scope.owner, ids]);
      rawDeleted += deleted.length;
      await dropSourceQuantities(query, scope, deleted);
    }
    after = rows.at(-1).id;
  }
  return { rawDeleted, ...await scrubLedger(query, scope, [], matches) };
}

/** @param {Query} query @param {Scope} scope @param {readonly Session[]} sessions
 * @param {(message: LedgerMessage) => boolean | Promise<boolean>} [matches] */
export async function scrubLedger(query, scope, sessions, matches) {
  const targets = JSON.stringify(sessions.map(({ client, sessionId }) => ({ client, session_id: sessionId })));
  let ledgerBlanked = 0;
  let ledgerChanged = false;
  /** @type {string | null} */
  let afterClient = null;
  /** @type {string | null} */
  let afterEvent = null;
  for (;;) {
    const { rows } = await query(`SELECT client, session_id, event_id, raw_request, core_outbox_metadata FROM capture_events e
      WHERE e.user_id = $1 AND e.core_namespace IS NULL
        AND ($2::text IS NULL OR (e.client, e.event_id) > ($2, $3))
        AND ($5::boolean OR EXISTS (
          SELECT 1 FROM jsonb_to_recordset($4::jsonb) AS target(client text, session_id text)
          WHERE (target.client, target.session_id) = (e.client, e.session_id)
        ))
      ORDER BY e.client, e.event_id LIMIT 16 FOR UPDATE`,
    [scope.owner, afterClient, afterEvent, targets, matches !== undefined]);
    if (!rows.length) return { ledgerBlanked, ledgerChanged };
    for (const { client, session_id, event_id, raw_request, core_outbox_metadata } of rows) {
      const legacy = typeof raw_request === "string";
      const request = /** @type {{messages: LedgerMessage[]}} */ (decodeRequest(raw_request));
      const metadata = matches ? decodeRequest(core_outbox_metadata) : null;
      const removed = [];
      let changed = false;
      for (const [index, message] of request.messages.entries()) {
        if (!matches || await matches(message)) {
          if (message.content !== "") {
            const messageId = metadata?.[index]?.id ?? message.id;
            if (matches && typeof messageId === "string") removed.push({ client, sessionId: session_id, messageId });
            message.content = "";
            ledgerBlanked++;
            changed = true;
          }
          for (const field of /** @type {const} */ (["normalized_empty", "legacy_fingerprint", "document_ill_formed"])) {
            if (Object.hasOwn(message, field)) {
              delete message[field];
              changed = true;
            }
          }
        }
        if (Object.hasOwn(message, "occurred_at") && !validHostedTime(message.occurred_at)) {
          delete message.occurred_at;
          changed = true;
        }
      }
      if (changed) {
        const patch = legacy ? JSON.stringify(JSON.stringify(request)) : jsonbSource(request);
        await query(`UPDATE capture_events SET raw_request = $4::jsonb
          WHERE user_id = $1 AND core_namespace IS NULL AND client = $2 AND event_id = $3`,
        [scope.owner, client, event_id, patch]);
        ledgerChanged = true;
      }
      await dropSourceQuantities(query, scope, removed);
    }
    ({ client: afterClient, event_id: afterEvent } = rows.at(-1));
  }
}

import {
  allDigests, coreDigest, coreFingerprintLabels, CoreError, factHidesRow, fingerprintLegacyCapture,
  normalizeForHash, PRIVACY_REDACTION_VERSIONS, redactHostedCurrent, redactV1,
} from "../../core/src/index.mjs";
import { sha256Hex } from "../../core/src/privacy/fingerprint.mjs";
import { decodeRequest, hostedTime, jsonbSource, pgText } from "./capture-input.mjs";
import { HOSTED_FINGERPRINT_LABELS } from "./fingerprint-labels.mjs";
import { conversationSessions } from "./raw-session.mjs";

/** @import { Scope } from "../../core/src/ports/common.d.ts" */
/** @import { PassageFingerprint, RawSourceTuple } from "../../core/src/ports/privacy.d.ts" */
/** @import { StoredFact, TextFact, TextDigest } from "../../core/src/suppression-fact.mjs" */
/** @import { Connection } from "./driver.mjs" */
/** @import { RawOptions } from "./raw-options.d.mts" */
/** @import { Run } from "./uow.mjs" */
/** @typedef {Connection["query"]} Query */
/** @typedef {{client: string, sessionId: string}} Session */
/** @typedef {Session & {messageId?: string}} SourceAddress */
/** @typedef {Session & {messageId: string}} MessageAddress */
/** @typedef {{id: string, content: string, occurred_at?: string, normalized_empty?: true,
 *   legacy_fingerprint?: {text_hmac: string, key_id: string, shingles: string[]}, document_ill_formed?: true}} LedgerMessage */

const HOSTED_TIME = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u;
export const RAW_SOURCE_COLUMNS = `r.client, r.session_id AS "sessionId", r.message_id AS "messageId", r.role,
  (EXTRACT(EPOCH FROM r.occurred_at) * 1000)::double precision AS "occurredAtMs"`;

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
  /** @type {Map<string, {client: string | null, sessionId: string}[]>} */
  const sessions = new Map();
  const targets = [];
  for (const { client, sessionId, messageId } of addresses) {
    const key = JSON.stringify([client, sessionId]);
    let resolved = sessions.get(key);
    if (!resolved) {
      try {
        // The reverse lookup can omit clients with mixed save provenance.
        resolved = client === "mcp" && sessionId.startsWith("mcp-save:")
          ? [{ client: null, sessionId }]
          : await conversationSessions(query, scope, { client, sessionId });
      } catch (error) {
        if (!(error instanceof CoreError) || error.code !== "raw_lineage_unavailable" ||
            !sessionId.startsWith("mcp-save:")) throw error;
        // Ambiguous MCP save provenance requires dropping quantities across clients.
        resolved = [{ client: null, sessionId }];
      }
      sessions.set(key, resolved);
    }
    for (const address of resolved) {
      targets.push({ client: address.client, session_id: address.sessionId, message_id: messageId });
    }
  }
  const { rows: [result] } = await query(`WITH removed AS (
    DELETE FROM core_quantity_ledger l
    USING jsonb_to_recordset($2::jsonb) AS target(client text, session_id text, message_id text)
    WHERE l.user_id = $1 AND l.core_namespace IS NULL
      AND l.source_session_id = target.session_id
      AND (target.client IS NULL OR l.source_client = target.client)
      AND (target.message_id IS NULL OR l.source_message_id = target.message_id)
    RETURNING 1
  ) SELECT EXISTS (SELECT 1 FROM removed) AS changed`, [scope.owner, JSON.stringify(targets)]);
  return result.changed;
}

/** @param {Query} query @param {Scope} scope @param {readonly StoredFact<TextFact>[]} facts
 * @param {RawOptions["fingerprintKeys"]} fingerprintKeys @param {RawSourceTuple[]} [deletedSources]
 * @param {MessageAddress[]} [ledgerSources] */
export async function purgeRawText(query, scope, facts, fingerprintKeys, deletedSources, ledgerSources) {
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
      const { rows: deleted } = await query(`DELETE FROM raw_messages${deletedSources ? " r" : ""}
        WHERE user_id = $1 AND id = ANY($2::text[])
        RETURNING ${deletedSources ? RAW_SOURCE_COLUMNS : 'client, session_id AS "sessionId", message_id AS "messageId"'}`,
      [scope.owner, ids]);
      rawDeleted += deleted.length;
      deletedSources?.push(...deleted);
      await dropSourceQuantities(query, scope, deleted);
    }
    after = rows.at(-1).id;
  }
  return { rawDeleted, ...await scrubLedger(query, scope, [], { matches, ledgerSources }) };
}

/** @param {Query} query @param {Run} run @param {Scope} scope @param {string} memoryId
 * @param {RawOptions["purgeCards"]} [purgeCards] */
export async function eraseReceiptRaw(query, run, scope, memoryId, purgeCards) {
  const { rows: receipts } = await query(`SELECT client, session_id, message_id FROM core_memory_receipts
    WHERE user_id = $1 AND memory_id = $2 AND forgotten_at IS NULL`, [scope.owner, memoryId]);
  if (!receipts.length) {
    if (purgeCards) await purgeCards(query, run, scope, [], memoryId);
    return;
  }
  const { rows } = await query(`DELETE FROM raw_messages r
    USING jsonb_to_recordset($2::jsonb) AS p(client text, session_id text, message_id text)
    WHERE r.user_id = $1 AND (r.client, r.session_id, r.message_id) = (p.client, p.session_id, p.message_id)
    RETURNING r.client, r.session_id AS "sessionId", r.message_id AS "messageId"`, [scope.owner, JSON.stringify(receipts)]);
  /** @type {MessageAddress[]} */
  const deleted = rows;
  await dropSourceQuantities(query, scope, deleted);
  const sessions = new Map();
  /** @type {Map<string, Set<string>>} */
  const messageIds = new Map();
  for (const { client, session_id: sessionId, message_id: messageId } of receipts) {
    const key = JSON.stringify([client, sessionId]);
    let ids = messageIds.get(key);
    if (!ids) {
      sessions.set(key, { client, sessionId });
      messageIds.set(key, ids = new Set());
    }
    ids.add(messageId);
  }
  await scrubLedger(query, scope, [...sessions.values()], { messageIds });
  if (purgeCards) {
    await purgeCards(query, run, scope, receipts.map(({ client, session_id, message_id }) =>
      ({ client, sessionId: session_id, messageId: message_id })), memoryId);
  }
}

/** @param {Query} query @param {Scope} scope @param {readonly Session[]} sessions
 * @param {{matches?: (message: LedgerMessage) => boolean | Promise<boolean>, messageIds?: Map<string, Set<string>>,
 *   ledgerSources?: MessageAddress[]}} [options] */
export async function scrubLedger(query, scope, sessions, { matches, messageIds, ledgerSources } = {}) {
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
      const metadata = matches || messageIds ? decodeRequest(core_outbox_metadata) : null;
      const ids = messageIds?.get(JSON.stringify([client, session_id]));
      const removed = [];
      let changed = false;
      for (const [index, message] of request.messages.entries()) {
        const messageId = metadata?.[index]?.id ?? message.id;
        const selected = messageIds ? ids?.has(messageId) : !matches || await matches(message);
        if (selected) {
          if (message.content !== "") {
            // Outbox IDs can escape characters that a ledger source's text column cannot store.
            if (matches && pgText(messageId)) removed.push({ client, sessionId: session_id, messageId });
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
        if ((!messageIds || selected) && Object.hasOwn(message, "occurred_at") && !validHostedTime(message.occurred_at)) {
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
      if (ledgerSources && removed.length) {
        // A matching capture copy is erasure evidence only if no Raw row survived at that address.
        const { rows } = await query(`SELECT p.client, p."sessionId", p."messageId"
          FROM jsonb_to_recordset($2::jsonb) AS p(client text, "sessionId" text, "messageId" text)
          WHERE NOT EXISTS (SELECT 1 FROM raw_messages r WHERE r.user_id = $1
            AND (r.client, r.session_id, r.message_id) = (p.client, p."sessionId", p."messageId"))`,
        [scope.owner, JSON.stringify(removed)]);
        ledgerSources.push(...rows);
      }
    }
    ({ client: afterClient, event_id: afterEvent } = rows.at(-1));
  }
}

export { definitelyWithheld as rawTextDefinitelyWithheld };

import { CoreError, isErrorCode } from "../../core/src/index.mjs";
import { sha256Hex } from "../../core/src/privacy/fingerprint.mjs";
import { copyFinishItems, finishMemories, readIndexRevision, trackFinish } from "./capture-finish.mjs";
import {
  clockMs, copyKey, copyMessages, copyPositions, copyScope, decodeOutboxMessages, hostedTime, identifier, jsonbSource, readFailure,
  readInput, readLease, readSelection, readToken,
} from "./capture-input.mjs";
import { pauseLockedWrite } from "./capture-lock.mjs";
import { createCaptureProofs, filterSources, hasRawFence } from "./capture-source.mjs";
import { copyReceipts, guardOwner, inputText, namespaceKey } from "./memory-input.mjs";
import { decodeReceipts, memoryReceiptsSql } from "./memory-rows.mjs";
import { createPostgresMemoryStore } from "./memory-store.mjs";
import { conversationSessions } from "./raw-session.mjs";
import { assertReceiptSource } from "./receipt-source.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { CaptureClaim, CaptureFinish, CaptureKey, FinishResult, SourceFilter } from "../../core/src/ports/capture.d.ts" */
/** @import { CaptureMessage } from "../../core/src/ports/capture.d.ts" */
/** @import { Receipt } from "../../core/src/ports/common.d.ts" */
/** @import { Tx } from "../../core/src/ports/unit-of-work.d.ts" */
/** @import { CaptureOptions } from "./capture.d.mts" */
/** @import { Connection } from "./driver.mjs" */
/** @typedef {Required<CaptureClaim> & SourceFilter & Required<CaptureFinish>} CapturePorts */
/** @typedef {Connection["query"]} Query */
/** @typedef {{
 *   session_id: string, status: string, core_namespace: string | null, core_payload_digest: string | null,
 *   core_admitted: boolean | null, core_failure_code: string | null, core_result: FinishResult | null,
 *   legacy_failed: boolean, raw_archive_from: number | null,
 *   core_lease_expires_at_ms: string | null, core_lease_sources: {
 *     times: (number | null)[], proofs: Awaited<ReturnType<ReturnType<typeof createCaptureProofs>>>
 *   } | null
 * }} CaptureRow */

const IDENTITY = "user_id = $1 AND client = $2 AND event_id = $3";
const TOKEN = "user_id = $1 AND core_lease_token = $2";
// A failed attempt leaves the hosted event queued. Only its ingest job records the failure.
const LEGACY_FAILED = `core_payload_digest IS NULL AND status <> 'completed' AND EXISTS (
  SELECT 1 FROM jobs j WHERE j.user_id = capture_events.user_id AND j.kind = 'ingest' AND j.status = 'failed'
    AND j.capture_id = CASE WHEN capture_events.client = 'mcp'
      THEN '["mcp",' || to_json(capture_events.event_id)::text || ']'
      ELSE capture_events.client || ':' || capture_events.event_id END
)`;
const SELECT_EVENT = `SELECT session_id, status, raw_archive_from, core_namespace, core_payload_digest, core_admitted,
    core_failure_code, core_result, core_lease_expires_at_ms::text, core_lease_sources, ${LEGACY_FAILED} AS legacy_failed
  FROM capture_events WHERE ${IDENTITY}`;
const LOAD = `SELECT raw_request, core_payload_digest, core_outbox_metadata FROM capture_events
  WHERE ${IDENTITY} AND session_id = $4 AND core_namespace IS NOT DISTINCT FROM $5 AND core_admitted`;
const LOCK_LEASE_SOURCE = `SELECT session_id, core_namespace, core_payload_digest, core_admitted,
    core_lease_expires_at_ms::text, core_lease_sources, raw_request, core_outbox_metadata
  FROM capture_events WHERE ${IDENTITY} FOR UPDATE`;
const STATUS = `SELECT core_failure_code,
    CASE WHEN status = 'completed' THEN 2
      WHEN core_failure_code IS NOT NULL OR (${LEGACY_FAILED}) THEN 1 ELSE 0 END AS status_rank
  FROM capture_events
  WHERE user_id = $1 AND event_id = $2 AND core_namespace IS NOT DISTINCT FROM $3
    AND (core_admitted OR core_payload_digest IS NULL) AND ($4::text IS NULL OR client = $4)
  ORDER BY status_rank, arrival_order
  LIMIT 1`;
const INSERT_EVENT = `INSERT INTO capture_events
    (user_id, client, event_id, session_id, core_namespace, core_payload_digest, received_at,
     raw_request, core_admitted, core_outbox_metadata)
  VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp(), $7::jsonb, $8, $9::jsonb)
  ON CONFLICT (user_id, client, event_id) DO NOTHING RETURNING 1`;
const SET_LEASE = `UPDATE capture_events SET core_lease_token = $4, core_lease_expires_at_ms = $5,
    core_lease_sources = $6::jsonb, core_dispatched = false WHERE ${IDENTITY}`;
const WAS_ABANDONED = `SELECT 1 FROM capture_events WHERE user_id = $1 AND core_abandoned_tokens IS NOT NULL
  AND core_abandoned_tokens @> ARRAY[$2::uuid] LIMIT 1`;
const RETIRE_LEASE = `core_lease_token = NULL, core_lease_expires_at_ms = NULL,
    core_lease_sources = NULL, core_dispatched = false,
    core_abandoned_tokens = CASE WHEN core_lease_token IS NOT NULL
      THEN array_append(core_abandoned_tokens, core_lease_token) ELSE core_abandoned_tokens END`;
const ABANDON = `UPDATE capture_events SET ${RETIRE_LEASE}, core_failure_code = $3 WHERE ${TOKEN}`;
const TERMINATE_DIRECT_CLAIMS = `UPDATE capture_events SET ${RETIRE_LEASE}, core_failure_code = 'stale_admission'
  WHERE user_id = $1 AND client = $2 AND session_id = $3 AND core_admitted IS FALSE
    AND core_payload_digest IS NOT NULL AND status = 'pending' AND raw_archive_from IS NULL
    AND core_failure_code IS NULL RETURNING 1`;
const COMPLETE = `UPDATE capture_events SET status = 'completed', memory_count = GREATEST(memory_count, $3),
    core_result = $4::jsonb, core_lease_token = NULL, core_lease_expires_at_ms = NULL,
    core_lease_sources = NULL, core_dispatched = false, core_failure_code = NULL
  WHERE ${TOKEN} AND status = 'pending' RETURNING client, event_id`;

/** @param {Pick<CaptureKey, "scope" | "client" | "eventId">} key */
function identity({ scope, client, eventId }) {
  return [scope.owner, client, eventId];
}

/** @param {Pick<CaptureRow, "core_payload_digest" | "session_id">} row @param {CaptureKey} key */
function assertSameEvent(row, key) {
  if (row.core_payload_digest !== key.payloadDigest || row.session_id !== key.sessionId) {
    throw new CoreError("event_payload_conflict");
  }
}

/** @param {CaptureRow} row @param {CaptureKey} key */
function storedRetry(row, key) {
  // Hosted completion records the ledger status without a Core result.
  if (row.status === "completed" && row.core_result === null) return /** @type {const} */ ({ status: "duplicate" });
  if (row.core_payload_digest === null) {
    const acknowledged = row.status === "completed" || (row.status === "queued" && row.legacy_failed);
    return /** @type {const} */ ({ status: acknowledged ? "duplicate" : "processing" });
  }
  assertSameEvent(row, key);
  if (row.status === "completed" && row.core_result !== null) {
    return /** @type {const} */ ({ status: "rawReplay", result: row.core_result });
  }
  // Both writers start at pending. A persisted raw archive cut identifies work the hosted consumer has planned.
  if (row.status === "queued" || (row.status === "pending" && row.raw_archive_from !== null)) {
    return /** @type {const} */ ({ status: "processing" });
  }
}

/** @param {Pick<CaptureRow, "core_lease_expires_at_ms">} row @param {bigint} now */
function hasLiveLease(row, now) {
  return row.core_lease_expires_at_ms !== null && now < BigInt(row.core_lease_expires_at_ms);
}

/** @param {Query} query @param {string} owner @param {{client: string, sessionId: string}} source */
export async function terminateDirectClaims(query, owner, { client, sessionId }) {
  const { rows } = await query(TERMINATE_DIRECT_CLAIMS, [owner, client, sessionId]);
  return rows.length > 0;
}

/** @param {Query} query @param {CaptureKey} key @param {boolean} fenced @param {CaptureMessage[]} [batch]
 * @returns {Promise<CaptureRow | null | undefined>} Null when a fence refuses a new event.
 */
async function reserveEvent(query, key, fenced, batch) {
  const params = identity(key);
  const select = SELECT_EVENT + " FOR UPDATE";
  const { rows: [existing] } = await query(select, params);
  if (existing) return existing;
  if (fenced) return null;
  const { raw, metadata } = encodeRequest(key, batch ?? []);
  const { rows } = await query(INSERT_EVENT, [
    ...params, key.sessionId, key.scope.namespace, key.payloadDigest, raw, batch !== undefined, metadata,
  ]);
  if (rows.length) return undefined;
  // The existing ledger can also be written by the hosted producer.
  const { rows: [concurrent] } = await query(select, params);
  if (!concurrent) throw new CoreError("storage_busy");
  return concurrent;
}

/** @param {Query} query @param {string} owner @param {string} token @param {() => number} now @param {string} [columns] */
async function requireLiveToken(query, owner, token, now, columns = "") {
  const { rows: [row] } = await query(`SELECT core_lease_expires_at_ms::text, core_dispatched
    ${columns}
    FROM capture_events WHERE ${TOKEN} FOR UPDATE`, [owner, token]);
  if (!row) throw new CoreError("stale_admission");
  const nowMs = now();
  if (!hasLiveLease(row, clockMs(nowMs))) throw new CoreError("stale_admission");
  return { row, nowMs };
}

/** @param {CaptureOptions} options @returns {CapturePorts} */
export function createPostgresCapturePorts(options) {
  const { now = Date.now, lineageSecret, hashSessionKey, nearDuplicate, allowNonNullNamespace } = options ?? {};
  const captureProofs = createCaptureProofs(lineageSecret);
  const memories = createPostgresMemoryStore({ nearDuplicate, allowNonNullNamespace, hashSessionKey });

  return {
    async retainedReceiptIds(tx, scope, memoryId, receipts) {
      guardOwner(tx, scope);
      const namespace = namespaceKey(scope.namespace, allowNonNullNamespace);
      const id = inputText(memoryId);
      const incoming = copyReceipts(receipts);
      return runOperation(tx, async query => {
        const { rows } = await query(memoryReceiptsSql(`ARRAY(SELECT id FROM memories WHERE user_id = $1
          AND core_namespace IS NOT DISTINCT FROM $2 AND id = $3)`), [tx.owner, namespace, id]);
        // The hosted receipt table has a composite key and does not store excerpts.
        /** @param {Receipt} receipt */
        const address = ({ client, sessionId, messageId, role, occurredAtMs }) =>
          JSON.stringify([client, sessionId, messageId, role, occurredAtMs]);
        const retained = new Set((decodeReceipts(rows).get(id) ?? []).map(address));
        return Promise.all(incoming.map(receipt => retained.has(address(receipt))
          ? sha256Hex(JSON.stringify([tx.owner, namespace, id, receipt.client, receipt.sessionId, receipt.messageId])) : null));
      });
    },

    async claim(tx, key, messages, options) {
      return pauseLockedWrite(tx, () => {
        const copy = copyKey(tx, key);
        const batch = copyMessages(messages);
        const leaseMs = readLease(options);
        return async (query) => {
          const fenced = await hasRawFence(query, copy);
          const row = await reserveEvent(query, copy, fenced);
          if (row === null) return { status: "duplicate" };
          if (row) {
            const retry = storedRetry(row, copy);
            if (retry) return retry;
            if (row.core_failure_code !== null) return { status: "duplicate" };
          }
          const current = clockMs(now());
          if (row && hasLiveLease(row, current)) return { status: "processing" };

          const source = row?.core_admitted ? await loadAdmission(query, copy, row.core_namespace) : null;
          if (row?.core_admitted && !source) throw new CoreError("internal_error");
          if (fenced && !isBlankOutbox(source?.messages)) return { status: "duplicate" };
          const stored = source?.messages ?? batch;
          const times = stored.map(({ occurredAtMs }) => occurredAtMs);
          const proofs = await captureProofs(copy, stored);
          const token = crypto.randomUUID();
          await query(SET_LEASE, [
            ...identity(copy), token, (current + BigInt(leaseMs)).toString(), JSON.stringify({ times, proofs }),
          ]);
          return { status: "claimed", token };
        };
      });
    },

    async beginDispatch(tx, token) {
      return pauseLockedWrite(tx, () => {
        const lease = readToken(token);
        return async (query) => {
          if (lease === null) throw new CoreError("stale_admission");
          const { row } = await requireLiveToken(query, tx.owner, lease, now);
          if (!row.core_dispatched) {
            await query(`UPDATE capture_events SET core_dispatched = true WHERE ${TOKEN}`, [tx.owner, lease]);
          }
          return { token: lease };
        };
      });
    },

    async abandon(tx, token, failure) {
      return pauseLockedWrite(tx, () => {
        const lease = readToken(token);
        const { code, retryable } = readFailure(failure);
        return async (query) => {
          if (lease === null) throw new CoreError("stale_admission");
          const params = [tx.owner, lease];
          const { rows } = await query(WAS_ABANDONED, params);
          if (rows.length) return;
          await requireLiveToken(query, tx.owner, lease, now);
          await query(ABANDON, [...params, retryable ? null : code]);
        };
      });
    },

    async finish(tx, token, items) {
      const { scope, source, batch, lease, nowMs, current } = await pauseLockedWrite(tx, () => {
        const lease = readToken(token);
        const batch = copyFinishItems(items);
        return async (query) => {
          if (lease === null) throw new CoreError("stale_admission");
          const { row, nowMs } = await requireLiveToken(query, tx.owner, lease, now,
            `, status, core_namespace, client, session_id, core_admitted, core_lease_sources, raw_request, core_outbox_metadata`);
          if (row.status !== "pending" || !row.core_lease_sources) throw new CoreError("stale_admission");
          const scope = { owner: tx.owner, namespace: row.core_namespace };
          const source = { kind: /** @type {const} */ ("capture"), client: row.client, sessionId: row.session_id };
          const { proofs, times } = /** @type {NonNullable<CaptureRow["core_lease_sources"]>} */ (row.core_lease_sources);
          const current = row.core_admitted ? decodeOutboxMessages(row.raw_request, row.core_outbox_metadata) : null;
          if (current) {
            const currentProofs = await captureProofs({ scope, client: row.client }, current);
            const blankIds = new Set(current.filter(({ content }) => !content).map(({ id }) => id));
            if ((batch.length > 0 && isBlankOutbox(current)) ||
                !proofs || !currentProofs || proofs.length !== currentProofs.length ||
                currentProofs.some((proof, i) => proof.message_mac !== proofs[i].message_mac || proof.content_mac !== proofs[i].content_mac) ||
                batch.some(({ receipts }) => receipts.some((receipt) => receipt.client === source.client &&
                  receipt.sessionId === source.sessionId && blankIds.has(receipt.messageId)))) {
              throw new CoreError("suppressed");
            }
          }
          const leaseSource = { scope, ...source };
          if (batch.length || await hasRawFence(query, leaseSource)) {
            await filterSources(query, leaseSource, [], proofs, "assert", captureProofs, hashSessionKey,
              !batch.length && isBlankOutbox(current), current ?? undefined);
          }
          const receipts = new Map(batch.flatMap(({ receipts }) => receipts.map(receipt =>
            [JSON.stringify([receipt.client, receipt.sessionId, receipt.messageId, receipt.role]), receipt])));
          const sessions = receipts.size ? await conversationSessions(query, scope, source) : [];
          for (const receipt of receipts.values()) {
            const fromLease = sessions.some(session => session.client === receipt.client && session.sessionId === receipt.sessionId);
            const evidence = { times: /** @type {(number | null)[]} */ ([]), proofs: /** @type {NonNullable<typeof proofs>} */ ([]) };
            if (fromLease && !current && proofs) {
              const mac = await captureProofs.sign(receipt.messageId);
              for (const [i, proof] of proofs.entries()) {
                if (proof.message_mac === mac && proof.content_mac !== null && i < times.length) {
                  evidence.times.push(times[i]);
                  if (receipt.client === source.client) evidence.proofs.push(proof);
                }
              }
            }
            await assertReceiptSource(query, scope, receipt, captureProofs, hashSessionKey,
              fromLease ? current ?? [] : [], evidence);
          }
          return { scope, source, batch, lease, nowMs, current };
        };
      });

      const { result, saved } = await finishMemories(tx, scope, source, batch, nowMs, memories);
      return runOperation(tx, async (query) => {
        result.indexRevision = await readIndexRevision(query, tx.owner);
        const { rows: [completed] } = await query(COMPLETE, [tx.owner, lease, saved, JSON.stringify(result)]);
        if (!completed) throw new CoreError("stale_admission");
        trackFinish(tx, { scope, client: completed.client, sessionId: source.sessionId,
          eventId: completed.event_id, messages: current ?? [], result });
        return result;
      });
    },

    async admit(tx, key, messages) {
      return pauseLockedWrite(tx, () => {
        const copy = copyKey(tx, key);
        const batch = copyMessages(messages);
        return async (query) => {
          const fenced = batch.some(({ content }) => content !== "") && await hasRawFence(query, copy);
          const row = await reserveEvent(query, copy, fenced, batch);
          if (row === null) return { status: "duplicate" };
          if (!row) return { status: "admitted" };
          const retry = storedRetry(row, copy);
          if (retry) return retry;
          if (row.core_lease_expires_at_ms !== null && hasLiveLease(row, clockMs(now()))) {
            return { status: "processing" };
          }
          return { status: "duplicate" };
        };
      });
    },

    async load(tx, selection) {
      requireLiveRun(tx);
      const copy = readInput(() => {
        const scope = selection?.scope;
        if (scope?.owner !== tx.owner) throw new CoreError("internal_error");
        return readSelection(tx, selection);
      });
      return runOperation(tx, (query) => loadAdmission(query, copy, copy.scope.namespace));
    },

    async status(tx, scope, eventId, client) {
      requireLiveRun(tx);
      const [owner, event, namespace, selectedClient] = readInput(() => {
        const { owner, namespace } = copyScope(tx, scope);
        return [owner, identifier(eventId), namespace, client === undefined ? null : identifier(client)];
      });
      return runOperation(tx, async (query) => {
        const { rows: [row] } = await query(STATUS, [owner, event, namespace, selectedClient]);
        if (!row) return { status: "unknown" };
        if (row.status_rank === 2) return { status: "done" };
        if (row.core_failure_code !== null) {
          if (!isErrorCode(row.core_failure_code)) throw new CoreError("internal_error");
          return { status: "failed", code: row.core_failure_code };
        }
        return { status: row.status_rank === 1 ? "failed" : "pending" };
      });
    },

    async eligible(tx, key, messages) {
      requireLiveRun(tx);
      const [copy, batch] = readInput(() => /** @type {const} */ ([copyKey(tx, key), copyMessages(messages)]));
      return runOperation(tx, async (query) => filterSources(query, copy, batch.map(({ occurredAtMs }) => occurredAtMs),
        await captureProofs(copy, batch), "read", captureProofs, hashSessionKey, false, batch));
    },

    async assertEligible(tx, key, positions) {
      requireLiveRun(tx, true);
      const [copy, selected] = readInput(() => /** @type {const} */ ([copyKey(tx, key), copyPositions(positions)]));
      return runOperation(tx, async (query) => {
        /** @type {{rows: (Pick<CaptureRow, "session_id" | "core_namespace" | "core_payload_digest" | "core_admitted" |
         *   "core_lease_expires_at_ms" | "core_lease_sources"> & {raw_request: unknown, core_outbox_metadata: unknown})[]}} */
        const { rows: [row] } = await query(LOCK_LEASE_SOURCE, identity(copy));
        if (!row || row.core_namespace !== copy.scope.namespace || row.core_payload_digest === null) {
          throw new CoreError("stale_admission");
        }
        assertSameEvent(row, copy);
        if (!row.core_lease_sources || !hasLiveLease(row, clockMs(now()))) throw new CoreError("stale_admission");
        const { times, proofs } = row.core_lease_sources;
        const selectedTimes = selected.map((position) => {
          if (position >= times.length) throw new CoreError("invalid_input");
          return times[position];
        });
        const current = row.core_admitted ? decodeOutboxMessages(row.raw_request, row.core_outbox_metadata) : null;
        // An admitted outbox can finish without sources once every message has been withdrawn.
        const allowExactFence = selected.length === 0 && isBlankOutbox(current);
        await filterSources(query, copy, selectedTimes, proofs, "assert", captureProofs, hashSessionKey,
          allowExactFence, current ?? undefined);
        if (current && selected.length) {
          const currentSources = selected.map((position) => current[position]);
          if (currentSources.some((message) => !message?.content)) throw new CoreError("suppressed");
          const currentProofs = await captureProofs(copy, currentSources);
          if (!currentProofs || selected.some((position, index) =>
            currentProofs[index].content_mac !== proofs?.[position]?.content_mac)) throw new CoreError("suppressed");
        }
      });
    },
  };
}

/** @param {CaptureMessage[] | null | undefined} messages */
function isBlankOutbox(messages) {
  return !!messages?.length && messages.every(({ content }) => content === "");
}

/** @param {string} value */
function requestIdentifier(value) {
  // Avoid cutting a surrogate pair at the stored-request length limit.
  return value.slice(0, 200).replace(/[\uD800-\uDBFF]$/u, "");
}

/** @param {CaptureKey} key @param {CaptureMessage[]} batch */
function encodeRequest(key, batch) {
  if (batch.length > 24) throw new CoreError("invalid_input");
  /** @type {Record<number, {id?: string, occurredAtMs?: number}>} */
  const metadata = {};
  const ids = new Set(batch.map(({ id }) => id));
  const messages = batch.map(({ id, role, content, occurredAtMs }, index) => {
    let storedId = id;
    if (id.length === 0 || id.length > 200) {
      storedId = `message-${index}`;
      while (ids.has(storedId)) storedId += "-";
      ids.add(storedId);
      metadata[index] = { id };
    }
    const occurredAt = occurredAtMs === null ? null : hostedTime(occurredAtMs);
    if (occurredAt === null && occurredAtMs !== null) {
      metadata[index] = { ...metadata[index], occurredAtMs };
    }
    return { id: storedId, role, content, ...(occurredAt === null ? {} : { occurred_at: occurredAt }) };
  });
  const request = {
    client: requestIdentifier(key.client), event_id: requestIdentifier(key.eventId).padEnd(8, "-"),
    session_id: requestIdentifier(key.sessionId), messages,
    ...(messages.length ? {} : { boundary: "SessionEnd" }),
  };
  return {
    raw: jsonbSource(request),
    metadata: Object.keys(metadata).length ? jsonbSource(metadata) : null,
  };
}

/** @param {Query} query @param {Omit<CaptureKey, "payloadDigest">} selection @param {string | null} namespace */
async function loadAdmission(query, selection, namespace) {
  const { rows: [row] } = await query(LOAD, [...identity(selection), selection.sessionId, namespace]);
  if (!row) return null;
  const { raw_request: raw, core_payload_digest: payloadDigest, core_outbox_metadata: extra } = row;
  return { key: { ...selection, scope: { owner: selection.scope.owner, namespace }, payloadDigest },
    messages: decodeOutboxMessages(raw, extra) };
}

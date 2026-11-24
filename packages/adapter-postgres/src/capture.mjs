import { CoreError, isErrorCode } from "../../core/src/index.mjs";
import { copyFinishItems, finishMemories, readIndexRevision, trackFinish } from "./capture-finish.mjs";
import {
  clockMs, copyKey, copyMessages, copyPositions, copyScope, decodeOutboxMessages, hostedTime, identifier, jsonbSource, readFailure,
  readInput, readLease, readSelection, readToken,
} from "./capture-input.mjs";
import { pauseLockedWrite } from "./capture-lock.mjs";
import { createCaptureProofs, filterSources } from "./capture-source.mjs";
import { createPostgresMemoryStore } from "./memory-store.mjs";
import { requireLiveRun, runOperation } from "./uow.mjs";

/** @import { CaptureClaim, CaptureFinish, CaptureKey, FinishResult, SourceFilter } from "../../core/src/ports/capture.d.ts" */
/** @import { CaptureMessage } from "../../core/src/ports/capture.d.ts" */
/** @import { Tx } from "../../core/src/ports/unit-of-work.d.ts" */
/** @import { CaptureOptions } from "./capture.d.mts" */
/** @import { Connection } from "./driver.mjs" */
/** @typedef {Required<CaptureClaim> & SourceFilter & CaptureFinish} CapturePorts */
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
const ABANDON = `UPDATE capture_events SET core_lease_token = NULL, core_lease_expires_at_ms = NULL,
    core_lease_sources = NULL, core_dispatched = false, core_failure_code = $3,
    core_abandoned_tokens = array_append(core_abandoned_tokens, $2::uuid) WHERE ${TOKEN}`;
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

/** @param {Query} query @param {CaptureKey} key @param {CaptureMessage[]} [batch]
 * @returns {Promise<CaptureRow | undefined>}
 */
async function reserveEvent(query, key, batch) {
  const params = identity(key);
  const select = SELECT_EVENT + " FOR UPDATE";
  const { rows: [existing] } = await query(select, params);
  if (existing) return existing;
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
    async claim(tx, key, messages, options) {
      return pauseLockedWrite(tx, () => {
        const copy = copyKey(tx, key);
        const batch = copyMessages(messages);
        const leaseMs = readLease(options);
        return async (query) => {
          const row = await reserveEvent(query, copy);
          if (row) {
            const retry = storedRetry(row, copy);
            if (retry) return retry;
            if (row.core_failure_code !== null) return { status: "duplicate" };
          }
          const current = clockMs(now());
          if (row && hasLiveLease(row, current)) return { status: "processing" };

          const source = row?.core_admitted ? await loadAdmission(query, copy, row.core_namespace) : null;
          if (row?.core_admitted && !source) throw new CoreError("internal_error");
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
      const { scope, source, batch, lease, revision, nowMs } = await pauseLockedWrite(tx, () => {
        const lease = readToken(token);
        const batch = copyFinishItems(items);
        return async (query) => {
          if (lease === null) throw new CoreError("stale_admission");
          const { row, nowMs } = await requireLiveToken(query, tx.owner, lease, now,
            `, status, core_namespace, client, session_id, core_admitted, core_lease_sources, raw_request, core_outbox_metadata`);
          if (row.status !== "pending" || !row.core_lease_sources) throw new CoreError("stale_admission");
          const scope = { owner: tx.owner, namespace: row.core_namespace };
          const source = { kind: /** @type {const} */ ("capture"), client: row.client, sessionId: row.session_id };
          const { proofs } = /** @type {NonNullable<CaptureRow["core_lease_sources"]>} */ (row.core_lease_sources);
          if (row.core_admitted) {
            const current = decodeOutboxMessages(row.raw_request, row.core_outbox_metadata);
            const currentProofs = await captureProofs({ scope, client: row.client }, current);
            const blankIds = new Set(current.filter(({ content }) => !content).map(({ id }) => id));
            if ((batch.length > 0 && blankIds.size > 0 && current.every(({ content }) => !content)) ||
                !proofs || !currentProofs || proofs.length !== currentProofs.length ||
                currentProofs.some((proof, i) => proof.message_mac !== proofs[i].message_mac || proof.content_mac !== proofs[i].content_mac) ||
                batch.some(({ receipts }) => receipts.some((receipt) => receipt.client === source.client &&
                  receipt.sessionId === source.sessionId && blankIds.has(receipt.messageId)))) {
              throw new CoreError("suppressed");
            }
          }
          const receiptSessions = new Map(batch.flatMap(({ receipts }) => receipts.map(({ client, sessionId }) =>
            [JSON.stringify([client, sessionId]), { scope, client, sessionId }])));
          for (const receiptSource of receiptSessions.values()) {
            const fromLease = receiptSource.client === source.client && receiptSource.sessionId === source.sessionId;
            await filterSources(query, receiptSource, [], fromLease ? proofs : [], "assert", captureProofs, hashSessionKey);
          }
          return { scope, source, batch, lease, revision: await readIndexRevision(query, tx.owner), nowMs };
        };
      });

      const { result, saved } = await finishMemories(tx, scope, source, batch, nowMs, memories, hashSessionKey);
      return runOperation(tx, async (query) => {
        const current = await readIndexRevision(query, tx.owner);
        // The memory store bumps per write. A capture publishes one revision for its whole batch.
        result.indexRevision = Math.min(current, revision + 1);
        if (current !== result.indexRevision) {
          await query("UPDATE core_owner_state SET index_revision = $2 WHERE user_id = $1", [tx.owner, result.indexRevision]);
        }
        const { rows: [completed] } = await query(COMPLETE, [tx.owner, lease, saved, JSON.stringify(result)]);
        if (!completed) throw new CoreError("stale_admission");
        trackFinish(tx, completed.client, completed.event_id, result);
        return result;
      });
    },

    async admit(tx, key, messages) {
      return pauseLockedWrite(tx, () => {
        const copy = copyKey(tx, key);
        const batch = copyMessages(messages);
        return async (query) => {
          const row = await reserveEvent(query, copy, batch);
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
        await captureProofs(copy, batch), "read", captureProofs, hashSessionKey));
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
        await filterSources(query, copy, selectedTimes, proofs, "assert", captureProofs, hashSessionKey);
        if (row.core_admitted && selected.length) {
          const current = decodeOutboxMessages(row.raw_request, row.core_outbox_metadata);
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

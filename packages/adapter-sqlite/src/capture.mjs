import { CoreError, isErrorCode } from "@cairn-ink/core";
import { finishCapture, validateFinishItems } from "./capture-finish.mjs";
import { decodeJson } from "./memory-rows.mjs";
import { readPause } from "./pause.mjs";
import { invalidInput, ownerKey, scopeKey, writeTime } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { CaptureClaim, CaptureFinish, CaptureKey, CaptureMessage, FinishResult, Scope, SourceFilter } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {Pick<CaptureKey, "scope" | "client" | "eventId">} Identity */
/** @typedef {ReturnType<typeof import("./index-revisions.mjs").createIndexRevisions>} IndexRevisions */

const identityColumns = "owner_id, namespace_key, client_key, event_key";
const identityWhere = "owner_id = ? AND namespace_key = ? AND client_key = ? AND event_key = ?";
const clearLease = "token = NULL, expires_at_ms = NULL, dispatched = 0, source_times = NULL";
const claimWrite = { write: true, pauseLock: true };
const selectClaim = `SELECT namespace_key, client_key, event_key, session_key, payload_digest,
    status, token, CAST(expires_at_ms AS TEXT) AS expires, source_times, messages, result
  FROM cairn_capture_claims LEFT JOIN cairn_capture_outbox USING (${identityColumns})`;

/** @param {Identity} key */
function claimIdentity({ scope, client, eventId }) {
  return /** @type {const} */ ([...scopeKey(scope), JSON.stringify(requiredString(client)), JSON.stringify(requiredString(eventId))]);
}

/** @param {unknown} value */
function requiredString(value) {
  if (typeof value !== "string" || !value) invalidInput();
  return value;
}

/** @param {CaptureKey} key @param {Scope} scope @returns {CaptureKey} */
function captureKey({ client, eventId, sessionId, payloadDigest }, scope) {
  if (typeof payloadDigest !== "string" || !/^[0-9a-f]{64}$/u.test(payloadDigest)) invalidInput();
  return { scope, client: requiredString(client), eventId: requiredString(eventId),
    sessionId: requiredString(sessionId), payloadDigest };
}

/** @template T @param {readonly T[]} input @returns {T[]} */
function copyBatch(input) {
  if (!Array.isArray(input)) invalidInput();
  const copy = [];
  for (let i = 0, length = input.length; i < length; i++) {
    const slot = Object.getOwnPropertyDescriptor(input, i);
    if (!slot || !Object.hasOwn(slot, "value")) invalidInput();
    copy.push(slot.value);
  }
  return copy;
}

/** @param {readonly CaptureMessage[]} messages */
function copyMessages(messages) {
  return copyBatch(messages).map(message => {
    if (!message) invalidInput();
    const { id, role, content, occurredAtMs } = message;
    if (typeof id !== "string" || id.length > 512 || (role !== "user" && role !== "assistant") ||
        typeof content !== "string" || (occurredAtMs !== null && !Number.isSafeInteger(occurredAtMs))) invalidInput();
    return { id, role, content, occurredAtMs };
  });
}

/** @param {Connection} db @param {Identity} key */
function readClaim(db, key) {
  return db.prepare(`${selectClaim} WHERE ${identityWhere}`).get(...claimIdentity(key));
}

/** @typedef {NonNullable<ReturnType<typeof readClaim>>} ClaimRow */

/** @param {ClaimRow} row @param {string} owner @returns {CaptureKey} */
function storedKey(row, owner) {
  return {
    scope: { owner, namespace: decodeJson(row.namespace_key) },
    client: decodeJson(row.client_key), eventId: decodeJson(row.event_key), sessionId: decodeJson(row.session_key),
    payloadDigest: String(row.payload_digest),
  };
}

/** @param {ClaimRow | undefined} row @param {CaptureKey} key */
function assertSamePayload(row, key) {
  if (row && (row.session_key !== JSON.stringify(key.sessionId) || row.payload_digest !== key.payloadDigest)) {
    throw new CoreError("event_payload_conflict");
  }
}

/** @param {ClaimRow | undefined} row @param {number} nowMs */
function active(row, nowMs) {
  return row?.status === "leased" && BigInt(String(row.expires)) > BigInt(nowMs);
}

/** @param {Connection} db @param {string} owner @param {string} token @param {number} nowMs */
function liveClaim(db, owner, token, nowMs) {
  if (typeof token !== "string") invalidInput();
  const row = db.prepare(`${selectClaim} WHERE owner_id = ? AND token = ?`).get(ownerKey(owner), token);
  if (!row || !active(row, nowMs)) throw new CoreError("stale_admission");
  return row;
}

/** @param {ClaimRow} row @param {IndexRevisions} index @param {import("@cairn-ink/core/ports").Tx} tx */
function replay(row, index, tx) {
  if (typeof row.result !== "string") throw new CoreError("internal_error");
  const result = /** @type {FinishResult} */ (decodeJson(row.result));
  return /** @type {const} */ ({ status: "rawReplay", result: index.project(tx, claimIdentity(storedKey(row, tx.owner)), result) });
}

/** @param {Connection} db @param {string} owner */
function assertUnpaused(db, owner) {
  if (readPause(db, owner).paused) throw new CoreError("capture_paused");
}

/** @param {Connection} db @param {CaptureKey} key @param {"pending" | "leased"} status */
function insertClaim(db, key, status, /** @type {bigint | null} */ expires, /** @type {string | null} */ sourceTimes) {
  return db.prepare(`INSERT INTO cairn_capture_claims
    (${identityColumns}, session_key, payload_digest, status, token, expires_at_ms, source_times)
    VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'leased' THEN lower(hex(randomblob(16))) END, ?, ?) RETURNING token`)
    .get(...claimIdentity(key), JSON.stringify(key.sessionId), key.payloadDigest, status, status, expires, sourceTimes);
}

/** @param {Connection} db @param {CaptureKey} key @param {readonly (number | null)[]} times @param {SessionHasher} hashSession */
function sourcePolicy(db, { scope, client, sessionId }, times, hashSession) {
  const policy = scopedSuppression(db, scope, hashSession);
  if (policy.blocksSession(client, sessionId)) return { blockedSession: true, blockedMessages: [] };
  return policy.snapshot({ client, sessionId, occurredAtMs: [...times] });
}

/** @param {Port} port @param {SessionHasher} hashSession @param {IndexRevisions} index @param {() => number} [now]
 * @returns {Required<CaptureClaim> & CaptureFinish & SourceFilter}
 */
export function createCapturePorts(port, hashSession, index, now = Date.now) {
  const time = () => writeTime(now()).updatedAtMs;
  return {
    admit(tx, input, messages) {
      const scope = input?.scope;
      return port(tx, scope?.owner, claimWrite, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: scope.namespace });
        const batch = copyMessages(messages);
        const row = readClaim(db, key);
        assertSamePayload(row, key);
        if (row?.status === "done") return replay(row, index, tx);
        if (active(row, time())) return { status: "processing" };
        if (row) return { status: "duplicate" };
        assertUnpaused(db, tx.owner);
        insertClaim(db, key, "pending", null, null);
        db.prepare(`INSERT INTO cairn_capture_outbox (${identityColumns}, messages) VALUES (?, ?, ?, ?, ?)`)
          .run(...claimIdentity(key), JSON.stringify(batch));
        return { status: "admitted" };
      });
    },

    load(tx, input) {
      const scope = input?.scope;
      return port(tx, scope?.owner, {}, db => {
        const session = JSON.stringify(requiredString(input.sessionId));
        const selection = { owner: tx.owner, namespace: scope.namespace };
        const row = readClaim(db, { scope: selection, client: input.client, eventId: input.eventId });
        if (typeof row?.messages !== "string" || row.session_key !== session) return null;
        return { key: storedKey(row, tx.owner), messages: decodeJson(row.messages) };
      });
    },

    status(tx, scope, eventId, client) {
      return port(tx, scope?.owner, {}, db => {
        const keys = [...scopeKey({ owner: tx.owner, namespace: scope.namespace }), JSON.stringify(requiredString(eventId))];
        if (client !== undefined) keys.push(JSON.stringify(requiredString(client)));
        const row = db.prepare(`SELECT status, failure_code
          FROM cairn_capture_claims JOIN cairn_capture_outbox USING (${identityColumns})
          WHERE owner_id = ? AND namespace_key = ? AND event_key = ? AND messages IS NOT NULL
            ${client === undefined ? "" : "AND client_key = ?"}
          ORDER BY CASE status WHEN 'done' THEN 2 WHEN 'failed' THEN 1 ELSE 0 END, client_key LIMIT 1`).get(...keys);
        if (!row) return { status: "unknown" };
        if (row.status === "failed") return { status: "failed", code: String(row.failure_code) };
        return { status: row.status === "done" ? "done" : "pending" };
      });
    },

    claim(tx, input, messages, options) {
      const scope = input?.scope;
      return port(tx, scope?.owner, claimWrite, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: scope.namespace });
        const copied = copyMessages(messages);
        const leaseMs = options?.leaseMs;
        if (!options || Array.isArray(options) || !Number.isSafeInteger(leaseMs) || leaseMs <= 0) invalidInput();
        const row = readClaim(db, key);
        assertSamePayload(row, key);
        if (row?.status === "done") return replay(row, index, tx);
        if (row?.status === "failed") return { status: "duplicate" };
        const nowMs = time();
        if (active(row, nowMs)) return { status: "processing" };
        assertUnpaused(db, tx.owner);
        /** @type {CaptureMessage[]} */
        const batch = typeof row?.messages === "string" ? decodeJson(row.messages) : copied;
        const times = JSON.stringify(batch.map(message => message.occurredAtMs));
        const expires = BigInt(nowMs) + BigInt(leaseMs);
        const leased = row ? db.prepare(`UPDATE cairn_capture_claims SET status = 'leased',
          token = lower(hex(randomblob(16))), expires_at_ms = ?, source_times = ?, dispatched = 0, failure_code = NULL
          WHERE ${identityWhere} RETURNING token`).get(expires, times, ...claimIdentity(key))
          : insertClaim(db, key, "leased", expires, times);
        if (typeof leased?.token !== "string") throw new CoreError("internal_error");
        return { status: "claimed", token: leased.token };
      });
    },

    beginDispatch(tx, token) {
      return port(tx, tx?.owner, claimWrite, db => {
        const row = liveClaim(db, tx.owner, token, time());
        assertUnpaused(db, tx.owner);
        db.prepare(`UPDATE cairn_capture_claims SET dispatched = 1 WHERE ${identityWhere} AND dispatched = 0`)
          .run(...claimIdentity(storedKey(row, tx.owner)));
        return { token };
      });
    },

    abandon(tx, token, failure) {
      return port(tx, tx?.owner, claimWrite, db => {
        if (typeof token !== "string" || !failure) invalidInput();
        const { code, retryable } = failure;
        if (!isErrorCode(code) || typeof retryable !== "boolean") invalidInput();
        if (db.prepare("SELECT 1 FROM cairn_capture_abandoned_tokens WHERE owner_id = ? AND token = ?")
          .get(ownerKey(tx.owner), token)) return;
        const row = liveClaim(db, tx.owner, token, time());
        const identity = claimIdentity(storedKey(row, tx.owner));
        db.prepare(`INSERT INTO cairn_capture_abandoned_tokens (${identityColumns}, token) VALUES (?, ?, ?, ?, ?)`)
          .run(...identity, token);
        db.prepare(`UPDATE cairn_capture_claims SET status = ?, ${clearLease}, failure_code = ? WHERE ${identityWhere}`)
          .run(retryable ? "retryable" : "failed", code, ...identity);
      });
    },

    finish(tx, token, items) {
      return port(tx, tx?.owner, claimWrite, db => {
        const batch = validateFinishItems(copyBatch(items));
        const nowMs = time();
        const row = liveClaim(db, tx.owner, token, nowMs);
        assertUnpaused(db, tx.owner);
        const key = storedKey(row, tx.owner);
        const finished = finishCapture(db, key, batch, nowMs, hashSession);
        const identity = claimIdentity(key);
        const result = { indexRevision: index.finish(db, tx, identity, finished.memories.length > 0), ...finished };
        db.prepare(`INSERT INTO cairn_capture_outbox (${identityColumns}, result) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (${identityColumns}) DO UPDATE SET result = excluded.result`)
          .run(...identity, JSON.stringify(result));
        db.prepare(`UPDATE cairn_capture_claims SET status = 'done', ${clearLease} WHERE ${identityWhere}`).run(...identity);
        return index.project(tx, identity, result);
      });
    },

    eligible(tx, input, messages) {
      const scope = input?.scope;
      return port(tx, scope?.owner, {}, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: scope.namespace });
        const times = copyMessages(messages).map(message => message.occurredAtMs);
        const { blockedSession, blockedMessages } = sourcePolicy(db, key, times, hashSession);
        if (blockedSession) return [];
        const blocked = new Set(blockedMessages);
        return Array.from(times.keys()).filter(position => !blocked.has(position));
      });
    },

    assertEligible(tx, input, positions) {
      const scope = input?.scope;
      return port(tx, scope?.owner, { write: true }, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: scope.namespace });
        const selected = copyBatch(positions);
        if (new Set(selected).size !== selected.length ||
            selected.some(position => !Number.isSafeInteger(position) || position < 0)) invalidInput();
        const row = readClaim(db, key);
        assertSamePayload(row, key);
        if (!row || !active(row, time())) throw new CoreError("stale_admission");
        /** @type {(number | null)[]} */
        const times = decodeJson(row.source_times);
        if (selected.some(position => position >= times.length)) invalidInput();
        const { blockedSession, blockedMessages } = sourcePolicy(db, key, selected.map(position => times[position]), hashSession);
        if (blockedSession || blockedMessages.length) throw new CoreError("suppressed");
      });
    },
  };
}

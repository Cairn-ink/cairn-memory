import { CoreError, isErrorCode } from "@cairn-ink/core";
import { finishCapture, validateFinishItems } from "./capture-finish.mjs";
import { decodeJson } from "./memory-rows.mjs";
import { readPause } from "./pause.mjs";
import { rawFactPolicy } from "./raw-facts.mjs";
import { blocksRawSession, hasRawFence } from "./raw-lineage.mjs";
import { invalidInput, ownerKey, scopeKey, writeTime } from "./storage-values.mjs";
import { readFacts } from "./suppressions.mjs";

/** @import { CaptureClaim, CaptureFinish, CaptureKey, CaptureMessage, FinishResult, Scope, SourceFilter, Tx } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @typedef {Pick<CaptureKey, "scope" | "client" | "eventId">} Identity */
/** @typedef {ReturnType<typeof import("./index-revisions.mjs").createIndexRevisions>} IndexRevisions */
/** @typedef {ReturnType<typeof import("./raw-lineage.mjs").createRawLineage>} Lineage */
/** @import { MigratedRawPolicy } from "./migrate/raw-privacy.mjs" */
/** @import { MigratedCaptureControls } from "./migrate/capture-controls.mjs" */
/** @typedef {Pick<CaptureMessage, "id" | "occurredAtMs">} SourcePosition */

const identityColumns = "owner_id, client_key, event_key";
const identityWhere = "owner_id = ? AND client_key = ? AND event_key = ?";
const clearLease = "token = NULL, expires_at_ms = NULL, dispatched = 0, source_positions = NULL, source_proofs = NULL";
const claimWrite = { write: true, pauseLock: true };
const selectClaim = `SELECT namespace_key, client_key, event_key, session_key, payload_digest,
    status, token, CAST(expires_at_ms AS TEXT) AS expires, source_positions, source_proofs, messages, result
  FROM cairn_capture_claims LEFT JOIN cairn_capture_outbox USING (${identityColumns})`;

/** @param {Identity} key */
function claimIdentity({ scope, client, eventId }) {
  return /** @type {const} */ ([ownerKey(scope.owner), JSON.stringify(requiredString(client)), JSON.stringify(requiredString(eventId))]);
}

/** @param {unknown} value */
function requiredString(value) {
  if (typeof value !== "string" || !value) invalidInput();
  return value;
}

/** @param {CaptureKey} key @param {Scope} scope @returns {CaptureKey} */
export function captureKey({ client, eventId, sessionId, payloadDigest }, scope) {
  scopeKey(scope);
  if (typeof payloadDigest !== "string" || !/^[0-9a-f]{64}$/u.test(payloadDigest)) invalidInput();
  return { scope, client: requiredString(client), eventId: requiredString(eventId),
    sessionId: requiredString(sessionId), payloadDigest };
}

/** @template T @param {readonly T[]} input @returns {T[]} */
export function copyBatch(input) {
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
export function copyMessages(messages) {
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

/** @param {ClaimRow | undefined} row @param {CaptureKey} key @param {Lineage} lineage */
function outboxSources(row, key, lineage) {
  if (typeof row?.messages !== "string") return null;
  /** @type {CaptureMessage[]} */
  const messages = decodeJson(row.messages);
  const proofs = lineage.proofs(key.scope.owner, key.client, messages);
  const leased = row.status === "leased";
  /** @type {SourcePosition[] | null} */
  const admitted = leased ? decodeJson(row.source_positions) : null;
  /** @type {typeof proofs | null} */
  const admittedProofs = leased ? decodeJson(row.source_proofs) : null;
  return {
    messages, proofs,
    /** @param {number} position */
    matchesClaim(position) {
      if (!leased) return true;
      const message = messages[position];
      const proof = proofs[position];
      const saved = admitted?.[position];
      const savedProof = admittedProofs?.[position];
      return message !== undefined && saved !== undefined && savedProof !== undefined &&
        message.id === saved.id && message.occurredAtMs === saved.occurredAtMs &&
        proof[0] === savedProof[0] && proof[1] === savedProof[1];
    },
  };
}

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

/** @param {Connection} db @param {CaptureKey} key @param {"pending" | "leased"} status
 * @param {bigint | null} expires @param {string | null} positions @param {string | null} proofs
 */
function insertClaim(db, key, status, expires, positions, proofs) {
  return db.prepare(`INSERT INTO cairn_capture_claims
    (${identityColumns}, namespace_key, session_key, payload_digest, status, token, expires_at_ms, source_positions, source_proofs)
    VALUES (?, ?, ?, ?, ?, ?, ?, CASE WHEN ? = 'leased' THEN lower(hex(randomblob(16))) END, ?, ?, ?) RETURNING token`)
    .get(...claimIdentity(key), JSON.stringify(key.scope.namespace), JSON.stringify(key.sessionId),
      key.payloadDigest, status, status, expires, positions, proofs);
}

/** @param {Connection} db @param {CaptureKey} key @param {SessionHasher} hashSession */
function sourcePolicy(db, key, hashSession) {
  const { scope, client } = key;
  const facts = readFacts(db, scope);
  const policy = rawFactPolicy(scope, key, facts, hashSession);
  return {
    blockedSession: blocksRawSession(scope, client, policy.sessionKeyHash, facts),
    blocks: (/** @type {SourcePosition} */ position) => policy.refusesSource(position, true),
  };
}

/** @param {Port} port @param {SessionHasher} hashSession @param {IndexRevisions} index @param {Lineage} lineage
 * @param {() => number} [now]
 * @param {MigratedRawPolicy} [migratedRaw]
 * @param {MigratedCaptureControls} [controls]
 * @param {ReturnType<typeof import("./uow.mjs").openAdapterUnitOfWork>["preserveArrivalRefusal"]} [preserveArrivalRefusal]
 * @returns {Required<CaptureClaim> & CaptureFinish & SourceFilter}
 */
export function createCapturePorts(port, hashSession, index, lineage, now = Date.now, migratedRaw, controls, preserveArrivalRefusal) {
  const time = () => writeTime(now()).updatedAtMs;
  /** @type {WeakMap<Tx, Map<string, Set<number>>>} */
  const selections = new WeakMap();

  /** @param {Connection} db @param {import("@cairn-ink/core/ports").Tx} tx
   * @param {CaptureKey} key @param {readonly SourcePosition[]} positions @param {boolean} [arrival] */
  function requireMigratedSources(db, tx, key, positions, arrival = false) {
    if (migratedRaw?.blocksEvent(db, key)) throw new CoreError("lineage_fenced");
    if (!migratedRaw?.blocks(db, key.scope, key, positions)) return;
    if (arrival) preserveArrivalRefusal?.(tx, writer => migratedRaw.fenceArrival(writer, key.scope, key, positions));
    throw new CoreError("lineage_fenced");
  }
  return {
    admit(tx, input, messages) {
      const scope = input?.scope;
      return port(tx, scope?.owner, claimWrite, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: scope.namespace });
        controls?.assertCapture(key);
        const batch = copyMessages(messages);
        const row = readClaim(db, key);
        assertSamePayload(row, key);
        if (row?.status === "done") return replay(row, index, tx);
        if (active(row, time())) return { status: "processing" };
        if (row) return { status: "duplicate" };
        assertUnpaused(db, tx.owner);
        requireMigratedSources(db, tx, key, batch, true);
        controls?.assertOpenAdmission(db, key);
        insertClaim(db, key, "pending", null, null, null);
        db.prepare(`INSERT INTO cairn_capture_outbox (${identityColumns}, messages) VALUES (?, ?, ?, ?)`)
          .run(...claimIdentity(key), JSON.stringify(batch));
        return { status: "admitted" };
      });
    },

    load(tx, input) {
      const scope = input?.scope;
      return port(tx, scope?.owner, {}, db => {
        const session = JSON.stringify(requiredString(input.sessionId));
        const selection = { owner: tx.owner, namespace: scope.namespace };
        const [, namespace] = scopeKey(selection);
        const row = readClaim(db, { scope: selection, client: input.client, eventId: input.eventId });
        if (typeof row?.messages !== "string" || row.namespace_key !== namespace || row.session_key !== session) return null;
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
          ORDER BY CASE status WHEN 'done' THEN 2 WHEN 'failed' THEN 1 ELSE 0 END, cairn_capture_outbox.rowid LIMIT 1`).get(...keys);
        if (!row) return { status: "unknown" };
        if (row.status === "failed") return { status: "failed", code: String(row.failure_code) };
        return { status: row.status === "done" ? "done" : "pending" };
      });
    },

    claim(tx, input, messages, options) {
      const scope = input?.scope;
      return port(tx, scope?.owner, claimWrite, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: scope.namespace });
        controls?.assertCapture(key);
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
        requireMigratedSources(db, tx, key, batch, true);
        controls?.assertOpenAdmission(db, key);
        const positions = JSON.stringify(batch.map(({ id, occurredAtMs }) => ({ id, occurredAtMs })));
        const proofs = JSON.stringify(lineage.proofs(tx.owner, key.client, batch));
        const expires = BigInt(nowMs) + BigInt(leaseMs);
        const leased = row ? db.prepare(`UPDATE cairn_capture_claims SET status = 'leased',
          token = lower(hex(randomblob(16))), expires_at_ms = ?, source_positions = ?, source_proofs = ?, dispatched = 0, failure_code = NULL
          WHERE ${identityWhere} RETURNING token`).get(expires, positions, proofs, ...claimIdentity(key))
          : insertClaim(db, key, "leased", expires, positions, proofs);
        if (typeof leased?.token !== "string") throw new CoreError("internal_error");
        return { status: "claimed", token: leased.token };
      });
    },

    beginDispatch(tx, token) {
      return port(tx, tx?.owner, claimWrite, db => {
        const row = liveClaim(db, tx.owner, token, time());
        assertUnpaused(db, tx.owner);
        const key = storedKey(row, tx.owner);
        controls?.assertCapture(key);
        if (migratedRaw) requireMigratedSources(db, tx, key, decodeJson(row.source_positions));
        db.prepare(`UPDATE cairn_capture_claims SET dispatched = 1 WHERE ${identityWhere} AND dispatched = 0`)
          .run(...claimIdentity(key));
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
        db.prepare(`INSERT INTO cairn_capture_abandoned_tokens (${identityColumns}, token) VALUES (?, ?, ?, ?)`)
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
        controls?.assertCapture(key);
        if (migratedRaw) requireMigratedSources(db, tx, key, decodeJson(row.source_positions));
        const identity = claimIdentity(key);
        if (batch.some(({ receipts }) => receipts.length > 0)) {
          const selected = selections.get(tx)?.get(JSON.stringify(identity));
          if (!selected?.size) throw new CoreError("suppressed");
          /** @type {SourcePosition[]} */
          const sources = decodeJson(row.source_positions);
          /** @type {Map<string, number | null>} */
          const positions = new Map();
          for (const [position, { id }] of sources.entries()) {
            positions.set(id, positions.has(id) ? null : position);
          }
          for (const { receipts } of batch) {
            for (const { client, sessionId, messageId } of receipts) {
              const position = positions.get(messageId);
              if (client !== key.client || sessionId !== key.sessionId ||
                  position == null || !selected.has(position)) throw new CoreError("suppressed");
            }
          }
        }
        const finished = finishCapture(db, key, batch, nowMs, hashSession);
        const result = { indexRevision: index.finish(db, tx, identity, finished.memories.length > 0), ...finished };
        db.prepare(`INSERT INTO cairn_capture_outbox (${identityColumns}, result) VALUES (?, ?, ?, ?)
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
        controls?.assertCapture(key);
        const batch = copyMessages(messages);
        const row = db.prepare(`${selectClaim} WHERE ${identityWhere} AND namespace_key = ?`)
          .get(...claimIdentity(key), JSON.stringify(key.scope.namespace));
        if (row && (row.session_key !== JSON.stringify(key.sessionId) || row.payload_digest !== key.payloadDigest)) return [];
        const current = outboxSources(row, key, lineage);
        const { blockedSession, blocks } = sourcePolicy(db, key, hashSession);
        if (blockedSession || migratedRaw?.blocksEvent(db, key) || migratedRaw?.blocks(db, key.scope, key, batch) ||
            lineage.fenced(db, key.scope, key, lineage.proofs(tx.owner, key.client, batch), batch)) return [];
        return Array.from(batch.keys()).filter(position => {
          const message = batch[position];
          const slot = current?.messages[position];
          if (current && (!slot?.content || slot.content !== message.content || slot.id !== message.id ||
              slot.role !== message.role || slot.occurredAtMs !== message.occurredAtMs ||
              !current.matchesClaim(position))) return false;
          return !blocks(message) && !migratedRaw?.blocksSpan(db, key.scope, key, message.id);
        });
      });
    },

    assertEligible(tx, input, positions) {
      const scope = input?.scope;
      return port(tx, scope?.owner, { write: true }, db => {
        const key = captureKey(input, { owner: tx.owner, namespace: scope.namespace });
        controls?.assertCapture(key);
        const selected = copyBatch(positions);
        const asserted = new Set(selected);
        if (asserted.size !== selected.length ||
            selected.some(position => !Number.isSafeInteger(position) || position < 0)) invalidInput();
        const row = readClaim(db, key);
        // Only the original namespace can recheck the lease's sources.
        if (row && row.namespace_key !== JSON.stringify(key.scope.namespace)) throw new CoreError("stale_admission");
        assertSamePayload(row, key);
        if (!row || !active(row, time())) throw new CoreError("stale_admission");
        /** @type {SourcePosition[]} */
        const sources = decodeJson(row.source_positions);
        requireMigratedSources(db, tx, key, sources);
        if (selected.some(position => position >= sources.length)) invalidInput();
        const { blockedSession, blocks } = sourcePolicy(db, key, hashSession);
        if (blockedSession || selected.some(position => blocks(sources[position]) ||
            migratedRaw?.blocksSpan(db, key.scope, key, sources[position].id))) throw new CoreError("suppressed");
        const current = outboxSources(row, key, lineage);
        const identity = JSON.stringify(claimIdentity(key));
        if (current) {
          if (selected.some(position => current.messages[position]?.content === "")) throw new CoreError("suppressed");
          if (selected.some(position => !current.matchesClaim(position))) throw new CoreError("stale_admission");
          // Core can finish a deleted outbox with no sources after withdrawing every slot.
          if (selected.length === 0 && sources.length > 0 && current.messages.length === sources.length &&
              current.messages.every(({ content }) => content === "") &&
              hasRawFence(db, key.scope, hashSession(key.scope, key.client, key.sessionId))) {
            selections.get(tx)?.delete(identity);
            return;
          }
        }
        const proofs = current?.proofs ?? decodeJson(row.source_proofs);
        if (lineage.fenced(db, key.scope, key, proofs, sources)) throw new CoreError("lineage_fenced");
        let byClaim = selections.get(tx);
        if (!byClaim) selections.set(tx, byClaim = new Map());
        byClaim.set(identity, asserted);
      });
    },
  };
}

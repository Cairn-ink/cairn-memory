import { CoreError, decideWrite, planDuplicateMerge } from "@cairn-ink/core";
import { indexRevisionAfterRun } from "./unit-of-work.mjs";
import { copyCaptureFailure, copyCaptureKey, copyFinishItems, validateCaptureMessages, validateTime } from "./validation.mjs";

/** @typedef {import("@cairn-ink/core/ports").CaptureKey} CaptureKey */
/** @typedef {import("@cairn-ink/core/ports").FinishResult} FinishResult */
/** @typedef {import("@cairn-ink/core/ports").SourceRef} SourceRef */
/** @typedef {import("./unit-of-work.mjs").State} State */
/** @typedef {{status: "leased", expiresAtMs: number, token: string, dispatched: boolean}} Lease */
/** @typedef {{key: CaptureKey} & (Lease | {status: "finished", result: FinishResult} |
 * {status: "abandoned", failure: ReturnType<typeof copyCaptureFailure>})} ClaimRecord */

/** @param {State} state @param {string} token @param {number} nowMs */
function liveClaim(state, token, nowMs) {
  const identity = state.activeTokens.get(token);
  const claim = identity === undefined ? undefined : state.claims.get(identity);
  if (identity === undefined || claim?.status !== "leased" || !(nowMs < claim.expiresAtMs)) {
    throw new CoreError("stale_admission");
  }
  return { identity, claim };
}

/** @param {string} token */
function validateToken(token) {
  if (typeof token !== "string") throw new CoreError("invalid_input");
}

/** @param {FinishResult} stored @param {boolean} pending */
function copyResult(stored, pending) {
  const copy = structuredClone(stored);
  if (!pending) return copy;
  // A caller can read the committed revision from an early finish without sharing mutable data.
  let callerRevision = copy.indexRevision;
  let overridden = false;
  return {
    ...copy,
    get indexRevision() { return overridden ? callerRevision : stored.indexRevision; },
    set indexRevision(value) { callerRevision = value; overridden = true; },
  };
}

/**
 * @param {ReturnType<typeof import("./unit-of-work.mjs").createUnitOfWork>["port"]} port
 * @param {ReturnType<typeof import("./memory-store.mjs").createMemoryStore>} store
 * @param {() => number} now
 * @returns {import("@cairn-ink/core/ports").StorageAdapter["capture"]}
 */
export function createCapturePorts(port, { memories, finishWrites, counters }, now) {
  return {
    async claim(tx, key, messages, options) {
      return port.capture(tx, { owner: tx?.owner }, (getState, run) => {
        const copy = copyCaptureKey(key);
        const { scope: { owner, namespace }, client, eventId, sessionId, payloadDigest } = copy;
        if (owner !== tx.owner) throw new CoreError("internal_error");
        validateCaptureMessages(messages);
        if (!options || typeof options !== "object" || Array.isArray(options)) throw new CoreError("invalid_input");
        const { leaseMs } = options;
        if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new CoreError("invalid_input");

        const identity = JSON.stringify([owner, namespace, client, eventId]);
        const state = getState();
        const previous = state.claims.get(identity);
        if (previous && (previous.key.payloadDigest !== payloadDigest || previous.key.sessionId !== sessionId)) {
          throw new CoreError("event_payload_conflict");
        }
        if (previous?.status === "finished") {
          return { status: "rawReplay", result: copyResult(previous.result, run.finishes.has(previous.result)) };
        }
        if (previous?.status === "abandoned" && !previous.failure.retryable) return { status: "duplicate" };

        const nowMs = now();
        validateTime(nowMs);
        if (previous?.status === "leased" && nowMs < previous.expiresAtMs) return { status: "processing" };

        const token = crypto.randomUUID();
        if (previous?.status === "leased") state.activeTokens.delete(previous.token);
        state.claims.set(identity, { key: copy, status: "leased", token, expiresAtMs: nowMs + leaseMs, dispatched: false });
        state.activeTokens.set(token, identity);
        run.stateWritten = true;
        return { status: "claimed", token };
      });
    },

    async beginDispatch(tx, token) {
      return port.capture(tx, { owner: tx?.owner }, (getState, run) => {
        validateToken(token);
        const { claim } = liveClaim(getState(), token, now());
        if (!claim.dispatched) {
          claim.dispatched = true;
          run.stateWritten = true;
        }
        return { token };
      });
    },

    async abandon(tx, token, failure) {
      return port.capture(tx, { owner: tx?.owner }, (getState, run) => {
        validateToken(token);
        const copy = copyCaptureFailure(failure);
        const state = getState();
        if (state.abandonedTokens.has(token)) return;
        const { identity, claim } = liveClaim(state, token, now());
        state.claims.set(identity, { key: claim.key, status: "abandoned", failure: copy });
        state.activeTokens.delete(token);
        state.abandonedTokens.add(token);
        run.stateWritten = true;
      });
    },

    async finish(tx, token, items) {
      return port.capture(tx, { owner: tx?.owner }, async (getState, run) => {
        validateToken(token);
        const batch = copyFinishItems(items);
        const nowMs = now();
        validateTime(nowMs);
        const writeTimeUs = BigInt(nowMs) * 1000n;
        const state = getState();
        const { identity, claim } = liveClaim(state, token, nowMs);
        const { scope, client, sessionId } = claim.key;
        /** @type {SourceRef} */
        const source = { kind: "capture", client, sessionId };
        const queries = batch.map(({ row }) => ({ textHash: row.textHash, embedding: row.embedding?.vector }));
        const policy = await memories.readWritePolicy(tx, scope, queries, source, "full");
        const progress = { inserted: new Map(), writeTimes: new Map() };
        /** @type {FinishResult["memories"]} */
        const written = [];
        let duplicateCount = 0;
        let suppressedCount = 0;

        for (const [position, { row, receipts }] of batch.entries()) {
          const decision = decideWrite(policy, position, progress);
          switch (decision.status) {
            case "suppressed":
              suppressedCount++;
              break;
            case "saved": {
              const { id, revision, updatedAtUs } = await finishWrites.insert(tx, scope, { ...row, source }, receipts, nowMs);
              progress.inserted.set(position, id);
              progress.writeTimes.set(id, updatedAtUs);
              written.push({ id, revision, outcome: "inserted" });
              break;
            }
            case "duplicate": {
              const { id } = decision;
              const existing = await memories.get(tx, scope, id);
              if (!existing) throw new CoreError("internal_error");
              const { merge } = planDuplicateMerge(existing, row);
              const { outcome, revision } = await finishWrites.touchDuplicate(tx, scope, id, receipts, merge, nowMs);
              progress.writeTimes.set(id, writeTimeUs);
              written.push({ id, revision, outcome });
              duplicateCount++;
              break;
            }
          }
        }

        if (written.length > 0) run.writingFinishes++;
        const stored = { indexRevision: indexRevisionAfterRun(run), memories: written, suppressedCount, duplicateCount,
          counters: counters() };
        const result = copyResult(stored, true);
        state.claims.set(identity, { key: claim.key, status: "finished", result: stored });
        state.activeTokens.delete(token);
        run.finishes.add(stored);
        run.stateWritten = true;
        return result;
      }, true);
    },

    // The privacy module's factBlocksIncoming will back these checks.
    async eligible() { throw new CoreError("capability_unavailable"); },
    async assertEligible() { throw new CoreError("capability_unavailable"); },
  };
}

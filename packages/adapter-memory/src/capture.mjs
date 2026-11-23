import { CoreError, decideWrite, planDuplicateMerge } from "@cairn-ink/core";
import { indexRevisionAfterRun } from "./unit-of-work.mjs";
import { captureMessageTimes, copyCaptureFailure, copyCaptureKey, copyFinishItems, validateTime } from "./validation.mjs";

/** @typedef {import("@cairn-ink/core/ports").CaptureKey} CaptureKey */
/** @typedef {import("@cairn-ink/core/ports").FinishResult} FinishResult */
/** @typedef {import("@cairn-ink/core/ports").SourceRef} SourceRef */
/** @typedef {import("./unit-of-work.mjs").State} State */
/** @typedef {{status: "leased", expiresAtMs: number, token: string, dispatched: boolean,
 * occurredAtMs: ReadonlyArray<number | null>}} Lease */
/** @typedef {{key: CaptureKey} & (Lease | {status: "finished", result: FinishResult} |
 * {status: "abandoned", failure: ReturnType<typeof copyCaptureFailure>})} ClaimRecord */

/** @param {CaptureKey} key */
function claimIdentity({ scope: { owner, namespace }, client, eventId }) {
  return JSON.stringify([owner, namespace, client, eventId]);
}

/** @param {ClaimRecord | undefined} claim @param {CaptureKey} key */
function assertClaimKey(claim, key) {
  if (claim && (claim.key.payloadDigest !== key.payloadDigest || claim.key.sessionId !== key.sessionId)) {
    throw new CoreError("event_payload_conflict");
  }
}

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
 * @param {ReturnType<typeof import("./fact-match.mjs").createFactMatcher>} matchFacts
 * @returns {import("@cairn-ink/core/ports").StorageAdapter["capture"]}
 */
export function createCapturePorts(port, { memories, finishWrites, readWritePolicy, counters }, now, matchFacts) {
  return {
    async claim(tx, key, messages, options) {
      return port.capture(tx, { owner: tx?.owner }, () => {
        const copy = copyCaptureKey(key);
        if (copy.scope.owner !== tx.owner) throw new CoreError("internal_error");
        const occurredAtMs = captureMessageTimes(messages);
        if (!options || typeof options !== "object" || Array.isArray(options)) throw new CoreError("invalid_input");
        const { leaseMs } = options;
        if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new CoreError("invalid_input");

        return (getState, run) => {
          const identity = claimIdentity(copy);
          const state = getState();
          const previous = state.claims.get(identity);
          assertClaimKey(previous, copy);
          if (previous?.status === "finished") {
            return { status: "rawReplay", result: copyResult(previous.result, run.finishes.has(previous.result)) };
          }
          if (previous?.status === "abandoned" && !previous.failure.retryable) return { status: "duplicate" };

          const nowMs = now();
          validateTime(nowMs);
          if (previous?.status === "leased" && nowMs < previous.expiresAtMs) return { status: "processing" };

          const token = crypto.randomUUID();
          if (previous?.status === "leased") state.activeTokens.delete(previous.token);
          state.claims.set(identity, {
            key: copy, status: "leased", token, expiresAtMs: nowMs + leaseMs, dispatched: false, occurredAtMs,
          });
          state.activeTokens.set(token, identity);
          run.stateWritten = true;
          return { status: "claimed", token };
        };
      });
    },

    async beginDispatch(tx, token) {
      return port.capture(tx, { owner: tx?.owner }, () => {
        validateToken(token);
        return (getState, run) => {
          const { claim } = liveClaim(getState(), token, now());
          if (!claim.dispatched) {
            claim.dispatched = true;
            run.stateWritten = true;
          }
          return { token };
        };
      });
    },

    async abandon(tx, token, failure) {
      return port.capture(tx, { owner: tx?.owner }, () => {
        validateToken(token);
        const copy = copyCaptureFailure(failure);
        return (getState, run) => {
          const state = getState();
          if (state.abandonedTokens.has(token)) return;
          const { identity, claim } = liveClaim(state, token, now());
          state.claims.set(identity, { key: claim.key, status: "abandoned", failure: copy });
          state.activeTokens.delete(token);
          state.abandonedTokens.add(token);
          run.stateWritten = true;
        };
      });
    },

    async finish(tx, token, items) {
      return port.capture(tx, { owner: tx?.owner }, () => {
        validateToken(token);
        const batch = copyFinishItems(items);
        return async (getState, run) => {
          const nowMs = now();
          validateTime(nowMs);
          const writeTimeUs = BigInt(nowMs) * 1000n;
          const state = getState();
          const { identity, claim } = liveClaim(state, token, nowMs);
          const { scope, client, sessionId } = claim.key;
          /** @type {SourceRef} */
          const source = { kind: "capture", client, sessionId };
          const queries = batch.map(({ row }) => ({ textHash: row.textHash, embedding: row.embedding?.vector }));
          const policy = await readWritePolicy(tx, scope, queries, source, "full");
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
        };
      });
    },

    async eligible(tx, key, messages) {
      const { scope, client, sessionId } = copyCaptureKey(key);
      const occurredAtMs = captureMessageTimes(messages);
      return port(tx, scope, false, (state) => {
        const matcher = matchFacts(state.facts, scope);
        if (matcher.blocksSession(client, sessionId)) return [];
        const blocked = new Set(matcher.blockedMessages(client, sessionId, occurredAtMs));
        return Array.from(occurredAtMs.keys()).filter((position) => !blocked.has(position));
      });
    },

    async assertEligible(tx, key, positions) {
      const copy = copyCaptureKey(key);
      const { scope, client, sessionId } = copy;
      return port.write(tx, scope, "conditional", () => {
        if (!Array.isArray(positions)) throw new CoreError("invalid_input");
        /** @type {Set<number>} */
        const selected = new Set();
        for (const position of positions) {
          if (!Number.isSafeInteger(position) || position < 0 || selected.has(position)) {
            throw new CoreError("invalid_input");
          }
          selected.add(position);
        }
        return (getState) => {
          const state = getState();
          const claim = state.claims.get(claimIdentity(copy));
          assertClaimKey(claim, copy);
          if (claim?.status !== "leased") throw new CoreError("stale_admission");
          const nowMs = now();
          validateTime(nowMs);
          if (!(nowMs < claim.expiresAtMs)) throw new CoreError("stale_admission");
          const occurredAtMs = Array.from(selected, (position) => {
            if (position >= claim.occurredAtMs.length) throw new CoreError("invalid_input");
            return claim.occurredAtMs[position];
          });
          const matcher = matchFacts(state.facts, scope);
          if (matcher.blocksSession(client, sessionId) || matcher.blockedMessages(client, sessionId, occurredAtMs).length) {
            throw new CoreError("suppressed");
          }
        };
      });
    },
  };
}

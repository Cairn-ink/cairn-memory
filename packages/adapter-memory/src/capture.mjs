import { cleanContent, CoreError, decideWrite, planDuplicateMerge, receiptExcerpt } from "@cairn-ink/core";
import { receiptAddressKey } from "./receipt-read-safety.mjs";
import { indexRevisionAfterRun } from "./unit-of-work.mjs";
import { admissionScope, copyCaptureFailure, copyCaptureMessages, copyCaptureSelection,
  copyFinishItems, copyReceipts, snapshotArray, validateTime, writeNamespace } from "./validation.mjs";

/** @import { CaptureMessage } from "@cairn-ink/core/ports" */
/** @typedef {import("@cairn-ink/core/ports").CaptureKey} CaptureKey */
/** @typedef {import("@cairn-ink/core/ports").FinishResult} FinishResult */
/** @typedef {import("@cairn-ink/core/ports").SourceRef} SourceRef */
/** @typedef {import("@cairn-ink/core/ports").Tx} Tx */
/** @typedef {import("./unit-of-work.mjs").State} State */
/** @typedef {Pick<ReturnType<typeof import("./raw.mjs").createRawPorts>, "captureProofs" | "hasRawFence" | "lineageFenced">} RawLineage */
/** @typedef {{status: "leased", expiresAtMs: number, token: string, dispatched: boolean,
 * messageIds: readonly string[], occurredAtMs: ReadonlyArray<number | null>,
 * proofs?: readonly import("./raw.mjs").CaptureProof[] | null}} Lease */
/** @typedef {{key: CaptureKey, messages?: CaptureMessage[], messageIds?: readonly string[]} & (Lease | {status: "pending"} |
 * {status: "finished", result: FinishResult} |
 * {status: "abandoned", failure: ReturnType<typeof copyCaptureFailure>})} ClaimRecord */

/** @param {string} client @param {string} eventId */
function captureIdentity(client, eventId) {
  // Claim records are already partitioned by owner.
  return JSON.stringify([client, eventId]);
}

/** @param {ClaimRecord | undefined} claim @param {CaptureKey} key */
function assertClaimKey(claim, key) {
  if (claim && (claim.key.payloadDigest !== key.payloadDigest || claim.key.sessionId !== key.sessionId)) {
    throw new CoreError("event_payload_conflict");
  }
}

/** @param {State["deletedMessages"]} deletedMessages @param {CaptureKey} key @param {string} messageId */
async function messageDeleted(deletedMessages, { scope, client, sessionId }, messageId) {
  return deletedMessages.has(await receiptAddressKey(scope.namespace, { client, sessionId, messageId }));
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
 * @param {boolean} embeddingRequiredOnInsert
 * @param {RawLineage | undefined} lineage
 * @param {{contextRead: boolean, documentCards: boolean, inspect: boolean}} flags
 * @returns {import("./index.d.mts").MemoryAdapter["capture"]}
 */
export function createCapturePorts(port, { memories, finishWrites, readWritePolicy }, now, matchFacts, embeddingRequiredOnInsert,
  lineage, { contextRead: retainReceipts, documentCards, inspect }) {
  /** @type {WeakMap<Tx, Map<string, Set<number>>>} */
  const selections = new WeakMap();
  return {
    async claim(tx, key, messages, options) {
      const scope = admissionScope(tx, key);
      return port.capture(tx, scope, () => {
        const copy = scope.copyKey();
        const copied = copyCaptureMessages(messages);
        if (!options || typeof options !== "object" || Array.isArray(options)) throw new CoreError("invalid_input");
        const { leaseMs } = options;
        if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new CoreError("invalid_input");

        return async (getState, run) => {
          const state = getState();
          const identity = captureIdentity(copy.client, copy.eventId);
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
          const admitted = previous?.messages;
          const batch = admitted ?? copied;
          // An admitted event is claimed with its stored outbox, so its proofs come from those messages.
          const proofMetadata = lineage && { proofs: await lineage.captureProofs(copy.scope, copy.client, batch) };
          if (previous?.status === "leased") state.activeTokens.delete(previous.token);
          state.claims.set(identity, {
            key: previous?.key ?? copy, messages: admitted, status: "leased", token,
            expiresAtMs: nowMs + leaseMs, dispatched: false,
            messageIds: batch.map(({ id }) => id),
            occurredAtMs: batch.map(({ occurredAtMs }) => occurredAtMs),
            ...proofMetadata,
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
          state.claims.set(identity, { key: claim.key, messages: claim.messages, messageIds: claim.messageIds,
            status: "abandoned", failure: copy });
          state.activeTokens.delete(token);
          state.abandonedTokens.add(token);
          run.stateWritten = true;
        };
      });
    },

    async finish(tx, token, items) {
      return port.capture(tx, { owner: tx?.owner }, () => {
        validateToken(token);
        const batch = copyFinishItems(items, embeddingRequiredOnInsert);
        return async (getState, run) => {
          const nowMs = now();
          validateTime(nowMs);
          const writeTimeUs = BigInt(nowMs) * 1000n;
          const state = getState();
          const { identity, claim } = liveClaim(state, token, nowMs);
          const { scope, client, sessionId, eventId } = claim.key;
          const selected = selections.get(tx)?.get(identity);
          /** @type {Map<string, number | null>} */
          const positions = new Map();
          for (const [position, id] of claim.messageIds.entries()) {
            positions.set(id, positions.has(id) ? null : position);
          }
          for (const { receipts } of batch) {
            for (const receipt of receipts) {
              const position = positions.get(receipt.messageId);
              if (receipt.client !== client || receipt.sessionId !== sessionId ||
                  position == null || !selected?.has(position)) throw new CoreError("suppressed");
            }
          }
          /** @type {SourceRef} */
          const source = { kind: "capture", client, sessionId };
          const queries = batch.map(({ row }) => ({
            textHash: row.textHash, digests: row.digests, embedding: row.embedding?.vector,
          }));
          const policy = await readWritePolicy(tx, scope, queries, source, "full");
          const progress = { inserted: new Map(), writeTimes: new Map() };
          /** @type {FinishResult["memories"]} */
          const written = [];
          /** @type {number[]} */
          const suppressedItems = [];
          let duplicateCount = 0;
          const retainCardLineage = documentCards && lineage !== undefined;
          const sources = retainReceipts || retainCardLineage
            ? new Map(claim.messages?.map(message => [message.id, message])) : undefined;

          for (const [position, { row, receipts: sourceRefs }] of batch.entries()) {
            const receipts = sources ? sourceRefs.map(receipt => {
              const { client: sourceClient, sessionId: sourceSession, messageId, role, occurredAtMs } = receipt;
              const retained = sources.get(messageId);
              const admitted = retained?.content && role === retained.role;
              if (!retainReceipts) {
                // Inspect assigns an ID to receipts with excerpts. Preserve their existing lineage rules.
                return admitted && !receipt.id && !(inspect && receipt.excerpt !== undefined)
                  ? { ...receipt, captureEventId: eventId } : receipt;
              }
              const link = { client: sourceClient, sessionId: sourceSession, messageId, role, occurredAtMs,
                ...(receipt.includeUnknownTime && { includeUnknownTime: receipt.includeUnknownTime }) };
              if (!admitted) return link;
              const excerpt = receiptExcerpt(cleanContent(retained.content));
              return { ...link, occurredAtMs: retained.occurredAtMs, ...(excerpt && { excerpt, captureEventId: eventId }) };
            }) : sourceRefs;
            const decision = decideWrite(policy, position, progress);
            switch (decision.status) {
              case "suppressed":
                suppressedItems.push(position);
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
          const stored = { indexRevision: indexRevisionAfterRun(run), memories: written,
            suppressedCount: suppressedItems.length, ...(suppressedItems.length > 0 && { suppressedItems }),
            duplicateCount, counters: policy.counters };
          const result = copyResult(stored, true);
          state.claims.set(identity, { key: claim.key, messages: claim.messages, messageIds: claim.messageIds,
            status: "finished", result: stored });
          state.activeTokens.delete(token);
          run.finishes.add(stored);
          run.stateWritten = true;
          return result;
        };
      });
    },

    async eligible(tx, key, messages) {
      const admission = admissionScope(tx, key);
      return port.read(tx, admission, async (getState) => {
        const key = admission.copyKey();
        const { scope, client, sessionId } = key;
        const copied = copyCaptureMessages(messages);
        const occurredAtMs = copied.map((message) => message.occurredAtMs);
        const state = getState();
        const matcher = matchFacts(state.facts, scope);
        if (matcher.blocksSession(client, sessionId)) return [];
        if (lineage && lineage.lineageFenced(state, scope, key, await lineage.captureProofs(scope, client, copied))) return [];
        const blocked = new Set(matcher.blockedMessages(client, sessionId, occurredAtMs));
        const { deletedMessages } = state;
        const positions = [];
        for (const [position, { id }] of copied.entries()) {
          if (blocked.has(position) || (deletedMessages.size > 0 && await messageDeleted(deletedMessages, key, id))) continue;
          positions.push(position);
        }
        return positions;
      });
    },

    async retainedReceiptIds(tx, scope, memoryId, receipts) {
      return port.read(tx, scope, getState => {
        const stored = getState().rows.get(writeNamespace(scope))?.get(memoryId)?.receipts ?? [];
        return copyReceipts(receipts).map(({ client, sessionId, messageId, role, occurredAtMs, excerpt }) =>
          stored.find(receipt => receipt.client === client && receipt.sessionId === sessionId &&
            receipt.messageId === messageId && receipt.role === role && receipt.occurredAtMs === occurredAtMs &&
            receipt.excerpt === excerpt)?.id ?? null);
      });
    },

    async assertEligible(tx, key, positions) {
      const scope = admissionScope(tx, key);
      return port.write(tx, scope, "conditional", () => {
        const copy = scope.copyKey();
        /** @type {Set<number>} */
        const selected = new Set();
        for (const position of snapshotArray(positions)) {
          if (!Number.isSafeInteger(position) || position < 0 || selected.has(position)) {
            throw new CoreError("invalid_input");
          }
          selected.add(position);
        }
        return async (getState) => {
          const state = getState();
          const identity = captureIdentity(copy.client, copy.eventId);
          const claim = state.claims.get(identity);
          // Another namespace never holds this lease. Reject it before comparing the key, so the
          // answer does not reveal whether the event exists elsewhere.
          if (claim && claim.key.scope.namespace !== copy.scope.namespace) throw new CoreError("stale_admission");
          assertClaimKey(claim, copy);
          if (claim?.status !== "leased") throw new CoreError("stale_admission");
          const nowMs = now();
          validateTime(nowMs);
          if (!(nowMs < claim.expiresAtMs)) throw new CoreError("stale_admission");
          const occurredAtMs = Array.from(selected, (position) => {
            if (position >= claim.occurredAtMs.length) throw new CoreError("invalid_input");
            return claim.occurredAtMs[position];
          });
          const { scope, client, sessionId } = claim.key;
          const matcher = matchFacts(state.facts, scope);
          if (matcher.blocksSession(client, sessionId) || matcher.blockedMessages(client, sessionId, occurredAtMs).length) {
            throw new CoreError("suppressed");
          }
          const { deletedMessages } = state;
          if (deletedMessages.size > 0) {
            for (const position of selected) {
              if (await messageDeleted(deletedMessages, claim.key, claim.messageIds[position])) throw new CoreError("suppressed");
            }
          }
          // Core can finish a deleted outbox with no sources after withdrawing every slot.
          if (selected.size === 0 && claim.messages?.length && claim.messages.every(({ content }) => content === "") &&
              lineage?.hasRawFence(state, scope, claim.key)) return;
          if (lineage?.lineageFenced(state, scope, copy, claim.proofs)) throw new CoreError("lineage_fenced");
          let byClaim = selections.get(tx);
          if (!byClaim) selections.set(tx, byClaim = new Map());
          byClaim.set(identity, selected);
        };
      });
    },

    async admit(tx, key, messages) {
      const scope = admissionScope(tx, key);
      return port.capture(tx, scope, () => {
        const copy = scope.copyKey();
        const batch = copyCaptureMessages(messages);
        return (getState, run) => {
          const state = getState();
          const identity = captureIdentity(copy.client, copy.eventId);
          const previous = state.claims.get(identity);
          assertClaimKey(previous, copy);
          if (previous?.status === "leased") {
            const nowMs = now();
            validateTime(nowMs);
            if (nowMs < previous.expiresAtMs) return { status: "processing" };
          }
          if (previous?.status === "finished") {
            return { status: "rawReplay", result: copyResult(previous.result, run.finishes.has(previous.result)) };
          }
          if (previous) return { status: "duplicate" };
          state.claims.set(identity, { key: copy, messages: batch, messageIds: batch.map(({ id }) => id), status: "pending" });
          run.stateWritten = true;
          return { status: "admitted" };
        };
      });
    },

    async load(tx, selection) {
      const scope = selection?.scope;
      return port.read(tx, scope, (getState) => {
        const { scope: { namespace }, client, eventId, sessionId } = copyCaptureSelection(selection, tx.owner, scope.namespace);
        const row = getState().claims.get(captureIdentity(client, eventId));
        if (!row?.messages || row.key.scope.namespace !== namespace || row.key.sessionId !== sessionId) return null;
        return structuredClone({ key: row.key, messages: row.messages });
      });
    },

    async status(tx, scope, eventId, client) {
      return port.read(tx, scope, (getState) => {
        const namespace = writeNamespace(scope);
        if (typeof eventId !== "string" || !eventId || (client !== undefined && (typeof client !== "string" || !client))) {
          throw new CoreError("invalid_input");
        }
        const { claims } = getState();
        const rows = client === undefined ? claims.values() : [claims.get(captureIdentity(client, eventId))];
        let done = false;
        let failureCode;
        for (const row of rows) {
          if (!row?.messages || row.key.scope.namespace !== namespace || row.key.eventId !== eventId) continue;
          if (row.status === "finished") done = true;
          else if (row.status === "abandoned" && !row.failure.retryable) failureCode ??= row.failure.code;
          else return { status: "pending" };
        }
        if (failureCode !== undefined) return { status: "failed", code: failureCode };
        return { status: done ? "done" : "unknown" };
      });
    },
  };
}

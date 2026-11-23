import { caught, check, equal, readDump, rejects } from "./support.mjs";

/** @typedef {import("./index.d.mts").CaseContext} CaseContext */
/** @typedef {import("@cairn-ink/core/ports").CaptureKey} CaptureKey */
/** @typedef {import("@cairn-ink/core/ports").ClaimResult} ClaimResult */
/** @typedef {import("@cairn-ink/core/ports").FinishItem} FinishItem */
/** @typedef {import("@cairn-ink/core/ports").FinishResult} FinishResult */

const leaseMs = 60_000;
const terminal = { code: "invalid_input", retryable: false };
const retryable = { code: "storage_error", retryable: true };
/** @type {readonly import("@cairn-ink/core/ports").CaptureMessage[]} */
const messages = [{ id: "message", role: "user", content: "A captured message.", occurredAtMs: null }];

/** @param {CaseContext} ctx @param {string} eventId @returns {CaptureKey} */
function keyFor(ctx, eventId) {
  return { scope: ctx.scope(null), client: "test-client", sessionId: "test-session", eventId,
    payloadDigest: "a".repeat(64) };
}

/** @param {CaseContext} ctx @param {CaptureKey} key @param {number} [duration] */
function claim({ adapter: { uow, capture } }, key, duration = leaseMs) {
  return uow.run(key.scope.owner, { pauseLock: true }, (tx) => capture.claim(tx, key, messages, { leaseMs: duration }));
}

/** @param {ClaimResult} result */
function claimedToken(result) {
  check(result.status === "claimed", "Expected a fresh claim");
  check(typeof result.token === "string" && result.token.length > 0, "A claim must return an opaque token");
  return result.token;
}

/** @param {CaseContext} ctx @param {string} content @returns {Promise<FinishItem>} */
async function itemFor(ctx, content) {
  return { content, kind: "fact", confidence: 0.4, textHash: await ctx.hash(content), embedding: null, receipts: [] };
}

/** @param {CaseContext} ctx @param {string} token @param {readonly FinishItem[]} items */
function finish({ adapter: { uow, capture }, owner }, token, items) {
  return uow.run(owner, { pauseLock: true }, (tx) => capture.finish(tx, token, items));
}

/** @param {CaseContext} ctx @param {string} token @param {{code: string, retryable: boolean}} failure */
function abandon({ adapter: { uow, capture }, owner }, token, failure) {
  return uow.run(owner, { pauseLock: true }, (tx) => capture.abandon(tx, token, failure));
}

/** @param {CaseContext} ctx @param {string} token */
function dispatch({ adapter: { uow, capture }, owner }, token) {
  return uow.run(owner, { pauseLock: true }, (tx) => capture.beginDispatch(tx, token));
}

/** @param {FinishResult} result */
function projectFinish({ indexRevision, memories, suppressedCount, duplicateCount, counters }) {
  return { indexRevision, memories: memories.map(({ id, revision, outcome }) => [id, revision, outcome]),
    suppressedCount, duplicateCount, counters: Object.fromEntries(Object.entries(counters)) };
}

/** @type {readonly import("./index.d.mts").ConformanceCase[]} */
export const captureCases = [
  {
    id: "K-CLM-1", title: "claim identity, payload conflict, and finished replay", needs: [],
    async run(ctx) {
      const key = keyFor(ctx, "replay");
      const token = claimedToken(await claim(ctx, key));
      equal((await claim(ctx, key)).status, "processing", "A live claim must report processing");
      const conflict = { ...key, payloadDigest: "b".repeat(64) };
      await rejects(() => claim(ctx, conflict), "event_payload_conflict");
      await rejects(() => claim(ctx, { ...key, sessionId: "another-session" }), "event_payload_conflict");
      claimedToken(await claim(ctx, { ...key, client: "another-client" }));
      claimedToken(await claim(ctx, { ...key, scope: ctx.scope("another-namespace") }));
      claimedToken(await claim(ctx, { ...key, scope: { owner: ctx.otherOwner, namespace: null } }));

      const completed = await finish(ctx, token, [await itemFor(ctx, "Completed memory")]);
      const replay = await claim(ctx, key);
      check(replay.status === "rawReplay", "A finished claim must return rawReplay");
      equal(projectFinish(replay.result), projectFinish(completed), "Replay must preserve the finish result");
      await rejects(() => claim(ctx, conflict), "event_payload_conflict");

      const terminalKey = keyFor(ctx, "terminal-conflict");
      await abandon(ctx, claimedToken(await claim(ctx, terminalKey)), terminal);
      await rejects(() => claim(ctx, { ...terminalKey, payloadDigest: conflict.payloadDigest }), "event_payload_conflict");
    },
  },
  {
    id: "K-CLM-2", title: "abandon, lease expiry, and token replacement", needs: [],
    async run(ctx) {
      const key = keyFor(ctx, "retryable");
      const first = claimedToken(await claim(ctx, key));
      await abandon(ctx, first, retryable);
      await rejects(() => claim(ctx, { ...key, payloadDigest: "b".repeat(64) }), "event_payload_conflict");
      const second = claimedToken(await claim(ctx, key));
      check(second !== first, "Retryable abandon must issue a new token");
      await abandon(ctx, first, terminal);
      await rejects(() => dispatch(ctx, first), "stale_admission");
      await rejects(() => finish(ctx, first, []), "stale_admission");
      equal((await claim(ctx, key)).status, "processing", "Repeating abandon must preserve the new claim");

      const terminalKey = keyFor(ctx, "terminal");
      const terminalToken = claimedToken(await claim(ctx, terminalKey));
      await abandon(ctx, terminalToken, terminal);
      await abandon(ctx, terminalToken, retryable);
      equal((await claim(ctx, terminalKey)).status, "duplicate", "Terminal abandon must return duplicate");
    },
    followUp: {
      needs: [],
      async run(ctx) {
        if (!ctx.harness.advanceClock) return "lease expiry requires harness.advanceClock";
        const key = keyFor(ctx, "expired");
        const expired = claimedToken(await claim(ctx, key));
        const unreclaimed = claimedToken(await claim(ctx, keyFor(ctx, "unreclaimed")));
        await ctx.harness.advanceClock(leaseMs);
        await rejects(() => claim(ctx, { ...key, payloadDigest: "b".repeat(64) }), "event_payload_conflict");
        await rejects(() => finish(ctx, unreclaimed, []), "stale_admission");
        const next = await claim(ctx, key);
        check(next.status === "claimed", "An expired lease must allow another claim");
        const replacement = claimedToken(next);
        check(replacement !== expired, "Lease expiry must issue a new token");
        await rejects(() => finish(ctx, expired, []), "stale_admission");
        await rejects(() => dispatch(ctx, expired), "stale_admission");
        await rejects(() => abandon(ctx, expired, terminal), "stale_admission");
      },
    },
  },
  {
    id: "K-CLM-3", title: "finish decisions, index revisions, and rollback", needs: [],
    async run(ctx) {
      const { adapter: { uow, capture, memories, snapshot }, owner, harness } = ctx;
      const scope = ctx.scope(null);
      const readSet = { owner, namespaces: [scope.namespace] };
      const stateToken = () => uow.run(owner, { readOnly: true }, (tx) => snapshot.stateToken(tx, readSet));
      /** @param {string} eventId @param {FinishItem[]} items */
      const finishNew = async (eventId, items) =>
        finish(ctx, claimedToken(await claim(ctx, keyFor(ctx, eventId))), items);

      const [stored, inserted, blocked, laterA, laterB] = await Promise.all(
        ["Stored memory", "New memory", "Blocked memory", "Later memory", "Another later memory"]
          .map((content) => itemFor(ctx, content)));
      await harness.seedFact(owner, {
        owner, actionId: "forget-blocked", origin: "forget", kind: "text", mode: "exact",
        text: { digests: [{ alg: "sha256", value: blocked.textHash.slice(7), pipeline: "core",
          redactionVersion: 1, keyId: null }] },
      });
      const seed = await finishNew("seed", [stored]);
      check(seed.memories.length === 1, "The seed finish must produce one memory");
      const beforeA = await stateToken();
      const a = await finishNew("mixed", [inserted, stored, blocked]);
      check(Number.isSafeInteger(a.indexRevision), "Finish must return a safe integer index revision");
      equal(a.indexRevision, seed.indexRevision + 1, "A finish with multiple writes must advance the index once");
      equal(a.duplicateCount, 1, "The stored duplicate must count as a duplicate");
      equal(a.suppressedCount, 1, "The blocked item must count as suppressed");
      equal(a.memories.length, 2, "Finish must return each written position");
      equal(a.memories[0].outcome, "inserted", "The new position must be inserted");
      const duplicate = a.memories[1];
      equal(duplicate.id, seed.memories[0].id, "The duplicate must refer to the stored row");
      check(duplicate.outcome === "touched" || duplicate.outcome === "changed", "The duplicate must report a touch or change");
      const scopeRows = await uow.run(owner, { readOnly: true },
        (tx) => memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
      equal(scopeRows.items.map(({ text }) => text).sort(), [inserted.content, stored.content].sort(),
        "The write batch must leave only the stored and new rows visible");
      const afterA = await stateToken();
      check(afterA !== beforeA, "A finish with writes must invalidate the old state token");

      const b = await finishNew("suppressed-only", [blocked]);
      equal(b.suppressedCount, 1, "A suppressed-only finish must count the blocked item");
      equal(b.memories.length, 0, "A suppressed-only finish must return no memories");
      equal(b.indexRevision, a.indexRevision, "A suppressed-only finish must preserve the index revision");
      equal(await stateToken(), afterA, "A suppressed-only finish must preserve the state token");

      const empty = await finishNew("empty", []);
      equal(empty.memories.length, 0, "An empty finish must return no memories");
      equal(empty.indexRevision, a.indexRevision, "An empty finish must preserve the index revision");
      equal(await stateToken(), afterA, "An empty finish must preserve the state token");
      const c = await finishNew("later", [laterA, laterB]);
      equal(c.indexRevision, a.indexRevision + 1, "The next finish with writes must advance the index once");

      const rollbackKey = keyFor(ctx, "rollback");
      const token = claimedToken(await claim(ctx, rollbackKey));
      const rolledBack = await itemFor(ctx, "Rolled back memory");
      const before = await readDump(harness);
      const beforeRollback = await stateToken();
      const abort = new Error("abort capture finish");
      const rollbackError = await caught(() => uow.run(owner, { pauseLock: true }, async (tx) => {
        const result = await capture.finish(tx, token, [rolledBack]);
        equal(result.memories.length, 1, "Finish must write before the rollback is requested");
        throw abort;
      }));
      check(rollbackError === abort, "The run must propagate the rollback error");
      equal((await claim(ctx, rollbackKey)).status, "processing", "Rollback must restore the live claim");
      equal(await readDump(harness), before, "Rollback must preserve the committed dump");
      equal(await stateToken(), beforeRollback, "Rollback must preserve the state token");
    },
  },
  {
    id: "K-CLM-4", title: "dispatch is idempotent and rejects unknown tokens", needs: [],
    async run(ctx) {
      const token = claimedToken(await claim(ctx, keyFor(ctx, "dispatch")));
      equal((await dispatch(ctx, token)).token, token, "Dispatch must preserve the token");
      equal((await dispatch(ctx, token)).token, token, "Repeated dispatch must preserve the token");
      await rejects(() => dispatch(ctx, crypto.randomUUID()), "stale_admission");
    },
  },
  {
    id: "K-CLM-5", title: "transaction guards and invalid claim inputs", needs: [],
    async run(ctx) {
      const { adapter: { uow, capture }, owner, otherOwner, harness } = ctx;
      const key = keyFor(ctx, "guards");
      const token = claimedToken(await claim(ctx, key));
      const before = await readDump(harness);
      /** @type {Array<(tx: import("@cairn-ink/core/ports").Tx) => Promise<unknown>>} */
      const commands = [
        (tx) => capture.claim(tx, key, messages, { leaseMs }),
        (tx) => capture.beginDispatch(tx, token),
        (tx) => capture.abandon(tx, token, terminal),
        (tx) => capture.finish(tx, token, []),
      ];
      for (const command of commands) {
        await rejects(() => uow.run(owner, { readOnly: true, pauseLock: true }, command), "internal_error");
        await rejects(() => uow.run(owner, {}, command), "internal_error");
      }
      await rejects(() => uow.run(otherOwner, { pauseLock: true }, commands[0]), "internal_error");
      await rejects(() => claim(ctx, key, 0), "invalid_input");
      await rejects(() => claim(ctx, { ...key, payloadDigest: "invalid" }), "invalid_input");
      equal(await readDump(harness), before, "Refused capture calls must preserve the committed dump");
    },
  },
];

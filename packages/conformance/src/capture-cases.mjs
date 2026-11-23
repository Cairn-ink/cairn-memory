import { CoreError } from "@cairn-ink/core";
import { caught, check, equal, readDump, rejects } from "./support.mjs";

/** @typedef {import("./index.d.mts").CaseContext} CaseContext */
/** @typedef {import("@cairn-ink/core/ports").CaptureKey} CaptureKey */
/** @typedef {import("@cairn-ink/core/ports").ClaimResult} ClaimResult */
/** @typedef {import("@cairn-ink/core/ports").FinishItem} FinishItem */
/** @typedef {import("@cairn-ink/core/ports").FinishResult} FinishResult */

const leaseMs = 60_000;
const terminal = { code: "invalid_input", retryable: false };
const retryable = { code: "storage_error", retryable: true };
const captureSource = /** @type {const} */ ({ kind: "capture", client: "test-client", sessionId: "test-session" });
/** @type {readonly import("@cairn-ink/core/ports").CaptureMessage[]} */
const messages = [{ id: "message", role: "user", content: "A captured message.", occurredAtMs: null }];

/** @param {CaseContext} ctx @param {string} eventId @returns {CaptureKey} */
function keyFor(ctx, eventId) {
  const { client, sessionId } = captureSource;
  return { scope: ctx.scope(null), client, sessionId, eventId, payloadDigest: "a".repeat(64) };
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

/** @param {CaseContext} ctx */
function stateToken({ adapter: { uow, snapshot }, owner }) {
  return uow.run(owner, { readOnly: true }, (tx) => snapshot.stateToken(tx, { owner, namespaces: [null] }));
}

/** @param {FinishResult} result */
function projectFinish({ indexRevision, memories, suppressedCount, duplicateCount, counters }) {
  return { indexRevision, memories: memories.map(({ id, revision, outcome }) => [id, revision, outcome]),
    suppressedCount, duplicateCount, counters: Object.fromEntries(Object.entries(counters)) };
}

/** @param {FinishResult} result */
function mutateResult(result) {
  Reflect.set(result.memories[0], "id", `${result.memories[0].id}-edited`);
  const counter = Object.keys(result.counters)[0] ?? "test-counter";
  Reflect.set(result.counters, counter, (result.counters[counter] ?? 0) + 1);
  Reflect.set(result, "duplicateCount", result.duplicateCount + 1);
  Reflect.set(result, "suppressedCount", result.suppressedCount + 1);
  Reflect.set(result.memories, "length", 0);
}

/** @param {CaseContext} ctx @param {FinishItem} item */
async function storedExactMatches({ adapter: { uow, memories }, owner, scope }, { textHash }) {
  const { matches } = await uow.run(owner, { readOnly: true }, (tx) =>
    memories.readWritePolicy(tx, scope(null), [{ textHash }], captureSource, "full"));
  // Full write policy includes hidden rows that export omits.
  return matches[0].flatMap((match) => match.kind === "stored" && match.match === "exact" ? [match.id] : []).sort();
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
      check(completed.memories.length === 1, "Finish must return the completed memory");
      const expected = projectFinish(completed);
      mutateResult(completed);
      const replay = await claim(ctx, key);
      check(replay.status === "rawReplay", "A finished claim must return rawReplay");
      equal(projectFinish(replay.result), expected, "Replay must preserve the finish result after caller mutation");
      mutateResult(replay.result);
      const later = await claim(ctx, key);
      check(later.status === "rawReplay", "A repeated claim must return rawReplay");
      equal(projectFinish(later.result), expected, "Replay must survive mutation of an earlier replay");
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
      const beforeRetryable = await stateToken(ctx);
      await abandon(ctx, first, retryable);
      equal(await stateToken(ctx), beforeRetryable, "Retryable abandon must preserve the state token");
      await rejects(() => claim(ctx, { ...key, payloadDigest: "b".repeat(64) }), "event_payload_conflict");
      const second = claimedToken(await claim(ctx, key));
      check(second !== first, "Retryable abandon must issue a new token");
      const beforeRepeat = await stateToken(ctx);
      await abandon(ctx, first, terminal);
      equal(await stateToken(ctx), beforeRepeat, "Repeat abandon must preserve the state token");
      await rejects(() => dispatch(ctx, first), "stale_admission");
      await rejects(() => finish(ctx, first, []), "stale_admission");
      equal((await claim(ctx, key)).status, "processing", "Repeating abandon must preserve the new claim");

      const terminalKey = keyFor(ctx, "terminal");
      const terminalToken = claimedToken(await claim(ctx, terminalKey));
      const beforeTerminal = await stateToken(ctx);
      await abandon(ctx, terminalToken, terminal);
      equal(await stateToken(ctx), beforeTerminal, "Terminal abandon must preserve the state token");
      await abandon(ctx, terminalToken, retryable);
      equal(await stateToken(ctx), beforeTerminal, "Repeat terminal abandon must preserve the state token");
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
      const { adapter: { uow, capture, memories }, owner, harness } = ctx;
      const scope = ctx.scope(null);
      const readPage = () => uow.run(owner, { readOnly: true },
        (tx) => memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
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
      const beforeA = await stateToken(ctx);
      const beforeSuppression = await storedExactMatches(ctx, blocked);
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
      const scopeRows = await readPage();
      equal(scopeRows.items.map(({ text }) => text).sort(), [inserted.content, stored.content].sort(),
        "The write batch must leave only the stored and new rows visible");
      equal(await storedExactMatches(ctx, blocked), beforeSuppression, "A suppressed item must leave the same stored exact matches");
      const afterA = await stateToken(ctx);
      check(afterA !== beforeA, "A finish with writes must invalidate the old state token");

      const b = await finishNew("suppressed-only", [blocked]);
      equal(b.suppressedCount, 1, "A suppressed-only finish must count the blocked item");
      equal(b.memories.length, 0, "A suppressed-only finish must return no memories");
      equal(b.indexRevision, a.indexRevision, "A suppressed-only finish must preserve the index revision");
      equal(await stateToken(ctx), afterA, "A suppressed-only finish must preserve the state token");
      equal(await storedExactMatches(ctx, blocked), beforeSuppression, "A suppressed item must leave the same stored exact matches");

      const empty = await finishNew("empty", []);
      equal(empty.memories.length, 0, "An empty finish must return no memories");
      equal(empty.indexRevision, a.indexRevision, "An empty finish must preserve the index revision");
      equal(await stateToken(ctx), afterA, "An empty finish must preserve the state token");
      const c = await finishNew("later", [laterA, laterB]);
      equal(c.indexRevision, a.indexRevision + 1, "The next finish with writes must advance the index once");

      const repeated = await itemFor(ctx, "Repeated memory");
      const batch = await finishNew("in-batch-duplicate", [repeated, repeated]);
      equal(batch.duplicateCount, 1, "The in-batch copy must count as a duplicate");
      equal(batch.memories.length, 2, "Both in-batch positions must be reported");
      const [first, copy] = batch.memories;
      equal(first.outcome, "inserted", "The first in-batch position must be inserted");
      equal(copy.id, first.id, "The in-batch copy must refer to the inserted row");
      check(copy.outcome === "touched" || copy.outcome === "changed", "The in-batch copy must report a touch or change");
      const repeatedRows = (await readPage()).items.filter(({ text, textHash }) =>
        text === repeated.content || textHash === repeated.textHash);
      equal(repeatedRows.map(({ id }) => id), [first.id], "The in-batch copies must leave exactly one row");

      const rollbackKey = keyFor(ctx, "rollback");
      const token = claimedToken(await claim(ctx, rollbackKey));
      const rolledBack = await itemFor(ctx, "Rolled back memory");
      const before = await readDump(harness);
      const beforeRollback = await stateToken(ctx);
      const abort = new Error("abort capture finish");
      const rollbackError = await caught(() => uow.run(owner, { pauseLock: true }, async (tx) => {
        const result = await capture.finish(tx, token, [rolledBack]);
        equal(result.memories.length, 1, "Finish must write before the rollback is requested");
        throw abort;
      }));
      check(rollbackError === abort, "The run must propagate the rollback error");
      equal((await claim(ctx, rollbackKey)).status, "processing", "Rollback must restore the live claim");
      equal(await readDump(harness), before, "Rollback must preserve the committed dump");
      equal(await stateToken(ctx), beforeRollback, "Rollback must preserve the state token");

      let caughtStale = false;
      const failure = await uow.run(owner, { pauseLock: true }, async (tx) => {
        const result = await capture.finish(tx, token, [rolledBack]);
        equal(result.memories.length, 1, "Finish must write before the retired token is reused");
        await rejects(() => capture.finish(tx, token, []), "stale_admission");
        caughtStale = true;
      }).then(() => null, (error) => error);
      check(caughtStale && failure instanceof CoreError && failure.code === "stale_admission",
        "A caught stale_admission must still reject the run with that code");
      equal(await readDump(harness), before, "A caught finish failure must roll back the committed dump");
      equal(await stateToken(ctx), beforeRollback, "A caught finish failure must preserve the state token");
      equal((await claim(ctx, rollbackKey)).status, "processing", "A caught finish failure must restore the live claim");
    },
    followUp: {
      needs: ["vectorSuppression", "semanticRetrieval"],
      async run(ctx) {
        const { harness, owner } = ctx;
        const forgottenHash = await ctx.hash("Forgotten vector memory");
        const nearby = await itemFor(ctx, "Nearby vector memory");
        nearby.embedding = { model: "test", vector: new Float32Array(ctx.vec(0.15)) };
        await harness.seedFact(owner, {
          owner, actionId: "forget-vector", origin: "forget", kind: "text", mode: "full",
          text: {
            digests: [{ alg: "sha256", value: forgottenHash.slice(7), pipeline: "core",
              redactionVersion: 1, keyId: null }],
            embedding: ctx.vec(0),
          },
        });
        const token = claimedToken(await claim(ctx, keyFor(ctx, "near-forgotten")));
        const before = await storedExactMatches(ctx, nearby);
        const result = await finish(ctx, token, [nearby]);
        equal(result.suppressedCount, 1, "Full capture policy must suppress a vector match with a different digest");
        equal(result.memories.length, 0, "A vector-suppressed item must return no memory");
        equal(await storedExactMatches(ctx, nearby), before, "A suppressed item must leave the same stored exact matches");
      },
    },
  },
  {
    id: "K-CLM-4", title: "dispatch returns a usable token and rejects unknown tokens", needs: [],
    async run(ctx) {
      const token = claimedToken(await claim(ctx, keyFor(ctx, "dispatch")));
      const before = await stateToken(ctx);
      const dispatched = await dispatch(ctx, token);
      equal(await stateToken(ctx), before, "Dispatch must preserve the state token");
      if (!ctx.adapter.capabilities.stagedEvidence) {
        equal(dispatched.token, token, "Dispatch must preserve the token without staged evidence");
        equal((await dispatch(ctx, token)).token, token, "Repeated dispatch must preserve the token");
        equal(await stateToken(ctx), before, "Repeated dispatch must preserve the state token");
      }
      await rejects(() => dispatch(ctx, crypto.randomUUID()), "stale_admission");
      await finish(ctx, dispatched.token, []);
    },
  },
  {
    id: "K-CLM-5", title: "transaction guards and invalid claim inputs", needs: [],
    async run(ctx) {
      const { adapter: { uow, capture }, owner, otherOwner, harness } = ctx;
      const key = keyFor(ctx, "guards");
      const token = claimedToken(await claim(ctx, key));
      const memory = await itemFor(ctx, "Owner memory");
      const before = await readDump(harness);
      /** @type {Array<(tx: import("@cairn-ink/core/ports").Tx) => Promise<unknown>>} */
      const commands = [
        (tx) => capture.claim(tx, key, messages, { leaseMs }),
        (tx) => capture.beginDispatch(tx, token),
        (tx) => capture.abandon(tx, token, terminal),
        (tx) => capture.finish(tx, token, [memory]),
      ];
      for (const command of commands) {
        await rejects(() => uow.run(owner, { readOnly: true, pauseLock: true }, command), "internal_error");
        await rejects(() => uow.run(owner, {}, command), "internal_error");
      }
      await rejects(() => uow.run(otherOwner, { pauseLock: true }, commands[0]), "internal_error");
      await rejects(() => claim(ctx, key, 0), "invalid_input");
      await rejects(() => claim(ctx, { ...key, payloadDigest: "invalid" }), "invalid_input");
      equal(await readDump(harness), before, "Refused capture calls must preserve the committed dump");

      for (const command of commands.slice(1).reverse()) {
        await rejects(() => uow.run(otherOwner, { pauseLock: true }, command), "stale_admission");
      }
      equal(await readDump(harness), before, "Foreign token calls must preserve the committed dump");
      const completed = await finish(ctx, token, [memory]);
      equal(completed.memories.length, 1, "The rightful owner must still be able to finish the claim");
    },
  },
];

import { allDigests, passageShingles, withholdsAnyPassage } from "@cairn-ink/core";
import { check, equal, readDump, rejects } from "./support.mjs";

/** @import { FingerprintKey, SuppressionFact } from "@cairn-ink/core" */
/** @import { CaptureKey, CaptureMessage } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const client = "test-client";
const sessionId = "test-session";
const otherClient = "other-client";
const fingerprintLabels = Object.freeze({
  keyIdDomain: "test-key-id", shingleKeyPrefix: "test-shingle:", legacyExactPrefix: "test-exact:",
});

/** @param {CaseContext} ctx @returns {CaptureKey} */
function captureKey(ctx) {
  return { scope: ctx.scope(null), client, sessionId, eventId: "test-event", payloadDigest: "a".repeat(64) };
}

/** @param {ReadonlyArray<number | null>} times @returns {CaptureMessage[]} */
function messagesAt(times) {
  return times.map((occurredAtMs, index) => ({ id: String(index), role: "user", content: "Test message", occurredAtMs }));
}

/** @param {CaseContext} ctx @param {string} actionId */
function factBase({ owner }, actionId) {
  return { owner, actionId, origin: /** @type {const} */ ("forget") };
}

/** @param {CaseContext} ctx @returns {Extract<SuppressionFact, {kind: "session"}>} */
function sessionFact(ctx) {
  const base = { ...factBase(ctx, "session"), kind: /** @type {const} */ ("session") };
  if (ctx.sessionRefs === "plain") return { ...base, session: { client, sessionId } };
  const hashSessionKey = ctx.harness.hashSessionKey;
  check(typeof hashSessionKey === "function", "Hashed profile requires harness.hashSessionKey");
  const sessionKeyHash = hashSessionKey(client, sessionId);
  check(typeof sessionKeyHash === "string" && /^[0-9a-f]{64}$/u.test(sessionKeyHash),
    "Harness must return a session hash for the fixture");
  return { ...base, session: { client, sessionKeyHash } };
}

/** @param {CaseContext} ctx @param {CaptureKey} key @param {readonly CaptureMessage[]} messages */
async function claim({ adapter: { capture, uow }, owner }, key, messages) {
  const result = await uow.run(owner, { pauseLock: true }, (tx) => capture.claim(tx, key, messages, { leaseMs: 60_000 }));
  equal(result.status, "claimed", "Fixture must create a live claim");
}

/** @param {CaseContext} ctx @param {CaptureKey} key @param {readonly CaptureMessage[]} messages */
function eligible({ adapter: { capture, uow }, owner }, key, messages) {
  return uow.run(owner, { readOnly: true }, (tx) => capture.eligible(tx, key, messages));
}

/** @param {CaseContext} ctx @param {CaptureKey} key @param {readonly number[]} positions */
function assertEligible({ adapter: { capture, uow }, owner }, key, positions) {
  return uow.run(owner, {}, (tx) => capture.assertEligible(tx, key, positions));
}

/** @param {string} text @param {FingerprintKey | null} key */
async function passage(text, key) {
  return {
    digests: await allDigests(text, key),
    shingles: key ? await passageShingles(text, key, fingerprintLabels) : null,
    keyId: key?.id ?? null,
  };
}

/** @param {CaseContext} ctx @param {FingerprintKey | null} key */
async function textFilter(ctx, key) {
  const { adapter: { capture, suppressions, uow }, harness, owner } = ctx;
  const admission = captureKey(ctx);
  const messages = messagesAt([10, 11]);
  messages[0].content = "The garden path is lined with cedar and rosemary.";
  messages[1].content = "Copper conducts electricity.";
  const matching = await passage(messages[0].content, key);
  const unrelated = await passage(messages[1].content, key);
  await harness.seedFact(owner, {
    ...factBase(ctx, "text"), kind: "text", mode: key ? "full" : "exact",
    text: { ...matching, digests: matching.digests.slice(0, 1) },
  });
  await claim(ctx, admission, messages);
  await uow.run(owner, { readOnly: true }, async (tx) => {
    equal(await capture.eligible(tx, admission, messages), [0, 1], "Text facts must leave source positions eligible");
    const { scope, client, sessionId } = admission;
    const candidates = { client, sessionId, passages: [matching] };
    const matched = await suppressions.snapshot(tx, scope, candidates);
    const matchedFacts = matched.passages.map(({ fact }) => fact);
    check(withholdsAnyPassage([matching], matchedFacts), "Core must withhold matching text from snapshot passages");
    check(!withholdsAnyPassage([unrelated], matchedFacts), "The matching facts must leave unrelated text visible");
    const control = await suppressions.snapshot(tx, scope, { ...candidates, passages: [unrelated] });
    check(!withholdsAnyPassage([unrelated], control.passages.map(({ fact }) => fact)),
      "The unrelated snapshot must leave unrelated text visible");
  });
  await assertEligible(ctx, admission, [0, 1]);
}

/** @type {readonly ConformanceCase[]} */
export const SOURCE_FILTER_CASES = [
  {
    id: "K-SRC-1", title: "blocks a session and leaves another session eligible", needs: [],
    async run(ctx) {
      const key = captureKey(ctx);
      const other = { ...key, sessionId: "other-session", eventId: "other-event" };
      const messages = messagesAt([10, null]);
      await claim(ctx, key, messages);
      await claim(ctx, other, messages);
      await ctx.harness.seedFact(ctx.owner, sessionFact(ctx));
      equal(await eligible(ctx, key, messages), [], "Matching session must have no eligible positions");
      equal(await eligible(ctx, other, messages), [0, 1], "Another session must remain eligible");
      await rejects(() => assertEligible(ctx, key, [0]), "suppressed");
      await rejects(() => assertEligible(ctx, key, []), "suppressed");
      await assertEligible(ctx, other, [0, 1]);

      if (ctx.sessionRefs === "plain" && !ctx.harness.hashSessionKey) {
        // This client has a hashed fact but the plain profile cannot compare it.
        await ctx.harness.seedFact(ctx.owner, {
          ...factBase(ctx, "hashed-session"), kind: "session",
          session: { client: otherClient, sessionKeyHash: "b".repeat(64) },
        });
        const uncertain = { ...key, client: otherClient };
        await claim(ctx, uncertain, messages);
        equal(await eligible(ctx, uncertain, messages), [], "Ineligible session comparison must deny source positions");
        await rejects(() => assertEligible(ctx, uncertain, [0]), "suppressed");
        equal(await eligible(ctx, other, messages), [0, 1], "Ineligible comparison must leave other clients eligible");
      }
    },
  },
  {
    id: "K-SRC-2", title: "applies window bounds, client scope, and unknown times", needs: [],
    async run(ctx) {
      const key = captureKey(ctx);
      const other = { ...key, client: otherClient };
      const messages = messagesAt([9, 10, 19, 20, null, 30, 39, 40]);
      await claim(ctx, key, messages);
      await claim(ctx, other, messages);
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "client-window"), kind: "window", client, window: { startMs: 10, endMs: 20 },
      });
      equal(await eligible(ctx, key, messages), [0, 3, 4, 5, 6, 7],
        "Client window must block its half-open interval and admit unknown time by default");
      equal(await eligible(ctx, other, messages), [0, 1, 2, 3, 4, 5, 6, 7],
        "Client window must leave another client eligible");
      await assertEligible(ctx, key, [4, 3, 0]);
      await rejects(() => assertEligible(ctx, key, [0, 1]), "suppressed");

      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "all-window"), kind: "window", client: null,
        window: { startMs: 30, endMs: 40 }, unknownTime: true,
      });
      equal(await eligible(ctx, key, messages), [0, 3, 7], "All-client window must block inside and unknown times");
      equal(await eligible(ctx, other, messages), [0, 1, 2, 3, 7], "All-client window must also block another client");
      await rejects(() => assertEligible(ctx, other, [4]), "suppressed");
      await assertEligible(ctx, other, [1, 7]);
    },
  },
  {
    id: "K-SRC-3", title: "rechecks facts written in the admission transaction", needs: [],
    async run(ctx) {
      const { adapter: { capture, suppressions, uow }, harness, owner } = ctx;
      const key = captureKey(ctx);
      const messages = messagesAt([10]);
      await claim(ctx, key, messages);
      const positions = await eligible(ctx, key, messages);
      equal(positions, [0], "Preflight must admit the message before the fact is written");
      const before = await readDump(harness);
      await rejects(() => uow.run(owner, { pauseLock: true }, async (tx) => {
        await suppressions.writeFact(tx, sessionFact(ctx), "c".repeat(64));
        await capture.assertEligible(tx, key, positions);
      }), "suppressed");
      equal(await readDump(harness), before, "Suppressed write run must roll back all changes");
      await assertEligible(ctx, key, positions);
    },
  },
  {
    id: "K-SRC-4", title: "leaves text eligible and withholds it through core", needs: [], needsOff: ["fingerprintKey"],
    async run(ctx) {
      await textFilter(ctx, null);
    },
    followUp: {
      needs: ["fingerprintKey"],
      async run(ctx) {
        const key = await ctx.adapter.keys.userKey(ctx.owner);
        if (key === null) return "needs an owner fingerprint key";
        await textFilter(ctx, key);
      },
    },
  },
  {
    id: "K-SRC-5", title: "validates source filter arguments and transactions", needs: [],
    async run(ctx) {
      const { adapter: { capture, uow }, harness, owner, otherOwner } = ctx;
      const key = captureKey(ctx);
      const messages = messagesAt([10]);
      await claim(ctx, key, messages);
      equal(await eligible(ctx, key, messages), [0], "Eligible must accept a read-only transaction");
      await uow.run(otherOwner, {}, async (tx) => {
        await rejects(() => capture.eligible(tx, key, messages), "internal_error");
        await rejects(() => capture.assertEligible(tx, key, [0]), "internal_error");
      });
      await uow.run(owner, { readOnly: true }, async (tx) => {
        await rejects(() => capture.assertEligible(tx, key, [0]), "internal_error");
      });
      const ended = await uow.run(owner, {}, async (tx) => {
        const forged = { ...tx };
        await rejects(() => capture.eligible(forged, key, messages), "internal_error");
        await rejects(() => capture.assertEligible(forged, key, [0]), "internal_error");
        return tx;
      });
      await rejects(() => capture.eligible(ended, key, messages), "internal_error");
      await rejects(() => capture.assertEligible(ended, key, [0]), "internal_error");

      const before = await readDump(harness);
      const unknown = { ...key, eventId: "unknown-event" };
      for (const input of [null, { 0: 0, length: 1 }, [,], [0, 0], [-1], [0.5], [Number.MAX_SAFE_INTEGER + 1]]) {
        const positions = /** @type {readonly number[]} */ (/** @type {unknown} */ (input));
        await rejects(() => assertEligible(ctx, unknown, positions), "invalid_input");
      }
      await rejects(() => assertEligible(ctx, key, [1]), "invalid_input");
      await rejects(() => assertEligible(ctx, unknown, [0]), "stale_admission");
      equal(await readDump(harness), before, "Invalid positions and stale admission must leave the store unchanged");
    },
  },
];

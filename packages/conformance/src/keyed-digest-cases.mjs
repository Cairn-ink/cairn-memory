import { allDigests, coreDigest, decideWrite } from "@cairn-ink/core";
import { bounded, check, DEFAULT_TIMEOUT_MS, equal, gate, observe, row, source, wait } from "./support.mjs";

/** @import { FingerprintKey } from "@cairn-ink/core" */
/** @import { FinishItem, ItemRef } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const matching = "Garden basil";
const unrelated = "Garden thyme";
const third = "Garden mint";

/** @param {CaseContext} ctx */
async function ownerKey({ adapter, owner }) {
  const key = await adapter.keys.userKey(owner);
  check(key, "The enabled fingerprint key provider must return a key");
  return key;
}

/** @param {CaseContext} ctx @param {FingerprintKey} key @param {string} [text] @param {string} [actionId] */
async function seedFact(ctx, key, text = matching, actionId = "test-forget") {
  await ctx.harness.seedFact(ctx.owner, {
    owner: ctx.owner, actionId, origin: "forget", kind: "text", mode: "exact",
    text: { digests: [await coreDigest(text, key)], keyId: key.id },
  });
}

/** @param {CaseContext} ctx @param {string} text @param {FingerprintKey} key */
async function insert(ctx, text, key) {
  const content = { ...await row(ctx, text), digests: await allDigests(text, key) };
  const { uow, memories } = ctx.adapter;
  return uow.run(ctx.owner, {}, (tx) => memories.insert(tx, ctx.scope(null), content, [], 1));
}

/** @param {CaseContext} ctx @param {string} hidden @param {string} visible */
async function expectVisible({ adapter, owner, scope }, hidden, visible) {
  const { uow, lexical, recent, hydrate, memories } = adapter;
  const readScope = { owner, namespaces: [null] };
  const page = { cursor: null, limit: 10 };
  /** @type {ItemRef[]} */
  const refs = [hidden, visible].map((id) => ({ type: "memory", id, namespace: null }));
  await uow.run(owner, { readOnly: true }, async (tx) => {
    const candidates = await lexical.lexical(tx, readScope, "garden", 10, {});
    equal(candidates.rows.map(({ ref }) => ref.id), [visible], "Lexical must retain the unrelated row only");
    equal((await recent.recent(tx, readScope, page)).items.map(({ id }) => id),
      [visible], "Recent must retain the unrelated row only");
    equal((await hydrate.hydrate(tx, readScope, refs, "read")).map(({ ref }) => ref.id),
      [visible], "Hydration must retain the unrelated row only");
    equal((await memories.exportPage(tx, scope(null), page)).items.map(({ id }) => id),
      [visible], "Export must retain the unrelated row only");
  });
}

/** @param {CaseContext} ctx @param {string} content @param {FingerprintKey} key @returns {Promise<FinishItem>} */
async function finishItem(ctx, content, key) {
  const { kind, confidence, textHash, embedding } = await row(ctx, content);
  return {
    content, kind, confidence, textHash, digests: await allDigests(content, key), receipts: [],
    embedding: embedding && { model: embedding.model, vector: new Float32Array(embedding.vector) },
  };
}

/**
 * @param {CaseContext} ctx @param {string} oldId
 * @param {() => Promise<void>} rotate @param {() => Promise<number>} countMissing
 */
async function sampleRotation(ctx, oldId, rotate, countMissing) {
  const { owner, adapter: { uow }, settleMs = 100, timeoutMs = DEFAULT_TIMEOUT_MS } = ctx;
  const started = gate();
  const release = gate();
  let sampled = false;
  try {
    await bounded(async () => {
      const writer = observe(uow.run(owner, {}, async () => {
        started.release(undefined);
        await release.promise;
      }));
      await Promise.race([started.promise, writer]);
      let finished = false;
      const rotation = observe(rotate().finally(() => { finished = true; }));
      const done = observe(rotation.then(() => null));
      const sampler = observe((async () => {
        while (!finished) {
          const key = await Promise.race([ownerKey(ctx), done]);
          if (!key || finished) break;
          if (key.id !== oldId) {
            equal(await countMissing(), 0, "A published rotated key must already cover every row");
          }
          sampled = true;
          await wait(1);
        }
      })());

      // Give rotation a chance to reach the writer's lock, then keep sampling after release.
      await wait(settleMs);
      release.release(undefined);
      await Promise.all([writer, rotation, sampler]);
    }, "Key rotation observation", timeoutMs + settleMs);
  } finally {
    release.release(undefined);
  }
  return sampled ? undefined : "rotation sampling skipped because no key read completed while rotation was in flight";
}

/** @type {readonly ConformanceCase[]} */
export const KEYED_DIGEST_CASES = [
  {
    id: "K-KD-1", title: "hides a newly inserted row by keyed digest and retains unrelated rows", needs: ["fingerprintKey"],
    async run(ctx) {
      const key = await ownerKey(ctx);
      await seedFact(ctx, key);
      const hidden = await insert(ctx, matching, key);
      const visible = await insert(ctx, unrelated, key);
      await expectVisible(ctx, hidden.id, visible.id);
    },
  },
  {
    id: "K-KD-2", title: "uses keyed write queries and denies queries without a comparable digest", needs: ["fingerprintKey"],
    async run(ctx) {
      const key = await ownerKey(ctx);
      await seedFact(ctx, key);
      const { uow, memories } = ctx.adapter;
      const scope = ctx.scope(null);
      const queries = await Promise.all([matching, unrelated].map(async (text) => ({
        textHash: await ctx.hash(text), digests: await allDigests(text, key),
      })));
      // Core must supply its query digests before enabling writes where HMAC-only facts can exist.
      const { textHash } = queries[1];
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const keyed = await memories.readWritePolicy(tx, scope, queries, source, "hash");
        equal(keyed.blockedPositions, [0], "Keyed write policy must block the matching query only");
        equal(keyed.blockedSession, false, "Keyed write policy must leave this session unblocked");
        equal(decideWrite(keyed, 1).status, "saved", "Core must save the unrelated query in the keyed batch");
        const unrelatedPolicy = await memories.readWritePolicy(tx, scope, [queries[1]], source, "hash");
        equal(unrelatedPolicy.blockedPositions, [], "The unrelated keyed save must have no blocked positions");
        equal(unrelatedPolicy.blockedSession, false, "The unrelated keyed save must leave this session unblocked");
        equal(decideWrite(unrelatedPolicy, 0).status, "saved", "Core must save the unrelated keyed query");
        const unkeyed = await memories.readWritePolicy(tx, scope, [{ textHash }], source, "hash");
        equal(unkeyed.blockedPositions, [0], "A query without a comparable keyed digest must fail closed");
      });
    },
  },
  {
    id: "K-KD-3", title: "suppresses only the matching keyed capture item", needs: ["fingerprintKey"],
    async run(ctx) {
      const key = await ownerKey(ctx);
      await seedFact(ctx, key);
      const { uow, capture, memories } = ctx.adapter;
      const scope = ctx.scope(null);
      const claim = await uow.run(ctx.owner, { pauseLock: true }, (tx) => capture.claim(tx, {
        scope, client: "test-client", sessionId: "test-session", eventId: "test-event", payloadDigest: "a".repeat(64),
      }, [{ id: "test-message", role: "user", content: "Herb garden", occurredAtMs: null }], { leaseMs: 60_000 }));
      check(claim.status === "claimed", "Expected a fresh capture claim");
      const { token } = await uow.run(ctx.owner, { pauseLock: true }, (tx) => capture.beginDispatch(tx, claim.token));
      const items = await Promise.all([matching, unrelated].map((text) => finishItem(ctx, text, key)));
      const finished = await uow.run(ctx.owner, { pauseLock: true }, (tx) => capture.finish(tx, token, items));
      equal(finished.suppressedCount, 1, "Capture finish must suppress only the matching item");
      equal(finished.memories.map(({ outcome }) => outcome), ["inserted"], "Capture finish must insert the unrelated item");
      const saved = await uow.run(ctx.owner, { readOnly: true }, (tx) => memories.get(tx, scope, finished.memories[0].id));
      equal(saved?.text, unrelated, "Capture finish must retain the unrelated content");
    },
  },
  {
    id: "K-KD-4", title: "covers existing rows before publishing the rotated key", needs: ["fingerprintKey"],
    async run(ctx) {
      const { harness, owner } = ctx;
      if (!harness.setFingerprintSecret) return "needs harness.setFingerprintSecret for keyed digest rotation";
      if (!harness.rowsMissingKeyedDigest) return "needs harness.rowsMissingKeyedDigest for the rotation gate";
      const oldKey = await ownerKey(ctx);
      await insert(ctx, matching, oldKey);
      const second = await insert(ctx, unrelated, oldKey);
      const visible = await insert(ctx, third, oldKey);
      const skipSampling = await sampleRotation(ctx, oldKey.id,
        harness.setFingerprintSecret.bind(harness, "test-secret-rotation"),
        harness.rowsMissingKeyedDigest.bind(harness, owner));
      const newKey = await ownerKey(ctx);
      check(newKey.id !== oldKey.id, "Rotation must change the current key ID");
      equal(await harness.rowsMissingKeyedDigest(owner), 0, "Rotation must leave zero rows missing a keyed digest");
      await seedFact(ctx, oldKey);
      const { uow, memories } = ctx.adapter;
      const page = await uow.run(owner, { readOnly: true }, (tx) =>
        memories.exportPage(tx, ctx.scope(null), { cursor: null, limit: 10 }));
      equal(page.items.map(({ id }) => id).sort(), [second.id, visible.id].sort(),
        "The old-key fact must hide only its matching row");
      await seedFact(ctx, newKey, unrelated, "test-forget-rotated");
      await expectVisible(ctx, second.id, visible.id);
      return skipSampling;
    },
  },
];

import { allDigests, coreDigest, decideWrite } from "@cairn-ink/core";
import { cleanContent, normalizeForHash, prepareCoreText, PRIVACY_REDACTION_VERSIONS, redactV1 } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { check, equal, rejects, row, source } from "./support.mjs";
import { fixtureEmbedding, readDump } from "./support.mjs";

/** @import { FingerprintKey } from "@cairn-ink/core" */
/** @import { TextDigest } from "@cairn-ink/core" */
/** @import { FinishItem, ItemRef } from "@cairn-ink/core/ports" */
/** @import { RetainedDigestFixture } from "./factory.d.ts" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const matching = "Garden basil";
const unrelated = "Garden thyme";
const third = "Garden mint";
const nextSecret = "test-secret-rotation";

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

/** @param {CaseContext} ctx @param {FinishItem[]} items */
async function finish({ adapter: { uow, capture }, owner, scope }, items) {
  const claim = await uow.run(owner, { pauseLock: true }, (tx) => capture.claim(tx, {
    scope: scope(null), client: "test-client", sessionId: "test-session", eventId: "test-event", payloadDigest: "a".repeat(64),
  }, [{ id: "test-message", role: "user", content: "Herb garden", occurredAtMs: null }], { leaseMs: 60_000 }));
  check(claim.status === "claimed", "Expected a fresh capture claim");
  const { token } = await uow.run(owner, { pauseLock: true }, (tx) => capture.beginDispatch(tx, claim.token));
  return uow.run(owner, { pauseLock: true }, (tx) => capture.finish(tx, token, items));
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
      const { uow, memories } = ctx.adapter;
      const scope = ctx.scope(null);
      const items = await Promise.all([matching, unrelated].map((text) => finishItem(ctx, text, key)));
      const finished = await finish(ctx, items);
      equal(finished.suppressedCount, 1, "Capture finish must suppress only the matching item");
      equal(finished.memories.map(({ outcome }) => outcome), ["inserted"], "Capture finish must insert the unrelated item");
      const saved = await uow.run(ctx.owner, { readOnly: true }, (tx) => memories.get(tx, scope, finished.memories[0].id));
      equal(saved?.text, unrelated, "Capture finish must retain the unrelated content");
    },
  },
  {
    id: "K-KD-4", title: "retains row digest coverage after rotation", needs: ["fingerprintKey"],
    async run(ctx) {
      const { harness, owner } = ctx;
      if (!harness.setFingerprintSecret) return "needs harness.setFingerprintSecret for keyed digest rotation";
      if (!harness.rowsMissingKeyedDigest) return "needs harness.rowsMissingKeyedDigest for the rotation gate";
      const oldKey = await ownerKey(ctx);
      await insert(ctx, matching, oldKey);
      const second = await insert(ctx, unrelated, oldKey);
      const visible = await insert(ctx, third, oldKey);
      await harness.setFingerprintSecret(nextSecret);
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
    },
  },
  {
    id: "K-KD-5", title: "denies current-key-only write inputs against a retained-key fact", needs: ["fingerprintKey"],
    async run(ctx) {
      const { harness, owner, adapter: { uow, memories } } = ctx;
      if (!harness.setFingerprintSecret) return "needs harness.setFingerprintSecret for retained-key facts";
      const oldKey = await ownerKey(ctx);
      await seedFact(ctx, oldKey);
      await harness.setFingerprintSecret(nextSecret);
      const newKey = await ownerKey(ctx);
      check(newKey.id !== oldKey.id, "Expected a distinct current key");
      const query = { textHash: await ctx.hash(unrelated), digests: await allDigests(unrelated, newKey) };
      const policy = await uow.run(owner, { readOnly: true }, (tx) =>
        memories.readWritePolicy(tx, ctx.scope(null), [query], source, "hash"));
      equal(policy.blockedPositions, [0], "A current-key-only query must fail closed against a retained-key fact");
      equal(decideWrite(policy, 0).status, "suppressed", "Core must suppress the ineligible query");
      const finished = await finish(ctx, [await finishItem(ctx, unrelated, newKey)]);
      equal(finished.suppressedCount, 1, "A current-key-only finish item must fail closed against a retained-key fact");
      equal(finished.memories, [], "An ineligible capture item must produce no writes");
    },
  },
  {
    id: "K-KD-6", title: "refuses rotation while an older key has a live HMAC-only fact", needs: ["fingerprintKey"],
    async run(ctx) {
      const { harness, owner } = ctx;
      if (!harness.setFingerprintSecret) return "needs harness.setFingerprintSecret for rotation refusal";
      if (!harness.rowsMissingKeyedDigest) return "needs harness.rowsMissingKeyedDigest for the rotation gate";
      const oldKey = await ownerKey(ctx);
      await seedFact(ctx, oldKey);
      await insert(ctx, unrelated, oldKey);
      const rotate = harness.setFingerprintSecret.bind(harness);
      await rotate(nextSecret);
      const current = await ownerKey(ctx);
      check(current.id !== oldKey.id, "Expected a retained non-current key");
      const before = await harness.dump();
      const gate = await harness.rowsMissingKeyedDigest(owner);
      equal(gate, 0, "The first rotation must leave full digest coverage");
      await rejects(() => rotate("test-secret-later"), "fingerprint_key_mismatch");
      equal((await ownerKey(ctx)).id, current.id, "A refused rotation must preserve the current key");
      equal(await harness.dump(), before, "A refused rotation must preserve stored state");
      equal(await harness.rowsMissingKeyedDigest(owner), gate, "A refused rotation must preserve the gate");
    },
  },
];

const legacy = { keyId: "legacy-test-key", label: "legacy-test", secret: "synthetic-test-signing-seed" };
const variantText = 'Garden basil notes put API_KEY=fixture12345 beside {"id_token":"synthetic-marker"}.';
const currentForm = (/** @type {string} */ text) => normalizeForHash(prepareCoreText(text));
const v1Form = (/** @type {string} */ text) => normalizeForHash(redactV1(cleanContent(text)));
const encoder = new TextEncoder();

/** @param {ArrayBuffer} bytes */
function hex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {string} normalized @param {RetainedDigestFixture} fixture @param {boolean} [v1] */
async function fixtureDigest(normalized, fixture, v1 = false) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(fixture.secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(normalized));
  return /** @satisfies {TextDigest} */ ({
    alg: /** @type {const} */ ("hmac"), keyId: fixture.keyId, label: fixture.label,
    value: hex(mac),
    pipeline: v1 ? "hosted-v1" : "core",
    redactionVersion: v1 ? PRIVACY_REDACTION_VERSIONS.v1 : PRIVACY_REDACTION_VERSIONS.core,
  });
}

/** @param {CaseContext} ctx @param {TextDigest} digest @param {string} actionId */
async function seedRetainedFact(ctx, digest, actionId) {
  await ctx.harness.seedFact(ctx.owner, {
    ...ctx.scope(null), actionId, origin: "forget", kind: "text", mode: "exact",
    text: { digests: [digest] },
  });
}

/** @param {CaseContext} ctx */
function retainedSaveService(ctx) {
  const unused = () => { throw new Error("Unexpected provider call during save"); };
  return createMemoryService({
    storage: { ...ctx.adapter, name: "retained-digest-test" },
    model: { model: "test", contextWindow: 1, call: unused, countTokens: unused },
    embedder: {
      model: "fixture-only", dimensions: ctx.embeddingDimensions ?? 16,
      async embed(texts) {
        return texts.map(() => new Float32Array(fixtureEmbedding(ctx)?.vector ?? [1, ...Array(15).fill(0)]));
      },
    },
    gate: { async assertOpen() {} },
    clock: {
      nowMs: () => 1, monotonicMs: () => 0, hmacHex: unused,
      sha256Hex: async (input) => hex(await crypto.subtle.digest(
        "SHA-256", typeof input === "string" ? encoder.encode(input) : new Uint8Array(input))),
    },
    tokens: { countTokens: unused },
    config: {},
  });
}

/** @param {CaseContext} ctx @param {boolean} [v1] */
async function retainedSave(ctx, v1 = false) {
  const { adapter, harness, owner } = ctx;
  if (!harness.setRetainedDigestFixture) return "needs harness.setRetainedDigestFixture for a foreign signer";
  if (!adapter.keys.retainedDigesters) return "needs keys.retainedDigesters for a foreign signer";
  await harness.setRetainedDigestFixture(owner, legacy);
  equal(await adapter.keys.retainedDigesters(owner), [], "A configured signer without a live fact must be omitted");
  const current = currentForm(variantText);
  const v1Text = v1Form(variantText);
  if (v1) check(v1Text !== current && v1Text !== normalizeForHash(cleanContent(variantText)),
    "The frozen V1 spelling must differ from both the cleaned original and current spelling");
  await seedRetainedFact(ctx, await fixtureDigest(v1 ? v1Text : current, legacy, v1), "test-forget-retained");
  const service = retainedSaveService(ctx);
  const scope = ctx.scope(null);
  equal((await service.save(scope, unrelated, source)).status, "saved", "A comparable retained-domain miss must be saved");
  const result = await service.save(scope, variantText, source);
  check(result.status === "suppressed",
    `A matching ${v1 ? "V1-variant" : "current-form"} retained-domain save must be suppressed, got ${result.status}`);
  const exported = await adapter.uow.run(owner, { readOnly: true }, (tx) =>
    adapter.memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
  equal(exported.items.map(({ text }) => text), [unrelated], "Only the unrelated row must be visible");
}

/** @param {CaseContext} ctx @param {string} id @param {TextDigest[]} expected */
async function expectStoredDigests(ctx, id, expected) {
  /** @type {{owner: string, rows: {row: {id: string, digests: TextDigest[]}}[]}[]} */
  const snapshot = /** @type {any} */ (await readDump(ctx.harness));
  const stored = snapshot.find(({ owner }) => owner === ctx.owner)?.rows.find(({ row }) => row.id === id);
  equal(stored?.row.digests, expected, "Dump must preserve all supplied digest fields and domains");
}

/** @type {readonly ConformanceCase[]} */
export const RETAINED_KEYED_DIGEST_CASES = [
  {
    id: "K-KD-7", title: "admits a retained-domain miss and suppresses a current-form match",
    needs: ["fingerprintKey"],
    run: retainedSave,
  },
  {
    id: "K-KD-7v", title: "suppresses a retained-domain match on the frozen V1 spelling",
    needs: ["fingerprintKey"],
    run: (ctx) => retainedSave(ctx, true),
  },
  {
    id: "K-KD-8", title: "fails closed when a live foreign domain has no signer",
    needs: ["fingerprintKey"],
    async run(ctx) {
      const { adapter: { keys, memories, uow }, owner } = ctx;
      await seedRetainedFact(ctx, await fixtureDigest(currentForm(matching), legacy), "test-forget-foreign");
      const scope = ctx.scope(null);
      const service = retainedSaveService(ctx);
      equal((await service.save(scope, unrelated, source)).status, "suppressed",
        "A save without its live foreign domain must fail closed");

      // K-KD-5 covers missing ring-key evidence. Here even the right key ID is insufficient with a different label.
      const content = await row(ctx, unrelated);
      const key = await ownerKey(ctx);
      const wrongDomain = await fixtureDigest(currentForm(unrelated), { ...legacy, label: "other-test-domain" });
      const digests = [...await allDigests(unrelated, key), wrongDomain];
      await uow.run(owner, {}, async (tx) => {
        const policy = await memories.readWritePolicy(tx, scope, [{ textHash: content.textHash, digests }], source, "hash");
        equal(policy.blockedPositions, [0], "A wrong-label write query must fail closed");
        await memories.insert(tx, scope, { ...content, digests }, [], 1);
      });
      const page = await uow.run(owner, { readOnly: true }, (tx) =>
        memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
      equal(page.items, [], "A wrong-label row must remain hidden");
      equal(await keys.retainedDigesters?.(owner) ?? [], [], "An unconfigured foreign signer must be absent");
    },
  },
  {
    id: "K-KD-9", title: "persists retained digests on insert, replacement and finish and counts each missing domain",
    needs: ["fingerprintKey"],
    async run(ctx) {
      const { adapter: { uow, memories }, harness, owner } = ctx;
      if (!harness.rowsMissingKeyedDigest) return "needs harness.rowsMissingKeyedDigest for retained-domain coverage";
      const key = await ownerKey(ctx);
      const scope = ctx.scope(null);
      const fixture = { ...legacy, keyId: key.id };
      const both = async (/** @type {string} */ text) => {
        const digest = await fixtureDigest(currentForm(text), fixture);
        return [digest, { ...digest, label: "hosted-v1" }];
      };
      const [foreignFact, { label: _label, ...historicalFact }] = await both(matching);
      await seedRetainedFact(ctx, foreignFact, "test-forget-foreign");
      await seedRetainedFact(ctx, { ...historicalFact, pipeline: "hosted-v1" }, "test-forget-historical");
      const missing = () => harness.rowsMissingKeyedDigest?.(owner);
      const initial = await row(ctx, unrelated);
      const current = await allDigests(unrelated, key);
      const retained = await both(unrelated);
      const inserted = await uow.run(owner, {}, async (tx) => {
        const digests = [...current, ...retained];
        const complete = await memories.insert(tx, scope, { ...initial, digests }, [], 1);
        const incomplete = await memories.insert(tx, scope, await row(ctx, third), [], 1);
        return { complete, incomplete, digests };
      });
      await expectStoredDigests(ctx, inserted.complete.id, inserted.digests);
      equal(await missing(), 2, "One row missing two live domains must count twice");

      const edited = "Garden sage";
      const replacement = await row(ctx, edited);
      const digests = [...await allDigests(edited, key), ...(await both(edited)).slice(0, 1)];
      const replaced = await uow.run(owner, {}, (tx) => memories.replaceContent(
        tx, scope, inserted.incomplete.id, inserted.incomplete.revision, { ...replacement, digests }, null, 2));
      equal(replaced.outcome, "changed", "The replacement must commit");
      await expectStoredDigests(ctx, inserted.incomplete.id, digests);
      equal(await missing(), 1, "A different label under the same key must not cover the remaining domain");

      const captureText = "Garden oregano";
      const item = await finishItem(ctx, captureText, key);
      const captureDigests = [...(item.digests ?? []), ...await both(captureText)];
      const finished = await finish(ctx, [{ ...item, digests: captureDigests }]);
      equal(finished.memories.map(({ outcome }) => outcome), ["inserted"], "A covered capture item must commit");
      await expectStoredDigests(ctx, finished.memories[0].id, captureDigests);
      equal(await missing(), 1, "A covered capture item must not increase the gate count");
    },
  },
];

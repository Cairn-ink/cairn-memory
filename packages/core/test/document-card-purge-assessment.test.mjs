import assert from "node:assert/strict";
import { test } from "node:test";
import { coreDigest, coreFingerprintLabels, legacyExactMac, userFingerprintKey } from "../src/index.mjs";
import { buildDocumentCard, documentCardVisible } from "../src/routing/index.mjs";

const scope = { owner: "owner", namespace: null };
const labels = Object.freeze({ keyIdDomain: "example-key-id", shingleKeyPrefix: "example-shingles:", legacyExactPrefix: "example-exact:" });
const key = await userFingerprintKey("example core key", scope.owner, coreFingerprintLabels);
const legacyKey = await userFingerprintKey("example legacy key", scope.owner, labels);
const rotatedKey = await userFingerprintKey("example rotated legacy key", scope.owner, labels);
const body = "The brass compass is in its case.";
const card = { id: "manual", scope, origin: "manual", sourceMessage: null, sourceMemories: [], title: null, body };
const input = { card, requestedScope: scope, memoryStates: new Map(), fingerprintKey: key };
const fact = digests => ({ ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "test", text: { digests } });
const legacyDigest = async (text) => ({
  alg: "hmac", pipeline: "hosted-v1", redactionVersion: 1, value: await legacyExactMac(text, legacyKey, labels),
  keyId: legacyKey.id,
});
const visible = { visible: true, reason: null };
const withheld = { visible: false, reason: "text_withheld" };

test("a matching Core MAC proves withholding independently of an unavailable legacy MAC", async () => {
  const textFacts = [fact([await coreDigest(body, key), await legacyDigest(body)])];
  for (const legacyFingerprint of [undefined, { key: rotatedKey, labels }]) {
    const read = { ...input, textFacts, legacyFingerprint };
    assert.deepEqual(await documentCardVisible(read), withheld);
    assert.deepEqual(await documentCardVisible(read, { definiteOnly: true }), withheld);
    assert.deepEqual(await documentCardVisible({ ...read, fingerprintKey: null }, { definiteOnly: true }),
      { visible: false, reason: "uncertain" });
  }
});

test("a zero legacy cutoff leaves an unrelated Core-only card visible in both verdicts", async () => {
  const read = { ...input, containmentThreshold: 0, textFacts: [fact([await coreDigest("A different note.", key)])] };
  assert.deepEqual(await documentCardVisible(read), visible);
  assert.deepEqual(await documentCardVisible(read, { definiteOnly: true }), visible);
});

test("ordinary visibility agrees with core-next rules across randomized cards and fact sets", async () => {
  let seed = 173475121;
  const pick = values => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return values[Math.floor(seed / 2 ** 32 * values.length)];
  };
  const texts = [body, "The new schedule starts on Friday.", "Keep a pencil beside the map."];
  const digests = new Map(await Promise.all(texts.map(async text => [text, {
    sha: await coreDigest(text), core: await coreDigest(text, key), legacy: await legacyDigest(text),
  }])));
  const domains = [["sha"], ["core"], ["legacy"], ["core", "legacy"], ["sha", "legacy"]];
  const sourceMessage = { client: "fixture", sessionId: "session", messageId: "message" };
  const { card: routed } = await buildDocumentCard({ id: "message", role: "user", content: body },
    { scope, client: sourceMessage.client, canonicalSessionKey: sourceMessage.sessionId });
  for (let trial = 0; trial < 400; trial++) {
    const origin = pick(["manual", "import", "router"]);
    const title = pick([null, ...texts]);
    const body = pick(texts);
    const useCoreKey = pick([false, true]);
    const legacy = pick([undefined, legacyKey, rotatedKey]);
    const cutoff = pick([undefined, 0, 0.6, 1, 2]);
    const inScope = pick([true, true, true, false]);
    const linked = pick([true, false]);
    const status = pick([undefined, "visible", "visible", "historical", "suppressed", "forgotten", "unknown"]);
    const revision = pick([1, 2]);
    const sourceWithheld = pick([false, false, true, null]);
    const validId = pick([true, true, false]);
    const samples = Array.from({ length: pick([0, 1, 2, 3]) }, () => [pick(texts), pick(domains)]);
    const textFacts = samples.map(([text, variants]) => fact(variants.map(variant => digests.get(text)[variant])));
    const read = {
      ...input, card: {
        ...card, origin, title, body, sourceMemories: linked ? [{ id: "memory", revision: 1 }] : [],
        ...(origin === "router" && { id: validId ? routed.id : "unmatched", sourceMessage, canonicalSessionKey: "session" }),
      },
      requestedScope: inScope ? scope : { ...scope, namespace: "other" },
      memoryStates: status ? new Map([["memory", { status, revision }]]) : new Map(),
      sourceWithheld, textFacts, fingerprintKey: useCoreKey ? key : null,
      legacyFingerprint: legacy && { key: legacy, labels }, containmentThreshold: cutoff,
    };
    const withholdsText = samples.some(([text, variants]) => {
      const exactHit = text === title || text === body;
      if (variants.includes("legacy")) {
        if (!legacy && !variants.includes("sha")) return true;
        if (legacy && (legacy !== legacyKey || cutoff === 0 || cutoff === 2 || exactHit)) return true;
      }
      return (variants.includes("core") && (!useCoreKey || exactHit)) || (variants.includes("sha") && exactHit);
    });
    const expected = inScope && (origin === "router"
      ? sourceWithheld === false && validId && (!linked || status === "visible" || status === "historical")
      : (!linked || (status === "visible" && revision === 1)) && !withholdsText);
    assert.equal((await documentCardVisible(read)).visible, expected, `core-next visibility trial ${trial}`);
  }
});

import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { coreDigest, factBlocksIncoming, factHidesRow, withholdsPassage } from "@cairn-ink/core";
import { buildDocumentCard, documentCardSourceWithheld, documentCardVisible } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { allDigests } from "../src/privacy/fingerprint.mjs";
import { shingleContainmentMatch } from "../src/privacy/withholds.mjs";
import { captureTextWithholding } from "../src/service/capture.mjs";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

// Core's tests install Core alone. Resolve the sibling adapter's Core imports to this checkout.
const adapterImports = new Map([
  ["@cairn-ink/core", new URL("../src/index.mjs", import.meta.url).href],
  ["@cairn-ink/core/routing", new URL("../src/routing/index.mjs", import.meta.url).href],
]);
const resolver = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(adapterImports.get(specifier) ?? specifier, context);
  },
});
let createMemoryAdapter;
try {
  ({ createMemoryAdapter } = await import("../../adapter-memory/src/index.mjs"));
} finally {
  resolver.deregister();
}

const forgotten = "Cedar gates are painted on Fridays";
const unrelated = "Maple seedlings are watered on Mondays";
const containing = `${forgotten}. ${unrelated}.`;
const explicitSource = { kind: "mcp", client: null, sessionId: null };
const selection = { client: "client", sessionId: "fresh-session", eventId: "event" };
const { client, sessionId } = selection;
const source = { kind: "import", client, sessionId };
const messages = [unrelated, forgotten].map((content, index) =>
  ({ id: `message-${index}`, role: "user", content, occurredAtMs: 10 + index }));
const [fresh, replay] = messages;
const modelOutput = () => ({ items: [unrelated, forgotten].map(content =>
  ({ content, kind: "fact", confidence: 0.9, sourceIndices: [0] })) });
const keyed = { shingles: ["aa"], keyId: "shingle-key" };
const capture = { mode: "capture" };

const keylessPassage = digests => ({ digests, shingles: null, keyId: null });
const storedFact = fact => ({ fact: { ...scope, origin: "forget", actionId: "forget-cedar", ...fact } });
const fullTextFact = text => storedFact({ kind: "text", mode: "full", text });

async function setup() {
  const fake = serviceFake({ writes: true, capture: true, rawArchive: true, hasKey: false,
    forgetting: {}, compliantCapturePrefilter: true });
  // Exercise Core's snapshot decisions with a source eligibility check that allows every position.
  fake.hooks.eligible = rows => rows.map((_, index) => index);
  const digests = await allDigests(forgotten, null);
  const seedForgotten = (evidence = {}) => fake.seedFact(fullTextFact({ digests, ...evidence }).fact);
  return { ...fake, service: createMemoryService(fake.deps), seedForgotten };
}

function referenceService({ fingerprintKey = false, resolveSpans } = {}) {
  const adapter = createMemoryAdapter({ capabilities: { fingerprintKey } });
  const { deps } = serviceFake({ writes: true, forgetting: {} });
  // The reference adapter does not implement the optional span resolver.
  const storage = resolveSpans ? {
    ...adapter,
    capabilities: { ...adapter.capabilities, spanLineage: true, rawSpans: true },
    spanLineage: { resolveSpans },
  } : adapter;
  return { adapter, service: createMemoryService({ ...deps, storage }) };
}

async function forgetSaved(service, memorySource = explicitSource) {
  const saved = await service.save(scope, forgotten, memorySource);
  assert.equal(saved.status, "saved");
  assert.deepEqual(await service.forget(scope, saved.item.id, explicitSource),
    { status: "forgotten", removedSimilar: 0 });
  return saved.item.id;
}

async function storedFacts(adapter) {
  const [state] = await adapter.harness.dump();
  return state.facts;
}

function manualCardRead(body, textFacts, fingerprintKey) {
  // MemoryService.read does not serve cards yet. Check the routing verdict directly.
  return documentCardVisible({
    card: { id: "card", scope, origin: "manual", title: null, body, sourceMessage: null, sourceMemories: [] },
    requestedScope: scope, textFacts, fingerprintKey,
  });
}

const visible = { visible: true, reason: null };
const textWithheld = { visible: false, reason: "text_withheld" };

for (const [name, body, expected] of [
  ["withholds the exact card", forgotten, textWithheld],
  ["leaves the containing card visible", containing, visible],
  ["leaves the unrelated card visible", unrelated, visible],
]) {
  test(`keyless forget ${name}`, async () => {
    const { adapter, service } = referenceService();
    await forgetSaved(service);
    const [{ fact }] = await storedFacts(adapter);
    const fingerprintKey = await adapter.keys.userKey(scope.owner);
    assert.equal(fingerprintKey, null);
    assert.equal(fact.mode, "exact");
    assert.deepEqual(await manualCardRead(body, [fact], fingerprintKey), expected, "service forget fact");
    // A full-mode fact carrying only SHA aliases reaches containment after a digest miss.
    assert.deepEqual(await manualCardRead(body, [{ ...fact, mode: "full" }], fingerprintKey), expected,
      "full-mode forget fact without key evidence");
  });
}

test("keyless forget withholds a card derived from the forgotten memory's Raw source span", async () => {
  const message = { ...replay, content: containing };
  const { value: sessionKeyHash } = await coreDigest(sessionId);
  const { value: contentDigest } = await coreDigest(message.content);
  const span = { ...scope, kind: "rawSpan", origin: "forget", actionId: "source-span",
    sessionKeyHash, messageKey: message.id, contentDigest, startUtf16: 0, endUtf16: forgotten.length };
  let resolvedFor;
  const { adapter, service } = referenceService({ async resolveSpans(_tx, requestedScope, memoryId) {
    assert.deepEqual(requestedScope, scope);
    resolvedFor = memoryId;
    return [span];
  } });
  const id = await forgetSaved(service, { kind: "capture", client, sessionId });
  assert.equal(resolvedFor, id);
  const [textFact, spanFact] = await storedFacts(adapter);
  assert.deepEqual(spanFact.fact, { ...span, actionId: textFact.fact.actionId });
  const fingerprintKey = await adapter.keys.userKey(scope.owner);
  assert.equal(fingerprintKey, null);
  const { card } = await buildDocumentCard(message, { scope, client, canonicalSessionKey: sessionId });
  assert.ok(card);
  const source = { sourceLengthUtf16: message.content.length, sourceExcluded: false,
    rawRows: [{ type: "raw", scope, sessionKeyHash, messageKey: message.id, startUtf16: 0,
      endUtf16: message.content.length, digests: await allDigests(message.content, null) }] };
  const cardRead = {
    card: { ...card, scope, origin: "router", canonicalSessionKey: sessionId,
      sourceMessage: { client, sessionId, messageId: message.id }, sourceMemories: [] },
    requestedScope: scope, memoryStates: new Map(), fingerprintKey,
  };
  assert.deepEqual(await documentCardVisible({ ...cardRead,
    sourceWithheld: documentCardSourceWithheld({ ...source, facts: [textFact] }) }), visible);
  assert.deepEqual(await documentCardVisible({ ...cardRead,
    sourceWithheld: documentCardSourceWithheld({ ...source, facts: [textFact, spanFact] }) }),
    { visible: false, reason: "source_withheld" });
});

test("a keyed forget still withholds a containing card when the read key is lost", async () => {
  const { adapter, service } = referenceService({ fingerprintKey: true });
  const key = await adapter.keys.userKey(scope.owner);
  assert.ok(key);
  await forgetSaved(service);
  const [{ fact }] = await storedFacts(adapter);
  assert.equal(fact.mode, "full");
  assert.equal(fact.text.keyId, key.id);
  assert.ok(fact.text.shingles.length > 0);
  assert.deepEqual(await manualCardRead(containing, [], null), visible);
  assert.deepEqual(await manualCardRead(containing, [fact], key), textWithheld);
  assert.deepEqual(await manualCardRead(containing, [fact], null), textWithheld);
});

test("an explicit keyless save refuses the forgotten text and accepts a containing passage", async () => {
  const { adapter, service } = referenceService();
  await forgetSaved(service);
  const [{ fact }] = await storedFacts(adapter);
  await adapter.harness.seedFact(scope.owner, { ...fact, mode: "full" });

  assert.deepEqual(await service.save(scope, forgotten, explicitSource), { status: "suppressed" });
  const saved = await service.save(scope, containing, explicitSource);
  assert.equal(saved.status, "saved");
  assert.equal(saved.item.text, containing);
});

test("capture admission keeps unrelated text and scrubs an exact replay without keys", async () => {
  const { service, seedForgotten, mutations } = await setup();
  seedForgotten();
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
  const expected = [fresh, { ...replay, content: "" }];
  assert.deepEqual(mutations.find(({ method }) => method === "capture.admit").args[1], expected);
  assert.deepEqual(mutations.find(({ method }) => method === "raw.recordLineage").args[1], expected);
});

for (const duringEmbedding of [false, true]) {
  const stage = duringEmbedding ? "at finish" : "before embedding";
  test(`capture keeps unrelated text and withholds an exact replay without keys ${stage}`, async () => {
    const { service, seedForgotten, calls, hooks, mutations } = await setup();
    assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages: [fresh] }), { status: "accepted" });
    hooks.model = modelOutput;
    if (duringEmbedding) hooks.embed = () => seedForgotten();
    else seedForgotten();

    assert.equal((await service.runCapture(scope, selection)).status, "done");
    const expectedEmbeddings = duringEmbedding ? [unrelated, forgotten] : [unrelated];
    assert.deepEqual(calls.find(([method]) => method === "embed")?.[1],
      expectedEmbeddings.map(content => content.toLowerCase()));
    const items = mutations.find(({ method }) => method === "capture.finish").args[1];
    assert.deepEqual(items.map(({ content }) => content), [unrelated]);
  });
}

test("memory import admits unrelated text and withholds an exact replay without keys", async () => {
  const { service, seedForgotten, committed } = await setup();
  seedForgotten();
  const items = [unrelated, forgotten].map(text => ({ text, kind: "fact" }));
  assert.deepEqual(await service.importMemories(scope, items, source),
    { imported: 1, duplicate: 0, suppressed: 1, invalid: 0 });
  assert.deepEqual(committed(scope.owner).rows.map(({ text }) => text), [unrelated]);
});

test("Raw import admits unrelated text and withholds an exact replay without keys", async () => {
  const { service, seedForgotten, calls, archived } = await setup();
  seedForgotten();
  assert.deepEqual(await service.importRawMessages(scope, [{ client, sessionId, messages }]),
    { imported: 1, duplicate: 0, suppressed: 1, invalid: 0 });
  assert.deepEqual(calls.find(([method]) => method === "raw.importArchive").at(-1), { withheld: [1] });
  assert.deepEqual(archived(scope.owner), [fresh]);
});

test("Raw import still withholds a keyless candidate when the fact has shingles", async () => {
  const { service, seedForgotten, calls, archived } = await setup();
  seedForgotten(keyed);
  assert.deepEqual(await service.importRawMessages(scope, [{ client, sessionId, messages: [fresh] }]),
    { imported: 0, duplicate: 0, suppressed: 1, invalid: 0 });
  assert.deepEqual(calls.find(([method]) => method === "raw.importArchive").at(-1), { withheld: [0] });
  assert.deepEqual(archived(scope.owner), []);
});

test("capture matcher withholds a comparable SHA miss when only the fact has a key", async () => {
  const passages = [keylessPassage(await allDigests(unrelated, null))];
  const text = keylessPassage(await allDigests(forgotten, null));
  const mac = { ...text.digests[0], alg: "hmac", value: "a".repeat(64), keyId: keyed.keyId };
  for (const [label, evidence] of [
    ["shingle key and shingles", keyed],
    ["shingle key alone", { keyId: keyed.keyId }],
    ["HMAC alone", { digests: [...text.digests, mac] }],
  ]) {
    const stored = fullTextFact({ ...text, ...evidence });
    assert.equal(factBlocksIncoming(stored, { scope, passages }, capture), "ineligible", label);
    assert.equal(withholdsPassage(passages[0], stored.fact), true, label);
  }
});

test("capture matcher keeps a SHA-miss fact with only retained shingles", async () => {
  const candidate = keylessPassage(await allDigests(unrelated, null));
  const text = keylessPassage(await allDigests(forgotten, null));
  const stored = fullTextFact({ ...text, retainedShingles: [keyed] });
  assert.equal(factBlocksIncoming(stored, { scope, passages: [candidate] }, capture), "ineligible");
});

test("capture keeps a legacy MAC fact when the candidate has no key", async () => {
  const legacy = fullTextFact(keylessPassage([{
    alg: "hmac", value: "a".repeat(64), pipeline: "engine-legacy", redactionVersion: 1, keyId: keyed.keyId,
  }]));
  const candidate = keylessPassage(await allDigests(unrelated, null));
  assert.equal(factBlocksIncoming(legacy, { scope, passages: [candidate] }, capture), "ineligible");
  assert.equal(withholdsPassage(candidate, legacy.fact), true);
  assert.equal(captureTextWithholding([legacy]).legacyKeyUnavailable, true);
});

test("capture matcher withholds an exact hit on each keyless SHA digest variant", async () => {
  // The quoted field and fullwidth assignment produce distinct hashes in all three pipelines.
  const raw = '{"refresh_token":"fake"} ｐａｓｓｗｏｒｄ＝fictional-example';
  const digests = await allDigests(raw, null);
  assert.deepEqual(digests.map(({ pipeline }) => pipeline), ["core", "hosted-v1", "engine-legacy"]);
  const stored = fullTextFact(keylessPassage(digests));
  for (const digest of digests) {
    const candidate = keylessPassage([digest]);
    assert.equal(factBlocksIncoming(stored, { scope, passages: [candidate] }, capture), true, digest.pipeline);
    assert.equal(withholdsPassage(candidate, stored.fact), true, digest.pipeline);
  }
  const miss = keylessPassage(await allDigests(unrelated, null));
  assert.equal(factBlocksIncoming(stored, { scope, passages: [miss] }, capture), false);
  assert.equal(withholdsPassage(miss, stored.fact), false);
});

test("a keyless passage leaves capture window boundaries and uncertain times unchanged", async () => {
  const passages = [keylessPassage(await allDigests(unrelated, null))];
  const window = storedFact({ kind: "window", client, window: { startMs: 10, endMs: 20 } });
  const incoming = { scope, passages, session: { client, sessionId } };
  for (const [occurredAtMs, expected] of [[9, false], [10, true], [19, true], [20, false], [undefined, "ineligible"]]) {
    assert.equal(factBlocksIncoming(window, { ...incoming, occurredAtMs }, capture), expected);
  }
});

test("a keyless passage leaves Raw span overlap and capture handling unchanged", async () => {
  const passage = keylessPassage(await allDigests(unrelated, null));
  const sessionKeyHash = "a".repeat(64);
  const messageKey = "message";
  const span = storedFact({ kind: "rawSpan", sessionKeyHash, messageKey,
    contentDigest: "b".repeat(64), startUtf16: 2, endUtf16: 6 });
  const row = { type: "raw", scope, sessionKeyHash, messageKey, ...passage };
  assert.equal(factHidesRow(span, { ...row, startUtf16: 5, endUtf16: 8 }), true);
  assert.equal(factHidesRow(span, { ...row, startUtf16: 6, endUtf16: 8 }), false);
  assert.equal(factHidesRow(span, { ...row, startUtf16: 6 }), "ineligible");
  assert.equal(factBlocksIncoming(span, { scope, passages: [passage] }, capture), false);
});

for (const [name, passage, reference, expected] of [
  ["neither side has shingles or a key", { shingles: null, keyId: null }, {}, false],
  ["only the candidate has shingles", keyed, {}, "ineligible"],
  ["only the fact has shingles", {}, keyed, "ineligible"],
  ["both sides have matching shingles", keyed, keyed, true],
  ["both sides have disjoint shingles", { ...keyed, shingles: ["bb"] }, keyed, false],
  ["only the candidate has an empty shingle list", { shingles: [] }, {}, "ineligible"],
  ["a key is present without shingles", { keyId: keyed.keyId }, {}, "ineligible"],
  ["only digest evidence has a key", {
    digests: [{ alg: "hmac", value: "a".repeat(64), pipeline: "core", redactionVersion: 3, keyId: keyed.keyId }],
  }, {}, "ineligible"],
  ["retained shingles are present only on the candidate", { retainedShingles: [keyed] }, {}, "ineligible"],
]) {
  test(`shingle containment after an exact miss when ${name}`, () => {
    assert.equal(shingleContainmentMatch(passage, reference, 0.75, true), expected);
  });
}

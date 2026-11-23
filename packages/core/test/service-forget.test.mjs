import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  allDigests, CoreError, factIncarnationBody, normalizeForHash, SUPPRESSION_DISTANCE,
} from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { validateSuppressionFact } from "../src/suppression-fact.mjs";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const wording = "The lantern is stored in the cellar.";
const page = { limit: 50, cursor: null };
const sha = value => createHash("sha256").update(value).digest("hex");
const code = expected => error => error instanceof CoreError && error.code === expected && error.message === expected;
const row = (id, text = wording, overrides = {}) => ({
  ...memory(id, { text }), textHash: "sha256:" + sha(normalizeForHash(text)), ...overrides,
});
const embedded = vector => ({ embedding: { model: "stored-model", vector } });

function setup(options = {}) {
  const fake = serviceFake({ writes: true, forgetting: {}, ...options });
  return { ...fake, service: createMemoryService(fake.deps) };
}

async function visibleIds(service) {
  const recent = await service.recent(scope, page);
  const session = await service.sessionStart(scope, { maxTokens: 2000, maxChars: 8000 });
  const exported = await service.exportMemories(scope, page);
  const groups = Object.values(session.groups).flatMap(group => group.items);
  return [recent.items, groups, exported.items].map(items => items.map(({ id }) => id).sort());
}

test("forget erases the target and keeps an identical row hidden in recent, sessionStart and export", async () => {
  const rows = [row("target"), row("identical"), row("other", "Use the blue notebook for inventory.")];
  const { service, calls, committed } = setup({ rows });
  assert.deepEqual(await visibleIds(service), Array(3).fill(["identical", "other", "target"]));
  calls.length = 0;

  assert.deepEqual(await service.forget(scope, "target", source), { status: "forgotten", removedSimilar: 1 });
  assert.deepEqual(calls.filter(([method]) => method === "run"), [["run", scope.owner, { pauseLock: true }]]);
  const state = committed(scope.owner);
  assert.deepEqual(state.rows.map(({ id }) => id), ["identical", "other"]);
  const [{ fact, incarnation, epoch }] = state.facts;
  assert.equal(epoch, 1n);
  assert.equal(incarnation, sha(factIncarnationBody(fact)));
  assert.equal(fact.kind, "text");
  assert.equal(fact.mode, "full");
  assert.equal(fact.origin, "forget");
  assert.deepEqual(fact.sourceMemory, { id: "target", createdAtMs: rows[0].createdAtMs });
  for (const digest of await allDigests(wording)) {
    assert.ok(fact.text.digests.some(({ value, alg }) => value === digest.value && alg === digest.alg));
  }
  assert.deepEqual(await visibleIds(service), Array(3).fill(["other"]));
});

const cosine = 0.85;
const nearVector = Float32Array.of(cosine, Math.sqrt(1 - cosine ** 2));

for (const kind of ["mcp", "web"]) {
  test(`an explicit ${kind} rephrase at distance 0.15 is saved after forget`, async () => {
    // Hosted test/memory/explicit-save-suppression.test.ts:7–17,87–100.
    const original = "My synthetic test preference is jasmine tea.";
    const correction = "My synthetic test preference is oolong tea.";
    const explicitSource = { ...source, kind };
    const { service, deps, hooks } = setup({
      near: true, forgetting: { capabilities: { vectorSuppression: true } },
    });
    deps.embedder.dimensions = 2;
    hooks.embed = ([text]) => text === correction.toLowerCase() ? nearVector : Float32Array.of(1, 0);
    const saved = await service.save(scope, original, explicitSource);
    assert.equal(saved.status, "saved");
    assert.deepEqual(await service.forget(scope, saved.item.id, explicitSource), {
      status: "forgotten", removedSimilar: 0,
    });
    const updated = await service.save(scope, correction, explicitSource);
    assert.equal(updated.status, "saved");
    assert.deepEqual(updated.item.embedding.vector, nearVector);
    assert.deepEqual(await visibleIds(service), Array(3).fill([updated.item.id]));
  });
}

test("explicit save admits a new favorite color after forgetting the old color", async () => {
  // Hosted src/memory/suppressions.ts:131–149 and web/src/pages/legal/memory-privacy.tsx:157.
  const { service } = setup({ rows: [row("target", "My favorite color is blue.")] });
  await service.forget(scope, "target", source);
  assert.equal((await service.save(scope, "My favorite color is red.", source)).status, "saved");
});

for (const operation of ["save", "correct"]) {
  test(`${operation} succeeds with zero forget facts when only candidate snapshots are bounded`, async () => {
    // Hosted src/memory/index.ts:193–198,213–226 and src/memory/suppressions.ts:152–164.
    const target = row("target");
    const { service, calls, hooks, committed } = setup({ rows: [target] });
    assert.deepEqual(committed(scope.owner).facts, []);
    hooks.snapshot = candidates => {
      if (candidates.passages === undefined) throw new CoreError("ineligible");
    };
    const text = "Use the blue notebook for inventory.";
    const result = operation === "save" ? await service.save(scope, text, source)
      : await service.correct(scope, target.id, target.revision, text, source);
    assert.equal(result.status, "saved");
    const snapshots = calls.filter(([method]) => method === "suppressions.snapshot");
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0][2].passages.length, 1);
  });
}

test("a forgotten exact paste is suppressed and a prefixed single passage is saved", async () => {
  // Hosted test/memory/explicit-save-suppression.test.ts:140–145 and src/memory/suppressions.ts:138–149.
  for (const [original, prefix] of [[wording, "Earlier note for reference: "], ["tea", "Drink of choice: "]]) {
    const { service } = setup({ rows: [row("target", original)] });
    await service.forget(scope, "target", source);
    assert.deepEqual(await service.save(scope, original, source), { status: "suppressed" });
    assert.equal((await service.save(scope, prefix + original, source)).status, "saved");
  }
});

const multiPassageReplay = "Earlier note for reference: " + wording + " Sample key sk-0123456789abcdef.";

test("a multi-passage lantern replay is suppressed when the candidate snapshot omits the forget fact", async () => {
  // Hosted src/memory/suppressions.ts:138–149 checks forget containment for multiple passages.
  const { service, storage, mutations } = setup({ rows: [row("target")] });
  await service.forget(scope, "target", source);
  const snapshot = storage.suppressions.snapshot;
  const reads = [];
  storage.suppressions.snapshot = async (tx, scoped, candidates) => {
    const result = await snapshot(tx, scoped, candidates);
    reads.push([tx, scoped, candidates, result.passages.length]);
    return result;
  };

  assert.deepEqual(await service.save(scope, multiPassageReplay, source), { status: "suppressed" });
  assert.equal(reads.length, 2);
  assert.equal(reads[0][0], reads[1][0]);
  assert.deepEqual(reads.map(([, scoped, candidates, facts]) => [scoped, candidates.passages?.length, facts]), [
    [scope, 2, 0], [scope, undefined, 1],
  ]);
  assert.equal(mutations.some(({ method }) => method === "memories.insert"), false);
});

test("a multi-passage write fails closed when the scoped forget snapshot is refused", async () => {
  const { service, hooks, mutations } = setup();
  hooks.snapshot = candidates => {
    if (candidates.passages === undefined) throw new CoreError("ineligible");
  };
  await assert.rejects(service.save(scope, multiPassageReplay, source), code("ineligible"));
  assert.deepEqual(mutations, []);
});

for (const length of [129, 512]) {
  test(`forget erases a stored row with a ${length}-character ID`, async () => {
    const target = row("m".repeat(length));
    const { service, committed } = setup({ rows: [target] });
    assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 0 });
    assert.deepEqual(committed(scope.owner).rows, []);
    assert.equal(committed(scope.owner).facts[0].fact.sourceMemory.id, target.id);
    assert.deepEqual(await visibleIds(service), Array(3).fill([]));
  });
}

test("a suppression identity accepts a 512-character memory ID and rejects 513", () => {
  const fact = { ...scope, kind: "identity", actionId: "identity-fixture", origin: "forget" };
  assert.doesNotThrow(() => validateSuppressionFact({ ...fact, memoryId: "m".repeat(512) }));
  assert.throws(() => validateSuppressionFact({ ...fact, memoryId: "m".repeat(513) }), code("invalid_input"));
});

for (const origin of ["forget", "edit"]) {
  test(`${origin} detects the synthetic credential in raw text before NFKC`, async () => {
    const target = row("target", "Ｘsk-0123456789abcdef");
    // Use the OW1 fixture for edit to inspect the fact independently of the adapter's MAC-only row filtering.
    const { service, committed } = setup({ rows: [target], ...(origin === "edit" && { forgetting: undefined }) });
    if (origin === "forget") {
      assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 0 });
    } else {
      assert.equal((await service.correct(scope, target.id, target.revision, "Use the blue notebook.", source)).status, "saved");
    }
    const [{ fact }] = committed(scope.owner).facts;
    assert.equal(fact.origin, origin);
    assert.ok(fact.text.digests.length > 0);
    assert.ok(fact.text.digests.every(({ alg, keyId }) => alg === "hmac" && keyId === "fixture-key"));
  });
}

test("an absent row takes precedence over a missing or failing key and writes nothing", async () => {
  const { service, hooks, mutations, calls } = setup({ hasKey: false });
  assert.deepEqual(await service.forget(scope, "missing", source), { status: "not_found" });
  hooks.fault = step => { if (step === "keys.userKey") throw new Error("private adapter error"); };
  assert.deepEqual(await service.forget(scope, "missing", source), { status: "not_found" });
  assert.equal(calls.filter(([method]) => method === "memories.get").length, 2);
  assert.deepEqual(mutations, []);
});

test("an existing row without a fingerprint key fails closed with zero writes", async () => {
  const target = row("target");
  const { service, mutations, committed } = setup({ rows: [target], hasKey: false });
  const before = committed(scope.owner);
  await assert.rejects(() => service.forget(scope, target.id, source), code("fingerprint_unavailable"));
  assert.deepEqual(committed(scope.owner), before);
  assert.deepEqual(mutations, []);
});

test("forget remains available while paused and keeps the pause lock", async () => {
  const { service, calls } = setup({ rows: [row("target")] });
  await service.setPause(scope.owner, true);
  calls.length = 0;
  assert.deepEqual(await service.forget(scope, "target", source), { status: "forgotten", removedSimilar: 0 });
  assert.deepEqual(calls.filter(([method]) => method === "run" || method === "lock"), [
    ["run", scope.owner, { pauseLock: true }], ["lock", "pause"], ["lock", "owner-write"],
  ]);
  assert.deepEqual(await service.pauseState(scope.owner), { paused: true, generation: 1 });
});

test("removedSimilar counts visible exact and inclusive distance neighbours before writing the fact", async () => {
  const target = row("target", wording, embedded(Float32Array.of(1, 0)));
  const hidden = row("hidden", "Previously hidden", embedded([1, 0]));
  const rows = [
    target, row("exact"), hidden,
    row("boundary", "A close match", embedded([0.8, 0.6])),
    row("outside", "A more distant match", embedded([0.79, Math.sqrt(1 - 0.79 ** 2)])),
    row("other-owner", wording, { scope: { ...scope, owner: "another-owner" } }),
    row("other-namespace", wording, { scope: { ...scope, namespace: "another-namespace" } }),
  ];
  const { service, calls, forget, committed } = setup({
    rows, near: true, forgetting: { capabilities: { vectorSuppression: true } },
  });
  forget(hidden);
  assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 2 });
  assert.deepEqual(calls.find(([method]) => method === "memories.findDuplicates"), [
    "memories.findDuplicates", scope, { textHash: target.textHash, embedding: target.embedding.vector },
    { nearDistance: SUPPRESSION_DISTANCE, excludeId: target.id },
  ]);
  assert.deepEqual(committed(scope.owner).facts[0].fact.text.embedding, [1, 0]);
  assert.deepEqual(await visibleIds(service), Array(3).fill(["outside"]));
  assert.equal(calls.filter(([method]) => method === "embed" || method === "gate").length, 0);
});

for (const vectorSuppression of [true, false]) {
  const nearDuplicate = !vectorSuppression;
  test(`forget counts exact matches with vectorSuppression=${vectorSuppression}, nearDuplicate=${nearDuplicate}`, async () => {
    const target = row("target", wording, embedded([1, 0]));
    const { service, calls } = setup({
      rows: [target, row("exact"), row("neighbor", "A close match", embedded(nearVector))],
      near: nearDuplicate, forgetting: { capabilities: { vectorSuppression } },
    });
    assert.deepEqual(await service.forget(scope, target.id, source), { status: "forgotten", removedSimilar: 1 });
    assert.deepEqual(calls.find(([method]) => method === "memories.findDuplicates"), [
      "memories.findDuplicates", scope, { textHash: target.textHash, embedding: undefined },
      { nearDistance: SUPPRESSION_DISTANCE, excludeId: target.id },
    ]);
    assert.deepEqual(await visibleIds(service), Array(3).fill(vectorSuppression ? [] : ["neighbor"]));
  });
}

const root = { client: "capture-client", sessionId: "root" };
const fork = { ...root, sessionId: "fork" };
const firstMessage = { ...root, messageId: "message-one" };
const secondMessage = { ...fork, messageId: "message-two" };

function spanReceipt(sourceMessage, sessionKeyHash) {
  return { ...sourceMessage, sessionKeyHash, messageKey: sourceMessage.messageId, role: "user", occurredAtMs: null };
}

function rawSpan({ sessionKeyHash, messageKey }) {
  return {
    ...scope, kind: "rawSpan", origin: "forget", actionId: "span-fixture", messageKey, sessionKeyHash,
    contentDigest: "b".repeat(64), startUtf16: 0, endUtf16: 8,
  };
}

function lineageSetup(overrides = {}) {
  const target = row("target", wording, { source: { kind: "capture", ...root } });
  const closure = [root, fork];
  const first = spanReceipt(firstMessage, "a".repeat(64));
  const second = spanReceipt(secondMessage, "b".repeat(64));
  const receipts = [first, second, first];
  const spans = [rawSpan(first)];
  const capabilities = {
    spanLineage: true, rawSpans: true, sessionLineage: true, rawArchive: true, conflictEdges: true,
    documentCards: true, quantityLedger: true, forgetLog: true, ...overrides,
  };
  return setup({ rows: [target], forgetting: { capabilities, closure, receipts, spans } });
}

test("forget writes and cascades in order on one transaction, hiding every resolved document-card selector", async () => {
  const { service, calls, mutations, committed } = lineageSetup();
  assert.deepEqual(await service.forget(scope, "target", source), { status: "forgotten", removedSimilar: 0 });
  const operations = calls.map(([method]) => method);
  assert.deepEqual(operations, [
    "keys.userKey", "run", "lock", "lock", "memories.get", "memories.findDuplicates",
    "spanLineage.resolveSpans", "hydrate.hydrate", "sessionLineage.provenClosure", "suppressions.writeFact",
    "raw.fenceSession", "raw.fenceSession", "raw.eraseSessions", "raw.purgeWithheld", "suppressions.writeFact",
    ...Array(5).fill("documentCards.hideWhere"), "conflicts.invalidate", "quantityLedger.dropWhere", "memories.erase",
    "forgetLog.record",
  ]);
  assert.equal(new Set(mutations.map(({ run }) => run)).size, 1);
  const { effects, facts } = committed(scope.owner);
  const selectors = [
    { sourceMemoryId: "target" }, { sourceMessage: firstMessage }, { sourceMessage: secondMessage },
    { session: root }, { session: fork },
  ];
  assert.deepEqual(calls.filter(([method]) => method === "documentCards.hideWhere").map(([, ...args]) => args),
    selectors.map(selector => [scope, selector, "forget"]));
  assert.deepEqual(effects.hiddenCards, selectors);
  assert.deepEqual(effects.fences, [root, fork]);
  assert.deepEqual(effects.closures, [[root, fork]]);
  assert.deepEqual(effects.purges, [[facts[0]]]);
  assert.deepEqual(effects.logs, ["target"]);
  assert.deepEqual(effects.invalidatedConflicts, ["target"]);
  assert.deepEqual(effects.quantityDrops, [{ by: "memoryId", id: "target" }]);
  assert.deepEqual(facts.map(({ fact, epoch }) => [fact.kind, epoch]), [["text", 1n], ["rawSpan", 2n]]);
});

test("card lineage requires both session and message identity for every span", async () => {
  const first = { client: root.client, sessionId: "A", messageId: "1" };
  const second = { ...first, sessionId: "B" };
  const receiptA = spanReceipt(first, "a".repeat(64));
  const receiptB = spanReceipt(second, "b".repeat(64));
  const capabilities = { documentCards: true, spanLineage: true, rawSpans: true };
  const matched = setup({
    rows: [row("target")],
    forgetting: { capabilities, receipts: [receiptA, receiptB], spans: [rawSpan(receiptA), rawSpan(receiptB)] },
  });
  assert.deepEqual(await matched.service.forget(scope, "target", source), { status: "forgotten", removedSimilar: 0 });
  assert.deepEqual(matched.committed(scope.owner).effects.hiddenCards, [
    { sourceMemoryId: "target" }, { sourceMessage: first }, { sourceMessage: second },
  ]);

  const mismatched = setup({
    rows: [row("target")], forgetting: { capabilities, receipts: [receiptB], spans: [rawSpan(receiptA)] },
  });
  const before = mismatched.committed(scope.owner);
  await assert.rejects(() => mismatched.service.forget(scope, "target", source), code("raw_lineage_unavailable"));
  assert.deepEqual(mismatched.committed(scope.owner), before);
  assert.deepEqual(mismatched.mutations, []);
});

test("resolved spans must be written and a store refusal rolls back the entire forget", async () => {
  const { service, hooks, committed, mutations } = lineageSetup({ rawSpans: false });
  const before = committed(scope.owner);
  hooks.fault = method => {
    if (method === "suppressions.writeSpan") throw new CoreError("capability_unavailable");
  };
  await assert.rejects(() => service.forget(scope, "target", source), code("capability_unavailable"));
  assert.deepEqual(committed(scope.owner), before);
  assert.ok(mutations.some(({ method, args }) => method === "suppressions.writeFact" && args[0].kind === "rawSpan"));
});

for (const [port, selector] of [
  ["keys.userKey"], ["memories.get"], ["memories.findDuplicates"], ["spanLineage.resolveSpans"],
  ["hydrate.hydrate"], ["sessionLineage.provenClosure"], ["clock.sha256Hex"], ["suppressions.writeFact"],
  ["raw.fenceSession"], ["raw.eraseSessions"], ["raw.purgeWithheld"], ["suppressions.writeSpan"],
  ["documentCards.hideWhere", { session: fork }], ["conflicts.invalidate"], ["quantityLedger.dropWhere"],
  ["memories.erase"], ["forgetLog.record"], ["commit"],
]) {
  test(`a fault at ${port} rolls back facts, epoch, row erasure, Raw and card changes`, async () => {
    const { service, hooks, committed } = lineageSetup();
    const before = committed(scope.owner);
    const error = new CoreError("storage_error");
    hooks.fault = (method, _scope, current) => {
      if (method === port && (!selector || current.session?.sessionId === selector.session.sessionId)) throw error;
    };
    await assert.rejects(() => service.forget(scope, "target", source), failure => failure !== error && code("storage_error")(failure));
    assert.deepEqual(committed(scope.owner), before);
  });
}

test("a late erase failure on the core-only path leaves no independently committed fact", async () => {
  const { service, hooks, committed } = setup({ rows: [row("target")] });
  const before = committed(scope.owner);
  hooks.fault = method => { if (method === "memories.erase") throw new CoreError("storage_error"); };
  await assert.rejects(() => service.forget(scope, "target", source), code("storage_error"));
  assert.deepEqual(committed(scope.owner), before);
});

test("missing Raw and span capabilities skip only their steps", async () => {
  const { service, calls, committed } = lineageSetup({ rawArchive: false, spanLineage: false });
  assert.deepEqual(await service.forget(scope, "target", source), { status: "forgotten", removedSimilar: 0 });
  assert.ok(!calls.some(([method]) => /^(raw|sessionLineage|spanLineage)\./u.test(method)));
  const { effects, facts, rows } = committed(scope.owner);
  assert.deepEqual(effects.hiddenCards, [
    { sourceMemoryId: "target" }, { sourceMessage: firstMessage }, { sourceMessage: secondMessage },
  ]);
  assert.equal(facts.length, 1);
  assert.deepEqual(effects.logs, ["target"]);
  assert.deepEqual(rows, []);
});

test("forget fences a direct source without lineage proof and purges only by text", async () => {
  const { service, committed } = lineageSetup({ sessionLineage: false });
  await service.forget(scope, "target", source);
  const { effects, facts } = committed(scope.owner);
  assert.deepEqual(effects.fences, [root]);
  assert.deepEqual(effects.closures, []);
  assert.deepEqual(effects.purges, [[facts[0]]]);
});

test("missing clear card lineage fails closed", async () => {
  const { service, mutations } = setup({
    rows: [row("target")], forgetting: { capabilities: { documentCards: true }, receipts: null },
  });
  await assert.rejects(() => service.forget(scope, "target", source), code("raw_lineage_unavailable"));
  assert.deepEqual(mutations, []);
});

test("repeated forget reuses the same fact, but an incarnation conflict rolls back", async () => {
  const initial = row("target", wording, embedded([1, 0]));
  const { service, insert, committed, mutations } = setup({
    rows: [initial], forgetting: { capabilities: { rawArchive: true, forgetLog: true } },
  });
  const forget = () => service.forget(scope, initial.id, source);
  assert.deepEqual(await forget(), { status: "forgotten", removedSimilar: 0 });
  const first = committed(scope.owner);
  mutations.length = 0;
  assert.deepEqual(await forget(), { status: "not_found" });
  assert.deepEqual(mutations, []);
  assert.deepEqual(committed(scope.owner), first);

  insert({ ...initial, ...embedded([0, 1]) });
  assert.deepEqual(await forget(), { status: "forgotten", removedSimilar: 0 });
  const second = committed(scope.owner);
  assert.deepEqual(second.facts, first.facts);
  assert.deepEqual(second.effects.purges, [[first.facts[0]], [first.facts[0]]]);
  assert.deepEqual(second.effects.logs, [initial.id]);

  insert({ ...initial, createdAtMs: initial.createdAtMs + 1 });
  const beforeConflict = committed(scope.owner);
  await assert.rejects(forget, code("fact_conflict"));
  assert.deepEqual(committed(scope.owner), beforeConflict);
});

test("forget detaches inputs once and never uses a foreign mutation target", async t => {
  const { service, hooks, mutations } = setup({ rows: [row("target")] });
  const input = { ...scope };
  const inputSource = { ...source };
  const clone = t.mock.method(globalThis, "structuredClone", structuredClone);
  hooks.fault = method => {
    if (method === "keys.userKey") {
      input.owner = "different-owner";
      inputSource.kind = "bogus";
    }
  };
  hooks.get = () => row("target", wording, { scope: { ...scope, owner: "different-owner" } });
  assert.deepEqual(await service.forget(input, "target", inputSource), { status: "not_found" });
  assert.equal(clone.mock.callCount(), 1);
  assert.deepEqual(mutations, []);
});

test("foreign adapter throws cross the forget entry only as sanitized CoreError values", async () => {
  const { service, hooks, committed } = lineageSetup();
  const before = committed(scope.owner);
  for (const port of ["keys.userKey", "forgetLog.record"]) {
    hooks.fault = method => { if (method === port) throw new Error("private adapter details"); };
    await assert.rejects(() => service.forget(scope, "target", source), code("internal_error"));
    assert.deepEqual(committed(scope.owner), before);
  }
});

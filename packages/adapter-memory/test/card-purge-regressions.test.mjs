import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { coreDigest, legacyExactMac, userFingerprintKey } from "@cairn-ink/core";
import { buildDocumentCard, documentCardVisible } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { predecessorFact } from "../../core/src/service/writes.mjs";

const scope = { owner: "test-owner", namespace: null };
const source = { kind: "mcp", client: null, sessionId: null };
const selection = { owner: scope.owner, namespaces: [scope.namespace] };
const sha256Hex = text => createHash("sha256").update(text).digest("hex");
const message = (id, content) => ({ id, role: "user", content, occurredAtMs: 1 });
const session = { client: "fixture", sessionId: "erase" };
const binding = (item, target = session) => ({ ...target, messageId: item.id });
const captureKey = (item, target = session) => ({ ...target, scope, eventId: item.id, payloadDigest: sha256Hex(item.content) });
const cardRef = ({ id }) => ({ type: "card", id, namespace: scope.namespace });
const authored = (id, body, sentences = []) => ({
  id, scope, origin: "manual", title: "Filed notes", body, contentHash: "sha256:" + sha256Hex(body),
  date: null, sourceMessage: null, sourceMemories: [], sentences, stale: [],
});

function fixture(wrapRaw = raw => raw, { fingerprintKey = false, spanLineage } = {}) {
  const adapter = createMemoryAdapter({ capabilities: { rawArchive: true, documentCards: true, fingerprintKey } });
  const { raw, documentCards: cards, uow, capture, fence, keys, memories, suppressions } = adapter;
  return {
    raw, cards, capture, fence, keys, memories, suppressions,
    write: work => uow.run(scope.owner, { pauseLock: true }, work),
    read: work => uow.run(scope.owner, { readOnly: true }, work),
    async snapshot() { return (await adapter.harness.dump())[0]; },
    service: createMemoryService({
      storage: { ...adapter, raw: wrapRaw(raw),
        ...(spanLineage && { spanLineage, capabilities: { ...adapter.capabilities, spanLineage: true } }) },
      tokens: { countTokens: () => 1 },
      ...(fingerprintKey && { model: { model: "test", contextWindow: 1000, countTokens: () => 1,
        async call() { assert.fail("Unexpected model call"); } } }),
      embedder: { model: "test", dimensions: 1, async embed(texts) { return texts.map(() => Float32Array.of(1)); } },
      clock: { nowMs: () => 1, monotonicMs: () => 1, sha256Hex, async hmacHex() { assert.fail("Unexpected HMAC"); } },
      gate: { async assertOpen() {} }, config: {},
    }),
  };
}

function assertTombstoned(snapshot, card, payload = card.body) {
  const entry = snapshot.documentCards.find(group => group.namespace === scope.namespace).cards
    .find(([id]) => id === card.id)[1];
  assert.equal(entry.card, null);
  assert.equal(entry.hiddenReason, "raw_deleted");
  assert.equal(JSON.stringify(entry).includes(payload), false);
}

for (const operation of ["deleteConversation", "eraseSessions"]) {
  const remove = (raw, tx) => operation === "deleteConversation"
    ? raw.deleteConversation(tx, scope, session)
    : raw.eraseSessions(tx, scope, [session]);

  test(`${operation} tombstones a card bound only through a later sentence`, async () => {
    const { raw, cards, fence, read, write, snapshot } = fixture();
    const item = message("message", "The cedar sample is stored in the drawer.");
    const survivorSource = { ...session, sessionId: "retain" };
    const keep = authored("keep", "The other drawer stores pencils.", [{ start: 0, end: 3, source: binding(item, survivorSource) }]);
    const card = authored("sentence-only", item.content, [
      { start: 0, end: 3, source: binding(item, survivorSource) },
      { start: 4, end: item.content.length, source: binding(item) },
    ]);
    const refs = [cardRef(card), cardRef(keep)];
    await write(async tx => {
      assert.equal((await raw.archive(tx, captureKey(item), [item])).archived, 1);
      for (const candidate of [card, keep]) assert.equal((await cards.put(tx, scope, candidate)).status, "inserted");
    });
    assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, refs)), refs);
    await write(async tx => {
      assert.equal((await remove(raw, tx)).rawDeleted, 1);
      assert.equal(await cards.get(tx, scope, card.id), null);
      assert.equal((await cards.listForPurge(tx, scope)).some(({ cardId }) => cardId === card.id), false);
    });
    assertTombstoned(await snapshot(), card);
    assert.equal(await read(tx => cards.get(tx, scope, card.id)), null);
    assert.deepEqual((await read(tx => cards.list(tx, scope))).map(({ id }) => id), [keep.id]);
    assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, refs)), [cardRef(keep)]);
    assert.equal((await write(tx => cards.put(tx, scope, card))).status, "tombstoned");
  });

  test(`${operation} clears amendment text bound to a ledger-only message`, async () => {
    const { capture, raw, cards, read, write, snapshot } = fixture();
    const item = message("ledger-message", "The setting was recorded only in the ledger.");
    const card = authored("retained", "Keep the manual itself.");
    const amendment = { amendmentId: "ledger-amendment", date: "2025-01-02", sourceMessage: binding(item),
      sentence: "Discard this amended setting.", quote: "Discard this supporting quote." };
    const lateAmendment = { ...amendment, amendmentId: "late-amendment", sentence: "Discard this later amendment." };
    const key = captureKey(item);
    await write(async tx => {
      assert.equal((await capture.admit(tx, key, [item])).status, "admitted");
      assert.equal((await cards.put(tx, scope, card)).status, "inserted");
      assert.equal((await cards.amend(tx, scope, card.id, amendment)).status, "inserted");
    });
    assert.deepEqual((await snapshot()).rawRows, []);
    await write(async tx => {
      assert.equal((await remove(raw, tx)).rawDeleted, 0);
      assert.equal((await capture.load(tx, key)).messages[0].content, "");
      assert.deepEqual((await cards.get(tx, scope, card.id)).amendments, []);
      const [stored] = await cards.listForPurge(tx, scope);
      assert.deepEqual(stored.amendments, []);
    });
    await write(async tx => {
      assert.equal((await cards.amend(tx, scope, card.id, lateAmendment)).status, "inserted");
      assert.equal((await remove(raw, tx)).rawDeleted, 0);
      assert.deepEqual((await cards.get(tx, scope, card.id)).amendments, []);
    });
    const stored = await snapshot();
    assert.equal(stored.claims[0].messages[0].content, "");
    assert.equal(JSON.stringify(stored.documentCards).includes(amendment.sentence), false);
    assert.equal(JSON.stringify(stored.documentCards).includes(amendment.quote), false);
    assert.equal(JSON.stringify(stored.documentCards).includes(lateAmendment.sentence), false);
    assert.equal((await read(tx => cards.get(tx, scope, card.id))).body, card.body);
    assert.equal((await write(tx => cards.amend(tx, scope, card.id, amendment))).status, "unchanged");
  });
}

test("text forget purges a reader-rejected card within the Raw purge transaction", async () => {
  const item = message("raw-message", "The red gauge is the master reference.");
  const { card: routed } = await buildDocumentCard(item, { scope, client: session.client, canonicalSessionKey: session.sessionId });
  const card = { ...authored("forged-id", item.content), origin: "router", sourceMessage: binding(item), title: routed.title };
  const ledgerItem = message("ledger-only", item.content);
  const ledgerCard = authored("ledger-card", "The reference was added in a later note.", [
    { start: 0, end: 3, source: binding(ledgerItem) },
  ]);
  let insidePurge;
  const { raw, cards, capture, service, write, read, fence, snapshot } = fixture(raw => ({
    ...raw,
    async purgeWithheld(tx, ...args) {
      const outcome = await raw.purgeWithheld(tx, ...args);
      insidePurge = {
        outcome, rejected: await cards.get(tx, scope, card.id), ledger: await cards.get(tx, scope, ledgerCard.id),
        storedIds: (await cards.listForPurge(tx, scope)).map(({ cardId }) => cardId),
      };
      return outcome;
    },
  }));
  const memory = await service.save(scope, item.content, source, "fact");
  assert.equal(memory.status, "saved");
  await write(async tx => {
    assert.equal((await raw.archive(tx, captureKey(item), [item])).archived, 1);
    assert.equal((await capture.admit(tx, captureKey(ledgerItem), [ledgerItem])).status, "admitted");
    for (const candidate of [card, ledgerCard]) assert.equal((await cards.put(tx, scope, candidate)).status, "inserted");
  });
  assert.equal((await read(tx => cards.get(tx, scope, card.id))).body, item.content);
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, [cardRef(card)])), []);
  assert.equal((await service.forget(scope, memory.item.id, source)).status, "forgotten");
  assert.deepEqual(insidePurge, { outcome: { rawDeleted: 1, ledgerBlanked: 1 }, rejected: null, ledger: null, storedIds: [] });
  const stored = await snapshot();
  for (const candidate of [card, ledgerCard]) assertTombstoned(stored, candidate);
  assert.deepEqual(stored.rawRows, []);
  assert.equal(stored.claims[0].messages[0].content, "");
});

test("forget uses this action's facts and preserves payloads withheld by a prior correction or forget", async () => {
  const { cards, service, write, read, fence, snapshot } = fixture();
  const old = authored("predecessor-copy", "The spare lens is in the cabinet.");
  const earlier = authored("earlier-forget-copy", "The red binder belongs on the lower shelf.");
  const target = authored("current-copy", "Take the east trail to the bridge.");
  const original = await service.save(scope, old.body, source, "fact");
  const prior = await service.save(scope, earlier.body, source, "fact");
  const unrelated = await service.save(scope, target.body, source, "fact");
  assert.equal(original.status, "saved");
  assert.equal(prior.status, "saved");
  assert.equal(unrelated.status, "saved");
  assert.equal((await service.forget(scope, prior.item.id, source)).status, "forgotten");
  await write(async tx => {
    for (const card of [old, earlier, target]) assert.equal((await cards.put(tx, scope, card)).status, "inserted");
  });
  assert.equal((await service.correct(scope, original.item.id, original.item.revision,
    "The spare lens is in the desk.", source)).status, "saved");
  assert.equal((await read(tx => cards.get(tx, scope, old.id))).body, old.body);
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, [cardRef(old), cardRef(earlier), cardRef(target)])),
    [cardRef(target)]);
  assert.equal((await service.forget(scope, unrelated.item.id, source)).status, "forgotten");
  const stored = JSON.stringify((await snapshot()).documentCards);
  for (const card of [old, earlier]) {
    assert.equal((await read(tx => cards.get(tx, scope, card.id)))?.body, card.body);
    assert.ok(stored.includes(card.body));
  }
  assert.equal(await read(tx => cards.get(tx, scope, target.id)), null);
  assert.equal(stored.includes(target.body), false);
});

test("deletion retries purge sentence and amendment bindings after Raw rows are gone", async () => {
  const results = [];
  for (const operation of ["deleteConversation", "eraseSessions"]) {
    const { raw, cards, write, snapshot } = fixture();
    const item = message("raw-only", "The green folder belongs in the drawer.");
    const otherSession = { ...session, sessionId: "keep" };
    const card = authored("late-sentence", item.content, [{ start: 0, end: item.content.length, source: binding(item) }]);
    const keep = authored("other-session", "The manual belongs on the shelf.", [
      { start: 0, end: 3, source: binding(item, otherSession) },
    ]);
    const amendment = { amendmentId: "late-amendment", date: "2025-01-02", sourceMessage: binding(item),
      sentence: item.content, quote: "The green folder" };
    const remove = tx => operation === "deleteConversation"
      ? raw.deleteConversation(tx, scope, session)
      : raw.eraseSessions(tx, scope, [session]);
    await write(async tx => {
      assert.equal((await raw.archive(tx, captureKey(item), [item])).archived, 1);
      assert.equal((await remove(tx)).rawDeleted, 1);
    });
    const deleted = await snapshot();
    assert.deepEqual(deleted.rawRows, []);
    assert.deepEqual(deleted.claims ?? [], []);
    await write(async tx => {
      for (const candidate of [card, keep]) assert.equal((await cards.put(tx, scope, candidate)).status, "inserted");
      assert.equal((await cards.amend(tx, scope, keep.id, amendment)).status, "inserted");
      assert.equal((await remove(tx)).rawDeleted, 0);
    });
    const stored = await snapshot();
    const [, erased] = stored.documentCards[0].cards.find(([id]) => id === card.id);
    const [, entry] = stored.documentCards[0].cards.find(([id]) => id === keep.id);
    assert.equal(entry.card.body, keep.body, operation);
    results.push({ operation, cardBody: erased.card?.body, hiddenReason: erased.hiddenReason, amendments: entry.amendments });
  }
  assert.deepEqual(results, ["deleteConversation", "eraseSessions"].map(operation => ({
    operation, cardBody: undefined, hiddenReason: "raw_deleted",
    amendments: [["late-amendment", { hiddenReason: "raw_deleted" }]],
  })));
});

test("forget blanks a conflicting ledger copy while preserving the surviving Raw card", async () => {
  const { raw, capture, cards, fence, service, read, write, snapshot } = fixture();
  const item = message("shared-address", "The blue gauge measures the outlet.");
  const ledgerItem = message(item.id, "The spare lens is in the equipment cabinet.");
  const ledgerKey = captureKey(ledgerItem);
  const { card: routed } = await buildDocumentCard(item, { scope, client: session.client, canonicalSessionKey: session.sessionId });
  const card = { ...authored(routed.id, routed.body), origin: "router", title: routed.title, sourceMessage: binding(item) };
  const saved = await service.save(scope, ledgerItem.content, source, "fact");
  assert.equal(saved.status, "saved");
  await write(async tx => {
    assert.equal((await raw.archive(tx, captureKey(item), [item])).archived, 1);
    assert.equal((await capture.admit(tx, ledgerKey, [ledgerItem])).status, "admitted");
    assert.equal((await cards.put(tx, scope, card)).status, "inserted");
  });
  const refs = [cardRef(card)];
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, refs)), refs);
  assert.equal((await service.forget(scope, saved.item.id, source)).status, "forgotten");
  assert.equal((await read(tx => capture.load(tx, ledgerKey))).messages[0].content, "");
  assert.deepEqual((await snapshot()).rawRows.map(row => row.content), [item.content]);
  assert.equal((await read(tx => cards.get(tx, scope, card.id)))?.body, item.content);
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, refs)), refs);
});

test("definite text withholding purges a card with a stale memory link", async () => {
  const { cards, fence, keys, service, read, write, snapshot } = fixture(undefined, { fingerprintKey: true });
  const card = authored("stale-link", "The bronze compass rests in a wooden case.");
  const linked = await service.save(scope, "The blue gauge measures the outlet.", source, "fact");
  const saved = await service.save(scope, card.body, source, "fact");
  assert.equal(linked.status, "saved");
  assert.equal(saved.status, "saved");
  card.sourceMemories = [{ id: linked.item.id, revision: linked.item.revision + 1 }];
  const key = await keys.userKey(scope.owner);
  const labels = Object.freeze({ keyIdDomain: "legacy-id", shingleKeyPrefix: "legacy-shingle:", legacyExactPrefix: "legacy-exact:" });
  const legacyKey = await userFingerprintKey("fixture legacy secret", scope.owner, labels);
  const legacy = { alg: "hmac", pipeline: "hosted-v1", redactionVersion: 1,
    value: await legacyExactMac(card.body, legacyKey, labels), keyId: legacyKey.id };
  const input = { card, requestedScope: scope, memoryStates: new Map([[linked.item.id,
    { status: "visible", revision: linked.item.revision, correctedRevisions: [] }]]), fingerprintKey: key,
    textFacts: [{ ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "fixture",
      text: { digests: [await coreDigest(card.body, key), legacy] } }],
  };
  assert.deepEqual(await documentCardVisible(input), { visible: false, reason: "source_memory_not_visible" });
  assert.deepEqual(await documentCardVisible({ ...input, fingerprintKey: null }, { definiteOnly: true }),
    { visible: false, reason: "uncertain" });
  const verdict = await documentCardVisible(input, { definiteOnly: true });
  await write(async tx => {
    assert.equal((await cards.put(tx, scope, card)).status, "inserted");
  });
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, [cardRef(card)])), []);
  assert.equal((await service.forget(scope, saved.item.id, source)).status, "forgotten");
  const stored = (await snapshot()).documentCards[0].cards[0][1];
  assert.deepEqual({ verdict, reason: stored.hiddenReason, body: stored.card?.body }, {
    verdict: { visible: false, reason: "text_withheld" }, reason: "text_withheld", body: undefined,
  });
});

test("forget reuses its previously stored text fact when no spans resolve", async () => {
  const spanLineage = { async resolveSpans() { return []; } };
  const payloads = [];
  for (const actionId of [undefined, "equivalent-forget"]) {
    const { cards, memories, suppressions, service, write, snapshot } = fixture(undefined, { spanLineage });
    const card = authored("replayed-copy", "The orange marker is under the map.");
    const saved = await service.save(scope, card.body, source, "fact");
    assert.equal(saved.status, "saved");
    const written = await write(async tx => {
      const row = await memories.get(tx, scope, saved.item.id);
      assert.equal(row.text, card.body);
      const { fact, incarnation } = await predecessorFact(scope, row, null, { sha256Hex }, "forget");
      assert.equal(fact.kind, "text");
      const result = await suppressions.writeFact(tx, { ...fact, actionId: actionId ?? fact.actionId }, incarnation);
      assert.equal(result.created, true);
      assert.equal((await cards.put(tx, scope, card)).status, "inserted");
      return result;
    });
    assert.equal((await service.forget(scope, saved.item.id, source)).status, "forgotten");
    const stored = await snapshot();
    assert.deepEqual(stored.facts.map(({ factId }) => factId), [written.factId]);
    payloads.push(stored.documentCards[0].cards[0][1].card?.body);
  }
  assert.deepEqual(payloads, [undefined, undefined]);
});

test("forget preserves a sentence-bound card when a different ledger body at the same address is erased", async () => {
  const { capture, cards, fence, service, read, write, snapshot } = fixture();
  const survivor = message("ledger-address", "The blue gauge measures the outlet.");
  const erased = message(survivor.id, "The spare lens is in the equipment cabinet.");
  const survivingKey = { ...captureKey(survivor), eventId: "first-copy" };
  const erasedKey = { ...captureKey(erased), eventId: "second-copy" };
  const card = authored("surviving-ledger-card", survivor.content, [
    { start: 0, end: survivor.content.length, source: binding(survivor) },
  ]);
  const erasedCard = authored("erased-ledger-card", `Inventory. ${erased.content}`, [
    { start: "Inventory. ".length, end: "Inventory. ".length + erased.content.length, source: binding(erased) },
  ]);
  const saved = await service.save(scope, erased.content, source, "fact");
  assert.equal(saved.status, "saved");
  await write(async tx => {
    assert.equal((await capture.admit(tx, survivingKey, [survivor])).status, "admitted");
    assert.equal((await capture.admit(tx, erasedKey, [erased])).status, "admitted");
    for (const candidate of [card, erasedCard]) assert.equal((await cards.put(tx, scope, candidate)).status, "inserted");
  });
  assert.deepEqual((await snapshot()).rawRows, []);
  const refs = [cardRef(card)];
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, refs)), refs);
  assert.equal((await service.forget(scope, saved.item.id, source)).status, "forgotten");
  assert.equal((await read(tx => capture.load(tx, survivingKey))).messages[0].content, survivor.content);
  assert.equal((await read(tx => capture.load(tx, erasedKey))).messages[0].content, "");
  assert.equal((await read(tx => cards.get(tx, scope, card.id)))?.body, survivor.content);
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, refs)), refs);
  assertTombstoned(await snapshot(), erasedCard, erased.content);
});

test("forget preserves a sentence-bound card when a different ledger body at the same address is erased with a non-breaking space", async () => {
  const { capture, cards, fence, service, read, write, snapshot } = fixture();
  const survivor = message("ledger-address", "The blue gauge measures the outlet.");
  const erased = message(survivor.id, "The spare lens is in the equipment\u00a0cabinet.");
  const survivingKey = { ...captureKey(survivor), eventId: "first-copy" };
  const erasedKey = { ...captureKey(erased), eventId: "second-copy" };
  const card = authored("surviving-ledger-card", survivor.content, [
    { start: 0, end: survivor.content.length, source: binding(survivor) },
  ]);
  const erasedCard = authored("erased-ledger-card", `Inventory. ${erased.content}`, [
    { start: "Inventory. ".length, end: "Inventory. ".length + erased.content.length, source: binding(erased) },
  ]);
  const saved = await service.save(scope, erased.content, source, "fact");
  assert.equal(saved.status, "saved");
  await write(async tx => {
    assert.equal((await capture.admit(tx, survivingKey, [survivor])).status, "admitted");
    assert.equal((await capture.admit(tx, erasedKey, [erased])).status, "admitted");
    for (const candidate of [card, erasedCard]) assert.equal((await cards.put(tx, scope, candidate)).status, "inserted");
  });
  assert.deepEqual((await snapshot()).rawRows, []);
  const refs = [cardRef(card)];
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, refs)), refs);
  assert.equal((await service.forget(scope, saved.item.id, source)).status, "forgotten");
  assert.equal((await read(tx => capture.load(tx, survivingKey))).messages[0].content, survivor.content);
  assert.equal((await read(tx => capture.load(tx, erasedKey))).messages[0].content, "");
  assert.equal((await read(tx => cards.get(tx, scope, card.id)))?.body, survivor.content);
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, refs)), refs);
  assertTombstoned(await snapshot(), erasedCard, erased.content);
});

test("forget tombstones an archived router card on a definite keyed containment match", async () => {
  const { raw, cards, fence, service, read, write, snapshot } = fixture(undefined, { fingerprintKey: true });
  const passage = "The brass compass was calibrated beside the north entrance on Tuesday.";
  const item = message("longer-message", `A note for the inventory team. ${passage} The inspection is complete.`);
  const { card: routed } = await buildDocumentCard(item, { scope, client: session.client, canonicalSessionKey: session.sessionId });
  const card = { ...authored(routed.id, routed.body), origin: "router", title: routed.title, sourceMessage: binding(item) };
  const saved = await service.save(scope, passage, source, "fact");
  assert.equal(saved.status, "saved");
  await write(async tx => {
    assert.equal((await raw.archive(tx, captureKey(item), [item])).archived, 1);
    assert.equal((await cards.put(tx, scope, card)).status, "inserted");
  });
  const refs = [cardRef(card)];
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, refs)), refs);
  assert.equal((await service.forget(scope, saved.item.id, source)).status, "forgotten");
  assert.deepEqual(await read(tx => fence.assertVisible(tx, selection, refs)), []);
  const stored = await snapshot();
  assert.ok(stored.facts.some(({ fact }) => fact.kind === "text" && fact.mode === "full" &&
    fact.text.keyId && fact.text.shingles.length > 0));
  assert.deepEqual(stored.rawRows.map(row => row.content), [item.content]);
  const entry = stored.documentCards[0].cards.find(([id]) => id === card.id)[1];
  assert.equal(entry.card, null);
  assert.equal(entry.hiddenReason, "source_withheld");
  assert.equal(JSON.stringify(entry).includes(card.body), false);
});

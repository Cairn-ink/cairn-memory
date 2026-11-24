import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";

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

function fixture(wrapRaw = raw => raw) {
  const adapter = createMemoryAdapter({ capabilities: { rawArchive: true, documentCards: true } });
  const { raw, documentCards: cards, uow, capture, fence } = adapter;
  return {
    raw, cards, capture, fence,
    write: work => uow.run(scope.owner, { pauseLock: true }, work),
    read: work => uow.run(scope.owner, { readOnly: true }, work),
    async snapshot() { return (await adapter.harness.dump())[0]; },
    service: createMemoryService({
      storage: { ...adapter, raw: wrapRaw(raw) }, tokens: { countTokens: () => 1 },
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

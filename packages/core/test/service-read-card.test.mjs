import assert from "node:assert/strict";
import { test } from "node:test";
import { coreDigest } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

const notFound = { status: "not_found" };

function manual(id, fields = {}) {
  return { id, scope, title: "Cabinet inventory", body: "Spare key on the shelf.", date: 12,
    origin: "manual", sourceMessage: null, sourceMemories: [], amendments: [], ...fields };
}

function fixture(records, inputs = new Map()) {
  const { deps, storage, calls } = serviceFake();
  storage.capabilities.documentCards = true;
  const transactions = [];
  storage.documentCards = {
    async get(tx, selection, id) {
      transactions.push({ tx, selection, id });
      return records.get(id) ?? null;
    },
    async visibilityInputs(tx, selection, refs) {
      transactions.push({ tx, selection, refs });
      return refs.map(({ id }) => {
        if (inputs.has(id)) return inputs.get(id);
        return { card: records.get(id), requestedScope: selection, memoryStates: new Map(), textFacts: [] };
      });
    },
  };
  return { deps, storage, calls, transactions, service: createMemoryService(deps) };
}

test("card read projects the record and visible and historical source IDs in one read-only snapshot", async () => {
  const sourceMessage = { client: "fixture", sessionId: "private-conversation", messageId: "private-message" };
  const { card: routed } = await buildDocumentCard({ id: sourceMessage.messageId, role: "user", content: "Cabinet inventory" },
    { scope, client: sourceMessage.client, canonicalSessionKey: sourceMessage.sessionId });
  const card = manual(routed.id, {
    origin: "router", sourceMessage,
    sourceMemories: [{ id: "current", revision: 1 }, { id: "old", revision: 1 }],
    amendments: [{ sentence: "The key was moved.", sourceMessage }],
  });
  const inputs = new Map([[card.id, {
    card: { ...card, canonicalSessionKey: sourceMessage.sessionId },
    requestedScope: scope, sourceWithheld: false,
    memoryStates: new Map([["current", { status: "visible", revision: 1, correctedRevisions: [] }], ["old", { status: "historical", revision: 2, correctedRevisions: [] }]]),
  }]]);
  const { service, transactions, calls } = fixture(new Map([[card.id, card]]), inputs);
  const result = await service.readCard(scope, card.id);
  assert.deepEqual(result, { status: "found", card: {
    id: card.id, title: card.title, body: card.body, date: card.date, origin: "router",
    sourceClient: "fixture", sourceMemoryIds: ["current", "old"],
  } });
  assert.ok(!JSON.stringify(result).includes(sourceMessage.sessionId));
  assert.deepEqual(calls, [["run", scope.owner, { readOnly: true }]]);
  assert.equal(transactions.length, 2);
  assert.equal(transactions[0].tx, transactions[1].tx);
  assert.deepEqual(transactions[0].selection, scope);
  assert.deepEqual(transactions[1].selection, scope);
  assert.deepEqual(transactions[1].refs, [{ type: "card", id: card.id, namespace: scope.namespace }]);
});

test("source-less cards expose a null source client and an empty source list", async () => {
  const { id, title, body, date, origin } = manual("authored");
  const { service } = fixture(new Map([[id, manual(id)]]));
  assert.deepEqual(await service.readCard(scope, id), {
    status: "found", card: { id, title, body, date, origin, sourceClient: null, sourceMemoryIds: [] },
  });
});

test("hidden, forgotten-source, foreign, missing and tombstoned cards share not_found", async () => {
  const hidden = manual("hidden");
  const forgotten = manual("forgotten", { sourceMemories: [{ id: "link", revision: 1 }] });
  const foreign = manual("foreign", { scope: { ...scope, owner: "another-owner" } });
  const withheld = manual("withheld");
  const records = new Map([hidden, forgotten, foreign, withheld].map(card => [card.id, card]));
  records.set("tombstoned", null);
  const text = { digests: [await coreDigest(withheld.body)] };
  const inputs = new Map([
    [hidden.id, null],
    [forgotten.id, { card: forgotten, requestedScope: scope, textFacts: [],
      memoryStates: new Map([["link", { status: "forgotten" }]]) }],
    [withheld.id, { card: withheld, requestedScope: scope, memoryStates: new Map(),
      textFacts: [{ ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "test-withhold", text }] }],
    [foreign.id, { card: foreign, requestedScope: foreign.scope, textFacts: [], memoryStates: new Map() }],
  ]);
  const { service } = fixture(records, inputs);
  for (const id of [hidden.id, forgotten.id, foreign.id, withheld.id, "missing", "tombstoned"]) {
    assert.deepEqual(await service.readCard(scope, id), notFound, id);
  }
});

test("card read requires the store and its visibility input method", async () => {
  const { deps, storage, calls } = fixture(new Map());
  delete storage.documentCards.visibilityInputs;
  await assert.rejects(createMemoryService(deps).readCard(scope, "card"), { code: "capability_unavailable" });
  storage.capabilities.documentCards = false;
  delete storage.documentCards;
  await assert.rejects(createMemoryService(deps).readCard(scope, "card"), { code: "capability_unavailable" });
  assert.deepEqual(calls, []);
});

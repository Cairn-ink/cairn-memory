import assert from "node:assert/strict";
import { test } from "node:test";
import { runCase } from "@cairn-ink/conformance";
import { CONTEXT_READ_DOCUMENT_CARD_CASES } from "@cairn-ink/conformance/context-read-document-cards";
import { documentCardSearchText } from "@cairn-ink/core/routing";
import { createBM25 } from "@cairn-ink/core";
import { createMemoryAdapter } from "../src/index.mjs";

const factory = {
  name: "memory-context-document-cards",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities });
    return {
      adapter, harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
      busyNativeCodes: [], embeddingDimensions: null, sessionRefs: "plain", async close() {},
    };
  },
};

for (const candidate of CONTEXT_READ_DOCUMENT_CARD_CASES) {
  test(`${candidate.id} ${candidate.title}`, async () => {
    assert.equal(await runCase(factory, candidate), null);
  });
}

test("card generation advances on amend, link and hide, and revisions distinguish title and body edits", async () => {
  assert.throws(() => createMemoryAdapter({ capabilities: { contextRead: true, cards: true } }),
    { code: "capability_unavailable" });
  const { contextRead, documentCards, uow } = createMemoryAdapter({ capabilities: { contextRead: true, documentCards: true } });
  const scope = { owner: "owner", namespace: null };
  const readSet = { owner: scope.owner, namespaces: [null], accessGenerations: [1] };
  const selection = { types: ["card"], intent: "current" };
  const write = run => uow.run(scope.owner, {}, run);
  const read = run => uow.run(scope.owner, { readOnly: true }, run);
  const card = { id: "card", scope, origin: "manual", title: "Trail map", body: "Trail follows the river",
    contentHash: "initial", date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [] };
  const snapshot = async () => (await read(tx => contextRead.snapshotState(tx, readSet, selection.types)))[0].card;
  const evidence = async ref => (await read(tx => contextRead.evidence(tx, readSet, [ref], selection.intent)))[0]?.item;
  const lexical = async () => {
    await contextRead.prepareLexical(readSet, selection, {});
    return read(tx => contextRead.lexical(tx, readSet, selection, "trail", 1, {}));
  };

  await write(tx => documentCards.put(tx, scope, card));
  const initial = await snapshot();
  const [hit] = (await lexical()).rows;
  const old = hit.ref;
  const cardKey = { type: "card", id: old.id, namespace: scope.namespace };
  assert.equal(hit.score, createBM25([{ ref: cardKey, text: documentCardSearchText(card) }]).search("trail")[0].score);

  const amendment = { amendmentId: "change", date: "2025-06-02", sentence: "The trail moved.",
    sourceMessage: { client: "fixture", sessionId: "archive", messageId: "turn" }, quote: "The trail went west." };
  await write(tx => documentCards.amend(tx, scope, card.id, amendment));
  assert.equal(await snapshot(), initial + 1);
  assert.deepEqual((await evidence(old)).ref, { ...old, revision: old.revision + 1 });
  await write(tx => documentCards.amend(tx, scope, card.id, amendment));
  assert.equal(await snapshot(), initial + 1);

  await write(tx => documentCards.put(tx, scope, { ...card, title: "Revised trail map", contentHash: "replacement" }));
  assert.deepEqual((await evidence(old)).ref, { ...old, revision: old.revision + 2, bodyRevision: old.bodyRevision + 1 });
  await write(tx => documentCards.linkMemories(tx, scope, card.id, [{ id: "missing", revision: 1 }]));
  assert.equal(await snapshot(), initial + 3);
  assert.deepEqual((await evidence(old)).ref, { ...old, revision: old.revision + 3, bodyRevision: old.bodyRevision + 1 });
  assert.deepEqual((await lexical()).rows, []);

  await write(tx => documentCards.hide(tx, scope, card.id, "forget"));
  assert.equal(await snapshot(), initial + 4);
  assert.equal(await evidence(old), undefined);
});

test("default card packing keeps candidate rank and the item cap with Raw enabled", async () => {
  const { createMemoryService } = await import("@cairn-ink/core/service");
  const { assemblyClock, fixtureCount, formatAssembly } = await import("@cairn-ink/conformance/context-assembly");
  const storage = createMemoryAdapter({
    capabilities: { contextRead: true, documentCards: true, contextRawRead: true, rawArchive: true, inspect: true },
  });
  const scope = { owner: "owner", namespace: null };
  const source = { client: "fixture", sessionId: "archive", messageId: "turn" };
  const key = { scope, ...source, eventId: "event", payloadDigest: "a".repeat(64) };
  const write = run => storage.uow.run(scope.owner, { pauseLock: true }, run);
  const quote = "The trail goes west now.";
  await write(tx => storage.raw.archive(tx, key, [{ id: source.messageId, content: quote, occurredAtMs: 1, role: "user" }]));
  const card = { id: "card", scope, origin: "manual", title: "Trail trail trail", body: "The trail follows the river.",
    contentHash: "initial", date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [] };
  await write(tx => storage.documentCards.put(tx, scope, card));
  await write(tx => storage.documentCards.amend(tx, scope, card.id, { amendmentId: "change", date: "2025-06-02",
    sentence: quote, quote, sourceMessage: source }));
  await write(tx => storage.memories.insert(tx, scope, { text: "Trail map", textHash: "sha256:" + "a".repeat(64),
    origin: "explicit", kind: "fact", confidence: 1, source: { kind: "import", client: null, sessionId: null }, embedding: null }, [], 1));
  const service = createMemoryService({ profile: "keyless-local", storage, clock: assemblyClock(),
    contextReadFormat: formatAssembly, contextReadCounter: { count: fixtureCount } });
  const result = await service.readContext({ owner: scope.owner, namespaces: [null], accessGenerations: [1] },
    { query: "trail", types: ["memory", "card"], intent: "current", budget: { maxItems: 1 } });
  assert.equal(result.diagnostics.coverage.raw, "included");
  assert.deepEqual(result.assembly.items.map(({ ref, rank }) => [ref.id, rank]), [[card.id, 1]]);
  assert.match(result.assembly.items[0].body, /The trail goes west now\./u);
  assert.deepEqual(result.assembly.items[0].sources.map(({ excerpt }) => excerpt), [quote]);
});

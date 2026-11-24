import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { DOCUMENT_CARD_AMENDMENT_CASES, TOPICS_FOR_CARDS_CASES, runCase } from "@cairn-ink/conformance";
import { createTopicStore } from "../src/topics.mjs";

const factory = {
  name: "memory card amendments and batch topic annotations",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities });
    return {
      adapter, sessionRefs: "plain", harness: adapter.harness, nativeErrorMap: adapter.nativeErrorMap,
      busyNativeCodes: [], embeddingDimensions: null,
      async close() {},
    };
  },
};

for (const testCase of [...DOCUMENT_CARD_AMENDMENT_CASES, ...TOPICS_FOR_CARDS_CASES]) {
  test(testCase.id + " " + testCase.title, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}

test("forCards validates and snapshots the caller batch before accessing state", async () => {
  const scope = { owner: "owner", namespace: null };
  const tx = { owner: scope.owner, readOnly: true };
  const ids = ["second", "first"];
  const entries = new Map(ids.map((id) => [id, { card: { contentHash: id, sourceMemories: [], stale: [] } }]));
  const cardOutcomes = new Map(ids.map((id) => [id, { contentHash: id, memberships: new Map() }]));
  const state = { rows: new Map(), documentCards: new Map([[null, entries]]), topics: new Map([[null, { cardOutcomes }]]) };
  let reads = 0;
  const port = {
    read: (_tx, _scope, body) => body(() => {
      reads++;
      ids.reverse();
      return state;
    }),
  };
  const store = createTopicStore(port, {}, () => "unused", () => 0, () => ({}), {}, async () => true);
  const getter = Object.defineProperty(["first"], "0", {
    get() { assert.fail("The caller accessor was invoked"); },
  });
  await assert.rejects(store.forCards(tx, scope, getter), { code: "invalid_input" });
  assert.equal(reads, 0);
  assert.deepEqual(await store.forCards(tx, scope, ids), [
    { cardId: "second", topics: [] }, { cardId: "first", topics: [] },
  ]);
  assert.equal(reads, 1);
});

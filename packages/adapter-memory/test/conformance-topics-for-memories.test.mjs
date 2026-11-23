import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { TOPIC_FOR_MEMORIES_CASES, runCase } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";
import { createTopicStore } from "../src/topics.mjs";

const factory = {
  name: "memory topics for memories",
  async open({ capabilities }) {
    const adapter = createMemoryAdapter({ capabilities });
    return {
      adapter,
      sessionRefs: "plain",
      harness: adapter.harness,
      nativeErrorMap: adapter.nativeErrorMap,
      busyNativeCodes: [],
      embeddingDimensions: null,
      async close() {},
    };
  },
};

for (const testCase of TOPIC_FOR_MEMORIES_CASES) {
  test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}

test("forMemories validates caller arrays before reading state and reads a valid batch once", async () => {
  const scope = { owner: "owner", namespace: null };
  const tx = { owner: scope.owner, readOnly: true };
  const ids = ["second", "first"];
  const rows = new Map(ids.map((id) => [id, { row: { revision: 1, historical: false } }]));
  const outcomes = new Map(ids.map((id) => [id, { revision: 1, memberships: new Map() }]));
  const state = { rows: new Map([[null, rows]]), topics: new Map([[null, { outcomes }]]) };
  let reads = 0;
  const port = {
    read: (_tx, _scope, body) => body(() => {
      reads++;
      return state;
    }),
  };
  const store = createTopicStore(port, {}, () => "unused", () => 0, () => ({ hides: () => false }), {});
  const iterable = Object.defineProperty([...ids], Symbol.iterator, { value: function* () { yield ids[1]; } });
  const accessor = Object.defineProperty([...ids], "0", { get() { return ids[0]; } });
  const invalid = (error) => error instanceof CoreError && error.code === "invalid_input";
  for (const input of [iterable, accessor]) {
    await assert.rejects(store.forMemories(tx, scope, input), invalid);
    assert.equal(reads, 0);
  }

  assert.deepEqual(await store.forMemories(tx, scope, ids), ids.map((memoryId) => ({ memoryId, topics: [] })));
  assert.equal(reads, 1);
});

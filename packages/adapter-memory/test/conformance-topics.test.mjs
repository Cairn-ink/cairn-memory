import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { TOPIC_CASES, runCase } from "@cairn-ink/conformance";
import { assertAdapterCapabilities } from "@cairn-ink/core";

const factory = {
  name: "memory topics",
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

for (const testCase of TOPIC_CASES) {
  test(`${factory.name} ${testCase.id} ${testCase.title}`, async () => {
    assert.equal(await runCase(factory, testCase), null);
  });
}

test("placement port is registered only with its capability", () => {
  for (const placement of [true, false]) {
    const adapter = createMemoryAdapter({ capabilities: { placement } });
    assert.equal(Object.hasOwn(adapter, "placement"), placement);
    assert.doesNotThrow(() => assertAdapterCapabilities(adapter));
  }
});

test("member pages use placement time and UTF-8 id ties for both levels", async () => {
  const ids = ["seed", "\uE000", "😀", "newest", "child", "parent"];
  let now = 5;
  const { uow, memories, placement } = createMemoryAdapter({
    capabilities: { placement: true }, now: () => now, newId: () => ids.shift(),
  });
  const scope = { owner: "owner", namespace: null };
  const firstPage = { cursor: null, limit: 2 };
  const revisionGuards = [];
  for (let i = 0; i < 4; i++) {
    const { id, revision } = await uow.run(scope.owner, { pauseLock: true }, (tx) => memories.insert(tx, scope, {
      kind: "fact", origin: "explicit", text: `Fixture note ${i}`, textHash: "sha256:" + String(i).repeat(64),
      confidence: 1, embedding: null, source: { kind: "mcp", client: null, sessionId: null },
    }, [], 99 - i));
    revisionGuards.push({ memoryId: id, revision });
  }
  const apply = (memoryRevisions, items) => uow.run(scope.owner, {}, async (tx) => {
    const { indexRevision } = await placement.catalog(tx, scope, firstPage);
    return placement.applyPlacement(tx, scope, { indexRevision, memoryRevisions }, { items });
  });
  const { createdTopics } = await apply(revisionGuards.slice(0, 1), [{
    memoryId: "seed", parentIds: [], newL1: { title: "Child", parentL2Ids: [], newL2Title: "Parent" },
  }]);
  const { id: child } = createdTopics.find(({ level }) => level === "L1");
  now = 10;
  await apply(revisionGuards.slice(1, 3), revisionGuards.slice(1, 3).map(({ memoryId }) => ({ memoryId, parentIds: [child] })));
  now = 12;
  await apply(revisionGuards.slice(3), [{ memoryId: "newest", parentIds: [child] }]);
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    for (const { id } of createdTopics) {
      const first = await placement.members(tx, scope, id, firstPage);
      assert.ok(first.nextCursor);
      const last = await placement.members(tx, scope, id, { cursor: first.nextCursor, limit: 2 });
      assert.equal(last.nextCursor, null);
      assert.deepEqual([...first.items, ...last.items], [
        ["newest", 12000n], ["😀", 10000n], ["\uE000", 10000n], ["seed", 5000n],
      ].map(([id, placedAtUs]) => ({ kind: "memory", id, placedAtUs })));
    }
    const { items } = await placement.list(tx, scope, firstPage);
    for (const { memberCount, newestMemberIds } of items) {
      assert.equal(memberCount, 4);
      assert.deepEqual(newestMemberIds, ["newest", "😀", "\uE000"]);
    }
  });
});

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";

test("erasing a filed memory removes its placement and retires its title source before ID reuse", async () => {
  const scope = { owner: "owner", namespace: "notes" };
  const page = { cursor: null, limit: 10 };
  const ids = ["retained", "erased", "retained-topic", "erased-topic", "erased"];
  const { memories, placement, uow } = createMemoryAdapter({
    capabilities: { placement: true }, newId: () => ids.shift(),
  });
  const write = (fn) => uow.run(scope.owner, {}, fn);
  const read = (fn) => uow.run(scope.owner, { readOnly: true }, fn);
  const insert = (tx, text) => memories.insert(tx, scope, {
    text, textHash: "sha256:" + createHash("sha256").update(text).digest("hex"),
    kind: "fact", origin: "explicit", confidence: 1,
    source: { kind: "mcp", client: null, sessionId: null }, embedding: null,
  }, [], 1);
  const apply = (memoryId, parentIds, newL1) => write(async (tx) => {
    const { indexRevision } = await placement.catalog(tx, scope, page);
    return placement.applyPlacement(tx, scope, { indexRevision, memoryRevisions: [{ memoryId, revision: 1 }] }, {
      items: [{ memoryId, parentIds, ...(newL1 && { newL1 }) }],
    });
  });

  const { id: retained } = await write((tx) => insert(tx, "Retained memory"));
  const { id: erased } = await write((tx) => insert(tx, "Original memory"));
  const { createdTopics: [retainedTopic] } = await apply(retained, [], { title: "Retained title", parentL2Ids: [] });
  const { createdTopics: [erasedTopic] } = await apply(erased, [retainedTopic.id], { title: "Erased title", parentL2Ids: [] });
  await apply(retained, [retainedTopic.id, erasedTopic.id]);
  await write((tx) => placement.markFailed(tx, scope, [erased], "invalid_model_output"));

  const replacement = await write(async (tx) => {
    assert.equal(await memories.erase(tx, scope, erased), true);
    return insert(tx, "Unrelated replacement memory");
  });
  assert.equal(replacement.id, erased);
  assert.equal(replacement.revision, 1);

  await read(async (tx) => {
    const batch = await placement.forMemories(tx, scope, [erased, retained]);
    const single = await placement.forMemory(tx, scope, erased);
    const members = await placement.members(tx, scope, retainedTopic.id, page);
    const list = await placement.list(tx, scope, page);
    const catalog = await placement.catalog(tx, scope, page);
    const pending = await placement.pending(tx, scope, { limit: 5 });
    assert.deepEqual({
      batch, single, members: members.items.map(({ id }) => id),
      list: list.items.map(({ title, memberCount }) => [title, memberCount]),
      catalog: catalog.items.map(({ title }) => title), pending,
    }, {
      batch: [{ memoryId: retained, topics: [{ id: erasedTopic.id, title: null },
        { id: retainedTopic.id, title: retainedTopic.title }] }],
      single: [], members: [retained], list: [[null, 1], [retainedTopic.title, 1]],
      catalog: [null, retainedTopic.title], pending: [{ memoryId: erased, revision: 1 }],
    });
  });

  await apply(erased, [retainedTopic.id]);
  await read(async (tx) => {
    assert.deepEqual(await placement.forMemories(tx, scope, [erased]), [
      { memoryId: erased, topics: [{ id: retainedTopic.id, title: retainedTopic.title }] },
    ]);
    assert.deepEqual(await placement.forMemory(tx, scope, erased), [retainedTopic.id]);
    const members = await placement.members(tx, scope, retainedTopic.id, page);
    assert.deepEqual(new Set(members.items.map(({ id }) => id)), new Set([erased, retained]));
    const list = await placement.list(tx, scope, page);
    assert.equal(list.items.find(({ id }) => id === retainedTopic.id)?.memberCount, 2);
  });
});

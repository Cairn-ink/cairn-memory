import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";

const scope = { owner: "owner", namespace: "notes" };
const page = { cursor: null, limit: 100 };
const title = "Source-derived title";

function fixture() {
  const ids = ["retained", "source", "topic", "source"];
  const { memories, placement, uow } = createMemoryAdapter({
    capabilities: { placement: true },
    newId: () => ids.shift(),
  });
  const write = (fn) => uow.run(scope.owner, {}, fn);
  const read = (fn) => uow.run(scope.owner, { readOnly: true }, fn);
  const insert = (text) => write((tx) => memories.insert(tx, scope, {
    text, textHash: "sha256:" + createHash("sha256").update(text).digest("hex"),
    kind: "fact", origin: "explicit", confidence: 1,
    source: { kind: "mcp", client: null, sessionId: null }, embedding: null,
  }, [], 1));
  const apply = (memoryRevisions, items) => write(async (tx) => {
    const { indexRevision } = await placement.catalog(tx, scope, page);
    return placement.applyPlacement(tx, scope, { indexRevision, memoryRevisions }, { items });
  });
  return { memories, placement, write, read, insert, apply };
}

async function sharedTopic(f) {
  const { id: retainedId, revision: retainedRevision } = await f.insert("Retained memory");
  const { id: sourceId, revision: sourceRevision } = await f.insert("Original title source");
  const memoryRevisions = [
    { memoryId: retainedId, revision: retainedRevision },
    { memoryId: sourceId, revision: sourceRevision },
  ];
  const { createdTopics: [topic] } = await f.apply(memoryRevisions, memoryRevisions.map(({ memoryId }) => ({
    memoryId, parentIds: [], newL1: { title, parentL2Ids: [] },
  })));
  return { retainedId, sourceId, sourceRevision, topicId: topic.id };
}

async function assertTitle(f, retainedId, topicId, expectedTitle) {
  await f.read(async (tx) => {
    const batch = await f.placement.forMemories(tx, scope, [retainedId]);
    const list = await f.placement.list(tx, scope, page);
    const catalog = await f.placement.catalog(tx, scope, page);
    const project = ({ id, title }) => ({ id, title });
    const expected = [{ id: topicId, title: expectedTitle }];
    assert.deepEqual({
      forMemories: batch,
      list: list.items.map(project),
      catalog: catalog.items.map(project),
    }, {
      forMemories: [{ memoryId: retainedId, topics: expected }],
      list: expected,
      catalog: expected,
    });
  });
}

test("reusing an erased title source ID leaves the topic title null", async () => {
  const f = fixture();
  const { retainedId, sourceId, sourceRevision, topicId } = await sharedTopic(f);
  await assertTitle(f, retainedId, topicId, title);
  assert.equal(await f.write((tx) => f.memories.erase(tx, scope, sourceId)), true);
  await assertTitle(f, retainedId, topicId, null);

  const { id, revision } = await f.insert("Unrelated replacement memory");
  assert.deepEqual({ id, revision }, { id: sourceId, revision: sourceRevision });
  assert.equal(revision, 1);
  await assertTitle(f, retainedId, topicId, null);
});

test("dropping an unfiled source retires its title even without memberships to remove", async () => {
  const f = fixture();
  const { retainedId, sourceId, sourceRevision, topicId } = await sharedTopic(f);
  await f.apply([{ memoryId: sourceId, revision: sourceRevision }], [{ memoryId: sourceId, parentIds: [] }]);
  await assertTitle(f, retainedId, topicId, title);
  assert.deepEqual(await f.write((tx) => f.placement.dropMemory(tx, scope, sourceId)), { dropped: 0 });
  await assertTitle(f, retainedId, topicId, null);
});

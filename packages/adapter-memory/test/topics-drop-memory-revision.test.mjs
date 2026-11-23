import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";

test("a title-only drop advances the index and invalidates topic cursors", async () => {
  const scope = { owner: "owner", namespace: "notes" };
  const page = { cursor: null, limit: 1 };
  const { memories, placement, uow } = createMemoryAdapter({ capabilities: { placement: true } });
  const write = (fn) => uow.run(scope.owner, {}, fn);
  const read = (fn) => uow.run(scope.owner, { readOnly: true }, fn);
  const insert = (text) => write(async (tx) => {
    const { id, revision } = await memories.insert(tx, scope, {
      text, textHash: "sha256:" + createHash("sha256").update(text).digest("hex"),
      kind: "fact", origin: "explicit", confidence: 1,
      source: { kind: "mcp", client: null, sessionId: null }, embedding: null,
    }, [], 1);
    return { memoryId: id, revision };
  });
  const apply = (memoryRevisions, items) => write(async (tx) => {
    const { indexRevision } = await placement.catalog(tx, scope, page);
    return placement.applyPlacement(tx, scope, { indexRevision, memoryRevisions }, { items });
  });
  const catalog = (query = page) => read((tx) => placement.catalog(tx, scope, query));
  const list = (query = page) => read((tx) => placement.list(tx, scope, query));
  const drop = ({ memoryId }) => write((tx) => placement.dropMemory(tx, scope, memoryId));

  const alpha = await insert("Alpha member");
  const zulu = await insert("Zulu member");
  const source = await insert("Second Zulu title source");
  const item = ({ memoryId }, title) => ({ memoryId, parentIds: [], newL1: { title, parentL2Ids: [] } });
  const { createdTopics: [alphaTopic] } = await apply([alpha], [item(alpha, "Alpha")]);
  const { createdTopics: [zuluTopic] } = await apply([zulu, source], [
    item(zulu, "Zulu"), { memoryId: source.memoryId, parentIds: [] },
  ]);

  const beforeCatalog = await catalog();
  const beforeList = await list();
  const titleRow = ({ id, level, title }) => ({ id, level, title });
  const expectedAlpha = { id: alphaTopic.id, level: "L1", title: "Alpha" };
  const expectedZulu = { id: zuluTopic.id, level: "L1", title: "Zulu" };
  for (const [query, before] of [[catalog, beforeCatalog], [list, beforeList]]) {
    assert.deepEqual(before.items.map(titleRow), [expectedAlpha]);
    assert.ok(before.nextCursor);
    const second = await query({ ...page, cursor: before.nextCursor });
    assert.deepEqual(second.items.map(titleRow), [expectedZulu]);
  }

  assert.deepEqual(await drop(source), { dropped: 0 });
  const afterCatalog = await catalog({ ...page, limit: 2 });
  const afterList = await list({ ...page, limit: 2 });
  const reordered = [{ ...expectedZulu, title: null }, expectedAlpha];
  assert.deepEqual(afterCatalog.items.map(titleRow), reordered);
  assert.deepEqual(afterList.items.map(titleRow), reordered);
  assert.deepEqual(afterList.items.map(({ memberCount }) => memberCount), [1, 1]);
  await Promise.all([
    assert.rejects(() => catalog({ ...page, cursor: beforeCatalog.nextCursor }), { code: "cursor_stale" }, "catalog cursor"),
    assert.rejects(() => list({ ...page, cursor: beforeList.nextCursor }), { code: "cursor_stale" }, "list cursor"),
  ]);
  assert.equal(afterCatalog.indexRevision, beforeCatalog.indexRevision + 1);

  assert.deepEqual(await drop(source), { dropped: 0 });
  assert.equal((await catalog()).indexRevision, afterCatalog.indexRevision);
});

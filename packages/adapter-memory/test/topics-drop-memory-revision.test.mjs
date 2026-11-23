import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";

test("a title-only drop commits without advancing the index or invalidating topic cursors", async () => {
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

  const source = await insert("Original title source");
  const retained = await insert("Retained member");
  const newL1 = { title: "Child title", parentL2Ids: [], newL2Title: "Parent title" };
  const { createdTopics } = await apply([source, retained], [source, retained].map(({ memoryId }) => ({
    memoryId, parentIds: [], newL1,
  })));
  const { id: parentId } = createdTopics.find(({ level }) => level === "L2");
  await apply([source], [{ memoryId: source.memoryId, parentIds: [] }]);

  const beforeCatalog = await catalog();
  const beforeList = await list();
  assert.ok(beforeCatalog.nextCursor);
  assert.ok(beforeList.nextCursor);
  const catalogContinuation = { ...page, cursor: beforeCatalog.nextCursor };
  const listContinuation = { ...page, cursor: beforeList.nextCursor };
  assert.equal((await catalog(catalogContinuation)).items[0].title, "Parent title");
  assert.equal((await list(listContinuation)).items[0].title, "Parent title");

  assert.deepEqual(await drop(source), { dropped: 0 });
  assert.equal((await catalog()).indexRevision, beforeCatalog.indexRevision);
  const afterCatalogPage = await catalog(catalogContinuation);
  const afterListPage = await list(listContinuation);
  assert.deepEqual(afterCatalogPage.items.map(({ id, title }) => ({ id, title })), [{ id: parentId, title: null }]);
  assert.deepEqual(afterListPage.items.map(({ id, title }) => ({ id, title })), [{ id: parentId, title: null }]);

  assert.deepEqual(await drop(retained), { dropped: 1 });
  assert.equal((await catalog()).indexRevision, beforeCatalog.indexRevision + 1);
  await assert.rejects(() => catalog(catalogContinuation), { code: "cursor_stale" });
  await assert.rejects(() => list(listContinuation), { code: "cursor_stale" });
});

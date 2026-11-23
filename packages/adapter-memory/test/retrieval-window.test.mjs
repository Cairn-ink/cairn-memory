import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { withinWindow } from "../src/retrieval-window.mjs";

const scope = { owner: "owner", namespace: null };
const readSet = { owner: scope.owner, namespaces: [scope.namespace] };
const window = { sinceMs: 100, untilMs: 200 };

function fixture() {
  const { uow, memories, lexical, recent, snapshot, vector, harness } = createMemoryAdapter({
    capabilities: { semanticRetrieval: true },
  });
  return {
    async insert(text, time, client, embedding = [1, 0]) {
      const { id } = await uow.run(scope.owner, {}, tx => memories.insert(tx, scope, {
        text, textHash: `sha256:${createHash("sha256").update(text).digest("hex")}`,
        kind: "fact", origin: "explicit", confidence: 1, source: { kind: "mcp", client, sessionId: null },
        embedding: { model: "test", vector: embedding },
      }, [], time));
      return id;
    },
    async lexical(selection, depth) {
      const { rows } = await uow.run(scope.owner, { readOnly: true }, tx =>
        lexical.lexical(tx, selection, "orchard", depth, {}));
      return rows.map(({ ref }) => ref.id);
    },
    async recent(selection, limit) {
      const { items } = await uow.run(scope.owner, { readOnly: true }, tx =>
        recent.recent(tx, selection, { limit, cursor: null }));
      return items.map(({ id }) => id);
    },
    searchVector: (selection, depth) => uow.run(scope.owner, { readOnly: true }, tx =>
      vector.vector(tx, selection, Float32Array.of(1, 0), "test", depth)),
    token: selection => uow.run(scope.owner, { readOnly: true }, tx => snapshot.stateToken(tx, selection)),
    assertUnchanged: (selection, token) => uow.run(scope.owner, { readOnly: true }, tx =>
      snapshot.assertUnchanged(tx, selection, token)),
    setWriteTime: (id, time) => harness.setWriteTime(scope, id, time),
  };
}

test("memory windows use creation time and are half-open in lexical, vector, and recent", async () => {
  const store = fixture();
  await store.insert("orchard before", 99, "client");
  const start = await store.insert("orchard start", 100, "client");
  const middle = await store.insert("orchard middle", 150, "client");
  await store.insert("orchard end", 200, "client");
  await store.setWriteTime(start, 900_000n);
  const selection = { ...readSet, window };
  assert.deepEqual(new Set(await store.lexical(selection, 10)), new Set([start, middle]));
  assert.deepEqual((await store.searchVector(selection, 10)).rows.map(({ ref }) => ref.id), [start, middle]);
  assert.deepEqual(await store.recent(selection, 10), [start, middle]);
});

test("memory windows apply before the pool cut in lexical, vector, and recent", async () => {
  const store = fixture();
  const outside = await store.insert("orchard", 201, "client");
  const inside = await store.insert("orchard plus other words", 150, "client", [0, 1]);
  assert.deepEqual(await store.lexical(readSet, 1), [outside]);
  assert.deepEqual(await store.recent(readSet, 1), [outside]);
  assert.deepEqual((await store.searchVector(readSet, 1)).rows.map(({ ref }) => ref.id), [outside]);
  const selection = { ...readSet, window };
  assert.deepEqual(await store.lexical(selection, 1), [inside]);
  assert.deepEqual(await store.recent(selection, 1), [inside]);
  const result = await store.searchVector(selection, 1);
  assert.deepEqual(result.rows.map(({ ref }) => ref.id), [inside]);
  assert.deepEqual(result.coverage, { eligible: 1, embedded: 1, complete: true });
});

test("memory clients filter before the pool cut and a null client never matches", async () => {
  const store = fixture();
  const unassigned = await store.insert("orchard", 190, null);
  const different = await store.insert("orchard notes", 180, "another");
  const match = await store.insert("orchard plus other words", 150, "client", [0, 1]);
  assert.deepEqual(await store.lexical(readSet, 1), [unassigned]);
  assert.deepEqual(await store.recent(readSet, 1), [unassigned]);
  assert.deepEqual((await store.searchVector(readSet, 2)).rows.map(({ ref }) => ref.id), [unassigned, different]);
  const selection = { ...readSet, clients: ["client"] };
  assert.deepEqual(await store.lexical(selection, 1), [match]);
  assert.deepEqual(await store.recent(selection, 1), [match]);
  assert.deepEqual((await store.searchVector(selection, 1)).rows.map(({ ref }) => ref.id), [match]);
});

test("snapshot tokens bind both optional window bounds", async () => {
  const store = fixture();
  const selections = [readSet, { ...readSet, window: {} }, { ...readSet, window: { sinceMs: 100 } },
    { ...readSet, window: { untilMs: 200 } }, { ...readSet, window }];
  const tokens = await Promise.all(selections.map(store.token));
  assert.equal(new Set(tokens).size, selections.length);
  for (const [index, selection] of selections.entries()) {
    await store.assertUnchanged(selection, tokens[index]);
    await assert.rejects(store.assertUnchanged(selection, tokens[(index + 1) % tokens.length]),
      error => error instanceof CoreError && error.code === "cursor_stale");
  }
});

test("window predicate excludes a raw segment with unknown time whenever a window is present", () => {
  assert.equal(withinWindow(undefined, null), true);
  for (const selection of [{}, { sinceMs: 100 }, { untilMs: 200 }, window]) {
    assert.equal(withinWindow(selection, null), false);
  }
});

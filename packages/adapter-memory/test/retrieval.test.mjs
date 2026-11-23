import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError, capabilities } from "@cairn-ink/core";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryStore } from "../src/memory-store.mjs";
import { createRetrievalPorts } from "../src/retrieval.mjs";
import { createUnitOfWork } from "../src/unit-of-work.mjs";

const scope = { owner: "owner", namespace: null };
const readSet = { owner: scope.owner, namespaces: [null] };
const errorCode = (code) => (error) => error instanceof CoreError && error.message === code && error.code === code;
const content = {
  text: "orchard",
  textHash: "sha256:" + "a".repeat(64),
  kind: "fact",
  origin: "explicit",
  confidence: 0.4,
  source: { kind: "mcp", client: null, sessionId: null },
  embedding: { model: "embed", vector: [0, 0] },
};

test("retrieval validates runtime inputs and checks the live transaction and owner", async () => {
  const { uow, lexical, vector, snapshot, hydrate, fence, recent } =
    createMemoryAdapter({ capabilities: { semanticRetrieval: true } });
  const readers = [
    (tx, scope) => lexical.lexical(tx, scope, "", 1, {}),
    (tx, scope) => vector.vector(tx, scope, [1, 0], "embed", 1),
    (tx, scope) => snapshot.stateToken(tx, scope),
    (tx, scope) => snapshot.assertUnchanged(tx, scope, "%%%"),
    (tx, scope) => hydrate.hydrate(tx, scope, [], "recall"),
    (tx, scope) => fence.assertVisible(tx, scope, []),
    (tx, scope) => recent.recent(tx, scope, { cursor: null, limit: 1 }),
  ];
  const invalid = errorCode("invalid_input");
  const ended = await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    for (const read of readers) {
      await assert.rejects(read(tx, { ...readSet, owner: "other" }), errorCode("internal_error"));
      for (const fields of [
        { namespaces: [] }, { namespaces: [null, null] }, { namespaces: ["a", "a"] },
        { namespaces: [1] }, { namespaces: Array(1) }, { namespaces: "a" },
        { clients: null }, { clients: [1] }, { clients: Array(1) },
      ]) {
        await assert.rejects(read(tx, { ...readSet, ...fields }), invalid);
      }
    }
    for (const depth of [0, -1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "2"]) {
      await assert.rejects(lexical.lexical(tx, readSet, "", depth, {}), invalid);
      await assert.rejects(vector.vector(tx, readSet, [1, 0], "embed", depth), invalid);
      await assert.rejects(recent.recent(tx, readSet, { cursor: null, limit: depth }), invalid);
    }
    for (const query of [[], [Infinity], [NaN], ["1"], Array(1), new Float64Array([1])]) {
      await assert.rejects(vector.vector(tx, readSet, query, "embed", 1), invalid);
    }
    for (const model of ["", null, 1]) await assert.rejects(vector.vector(tx, readSet, [1], model, 1), invalid);
    for (const refs of [null, Array(1), [{}], [{ type: "memory", id: 1, namespace: null }]]) {
      await assert.rejects(hydrate.hydrate(tx, readSet, refs, "recall"), invalid);
      await assert.rejects(fence.assertVisible(tx, readSet, refs), invalid);
    }
    await assert.rejects(lexical.lexical(tx, readSet, null, 1, {}), invalid);
    await assert.rejects(hydrate.hydrate(tx, readSet, [], "other"), invalid);
    return tx;
  });
  for (const read of readers) await assert.rejects(read(ended, readSet), errorCode("internal_error"));
});

test("lexical honors depths above the core search helper limit", async () => {
  const { uow, memories, lexical } = createMemoryAdapter();
  await uow.run(scope.owner, {}, async (tx) => {
    for (let i = 0; i < 30; i++) {
      await memories.insert(tx, scope, { ...content, text: `orchard fruit${i}` }, [], 1);
    }
  });
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    const all = await lexical.lexical(tx, readSet, "orchard", 30, {});
    const capped = await lexical.lexical(tx, readSet, "orchard", 26, {});
    assert.equal(all.rows.length, 30);
    assert.deepEqual(capped.rows, all.rows.slice(0, 26));
  });
});

test("recent pages past equal times and ids in different namespaces", async () => {
  const { uow, memories, recent, vector } = createMemoryAdapter({
    capabilities: { semanticRetrieval: true },
    newId: () => "same",
  });
  const other = { ...scope, namespace: "other" };
  const both = { ...readSet, namespaces: [other.namespace, scope.namespace] };
  await uow.run(scope.owner, {}, async (tx) => {
    await memories.insert(tx, scope, content, [], 1);
    await memories.insert(tx, other, content, [], 1);
  });
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    const first = await recent.recent(tx, both, { cursor: null, limit: 1 });
    assert.ok(first.nextCursor);
    const second = await recent.recent(tx, both, { cursor: first.nextCursor, limit: 1 });
    assert.deepEqual([first.items[0].scope.namespace, second.items[0].scope.namespace], [null, "other"]);
    assert.equal(second.nextCursor, null);
    const result = await vector.vector(tx, both, [1, 0], "embed", 1);
    assert.deepEqual(result.coverage, { eligible: 2, embedded: 2, complete: true });
    assert.equal(result.rows[0].distance, 1);
  });
});

test("index revision increments once per committed writing run and per harness write", async () => {
  const { uow, port, appendFact, setWriteTime } = createUnitOfWork({});
  const { memories } = createMemoryStore(port, capabilities({}), () => "id");
  const revision = () => uow.run(scope.owner, { readOnly: true }, (tx) =>
    port(tx, scope, false, (state) => state.indexRevision));
  assert.equal(await revision(), 0);
  await uow.run(scope.owner, {}, (tx) => memories.get(tx, scope, "unknown"));
  assert.equal(await revision(), 0);
  await uow.run(scope.owner, {}, async (tx) => {
    await memories.erase(tx, scope, "unknown");
    await memories.insert(tx, scope, content, [], 1);
    await memories.touchDuplicate(tx, scope, "id", [], { confidence: content.confidence }, 1);
  });
  assert.equal(await revision(), 1);
  const rollback = new Error("rollback");
  await assert.rejects(uow.run(scope.owner, {}, async (tx) => {
    await memories.erase(tx, scope, "id");
    throw rollback;
  }), (error) => error === rollback);
  assert.equal(await revision(), 1);
  await uow.run(scope.owner, {}, (tx) => memories.erase(tx, scope, "unknown"));
  assert.equal(await revision(), 2);
  await setWriteTime(scope, "id", 1000n);
  assert.equal(await revision(), 3);
  appendFact(scope.owner, { ...scope, kind: "identity", origin: "forget", actionId: "withhold", memoryId: "id" });
  assert.equal(await revision(), 4);
});

test("historical rows remain readable and exportable but are excluded from recall", async () => {
  const { uow, port } = createUnitOfWork({});
  const flags = capabilities({ semanticRetrieval: true });
  const { memories } = createMemoryStore(port, flags, () => "id");
  const { lexical, vector, recent, hydrate, fence } = createRetrievalPorts(port, flags);
  const ref = { type: "memory", namespace: null, id: "id" };
  await uow.run(scope.owner, {}, async (tx) => {
    await memories.insert(tx, scope, content, [], 1);
    port(tx, scope, true, (state) => { state.rows.get(null).get("id").row.historical = true; });
  });
  await uow.run(scope.owner, { readOnly: true }, async (tx) => {
    assert.deepEqual(await lexical.lexical(tx, readSet, "orchard", 1, {}), { matched: false, rows: [] });
    assert.deepEqual(await vector.vector(tx, readSet, [1, 0], "embed", 1),
      { rows: [], coverage: { eligible: 0, embedded: 0, complete: true } });
    assert.deepEqual((await recent.recent(tx, readSet, { cursor: null, limit: 1 })).items, []);
    assert.deepEqual(await fence.assertVisible(tx, readSet, [ref]), []);
    assert.deepEqual(await hydrate.hydrate(tx, readSet, [ref], "recall"), []);
    for (const intent of ["read", "export"]) {
      const [{ memory }] = await hydrate.hydrate(tx, readSet, [ref], intent);
      assert.equal(memory.historical, true);
    }
    assert.equal((await memories.exportPage(tx, scope, { cursor: null, limit: 1 })).items[0].historical, true);
  });
});

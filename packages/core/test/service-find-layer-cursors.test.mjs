import assert from "node:assert/strict";
import test from "node:test";
import { serialize } from "node:v8";
import { decodeCursor, encodeCursor } from "../src/retrieval/hosted-paging.mjs";
import { createMemoryService } from "../src/service/index.mjs";
import { findFixture, kinds, options, query, scope, skipped, stripCursors, takeCursors, unavailable }
  from "./helpers/find-layer-cursor-fixture.mjs";

const fields = { memory: "memories", card: "cards", raw: "raw" };
const paging = { ...options, cursors: {} };

test("find cursor authenticates all query coordinates and isolates invalid layers", async () => {
  const { service, state } = findFixture();
  const first = await service.find(scope, query, paging);
  const cursors = takeCursors(first.layers);
  const mutations = [
    [{ ...scope, owner: "another-owner" }, query, {}],
    [{ ...scope, namespace: "another-scope" }, query, {}],
    [scope, "another query", {}],
    [scope, query, { clients: ["another-client"] }],
    [scope, query, { sinceMs: 11 }],
    [scope, query, { untilMs: 29 }],
    [scope, query, { limit: 3 }],
  ];
  for (const kind of kinds) {
    const token = cursors[kind];
    assert.equal(typeof token, "string");
    const [body, signature] = token.split(".");
    const payload = decodeCursor(body);
    assert.doesNotMatch(JSON.stringify(payload), /cedar|cabinet|query-model/u);
    for (const [target, text, override] of mutations) {
      const page = await service.find(target, text, { ...options, ...override, cursors: { [kind]: token } });
      assert.deepEqual(page.layers[kind], unavailable("invalid_cursor"), `${kind} ${JSON.stringify(override)}`);
    }
    const wrongKind = kinds.find(candidate => candidate !== kind);
    for (const malformed of ["", "!", "not-a-cursor", 42, null, body,
      encodeCursor([kind === "memory" ? encodeCursor(["forged"]) : payload[0] + 1, ...payload.slice(1)]) + "." + signature,
      body + "." + (signature.startsWith("A") ? "B" : "A") + signature.slice(1),
      token + ".extra", token + "=", body.padEnd(8193, "A") + "." + signature]) {
      const page = await service.find(scope, query, { ...options, cursors: { [kind]: malformed, [wrongKind]: cursors[wrongKind] } });
      assert.deepEqual(page.layers[kind], unavailable("invalid_cursor"));
      assert.equal(page.layers[wrongKind].status, "ok");
    }
    const swapped = await service.find(scope, query, { ...options, cursors: { [wrongKind]: token } });
    assert.deepEqual(swapped.layers[wrongKind], unavailable("invalid_cursor"));
  }
  for (const malformed of [null, [], "cursor", { unknown: "cursor" }]) {
    await assert.rejects(service.find(scope, query, { ...options, cursors: malformed }), { code: "invalid_cursor" });
  }

  const equivalent = await service.find(scope, `  ${query} \n`, { ...options, clients: ["fixture", "fixture"], cursors });
  assert.ok(kinds.every(kind => equivalent.layers[kind].status === "ok"));
  state.model = "different-model";
  const changed = await service.find(scope, query, { ...options, cursors: { memory: cursors.memory } });
  assert.deepEqual(changed.layers.memory, unavailable("invalid_cursor"));
});

test("find pages each layer independently and preserves hybrid card ranking on a card-only continuation", async () => {
  const { service, calls } = findFixture();
  const large = await service.find(scope, query, { ...options, limit: 20 });
  const first = await service.find(scope, query, paging);
  for (const kind of kinds) {
    const field = fields[kind];
    let page = first;
    const items = [...first[field]];
    for (let i = 1; i < 3; i++) {
      assert.ok(page.layers[kind].nextCursor);
      calls.length = 0;
      page = await service.find(scope, query, { ...options, kinds: ["memory"], cursors: { [kind]: page.layers[kind].nextCursor } });
      assert.equal(page.layers[kind].status, "ok");
      assert.equal(page[field].length, 2);
      for (const other of kinds.filter(value => value !== kind)) assert.deepEqual(page.layers[other], skipped);
      if (kind !== "memory") assert.equal(calls.some(([method]) => method === "lexical.lexical"), false);
      items.push(...page[field]);
    }
    assert.deepEqual(items, large[field]);
    assert.equal(page.layers[kind].nextCursor, null);
  }
  const blank = await service.find(scope, null, paging);
  assert.ok(blank.layers.memory.nextCursor);
  const recent = await service.find(scope, " \n ", { ...options, cursors: takeCursors(blank.layers) });
  assert.equal(recent.memories.length, 2);
  assert.ok(recent.memories.every(({ id }) => !blank.memories.some(row => row.id === id)));
});

test("a moved index stales its own continuation while the other two layers advance", async () => {
  for (const kind of kinds) {
    const fixture = findFixture({ semantic: false });
    const { service, state } = fixture;
    const first = await service.find(scope, query, paging);
    const cursors = takeCursors(first.layers);
    if (kind === "memory") fixture.commitForget(fixture.memories[2]);
    else state[kind]++;
    const next = await service.find(scope, query, { ...options, cursors });
    assert.deepEqual(next.layers[kind], unavailable("cursor_stale"));
    assert.deepEqual(next[fields[kind]], []);
    for (const other of kinds.filter(value => value !== kind)) {
      assert.equal(next.layers[other].status, "ok");
      assert.equal(next[fields[other]].length, 2);
    }
  }
});

test("hybrid memory pages exhaust the same bounded union as recall", async () => {
  const { service, hooks } = findFixture({ count: 110 });
  const ordinal = ({ id }) => Number(id.slice("memory-".length));
  hooks.lexicalScore = row => ordinal(row) < 55 ? 55 - ordinal(row) : undefined;
  hooks.vectorDistance = row => ordinal(row) >= 55 ? ordinal(row) / 120 : undefined;
  const recall = { mode: "search", limit: 50, cursor: null };
  const firstRecall = await service.recall(scope, query, recall);
  const lastRecall = await service.recall(scope, query, { ...recall, cursor: firstRecall.nextCursor });
  assert.equal(lastRecall.nextCursor, null);

  const options = { kinds: ["memory"], limit: 20 };
  const items = [];
  let page = await service.find(scope, query, { ...options, cursors: {} });
  for (let i = 0; i < 5; i++) {
    assert.equal(page.memories.length, 20);
    items.push(...page.memories);
    if (i < 4) {
      assert.ok(page.layers.memory.nextCursor);
      page = await service.find(scope, query, { ...options, cursors: takeCursors(page.layers) });
    }
  }
  assert.equal(page.layers.memory.nextCursor, null);
  assert.deepEqual(items, [...firstRecall.items, ...lastRecall.items]);
  assert.equal(new Set(items.map(({ id }) => id)).size, 100);
});

test("find opts into cursors only with a cursor map and preserves the first page", async () => {
  const { service, memories, cards, raw } = findFixture();
  const expected = {
    memories: memories.slice(0, 2), cards: [cards[5], cards[4]].map(({ id, title, date, body }) =>
      ({ type: "card", id, title, date, excerpt: body, truncated: false })), raw: raw.slice(0, 2),
    layers: { memory: { status: "ok", count: 2 }, card: { status: "ok", count: 2 }, raw: { status: "ok", count: 2 } },
  };
  const plain = await service.find(scope, query, options);
  assert.ok(Object.values(plain.layers).every(layer => !Object.hasOwn(layer, "nextCursor")));
  assert.deepEqual(serialize(plain), serialize(expected));
  const paged = await service.find(scope, query, paging);
  assert.ok(Object.values(paged.layers).every(layer => Object.hasOwn(layer, "nextCursor")));
  assert.deepEqual(stripCursors(paged), plain);
  const terminal = await service.find(scope, query, { ...paging, limit: 20 });
  for (const kind of kinds) assert.equal(terminal.layers[kind].nextCursor, null);
});

test("find cursors continue on a new service and recheck correction before delivery", async () => {
  const { service, deps, storage, hooks } = findFixture({ writes: true, semantic: false });
  const first = await service.find(scope, query, paging);
  const cursors = takeCursors(first.layers);
  const restarted = createMemoryService(deps);
  const second = await restarted.find(scope, query, { ...options, cursors });
  for (const kind of kinds) {
    assert.equal(second.layers[kind].status, "ok");
    assert.equal(second[fields[kind]].length, options.limit);
  }
  const [target, untouched] = second.memories;
  let ranked = false;
  const hydrate = storage.hydrate.hydrate;
  storage.hydrate.hydrate = async (tx, ...args) => {
    const rows = await hydrate(tx, ...args);
    if (tx.ranked) ranked = true;
    return rows;
  };
  let corrected;
  hooks.beforeRun = async (_owner, { readOnly }) => {
    if (!readOnly || !ranked) return;
    ranked = false;
    corrected = await service.correct(scope, target.id, target.revision, "A replacement statement.", target.source);
  };
  const page = await restarted.find(scope, query, { ...options, cursors: { memory: cursors.memory } });
  assert.equal(corrected?.status, "saved");
  assert.equal(page.layers.memory.status, "ok");
  assert.deepEqual(page.memories, [untouched]);
});

test("find rejects cursors signed under another store identity", async () => {
  const { service, identity } = findFixture();
  const cursors = takeCursors((await service.find(scope, query, paging)).layers);
  for (const store of [
    findFixture({ identity: { ...identity, storeId: "another-store" } }),
    findFixture({ identity: { ...identity, cursorKey: new Uint8Array(32) } }),
  ]) {
    const rejected = await store.service.find(scope, query, { ...options, cursors });
    for (const kind of kinds) assert.deepEqual(rejected.layers[kind], unavailable("invalid_cursor"));
  }
});

test("find keeps plain search available when the store offers no cursor identity", async () => {
  const { service } = findFixture({ identity: null });
  const plain = await service.find(scope, query, options);
  const paged = await service.find(scope, query, paging);
  for (const kind of kinds) {
    assert.deepEqual(plain.layers[kind], { status: "ok", count: options.limit });
    assert.deepEqual(paged.layers[kind], unavailable("capability_unavailable"));
    assert.deepEqual(paged[fields[kind]], []);
  }
});

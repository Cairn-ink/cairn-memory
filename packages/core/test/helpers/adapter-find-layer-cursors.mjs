import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { coreDigest } from "../../src/index.mjs";
import { serviceFake } from "./service-fake.mjs";
import { skipped, stripCursors, takeCursors, unavailable } from "./find-layer-cursor-fixture.mjs";

const query = "cedar";
const client = "fixture";
const source = { kind: "mcp", client, sessionId: null };
const kinds = ["memory", "card", "raw"];
const fields = { memory: "memories", card: "cards", raw: "raw" };
const viewOf = scope => ({ owner: scope.owner, namespaces: [scope.namespace] });
const read = (storage, scope, fn) => storage.uow.run(scope.owner, { readOnly: true }, fn);
const write = (storage, scope, fn) => storage.uow.run(scope.owner, { pauseLock: true }, fn);
const makeText = (label, i) => `Cedar ${label} specimen ${i}.`;

async function insertMemory(storage, scope, text, at, embedding) {
  return write(storage, scope, async tx => storage.memories.insert(tx, scope, {
    kind: "fact", origin: "explicit", text, textHash: "sha256:" + (await coreDigest(text)).value,
    confidence: 1, source, embedding,
  }, [], at));
}

async function archive(storage, scope, messages, slot) {
  const key = { scope, client, sessionId: `source-${slot}`, eventId: `event-${slot}`, payloadDigest: "a".repeat(64) };
  await write(storage, scope, async tx => {
    const result = await storage.raw.archive(tx, key, messages);
    assert.equal(result.archived, messages.length);
  });
}

async function insertCard(storage, scope, i, label, at) {
  const id = `card-${label}-${i}`;
  const body = makeText(label, i);
  return write(storage, scope, tx => storage.documentCards.put(tx, scope, {
    id, scope, origin: "manual", title: "Cabinet", body, date: at,
    contentHash: id, sourceMessage: null, sourceMemories: [], sentences: [], stale: [],
  }));
}

function createService(storage, createMemoryService) {
  const { deps } = serviceFake({ hasKey: false });
  return createMemoryService({ ...deps, storage, clock: {
    nowMs: Date.now,
    monotonicMs: () => performance.now(),
    sha256Hex: async value => createHash("sha256").update(value).digest("hex"),
    hmacHex: async (key, value) => createHmac("sha256", key).update(value).digest("hex"),
  } });
}

async function seed({ storage, embedding, rawNamespaces = true }, scope, label, { memory = 9, raw = 9, card = 9 } = {}) {
  const base = 1_000;
  for (let i = 0; i < memory; i++) await insertMemory(storage, scope, makeText(`memory-${label}`, i), base + i, embedding);
  if (storage.documentCardCandidates) {
    for (let i = 0; i < card; i++) await insertCard(storage, scope, i, label, base + i);
  }
  if (rawNamespaces || scope.namespace === null) {
    const messages = Array.from({ length: raw }, (_, i) => ({
      id: `message-${label}-${i}`, occurredAtMs: base + i, role: "user", content: makeText(`archive-${label}`, i),
    }));
    for (let i = 0; i < messages.length; i += 20) await archive(storage, scope, messages.slice(i, i + 20), `${label}-${i}`);
  }
}

export function testAdapterFindPaging(open, createMemoryService, testOptions = {}) {
  test("find adapter paging gives three contiguous, scoped pages per available layer", testOptions, async t => {
    const fixture = await open(t);
    const { storage, scope, otherOwner, rawNamespaces = true } = fixture;
    const otherScope = { ...scope, namespace: "other-scope" };
    await seed(fixture, scope, "home");
    await seed(fixture, otherOwner, "foreign");
    await seed(fixture, otherScope, "separate");
    const service = createService(storage, createMemoryService);
    const limit = 3;
    const baseline = await service.find(scope, query, { kinds, limit: 20 });
    const activeKinds = storage.documentCardCandidates ? kinds : ["memory", "raw"];
    const options = { kinds, limit };
    const plain = await service.find(scope, query, options);
    let page = await service.find(scope, query, { ...options, cursors: {} });
    assert.deepEqual(stripCursors(page), plain);
    if (!storage.documentCardCandidates) {
      assert.deepEqual(page.layers.card, { ...skipped, code: "capability_unavailable" });
    }
    const seen = Object.fromEntries(activeKinds.map(kind => [kind, []]));
    const firstCursors = takeCursors(page.layers);
    const continued = createService(await fixture.reopen?.() ?? storage, createMemoryService);
    for (let index = 0; index < 3; index++) {
      for (const kind of activeKinds) {
        assert.equal(page.layers[kind].status, "ok", JSON.stringify(page.layers[kind]));
        assert.equal(page[fields[kind]].length, limit);
        seen[kind].push(...page[fields[kind]]);
      }
      const cursors = takeCursors(page.layers);
      if (index < 2) {
        assert.equal(Object.keys(cursors).length, activeKinds.length);
        page = await continued.find(scope, query, { ...options, cursors });
      } else assert.deepEqual(cursors, {});
    }
    for (const kind of activeKinds) {
      if (kind === "memory") assert.deepEqual(new Set(seen[kind].map(row => row.id)), new Set(baseline.memories.map(row => row.id)));
      else assert.deepEqual(seen[kind], baseline[fields[kind]]);
      assert.equal(new Set(seen[kind].map(item => item.ref?.id ?? item.id)).size, 9);
    }
    for (const target of [otherOwner, otherScope]) {
      const rejected = await continued.find(target, query, { ...options, cursors: firstCursors });
      const own = await continued.find(target, query, options);
      for (const kind of activeKinds) {
        assert.deepEqual(rejected.layers[kind], unavailable("invalid_cursor"));
        assert.deepEqual(rejected[fields[kind]], []);
        const local = own[fields[kind]];
        assert.equal(local.length, kind === "raw" && !rawNamespaces && target.namespace !== null ? 0 : limit);
        for (const item of local) assert.ok(!seen[kind].some(home => (home.ref?.id ?? home.id) === (item.ref?.id ?? item.id)));
      }
    }
  });

  test("find adapter paging stops at each existing search horizon", testOptions, async t => {
    const fixture = await open(t);
    const { storage, scope } = fixture;
    await seed(fixture, scope, "depth", { memory: 105, raw: 105, card: 55 });
    const service = createService(storage, createMemoryService);
    const options = { kinds, limit: 20 };
    const [memory, card, raw] = await read(storage, scope, async tx => [
      (await storage.lexical.lexical(tx, viewOf(scope), query, 105, {})).rows.map(({ ref }) => ref.id),
      (await storage.documentCardCandidates?.lexical(tx, viewOf(scope), query, 50, {}))?.rows.map(({ ref }) => ref.id) ?? [],
      (await storage.raw.raw(tx, viewOf(scope), query, "search", { limit: 105 })).segments.map(({ ref }) => ref.id),
    ]);
    assert.equal(memory.length, 105, "lexical recall reaches beyond the hybrid pool");
    assert.equal(raw.length, 105, "the unpaged Raw port retains its larger limit");
    const found = { memory: [], card: [], raw: [] };
    let page = await service.find(scope, query, { ...options, cursors: {} });
    for (let index = 0; ; index++) {
      assert.ok(index < 6, "the bounded data should exhaust in six pages");
      for (const kind of kinds) {
        assert.ok(page.layers[kind].status !== "unavailable", JSON.stringify(page.layers[kind]));
        assert.ok(page[fields[kind]].length <= options.limit);
        found[kind].push(...page[fields[kind]].map(item => item.ref?.id ?? item.id));
      }
      const cursors = takeCursors(page.layers);
      if (!Object.keys(cursors).length) break;
      page = await service.find(scope, query, { ...options, cursors });
    }
    assert.equal(found.memory.length, memory.length);
    assert.deepEqual(new Set(found.memory), new Set(memory));
    assert.deepEqual(found.card, card);
    assert.deepEqual(found.raw, raw.slice(0, 100));
    await assert.rejects(service.find(scope, query, { ...options, limit: 21 }), { code: "invalid_input" });
  });

  test("find adapter continuations isolate index writes and withhold forgotten rows", testOptions, async t => {
    const fixture = await open(t);
    const { storage, scope, embedding } = fixture;
    await seed(fixture, scope, "change");
    const service = createService(storage, createMemoryService);
    const continued = createService(storage, createMemoryService);
    const options = { kinds, limit: 2 };
    const paging = { ...options, cursors: {} };
    const next = async result => continued.find(scope, query, { ...options, cursors: takeCursors(result.layers) });
    const first = await service.find(scope, query, paging);
    await archive(storage, scope, [{ id: "later-message", content: "Maple late archive.", role: "user", occurredAtMs: 2_000 }], "later");
    const rawMoved = await next(first);
    assert.deepEqual(rawMoved.layers.raw, unavailable("cursor_stale"));
    assert.equal(rawMoved.layers.memory.status, "ok");

    if (storage.documentCardCandidates) {
      const cardFirst = await service.find(scope, query, paging);
      const second = await next(cardFirst);
      const target = second.cards[0].id;
      await write(storage, scope, tx => storage.documentCards.hide(tx, scope, target, "forget"));
      const cardMoved = await next(cardFirst);
      assert.deepEqual(cardMoved.layers.card, unavailable("cursor_stale"));
      assert.equal(cardMoved.layers.memory.status, "ok");
      assert.equal(cardMoved.layers.raw.status, "ok");
      assert.ok(!(await service.find(scope, query, { kinds, limit: 20 })).cards.some(item => item.id === target));
    }

    const memoryFirst = await service.find(scope, query, paging);
    const memoryTarget = (await next(memoryFirst)).memories[0];
    const forgotten = await service.forget(scope, memoryTarget.id, source);
    assert.equal(forgotten.status, "forgotten");
    const memoryMoved = await next(memoryFirst);
    assert.deepEqual(memoryMoved.layers.memory, unavailable("cursor_stale"));
    assert.equal(memoryMoved.layers.raw.status, "ok");
    assert.ok(!(await service.find(scope, query, { kinds, limit: 20 })).memories.some(item => item.id === memoryTarget.id));

    // A ranked page obtained before forget must pass the delivery fence, even
    // if its producer still reports the original pool state.
    const stalePage = await read(storage, scope, tx =>
      storage.raw.raw(tx, viewOf(scope), query, "search", { limit: 2, offset: 2 }));
    const rawTarget = stalePage.segments[0];
    const linked = await insertMemory(storage, scope, rawTarget.content, 2_100, embedding);
    const fencedStorage = { ...storage, raw: {
      ...storage.raw,
      async raw(tx, readScope, text, intent, opts) {
        return opts.offset === 2 ? stalePage : storage.raw.raw(tx, readScope, text, intent, opts);
      },
    } };
    const rawFirst = await service.find(scope, query, { kinds: ["raw"], limit: 2, cursors: {} });
    assert.equal((await service.forget(scope, linked.id, source)).status, "forgotten");
    const fencedService = createService(fencedStorage, createMemoryService);
    const rawResult = await fencedService.find(scope, query, {
      kinds: ["raw"], limit: 2, cursors: { raw: rawFirst.layers.raw.nextCursor },
    });
    assert.equal(rawResult.layers.raw.status, "ok");
    assert.deepEqual(rawResult.raw, stalePage.segments.slice(1), "forgotten Raw candidate passed the continuation fence");
  });
}

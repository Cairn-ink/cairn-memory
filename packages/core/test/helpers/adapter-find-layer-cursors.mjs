import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import test from "node:test";
import { coreDigest } from "../../src/index.mjs";
import { fuseHosted, fuseHostedLexicalOnly } from "../../src/retrieval/fusion.mjs";
import { serviceFake } from "./service-fake.mjs";
import { skipped, takeCursors, unavailable } from "./find-layer-cursor-fixture.mjs";

const query = "cedar";
const client = "fixture";
const source = { kind: "mcp", client, sessionId: null };
const kinds = ["memory", "card", "raw"];
const fields = { memory: "memories", card: "cards", raw: "raw" };
const itemId = item => item.ref?.id ?? item.id;
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

function createService(storage, createMemoryService, embedding) {
  const { deps } = serviceFake({ hasKey: false, recall: Boolean(embedding) });
  const embedQuery = embedding && { async embedQuery() {
    return { model: embedding.model, vector: Float32Array.from(embedding.vector) };
  } };
  const embedder = embedding && {
    model: embedding.model, dimensions: embedding.vector.length,
    async embed(texts) { return texts.map(() => Float32Array.from(embedding.vector)); },
  };
  return createMemoryService({
    ...deps, storage, embedder: embedder ?? null, ...(embedQuery && { embedQuery }),
    gate: { async assertOpen() {} },
    clock: {
      nowMs: Date.now,
      monotonicMs: () => performance.now(),
      sha256Hex: async value => createHash("sha256").update(value).digest("hex"),
      hmacHex: async (key, value) => createHmac("sha256", key).update(value).digest("hex"),
    },
  });
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
    const baseline = await service.find(scope, query, { kinds, limit: 20, cursors: {} });
    const activeKinds = storage.documentCardCandidates ? kinds : ["memory", "raw"];
    const options = { kinds, limit };
    let page = await service.find(scope, query, { ...options, cursors: {} });
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
      assert.deepEqual(seen[kind], baseline[fields[kind]]);
      assert.equal(new Set(seen[kind].map(itemId)).size, 9);
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
    const [memory, card, raw] = await read(storage, scope, async tx => {
      const selection = viewOf(scope);
      const words = await storage.lexical.lexical(tx, selection, query, 105, {});
      const cardWords = await storage.documentCardCandidates?.lexical(tx, selection, query, 50, {});
      const archive = await storage.raw.raw(tx, selection, query, "search", { limit: 105 });
      return [
        fuseHostedLexicalOnly(words.rows, { offset: 0, limit: 105 }).rows.map(itemId),
        cardWords?.rows.map(itemId) ?? [],
        archive.segments.map(itemId),
      ];
    });
    assert.equal(memory.length, 105, "lexical recall reaches beyond the hybrid pool");
    assert.equal(raw.length, 105, "the unpaged Raw port retains its larger limit");
    const found = { memory: [], card: [], raw: [] };
    let page = await service.find(scope, query, { ...options, cursors: {} });
    for (let index = 0; ; index++) {
      assert.ok(index < 6, "the bounded data should exhaust in six pages");
      for (const kind of kinds) {
        assert.ok(page.layers[kind].status !== "unavailable", JSON.stringify(page.layers[kind]));
        assert.ok(page[fields[kind]].length <= options.limit);
        found[kind].push(...page[fields[kind]].map(itemId));
      }
      const cursors = takeCursors(page.layers);
      if (!Object.keys(cursors).length) break;
      page = await service.find(scope, query, { ...options, cursors });
    }
    assert.deepEqual(found.memory, memory);
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

export function testAdapterFindVersions(open, createMemoryService, cases, testOptions = {}) {
  for (const kind of cases) {
    const layer = kind === "Raw witness" ? "raw" : kind;
    for (const mode of ["plain", "first page", "continuation"]) {
      test(`find drops a replaced ${kind} at delivery (${mode})`, testOptions, async t => {
        const fixture = await open(t);
        const { storage, scope, embedding, seedRaw, replaceRaw } = fixture;
        await seed(fixture, scope, "version", {
          memory: layer === "memory" ? 9 : 0,
          raw: layer === "raw" && !seedRaw ? 9 : 0,
          card: layer === "card" ? 9 : 0,
        });
        if (layer === "raw" && seedRaw) {
          for (let i = 0; i < 9; i++) await seedRaw({
            id: `message-${i}`, role: "user", content: makeText("version", i), occurredAtMs: 1_000 + i,
          });
        }
        const service = createService(storage, createMemoryService, embedding);
        const options = { kinds: [layer], limit: 2 };
        if (mode !== "plain") options.cursors = {};
        if (mode === "continuation") {
          options.cursors = takeCursors((await service.find(scope, query, options)).layers);
          assert.ok(options.cursors[layer]);
        }
        const field = fields[layer];
        const [target, untouched] = (await service.find(scope, query, options))[field];
        assert.ok(untouched);
        const id = itemId(target);
        const replacement = "Quartz replacement text.";
        async function replace() {
          if (layer === "card") {
            const { amendments, ...card } = await read(storage, scope, tx => storage.documentCards.get(tx, scope, id));
            const result = await write(storage, scope, tx => storage.documentCards.put(tx, scope, {
              ...card, body: replacement, contentHash: "replacement",
            }));
            assert.equal(result.status, "replaced");
          } else if (layer === "memory") {
            const result = await service.correct(scope, id, target.revision, replacement, source);
            assert.equal(result.status, "saved");
            assert.equal(result.item.revision, target.revision + 1);
          } else {
            await replaceRaw(target, kind === "Raw witness" ? target.content : replacement);
          }
        }
        let reads = 0;
        let replacementRun;
        const racingStorage = { ...storage, uow: { ...storage.uow, async run(owner, opts, body) {
          if (++reads === (mode === "plain" ? 2 : 3)) {
            assert.equal(opts.readOnly, true);
            replacementRun = replace();
            await replacementRun;
          }
          return storage.uow.run(owner, opts, body);
        } } };
        const racing = createService(racingStorage, createMemoryService, embedding);
        const actual = await racing.find(scope, query, options);
        assert.ok(replacementRun);
        await replacementRun;
        assert.equal(actual.layers[layer].status, "ok");
        assert.equal(actual.layers[layer].count, 1);
        assert.deepEqual(actual[field], [untouched]);
        const fresh = await service.find(scope, kind === "Raw witness" ? query : "quartz", { kinds: [layer], limit: 20 });
        assert.ok(fresh[field].some(item => itemId(item) === id));
      });
    }
  }
}

export function testMemoryFindDelivery(open, createMemoryService) {
  for (const [kind, mutation] of [
    ["card", "card hide"],
    ["raw", "Raw forget"],
    ["memory", "memory forget during Raw"],
  ]) {
    test(`find excludes a committed ${mutation} at delivery`, async t => {
      for (const mode of ["continuation", "first page", "plain"]) {
        const fixture = await open(t);
        const { storage, scope, embedding } = fixture;
        await seed(fixture, scope, "delivery");
        const service = createService(storage, createMemoryService);
        const options = { kinds: kind === "memory" ? ["memory", "raw"] : [kind], limit: 2 };
        if (mode !== "plain") options.cursors = {};
        if (mode === "continuation") options.cursors = takeCursors((await service.find(scope, query, options)).layers);
        const expected = await service.find(scope, query, options);
        const field = fields[kind];
        const [target, untouched] = expected[field];
        assert.ok(untouched);
        const id = itemId(target);
        let committed = false;
        async function commit() {
          if (committed) return;
          if (kind === "card") {
            await write(storage, scope, tx => storage.documentCards.hide(tx, scope, id, "forget"));
          } else {
            const forgotten = kind === "raw"
              ? await insertMemory(storage, scope, target.content, 2_100, embedding)
              : target;
            assert.equal((await service.forget(scope, forgotten.id, source)).status, "forgotten");
          }
          committed = true;
        }
        const racingStorage = { ...storage };
        if (kind === "card" && mode === "continuation") {
          racingStorage.documentCardCandidates = { ...storage.documentCardCandidates, async stateToken(...args) {
            const state = await storage.documentCardCandidates.stateToken(...args);
            await commit();
            return state;
          } };
        } else if (kind === "card") {
          racingStorage.documentCards = { ...storage.documentCards, async visibilityInputs(...args) {
            const inputs = await storage.documentCards.visibilityInputs(...args);
            await commit();
            return inputs;
          } };
        } else {
          racingStorage.raw = { ...storage.raw, async raw(...args) {
            const page = await storage.raw.raw(...args);
            await commit();
            return page;
          } };
        }
        const racing = createService(racingStorage, createMemoryService);
        const actual = await racing.find(scope, query, options);
        assert.ok(committed, mode);
        assert.equal(actual.layers[kind].status, "ok", mode);
        assert.equal(actual.layers[kind].count, 1, mode);
        assert.deepEqual(actual[field], [untouched], mode);
        const fresh = await service.find(scope, query, { ...options, cursors: {}, limit: 20 });
        assert.ok(!fresh[field].some(item => itemId(item) === id), mode);
      }
    });
  }
}

export function testMemoryFindTieOrder(open, createMemoryService) {
  for (const [name, kind, count] of [
    ["hybrid memory", "memory", 100],
    ["lexical memory", "memory", 110],
    ["cards", "card", 50],
    ["Raw", "raw", 100],
  ]) {
    test(`find ${name} tie order matches one large read`, async t => {
      const hybrid = name === "hybrid memory";
      const { storage, scope, embedding } = await open(t, hybrid);
      const at = 1_000;
      const text = i => makeText("tied", String(i).padStart(3, "0"));
      const selection = viewOf(scope);
      if (kind === "memory") {
        for (let i = 0; i < 110; i++) await insertMemory(storage, scope, text(i), at, embedding);
      } else if (kind === "card") {
        for (let i = 0; i < 110; i++) await insertCard(storage, scope, String(i).padStart(3, "0"), "tied", at);
      } else {
        const messages = Array.from({ length: 110 }, (_, i) => ({
          id: `message-${i}`, occurredAtMs: at, role: "user", content: text(i),
        }));
        for (let i = 0; i < messages.length; i += 20) await archive(storage, scope, messages.slice(i, i + 20), i);
      }
      const expected = await read(storage, scope, async tx => {
        if (kind === "raw") {
          const { segments } = await storage.raw.raw(tx, selection, query, "search", { limit: count });
          assert.equal(new Set(segments.map(({ score }) => score)).size, 1);
          return segments;
        }
        const index = kind === "card" ? storage.documentCardCandidates : storage.lexical;
        const { rows } = await index.lexical(tx, selection, query, hybrid ? 50 : count, {});
        assert.equal(new Set(rows.map(({ score }) => score)).size, 1, "lexical scores must tie");
        assert.equal(new Set(rows.map(({ updatedAtUs }) => updatedAtUs)).size, 1, "timestamps must tie");
        const page = { offset: 0, limit: count };
        if (!hybrid) return fuseHostedLexicalOnly(rows, page).rows;
        const vectors = await storage.vector.vector(tx, selection, Float32Array.from(embedding.vector), embedding.model, 50);
        assert.equal(vectors.coverage.complete, true);
        return fuseHosted(rows, vectors.rows, page).rows;
      });
      const service = createService(storage, createMemoryService, embedding);
      const options = { kinds: [kind], limit: 20 };
      const actual = [];
      let cursors = {};
      let pages = 0;
      do {
        assert.ok(++pages <= Math.ceil(count / options.limit), "search must stop at its horizon");
        const page = await service.find(scope, query, { ...options, cursors });
        assert.equal(page.layers[kind].status, "ok");
        actual.push(...page[fields[kind]].map(itemId));
        cursors = takeCursors(page.layers);
      } while (cursors[kind]);
      assert.equal(expected.length, count);
      assert.equal(new Set(actual).size, actual.length, "pages must not repeat items");
      assert.deepEqual(actual, expected.map(itemId));
    });
  }
}

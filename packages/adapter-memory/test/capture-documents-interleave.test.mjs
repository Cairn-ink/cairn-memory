import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { ledgerDropSelector, ledgerRowKey } from "@cairn-ink/core/ledger";
import { buildDocumentCard, documentCardSearchText, documentCardVisible } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: null };
const readScope = { owner: scope.owner, namespaces: [scope.namespace] };
const user = { kind: "web", client: null, sessionId: null };
const day = Date.UTC(2025, 0, 1);
const nextDay = day + 86_400_000;
const selection = (sessionId, eventId = sessionId) => ({ client: "client", sessionId, eventId });
const message = (id, content, occurredAtMs = day) => ({ id, role: "user", content, occurredAtMs });
const tea = "Tea cost 6 USD.";
const plan = message("plan", [
  "Remember this maintenance plan for the community workshop.",
  "The hatch opens at 8 each morning.",
  tea,
  "Inspect the fittings after opening and record the results in the log.",
  "Clean the workbench after the inspection and leave the aisle clear.",
].join("\n"));
const purchase = message("purchase", tea);
const unrelated = message("unrelated", "Bread cost 3 USD.", nextDay);
const correction = message("correction", "The hatch now opens at 10.", nextDay);
const extract = (content, index = 0) => ({ content, sourceIndices: [index], kind: "fact", confidence: 0.9 });
const quantity = (item, category, value) => ({
  item, category, value, kind: "record", measure: "spend", unit: "USD", group: "food",
  period: "none", comparator: "none",
});

// The memory adapter leaves this optional port to the host. Stage its rows on real
// adapter transactions so rollback and commit are observable independently of reads.
function withLedger(adapter) {
  let committed = new Map();
  const active = new WeakMap();
  function rows(tx, target, write = false) {
    assert.deepEqual(target, scope);
    assert.equal(tx.owner, scope.owner);
    assert.ok(active.has(tx));
    if (write) assert.equal(tx.readOnly, false);
    return active.get(tx);
  }

  return {
    ...adapter,
    capabilities: { ...adapter.capabilities, quantityLedger: true },
    uow: {
      async run(owner, options, work) {
        let staged;
        const result = await adapter.uow.run(owner, options, async tx => {
          const pending = new Map(committed);
          active.set(tx, pending);
          try {
            const value = await work(tx);
            if (!tx.readOnly) staged = pending;
            return value;
          } finally {
            active.delete(tx);
          }
        });
        if (staged) committed = staged;
        return result;
      },
    },
    quantityLedger: {
      async put(tx, target, incoming) {
        const pending = rows(tx, target, true);
        const count = pending.size;
        for (const row of incoming) pending.set(ledgerRowKey(row), structuredClone(row));
        return { inserted: pending.size - count };
      },
      async dropWhere(tx, target, selector) {
        const field = ledgerDropSelector(selector);
        const pending = rows(tx, target, true);
        const count = pending.size;
        for (const [key, row] of pending) if (row[field] === selector.id) pending.delete(key);
        return { dropped: count - pending.size };
      },
      async listForMemory(tx, target, id) {
        return [...rows(tx, target).values()].filter(row => row.memoryId === id);
      },
      async list(tx, target, { fromMs, toMs }) {
        return [...rows(tx, target).values()].filter(({ date }) => fromMs <= date && date < toMs);
      },
      async terms(tx, target) {
        return [...new Set([...rows(tx, target).values()].flatMap(row => [row.measure, row.category, row.group]))];
      },
    },
  };
}

function fixture({ rawArchive = false, ledger = false, amendments = false } = {}) {
  const base = createMemoryAdapter({ capabilities: {
    rawArchive, documentCards: true, inspect: true, contextRead: true,
  } });
  const storage = ledger ? withLedger(base) : base;
  const read = work => storage.uow.run(scope.owner, { readOnly: true }, work);
  const write = work => storage.uow.run(scope.owner, { pauseLock: true }, work);
  const trace = [];
  let script;
  let dispatches;
  let committed;
  const countTokens = () => 1;

  async function at(point) {
    trace.push(point);
    if (script?.race?.point === point) {
      assert.equal(committed, false);
      await script.race.commit();
      committed = true;
      trace.push("committed");
    }
  }

  const deps = {
    storage,
    model: {
      model: "scripted", contextWindow: 32768, countTokens,
      async call(stage, request) {
        assert.equal(stage, "extract");
        assert.equal(request.schemaName, "extract_memories");
        await at("extract");
        return script.output;
      },
      async detectChanges(request) {
        assert.ok(request.input.includes(correction.content));
        await at("detect");
        return { changes: [{ card_id: script.cardId, quote: correction.content, new_value: correction.content }] };
      },
      async verifyChange(request) {
        assert.ok(request.input.includes(plan.content));
        assert.ok(request.input.includes(correction.content));
        await at("verify");
        return { applies: true, line: correction.content };
      },
    },
    embedder: {
      model: "scripted", dimensions: 1,
      async embed(texts) {
        const cardText = documentCardSearchText({ title: plan.content.split("\n")[0], body: plan.content });
        await at(texts.includes(cardText) ? "embed-card" : "embed-memory");
        return texts.map(() => Float32Array.of(1));
      },
    },
    tokens: { countTokens },
    clock: {
      nowMs: Date.now, monotonicMs: () => performance.now(),
      sha256Hex: text => createHash("sha256").update(text).digest("hex"),
      async hmacHex() { throw new Error("Unexpected HMAC"); },
    },
    gate: {
      async assertOpen(owner, phase) {
        assert.equal(owner, scope.owner);
        if (phase === "dispatch") await at("dispatch-" + ++dispatches);
      },
    },
  };
  const service = createMemoryService({ ...deps, config: {
    documentCards: { enabled: true, amendments },
    ...(ledger && { quantityLedger: { enabled: true } }),
  } });
  const memoriesOnly = createMemoryService({ ...deps, config: {} });

  async function capture(event, messages, output, { race, cardId, seed = false } = {}) {
    const runner = seed ? memoriesOnly : service;
    script = { output, race, cardId };
    trace.length = 0;
    dispatches = 0;
    committed = false;
    assert.deepEqual(await runner.enqueueCapture(scope, { ...event, messages }), { status: "accepted" });
    const result = await runner.runCapture(scope, event);
    if (race) assert.ok(committed, "Race must commit at " + race.point);
    assert.equal(result.status, "done", JSON.stringify(result));
    assert.equal((await runner.captureStatus(scope, event.eventId, { client: event.client })).status, "done");
    script = undefined;
    return result.result;
  }

  async function storedCards() {
    const [state] = await base.harness.dump();
    return state.documentCards.flatMap(({ cards }) => cards.map(([, entry]) => entry));
  }

  async function assertSurvivor(result) {
    const memories = await read(tx => Promise.all(result.memories.map(({ id }) => storage.memories.get(tx, scope, id))));
    const survivors = memories.filter(row => row?.text === unrelated.content);
    assert.equal(survivors.length, 1);
    return survivors[0].id;
  }

  async function forget(id) {
    assert.equal((await service.forget(scope, id, user)).status, "forgotten");
    assert.equal(await read(tx => storage.memories.get(tx, scope, id)), null);
  }

  const seedRaw = async (event, turn) => assert.equal(
    (await write(tx => storage.raw.importArchive(tx, scope, event, [turn]))).archived, 1);
  const deleteRaw = async (event, count = 1) => assert.deepEqual(
    await write(tx => storage.raw.deleteConversation(tx, scope, event)), { rawDeleted: count });
  const ledgerRows = () => read(tx => storage.quantityLedger.list(tx, scope, { fromMs: day, toMs: nextDay + 1 }));

  return { storage, service, trace, capture, read, storedCards, assertSurvivor, forget, seedRaw, deleteRaw, ledgerRows };
}

const extractPair = text => ({ items: [extract(text), extract(unrelated.content, 1)] });
const purchasePair = { ...extractPair(tea), quantities: [quantity(0, "tea", 6), quantity(1, "bread", 3)] };

async function assertCardHidden(f, event) {
  const { card: expected } = await buildDocumentCard(plan, {
    scope, client: event.client, canonicalSessionKey: event.sessionId,
  });
  const ref = { type: "card", id: expected.id, namespace: scope.namespace };
  const card = await f.read(tx => f.storage.documentCards.get(tx, scope, ref.id));
  if (card) {
    const { sourceWithheld, memories } = await f.read(async tx => ({
      sourceWithheld: await f.storage.suppressions.receiptWithheld(tx, scope, {
        ...card.sourceMessage, occurredAtMs: plan.occurredAtMs, role: plan.role, excerpt: plan.content,
      }),
      memories: await f.storage.hydrate.hydrate(tx, readScope,
        card.sourceMemories.map(({ id }) => ({ type: "memory", id, namespace: scope.namespace })), "read"),
    }));
    const verdict = await documentCardVisible({
      card: { ...card, canonicalSessionKey: event.sessionId }, requestedScope: scope,
      sourceWithheld, memoryStates: new Map(memories.filter(({ memory }) => memory).map(({ memory }) =>
        [memory.id, { status: memory.historical ? "historical" : "visible", revision: memory.revision }])),
    });
    assert.equal(verdict.visible, false);
  }
  assert.deepEqual(await f.read(tx => f.storage.fence.assertVisible(tx, readScope, [ref], "read")), []);
  assert.deepEqual(await f.read(tx => f.storage.hydrate.hydrate(tx, readScope, [ref], "read")), []);
  assert.deepEqual((await f.service.find(scope, "Maintenance plan", { kinds: ["card"], limit: 10 })).cards, []);
}

test("1: Raw deletion inside the extraction send leaves no card or ledger attribution", async () => {
  const event = selection("plan");
  for (const deleting of [false, true]) {
    const f = fixture({ rawArchive: true, ledger: true });
    await f.seedRaw(event, plan);
    const result = await f.capture(event, [plan, unrelated], purchasePair, {
      race: deleting ? { point: "extract", commit: () => f.deleteRaw(event) } : undefined,
    });
    const survivor = await f.assertSurvivor(result);
    const cards = await f.storedCards();
    const ledger = await f.ledgerRows();
    if (deleting) {
      assert.deepEqual(f.trace.slice(0, 3), ["dispatch-1", "extract", "committed"]);
      assert.deepEqual(cards, []);
      assert.deepEqual(ledger.map(({ memoryId, category }) => [memoryId, category]), [[survivor, "bread"]]);
    } else {
      assert.deepEqual(cards.map(({ card }) => card.sourceMessage.messageId), [plan.id]);
      assert.deepEqual(ledger.map(({ category }) => category).sort(), ["bread", "tea"]);
    }
  }
});

for (const [label, point] of [["2a", "embed-card"], ["2b", "dispatch-3"]]) {
  test(label + ": Raw deletion during card embedding at " + point + " leaves no card", async () => {
    const f = fixture({ rawArchive: true });
    const event = selection("plan");
    await f.seedRaw(event, plan);
    const result = await f.capture(event, [plan, unrelated], extractPair(tea), {
      race: { point, commit: () => f.deleteRaw(event) },
    });
    assert.deepEqual(f.trace, ["dispatch-1", "extract", "dispatch-2", "embed-memory",
      ...(point === "embed-card" ? ["dispatch-3", "embed-card", "committed"] : ["dispatch-3", "committed", "embed-card"])]);
    await f.assertSurvivor(result);
    assert.deepEqual(await f.storedCards(), []);
  });
}

test("3: forgetting an extracted memory inside extraction withholds its source card", async () => {
  const f = fixture();
  const event = selection("plan", "replay");
  const derived = "Workshop access is scheduled before noon.";
  const first = await f.capture(selection("plan", "seed"), [plan], { items: [extract(derived)] }, { seed: true });
  assert.deepEqual(await f.storedCards(), []);
  const result = await f.capture(event, [plan, unrelated], extractPair("The workshop opens in the morning."), {
    race: { point: "extract", commit: () => f.forget(first.memories[0].id) },
  });
  assert.deepEqual(f.trace.slice(0, 3), ["dispatch-1", "extract", "committed"]);
  await f.assertSurvivor(result);
  await assertCardHidden(f, event);
  assert.deepEqual(await f.storedCards(), []);
});

test("4: a text-fact forget inside extraction withholds the document containing that sentence", async () => {
  for (const forgetting of [false, true]) {
    const f = fixture();
    const saved = await f.service.save(scope, tea, user);
    assert.equal(saved.status, "saved");
    const event = selection("plan");
    // The model omits the forgotten sentence. The card still contains it, so
    // candidate suppression alone cannot protect the write.
    const result = await f.capture(event, [plan, unrelated], { items: [extract(unrelated.content, 1)] }, {
      race: forgetting ? { point: "extract", commit: () => f.forget(saved.item.id) } : undefined,
    });
    await f.assertSurvivor(result);
    const stored = await f.storedCards();
    if (forgetting) {
      assert.deepEqual(f.trace.slice(0, 3), ["dispatch-1", "extract", "committed"]);
      assert.ok(!stored.some(({ card }) => card?.body.includes(tea)), "Stored a card containing the forgotten sentence");
      await assertCardHidden(f, event);
    } else {
      assert.equal(stored[0]?.card.body, plan.content);
    }
  }
});

for (const [label, point, deletion] of [
  ["5a", "verify", false], ["5b", "dispatch-4", false], ["6", "verify", true],
]) {
  test(label + ": " + (deletion ? "Raw correction deletion" : "bound-memory forget") + " at " + point +
    " leaves no amendment", async () => {
    for (const racing of [false, true]) {
      const f = fixture({ rawArchive: deletion, amendments: true });
      const first = await f.capture(selection("plan"), [plan], { items: [extract(tea)] });
      const [{ card }] = await f.storedCards();
      const memoryId = first.memories[0].id;
      assert.deepEqual(card.sourceMemories, [{ id: memoryId, revision: 1 }]);
      const event = selection("correction");
      const result = await f.capture(event, [correction, unrelated], { items: [extract(unrelated.content, 1)] }, {
        cardId: card.id,
        race: racing ? { point, commit: () => deletion ? f.deleteRaw(event, 2) : f.forget(memoryId) } : undefined,
      });
      await f.assertSurvivor(result);
      assert.deepEqual(f.trace, ["dispatch-1", "extract", "dispatch-2", "embed-memory", "dispatch-3", "detect",
        ...(racing && point === "dispatch-4" ? ["dispatch-4", "committed", "verify"] : ["dispatch-4", "verify"]),
        ...(racing && point === "verify" ? ["committed"] : [])]);
      const stored = (await f.storedCards()).flatMap(({ amendments }) => amendments ?? []);
      assert.deepEqual(stored.map(([, amendment]) => amendment?.sourceMessage.messageId), racing ? [] : [correction.id]);
    }
  });
}

test("7: a ledger-source forget inside extraction drops the old row and prevents a new attribution", async () => {
  for (const forgetting of [false, true]) {
    const f = fixture({ ledger: true });
    const first = await f.capture(selection("purchase", "seed"), [purchase], {
      items: [extract("The tea purchase came to six dollars.")], quantities: [quantity(0, "tea", 6)],
    });
    const memoryId = first.memories[0].id;
    assert.deepEqual((await f.ledgerRows()).map(row => row.memoryId), [memoryId]);
    const event = selection("purchase", "replay");
    const result = await f.capture(event, [purchase, unrelated], {
      ...purchasePair, items: extractPair("The tea purchase was six dollars.").items,
    }, {
      race: forgetting ? { point: "extract", async commit() {
        await f.forget(memoryId);
        assert.deepEqual(await f.ledgerRows(), []);
      } } : undefined,
    });
    const survivor = await f.assertSurvivor(result);
    const rows = await f.ledgerRows();
    if (forgetting) {
      assert.deepEqual(f.trace.slice(0, 3), ["dispatch-1", "extract", "committed"]);
      assert.deepEqual(rows.map(({ memoryId, category }) => [memoryId, category]), [[survivor, "bread"]]);
    } else {
      assert.deepEqual(rows.map(({ category }) => category).sort(), ["bread", "tea", "tea"]);
    }
  }
});

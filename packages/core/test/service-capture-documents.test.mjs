import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { CoreError, coreDigest } from "@cairn-ink/core";
import { documentCardSearchText } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { plainExtractionSpec } from "../src/extraction/extraction.mjs";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

const selection = { client: "client", sessionId: "session", eventId: "event" };
const message = (id, content, occurredAtMs = 1234) => ({ id, role: "user", content, occurredAtMs });
const document = (id, lead, time) => message(id,
  lead + " " + "The hatch opens at 8 each morning. ".repeat(7).trimEnd(), time);
const note = document("note", "Remember this maintenance plan.");
const item = (content = "The hatch opens at 8 each morning.", sourceIndices = [0], confidence = 0.9) =>
  ({ content, kind: "fact", confidence, sourceIndices });
const amount = (item = 0, value = 8) => ({
  item, kind: "record", measure: "schedule", category: "hatch", value,
  unit: "hour", group: "work", period: "none", comparator: "none",
});
const enabled = { documentCards: { enabled: true, amendments: true }, quantityLedger: { enabled: true } };
const bytes = value => Buffer.from(JSON.stringify(value));
const digest = value => createHash("sha256").update(bytes(value)).digest("hex");

function setup({ config = enabled, supported = true, rawArchive = false, model = true, embedder = true } = {}) {
  const fake = serviceFake({ writes: true, capture: true, rawArchive, hasKey: false });
  const { deps, hooks, storage } = fake;
  const puts = [], amendments = [], ledgerRows = [], diagnostics = [];
  const cards = new Map();
  const active = new Set();
  const { run } = storage.uow;
  const finishTx = new Set();
  storage.uow.run = (owner, options, work) => run(owner, options, async tx => {
    active.add(tx);
    try { return await work(tx); }
    finally { active.delete(tx); }
  });
  const originalFinish = storage.capture.finish;
  storage.capture.finish = async (tx, token, items) => {
    const result = await originalFinish(tx, token, items);
    finishTx.add(tx);
    const accepted = items.filter((_, position) => !result.suppressedItems?.includes(position));
    tx.writtenReceipts = new Map(result.memories.map(({ id }, position) => [id, accepted[position].receipts]));
    return result;
  };
  const hydrate = storage.hydrate.hydrate;
  storage.hydrate.hydrate = (tx, target, refs, intent) => {
    if (tx.options.readOnly) return hydrate(tx, target, refs, intent);
    return refs.map(ref => ({ ref, memory: tx.rows.find(row => row.id === ref.id),
      receipts: tx.writtenReceipts?.get(ref.id)?.map(receipt => ({ ...receipt, id: "canonical-" + receipt.messageId })),
    }));
  };
  if (supported) {
    Object.assign(storage.capabilities, { documentCards: true, quantityLedger: true });
    storage.documentCards = {
      async put(tx, target, card, vector) {
        assert.ok(active.has(tx) && finishTx.has(tx));
        assert.deepEqual(target, scope);
        if (rawArchive) assert.ok(tx.archived.some(message => message.id === card.sourceMessage.messageId));
        puts.push({ card, vector });
        cards.set(card.id, { ...card, amendments: [] });
        return { status: "inserted" };
      },
      async list(tx) {
        assert.ok(active.has(tx) && tx.options.readOnly);
        return [...cards.values()];
      },
      async get(tx, _scope, id) { return cards.get(id) ?? null; },
      async visibilityInputs(tx, requestedScope, refs, { newCard } = {}) {
        return refs.map(({ id, type, namespace }) => {
          if (type !== "card" || namespace !== requestedScope.namespace) return null;
          const card = cards.get(id);
          if (!card) return newCard?.card.id === id ? newCard : null;
          const memoryStates = new Map(tx.rows.map(({ id, revision }) =>
            [id, { status: "visible", revision, correctedRevisions: [] }]));
          return { card: { ...card, canonicalSessionKey: card.sourceMessage.sessionId },
            requestedScope, memoryStates, sourceWithheld: false };
        });
      },
      async amend(tx, _scope, id, amendment) {
        assert.ok(active.has(tx) && tx.options.pauseLock && !finishTx.has(tx));
        amendments.push(amendment);
        cards.get(id).amendments.push(amendment);
        return { status: "inserted" };
      },
    };
    storage.quantityLedger = {
      async listForMemory(tx, _scope, id) {
        assert.ok(active.has(tx) && finishTx.has(tx));
        return ledgerRows.filter(row => row.memoryId === id);
      },
      async put(tx, _scope, rows) {
        assert.ok(active.has(tx) && finishTx.has(tx));
        ledgerRows.push(...rows);
        return { inserted: rows.length };
      },
    };
  }
  deps.config = config;
  deps.diagnostics = diagnostic => diagnostics.push(diagnostic);
  hooks.model = (_stage, request) => ({
    items: [item()], ...(request.schema.properties.quantities && { quantities: [amount()] }),
  });
  const amendmentQuote = "The hatch now opens at 10.";
  const sends = [];
  deps.model.detectChanges = async () => {
    assert.equal(active.size, 0);
    sends.push("detect");
    return hooks.detect?.() ?? {
      changes: [{ card_id: [...cards.keys()][0], quote: amendmentQuote, new_value: amendmentQuote }],
    };
  };
  deps.model.verifyChange = async () => {
    assert.equal(active.size, 0);
    sends.push("verify");
    return hooks.verify?.() ?? { applies: true, line: amendmentQuote };
  };
  if (!model) deps.model = null;
  if (!embedder) deps.embedder = null;
  const service = createMemoryService(deps);
  async function admit(messages = [note], event = selection) {
    assert.deepEqual(await service.enqueueCapture(scope, { ...event, messages }), { status: "accepted" });
  }
  return { ...fake, service, puts, amendments, ledgerRows, diagnostics, sends, cards, admit,
    run: (event = selection) => service.runCapture(scope, event),
    amendmentMessage: message("update", amendmentQuote, 86_400_000 + note.occurredAtMs),
  };
}

test("absent, disabled, and unsupported options preserve the plain request and finish writes byte for byte", async () => {
  const { system, input, schema } = plainExtractionSpec([note]);
  const priorRequest = { system, input, schema, schemaName: "extract_memories", maxOutputTokens: 7167 };
  for (const options of [
    { config: {} },
    { config: { documentCards: { enabled: false, amendments: true }, quantityLedger: { enabled: false } } },
    { supported: false },
  ]) {
    const f = setup(options);
    await f.admit();
    f.mutations.length = 0;
    assert.equal((await f.run()).status, "done");
    const request = f.calls.find(([method]) => method === "model.call")[2];
    assert.deepEqual(bytes(request), bytes(priorRequest));
    assert.equal(digest(request), "cecb3c238ea2783a7c1d6704eac85f676d3e5bcc35f01e10732a9b2a8ea8038d");
    assert.equal(digest(f.mutations), "ba1f933f3a0ee9425c4e3e318cc566ff94ef6d77b8d2a5b9e90a46a1f23797a5");
    assert.deepEqual([f.puts, f.ledgerRows, f.sends], [[], [], []]);
  }
});

test("finish writes cards, exact search vectors and valid quantities in the memory transaction", async () => {
  const f = setup();
  f.hooks.model = (_stage, request) => {
    assert.ok(request.schema.properties.quantities);
    return { items: [item("Rejected low confidence.", [0], 0.2), item()],
      quantities: [amount(0, 9), amount(1), { item: 1 }] };
  };
  await f.admit();
  const done = await f.run();
  assert.equal(done.status, "done");
  const [{ card, vector }] = f.puts;
  assert.equal(card.origin, "router");
  assert.deepEqual(card.sourceMemories, [{ id: done.result.memories[0].id, revision: 1 }]);
  assert.deepEqual(f.calls.filter(([method]) => method === "embed").at(-1)[1], [documentCardSearchText(card)]);
  assert.deepEqual(vector, { model: "embedder", vector: Float32Array.of(1) });
  assert.deepEqual(f.ledgerRows.map(({ memoryId, receiptId, value, date, textHash }) =>
    [memoryId, receiptId, value, date, textHash]), [[done.result.memories[0].id, "canonical-note", 8,
    note.occurredAtMs, f.committed(scope.owner).rows[0].textHash]]);
  assert.deepEqual(f.diagnostics.map(({ reason }) => reason), ["invalid_extraction_quantity"]);
  assert.deepEqual(await f.run(), done);
  assert.equal(f.puts.length, 1);
  assert.equal(f.ledgerRows.length, 1);
});

test("a no-model, no-embedder finish still writes a lexical card", async () => {
  const f = setup({ model: false, embedder: false });
  await f.admit();
  assert.deepEqual((await f.run()).result.memories, []);
  assert.equal(f.puts.length, 1);
  assert.deepEqual(f.puts[0].card.sourceMemories, []);
  assert.equal(f.puts[0].vector, undefined);
  const later = { ...selection, sessionId: "later", eventId: "later" };
  await f.admit([f.amendmentMessage], later);
  assert.equal((await f.run(later)).status, "done");
  assert.equal(f.calls.some(([method]) => method === "model.call" || method === "embed"), false);
  assert.deepEqual([f.ledgerRows, f.sends], [[], []]);
});

test("a successful zero-item extraction writes an unbound card", async () => {
  const f = setup();
  f.hooks.model = () => ({ items: [], quantities: [] });
  await f.admit();
  assert.equal((await f.run()).status, "done");
  assert.deepEqual(f.puts.map(({ card }) => card.sourceMemories), [[]]);
  assert.deepEqual(f.ledgerRows, []);
});

test("finish suppression removes all of the suppressed item's cited sources", async () => {
  const f = setup({ rawArchive: true });
  const other = document("other", "Remember this second checklist.");
  await f.admit([note, other]);
  f.hooks.model = () => ({ items: [item("Concealed evidence."), item("A separate memory.", [1]), item("Shared evidence.", [0, 1])],
    quantities: [amount(0), amount(1), amount(2)] });
  f.hooks.finishSuppressedItems = () => [0];
  assert.equal((await f.run()).status, "done");
  assert.deepEqual(f.puts.map(({ card }) => card.sourceMessage.messageId), [other.id]);
  assert.deepEqual(f.ledgerRows.map(({ receiptId, memoryId }) => [receiptId, memoryId]), [["canonical-other", "captured-1"]]);
});

test("a source withheld after embedding is excluded even when the extracted memory text differs", async () => {
  const f = setup({ rawArchive: true });
  const other = document("other", "Remember this second checklist.");
  await f.admit([note, other]);
  const suppression = { ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "forget",
    text: { digests: [await coreDigest(note.content, null)] } };
  f.hooks.eligible = messages => messages.map((_, position) => position);
  f.hooks.embed = texts => { if (texts.some(text => text.includes(note.content))) f.seedFact(suppression); };
  assert.equal((await f.run()).status, "done");
  assert.deepEqual(f.puts.map(({ card }) => card.sourceMessage.messageId), [other.id]);
  assert.deepEqual(f.ledgerRows, []);
});

test("receipt withholding and a late Raw fence prevent supplemental writes", async () => {
  for (const blockedBy of ["receipt", "archive"]) {
    const f = setup({ rawArchive: true });
    await f.admit();
    if (blockedBy === "receipt") f.storage.suppressions.receiptWithheld = async () => true;
    else f.hooks.finish = () => { f.hooks.archiveAllowed = () => false; };
    assert.equal((await f.run()).status, "done");
    assert.deepEqual([f.puts, f.ledgerRows, f.sends], [[], [], []], blockedBy);
  }
});

test("paused, abandoned, and failed captures write no cards, quantities or amendments", async () => {
  for (const outcome of ["paused", "abandoned", "failed"]) {
    const f = setup();
    await f.admit();
    if (outcome === "paused") {
      f.hooks.embed = async () => { await f.service.setPause(scope.owner, true); };
    } else if (outcome === "abandoned") {
      f.hooks.embed = () => { throw new CoreError("embedding_failed"); };
    } else {
      f.hooks.model = () => { throw new CoreError("extraction_failed"); };
    }
    assert.equal((await f.run()).status, outcome === "paused" ? "paused" : "failed");
    assert.equal(f.mutations.filter(({ method }) => method === "capture.abandon").length, 1, outcome);
    assert.deepEqual([f.puts, f.ledgerRows, f.sends], [[], [], []], outcome);
  }
});

test("amendments use the three gate phases for each model send and leave the finish result unchanged", async () => {
  const f = setup();
  await f.admit();
  assert.equal((await f.run()).status, "done");
  const event = { ...selection, sessionId: "later", eventId: "later" };
  await f.admit([f.amendmentMessage], event);
  f.hooks.model = () => ({ items: [] });
  f.calls.length = 0;
  const result = await f.run(event);
  assert.equal(result.status, "done");
  assert.deepEqual(f.sends, ["detect", "verify"]);
  assert.deepEqual(f.calls.filter(([method]) => method === "gate").map(([, , phase]) => phase),
    Array.from({ length: 3 }, () => ["pre-send", "dispatch", "post-send"]).flat());
  assert.deepEqual(f.amendments.map(({ sentence, quote, sourceMessage }) => [sentence, quote, sourceMessage.messageId]),
    [[f.amendmentMessage.content, f.amendmentMessage.content, f.amendmentMessage.id]]);
  assert.deepEqual(await f.run(event), result);
});

test("disabled amendments and failed or closed amendment calls preserve the committed capture result", async () => {
  for (const scenario of ["disabled", "detect", "verify", "dispatch", "post-send", "pause-generation", "denied-source"]) {
    const config = scenario === "disabled" ? { ...enabled, documentCards: { enabled: true } } : enabled;
    const f = setup({ config });
    await f.admit();
    await f.run();
    const event = { ...selection, sessionId: "later", eventId: "later" };
    await f.admit([f.amendmentMessage], event);
    f.hooks.model = () => ({ items: [] });
    if (scenario === "detect" || scenario === "verify") f.hooks[scenario] = () => { throw Error("sensitive failure"); };
    if (scenario === "dispatch" || scenario === "post-send") {
      let seen = 0;
      f.hooks.gate = phase => {
        if (phase === scenario && ++seen === 2) throw new CoreError("model_cancelled");
      };
    }
    if (scenario === "pause-generation") f.hooks.verify = async () => {
      await f.service.setPause(scope.owner, true);
      await f.service.setPause(scope.owner, false);
      return { applies: true, line: f.amendmentMessage.content };
    };
    if (scenario === "denied-source") f.hooks.verify = () => {
      f.storage.suppressions.receiptWithheld = async () => true;
      return { applies: true, line: f.amendmentMessage.content };
    };
    const done = await f.run(event);
    assert.equal(done.status, "done", scenario);
    assert.deepEqual(await f.run(event), done, scenario);
    assert.deepEqual(f.amendments, [], scenario);
    if (scenario === "disabled") assert.deepEqual(f.sends, []);
    if (["detect", "verify", "dispatch", "post-send"].includes(scenario)) {
      assert.equal(f.diagnostics.length, 1, scenario);
      assert.doesNotMatch(JSON.stringify(f.diagnostics), /sensitive|hatch|captured/u);
    }
  }
});

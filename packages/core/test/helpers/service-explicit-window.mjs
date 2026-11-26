import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { allDigests, CoreError, factIncarnationBody } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: "personal\0" };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const page = { cursor: null, limit: 20 };
const source = { kind: "mcp", client: null, sessionId: null };
const receipt = eventId => ({ client: "cairn-local-mcp", sessionId: "explicit-tool", role: "user", eventId, occurredAtMs: null });
const conversation = { client: "claude-code", sessionId: "conversation", eventId: "capture" };
const minute = 60_000;
const anchor = Date.UTC(2025, 0, 1);
const query = "inventory";
const original = "The inventory lists a cedar sample on the lower shelf.";
const replacement = "Store the birch sample in a locked cupboard.";
const unrelated = "Remember this inventory procedure. " +
  "Count the brass latches in each drawer before opening the cabinet. ".repeat(6).trimEnd();
const sha256Hex = text => createHash("sha256").update(text).digest("hex");
const sameTextTurn = { id: "original", role: "user", content: original, occurredAtMs: anchor + 10 * minute };
const windowTurn = { id: "inventory", role: "user", content: unrelated, occurredAtMs: sameTextTurn.occurredAtMs };

function fixture(t, storage, { infer = false } = {}) {
  const keyed = storage.capabilities.fingerprintKey;
  const cards = storage.capabilities.documentCards;
  const writeFact = t.mock.method(storage.suppressions, "writeFact");
  const archive = t.mock.method(storage.raw, "archive");
  let now = anchor;
  let nextItems = infer ? [{ kind: "fact", content: original, confidence: 0.9, sourceIndices: [0] }] : [];
  const model = keyed || infer ? {
    model: "fixture", contextWindow: 32_768, countTokens: () => 1,
    async call(stage) {
      assert.equal(stage, "extract");
      const items = nextItems;
      nextItems = [];
      return { items };
    },
  } : undefined;
  const service = createMemoryService({
    storage, model,
    embedder: model ? { model: "fixture", dimensions: 1, async embed(texts) {
      return texts.map(() => Float32Array.of(1));
    } } : null,
    clock: { nowMs: () => now, monotonicMs: () => performance.now(), sha256Hex,
      async hmacHex(key, text) {
        return Buffer.from(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text))).toString("hex");
      } },
    config: cards ? { documentCards: { enabled: true } } : model ? {} : { rawCapture: { enabled: true } },
    tokens: { countTokens: () => 1 }, gate: { assertOpen() {} },
    contextReadCounter: { count: text => Math.ceil(text.length / 4) }, contextReadFormat: JSON.stringify,
  });
  const read = run => storage.uow.run(scope.owner, { readOnly: true }, run);
  const write = run => storage.uow.run(scope.owner, { pauseLock: true }, run);

  return {
    service, read, cards, writeFact,
    time(value) { now = value; },
    row: id => read(tx => storage.memories.get(tx, scope, id)),
    async save(eventId = "save", inputSource = source) {
      const saved = await service.save(scope, original, inputSource, "fact", { receipt: receipt(eventId) });
      assert.equal(saved.status, eventId === "save" ? "saved" : "duplicate");
      return saved.item;
    },
    async migrated(kind) {
      const key = await storage.keys.userKey(scope.owner);
      const digests = await allDigests(original, key);
      const textHash = "sha256:" + (await allDigests(original, null))[0].value;
      const { eventId, ...fields } = receipt("legacy");
      return write(tx => storage.memories.insert(tx, scope, {
        text: original, textHash, kind: "fact", confidence: 1, origin: kind === "mcp" ? "explicit" : "inferred",
        embedding: null, source: { ...source, kind }, digests,
      }, [{ ...fields, messageId: eventId, excerpt: original }], now));
    },
    async capture(messages, expected = messages, selection = conversation) {
      assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
      const admitted = await read(tx => storage.capture.load(tx, { scope, ...selection }));
      const allowed = new Set(expected.map(({ id }) => id));
      assert.deepEqual(admitted.messages.map(({ id, content }) => [id, content]),
        messages.map(({ id, content }) => [id, allowed.has(id) ? content : ""]), "Capture admission");
      archive.mock.resetCalls();
      const outcome = await service.runCapture(scope, selection);
      assert.equal(outcome.status, "done", JSON.stringify(outcome));
      assert.deepEqual(archive.mock.calls.flatMap(call => call.arguments[2]), expected, "Raw archive writes");
      return outcome.result;
    },
    async rawList(expected) {
      const listed = await service.listRawMessages(scope, page);
      assert.equal(listed.nextCursor, null);
      assert.deepEqual(listed.items.map(({ messageId }) => messageId).sort(), expected.map(({ id }) => id).sort(), "Raw list");
      return listed.items.map(({ ref }) => ref);
    },
    async rawSearch(expected) {
      const { raw, layers } = await service.find(scope, query, { kinds: ["raw"] });
      assert.equal(layers.raw.status, "ok");
      assert.deepEqual(raw.map(({ messageId }) => messageId).sort(), expected.map(({ id }) => id).sort(), "Raw search");
    },
    async rawRefs(refs, expected) {
      const visible = await read(tx => storage.fence.assertVisible(tx, readSet, refs));
      assert.deepEqual(visible, expected, "Raw lookup by saved ref");
    },
    async contextRaw(expected) {
      if (storage.maintainContextRaw) assert.equal(await storage.maintainContextRaw(readSet), true);
      const result = await service.readContext(readSet, {
        query, types: ["memory"], intent: "current", semantic: false, deadlineMs: 5_000,
      });
      assert.equal(result.diagnostics.coverage.raw, "included", "Context Read searched Raw");
      const bodies = result.assembly.items.filter(({ layer }) => layer === "Raw").map(({ body }) => body).sort();
      assert.deepEqual(bodies, expected.map(({ content }) => content).sort(), "Context Read Raw");
    },
    async routerCard() {
      if (!cards) return null;
      const stored = await read(tx => storage.documentCards.list(tx, scope));
      const card = stored.find(({ sourceMessage }) => sourceMessage?.messageId === windowTurn.id);
      assert.equal(card?.origin, "router");
      return card.id;
    },
    async cardVisible(id, expected) {
      if (id === null) return;
      const found = await service.find(scope, query, { kinds: ["card"] });
      assert.equal(found.cards.some(card => card.id === id), expected, "Router card search");
      assert.equal((await service.readCard(scope, id)).status, expected ? "found" : "not_found", "Router card read");
    },
    async noCards() {
      if (cards) assert.deepEqual(await read(tx => storage.documentCards.list(tx, scope)), []);
    },
    assertWindows(origin, times) {
      const [{ arguments: [tx, predecessor] = [] } = {}, ...rest] = writeFact.mock.calls;
      assert.equal(predecessor?.kind, "text");
      const windows = rest.filter(call => call.arguments[1].kind === "window");
      assert.deepEqual(windows.map(call => call.arguments[1]), times.map(time => ({
        ...scope, kind: "window", actionId: predecessor.actionId, origin, client: null,
        window: { startMs: time - 30 * minute, endMs: time + 30 * minute }, anchor: "pm30min", unknownTime: true,
      })));
      for (const [index, call] of windows.entries()) {
        assert.equal(call, rest[index], "Windows immediately follow the predecessor");
        const [windowTx, fact, incarnation] = call.arguments;
        assert.equal(windowTx, tx, "Windows share the predecessor transaction");
        assert.equal(incarnation, sha256Hex(factIncarnationBody(fact)));
      }
    },
  };
}

async function change(f, row, origin) {
  if (origin === "edit") {
    const corrected = await f.service.correct(scope, row.id, row.revision, replacement, source);
    assert.equal(corrected.status, "saved");
    assert.equal(corrected.item.text, replacement);
  } else {
    assert.equal((await f.service.forget(scope, row.id, source)).status, "forgotten");
    assert.equal(await f.row(row.id), null);
  }
}

async function assertRaw(f, expected) {
  await f.rawList(expected);
  await f.rawSearch(expected);
  await f.contextRaw(expected);
}

async function storedConversation(t, f, row, origin) {
  const turns = [sameTextTurn, windowTurn];
  await f.capture(turns);
  const refs = await f.rawList(turns);
  await f.rawSearch(turns);
  await f.rawRefs(refs, refs);
  const card = await f.routerCard();
  await f.cardVisible(card, true);
  await f.contextRaw(turns);
  await change(f, row, origin);
  await t.test("Raw list withholds both stored turns", () => f.rawList([]));
  await t.test("Raw search withholds both stored turns", () => f.rawSearch([]));
  await t.test("Raw lookup withholds saved refs", () => f.rawRefs(refs, []));
  await t.test("Context Read withholds both stored turns", () => f.contextRaw([]));
  if (card !== null) await t.test("router card read and search withhold the stored card", () => f.cardVisible(card, false));
  f.assertWindows(origin, [anchor]);
}

export const scenarios = {
  "forget withholds an already archived conversation": async (t, storage) => {
    const f = fixture(t, storage);
    await storedConversation(t, f, await f.save(), "forget");
  },
  "forget withholds a later capture within the window": async (t, storage) => {
    const f = fixture(t, storage);
    await change(f, await f.save(), "forget");
    await f.capture([sameTextTurn, windowTurn], []);
    await assertRaw(f, []);
    await f.noCards();
    f.assertWindows("forget", [anchor]);
  },
  "forget windows a session-less web row across clients": async (t, storage) => {
    const f = fixture(t, storage);
    const row = await f.save("save", { kind: "web", client: "web", sessionId: null });
    await change(f, row, "forget");
    await f.capture([windowTurn], []);
    f.assertWindows("forget", [anchor]);
  },
  "forget leaves a different turn at +31 minutes visible": async (t, storage) => {
    const f = fixture(t, storage);
    const row = await f.save();
    const outside = { ...windowTurn, occurredAtMs: anchor + 31 * minute };
    await f.capture([outside]);
    const refs = await f.rawList([outside]);
    const card = await f.routerCard();
    await change(f, row, "forget");
    await assertRaw(f, [outside]);
    await f.rawRefs(refs, refs);
    await f.cardVisible(card, true);
    const later = { ...outside, id: "later" };
    await f.capture([later], [later], { ...conversation, eventId: "later" });
    f.assertWindows("forget", [anchor]);
  },
  "forget withholds a later capture with unknown time": async (t, storage) => {
    const f = fixture(t, storage);
    await change(f, await f.save(), "forget");
    await f.capture([{ ...windowTurn, occurredAtMs: null }], []);
    await assertRaw(f, []);
    await f.noCards();
    f.assertWindows("forget", [anchor]);
  },
  "correct withholds an already archived conversation": async (t, storage) => {
    const f = fixture(t, storage);
    await storedConversation(t, f, await f.save(), "edit");
  },
  "correct withholds a later capture within the window": async (t, storage) => {
    const f = fixture(t, storage);
    await change(f, await f.save(), "edit");
    await f.capture([sameTextTurn, windowTurn], []);
    await assertRaw(f, []);
    await f.noCards();
    f.assertWindows("edit", [anchor]);
  },
  "unchanged correct writes no facts": async (t, storage) => {
    const f = fixture(t, storage);
    const row = await f.save();
    const unchanged = await f.service.correct(scope, row.id, row.revision, original, source);
    assert.equal(unchanged.status, "unchanged");
    assert.equal(f.writeFact.mock.callCount(), 0);
    await f.capture([windowTurn]);
    await assertRaw(f, [windowTurn]);
  },
  "forget uses the existing session fence for a captured memory": async (t, storage) => {
    const f = fixture(t, storage, { infer: true });
    const { memories } = await f.capture([sameTextTurn]);
    assert.equal(memories.length, 1);
    const row = await f.row(memories[0].id);
    assert.deepEqual(row.source, { kind: "capture", client: conversation.client, sessionId: conversation.sessionId });
    await change(f, row, "forget");
    f.assertWindows("forget", []);
    await f.capture([windowTurn], [], { ...conversation, eventId: "replay" });
    const otherTurn = { ...windowTurn, id: "another" };
    await f.capture([otherTurn], [otherTurn], { ...conversation, sessionId: "another", eventId: "another" });
    await assertRaw(f, [otherTurn]);
  },
  "forget windows a migrated explicit row with a legacy receipt": async (t, storage) => {
    const f = fixture(t, storage);
    await storedConversation(t, f, await f.migrated("mcp"), "forget");
  },
  "forget skips windows for a migrated captured row with no session": async (t, storage) => {
    const f = fixture(t, storage);
    const row = await f.migrated("capture");
    await f.capture([windowTurn]);
    await change(f, row, "forget");
    f.assertWindows("forget", []);
    await assertRaw(f, [windowTurn]);
  },
  "forget uses the updated timestamp after a duplicate save": async (t, storage) => {
    const f = fixture(t, storage);
    const originalRow = await f.save();
    const updated = anchor + 90 * minute;
    f.time(updated);
    const row = await f.save("touch");
    assert.equal(row.id, originalRow.id);
    assert.equal(row.createdAtMs, anchor);
    assert.equal(row.updatedAtMs, updated);
    const turn = { ...windowTurn, occurredAtMs: updated + 10 * minute };
    await f.capture([turn]);
    await change(f, row, "forget");
    await assertRaw(f, []);
    f.assertWindows("forget", [anchor, updated]);
  },
  "a rejected window rolls back the predecessor and memory write": async (t, storage) => {
    const f = fixture(t, storage);
    const row = await f.save();
    const write = storage.suppressions.writeFact;
    storage.suppressions.writeFact = (tx, fact, incarnation) => {
      if (fact.kind === "window") throw new CoreError("fact_conflict");
      return write(tx, fact, incarnation);
    };
    await assert.rejects(f.service.correct(scope, row.id, row.revision, replacement, source), { code: "fact_conflict" });
    await assert.rejects(f.service.forget(scope, row.id, source), { code: "fact_conflict" });
    assert.equal((await f.row(row.id)).revision, row.revision);
    assert.equal((await f.row(row.id)).text, original);
    await f.capture([sameTextTurn]);
    await assertRaw(f, [sameTextTurn]);
  },
};

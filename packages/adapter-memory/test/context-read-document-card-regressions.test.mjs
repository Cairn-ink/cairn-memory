import assert from "node:assert/strict";
import { test } from "node:test";
import { coreDigest } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "@cairn-ink/conformance/context-assembly";
import { createMemoryAdapter } from "../src/index.mjs";

const scope = { owner: "owner", namespace: "personal\0" };
const excluded = { ...scope, namespace: "project\0other" };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const input = { query: "trail", types: ["card"], intent: "current" };
const note = "The trail follows the river.";
const change = "Follow the west ridge.";
const source = { client: "fixture", sessionId: "source", messageId: "message" };
const editor = { kind: "import", client: null, sessionId: null };
const tokenGenerations = snapshot => JSON.parse(Buffer.from(snapshot.split(".")[0], "base64url").toString()).generations;

function fixture(capabilities = {}) {
  const storage = createMemoryAdapter({
    capabilities: { contextRead: true, documentCards: true, rawArchive: true, inspect: true, ...capabilities },
  });
  const { capture, contextRead, documentCards, harness, memories, raw, uow } = storage;
  const service = createMemoryService({ profile: "keyless-local", storage, clock: assemblyClock(),
    contextReadCounter: { count: fixtureCount }, contextReadFormat: formatAssembly });
  const write = fn => uow.run(scope.owner, { pauseLock: true }, fn);
  const read = fn => uow.run(scope.owner, { readOnly: true }, fn);
  const assemble = (options = {}) => service.readContext(readSet, { ...input, raw: false, ...options });
  const find = options => service.findCandidates(readSet, { ...input, ...options });
  const fetch = ref => service.fetchEvidence(readSet, { refs: [ref], intent: input.intent });
  const message = (content, address = source) => ({ id: address.messageId, role: "user", content, occurredAtMs: 1 });
  const key = async (content, address = source) =>
    ({ scope, client: address.client, sessionId: address.sessionId, eventId: address.messageId,
      payloadDigest: (await coreDigest(content)).value });
  const card = (id, { target = scope, ...overrides } = {}) => write(tx => documentCards.put(tx, target, {
    id, scope: target, title: "Map", body: note, origin: "manual", contentHash: id,
    date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [], ...overrides,
  }));
  const amend = (cardId, quote, address = source, date = "2025-05-01") => write(tx => documentCards.amend(tx, scope, cardId,
    { amendmentId: date, date, sentence: quote, quote, sourceMessage: address }));
  async function archive(content, address = source) {
    const admission = await key(content, address);
    return write(tx => raw.archive(tx, admission, [message(content, address)]));
  }
  async function content(text) {
    return { text, textHash: "sha256:" + (await coreDigest(text)).value, embedding: null,
      origin: "explicit", kind: "fact", confidence: 1, source: editor };
  }
  async function memory(text) {
    const row = await content(text);
    const { id, revision } = await write(tx => memories.insert(tx, scope, row, [], 1));
    return { type: "memory", scope, id, revision };
  }
  return { capture, contextRead, harness, memories, raw, service, write, read, assemble, find, fetch,
    message, key, card, amend, archive, content, memory };
}

test("receipt ancestry withholds only the amendment when its capture memory is forgotten", async () => {
  const f = fixture({ contextRawRead: true });
  const admission = await f.key(change);
  const message = f.message(change);
  const receipt = { ...source, role: message.role, occurredAtMs: message.occurredAtMs };
  const [memory] = await f.write(async tx => {
    assert.equal((await f.capture.admit(tx, admission, [message])).status, "admitted");
    const claim = await f.capture.claim(tx, admission, [message], { leaseMs: 1000 });
    assert.equal(claim.status, "claimed");
    assert.deepEqual(await f.raw.archive(tx, admission, [message]), { archived: 1 });
    const { memories } = await f.capture.finish(tx, claim.token, [{
      content: change, textHash: "sha256:" + admission.payloadDigest, kind: "fact",
      confidence: 1, embedding: null, receipts: [receipt],
    }]);
    return memories;
  });
  const rawTurns = async () => (await f.read(tx => f.contextRead.raw.search(tx, readSet, "ridge", { limit: 2 }))).turns;
  await f.card("map");
  await f.amend("map", change);
  assert.equal((await rawTurns()).length, 1);
  assert.deepEqual((await f.assemble()).assembly.items[0].sources.map(({ excerpt }) => excerpt), [change]);

  await f.harness.seedFact(scope.owner, { ...scope, kind: "identity", origin: "forget", actionId: "forget", memoryId: memory.id });
  assert.deepEqual(await rawTurns(), []);
  const { assembly } = await f.assemble();
  assert.deepEqual(assembly.items.map(({ ref, body, sources }) => [ref.id, body, sources]), [["map", "Map\n" + note, []]]);
});

test("a conflicting replay withholds amendments from the retained address", async () => {
  const f = fixture({ rationaleEdges: false });
  const retained = "Cross at the footbridge.";
  assert.deepEqual(await f.archive("Directions: " + retained), { archived: 1 });
  assert.deepEqual(await f.archive(change), { archived: 0 });
  await f.card("map");
  await f.amend("map", retained, source, "2025-05-01");
  await f.amend("map", change, source, "2025-05-02");
  await f.harness.seedFact(scope.owner, { ...scope, kind: "text", mode: "exact", origin: "forget",
    actionId: "forget-replay", text: { digests: [await coreDigest(change)] } });

  const { assembly } = await f.assemble();
  assert.equal(assembly.items[0].ref.id, "map");
  assert.doesNotMatch(assembly.items[0].body, /west ridge/u);
  assert.deepEqual(assembly.items[0].sources, []);
});

test("namespace generations and personal cursor ignore card writes in an excluded project", async () => {
  const f = fixture();
  await f.card("personal-first");
  await f.card("personal-second");
  const page = await f.find({ limit: 1 });
  assert.ok(page.nextCursor);
  const before = await f.assemble();
  const fetched = await f.fetch(page.items[0].ref);
  const beforeGeneration = tokenGenerations(before.snapshot);
  assert.deepEqual(tokenGenerations(fetched.snapshot), beforeGeneration);
  assert.deepEqual(beforeGeneration, [{ memory: 1, card: 2 }]);

  await f.card("project-first", { target: excluded });
  await f.card("project-second", { target: excluded });
  const after = await f.assemble();
  const afterFetch = await f.fetch(page.items[0].ref);
  assert.deepEqual(after.assembly, before.assembly);
  assert.deepEqual(tokenGenerations(after.snapshot), beforeGeneration);
  assert.deepEqual(tokenGenerations(afterFetch.snapshot), beforeGeneration);
  assert.deepEqual((await f.service.fetchEvidence(readSet, { snapshot: fetched.snapshot })).items, fetched.items);
  const next = await f.find({ limit: 1, cursor: page.nextCursor });
  assert.equal(next.items[0].rank, 2);
  assert.notEqual(next.items[0].ref.id, page.items[0].ref.id);
});

test("stored citation revisions leave an in-place correction available as its own item", async () => {
  const f = fixture();
  const memory = await f.memory("The trail runs east.");
  await f.archive(note);
  const { card } = await buildDocumentCard(f.message(note), { scope, client: source.client, canonicalSessionKey: source.sessionId });
  await f.card(card.id, { origin: "router", sourceMessage: source, sourceMemories: [memory] });
  const corrected = "The trail runs west.";
  const next = await f.content(corrected);
  const { revision } = await f.write(tx => f.memories.replaceContent(tx, scope, memory.id, memory.revision, next, null, 2));
  assert.equal(revision, memory.revision + 1);

  const { assembly } = await f.assemble({ types: ["memory", "card"] });
  assert.deepEqual(assembly.items.filter(({ ref }) => ref.type === "card").map(({ ref }) => ref.id), [card.id]);
  assert.deepEqual(assembly.items.filter(({ ref }) => ref.type === "memory").map(({ ref, body }) => [ref.rev, body]),
    [[revision, corrected]]);
  const cardRef = (await f.find()).items[0].ref;
  assert.deepEqual((await f.fetch(cardRef)).items[0].triggerMemoryRefs, [memory]);
});

test("one-slot replacement at the card's own rank agrees with and without Raw", async () => {
  const f = fixture({ contextRawRead: true });
  const memory = await f.memory("Trail trail trail.");
  await f.card("map", { sourceMemories: [memory] });
  await f.archive("Trail update: " + change);
  await f.amend("map", change);
  const types = ["memory", "card"];
  const options = { types, budget: { maxItems: 1 } };
  const found = await f.find({ types });
  assert.deepEqual(found.items.map(({ ref, rank }) => [ref.id, rank]), [[memory.id, 1], ["map", 2]]);
  const withoutRaw = await f.assemble(options);
  assert.deepEqual(withoutRaw.assembly.items.map(({ ref, rank }) => [ref.id, rank]), [["map", 2]]);
  const withRaw = await f.assemble({ ...options, raw: true });
  assert.equal(withRaw.diagnostics.coverage.raw, "included");
  assert.deepEqual(withRaw.assembly, withoutRaw.assembly);
});

test("withheld amendment does not consume one of five selection slots", async () => {
  const f = fixture();
  await f.card("map");
  const quotes = [];
  for (let i = 1; i <= 6; i++) {
    const date = "2025-05-0" + i;
    const address = { ...source, sessionId: date };
    const quote = "Follow marker " + i + ".";
    await f.archive(quote, address);
    await f.amend("map", quote, address, date);
    if (i === 6) await f.write(tx => f.raw.fenceSession(tx, scope, address));
    else quotes.push(quote);
  }
  const { assembly } = await f.assemble();
  assert.deepEqual(assembly.items[0].sources.map(({ excerpt }) => excerpt), quotes);
});

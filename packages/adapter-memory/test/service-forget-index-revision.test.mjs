import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryService } from "../../core/src/service/index.mjs";
import { hostedScope as scope, serviceFake } from "../../core/test/helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const text = "The spare lens is in the cabinet.";
const sha256Hex = value => createHash("sha256").update(value).digest("hex");

function fixture(capabilities) {
  const storage = createMemoryAdapter({ capabilities });
  const { uow, memories } = storage;
  const { deps } = serviceFake();
  const service = (adapter = storage) => createMemoryService({
    ...deps, storage: adapter, clock: { ...deps.clock, sha256Hex },
  });
  const write = fn => uow.run(scope.owner, { pauseLock: true }, fn);
  const read = fn => uow.run(scope.owner, { readOnly: true }, fn);
  const readRevision = () => read(tx => memories.indexRevision(tx));
  const insert = (tx, memorySource = source) => memories.insert(tx, scope, {
    text, textHash: "sha256:" + sha256Hex(text), kind: "fact", origin: "explicit",
    confidence: 1, source: memorySource, embedding: null,
  }, [], 1);
  return { storage, service, write, read, readRevision, insert };
}

test("forget reports start and committed index revisions with the reference adapter", async () => {
  const { storage, service, write, readRevision, insert } = fixture();
  const { forget } = service();
  const { id, revision } = await write(tx => insert(tx));
  const start = await readRevision();
  const before = await storage.harness.dump();

  const conflict = await forget(scope, id, source, { expectedRevision: revision + 1 });
  assert.deepEqual(conflict, { status: "conflict", indexRevision: start });
  assert.equal(await readRevision(), conflict.indexRevision);
  assert.deepEqual(await storage.harness.dump(), before);

  const forgotten = await forget(scope, id, source, { expectedRevision: revision });
  assert.deepEqual(forgotten, { status: "forgotten", removedSimilar: 0, indexRevision: await readRevision() });
  assert.ok(forgotten.indexRevision > start);

  const repeated = await forget(scope, id, source, { expectedRevision: revision });
  assert.deepEqual(repeated, { status: "not_found", indexRevision: await readRevision() });
  assert.equal(repeated.indexRevision, forgotten.indexRevision);
});

test("forget reports the committed index revision after a Raw fence and a linked card hide", async () => {
  const { storage, service, write, read, readRevision, insert } = fixture({ rawArchive: true, documentCards: true });
  const { raw, documentCards } = storage;
  const session = { client: "fixture", sessionId: "session" };
  const capture = { scope, ...session, eventId: "event", payloadDigest: sha256Hex(text) };
  const cardId = "linked-card";
  const { id } = await write(async tx => {
    const memory = await insert(tx, { ...source, ...session });
    const body = "Keep a spare lens.";
    const card = await documentCards.put(tx, scope, {
      id: cardId, scope, origin: "import", title: "Lens note", body, contentHash: sha256Hex(body),
      date: null, sourceMessage: null, sourceMemories: [{ id: memory.id, revision: memory.revision }],
      sentences: [], stale: [],
    });
    assert.equal(card.status, "inserted");
    return memory;
  });
  assert.ok(await read(tx => documentCards.get(tx, scope, cardId)));
  assert.equal(await read(tx => raw.archiveAllowed(tx, capture)), true);

  const forgotten = await service().forget(scope, id, source);

  assert.equal(await read(tx => raw.archiveAllowed(tx, capture)), false);
  assert.equal(await read(tx => documentCards.get(tx, scope, cardId)), null);
  assert.deepEqual(forgotten, { status: "forgotten", removedSimilar: 0, indexRevision: await readRevision() });
});

test("the reference committed index revision equals the next run's start", async () => {
  const { storage: { memories, raw }, write, readRevision, insert } = fixture({ rawArchive: true });
  const start = await readRevision();
  const committed = await write(async tx => {
    assert.equal(await memories.committedIndexRevision(tx), start);
    await insert(tx);
    await raw.fenceSession(tx, scope, { client: "fixture", sessionId: "session" });
    assert.equal(await memories.indexRevision(tx), start);
    return memories.committedIndexRevision(tx);
  });
  assert.equal(committed, await readRevision());
  assert.ok(committed > start);
});

test("forget with a start-only adapter reports the revision for conflict and not_found", async () => {
  const { storage, service, write, readRevision, insert } = fixture();
  const { committedIndexRevision: _committed, ...memories } = storage.memories;
  const { forget } = service({ ...storage, memories });
  const { id, revision } = await write(tx => insert(tx));
  const before = await readRevision();

  assert.deepEqual(await forget(scope, id, source, { expectedRevision: revision + 1 }),
    { status: "conflict", indexRevision: before });
  assert.equal(await readRevision(), before);

  assert.deepEqual(await forget(scope, id, source), { status: "forgotten", removedSimilar: 0 });
  const start = await readRevision();
  assert.deepEqual(await forget(scope, id, source), { status: "not_found", indexRevision: start });
  assert.equal(await readRevision(), start);
});

test("forget omits the conflict revision when the adapter has no start accessor", async () => {
  const { storage, service, write, readRevision, insert } = fixture();
  const { indexRevision: _start, ...memories } = storage.memories;
  const { forget } = service({ ...storage, memories });
  const { id, revision } = await write(tx => insert(tx));
  const start = await readRevision();
  const before = await storage.harness.dump();

  assert.deepEqual(await forget(scope, id, source, { expectedRevision: revision + 1 }), { status: "conflict" });
  assert.equal(await readRevision(), start);
  assert.deepEqual(await storage.harness.dump(), before);
});

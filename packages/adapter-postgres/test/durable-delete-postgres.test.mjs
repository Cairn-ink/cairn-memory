import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import {
  createPostgresCapturePorts, createPostgresMemoryStore, createPostgresRawPorts,
  createPostgresQuantityLedgerStore, createPostgresSuppressionStore, createPostgresUnitOfWork,
} from "../src/index.mjs";
import { canonicalReceiptId } from "../src/memory-rows.mjs";
import { migrationDatabase, migrationDbTest } from "./migration-database.mjs";

const scope = { owner: "owner", namespace: null };
const lineageSecret = "fixture";
const newEvent = (sessionId = randomUUID()) => ({
  scope, client: "test-client", sessionId, eventId: randomUUID(), payloadDigest: "a".repeat(64),
});
const message = (content, occurredAtMs) => ({ id: randomUUID(), role: "user", content, occurredAtMs });
const hash = text => createHash("sha256").update(text).digest("hex");
const vector = [1, ...Array(1535).fill(0)];
const receipt = (event, { id, role, occurredAtMs }) => ({
  client: event.client, sessionId: event.sessionId, messageId: id, role, occurredAtMs,
});
const finishItem = (content, receipts = []) => ({
  content, kind: "fact", confidence: 0.9, textHash: `sha256:${hash(content)}`,
  embedding: { model: "fixture", vector }, receipts,
});

async function fixture(t) {
  const { pool, source } = await migrationDatabase(t);
  await pool.query("INSERT INTO users (id) VALUES ($1)", [scope.owner]);
  const uow = createPostgresUnitOfWork(source);
  const { raw } = createPostgresRawPorts({ lineageSecret });
  const capture = createPostgresCapturePorts({ lineageSecret });
  const { receiptWithheld } = createPostgresSuppressionStore();
  const memories = createPostgresMemoryStore();
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  const read = work => uow.run(scope.owner, { readOnly: true }, work);
  const revision = () => read(tx => memories.indexRevision(tx));
  const claim = (event, batch) => write(tx => capture.claim(tx, event, batch, { leaseMs: 60_000 }));
  const remove = event => write(tx => raw.deleteConversation(tx, scope, event));
  const archive = (event, item) => write(tx => raw.archive(tx, event, [item]));
  const importMessage = (event, item) => write(tx => raw.importArchive(tx, scope, event, [item]));
  const withheld = (event, item, occurredAtMs = item.occurredAtMs, admitted) =>
    read(tx => receiptWithheld(tx, scope, { ...receipt(event, item), occurredAtMs, excerpt: item.content }, admitted));
  return { pool, raw, capture, write, read, revision, claim, remove, archive, importMessage, withheld };
}

test("deleting a Postgres conversation durably refuses new sources and advances the index once", migrationDbTest, async t => {
  const { pool, raw, capture, write, read, revision, archive, remove, withheld } = await fixture(t);
  const deleted = newEvent();
  const control = newEvent();
  const original = message("The latch is brass.", 1);
  const controlMessage = message("The shelf is oak.", 2);
  const allowed = event => read(tx => raw.archiveAllowed(tx, event));

  assert.deepEqual(await archive(deleted, original), { archived: 1 });
  const before = await revision();
  const abort = new Error("rollback");
  await assert.rejects(write(async tx => {
    assert.deepEqual(await raw.deleteConversation(tx, scope, deleted), { rawDeleted: 1 });
    throw abort;
  }), error => error === abort);
  assert.equal(await revision(), before);
  assert.equal(await allowed(deleted), true);
  assert.deepEqual(await remove(deleted), { rawDeleted: 1 });
  assert.equal(await revision(), before + 1);

  const later = newEvent(deleted.sessionId);
  const resent = message("The latch was polished.", 3);
  const late = message("The latch was replaced.", Date.now() + 86_400_000);
  assert.equal(await allowed(later), false);
  assert.deepEqual(await archive(later, resent), { archived: 0 });
  assert.deepEqual(await archive(later, late), { archived: 0 });
  assert.deepEqual(await write(tx => raw.importArchive(tx, scope, later, [resent, late])),
    { archived: 0, existing: 0, withheld: 2 });
  assert.equal(await withheld(later, late), true);
  assert.deepEqual(await read(tx => capture.eligible(tx, later, [resent, late])), []);
  assert.deepEqual(await remove(deleted), { rawDeleted: 0 });
  assert.equal(await revision(), before + 1);

  assert.deepEqual(await archive(control, controlMessage), { archived: 1 });
  assert.equal(await withheld(control, controlMessage), false);
  assert.deepEqual((await pool.query("SELECT message_id FROM raw_messages WHERE user_id = $1", [scope.owner])).rows,
    [{ message_id: controlMessage.id }]);

  const empty = newEvent();
  const beforeEmptyDelete = await revision();
  assert.deepEqual(await remove(empty), { rawDeleted: 0 });
  assert.equal(await revision(), beforeEmptyDelete + 1);
  assert.equal(await allowed(empty), false);
  assert.deepEqual(await remove(empty), { rawDeleted: 0 });
  assert.equal(await revision(), beforeEmptyDelete + 1);
});

test("only an all-blank admitted outbox can recheck an empty selection in a deleted conversation", migrationDbTest, async t => {
  const { pool, raw, capture, write, read, claim } = await fixture(t);
  const deleted = newEvent();
  const original = message("The latch is brass.", 1);
  const recheck = (event, positions) => write(tx => capture.assertEligible(tx, event, positions));

  assert.deepEqual(await write(tx => capture.admit(tx, deleted, [original])), { status: "admitted" });
  assert.deepEqual(await write(tx => raw.deleteConversation(tx, scope, deleted)), { rawDeleted: 0 });
  const scrubbed = await claim(deleted, []);
  assert.equal(scrubbed.status, "claimed");
  await recheck(deleted, []);
  await assert.rejects(recheck(deleted, [0]), { code: "lineage_fenced" });
  assert.deepEqual((await write(tx => capture.finish(tx, scrubbed.token, []))).memories, []);

  const late = newEvent(deleted.sessionId);
  const fresh = message("The latch was replaced.", 2);
  assert.deepEqual(await write(tx => capture.admit(tx, late, [fresh])), { status: "duplicate" });
  assert.equal(await read(tx => capture.load(tx, late)), null);
  assert.deepEqual(await claim(late, [fresh]), { status: "duplicate" });
  assert.deepEqual((await pool.query(`SELECT raw_request, core_lease_sources FROM capture_events
    WHERE user_id = $1 AND client = $2 AND event_id = $3`, [scope.owner, late.client, late.eventId])).rows, []);
});

for (const deleteClient of ["coding-client", "mcp"]) {
  test(`deleting the ${deleteClient} MCP address fences and scrubs both proven addresses`, migrationDbTest, async t => {
    const { pool, raw, capture, write, read, claim, archive, importMessage, remove, withheld } = await fixture(t);
    const reported = { ...newEvent(`mcp-save:${randomUUID()}`), client: "coding-client" };
    const physical = { ...newEvent(reported.sessionId), client: "mcp" };
    const unrelated = { ...newEvent(reported.sessionId), client: "another-client" };
    const original = message("The spool is copper.", 150);
    const late = message("The spool was replaced.", 300);
    const memoryId = randomUUID();
    await pool.query(`INSERT INTO memories
      (id, user_id, text, text_hash, kind, embedding, embedding_model, source_kind, source_client, source_session_id)
      VALUES ($1, $2, $3, $4, 'fact', $5, 'fixture', 'mcp', $6, $7)`,
    [memoryId, scope.owner, original.content, hash(original.content), JSON.stringify(vector), reported.client, reported.sessionId]);
    for (const event of [reported, physical, unrelated]) {
      assert.deepEqual(await write(tx => capture.admit(tx, event, [original])), { status: "admitted" });
      assert.deepEqual(await archive(event, original), { archived: 1 });
    }
    const clients = [reported.client, physical.client];
    await pool.query(`INSERT INTO core_memory_receipts (user_id, memory_id, client, session_id, message_id, role)
      SELECT $1, $2, client, $3, $4, $5 FROM unnest($6::text[]) AS addresses(client)`,
    [scope.owner, memoryId, reported.sessionId, original.id, original.role, clients]);
    const ledger = createPostgresQuantityLedgerStore();
    const quantities = await Promise.all([reported, physical].map(async event => ({
      memoryId, receiptId: await canonicalReceiptId(scope.owner, scope.namespace, memoryId, receipt(event, original)),
      textHash: `sha256:${hash(original.content)}`, date: original.occurredAtMs, ordinal: 0,
      kind: "record", measure: "weight", category: "spool", value: 6, unit: "g", group: "materials",
      period: "none", comparator: "none",
    })));
    assert.deepEqual(await write(tx => ledger.put(tx, scope, quantities)), { inserted: 2 });

    // A legacy fence may exist at just the physical address before deletion.
    await write(tx => raw.fenceSession(tx, scope, physical));
    const reportedLate = { ...reported, eventId: randomUUID() };
    assert.deepEqual(await archive(reportedLate, late), { archived: 0 });
    assert.deepEqual(await importMessage(reportedLate, late), { archived: 0, existing: 0, withheld: 1 });
    assert.deepEqual(await write(tx => capture.admit(tx, reportedLate, [late])), { status: "duplicate" });
    assert.deepEqual(await claim(reported, [original]), { status: "duplicate" });
    assert.equal(await withheld(reported, original), true);
    const unrelatedClaim = await claim(unrelated, [original]);
    assert.equal(unrelatedClaim.status, "claimed");
    await assert.rejects(write(tx => capture.finish(tx, unrelatedClaim.token, [
      finishItem("A derived memory.", [receipt(reported, original)]),
    ])), { code: "suppressed" }); // Finish binding refuses a receipt outside the claim's own address.

    assert.deepEqual((await pool.query(`SELECT source_client, source_session_id, source_message_id
      FROM core_quantity_ledger WHERE memory_id = $1 ORDER BY source_client`, [memoryId])).rows,
    clients.map(client => ({ source_client: client, source_session_id: reported.sessionId, source_message_id: original.id })));
    assert.deepEqual(await read(tx => ledger.terms(tx, scope)), ["materials", "spool", "weight"]);
    assert.deepEqual(await remove(deleteClient === physical.client ? physical : reported), { rawDeleted: 2 });
    assert.deepEqual(await read(tx => ledger.listForMemory(tx, scope, memoryId)), []);
    assert.deepEqual(await read(tx => ledger.list(tx, scope, { fromMs: 0, toMs: late.occurredAtMs })), []);
    assert.deepEqual(await read(tx => ledger.terms(tx, scope)), []);
    assert.deepEqual((await pool.query(`SELECT client FROM capture_raw_fences
      WHERE user_id = $1 AND session_id = $2 ORDER BY client`, [scope.owner, reported.sessionId])).rows,
    [{ client: reported.client }, { client: physical.client }]);
    for (const event of [reported, physical]) {
      assert.deepEqual((await read(tx => capture.load(tx, event))).messages.map(({ content }) => content), [""]);
      const fresh = { ...event, eventId: randomUUID() };
      assert.deepEqual(await archive(fresh, late), { archived: 0 });
      assert.deepEqual(await importMessage(fresh, late), { archived: 0, existing: 0, withheld: 1 });
      assert.deepEqual(await write(tx => capture.admit(tx, fresh, [late])), { status: "duplicate" });
      assert.deepEqual(await claim(fresh, [late]), { status: "duplicate" });
      assert.equal(await withheld(event, original), true);
    }
    assert.deepEqual((await read(tx => capture.load(tx, unrelated))).messages, [original]);
    assert.deepEqual(await importMessage(unrelated, late), { archived: 1, existing: 0, withheld: 0 });
    assert.equal(await withheld(unrelated, late), false);
    assert.deepEqual((await pool.query("SELECT DISTINCT client FROM raw_messages WHERE user_id = $1", [scope.owner])).rows,
      [{ client: unrelated.client }]);
  });
}

async function suppressWindow({ write }, client) {
  const fact = { ...scope, kind: "window", origin: "forget", actionId: randomUUID(), client,
    window: { startMs: 100, endMs: 200 } };
  await write(tx => createPostgresSuppressionStore().writeFact(tx, fact, hash(JSON.stringify(fact))));
}

test("receipt withholding uses archived and admitted message times and requires source evidence", migrationDbTest, async t => {
  const db = await fixture(t);
  const { archive, withheld } = db;
  const event = newEvent();
  const archived = message("An archived passage.", 150);
  const admitted = message("An admitted passage.", 150);
  const visible = message("A visible passage.", 300);
  assert.deepEqual(await archive(event, archived), { archived: 1 });
  await suppressWindow(db, event.client);
  assert.equal(await withheld(event, archived, 300), true);
  assert.equal(await withheld(event, admitted, 300, admitted), true);
  assert.equal(await withheld(event, visible), true);
  assert.equal(await withheld(event, visible, 150, visible), false);
});

test("receipt withholding follows an archived proven fork of a deleted conversation", migrationDbTest, async t => {
  const { archive, importMessage, read, remove, withheld } = await fixture(t);
  const root = newEvent();
  const fork = newEvent();
  const unanchored = newEvent();
  const shared = message("The iron key opens the gate.", 150);
  const signed = createPostgresSuppressionStore({ lineageSecret });
  const signedWithheld = event =>
    read(tx => signed.receiptWithheld(tx, scope, { ...receipt(event, shared), excerpt: shared.content }));
  assert.deepEqual(await importMessage(root, shared), { archived: 1, existing: 0, withheld: 0 });
  assert.deepEqual(await importMessage(fork, shared), { archived: 1, existing: 0, withheld: 0 });
  assert.deepEqual(await archive(unanchored, shared), { archived: 1 });
  assert.equal(await signedWithheld(fork), false);
  assert.deepEqual(await remove(root), { rawDeleted: 1 });
  assert.equal(await signedWithheld(fork), true);
  assert.equal(await withheld(fork, shared), true);
  assert.equal(await withheld(unanchored, shared), true);
});

test("finish refuses forgotten addresses and checks windows with stored and lease times", migrationDbTest, async t => {
  const db = await fixture(t);
  const { pool, capture, write, claim, archive } = db;
  const event = newEvent();
  const external = { ...newEvent(), client: "another-client" };
  const forgotten = message("A forgotten passage.", 300);
  const archived = message("A windowed Raw passage.", 150);
  const admitted = message("A windowed claimed passage.", 150);
  assert.deepEqual(await archive(external, forgotten), { archived: 1 });
  assert.deepEqual(await archive(event, archived), { archived: 1 });
  const lease = await claim(event, [admitted]);
  assert.equal(lease.status, "claimed");
  await pool.query(`INSERT INTO core_memory_receipts
    (user_id, memory_id, client, session_id, message_id, role, forgotten_at)
    VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
  [scope.owner, randomUUID(), external.client, external.sessionId, forgotten.id, forgotten.role]);
  await suppressWindow(db, event.client);
  const finish = source => write(tx => capture.finish(tx, lease.token, [finishItem("A derived detail.", [source])]));
  await assert.rejects(finish(receipt(external, forgotten)), { code: "suppressed" });
  await assert.rejects(finish({ ...receipt(event, archived), occurredAtMs: 300 }), { code: "suppressed" });
  await assert.rejects(finish({ ...receipt(event, admitted), occurredAtMs: 300 }), { code: "suppressed" });
  assert.deepEqual((await pool.query("SELECT id FROM memories WHERE user_id = $1", [scope.owner])).rows, []);
  assert.deepEqual((await pool.query(`SELECT message_id FROM core_memory_receipts
    WHERE user_id = $1 AND forgotten_at IS NULL`, [scope.owner])).rows, []);
});

test("finish refuses receiptless output from a lease on a proven fork", migrationDbTest, async t => {
  const { pool, raw, capture, write, claim, remove } = await fixture(t);
  const root = newEvent();
  const fork = newEvent();
  const shared = message("The iron key opens the gate.", 150);
  await write(tx => raw.recordLineage(tx, root, [shared]));
  const lease = await claim(fork, [shared]);
  assert.equal(lease.status, "claimed");
  assert.deepEqual(await remove(root), { rawDeleted: 0 });
  await assert.rejects(write(tx => capture.assertEligible(tx, fork, [0])), { code: "lineage_fenced" });
  await assert.rejects(write(tx => capture.finish(tx, lease.token, [finishItem("A derived detail.")])),
    { code: "lineage_fenced" });
  assert.deepEqual((await pool.query("SELECT id FROM memories WHERE user_id = $1", [scope.owner])).rows, []);
});

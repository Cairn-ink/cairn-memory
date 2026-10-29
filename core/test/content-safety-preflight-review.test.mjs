import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { contentSafetyObservations } from '../content-safety-observations.mjs';
import { classifyCardBodySafetyV1 } from '../content-safety-classifier.mjs';
import { preflightContentSafetyV1 } from '../content-safety-preflight.mjs';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, readTransaction, STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { sourceFixture, savedSource, ns as rawNs } from '../testing/raw-source-fixtures.mjs';
import { fixture, ns, ok, receipt, refusal, independentFiles } from './content-safety-preflight-fixture.mjs';

const limits = { scanRows: 250000, scanBytes: 128 * 1024 * 1024 };
function classify(f, id) {
  const snapshot = readTransaction(f.db, () => contentSafetyObservations(f.db, limits, () => {}));
  const value = snapshot.observations.find(item => item.body.identity.key === id);
  assert.ok(value); return classifyCardBodySafetyV1(value);
}
function rawFixture(t) {
  const f = sourceFixture(t), upgrade = openDatabase(f.path, { currentDependencies: true }); upgrade.close();
  f.db.exec(`PRAGMA busy_timeout=${STORAGE_BUSY_TIMEOUT_MS}`);
  let serial = 0;
  f.memoryCard = memory => {
    const card = ok(f.call('createCardDraft', { namespace: rawNs, actionId: 'memory-draft-' + (++serial), drafting: 'authored',
      input: { title: 'Synthetic receipt-backed Card', body: 'Synthetic retained body.', sourcePolicy: 'retained-receipts-v1',
        memoryRefs: [{ type: 'memory', namespace: rawNs, memoryId: memory.id, revision: memory.revision }] } }));
    return ok(f.call('confirmCardDraft', { namespace: rawNs, cardId: card.id, expectedRevision: card.revision, actionId: 'memory-confirm-' + (++serial) }));
  };
  f.remove = source => ok(f.core.deleteConversation({ namespace: rawNs, conversationId: source.conversationId,
    expectedRevision: f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision,
    actionId: 'delete-source-' + (++serial) }));
  f.admitRaw = (source, content = 'Synthetic mixed-support interpretation.', excerpt = source.text) => {
    const memory = ok(f.core.admit({ namespace: rawNs, memory: { content, kind: 'context' },
      receipts: [{ client: 'codex', sessionId: 'synthetic-session', eventId: source.messageId, role: 'user', excerpt }] })).memory;
    return ok(f.core.get({ namespace: rawNs, memoryId: memory.id })).memory;
  };
  return f;
}

test('R1 surviving Memory: an unversioned deletion effect cannot prove a missing receipt cause', async t => {
  const f = rawFixture(t), source = await savedSource(f), memory = f.admitRaw(source);
  const withIndependent = ok(f.core.admit({ namespace: rawNs, memory: { content: memory.content, kind: 'context' }, receipts: [receipt('independent')] })).memory;
  const card = f.memoryCard(withIndependent);
  const oldIds = f.db.prepare('SELECT receipt_id FROM card_memory_bindings WHERE card_id=?').all(card.id).map(row => row.receipt_id);
  f.remove(source);
  assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n, 1);
  assert.ok(oldIds.some(id => !f.db.prepare('SELECT 1 FROM receipts WHERE id=?').get(id)));
  assert.equal(classify(f, card.id).status, 'unknown');
  const report = await preflightContentSafetyV1({ path: f.path });
  assert.equal(report.knownSuppressed, 0);
  // A fresh revision using only surviving receipts is not the removed source.
  const current = ok(f.core.get({ namespace: rawNs, memoryId: memory.id })).memory;
  const fresh = f.memoryCard(current);
  assert.equal(classify(f, fresh.id).status, 'unknown');
});

test('R2 independent receipt: own session fence matches with no surviving root', async t => {
  const f = rawFixture(t), source = await savedSource(f);
  const memory = ok(f.core.admit({ namespace: rawNs, memory: { content: 'Synthetic independent session statement.', kind: 'context' },
    receipts: [{ client: 'codex', sessionId: 'synthetic-session', eventId: 'never-retained-message', role: 'user', excerpt: 'Independent support.' }] })).memory;
  const card = f.memoryCard(memory);
  f.remove(source);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_receipt_lineage').get().n, 0);
  assert.equal(f.db.prepare('SELECT kind FROM raw_receipt_origins').get().kind, 'independent');
  assert.deepEqual(classify(f, card.id), { status: 'known-suppressed', reasons: ['purge'] });
});

test('R3 caller action prefix cannot invent a contributor to an unrelated Card', t => {
  const f = fixture(t), memory = f.admit(), card = f.draft(ns, undefined, true);
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  const detail = ok(f.call('getCard', { namespace: ns, cardId: card.id })).card;
  ok(f.call('editKnowledgeCard', { namespace: ns, cardId: card.id, expectedRevision: detail.revision,
    actionId: `memory-revision-${memory.id}-2`, title: detail.title, body: detail.body,
    applicability: 'unknown', bindings: detail.bindings.map(item => item.source) }));
  assert.equal(classify(f, card.id).status, 'unknown');
});

test('R3 separate ledgers: matching caller action ids do not link an unrelated Raw deletion', async t => {
  const f = rawFixture(t), source = await savedSource(f), removed = f.remove(source);
  const card = ok(f.call('createCardDraft', { namespace: rawNs, actionId: 'unrelated-draft', drafting: 'authored',
    input: { title: 'Synthetic unrelated title', body: 'Synthetic unrelated body', authoredInput: { text: 'Synthetic own note.', occurredAt: null } } }));
  ok(f.call('confirmCardDraft', { namespace: rawNs, cardId: card.id, expectedRevision: card.revision, actionId: 'unrelated-confirm' }));
  const detail = ok(f.call('getCard', { namespace: rawNs, cardId: card.id })).card;
  ok(f.call('editKnowledgeCard', { namespace: rawNs, cardId: card.id, expectedRevision: detail.revision, actionId: removed.actionId,
    title: detail.title, body: detail.body, applicability: 'unknown', bindings: detail.bindings.map(item => item.source) }));
  assert.equal(classify(f, card.id).status, 'unknown');
});

for (const fallback of [false, true]) test(`R4 ${fallback ? 'keyed fallback' : 'exact lineage'}: disjoint Raw window never becomes a contributor`, async t => {
  const f = rawFixture(t), source = await savedSource(f, 'A'.repeat(800) + 'B'.repeat(800));
  const a = f.admitRaw(source, 'Synthetic first-window interpretation.', 'A'.repeat(800));
  const b = f.admitRaw(source, 'Synthetic second-window interpretation.', 'B'.repeat(800));
  const card = f.memoryCard(b);
  const span = f.db.prepare('SELECT start,end FROM raw_receipt_lineage WHERE receipt_id=(SELECT id FROM receipts WHERE memory_id=?)').get(b.id);
  assert.deepEqual({ ...span }, { start: 800, end: 1600 });
  ok(f.core.forget({ namespace: rawNs, memoryId: a.id, expectedRevision: a.revision }));
  if (fallback) f.db.prepare('DELETE FROM raw_receipt_lineage WHERE receipt_id=(SELECT id FROM receipts WHERE memory_id=?)').run(b.id);
  assert.equal(classify(f, card.id).status, 'unknown');
});

test('R4 receipt ancestry: overlapping Raw exclusion suppresses without a direct Raw binding', async t => {
  const f = rawFixture(t), source = await savedSource(f), a = f.admitRaw(source), b = f.admitRaw(source, 'Synthetic other interpretation.');
  const card = f.memoryCard(b);
  ok(f.core.forget({ namespace: rawNs, memoryId: a.id, expectedRevision: a.revision }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_raw_bindings').get().n, 0);
  assert.deepEqual(classify(f, card.id), { status: 'known-suppressed', reasons: ['purge'] });
});

test('R6 lone card_operations_owner_action index refuses legacy first-install mode', async t => {
  const f = fixture(t); f.draft();
  f.db.exec('CREATE UNIQUE INDEX card_operations_owner_action ON card_operations(owner_id,action_id)'); f.close();
  const before = independentFiles(f.path);
  assert.deepEqual(await preflightContentSafetyV1({ path: f.path }), refusal);
  assert.deepEqual(independentFiles(f.path), before);
});

test('R7 nonempty rollback journal refuses with unchanged file family', async t => {
  const f = fixture(t); f.draft(); f.close();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    "import {writeFileSync} from 'node:fs';writeFileSync(process.argv[1]+'-journal',Buffer.alloc(512,1));", f.path], { encoding: 'utf8', env: {}, timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  const before = independentFiles(f.path);
  assert.deepEqual(await preflightContentSafetyV1({ path: f.path }), refusal);
  assert.deepEqual(independentFiles(f.path), before);
});

test('R8 legacy deleted Memory has purge without retained proof of user forget', t => {
  const f = fixture(t), memory = f.admit(), card = f.draft(ns, [memory], true);
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.deepEqual(classify(f, card.id), { status: 'known-suppressed', reasons: ['purge'] });
});

test('R8 legacy Raw exclusion without causal evidence is purge', async t => {
  const f = rawFixture(t), source = await savedSource(f), memory = f.admitRaw(source), card = f.memoryCard(memory);
  // The existing exclusion writer records the span but no retained causal reason.
  f.db.exec('BEGIN IMMEDIATE');
  try { createRawLineageStorage(f.db).excludeMemory(rawNs, memory.id); f.db.exec('COMMIT'); }
  catch (error) { f.db.exec('ROLLBACK'); throw error; }
  assert.deepEqual(classify(f, card.id), { status: 'known-suppressed', reasons: ['purge'] });
});

test('R5 scale: default budget reconciles 121 Cards, 1650 Memories, 26 namespaces and 16 bindings per Card', async t => {
  const f = fixture(t, 33), namespaces = Array.from({ length: 26 }, (_, index) => ({ ...ns, ownerId: 'synthetic-scale-owner-' + index }));
  for (let index = 0; index < 1650; index++) {
    const namespace = namespaces[index % namespaces.length], content = `Synthetic scale memory ${index}.`;
    const receipts = Array.from({ length: index < 121 ? 16 : 1 }, (_, position) => receipt(`scale-${index}-${position}`));
    let memory;
    for (let offset = 0; offset < receipts.length; offset += 4) memory = ok(f.core.admit({ namespace,
      memory: { content, kind: 'context' }, receipts: receipts.slice(offset, offset + 4) })).memory;
    if (index < 121) {
      f.draft(namespace, [memory], true);
      for (let offset = 0; offset < 16; offset += 4) ok(f.core.admit({ namespace, memory: { content, kind: 'context' },
        receipts: Array.from({ length: 4 }, (_, position) => receipt(`more-${index}-${offset + position}`)) }));
    }
  }
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings').get().n, 121 * 16);
  const start = performance.now();
  const report = await preflightContentSafetyV1({ path: f.path });
  const elapsedMs = performance.now() - start;
  assert.deepEqual(report, { enumerated: 121, complete: 0, unknown: 121, knownSuppressed: 0,
    owners: { complete: 0, unknown: 26, knownSuppressed: 0 }, ownersAffected: 26,
    mode: 'first-install', schemaBase: 33, unchangedFiles: true });
  const prepare = DatabaseSync.prototype.prepare, preparations = new Map();
  DatabaseSync.prototype.prepare = function(sql) { preparations.set(sql, (preparations.get(sql) ?? 0) + 1); return prepare.call(this, sql); };
  let snapshot;
  try { snapshot = readTransaction(f.db, () => contentSafetyObservations(f.db, limits, () => {})); }
  finally { DatabaseSync.prototype.prepare = prepare; }
  assert.ok([...preparations.values()].every(count => count === 1), 'each statement is prepared once per snapshot');
  t.diagnostic(JSON.stringify({ syntheticScale: { cards: 121, memories: 1650, namespaces: 26, bindings: 1936 }, counts: report,
    budgetUsed: { ...snapshot.usage, fileBytes: independentFiles(f.path).reduce((sum, file) => sum + Number(file.size ?? 0), 0) },
    budgetLimit: { ...limits, deadlineMs: 30000, fileBytes: 1024 * 1024 * 1024 }, node: process.versions.node, elapsedMs: Math.round(elapsedMs * 100) / 100 }));
  assert.ok(snapshot.usage.scanRows <= limits.scanRows);
  assert.ok(snapshot.usage.scanBytes <= limits.scanBytes);
});

// Closed inventory mechanically extracted from the reviewed revision-3 DDL,
// including its four table-template expansions. No installed safety DDL runs.
const safetyObjects = [
  [
    "table",
    "content_safety_control"
  ],
  [
    "table",
    "content_identity_reservations"
  ],
  [
    "table",
    "owner_suppression_epochs"
  ],
  [
    "table",
    "content_suppressions"
  ],
  [
    "index",
    "content_suppression_target"
  ],
  [
    "index",
    "content_suppression_window"
  ],
  [
    "index",
    "content_suppression_cleanup"
  ],
  [
    "trigger",
    "safety_control_insert"
  ],
  [
    "trigger",
    "safety_control_delete"
  ],
  [
    "trigger",
    "safety_control_update"
  ],
  [
    "trigger",
    "safety_reservation_insert"
  ],
  [
    "trigger",
    "safety_reservation_update"
  ],
  [
    "trigger",
    "safety_reservation_delete"
  ],
  [
    "trigger",
    "safety_epoch_insert"
  ],
  [
    "trigger",
    "safety_epoch_delete"
  ],
  [
    "trigger",
    "safety_epoch_update"
  ],
  [
    "trigger",
    "safety_suppression_insert"
  ],
  [
    "trigger",
    "safety_suppression_advance"
  ],
  [
    "trigger",
    "safety_suppression_delete"
  ],
  [
    "trigger",
    "safety_suppression_update"
  ],
  [
    "trigger",
    "safety_memories_insert"
  ],
  [
    "trigger",
    "safety_card_notes_insert"
  ],
  [
    "trigger",
    "safety_private_cards_insert"
  ],
  [
    "trigger",
    "safety_raw_conversations_insert"
  ],
  [
    "trigger",
    "safety_memories_identity"
  ],
  [
    "trigger",
    "safety_card_notes_identity"
  ],
  [
    "trigger",
    "safety_private_cards_identity"
  ],
  [
    "trigger",
    "safety_raw_conversations_identity"
  ],
  [
    "trigger",
    "safety_receipt_insert"
  ],
  [
    "trigger",
    "safety_receipt_identity"
  ],
  [
    "trigger",
    "safety_raw_message_insert"
  ],
  [
    "trigger",
    "safety_raw_message_identity"
  ],
  [
    "trigger",
    "safety_raw_part_insert"
  ],
  [
    "trigger",
    "safety_raw_part_identity"
  ],
  [
    "trigger",
    "safety_memory_terminal"
  ],
  [
    "trigger",
    "safety_note_terminal"
  ],
  [
    "trigger",
    "safety_card_terminal"
  ],
  [
    "trigger",
    "safety_card_suppression"
  ],
  [
    "table",
    "card_body_authorizations"
  ],
  [
    "table",
    "card_body_provenance"
  ],
  [
    "table",
    "card_body_sources"
  ],
  [
    "index",
    "card_body_source_erasure"
  ],
  [
    "index",
    "card_body_header_latest"
  ],
  [
    "index",
    "card_operations_owner_action"
  ],
  [
    "trigger",
    "safety_action_insert"
  ],
  [
    "trigger",
    "safety_action_update"
  ],
  [
    "trigger",
    "safety_action_delete"
  ],
  [
    "trigger",
    "safety_operation_insert"
  ],
  [
    "trigger",
    "safety_source_update"
  ],
  [
    "trigger",
    "safety_source_delete"
  ],
  [
    "trigger",
    "safety_source_insert"
  ],
  [
    "trigger",
    "safety_header_update"
  ],
  [
    "trigger",
    "safety_header_delete"
  ],
  [
    "trigger",
    "safety_header_insert"
  ],
  [
    "trigger",
    "safety_card_body_update"
  ]
];
test('R6 every revision-3 safety table, index and trigger refuses all legacy cells', async t => {
  for (const version of [18, 23, 33]) for (const [kind, name] of safetyObjects) {
    const f = fixture(t, version);
    if (kind === 'table') f.db.exec(`CREATE TABLE ${name}(synthetic TEXT)`);
    else if (kind === 'index') f.db.exec(`CREATE INDEX ${name} ON memories(id)`);
    else f.db.exec(`CREATE TRIGGER ${name} AFTER INSERT ON memories BEGIN SELECT 1; END`);
    f.close();
    assert.deepEqual(await preflightContentSafetyV1({ path: f.path }), refusal, `${version}:${kind}:${name}`);
  }
  t.diagnostic(`Checked ${safetyObjects.length} revision-3 objects under each of 3 legacy cells (${safetyObjects.length * 3} refusals).`);
});

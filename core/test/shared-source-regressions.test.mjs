import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { ns, ok, receipt, lineageHost, copySqliteFixture, quiescence } from '../testing/card-lineage-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { host as contextHost } from '../testing/context-read-core-fixture.mjs';
import { migrateCardLineage, migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { receiptDenialTokens, receiptDeliverySnapshot, deliveryReceiptRows, receiptReadSafety, contentReadSafety } from '../content-safety.mjs';
import { readTransaction, transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { model as episodeModel, input as episodeInput } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { survivor, forgotten, message, ordinaryKinds, source, fixture, capture, act, noLeak, hasId,
  scripted, markers, memoryRef, trace, key, isLookup } from '../testing/shared-source-fixture.mjs';

const error = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
const refs = memory => [{ memoryId: memory.id, revision: memory.revision }];

const recentId = index => 'r' + String(index).padStart(4, '0');
const recentTime = index => new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString();
const tieTime = '2026-01-02T00:00:00.000Z';
const deliveryKey = memory => JSON.stringify([ns.ownerId, ns.scope, ns.projectId ?? '', memory.id]);
async function recentFixture(t, count, time) {
  const f = await fixture(t, 'fresh-default');
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-recent-seed')] })).memory;
  // Explicit ids and times make the expected lists independent of UUIDs,
  // insertion order, wall clock and the production order implementation.
  transaction(f.db, () => {
    f.db.prepare('DELETE FROM receipts WHERE memory_id=?').run(memory.id);
    const insert = f.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?)');
    for (let index = count - 1; index >= 0; index--) {
      const row = receipt('synthetic-recent-' + index, 'Synthetic recent support ' + index);
      insert.run(recentId(index), memory.id, key(row), row.client, row.sessionId, row.eventId, row.role, row.excerpt, time(index));
    }
  });
  return { ...f, memory };
}

// limit=4 gives a chunk of 36. The large cases also exceed the hard chunk
// maximum; a single timestamp must never become a whole-Memory sorting input.
for (const [count, distinct, tied] of [
  [0, [], []],
  [1, [0], [0]],
  [35, [34, 33, 32, 31], [0, 1, 2, 3]],
  [36, [35, 34, 33, 32], [0, 1, 2, 3]],
  [37, [36, 35, 34, 33], [0, 1, 2, 3]],
  [3000, [2999, 2998, 2997, 2996], [0, 1, 2, 3]],
]) for (const ties of [false, true])
test(`recent delivery preserves explicit order and coverage at ${count} receipts, ties=${ties}`, { timeout: 15000 }, async t => {
  const f = await recentFixture(t, count, ties ? () => tieTime : recentTime);
  const expected = (ties ? tied : distinct).map(recentId);
  for (const includeRecent of [false, true]) {
    const memo = receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: f.memory.id }], undefined, [],
      { limit: 4, recent: !includeRecent, includeRecent });
    const stamp = deliveryKey(f.memory) + (includeRecent ? ':recent' : '');
    assert.deepEqual(memo.deliveryHeaders.get(stamp).map(row => row.id), expected);
    assert.deepEqual(memo.deliveryHeaders.get(stamp).map(row => row.position), expected.map((_, i) => i + 1));
    assert.deepEqual(memo.deliveryMemoryStates.get(stamp), { total: count, complete: count < 4, after: undefined, recent: true });
    assert.deepEqual(deliveryReceiptRows(f.db, ns, f.memory.id, memo, { recent: true, limit: 4 }).map(row => row.id), expected);
  }
  const runtime = createMemoryRuntime({ path: f.path }); t.after(() => runtime.close());
  assert.deepEqual(runtime.recentReceipts(ns, { memoryId: f.memory.id, revision: f.memory.revision }, 4).map(row => row.id), expected);
  const page = ok(f.core.get({ namespace: ns, memoryId: f.memory.id, receiptLimit: 4 }));
  assert.equal(page.memory.receiptCount, count);
  assert.equal(page.exhausted, count <= 4);
  assert.equal(page.nextReceiptCursor === null, count <= 4);
});

test('recent delivery statement count is independent of timestamps and selected Memories', { timeout: 15000 }, async t => {
  for (const [count, time] of [[1, recentTime], [60, recentTime], [60, () => tieTime]]) {
    const f = await recentFixture(t, count, time);
    const sibling = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic recent sibling', kind: 'fact' },
      receipts: [receipt('synthetic-recent-sibling')] })).memory;
    const measured = await trace(() => receiptDeliverySnapshot(f.db,
      [f.memory, sibling].map(memory => ({ namespace: ns, memoryId: memory.id })), undefined, [],
      { recent: true, limit: 64, positions: false, totals: false }));
    assert.equal(measured.result.deliveryHeaders.get(deliveryKey(f.memory)).length, count);
    assert.equal(measured.result.deliveryHeaders.get(deliveryKey(sibling)).length, 1);
    assert.equal(measured.rows.length, 3, 'one anchor union, one recent chunk for both Memories, one marker union');
    const headers = measured.rows.filter(row => row.sql.startsWith('SELECT j.value AS input,r.id'));
    assert.equal(headers.length, 1);
    assert.equal(headers[0].args[1], 96);
    assert.equal(JSON.parse(headers[0].args[0]).length, 2);
    assert.equal(measured.rows.filter(isLookup).length, 1);
    assert.equal(measured.rows.some(row => /r\.excerpt|r\.\*/.test(row.sql)), false, 'header delivery reads no receipt text');
  }
});

test('a tie larger than a recent chunk pages without loss or duplication', { timeout: 15000 }, async t => {
  const f = await recentFixture(t, 73, () => tieTime);
  const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
    19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38,
    39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
    59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72].map(recentId);
  let after;
  const actual = [];
  for (let offset = 0; offset < expected.length; offset += 4) {
    const memo = receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: f.memory.id }], undefined, [],
      { recent: true, limit: 4, after });
    const headers = memo.deliveryHeaders.get(deliveryKey(f.memory)), state = memo.deliveryMemoryStates.get(deliveryKey(f.memory));
    assert.deepEqual(headers.map(row => row.id), expected.slice(offset, offset + 4));
    assert.equal(state.total, 73);
    assert.equal(state.complete, offset === 72);
    assert.deepEqual(state.after, after);
    actual.push(...headers.map(row => row.id));
    after = { createdAt: headers.at(-1).created_at, id: headers.at(-1).id };
  }
  assert.deepEqual(actual, expected);
  assert.equal(new Set(actual).size, 73);
  // The uncapped order agrees with all of those individually resumed pages.
  const memo = receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: f.memory.id }], undefined, [],
    { recent: true, limit: Number.MAX_SAFE_INTEGER });
  assert.deepEqual(memo.deliveryHeaders.get(deliveryKey(f.memory)).map(row => row.id), expected);
});

for (const [count, passes] of [[255, 1], [256, 2], [257, 2], [513, 3]]) for (const ties of [false, true])
test(`uncapped recent delivery keeps bounded chunks and one marker union at ${count}, ties=${ties}`, { timeout: 15000 }, async t => {
  const f = await recentFixture(t, count, ties ? () => tieTime : recentTime);
  // Exact expected lists: r0000 through r(count-1) ascending for the single
  // tie, and r(count-1) through r0000 descending for distinct times. Neither
  // list uses SQL or a production comparator to obtain its expected order.
  const expected = Array.from({ length: count }, (_, index) => recentId(ties ? index : count - index - 1));
  const measured = await trace(() => receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: f.memory.id }], undefined, [],
    { recent: true, limit: Number.MAX_SAFE_INTEGER, positions: false, totals: false }));
  assert.deepEqual(measured.result.deliveryHeaders.get(deliveryKey(f.memory)).map(row => row.id), expected);
  const chunks = measured.rows.filter(row => row.sql.startsWith('SELECT j.value AS input,r.id'));
  assert.equal(chunks.length, passes);
  assert.deepEqual(chunks.map(row => row.args[1]), Array(passes).fill(256));
  assert.equal(measured.rows.filter(isLookup).length, 1, 'uncapped chunks retain the existing deferred marker union');
  assert.deepEqual(measured.result.deliveryMemoryStates.get(deliveryKey(f.memory)), { total: count, complete: true, after: undefined, recent: true });
});

test('recent refills skip interleaved denials across a tie and older timestamps before reading text', { timeout: 15000 }, async t => {
  const f = await recentFixture(t, 73, i => i < 37 ? tieTime : recentTime(73 - i));
  const survivors = [1, 17, 37, 40, 72].map(recentId);
  const denied = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(f.memory.id).filter(row => !survivors.includes(row.id));
  for (const token of receiptDenialTokens(denied)) f.db.prepare('INSERT OR IGNORE INTO suppressed VALUES(?,?,?,?)')
    .run(ns.ownerId, ns.scope, ns.projectId, token);
  const measured = await trace(() => {
    const memo = receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: f.memory.id }], undefined, [], { recent: true, limit: 4 });
    return { memo, rows: deliveryReceiptRows(f.db, ns, f.memory.id, memo, { recent: true, limit: 4 }) };
  });
  assert.deepEqual(measured.result.rows.map(row => row.id), [1, 17, 37, 40].map(recentId));
  assert.equal(measured.rows.filter(row => row.sql.startsWith('SELECT j.value AS input,r.id')).length, 2);
  assert.equal(measured.rows.filter(isLookup).length, 2, 'one batched marker lookup per pass');
  const textReads = measured.rows.filter(row => row.sql.startsWith('SELECT r.rowid AS cursor_row,r.*'));
  assert.equal(textReads.length, 1);
  assert.deepEqual(JSON.parse(textReads[0].args[0]), [1, 17, 37, 40].map(recentId));
  assert.ok(measured.rows.lastIndexOf(measured.rows.filter(isLookup).at(-1)) < measured.rows.indexOf(textReads[0]));
  const state = measured.result.memo.deliveryMemoryStates.get(deliveryKey(f.memory));
  assert.equal(state.total, 73); assert.equal(state.complete, false);
  const after = { createdAt: recentTime(33), id: recentId(40) };
  const last = receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: f.memory.id }], undefined, [], { recent: true, limit: 4, after });
  assert.deepEqual(last.deliveryHeaders.get(deliveryKey(f.memory)).map(row => row.id), [recentId(72)]);
  assert.deepEqual(last.deliveryMemoryStates.get(deliveryKey(f.memory)), { total: 73, complete: true, after, recent: true });
});

test('recent refills keep explicit page cuts when a chunk splits a mixed timestamp group', async t => {
  const f = await recentFixture(t, 41, i => i < 2 ? recentTime(90000 - i) : i < 40 ? tieTime : recentTime(0));
  const kept = [1, 34, 36, 37, 39, 40].map(recentId);
  const stored = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(f.memory.id);
  for (const row of stored.filter(row => !kept.includes(row.id))) {
    // Each refusal is independently forced by just one of the two tokens.
    const token = receiptDenialTokens([row])[Number(row.id.slice(1)) % 2];
    f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, token);
  }
  const first = await trace(() => receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: f.memory.id }],
    undefined, [], { recent: true, limit: 4 }));
  const headers = first.result.deliveryHeaders.get(deliveryKey(f.memory));
  assert.deepEqual(headers.map(row => row.id), [1, 34, 36, 37].map(recentId));
  assert.deepEqual(headers.map(row => row.position), [2, 35, 37, 38]);
  assert.equal(first.rows.filter(row => row.sql.includes('WITH RECURSIVE recent_keys(cursor)')).length, 2);
  const checked = first.rows.filter(isLookup).flatMap(row => JSON.parse(row.args[0])
    .map(value => Array.isArray(value) ? value[3] : value));
  assert.deepEqual([...new Set(checked)].sort(), receiptDenialTokens(stored).sort(), 'both tokens of every visited header');
  const after = { createdAt: tieTime, id: recentId(37) };
  const second = receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: f.memory.id }], undefined, [],
    { recent: true, limit: 4, after, offset: 38 });
  assert.deepEqual(second.deliveryHeaders.get(deliveryKey(f.memory)).map(row => row.id), [39, 40].map(recentId));
  assert.deepEqual(second.deliveryHeaders.get(deliveryKey(f.memory)).map(row => row.position), [40, 41]);
  assert.deepEqual(second.deliveryMemoryStates.get(deliveryKey(f.memory)), { total: 41, complete: true, after, recent: true });
});

test('distinct-time recent continuation has explicit expected pages', async t => {
  const f = await recentFixture(t, 12, recentTime);
  let after;
  for (const page of [[11, 10, 9, 8], [7, 6, 5, 4], [3, 2, 1, 0], []]) {
    const memo = receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: f.memory.id }], undefined, [],
      { recent: true, limit: 4, after });
    const headers = memo.deliveryHeaders.get(deliveryKey(f.memory));
    assert.deepEqual(headers.map(row => row.id), page.map(recentId));
    if (headers.length) after = { createdAt: headers.at(-1).created_at, id: headers.at(-1).id };
  }
});

// Recognize both the candidate's timestamp walk and the new bounded statement.
const isRecentStatement = row => row.sql.includes('WITH RECURSIVE recent_keys(cursor)') ||
  row.sql.startsWith('SELECT r.created_at AS time FROM memories') ||
  row.sql.startsWith('SELECT r.id,r.memory_id,r.receipt_key,') && row.sql.includes('AND r.created_at=? AND r.id>?');

for (const ties of [false, true]) test(`uncapped recall reads no recent projection, ties=${ties}`, async t => {
  const f = await recentFixture(t, 12, ties ? () => tieTime : recentTime);
  f.model.countTokens = () => 1;
  let sent;
  const rank = f.model.rank;
  f.model.rank = request => { sent = structuredClone(request.input); return rank(request); };
  const before = ok(f.core.get({ namespace: ns, memoryId: f.memory.id }));
  const measured = await trace(() => f.core.recall({ readSet: [ns], query: survivor }));
  const result = ok(measured.result);
  assert.equal(measured.rows.filter(isRecentStatement).length, 0, 'uncapped packing and finalization request no recent headers');
  assert.equal(result.memories.length, 1);
  const expected = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(recentId);
  assert.deepEqual(sent.candidates[0].receipts.map(row => row.id), expected);
  assert.deepEqual(result.memories[0].receipts.map(row => row.id), expected);
  assert.deepEqual(result.memories[0].receipts, before.receipts);
  assert.equal(result.memories[0].receiptCount, 12);
  assert.equal(Object.hasOwn(result.memories[0], 'receiptsOmitted'), false);
  assert.equal(Object.hasOwn(result, 'recallTruncated'), false);
  assert.equal(result.coverage, 'complete');
  const texts = measured.rows.filter(row => row.sql.startsWith('SELECT r.rowid AS cursor_row,r.*'));
  assert.equal(texts.length, 2, 'one forward text read in preparation and one in the final proof');
});

async function cappedRecallFixture(t) {
  const f = await recentFixture(t, 12, i => i >= 8 ? tieTime : recentTime(i));
  const shared = receipt('synthetic-recent-11', 'Synthetic recent support 11');
  const sibling = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic recent forgotten sibling', kind: 'fact' },
    receipts: [shared] })).memory;
  const independent = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic recent independent', kind: 'fact' },
    receipts: [receipt('synthetic-recent-independent')] })).memory;
  const erased = f.db.prepare('SELECT id FROM receipts WHERE memory_id IN (?,?) AND event_id=?')
    .all(f.memory.id, sibling.id, shared.eventId).map(row => row.id);
  // A deterministic counter gives rank room for exactly six receipt identities:
  // five from the crowded candidate and the independent candidate's single one.
  f.model.countTokens = text => {
    let input;
    try { input = JSON.parse(text).input; } catch { return 1; }
    return input?.candidates ? input.candidates.reduce((sum, candidate) => sum + candidate.receipts.length * 1000, 0) : 1;
  };
  return { ...f, sibling, independent, erased, shared };
}

test('capped recall requests only that candidate in recent order and skips a forgotten sibling', async t => {
  const f = await cappedRecallFixture(t);
  ok(f.core.forget({ namespace: ns, memoryId: f.sibling.id, expectedRevision: f.sibling.revision }));
  let sent;
  const rank = f.model.rank;
  f.model.rank = request => { sent = structuredClone(request.input); return rank(request); };
  const measured = await trace(() => f.core.recall({ readSet: [ns], query: 'Synthetic recent', limit: 2 }));
  const result = ok(measured.result);
  const recent = measured.rows.filter(isRecentStatement);
  assert.equal(recent.length, 2, 'one lazy request and one final proof, independent of timestamps');
  for (const row of recent) {
    assert.deepEqual(JSON.parse(row.args[0]).map(job => job.id), [f.memory.id], 'no recent job for the uncapped candidate');
    assert.match(row.sql, /LIMIT CAST\(\? AS INTEGER\)/);
    const index = measured.rows.indexOf(row);
    const text = measured.rows.findIndex((next, position) => position > index && next.snapshot === row.snapshot &&
      next.sql.startsWith('SELECT r.rowid AS cursor_row,r.*') && next.args.at(-1) === f.memory.id);
    assert.ok(text > index);
    assert.ok(measured.rows.slice(index + 1, text).some(isLookup), 'marker lookup precedes recent text in each transaction');
  }
  assert.equal(result.memories.length, 2);
  const returned = result.memories.find(item => item.memory.id === f.memory.id);
  const expected = [8, 9, 10, 7, 6].map(recentId);
  assert.deepEqual(returned.receipts.map(row => row.id), expected);
  assert.deepEqual(sent.candidates.find(item => item.memory.id === f.memory.id).receipts, returned.receipts);
  assert.equal(returned.receiptCount, 12);
  assert.equal(returned.receiptsOmitted, 7);
  const independent = result.memories.find(item => item.memory.id === f.independent.id);
  assert.equal(independent.receipts.length, 1);
  assert.equal(Object.hasOwn(independent, 'receiptsOmitted'), false);
  assert.deepEqual(result.recallTruncated, { navigationItemsOmitted: 0, candidatesOmitted: 0,
    candidatesShortened: 0, receiptListsCapped: 1 });
  assert.equal(result.coverage, 'budget_exhausted');
  absent({ result, sent }, [f.shared.excerpt, f.sibling.content, ...f.erased]);
});

for (const change of ['forget', 'correct']) test(`lazy recent read observes ${change} after preparation`, async t => {
  const f = await cappedRecallFixture(t);
  const runtime = createMemoryRuntime({ path: f.path }); t.after(() => runtime.close());
  const ref = { namespace: ns, memoryId: f.memory.id, revision: f.memory.revision };
  const prepared = await trace(() => runtime.recallSnapshot([ref], null));
  assert.equal(prepared.rows.filter(isRecentStatement).length, 0);
  if (change === 'correct') {
    ok(f.core.correct({ namespace: ns, memoryId: f.memory.id, expectedRevision: f.memory.revision,
      content: 'Synthetic corrected recent memory', kind: 'fact', receipt: receipt('synthetic-recent-correction') }));
    const measured = await trace(() => {
      assert.throws(() => prepared.result.recentReceipts(ns, ref, 5), error => error.code === 'revision_conflict');
    });
    assert.equal(measured.rows.filter(isRecentStatement).length, 0, 'revision checked before recent headers or text');
    assert.equal(measured.rows.some(row => row.sql.startsWith('SELECT r.rowid AS cursor_row,r.*')), false);
  } else {
    ok(f.core.forget({ namespace: ns, memoryId: f.sibling.id, expectedRevision: f.sibling.revision }));
    const measured = await trace(() => prepared.result.recentReceipts(ns, ref, 5));
    assert.equal(measured.rows.filter(isRecentStatement).length, 1);
    assert.deepEqual(measured.result.map(row => row.id), [8, 9, 10, 7, 6].map(recentId));
    absent({ recent: measured.result }, [f.shared.excerpt, ...f.erased]);
    const final = runtime.recallSnapshot([{ ...ref, receiptOrder: 'recent', receiptLimit: 5 }], [0]);
    assert.deepEqual(final[0].receipts, measured.result, 'the final proof revalidates the post-change delivery');
  }
});

test('final recall proof refuses a correction after the lazy recent read', async t => {
  const f = await cappedRecallFixture(t);
  ok(f.core.forget({ namespace: ns, memoryId: f.sibling.id, expectedRevision: f.sibling.revision }));
  const rank = f.model.rank;
  let ranked = false;
  f.model.rank = request => {
    ranked = true;
    assert.deepEqual(request.input.candidates.find(item => item.memory.id === f.memory.id).receipts.map(row => row.id),
      [8, 9, 10, 7, 6].map(recentId));
    ok(f.core.correct({ namespace: ns, memoryId: f.memory.id, expectedRevision: f.memory.revision,
      content: 'Synthetic corrected after rank', kind: 'fact', receipt: receipt('synthetic-after-rank') }));
    return rank(request);
  };
  const measured = await trace(() => f.core.recall({ readSet: [ns], query: 'Synthetic recent', limit: 2 }));
  assert.equal(ranked, true);
  assert.equal(measured.result.ok, false);
  assert.ok(['revision_conflict', 'index_revision_conflict', 'evidence_unavailable'].includes(measured.result.error.code));
  absent({ result: measured.result }, ['Synthetic recent support', ...f.erased]);
});

for (const contextMode of ['source-evidence', 'rationale-evidence'])
test(`${contextMode} recall resolves provenance only in its two fetched-source snapshots`, { timeout: 15000 }, async t => {
  const f = await correctionFixture(t, { base: 33, mode: 'safety' });
  for (let i = 0; i < 12; i++) ok(f.core.admit({ namespace: ns,
    memory: { content: 'Synthetic provenance reuse ' + i, kind: 'fact' }, receipts: [receipt('provenance-reuse-' + i)] }));
  f.model.select = ({ input }) => ({ refs: input.maps.flatMap(page => page.items.filter(item => item.type === 'unfiled')
    .map(item => ({ namespaceIndex: page.namespaceIndex, ...item.ref }))).slice(0, 6) });
  const measured = await trace(() => f.core.recall({ readSet: [ns], query: 'Synthetic', limit: 6, contextMode }));
  assert.equal(ok(measured.result).memories.length, 6);
  assert.equal(measured.result.value.coverage, 'complete');
  // Rationale retains the base's independent stored-source validation per root.
  const validationsPerMemory = contextMode === 'rationale-evidence' ? 4 : 2;
  const probePasses = contextMode === 'rationale-evidence' ? 14 : 2;
  for (const fragment of ['FROM raw_receipt_lineage l LEFT JOIN raw_conversations',
    'SELECT kind FROM raw_receipt_origins WHERE receipt_id=?',
    'SELECT 1 FROM episode_memory_links WHERE memory_id=? LIMIT 1']) {
    const rows = measured.rows.filter(row => row.sql.includes(fragment));
    assert.equal(rows.length, 6 * validationsPerMemory, fragment + ': no extra discovery validation');
    assert.equal(new Set(rows.map(row => row.snapshot)).size, 2, 'discovery reuses its canonical absence proof');
    const counts = new Map();
    for (const row of rows) counts.set(row.args[0], (counts.get(row.args[0]) ?? 0) + 1);
    assert.equal(counts.size, 6);
    assert.deepEqual([...counts.values()], Array(6).fill(validationsPerMemory));
  }
  for (const sql of ["SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'",
    "SELECT 1 FROM sqlite_master WHERE name='raw_job_sources'",
    "SELECT 1 FROM sqlite_master WHERE name='raw_session_fences'"])
    assert.equal(measured.rows.filter(row => row.sql === sql).length, probePasses, sql);
  assert.equal(measured.rows.filter(row => row.sql.startsWith("SELECT name FROM sqlite_master WHERE type='table' AND name IN (")).length, probePasses);
  assert.equal(measured.rows.filter(row => row.sql.startsWith('SELECT 1 FROM raw_conversations WHERE')).length, probePasses);
  assert.equal(measured.rows.filter(row => row.sql === 'SELECT secret FROM episode_identity WHERE singleton=1').length, 2 * probePasses);
  assert.equal(measured.rows.filter(row => row.sql.startsWith('SELECT 1 FROM raw_session_fences WHERE')).length, 2 * probePasses);
});

test('a receipt denial survives a warm canonical absence proof', { timeout: 15000 }, async t => {
  const f = await correctionFixture(t, { base: 33, mode: 'safety' });
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic denied provenance', kind: 'fact' },
    receipts: [receipt('denied-provenance')] })).memory;
  const stored = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
  transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: 'receipt', key: stored.id,
    reason: 'purge', actionId: 'synthetic-denied-provenance' }));
  readTransaction(f.db, () => {
    const memo = receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: memory.id }]);
    const [row] = deliveryReceiptRows(f.db, ns, memory.id, memo, { idOrder: true });
    assert.equal(row.empty_raw_ancestry, 1);
    const options = { namespace: ns, receipt: row, memo, rawAncestryEmpty: true };
    assert.deepEqual(receiptReadSafety(f.db, options), { allowed: false, reason: 'purge' });
    assert.deepEqual(receiptReadSafety(f.db, options), { allowed: false, reason: 'purge' });
    assert.deepEqual(contentReadSafety(f.db, { namespace: ns, intent: 'history', memo,
      ref: { type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }, receipts: [stored] }),
    { allowed: false, reason: 'purge' });
  });
});

test('a write between warm source reads on the same core connection is observed', { timeout: 15000 }, async t => {
  const f = await fixture(t, 'ordinary-48'), [b, a] = await capture(f);
  for (const contextMode of ['source-evidence', 'rationale-evidence']) for (let repeat = 0; repeat < 2; repeat++)
    assert.equal(ok(f.core.fetch({ namespace: ns, refs: refs(b), contextMode })).items[0].receipts.length, 1);
  ok(act(f, 'forget', a));
  for (const contextMode of ['source-evidence', 'rationale-evidence']) {
    const result = f.core.fetch({ namespace: ns, refs: refs(b), contextMode });
    error(result, 'source_unavailable'); noLeak(result, 'post-write source read');
  }
});

for (const kind of ordinaryKinds) test(`ordinary shared capture refuses incomplete source evidence on ${kind}`, { timeout: 15000 }, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  const denied = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].id;
  if (f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_conversations'").get())
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
  ok(act(f, 'forget', a));
  f.model.countTokens = () => 1;
  const plain = ok(f.core.fetch({ namespace: ns, refs: refs(b) }));
  assert.equal(plain.items[0].memory.id, b.id);
  assert.deepEqual(plain.items[0].receipts, []);
  const values = [f.core.fetch({ namespace: ns, refs: refs(b), contextMode: 'source-evidence' }),
    f.core.sourceSnapshot({ readSet: [ns], limit: 12 }),
    await f.core.recall({ readSet: [ns], query: survivor, contextMode: 'source-evidence' }),
    await f.core.recall({ readSet: [ns], query: survivor, contextMode: 'rationale-evidence' })];
  for (const [index, value] of values.entries()) {
    if (index === 1) {
      assert.equal(value.ok, false);
      assert.equal(JSON.stringify(value).includes('complete-current-admitted'), false);
    } else error(value, 'source_unavailable');
    noLeak(value, 'unavailable source response');
    assert.equal(hasId(value, denied), false);
  }
});

test('empty qualified rank validates every fetched source and keeps clean complete coverage', { timeout: 15000 }, async t => {
  for (const corrupt of [false, true]) {
    const f = await fixture(t, 'fresh-default');
    const text = 'Synthetic qualified reading choice';
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: text, kind: 'preference' },
      receipts: [receipt('synthetic-regression-qualification', text)], qualification: { version: 1,
        slot: { subject: 'Synthetic user', property: 'format', scope: null, applies: null },
        value: 'lists', attribution: 'direct', commitment: 'considered', anchors: [{ receiptIndex: 0,
          start: 0, end: text.length, text, fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] } })).memory;
    let ranked = false;
    f.model.countTokens = () => 1;
    f.model.rank = () => {
      ranked = true;
      if (corrupt) f.db.prepare("UPDATE receipts SET excerpt='Synthetic corrupt source' WHERE memory_id=?").run(memory.id);
      return { refs: [] };
    };
    const result = await f.core.recall({ readSet: [ns], query: text, includeQualification: true });
    assert.equal(ranked, true);
    if (corrupt) error(result, 'storage_error');
    else {
      const value = ok(result);
      assert.deepEqual(value.memories, []);
      assert.equal(value.coverage, 'complete');
    }
  }
});

test('legacy forgetting preserves shared withholding', { timeout: 15000 }, async t => {
  const f = await fixture(t, 'ordinary-53'), [b, a] = await capture(f);
  const denied = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].id;
  const store = openMemoryStore({ path: f.path }); t.after(() => store.close());
  const scope = store.scope({ ownerId: ns.ownerId, projectId: ns.projectId });
  assert.equal(scope.forget(a.id, a.revision), true);
  for (const value of [scope.get(b.id), ok(f.core.get({ namespace: ns, memoryId: b.id }))]) {
    assert.equal(value.id ?? value.memory.id, b.id);
    assert.deepEqual(value.receipts, []);
    noLeak(value, 'legacy sibling');
    assert.equal(hasId(value, denied), false);
  }
});

test('Episode deletion forgets its purged Memory and removes shared wording from an independently supported sibling', { timeout: 15000 }, async t => {
  const f = await fixture(t, 'ordinary-53');
  const episode = openMemoryCore({ path: f.path, privateCards: f.host.options, ...episodeOptions,
    model: episodeModel({ extract: () => ({ items: [survivor, forgotten].map(content =>
      ({ content, kind: 'fact', confidence: .8, sourceIndices: [0] })) }) }) });
  t.after(() => episode.close());
  const captured = ok(await episode.capture(episodeInput(1, 'synthetic-session', { namespace: ns,
    messages: [{ id: 'synthetic-message', role: 'user', content: message }] })));
  const [b, a] = captured.admission.memories;
  const supported = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-regression-independent', 'Synthetic independent surviving support')] })).memory;
  assert.equal(supported.id, b.id);
  const denied = ok(f.core.get({ namespace: ns, memoryId: supported.id })).receipts.find(row => row.excerpt === message).id;
  const episodeId = captured.episode.id;
  const revision = f.db.prepare('SELECT revision FROM session_episodes WHERE id=?').get(episodeId).revision;
  assert.equal(ok(episode.forgetEpisode({ namespace: ns, episodeId, expectedRevision: revision })).forgotten, true);
  assert.equal(f.core.get({ namespace: ns, memoryId: a.id }).error?.code, 'memory_not_found');
  const value = ok(f.core.get({ namespace: ns, memoryId: b.id }));
  assert.equal(value.memory.content, survivor);
  assert.deepEqual(value.receipts.map(row => row.excerpt), ['Synthetic independent surviving support']);
  noLeak(value, 'Episode deletion sibling');
  assert.equal(hasId(value, denied), false);
});

// Cover each legacy cell, each suppression family, and the independently
// attested receipt-time/Card-lineage feature combinations.
const layouts = [18, 23, 33].flatMap(base => ['old', 'safety', 'event',
  ...(base === 18 ? [] : ['lineage', 'lineage-event'])].map(mode => ({ base, mode })));
const label = layout => `${layout.base}/${layout.mode}`;
async function correctionFixture(t, { base, mode }) {
  const f = safetyFixture(t, base);
  if (mode === 'safety') await f.migrate();
  if (mode === 'event' || mode === 'lineage-event') {
    copySqliteFixture(f.path, f.backupPath);
    await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base }, quiescence });
  }
  if (mode === 'lineage' || mode === 'lineage-event') {
    const before = f.connect();
    const domain = mode === 'lineage-event' ? before.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain : undefined;
    before.close();
    copySqliteFixture(f.path, f.backupPath);
    await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base, ...(domain ? { suppressionDomain: domain } : {}) }, quiescence });
  }
  const host = base === 18 ? null : lineageHost(), trusted = contextHost(), model = scripted('forget');
  model.countTokens = () => 1;
  const config = { path: f.path, model, decisionReview: 'required-v1', ...(host ? { privateCards: host.options } : {}) };
  const core = openMemoryCore(config), db = f.connect(), store = openMemoryStore({ path: f.path });
  const context = openMemoryCore({ ...config, contextRead: { version: 'context-read-v1', authority: trusted.authority,
    counter: { id: 'synthetic', countTokens: () => 1 } } });
  t.after(() => { context.close(); store.close(); db.close(); core.close(); });
  return { ...f, core, db, context, trusted, host, model, config,
    call: host && ((method, input) => host.call(core, method, input)),
    scope: store.scope({ ownerId: ns.ownerId, projectId: ns.projectId }) };
}
const obsolete = 'Synthetic obsolete interpretation';
const corrected = 'Synthetic current interpretation';
const newExcerpt = 'Synthetic current receipt support';
function absent(values, denied) {
  for (const [name, value] of Object.entries(values)) for (const text of denied)
    assert.equal(JSON.stringify(value).includes(text), false, name + ' withholds ' + text);
}
async function currentReads(f, memory) {
  const input = { namespace: ns, refs: refs(memory) };
  const values = {
    get: ok(f.core.get({ namespace: ns, memoryId: memory.id })),
    fetch: ok(f.core.fetch(input)), sourceFetch: ok(f.core.fetch({ ...input, contextMode: 'source-evidence' })),
    recall: ok(await f.core.recall({ readSet: [ns], query: 'Synthetic', limit: 8 })),
    sourceRecall: ok(await f.core.recall({ readSet: [ns], query: 'Synthetic', limit: 8, contextMode: 'source-evidence' })),
    rationaleRecall: ok(await f.core.recall({ readSet: [ns], query: 'Synthetic', limit: 8, contextMode: 'rationale-evidence' })),
    snapshot: ok(f.core.sourceSnapshot({ readSet: [ns], limit: 12 })),
    list: ok(f.core.list({ namespace: ns, limit: 20 })), map: ok(f.core.map({ namespace: ns, purpose: 'recall' })),
    legacyGet: f.scope.get(memory.id), legacyList: f.scope.list(), legacySearch: f.scope.search('Synthetic'),
    contextEvidence: ok(await f.trusted.call(f.context, 'fetchCandidateEvidence',
      { readSet: [ns], intent: 'current', refs: [memoryRef(memory)] })),
    contextRead: ok(await f.trusted.call(f.context, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current',
      query: 'Synthetic', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } })),
    session: ok(f.core.sessionStartContext({ namespace: ns, groups: { nextSteps: true, procedural: false, background: true },
      maxTokens: 2000, maxChars: 8000 })),
  };
  for (const name of ['get', 'fetch', 'sourceFetch', 'recall', 'sourceRecall', 'rationaleRecall', 'snapshot',
    'legacyGet', 'contextEvidence', 'contextRead', 'session']) assert.ok(hasId(values[name], memory.id), name + ' includes current Memory');
  if (f.call) {
    values.cardEvidence = ok(await f.call('fetchEvidence', { intent: 'current', refs: [memoryRef(memory)] }));
    values.cardSelection = ok(await f.call('selectEvidence', { intent: 'current', query: 'Synthetic', types: ['memory'], limit: 24 }));
    values.cardSources = await Promise.all(values.cardEvidence.items[0].provenance.sources.map(source =>
      Promise.resolve(f.call('getSource', { source })).then(ok)));
  }
  return values;
}

// The unedited compatibility worker fixes clock/identities and hashes the
// complete result, receipts, schema and database rows against the base captures.
for (const mode of ['old', 'safety', 'event']) test(`identical recites match complete frozen base results and databases: ${mode}`,
  { timeout: 180000 }, t => {
    const workspace = createTestWorkspace(t, { prefix: 'shared-source-recite-parity-' });
    const report = join(workspace.path, 'result.json');
    const worker = fileURLToPath(new URL('./fixtures/receipt-event-time-main-worker.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [worker, fileURLToPath(new URL('../../', import.meta.url)),
      workspace.path, report, mode, '-', 'receipts'], { encoding: 'utf8', timeout: 170000 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 0, child.stderr);
    const actual = JSON.parse(readFileSync(report, 'utf8'));
    const expected = JSON.parse(readFileSync(new URL('./fixtures/receipt-event-time-main' +
      (mode === 'old' ? '' : '-' + mode) + '.json', import.meta.url), 'utf8'));
    for (const base of [18, 23, 33]) for (const api of ['correct', 'legacyCorrect'])
      assert.deepEqual(actual.writes[`${base}:${api}`], expected.writes[`${base}:${api}`], `${base}:${api}`);
  });

for (const layout of layouts) for (const correction of ['identical', 'same-address']) for (const api of ['core', 'legacy'])
test(`${correction} correction delivers current receipts on every read path: ${label(layout)}, ${api}`, { timeout: 15000 }, async t => {
  const f = await correctionFixture(t, layout);
  // An unlinked Episode already records the new receipt's source. It keeps
  // its own interpretation while correction retires only the Memory revision.
  const port = episodeModel({ extract: () => ({ items: [] }), interpretEpisode: request => {
    const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: request.input.sources[0].text.length }] });
    return { type: field('work'), language: 'en', gist: field('Synthetic source activity'), outcome: null,
      nextStep: field('Synthetic next action'), disposition: null };
  } });
  const episode = openMemoryCore({ ...f.config, ...episodeOptions, model: port }); t.after(() => episode.close());
  const captured = ok(await episode.capture(episodeInput(1, 'synthetic-recite-session', { namespace: ns,
    messages: [{ id: 'synthetic-recite-message', role: 'user', content: newExcerpt }] })));
  const episodeId = captured.episode.id;
  const session = f.db.prepare('SELECT session_key FROM session_episodes WHERE id=?').get(episodeId).session_key;
  const replacement = { client: 'synthetic', sessionId: session, eventId: 'synthetic-recite-message', role: 'user', excerpt: newExcerpt };
  const previous = { ...replacement, excerpt: correction === 'identical' ? newExcerpt : 'Synthetic previous receipt support' };
  const a = ok(f.core.admit({ namespace: ns, memory: { content: obsolete, kind: 'fact' }, receipts: [previous] })).memory;
  const siblingReceipt = correction === 'identical' ? previous : { ...previous, excerpt: 'Synthetic alternate receipt support' };
  const b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [siblingReceipt] })).memory;
  const oldReceipt = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(a.id);
  const siblingId = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].id;
  const acknowledgement = api === 'core' ? ok(f.core.correct({ namespace: ns, memoryId: a.id, expectedRevision: a.revision,
    content: corrected, kind: 'fact', receipt: replacement })) : f.scope.correct(a.id, { content: corrected, kind: 'fact', receipt: replacement }, a.revision);
  const current = ok(f.core.get({ namespace: ns, memoryId: a.id }));
  assert.equal(current.memory.revision, a.revision + 1); assert.equal(current.memory.content, corrected);
  assert.deepEqual(current.receipts.map(row => row.excerpt), [newExcerpt]);
  assert.notEqual(current.receipts[0].id, oldReceipt.id, 're-cite replaces the receipt incarnation');
  assert.deepEqual(markers(f), correction === 'identical' ? [] : [receiptDenialTokens([oldReceipt])[0]]);
  const sibling = ok(f.core.get({ namespace: ns, memoryId: b.id }));
  assert.deepEqual(sibling.receipts.map(row => row.id), [siblingId], 'the specified sibling consequence remains visible');
  const values = await currentReads(f, current.memory);
  for (const name of ['get', 'fetch', 'sourceFetch', 'recall', 'sourceRecall', 'rationaleRecall', 'snapshot',
    'legacyGet', 'contextRead', 'session', ...(f.call ? ['cardSources'] : [])])
    assert.ok(JSON.stringify(values[name]).includes(newExcerpt), name + ' delivers the new receipt');
  // Candidate evidence returns source references, not excerpt text: the new receipt is its only source.
  const newReceiptId = values.get.receipts.find(row => row.excerpt === newExcerpt).id;
  const provenance = values.contextEvidence.items[0].provenance;
  assert.deepEqual(provenance.sources.map(source => source.receiptId), [newReceiptId], 'contextEvidence delivers the new receipt');
  assert.deepEqual(provenance.coverage, { status: 'complete', included: 1, omitted: 0 });
  values.episode = ok(f.core.getEpisode({ namespace: ns, episodeId, sourceLimit: 16, memoryLimit: 50 }));
  assert.deepEqual(values.episode.sources.items.map(row => row.text), [newExcerpt]);
  assert.ok(values.session.groups.nextSteps.items.some(item => item.episodeId === episodeId), 'session keeps the independent Episode source');
  values.acknowledgement = acknowledgement;
  values.staleFetch = f.core.fetch({ namespace: ns, refs: refs(a) });
  if (f.call) values.staleCard = await f.call('fetchEvidence', { intent: 'current', refs: [memoryRef(a)] });
  absent(values, [obsolete, oldReceipt.id]);
});

for (const layout of layouts) test(`different-address correction withholds a sibling's different excerpt: ${label(layout)}`,
  { timeout: 15000 }, async t => {
    const f = await correctionFixture(t, layout);
    const a = ok(f.core.admit({ namespace: ns, memory: { content: obsolete, kind: 'fact' }, receipts: [source('Synthetic original receipt')] })).memory;
    const b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [source('Synthetic alternate receipt')] })).memory;
    const old = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(a.id);
    const denied = ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].id;
    ok(f.core.correct({ namespace: ns, memoryId: a.id, expectedRevision: a.revision, content: corrected, kind: 'fact',
      receipt: receipt('synthetic-other-address', newExcerpt) }));
    assert.deepEqual(markers(f), receiptDenialTokens([old]).sort());
    const value = ok(f.core.get({ namespace: ns, memoryId: b.id }));
    assert.deepEqual(value.receipts, []); absent({ value }, ['Synthetic alternate receipt', denied]);
  });

for (const layout of layouts.filter(layout => layout.mode !== 'old')) for (const correction of ['identical', 'same-address'])
test(`prior forget denials survive ${correction} correction: ${label(layout)}`, { timeout: 15000 }, async t => {
  const f = await correctionFixture(t, layout);
  const episode = openMemoryCore({ ...f.config, ...episodeOptions, model: episodeModel({ extract: () => ({ items: [] }) }) });
  t.after(() => episode.close());
  const captured = ok(await episode.capture(episodeInput(1, 'synthetic-prior-forget', { namespace: ns,
    messages: [{ id: 'synthetic-prior-forget-message', role: 'user', content: 'Synthetic erased source wording' }] })));
  const episodeId = captured.episode.id;
  const session = f.db.prepare('SELECT session_key FROM session_episodes WHERE id=?').get(episodeId).session_key;
  const shared = { ...source('Synthetic erased source wording'), sessionId: session, eventId: 'synthetic-prior-forget-message' };
  assert.ok(JSON.stringify(ok(f.core.getEpisode({ namespace: ns, episodeId }))).includes(shared.excerpt));
  const a = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic erased interpretation', kind: 'fact' }, receipts: [shared] })).memory;
  const b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [shared] })).memory;
  const denied = f.db.prepare('SELECT id FROM receipts WHERE memory_id IN (?,?)').all(a.id, b.id).map(row => row.id);
  ok(f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  const before = markers(f);
  const acknowledgement = ok(f.core.correct({ namespace: ns, memoryId: b.id, expectedRevision: b.revision, content: corrected, kind: 'fact',
    receipt: correction === 'identical' ? shared : { ...shared, excerpt: newExcerpt } }));
  const current = acknowledgement.memory;
  assert.deepEqual(markers(f), before, 'correction never removes a prior forget marker');
  const values = {
    acknowledgement,
    get: ok(f.core.get({ namespace: ns, memoryId: current.id })),
    fetch: ok(f.core.fetch({ namespace: ns, refs: refs(current) })),
    recall: ok(await f.core.recall({ readSet: [ns], query: 'Synthetic' })),
    legacy: f.scope.get(current.id), legacyList: f.scope.list(), legacySearch: f.scope.search('Synthetic'),
    list: f.core.list({ namespace: ns }), map: f.core.map({ namespace: ns }),
    source: f.core.fetch({ namespace: ns, refs: refs(current), contextMode: 'source-evidence' }),
    sourceRecall: await f.core.recall({ readSet: [ns], query: 'Synthetic', contextMode: 'source-evidence' }),
    rationaleRecall: await f.core.recall({ readSet: [ns], query: 'Synthetic', contextMode: 'rationale-evidence' }),
    snapshot: f.core.sourceSnapshot({ readSet: [ns], limit: 12 }),
    context: ok(await f.trusted.call(f.context, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current',
      query: 'Synthetic', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } })),
    evidence: ok(await f.trusted.call(f.context, 'fetchCandidateEvidence', { readSet: [ns], intent: 'current', refs: [memoryRef(current)] })),
    episode: f.core.getEpisode({ namespace: ns, episodeId }),
    session: f.core.sessionStartContext({ namespace: ns, groups: { background: true } }),
  };
  assert.deepEqual(values.get.receipts, []); assert.deepEqual(values.legacy.receipts, []);
  if (f.call) values.card = ok(await f.call('fetchEvidence', { intent: 'current', refs: [memoryRef(current)] }));
  absent(values, ['Synthetic erased source wording', 'Synthetic erased interpretation', ...denied]);
});

for (const operation of ['forget', 'reject']) test(`${operation} denies both receipt identity and same-message address`,
  { timeout: 15000 }, async t => {
    const f = await fixture(t, 'ordinary-53', operation), [b, a] = await capture(f);
    const c = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic alternate sibling', kind: 'fact' },
      receipts: [source('Synthetic different excerpt')] })).memory;
    const old = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(a.id);
    const denied = f.db.prepare('SELECT id FROM receipts WHERE memory_id IN (?,?)').all(b.id, c.id).map(row => row.id);
    ok(act(f, operation, a)); assert.deepEqual(markers(f), receiptDenialTokens([old]).sort());
    for (const memory of [b, c]) {
      const value = ok(f.core.get({ namespace: ns, memoryId: memory.id }));
      assert.deepEqual(value.receipts, []); absent({ value }, [forgotten, 'Synthetic different excerpt', ...denied]);
    }
  });

// Compare every table, including metadata, journals, reservations, suppression
// facts and Episode effects, so a failed commit cannot leave a partial write.
function databaseState(db) {
  const names = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  return names.map(({ name }) => [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()
    .map(row => JSON.stringify(row)).sort()]);
}
for (const layout of [{ base: 33, mode: 'safety' }, { base: 33, mode: 'lineage' }])
for (const method of ['forget', 'correct', 'forgetEpisode']) for (const forgery of ['marker', 'fingerprint',
  ...(method === 'correct' ? ['identical-identity', 'identical-address', 'same-address'] : [])])
test(`commit rejects ${forgery} during ${method}: ${label(layout)}`, { timeout: 15000 }, async t => {
  const f = await correctionFixture(t, layout);
  let a, episodeId;
  if (method === 'forgetEpisode') {
    const episode = openMemoryCore({ ...f.config, ...episodeOptions,
      model: episodeModel({ extract: () => ({ items: [{ content: obsolete, kind: 'fact', confidence: .8, sourceIndices: [0] }] }) }) });
    t.after(() => episode.close());
    const captured = ok(await episode.capture(episodeInput(1, 'synthetic-forged-episode', { namespace: ns })));
    [a] = captured.admission.memories; episodeId = captured.episode.id;
  } else a = ok(f.core.admit({ namespace: ns, memory: { content: obsolete, kind: 'fact' }, receipts: [source(newExcerpt)] })).memory;
  const old = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(a.id);
  const before = databaseState(f.db);
  let injected = false;
  const result = await trace(() => {
    if (method === 'forgetEpisode') return f.core.forgetEpisode({ namespace: ns, episodeId,
      expectedRevision: f.db.prepare('SELECT revision FROM session_episodes WHERE id=?').get(episodeId).revision });
    if (method === 'forget') return f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision });
    return f.core.correct({ namespace: ns, memoryId: a.id, expectedRevision: a.revision, content: corrected, kind: 'fact',
      receipt: forgery === 'same-address' ? source('Synthetic changed excerpt') : source(newExcerpt) });
  }, (sql, args, writer) => {
    if (injected || !sql.startsWith('UPDATE memories SET content') || args.at(-1) !== a.id) return;
    injected = true;
    const token = forgery === 'fingerprint' ? 'f'.repeat(64) : forgery === 'marker' ? 'rs1:i:' + '0'.repeat(64)
      : receiptDenialTokens([old])[forgery === 'identical-identity' ? 0 : 1];
    writer.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, token);
  });
  assert.equal(injected, true); error(result.result, 'evidence_unavailable');
  assert.deepEqual(databaseState(f.db), before, 'every persisted row is unchanged after the failed commit');
});

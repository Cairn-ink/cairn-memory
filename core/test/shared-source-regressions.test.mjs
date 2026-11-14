import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openMemoryCore, openMemoryStore, roleTaskMeteredText, roleTaskToolResponse } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createMemoryCore } from '../contract.mjs';
import { ns, ok, receipt, lineageHost, copySqliteFixture, quiescence } from '../testing/card-lineage-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { host as contextHost } from '../testing/context-read-core-fixture.mjs';
import { migrateCardLineage, migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { receiptDenialTokens, receiptDeliverySnapshot, deliveryReceiptRows, receiptReadSafety, contentReadSafety } from '../content-safety.mjs';
import { readTransaction, transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { fingerprint } from '../validation.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { model as episodeModel, input as episodeInput } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { survivor, forgotten, message, ordinaryKinds, source, fixture, capture, act, noLeak, hasId,
  scripted, markers, memoryRef, trace, isLookup } from '../testing/shared-source-fixture.mjs';

const error = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
const refs = memory => [{ memoryId: memory.id, revision: memory.revision }];

const recentId = index => 'r' + String(index).padStart(4, '0');
const recentTime = index => new Date(Date.UTC(2026, 0, 1) + index * 1000).toISOString();
const tieTime = '2026-01-02T00:00:00.000Z';
const deliveryKey = memory => JSON.stringify([ns.ownerId, ns.scope, ns.projectId ?? '', memory.id]);

function derivedReceiptRows(f, admittedRow, supports) {
  if (!supports.length) return [];
  // receiptKey is private to runtime.mjs. Invoke that actual function through
  // the internal admission writer, once for the whole synthetic batch. Its
  // donor Memory is outside every read set used here; the tested Memory still
  // gets its extra rows only by the direct inserts below. No duplicate hash.
  const runtime = createMemoryRuntime({ path: f.path });
  let written;
  try {
    written = runtime.admit({ ...ns, projectId: 'synthetic-receipt-template-project' }, {
      content: 'Synthetic receipt row template donor', fingerprint: fingerprint('Synthetic receipt row template donor'),
      kind: 'fact', origin: 'explicit', confidence: 1, receipts: supports,
    }).memory;
  } finally { runtime.close(); }
  const engineRows = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(written.id);
  assert.equal(engineRows.length, supports.length);
  const byEvent = new Map(engineRows.map(row => [row.event_id, row]));
  const columns = Object.keys(admittedRow).sort();
  return supports.map(support => {
    const engineRow = byEvent.get(support.eventId);
    assert.ok(engineRow);
    assert.deepEqual(Object.keys(engineRow).sort(), columns, 'both engine writers use the admitted column set');
    // All other columns, including optional engine-filled columns, come from
    // the admitted row. Only the source identity/payload differs here.
    return { ...admittedRow, ...Object.fromEntries(['receipt_key', 'client', 'session_id', 'event_id', 'role', 'excerpt']
      .map(column => [column, engineRow[column]])) };
  });
}

function insertDerivedReceiptRows(f, admittedRow, rows) {
  const columns = Object.keys(admittedRow), quote = name => '"' + name.replaceAll('"', '""') + '"';
  const insert = f.db.prepare(`INSERT INTO receipts (${columns.map(quote).join(',')}) VALUES (${columns.map(() => '?').join(',')})`);
  for (const row of rows) insert.run(...columns.map(column => row[column]));
  const stored = new Map(f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(admittedRow.memory_id).map(row => [row.id, row]));
  const changed = new Set(['id', 'receipt_key', 'client', 'session_id', 'event_id', 'role', 'excerpt', 'created_at']);
  for (const expected of rows) {
    const actual = stored.get(expected.id);
    assert.ok(actual);
    assert.deepEqual(Object.keys(actual).sort(), [...columns].sort(), 'inserted and admitted column sets agree');
    assert.deepEqual({ ...actual }, expected);
    for (const column of columns) {
      assert.equal(actual[column] === null ? 'null' : typeof actual[column],
        admittedRow[column] === null ? 'null' : typeof admittedRow[column], column + ' retains its engine-written type');
      if (!changed.has(column)) assert.equal(actual[column], admittedRow[column], column + ' retains its engine-filled value');
    }
  }
}

async function recentFixture(t, count, time) {
  const f = await fixture(t, 'fresh-default');
  const memory = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-recent-seed')] })).memory;
  const admittedRow = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
  const rows = derivedReceiptRows(f, admittedRow, Array.from({ length: count }, (_, index) =>
    receipt('synthetic-recent-' + index, 'Synthetic recent support ' + index)))
    .map((row, index) => ({ ...row, id: recentId(index), created_at: time(index) })).reverse();
  // Explicit ids and times make the expected lists independent of UUIDs,
  // insertion order, wall clock and the production order implementation.
  transaction(f.db, () => {
    f.db.prepare('DELETE FROM receipts WHERE memory_id=?').run(memory.id);
    insertDerivedReceiptRows(f, admittedRow, rows);
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

// Internal lazy-reader behavior only: its fresh read cannot authorize combining
// post-change receipts with prepared content in a public recall response. The
// final snapshot must retain the fences captured before the change and refuse.
for (const change of ['forget', 'correct']) test(`internal lazy reader observes ${change}; original final fences refuse`, async t => {
  const f = await cappedRecallFixture(t);
  const runtime = createMemoryRuntime({ path: f.path }); t.after(() => runtime.close());
  const ref = { namespace: ns, memoryId: f.memory.id, revision: f.memory.revision };
  const namespaces = [{ namespace: ns, indexRevision: runtime.epoch(ns), suppressionEpoch: runtime.suppressionFence(ns) }];
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
  }
  assert.throws(() => runtime.recallSnapshot([{ ...ref, receiptOrder: 'recent', receiptLimit: 5 }], [0], namespaces),
    failure => failure.code === (change === 'correct' ? 'revision_conflict' : 'index_revision_conflict'));
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
  error(measured.result, 'revision_conflict');
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

// Use the existing internal runtime collaborator, retaining the public contract
// and all storage/port/delivery guards. Each mutation uses f.core's separate
// connection; f.db independently observes its committed row before we continue.
// The extra fact-only proof writes f.db and verifies on the recall connection.
async function fencedRecallFixture(t, layout, { textPacking = false } = {}) {
  const f = await correctionFixture(t, layout);
  const supports = Array.from({ length: 12 }, (_, index) => ({
    client: 'synthetic-fence-client-' + index, sessionId: 'synthetic-fence-session-' + index,
    eventId: 'synthetic-fence-event-' + index, role: 'user', excerpt: 'Synthetic fenced support ' + index,
  }));
  const selectedContent = 'Synthetic prepared selected wording' + (textPacking ? ' x'.repeat(120) : '');
  // admit accepts 1..4 receipts (contract.mjs). As in recentFixture, seed a
  // valid Memory first, then build the larger synthetic stored list directly.
  const admitted = ok(f.core.admit({ namespace: ns, memory: { kind: 'fact', content: selectedContent },
    receipts: [supports[0]] })).memory;
  const admittedRow = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(admitted.id);
  const insertedRows = derivedReceiptRows(f, admittedRow, supports.slice(1)).map((row, index) =>
    ({ ...row, id: recentId(index + 1), created_at: recentTime(index + 1) })).reverse();
  transaction(f.db, () => {
    f.db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=?').run(recentTime(0), admitted.id);
    insertDerivedReceiptRows(f, admittedRow, insertedRows);
  });
  const memory = ok(f.core.get({ namespace: ns, memoryId: admitted.id })).memory;
  const shared = supports[11];
  const siblingRef = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic prepared sibling wording', kind: 'fact' },
    receipts: [shared] })).memory;
  const sibling = ok(f.core.get({ namespace: ns, memoryId: siblingRef.id })).memory;
  const independent = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic prepared independent wording', kind: 'fact' },
    receipts: [receipt('synthetic-fence-independent')] })).memory;
  const stored = f.db.prepare('SELECT * FROM receipts WHERE memory_id IN (?,?)').all(memory.id, sibling.id);
  const ids = supports.map(support => stored.find(row => row.memory_id === memory.id && row.event_id === support.eventId).id);
  assert.equal(memory.content, selectedContent);
  assert.equal(sibling.content, 'Synthetic prepared sibling wording');
  assert.equal(memory.receiptCount, 12);
  assert.equal(new Set(ids).size, 12);
  const state = {};
  const reset = (change, at) => Object.assign(state, { change, at, changed: false, prepared: false,
    preparationReturns: 0, changePreparationReturns: null,
    lazyStarted: false, lazyFinished: false, rankReturned: false, rankOutputCounted: false,
    navigation: [], requests: [], recentSQL: [], afterInputs: [], finalFences: null, finalError: null, finalSucceeded: false, lazyError: null,
    fetchedLists: null, fenceReadsAfterPreparation: 0, factWrite: null });
  reset();
  const observeInput = (port, input) => { if (state.changed) state.afterInputs.push({ port, input: structuredClone(input) }); };
  f.model.select = ({ input }) => {
    observeInput('select', input);
    const offered = input.maps.flatMap(page => page.items.map(item => ({ namespaceIndex: page.namespaceIndex,
      ...(item.type === 'unfiled' ? item.ref : { memoryId: item.ref.childId, revision: item.ref.childRevision }) })));
    return { refs: [memory, independent].map(item => {
      const ref = offered.find(ref => ref.memoryId === item.id); assert.ok(ref); return ref;
    }) };
  };
  f.model.countTokens = text => {
    let input;
    try { input = JSON.parse(text); } catch { input = text; }
    observeInput('countTokens', input);
    if (state.rankReturned && input?.refs) state.rankOutputCounted = true;
    const candidates = input?.input?.candidates;
    if (!candidates) return 1;
    state.fetchedLists ??= candidates.map(item => ({ memoryId: item.memory.id, length: item.receipts.length }));
    return textPacking ? (candidates.some(item => item.memory.content.length > 120) ? 7000 : 1)
      : candidates.reduce((sum, item) => sum + item.receipts.length * 1000, 0);
  };
  f.model.rank = ({ input }) => {
    observeInput('rank', input);
    state.rankReturned = true;
    return { refs: input.candidates.map(item => ({ namespaceIndex: item.namespaceIndex,
      memoryId: item.memory.id, revision: item.memory.revision })) };
  };
  let connection;
  function commitChange() {
    assert.equal(state.prepared, true, 'preparation returned after its read transaction committed');
    assert.equal(state.preparationReturns, 1, 'this call returned from exactly one preparation');
    state.changePreparationReturns = state.preparationReturns;
    assert.equal(connection.isTransaction, false, 'no recall transaction surrounds the other connection commit');
    assert.equal(f.db.isTransaction, false);
    assert.equal(state.changed, false);
    if (state.at === 'before-lazy') {
      assert.equal(state.lazyStarted, false, 'the recent reader has not been entered');
      assert.equal(state.recentSQL.length, 0, 'zero recent statements before the change');
    } else {
      assert.equal(state.lazyFinished, true);
      assert.equal(state.recentSQL.length, 1, 'the lazy transaction committed before the change');
      assert.equal(state.rankOutputCounted, true, 'all rank callbacks finished before the change');
    }
    const target = state.change.startsWith('sibling-') ? sibling : memory;
    const forget = state.change.endsWith('forget');
    const factOnly = ['sibling-fact', 'selected-receipt-purge-fact'].includes(state.change);
    if (factOnly) {
      const witness = () => ({
        indexRevision: connection.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?')
          .get(ns.ownerId, ns.scope, ns.projectId).epoch,
        memoryRevision: connection.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision,
        owner: connection.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(ns.ownerId)
          ?? { epoch_hi: 0, epoch_lo: 0 },
      });
      const before = witness();
      const written = transaction(f.db, () => writeContentSuppressionInside(f.db, state.change === 'sibling-fact'
        ? { namespace: ns, kind: 'memory', key: sibling.id, matchMode: 'revision-through',
          sourceVersion: JSON.stringify(['memory-revision-through-v1', sibling.revision]),
          reason: 'correction_supersession', actionId: 'synthetic-fence-fact-only' }
        // The same receipt-fact writer used by suppressReceiptsInside during
        // purge. No canonical mutation or direct epoch-row update accompanies it.
        : { namespace: ns, kind: 'receipt', key: ids[11], reason: 'purge', actionId: 'synthetic-fence-purge-fact-only' }));
      state.factWrite = { before, after: witness(), fact: connection.prepare(
        'SELECT kind,stable_key,match_mode,reason FROM content_suppressions WHERE owner_id=? AND fact_id=?')
        .get(ns.ownerId, written.factId) };
    } else ok(forget ? f.core.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision })
      : f.core.correct({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
        content: 'Synthetic replacement interpretation', kind: 'fact',
        receipt: state.change === 'sibling-identical' ? shared : state.change === 'sibling-address'
          ? { ...shared, excerpt: 'Synthetic replacement excerpt' } : receipt('synthetic-fence-replacement') }));
    // An autocommit read on another connection cannot see an uncommitted write.
    const verification = factOnly ? connection : f.db;
    assert.equal(verification.isTransaction, false);
    const observed = verification.prepare('SELECT revision,deleted FROM memories WHERE id=?').get(target.id);
    assert.equal(forget ? observed.deleted : observed.revision, forget ? 1 : target.revision + (factOnly ? 0 : 1));
    if (factOnly) {
      const index = verification.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?')
        .get(ns.ownerId, ns.scope, ns.projectId).epoch;
      const owner = verification.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(ns.ownerId);
      assert.equal(index, state.navigation[0].indexRevision, 'fact-only write leaves the namespace index unchanged');
      assert.notEqual(`${owner.epoch_hi}:${owner.epoch_lo}`, state.navigation[0].suppressionEpoch, 'new owner epoch is committed');
    }
    if (target === sibling) assert.equal(f.db.prepare('SELECT revision FROM memories WHERE id=?').get(memory.id).revision,
      memory.revision, 'sibling changes leave the selected Memory revision unchanged');
    state.changed = true;
  }
  const core = createMemoryCore(f.config, { createRuntime(options) {
    const runtime = createMemoryRuntime(options, { attachRaw(db) { connection = db; } });
    const fences = namespaces => namespaces.map(({ indexRevision, suppressionEpoch }) => ({ indexRevision, suppressionEpoch }));
    return { ...runtime,
      queryCandidateRows(...args) {
        if (state.prepared) state.fenceReadsAfterPreparation++;
        assert.equal(state.prepared, false, 'navigation fences are captured before preparation');
        const page = runtime.queryCandidateRows(...args);
        state.navigation.push({ indexRevision: page.epoch, suppressionEpoch: page.suppressionEpoch });
        return page;
      },
      epoch(...args) {
        if (state.prepared) state.fenceReadsAfterPreparation++;
        return runtime.epoch(...args);
      },
      suppressionFence(...args) {
        if (state.prepared) state.fenceReadsAfterPreparation++;
        return runtime.suppressionFence(...args);
      },
      recallSnapshot(candidates, selected, namespaces, ...rest) {
        if (selected === null) {
          assert.equal(state.navigation.length, 1);
          const reader = runtime.recallSnapshot(candidates, selected, namespaces, ...rest);
          assert.equal(connection.isTransaction, false, 'preparation has actually committed');
          assert.equal(state.recentSQL.length, 0);
          state.preparationReturns++;
          state.prepared = true;
          return { ...reader, recentReceipts(namespace, ref, count) {
            assert.equal(state.prepared, true);
            assert.equal(connection.isTransaction, false, 'lazy transaction has not begun');
            state.requests.push({ memoryId: ref.memoryId, count });
            if (state.change && state.at === 'before-lazy') commitChange();
            state.lazyStarted = true;
            try {
              const rows = reader.recentReceipts(namespace, ref, count);
              assert.equal(connection.isTransaction, false, 'lazy transaction has committed');
              state.lazyFinished = true;
              return rows;
            } catch (failure) { state.lazyError = failure.code; throw failure; }
          } };
        }
        if (selected.length) {
          state.finalFences = fences(namespaces);
          assert.deepEqual(state.finalFences, state.navigation, 'final proof retains the navigation-time fences');
        }
        let result;
        try { result = runtime.recallSnapshot(candidates, selected, namespaces, ...rest); }
        catch (failure) { if (selected.length) state.finalError = failure.code; throw failure; }
        if (selected.length) state.finalSucceeded = true;
        // callModel's last validateFresh follows the rank-output counter. Its
        // committed return is immediately before finalization, with no later
        // model/counter callback. The final arguments must still carry E0.
        if (state.change && state.at === 'after-rank-validation' && state.rankOutputCounted && !state.changed) commitChange();
        return result;
      },
    };
  } });
  t.after(() => core.close());
  const call = async invoke => {
    const measured = await trace(invoke, (sql, args) => {
      if (isRecentStatement({ sql })) state.recentSQL.push({ sql, args });
    });
    return measured.result;
  };
  const needles = change => {
    const target = change.startsWith('sibling-') ? sibling : memory;
    const targetRows = stored.filter(row => row.memory_id === target.id);
    const denied = [target.content, ...targetRows.map(row => row.id)];
    if (change !== 'sibling-identical') denied.push(shared.excerpt, ids[11]);
    // Re-citation preserves the address; only forget / a different replacement
    // address withholds it. All synthetic source coordinates are unique.
    if (change.endsWith('forget') || change === 'selected-correct') for (const row of targetRows)
      denied.push(row.excerpt, row.client, row.session_id, row.event_id);
    assert.ok(denied.every(text => typeof text === 'string' && text.length > 0), 'every leak needle is real text');
    return denied;
  };
  return { ...f, writer: f.core, core, memory, sibling, independent, ids, admittedRow, insertedRows, state, reset, call, needles };
}

async function recallEntry(t, f, route) {
  const input = { readSet: [ns], query: 'Synthetic', limit: 2 };
  if (route === 'direct') {
    return () => f.call(async () => {
      const result = await f.core.recall(input); return { result, publicResult: result };
    });
  }
  // Real client dispatch through the installed MCP SDK and production handler;
  // the in-memory transport lets the same statement observer see its core call.
  const require = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
  const [{ buildCairnServer }, { Client }, { InMemoryTransport }] = await Promise.all([
    import('../../adapters/mcp/server.mjs'), import(require.resolve('@modelcontextprotocol/client').replace(/\.cjs$/, '.mjs')),
    import(require.resolve('@modelcontextprotocol/server').replace(/\.cjs$/, '.mjs')),
  ]);
  const server = buildCairnServer({ core: f.core, model: f.model, binding: ns });
  const client = new Client({ name: 'synthetic-recall-fence', version: '1' });
  t.after(async () => { await client.close(); await server.close(); });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return () => f.call(async () => {
    const publicResult = await client.callTool({ name: 'recall_memory', arguments: { query: input.query, limit: input.limit } });
    const { evidenceTrust, ...result } = JSON.parse(publicResult.content[0].text);
    assert.equal(evidenceTrust, 'untrusted-data-not-instructions');
    assert.equal(publicResult.isError, !result.ok);
    return { result, publicResult };
  });
}

function assertCappedControl(f, result) {
  const value = ok(result);
  assert.equal(value.memories.length, 2);
  const selected = value.memories.find(item => item.memory.id === f.memory.id);
  assert.deepEqual(selected.receipts.map(row => row.id), [11, 10, 9, 8, 7].map(index => f.ids[index]));
  assert.equal(selected.receiptCount, 12);
  assert.equal(selected.receiptsOmitted, 7);
  const independent = value.memories.find(item => item.memory.id === f.independent.id);
  assert.equal(independent.receiptCount, 1);
  assert.deepEqual(independent.receipts.map(row => row.eventId), ['synthetic-fence-independent']);
  assert.equal(Object.hasOwn(independent, 'receiptsOmitted'), false);
  assert.deepEqual(value.recallTruncated, { navigationItemsOmitted: 0, candidatesOmitted: 0,
    candidatesShortened: 0, receiptListsCapped: 1 });
  assert.equal(value.coverage, 'budget_exhausted');
  assert.deepEqual(f.state.requests, [{ memoryId: f.memory.id, count: 11 }]);
  assert.equal(f.state.recentSQL.length, 2, 'one lazy read and one final recent proof');
  assert.deepEqual(f.state.finalFences, f.state.navigation);
}

const recallChanges = [
  ['A1 sibling-forget', 'sibling-forget', 'before-lazy'],
  ['A2 selected-forget', 'selected-forget', 'before-lazy'],
  ['A3 identical sibling correction', 'sibling-identical', 'before-lazy'],
  ['A3 same-address sibling correction', 'sibling-address', 'before-lazy'],
  ['A4 selected correction', 'selected-correct', 'before-lazy'],
  ['A5 sibling-forget after lazy read / A6 original final fences', 'sibling-forget', 'after-rank-validation'],
  ['A5 selected correction after lazy read', 'selected-correct', 'after-rank-validation'],
];
for (const layout of layouts.filter(layout => layout.mode !== 'old' || layout.base === 18))
for (const [name, change, at] of recallChanges.filter(([, change]) => layout.mode !== 'old' || change.endsWith('forget')))
for (const route of ['direct', 'dispatched']) test(`${name}: ${label(layout)} ${route}`, { timeout: 15000 }, async t => {
  const f = await fencedRecallFixture(t, layout), call = await recallEntry(t, f, route);
  assertCappedControl(f, (await call()).result);
  f.reset(change, at);
  const { result, publicResult } = await call();
  // reset cleared the earlier control's witnesses. These belong to the changed
  // call, and must hold before its expected error can count as a passing case.
  assert.equal(f.state.preparationReturns, 1, 'the changed call returned from preparation');
  assert.equal(f.state.changePreparationReturns, 1, 'the change hook observed that preparation return');
  assert.equal(f.state.changed, true, 'the scheduled public mutation committed');
  assert.deepEqual(f.state.requests, [{ memoryId: f.memory.id, count: 11 }], 'this call entered its prepared lazy provider');
  const expected = layout.mode !== 'old' ? 'evidence_unavailable'
    : change === 'selected-forget' ? 'revision_conflict' : 'index_revision_conflict';
  error(result, expected);
  assert.equal(Object.hasOwn(result, 'value'), false, 'no Memory list on refusal');
  absent({ publicResult, afterChangeModelInputs: f.state.afterInputs }, f.needles(change));
  assert.equal(f.state.fenceReadsAfterPreparation, 0, 'nothing re-captures either fence after preparation');
  assert.equal(f.state.navigation.length, 1);
  if (at === 'after-rank-validation') {
    assert.deepEqual(f.state.finalFences, f.state.navigation, 'a mid-call mutation never refreshes final fences');
    assert.equal(f.state.finalError, layout.mode !== 'old' ? 'evidence_unavailable'
      : change === 'selected-correct' ? 'revision_conflict' : 'index_revision_conflict');
    assert.equal(f.state.finalSucceeded, false);
    assert.equal(f.state.recentSQL.length, 1, 'final refusal precedes final recent headers');
    assert.deepEqual(f.state.afterInputs, [], 'no model input follows the final interleaving');
  } else if (change.startsWith('selected-')) {
    assert.equal(f.state.lazyError, 'revision_conflict');
    assert.equal(f.state.recentSQL.length, 0, 'selected revision refusal precedes recent SQL');
    assert.equal(f.state.finalFences, null, 'lazy refusal never reaches finalization');
    assert.deepEqual(f.state.afterInputs, []);
  } else {
    assert.equal(f.state.lazyFinished, true);
    assert.equal(f.state.recentSQL.length, 1, 'the lazy read participates in the refused call');
    assert.equal(f.state.finalFences, null, 'post-change packing/freshness refuses before finalization');
    assert.ok(f.state.afterInputs.length > 0, 'inspect the actual post-change packing input');
  }
});

for (const change of ['sibling-fact', 'selected-receipt-purge-fact']) for (const route of ['direct', 'dispatched'])
test(`A6 owner epoch alone covers lazy reads through public delivery${change === 'sibling-fact' ? '' : ' with purge receipt writer'} ${route}`, async t => {
  const f = await fencedRecallFixture(t, { base: 18, mode: 'safety' });
  const call = await recallEntry(t, f, route);
  assertCappedControl(f, (await call()).result);
  f.reset(change, 'after-rank-validation');
  const { result, publicResult } = await call();
  assert.equal(f.state.preparationReturns, 1, 'the changed call returned from preparation');
  assert.equal(f.state.changePreparationReturns, 1, 'the change hook observed that preparation return');
  assert.equal(f.state.changed, true);
  assert.equal(f.state.lazyFinished, true, 'this call completed its prepared lazy read');
  assert.deepEqual(f.state.requests, [{ memoryId: f.memory.id, count: 11 }]);
  const { before, after, fact } = f.state.factWrite;
  assert.equal(after.indexRevision, before.indexRevision, 'fact writer leaves the namespace index revision unchanged');
  assert.equal(before.indexRevision, f.state.navigation[0].indexRevision);
  assert.equal(after.memoryRevision, before.memoryRevision, 'fact writer leaves the selected Memory revision unchanged');
  assert.equal(after.memoryRevision, f.memory.revision);
  const epoch = owner => (BigInt(owner.epoch_hi) << 32n) + BigInt(owner.epoch_lo);
  assert.equal(epoch(after.owner), epoch(before.owner) + 1n, 'the engine fact insert advances the owner epoch exactly once');
  assert.equal(`${before.owner.epoch_hi}:${before.owner.epoch_lo}`, f.state.navigation[0].suppressionEpoch);
  assert.deepEqual({ ...fact }, change === 'sibling-fact'
    ? { kind: 'memory', stable_key: f.sibling.id, match_mode: 'revision-through', reason: 'correction_supersession' }
    : { kind: 'receipt', stable_key: f.ids[11], match_mode: 'incarnation', reason: 'purge' });
  error(result, 'evidence_unavailable');
  assert.equal(Object.hasOwn(result, 'value'), false);
  assert.deepEqual(f.state.finalFences, f.state.navigation);
  assert.equal(f.state.fenceReadsAfterPreparation, 0);
  // No canonical write / index advance: epoch() folds a live owner E1 into the
  // final snapshot's namespace epoch read and rejects the request's E0 memo.
  // This must fail even when the namespace index comparison alone would pass.
  assert.equal(f.state.finalSucceeded, false);
  assert.equal(f.state.finalError, 'evidence_unavailable');
  assert.equal(f.state.recentSQL.length, 1, 'owner fence rejects before final receipt SQL');
  assert.deepEqual(f.state.afterInputs, []);
  absent({ publicResult, afterChangeModelInputs: f.state.afterInputs }, change === 'sibling-fact'
    ? [f.sibling.content] : [f.memory.content, f.ids[11], ...Object.values(f.insertedRows.find(row => row.id === f.ids[11]))
      .filter(value => typeof value === 'string')]);
});

test('public sibling forget withholds a directly inserted fixture receipt on every Memory read', { timeout: 15000 }, async t => {
  const f = await fencedRecallFixture(t, { base: 33, mode: 'lineage-event' });
  const denied = f.insertedRows.find(row => row.id === f.ids[11]);
  const siblingRow = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(f.sibling.id);
  assert.ok(denied, 'the receipt under test was directly inserted, not the admitted seed');
  assert.notEqual(denied.id, f.admittedRow.id);
  assert.equal(denied.memory_id, f.memory.id);
  assert.notEqual(denied.id, siblingRow.id);
  for (const column of ['receipt_key', 'client', 'session_id', 'event_id', 'role', 'excerpt'])
    assert.equal(denied[column], siblingRow[column], 'the public sibling cites the same ' + column);
  const expectedMarkers = receiptDenialTokens([denied]).sort();
  assert.equal(expectedMarkers.length, 2);
  assert.deepEqual(expectedMarkers.map(token => token.slice(0, 6)).sort(), ['rs1:a:', 'rs1:i:']);
  assert.deepEqual(markers(f), []);
  const before = ok(f.writer.get({ namespace: ns, memoryId: f.memory.id }));
  assert.deepEqual(before.receipts.map(row => row.id), f.ids, 'all twelve fixture rows are initially delivered');
  const acknowledgement = ok(f.writer.forget({ namespace: ns, memoryId: f.sibling.id, expectedRevision: f.sibling.revision }));
  assert.equal(acknowledgement.forgotten, true);
  assert.deepEqual(markers(f), expectedMarkers, 'public forget writes both deny tokens for the inserted receipt');
  assert.equal(f.db.prepare('SELECT revision FROM memories WHERE id=?').get(f.memory.id).revision, f.memory.revision);

  const values = {}, modelInputs = [];
  for (const port of ['select', 'rank']) {
    const invoke = f.model[port];
    f.model[port] = request => { modelInputs.push({ port, input: structuredClone(request.input) }); return invoke(request); };
  }
  const count = f.model.countTokens;
  let capped = true;
  f.model.countTokens = text => { modelInputs.push({ port: 'countTokens', input: text }); return capped ? count(text) : 1; };
  // Exercise the capped lazy provider and final recent proof through BOTH
  // public entry points, then uncapped delivery of all eleven remaining rows.
  for (const route of ['direct', 'dispatched']) {
    const call = await recallEntry(t, f, route);
    for (const cap of [true, false]) {
      capped = cap;
      f.reset();
      const response = await call(), value = ok(response.result);
      values[route + (cap ? 'Capped' : 'Uncapped')] = response.publicResult;
      const selected = value.memories.find(item => item.memory.id === f.memory.id);
      assert.ok(selected);
      assert.deepEqual(selected.receipts.map(row => row.id), cap ? [10, 9, 8, 7, 6].map(index => f.ids[index]) : f.ids.slice(0, 11));
      assert.equal(selected.receiptCount, 12, 'withholding preserves the physical count');
      if (cap) {
        assert.equal(selected.receiptsOmitted, 7);
        assert.deepEqual(f.state.requests, [{ memoryId: f.memory.id, count: 10 }]);
        assert.equal(f.state.recentSQL.length, 2);
      } else assert.equal(Object.hasOwn(selected, 'receiptsOmitted'), false);
    }
  }
  capped = false;
  const core = f.writer, input = { namespace: ns, refs: refs(f.memory) }, remaining = f.ids.slice(0, 11);
  Object.assign(values, {
    get: ok(core.get({ namespace: ns, memoryId: f.memory.id })),
    fetch: ok(core.fetch(input)),
    list: ok(core.list({ namespace: ns, limit: 20 })), map: ok(core.map({ namespace: ns, purpose: 'recall' })),
    legacyGet: f.scope.get(f.memory.id), legacyList: f.scope.list(), legacySearch: f.scope.search('Synthetic'),
    contextEvidence: ok(await f.trusted.call(f.context, 'fetchCandidateEvidence',
      { readSet: [ns], intent: 'current', refs: [memoryRef(f.memory)] })),
    contextRead: ok(await f.trusted.call(f.context, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current',
      query: 'Synthetic', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } })),
    session: core.sessionStartContext({ namespace: ns, groups: { nextSteps: true, procedural: false, background: true },
      maxTokens: 2000, maxChars: 8000 }),
  });
  error(values.session, 'source_unavailable');
  assert.deepEqual(values.get.receipts.map(row => row.id), remaining);
  assert.deepEqual(values.fetch.items[0].receipts.map(row => row.id), remaining);
  assert.deepEqual(values.legacyGet.receipts.map(row => row.excerpt), values.get.receipts.map(row => row.excerpt));
  const runtime = createMemoryRuntime({ path: f.path });
  try { values.recent = runtime.recentReceipts(ns, refs(f.memory)[0], 12); }
  finally { runtime.close(); }
  assert.deepEqual(values.recent.map(row => row.id), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0].map(index => f.ids[index]));
  for (const recent of [false, true]) {
    values[recent ? 'recentRows' : 'forwardRows'] = readTransaction(f.db, () => {
      const memo = receiptDeliverySnapshot(f.db, [{ namespace: ns, memoryId: f.memory.id }], undefined, [], { recent, limit: 12 });
      return deliveryReceiptRows(f.db, ns, f.memory.id, memo, { recent, limit: 12 });
    });
    assert.deepEqual(values[recent ? 'recentRows' : 'forwardRows'].map(row => row.id), recent ? [...remaining].reverse() : remaining);
  }
  // Source-context reads require the complete physical source set, so one
  // withheld receipt must produce the same exact refusal as other leak cases.
  for (const contextMode of ['source-evidence', 'rationale-evidence']) {
    values[contextMode + 'Fetch'] = core.fetch({ ...input, contextMode });
    values[contextMode + 'Recall'] = await core.recall({ readSet: [ns], query: 'Synthetic', limit: 8, contextMode });
    error(values[contextMode + 'Fetch'], 'source_unavailable');
    error(values[contextMode + 'Recall'], 'source_unavailable');
  }
  values.snapshot = core.sourceSnapshot({ readSet: [ns], limit: 12 });
  assert.equal(values.snapshot.ok, false);
  assert.equal(JSON.stringify(values.snapshot).includes('complete-current-admitted'), false);
  values.cardEvidence = ok(await f.host.call(core, 'fetchEvidence', { intent: 'current', refs: [memoryRef(f.memory)] }));
  values.cardSelection = ok(await f.host.call(core, 'selectEvidence', { intent: 'current', query: 'Synthetic', types: ['memory'], limit: 24 }));
  values.cardRevalidation = ok(await f.host.call(core, 'revalidateEvidence', { snapshot: values.cardEvidence.snapshot }));
  for (const name of ['contextEvidence', 'cardEvidence']) {
    const item = values[name].items.find(item => item.ref.memoryId === f.memory.id);
    assert.ok(item);
    assert.deepEqual(item.provenance.sources.map(source => source.receiptId), remaining, name + ' keeps every remaining receipt');
  }
  values.cardSources = await Promise.all(values.cardEvidence.items[0].provenance.sources.map(source =>
    Promise.resolve(f.host.call(core, 'getSource', { source })).then(ok)));
  assert.equal(values.cardSources.length, 11);
  for (const row of values.get.receipts) assert.ok(JSON.stringify(values.cardSources).includes(row.excerpt));
  values.exportedText = roleTaskMeteredText(values.contextRead.metered);
  values.exportedTool = roleTaskToolResponse({ ok: true, value: values.contextRead });
  for (const name of ['list', 'map', 'legacyList', 'legacySearch', 'contextRead', 'cardSelection'])
    assert.ok(hasId(values[name], f.memory.id), name + ' still delivers the selected Memory');
  assert.ok(modelInputs.some(item => item.port === 'rank'), 'the input scan includes actual post-forget rank requests');
  absent({ ...values, modelInputs }, [f.sibling.content, denied.id, siblingRow.id, denied.receipt_key,
    denied.excerpt, denied.client, denied.session_id, denied.event_id, ...expectedMarkers]);
});

for (const textPacking of [false, true]) for (const route of ['direct', 'dispatched'])
test(`recent requests equal trial-capped candidates, final text-only packing=${textPacking} ${route}`, async t => {
  const f = await fencedRecallFixture(t, { base: 18, mode: 'safety' }, { textPacking });
  const call = await recallEntry(t, f, route), { result } = await call();
  const value = ok(result);
  // Both fixtures fetch [12,1] receipts. The base's floor pass uses cap=1:
  // precisely the 12-receipt candidate requests a recent provider, once even
  // across binary-search trials. Text-only packing later widens back to 12.
  assert.deepEqual(f.state.fetchedLists, [{ memoryId: f.memory.id, length: 12 }, { memoryId: f.independent.id, length: 1 }]);
  assert.deepEqual(f.state.requests, [{ memoryId: f.memory.id, count: 11 }]);
  assert.deepEqual(f.state.requests.map(item => item.memoryId), f.state.fetchedLists.filter(item => item.length > 1).map(item => item.memoryId));
  assert.equal(f.state.requests.length, f.state.fetchedLists.filter(item => item.length > 1).length);
  const selected = value.memories.find(item => item.memory.id === f.memory.id);
  if (textPacking) {
    assert.equal(value.recallTruncated.receiptListsCapped, 0);
    assert.equal(value.recallTruncated.candidatesShortened, 1);
    assert.deepEqual(selected.receipts.map(row => row.id), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(index => f.ids[index]));
    assert.equal(Object.hasOwn(selected, 'receiptsOmitted'), false);
    assert.equal(f.state.recentSQL.length, 1, 'trial request only; final list uses forward proof');
  } else assertCappedControl(f, result);
});

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

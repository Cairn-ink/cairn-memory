import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { resolveMemorySourceDates, receiptSourceRows, sourceDateFields } from '../context-read-source-dates.mjs';
import { assembleContext, meteredText } from '../context-read-assembly.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { fixedPrepared, ns } from '../testing/context-read-assembly-fixture.mjs';

const dated = 'representation-v2-dated';
const first = '2026-01-01T08:00:01.000Z', last = '2026-01-03T08:00:02.000Z';
function entry(id, rows, namespace = ns) {
  const item = structuredClone(fixedPrepared()[0]);
  item.ref = { ...item.ref, namespace, memoryId: id };
  item.text = 'Synthetic telescope ' + id;
  item.sources = rows.map((row, index) => ({ index, role: 'user', excerpt: row.excerpt ?? item.text }));
  return { item, rows: rows.map(row => ({ memory_id: id, ...row })) };
}
function database(t) {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE memories(id TEXT PRIMARY KEY,owner_id TEXT,scope TEXT,project_id TEXT);
    CREATE TABLE receipts(id TEXT PRIMARY KEY,memory_id TEXT,event_id TEXT,role TEXT,created_at TEXT);
    CREATE TABLE raw_receipt_lineage(receipt_id TEXT,conversation_id TEXT,message_id TEXT);
    CREATE TABLE raw_conversations(id TEXT PRIMARY KEY,owner_id TEXT,scope TEXT,project_id TEXT);
    CREATE TABLE raw_messages(conversation_id TEXT,message_id TEXT,role TEXT,occurred_at TEXT);
    BEGIN;`);
  t.after(() => { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); });
  const add = (id, receipt, instant, namespace = ns, conversation = id) => {
    db.prepare('INSERT OR IGNORE INTO memories VALUES(?,?,?,?)').run(id, namespace.ownerId, namespace.scope, namespace.projectId ?? '');
    db.prepare('INSERT OR IGNORE INTO receipts VALUES(?,?,?,?,?)').run(receipt, id, receipt, 'user', '2099-01-01');
    db.prepare('INSERT OR IGNORE INTO raw_conversations VALUES(?,?,?,?)').run(conversation, namespace.ownerId, namespace.scope, namespace.projectId ?? '');
    db.prepare('INSERT INTO raw_messages VALUES(?,?,?,?)').run(conversation, receipt, 'user', instant);
    db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?)').run(receipt, conversation, receipt);
  };
  return { db, add };
}
const options = prepared => ({ prepared, counter: { id: 'synthetic-bytes', countTokens: text => Buffer.byteLength(text) },
  policy: { id: 'rank-first-whole-v1' }, budget: { maxTokens: 6000, maxItems: 24 },
  representation: dated, query: 'telescope', readSet: [ns], deadlineAt: Infinity, snapshotOf: () => null });

test('one batch resolves canonical Raw times across Memories/namespaces and refuses a foreign lineage edge', t => {
  const { db, add } = database(t), foreign = { ...ns, ownerId: 'synthetic-other-owner' };
  add('later', 'receipt-later', last); add('earlier', 'receipt-earlier', first);
  add('foreign', 'receipt-foreign', '1970-01-01T00:00:00.000Z', foreign);
  // The supplied receipt is authorized, but this extra edge is malformed.
  db.prepare('INSERT INTO raw_messages VALUES(?,?,?,?)').run('foreign', 'receipt-later', 'user', '1970-01-01T00:00:00.000Z');
  db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?)').run('receipt-later', 'foreign', 'receipt-later');
  const entries = [entry('later', [{ id: 'receipt-later', source_time_available: 1, occurred_at: '1980-01-01T00:00:00.000Z' }]),
    entry('earlier', [{ id: 'receipt-earlier', source_time_available: 1 }]),
    entry('foreign', [{ id: 'receipt-foreign', source_time_available: 1 }], foreign)];
  const calls = [], rowCounts = [], measured = { get isTransaction() { return db.isTransaction; }, prepare(sql) {
    calls.push(sql); const statement = db.prepare(sql);
    return { all(...args) { const rows = statement.all(...args); rowCounts.push(rows.length); return rows; } };
  } };
  assert.equal(resolveMemorySourceDates(measured, entries, Infinity), true);
  assert.equal(calls.length, 1);
  assert.deepEqual(rowCounts, [3]);
  t.diagnostic(`source-time batch: statements=${calls.length}, returned rows=${rowCounts[0]}`);
  assert.deepEqual(entries.map(e => e.item.date), ['2026-01-03T08:00Z', '2026-01-01T08:00Z', '1970-01-01T00:00Z']);
  assert.equal(entries[0].item.sources[0].date, '2026-01-03T08:00Z');
  assert.ok(!JSON.stringify(entries[0].item).includes('1970'));
  const unauthorized = entry('later', [{ id: 'receipt-later', source_time_available: 1 }], foreign);
  resolveMemorySourceDates(db, [unauthorized], Infinity);
  assert.equal(unauthorized.item.date, null);
  assert.equal(unauthorized.item.sources[0].date, undefined);
});

test('multi-source Memory retains each source date and uses chronology only for emission', t => {
  const { db, add } = database(t);
  add('multi', 'multi-first', first); add('multi', 'multi-last', last);
  add('single', 'single', '2026-01-02T08:00:00.000Z');
  const entries = [entry('single', [{ id: 'single', source_time_available: 1 }]),
    entry('multi', [{ id: 'multi-last', source_time_available: 1, excerpt: 'Shared source' },
      { id: 'multi-first', source_time_available: 1, excerpt: 'Shared source' }])];
  entries.forEach((e, i) => { e.item.rank = i + 1; });
  resolveMemorySourceDates(db, entries, Infinity);
  const prepared = entries.map(e => e.item), result = assembleContext(options(prepared));
  assert.deepEqual(result.metered.items.map(item => item.ref.id), ['multi', 'single']);
  assert.equal(result.metered.items[0].date, undefined);
  assert.deepEqual(result.metered.items[0].sources.map(source => source.date), ['2026-01-03T08:00Z', '2026-01-01T08:00Z']);
  assert.deepEqual(result.selected.map(item => item.ref.memoryId), ['single', 'multi']);
  assert.equal(result.diagnostics.budget.used, Buffer.byteLength(meteredText(result.metered)));
  // The second identical excerpt becomes an alias, retaining its own date.
  assert.ok(result.metered.items[0].sources[1].sameAsBody || result.metered.items[0].sources[1].sameAs);
  const legacy = assembleContext({ ...options(prepared), representation: 'representation-v2' });
  assert.ok(!JSON.stringify(legacy.metered).includes('2026-'));
});

test('one receipt with several canonical source times emits dates without an item-level date', t => {
  const { db, add } = database(t);
  add('multi', 'receipt', first, ns, 'conversation-first');
  add('multi', 'receipt', last, ns, 'conversation-last');
  const value = entry('multi', [{ id: 'receipt', source_time_available: 1 }]);
  resolveMemorySourceDates(db, [value], Infinity);
  assert.equal(value.item.date, null);
  assert.deepEqual(value.item.sources[0].dates, ['2026-01-01T08:00Z', '2026-01-03T08:00Z']);
  assert.deepEqual(sourceDateFields(value.item.sources[0], dated), { dates: ['2026-01-01T08:00Z', '2026-01-03T08:00Z'] });
});

test('dated receipt entries remain when excerpt text cannot fit, with exact budget and omission counts', () => {
  const value = entry('multi', [{ id: 'first', excerpt: '界'.repeat(700) },
    { id: 'last', excerpt: '另'.repeat(700) }]);
  value.item.sources[0].date = '2026-01-01T08:00Z'; value.item.sources[1].date = '2026-01-03T08:00Z';
  value.item.sortDate = '2026-01-01T08:00Z';
  const args = options([value.item]), minimal = assembleContext({ ...args, budget: { maxTokens: 1000, maxItems: 1 } });
  assert.equal(minimal.metered.items.length, 1);
  assert.deepEqual(minimal.metered.items[0].sources, [{ index: 0, date: '2026-01-01T08:00Z', role: 'user' },
    { index: 1, date: '2026-01-03T08:00Z', role: 'user' }]);
  assert.equal(minimal.metered.items[0].sourcesComplete, false);
  assert.equal(minimal.diagnostics.omitted.sources, 2);
  assert.equal(minimal.diagnostics.budget.used, Buffer.byteLength(meteredText(minimal.metered)));
  assert.equal(assembleContext({ ...args, budget: { maxTokens: minimal.diagnostics.budget.used, maxItems: 1 } }).metered.items.length, 1);
});

test('undated and Raw-incapable reads add no lookup and retain byte-identical metered text', () => {
  const prepared = fixedPrepared().slice(0, 2), before = assembleContext(options(structuredClone(prepared))).metered;
  const noSql = { prepare() { assert.fail('undated read must not issue a date lookup'); } };
  const entries = prepared.map(item => ({ item, rows: item.sources.map((_, i) => ({ id: String(i) })) }));
  assert.equal(resolveMemorySourceDates(noSql, entries, Infinity), true);
  assert.equal(meteredText(assembleContext(options(prepared)).metered), meteredText(before));
  assert.equal(meteredText(assembleThreeLayerContext(options(prepared)).metered), meteredText(before));
  assert.deepEqual(receiptSourceRows(noSql, 'memory', false, []), []);
});

test('stored receipt times on a Raw-incapable store survive all fallback coverage states', () => {
  const noSql = { prepare() { assert.fail('Raw-incapable date path must not query Raw tables'); } };
  const value = entry('receipt-only', [{ id: 'receipt', occurred_at: first }]);
  assert.equal(resolveMemorySourceDates(noSql, [value], Infinity), true);
  for (const coverage of ['unavailable', 'unsupported_store', 'partial']) {
    const result = assembleThreeLayerContext(options([value.item]), { items: [], coverage });
    assert.equal(result.metered.items[0].date, '2026-01-01T08:00Z');
    assert.equal(result.metered.items[0].sources[0].date, '2026-01-01T08:00Z');
    assert.equal(result.diagnostics.coverage.raw, coverage);
  }
});

test('coalesced Memories retain secondary receipt dates with their own Memory reference', t => {
  const { db, add } = database(t);
  add('primary', 'primary-source', first);
  add('secondary', 'secondary-first', first); add('secondary', 'secondary-last', last);
  const entries = [entry('primary', [{ id: 'primary-source', source_time_available: 1 }]),
    entry('secondary', [{ id: 'secondary-first', source_time_available: 1 }, { id: 'secondary-last', source_time_available: 1 }])];
  const turn = id => JSON.stringify([JSON.stringify([ns.ownerId, ns.scope, ns.projectId ?? '']), 'synthetic', id]);
  entries[0].item.rank = 1; entries[1].item.rank = 2;
  entries[0].item.turnIds = [turn('shared')]; entries[1].item.turnIds = [turn('shared'), turn('secondary-only')];
  resolveMemorySourceDates(db, entries, Infinity);
  const value = { namespace: ns, conversationId: 'synthetic', messageId: 'shared', role: 'user', occurredAt: first,
    ranges: [{ source: { span: { start: 0, end: 9 } }, text: 'telescope' }] };
  const raw = { items: [{ key: turn('shared'), rank: 1, value, handle: {} }], coverage: 'included',
    rawSearch: { revalidate: () => [value] } };
  const args = options(entries.map(entry => entry.item)), result = assembleThreeLayerContext(args, raw);
  assert.equal(result.metered.items.length, 1);
  const item = result.metered.items[0];
  assert.equal(item.date, '2026-01-01T08:00Z', 'the item date belongs to the primary Memory ref');
  assert.deepEqual(item.sources.map(source => source.date), ['2026-01-01T08:00Z', '2026-01-01T08:00Z', '2026-01-03T08:00Z']);
  assert.ok(item.sources.slice(1).every(source => source.memory.id === 'secondary' && source.memory.rev === 1));
  assert.equal(item.sources[0].memory, undefined);
  assert.equal(result.diagnostics.budget.used, Buffer.byteLength(meteredText(result.metered)));
});

test('expired date work discards preparation before lookup and permits a later read', t => {
  const { db, add } = database(t); add('memory', 'receipt', first);
  const entries = [entry('memory', [{ id: 'receipt', source_time_available: 1 }])];
  assert.equal(resolveMemorySourceDates({ prepare() { assert.fail('expired lookup'); } }, entries, -Infinity), false);
  assert.equal(resolveMemorySourceDates(db, entries, Infinity), true);
  assert.equal(entries[0].item.date, '2026-01-01T08:00Z');
});

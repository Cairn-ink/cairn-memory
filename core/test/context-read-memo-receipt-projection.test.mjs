import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { receiptSourceTimeProbe } from '../context-read-assembly.mjs';

// Exercise the actual bounded batch function with synthetic synchronous I/O.
// The old literal is frozen independently of the new projection selector.
const oldProjection = "json_object('id',id,'memory_id',memory_id,'receipt_key',receipt_key,\n        'client',client,'session_id',session_id,'event_id',event_id,'role',role,'excerpt',excerpt,'created_at',created_at)";
const oldSqlHashes = {"false":"a712d6694f6766617fa424a08545ed7bb368bcf3880562744a177f96a36ff7d0","true":"97b7fa560267d5c375a4c5c3bbcf414aaeb7e3135c7bfde99a2f40296db9f285"};
const source = readFileSync(new URL('../private-evidence-storage.mjs', import.meta.url), 'utf8');
const start = source.indexOf('  function memoryBatchInside(');
const end = source.indexOf('  function selectedReceiptRef(', start);
assert.ok(start >= 0 && end > start);
const namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'synthetic-project' };
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
function batch(enabled, rawLineage, suppressionRevision = 1, sourceDates = false) {
  const sql = [], args = [], db = { isTransaction: true, prepare(text) {
    sql.push(text); return { all(...values) { args.push(values); return []; } };
  } };
  const run = new Function('db', 'cachedContentLayout', 'where', 'boundary', 'memoReceiptEventTime', 'receiptSourceTimeProbe',
    'return (' + source.slice(start, end) + ');')(db, () => ({ rawLineage, suppressionRevision }), where, boundary, enabled, receiptSourceTimeProbe);
  const memo = { sourceDates }, refs = [{ type: 'memory', namespace, memoryId: 'synthetic-memory' }];
  run(namespace, refs, memo);
  run(namespace, refs, memo); // Memo reuse must not add a statement.
  return { sql, args };
}
for (const rawLineage of [false, true]) test(`memo receipt projection keeps SQL and statement count, raw=${rawLineage}`, () => {
  const zero = batch(false, rawLineage), one = batch(true, rawLineage);
  assert.equal(zero.sql.length, 1);
  assert.equal(createHash('sha256').update(zero.sql[0]).digest('hex'), oldSqlHashes[rawLineage], 'flag zero SQL matches the pre-change bytes');
  assert.equal(one.sql.length, 1, 'the feature adds no statement');
  assert.deepEqual(zero.args, one.args);
  const expected = zero.sql[0].replace(oldProjection, oldProjection.slice(0, -1) + ",'occurred_at',occurred_at)");
  assert.notEqual(expected, zero.sql[0], 'the original projection is present byte for byte');
  assert.equal(one.sql[0], expected, 'only the fixed projection differs');
  assert.match(one.sql[0], /ORDER BY created_at,id LIMIT 17/);
  assert.deepEqual(batch(false, rawLineage, 0).sql, [], 'legacy batching remains inactive');
  assert.deepEqual(batch(true, rawLineage, 0).sql, [], 'legacy fallback is unchanged');
});

test('source-date batching supplies its sliced SQL dependency without adding statements', () => {
  const value = batch(true, true, 1, true);
  assert.equal(value.sql.length, 1);
  assert.match(value.sql[0], /AS source_time_receipts/);
  assert.ok(value.sql[0].includes(receiptSourceTimeProbe));
});

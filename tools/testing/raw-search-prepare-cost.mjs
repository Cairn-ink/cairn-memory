import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { transaction } from '../../core/database.mjs';

export function rawPreparationMode(value = process.env.CAIRN_RAW_MEASURE_MODE ?? 'single') {
  assert.ok(['single', 'batch'].includes(value), 'invalid preparation measurement mode');
  return value;
}

export function preparationMemoryPopulations(mode, value = process.env.CAIRN_RAW_MEASURE_MEMORIES) {
  const counts = value === undefined ? mode === 'batch' ? [100, 20000] : [0] : value.split(',').map(Number);
  assert.ok(counts.length && new Set(counts).size === counts.length &&
    counts.every(count => Number.isSafeInteger(count) && count >= 0), 'invalid synthetic Memory populations');
  return counts;
}

// Same canonical Memory/receipt shape as the lineage builder. Unrelated events
// exercise the ancestry miss that must visit the entire namespace population.
// Seed after building the Raw index so setup is not the cost under measurement.
export function seedPreparationMemories(db, namespace, count) {
  const memory = db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,
    confidence,revision,deleted,created_at,updated_at,currentness,review_state)
    VALUES(?,?,?,?,?,?,'fact','explicit',.8,1,0,?,?,'current','none')`);
  const receipt = db.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES(?,?,?,'codex','synthetic-unrelated',?,'user',?,?)`);
  const timestamp = '2026-01-02T00:00:00.000Z';
  transaction(db, () => {
    for (let index = 0; index < count; index++) {
      const id = 'synthetic-cost-memory-' + index, text = 'Synthetic unrelated fact ' + index;
      const hash = createHash('sha256').update(text).digest('hex');
      memory.run(id, namespace.ownerId, namespace.scope, namespace.projectId ?? '', hash, text, timestamp, timestamp);
      receipt.run('synthetic-cost-receipt-' + index, id, hash, 'synthetic-unrelated-event-' + index, text, timestamp);
    }
  });
  return db.prepare('SELECT count(*) n FROM memories WHERE owner_id=? AND scope=? AND project_id=?')
    .get(namespace.ownerId, namespace.scope, namespace.projectId ?? '').n;
}

// Observe original statements in timed calls. Count visited Memory rows in a
// separate replay afterward, never by adding a per-row JS callback to timings.
// The replay must preserve both EXPLAIN's plan and the original result bytes.
export function observeReceiptAncestry({ initialSnapshot = () => false } = {}) {
  const original = DatabaseSync.prototype.prepare, groups = new Map();
  let active = null;
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = original.call(this, sql);
    if (!sql.startsWith('SELECT r.id,r.session_id FROM receipts r JOIN memories m')) return statement;
    const database = this, execute = statement.all;
    statement.all = function(...args) {
      const rows = execute.apply(this, args);
      if (active) {
        const key = JSON.stringify([active, sql, args]);
        let record = groups.get(key);
        if (!record) { record = { mode: active, database, sql, args, statements: 0, initialStatements: 0, returnedRows: 0, bytes: JSON.stringify(rows) }; groups.set(key, record); }
        assert.equal(JSON.stringify(rows), record.bytes, 'unchanged ancestry result during read-only samples');
        record.statements++; record.returnedRows += rows.length;
        if (initialSnapshot(database)) record.initialStatements++;
      }
      return rows;
    };
    return statement;
  };
  return {
    async run(mode, work) {
      assert.equal(active, null, 'measurement scopes do not overlap'); active = mode;
      try { return await work(); } finally { active = null; }
    },
    finish() {
      assert.equal(active, null);
      const output = {};
      for (const record of groups.values()) {
        const { database, sql, args, mode } = record;
        assert.ok(database.isOpen, 'count ancestry before closing its reader');
        let visits = 0;
        database.function('raw_measure_ancestry_visit', _memoryId => { visits++; return 1; });
        const counted = sql.replace('WHERE m.owner_id=?', 'WHERE raw_measure_ancestry_visit(m.id) AND m.owner_id=?');
        assert.notEqual(counted, sql, 'recognized ancestry predicate');
        const plan = query => original.call(database, 'EXPLAIN QUERY PLAN ' + query).all(...args).map(row => row.detail);
        const originalPlan = plan(sql);
        assert.deepEqual(plan(counted), originalPlan, 'counted replay preserves ancestry access plan');
        const rows = original.call(database, counted).all(...args);
        assert.equal(JSON.stringify(rows), record.bytes, 'counted replay preserves ancestry bytes');
        const result = output[mode] ??= { statements: 0, returnedRows: 0, visitedMemoryRows: 0, distinctLookups: 0,
          initialSnapshot: { statements: 0, returnedRows: 0, visitedMemoryRows: 0, distinctLookups: 0 },
          rowsPerStatement: [], plans: [], method: 'original statements; Memory visits from separate plan-and-result-checked counted replay' };
        result.statements += record.statements; result.returnedRows += record.returnedRows;
        result.visitedMemoryRows += visits * record.statements; result.distinctLookups++;
        result.initialSnapshot.statements += record.initialStatements;
        result.initialSnapshot.returnedRows += rows.length * record.initialStatements;
        result.initialSnapshot.visitedMemoryRows += visits * record.initialStatements;
        if (record.initialStatements) result.initialSnapshot.distinctLookups++;
        result.rowsPerStatement.push({ executions: record.statements, initialSnapshotExecutions: record.initialStatements,
          visitedMemoryRows: visits, returnedRows: rows.length });
        if (!result.plans.some(value => JSON.stringify(value) === JSON.stringify(originalPlan))) result.plans.push(originalPlan);
      }
      return output;
    },
    close() { DatabaseSync.prototype.prepare = original; },
  };
}

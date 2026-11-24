import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import crypto, { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { copySqliteFixture, ns, ok, quiescence, receipt, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { localPlainPort, request, splitRaw } from '../testing/raw-capture-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const add = (core, label, kind) => ok(core.admit({ namespace: ns,
  memory: { content: 'Synthetic independent memory ' + label, kind },
  receipts: [receipt(label)] })).memory;
const read = (core, memory) => core.get({ namespace: ns, memoryId: memory.id, includeAwaiting: true });

async function rawFixture(t, extraModel = {}, safety = true) {
  const f = safetyFixture(t, 33);
  if (safety) {
    copySqliteFixture(f.path, f.backupPath);
    await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base: 33 }, quiescence });
  }
  let items;
  const port = localPlainPort();
  const core = openRawCaptureCore({ path: f.path, decisionReview: 'required-v1',
    model: { ...rationaleModel(), extract: () => ({ items }), ...extraModel } },
  { mode: 'raw-v1', lineage: true, port,
    readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  f.workspace.defer(() => core.close());
  const db = f.connect();
  f.workspace.defer(() => db.close());
  if (safety) {
    attestContentSafety(db);
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 53);
  }
  function input(event, kinds, { sessionId = event, ordinal = 1 } = {}) {
    items = kinds.map((kind, i) => ({ kind, content: `I chose A: synthetic ${event} memory ${i}`, confidence: .8, sourceIndices: [0] }));
    const [raw] = splitRaw(items.map(item => item.content).join('. '), { id: event, ordinal });
    return request(raw, { namespace: ns, sessionId });
  }
  const capture = async (event, kinds, options) =>
    ok(ok(await core.captureRaw(input(event, kinds, options))).interpretation).admission.memories;
  return { ...f, core, db, port, input, capture };
}

async function deny(f, forgotten, denied) {
  const spans = f.db.prepare(`SELECT l.conversation_id,l.message_id,l.start,l.end FROM raw_receipt_lineage l
    JOIN receipts r ON r.id=l.receipt_id WHERE r.memory_id=? ORDER BY l.start,l.end`);
  const shared = spans.all(forgotten.id);
  assert.ok(shared.length);
  for (const memory of denied) {
    assert.deepEqual(spans.all(memory.id), shared);
    assert.equal(ok(read(f.core, memory)).memory.id, memory.id);
  }
  ok(f.core.forget({ namespace: ns, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  for (const memory of denied) {
    assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted, 0);
    const result = read(f.core, memory);
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, 'memory_not_found');
  }
  return { ...f, forgotten, denied };
}

async function twice(t, call, check) {
  const first = await call(), fresh = await call();
  const failures = [];
  for (const [name, result] of [['first', first], ['fresh', fresh]]) {
    try {
      check(result);
      t.diagnostic(name + ': visible result');
    } catch (error) {
      failures.push(error);
      t.diagnostic(name + ': ' + (result.error?.code ?? 'visible result differed') + ' (' + error.message + ')');
    }
  }
  if (failures.length) throw failures.at(-1);
}

for (const [group, kind] of [['procedural', 'instruction'], ['background', 'fact']]) {
  test('session ' + group + ' refills past denied rows before declaring completion', async t => {
    const f = await rawFixture(t);
    const visibleId = add(f.core, group, kind).id;
    const [forgotten, ...denied] = await f.capture('shared', ['fact', kind]);
    const [{ client, sessionId, eventId, role, excerpt }] = ok(read(f.core, forgotten)).receipts;
    const shared = { client, sessionId, eventId, role, excerpt };
    for (let i = 0; i < 12; i++) denied.push(ok(f.core.admit({ namespace: ns,
      memory: { kind, content: 'Synthetic shared group member ' + i }, receipts: [shared] })).memory);
    const update = f.db.prepare('UPDATE memories SET updated_at=? WHERE id=?');
    update.run('2020-01-01T00:00:00.000Z', visibleId);
    for (const sibling of denied) update.run('2026-01-01T00:00:00.000Z', sibling.id);
    await deny(f, forgotten, denied);
    const input = { namespace: ns, groups: { nextSteps: false, procedural: group === 'procedural',
      ...(group === 'background' ? { background: true } : {}) } };
    await twice(t, () => f.core.sessionStartContext(input), result => {
      const selected = ok(result).groups[group];
      assert.deepEqual(selected.items.map(item => item.memory.id), [visibleId]);
      assert.equal(selected.complete, true);
      for (const memory of denied) assert.ok(!JSON.stringify(result).includes(memory.id));
    });
  });
}

// Seed repeatable IDs, secrets and wall-clock values before tracing the public
// call. The digest preserves every SQL byte, invocation and bound value.
function deterministicFixture(t) {
  let id = 0;
  t.mock.method(crypto, 'randomUUID', () => '00000000-0000-4000-8000-' + String(++id).padStart(12, '0'));
  t.mock.method(crypto, 'randomBytes', size => Buffer.alloc(size, 23));
  syncBuiltinESMExports();
  t.after(() => {
    t.mock.restoreAll();
    syncBuiltinESMExports();
  });
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2025-06-01T00:00:00.000Z') });
}

function trace(t, label, read, expected, expectedBytes) {
  const statements = [], { prepare, exec } = DatabaseSync.prototype;
  DatabaseSync.prototype.exec = function (sql) {
    statements.push(['exec', sql]);
    return exec.call(this, sql);
  };
  DatabaseSync.prototype.prepare = function (sql) {
    const statement = prepare.call(this, sql);
    return new Proxy(statement, { get(target, name) {
      const value = Reflect.get(target, name, target);
      if (typeof value !== 'function') return value;
      return (...bindings) => {
        if (['get', 'all', 'run', 'iterate'].includes(name)) statements.push([name, sql, bindings]);
        return Reflect.apply(value, target, bindings);
      };
    } });
  };
  let envelope;
  try { envelope = read(); }
  finally {
    DatabaseSync.prototype.prepare = prepare;
    DatabaseSync.prototype.exec = exec;
  }
  const digest = createHash('sha256').update(JSON.stringify(statements)).digest('hex');
  t.diagnostic(label + ': ' + statements.length + ' SQL executions, ' + digest);
  const response = createHash('sha256').update(JSON.stringify(envelope)).digest('hex');
  t.diagnostic(label + ' response: ' + response);
  assert.deepEqual([statements.length, digest], expected);
  assert.equal(response, expectedBytes);
  return ok(envelope);
}

const statementTrace = {
  false: {
    'memory groups': [74, '3e6a20de842ba8a51c364080b52b820ac0f09914d441fdec790afd43459a250f'],
  },
  true: {
    'memory groups': [91, '50b84d6375a290d22d5d57719f5f5666dfbc80102b754777283d5c4b5105d6b8'],
  },
};

for (const safety of [false, true]) {
  test('session memory SQL parity with safety ' + safety, async t => {
    deterministicFixture(t);
    const f = await rawFixture(t, {}, safety);
    await f.capture('visible', ['instruction', 'fact']);
    const input = { namespace: ns, groups: { nextSteps: false, procedural: true, background: true } };
    const result = trace(t, 'memory groups', () => f.core.sessionStartContext(input), statementTrace[safety]['memory groups'], responseTrace[safety]['memory groups']);
    assert.equal(result.groups.procedural.returned, 1);
    assert.equal(result.groups.background.returned, 1);
  });
}

for (const [group, kind] of [['procedural', 'instruction'], ['background', 'fact']]) {
  test('session ' + group + ' retains a memory with one denied receipt', async t => {
    const f = await rawFixture(t);
    const memory = ok(f.core.admit({ namespace: ns,
      memory: { content: 'Synthetic retained evidence', kind },
      receipts: [receipt('withheld-ordinary'), receipt('kept-ordinary')] })).memory;
    const other = add(f.core, 'unrelated group member', kind);
    const before = ok(read(f.core, memory)).receipts;
    assert.equal(before.length, 2);
    const hidden = before.find(source => source.eventId === 'withheld-ordinary');
    const retained = before.find(source => source.eventId === 'kept-ordinary');
    transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: 'receipt', key: hidden.id,
      reason: 'user_forget', actionId: 'suppress-receipt' }));
    assert.deepEqual(ok(read(f.core, memory)).receipts, [retained]);
    const input = { namespace: ns, groups: { nextSteps: false, procedural: group === 'procedural',
      ...(group === 'background' ? { background: true } : {}) } };
    await twice(t, () => f.core.sessionStartContext(input), result => {
      const selected = ok(result).groups[group];
      assert.equal(selected.complete, true);
      assert.deepEqual(selected.items.map(item => item.memory.id).sort(), [memory.id, other.id].sort());
      assert.deepEqual(selected.items.find(item => item.memory.id === memory.id).receipts,
        [{ id: retained.id, role: retained.role, excerpt: retained.excerpt }]);
      for (const needle of [hidden.id, hidden.excerpt]) assert.ok(!JSON.stringify(result).includes(needle), needle);
    });
  });
}

for (const safety of [false, true]) {
  test('a full clean session group batch retains base SQL and response bytes with safety ' + safety, async t => {
    deterministicFixture(t);
    const f = await rawFixture(t, { countTokens: () => 1 }, safety);
    for (let i = 0; i < 13; i++) {
      add(f.core, 'instruction ' + i, 'instruction');
      add(f.core, 'background ' + i, 'fact');
    }
    const input = { namespace: ns, maxChars: 8000, backgroundBudget: { maxChars: 8000 }, groups: { nextSteps: false, procedural: true, background: true } };
    const result = trace(t, 'full groups', () => f.core.sessionStartContext(input), fullGroupTrace[safety],
      responseTrace[safety]['full groups']);
    assert.equal(result.groups.procedural.returned, 6);
    assert.equal(result.groups.background.returned, 6);
  });
}

const fullGroupTrace = {
  false: [900, '20c85e6fb401b165ebeb232fd2b07be628c8aa742c7cdfabb222470633528565'],
  true: [932, 'a84e48f69e2df9a572b075d67d2a5bda6fb762ce89b5dbcfb9bd8bb102946159']
};

const responseTrace = {
  false: {
    'memory groups': 'cee2cf82fcedb2a1c9f391fee703a84d65e39ae2826cfda9dc1c49c8143b7414',
    'full groups': 'd6b9e573e9e0eca6f614e189d2c33651156fb9005076e3779253b0c7f0a8f578'
  },
  true: {
    'memory groups': 'fe0ec999437b2f7a6b187e0b1d958235a860ff44bbf2a22fd1e72f97d3c251b8',
    'full groups': '3d134f69a4504a1e333c1584002118d3c0aae32caf90a1720afff918b61aeb59'
  }
};

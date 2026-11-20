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

const add = (core, label) => ok(core.admit({ namespace: ns,
  memory: { content: 'Synthetic independent memory ' + label, kind: 'fact' },
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

async function deniedFixture(t, kinds = ['fact'], setup) {
  const f = await rawFixture(t);
  const [forgotten, ...denied] = await f.capture('shared', ['fact', ...kinds]);
  assert.equal(denied.length, kinds.length);
  await setup?.(f, forgotten, denied);
  return deny(f, forgotten, denied);
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

test('map retains visible rows and fills pages across a denied memory', async t => {
  deterministicFixture(t);
  const f = await deniedFixture(t);
  const [visible] = await f.capture('visible-map', ['fact']);
  const another = add(f.core, 'map tail');
  const ids = [visible.id, another.id].sort();
  for (const limit of [1, 20]) {
    const input = { namespace: ns, limit };
    await twice(t, () => f.core.map(input), result => {
      const page = ok(result);
      assert.deepEqual(page.items.map(item => item.ref.memoryId), ids.slice(0, limit));
      assert.equal(page.exhausted, limit !== 1);
      assert.doesNotMatch(JSON.stringify(page), new RegExp(f.denied[0].id));
      if (limit === 1) {
        const next = ok(f.core.map({ ...input, cursor: page.nextCursor }));
        assert.deepEqual([page, next].flatMap(value => value.items.map(item => item.ref.memoryId)).sort(), ids);
        assert.equal(next.exhausted, true);
      }
    });
  }
});

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

function trace(t, label, read, expected) {
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
  let output;
  try { output = ok(read()); }
  finally {
    DatabaseSync.prototype.prepare = prepare;
    DatabaseSync.prototype.exec = exec;
  }
  const digest = createHash('sha256').update(JSON.stringify(statements)).digest('hex');
  t.diagnostic(label + ': ' + statements.length + ' SQL executions, ' + digest);
  assert.deepEqual([statements.length, digest], expected);
  return output;
}

const mapTrace = {
  false: [
    [8, 'e0e669afbbbd653beebc2990eeef519a56d99bf1c0872798bc9d1ab6c5a4207d'],
    [8, '8fce4f540885bc479356e167482595f3ed3339de05f82457ad71d8cc2814dddc'],
  ],
  true: [
    [19, 'e651a7623b8f7ba1ddf4a72fbf8d35164b9151900f39b7270b5ab5fef3657cec'],
    [19, 'fefb08b655f5e5a35cc28b47ed25ffb6ae7397d343f4f6d861247709dceb8843'],
  ],
};

for (const safety of [false, true]) {
  test('map SQL parity with safety ' + safety, async t => {
    deterministicFixture(t);
    const f = await rawFixture(t, {}, safety);
    await f.capture('visible', ['fact', 'fact']);
    const input = { namespace: ns, limit: 1 };
    const page = trace(t, 'initial', () => f.core.map(input), mapTrace[safety][0]);
    assert.ok(page.nextCursor);
    trace(t, 'continued', () => f.core.map({ ...input, cursor: page.nextCursor }), mapTrace[safety][1]);
  });
}

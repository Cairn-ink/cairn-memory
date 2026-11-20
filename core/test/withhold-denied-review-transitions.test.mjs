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
  function input(event, kinds, { sessionId = event, ordinal = 1, causal } = {}) {
    items = kinds.map((kind, i) => ({ kind, content: `I chose A: synthetic ${event} memory ${i}`, confidence: .8, sourceIndices: [0] }));
    const [raw] = splitRaw(items.map(item => item.content).join('. '), { id: event, ordinal });
    return request(raw, { namespace: ns, sessionId, ...(causal ? { causal } : {}) });
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

async function transitions(t, safety = true) {
  let target;
  const f = await rawFixture(t, {
    reconcile: ({ input }) => ({ transitions: target ? [{ replacementIndex: 0,
      predecessorIndex: input.candidates.findIndex(candidate => candidate.content === target),
      evidenceIndices: [0], relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] : [] }),
  }, safety);
  const capture = (event, kinds, sequence) => f.capture(event, kinds, { causal: { streamId: 'review', sequence } });
  const [forgotten, denied] = await capture('shared', ['fact', 'context'], 1);
  const [independent] = await capture('independent', ['context'], 2);
  // Both decisions must be captured before their independent confirmation
  // receipts make the ordered reconciliation stream ineligible.
  target = ok(read(f.core, denied)).memory.content;
  const [first] = await capture('denied-transition', ['decision'], 3);
  target = ok(read(f.core, independent)).memory.content;
  const [second] = await capture('visible-transition', ['decision'], 4);
  for (const [memory, predecessor, event] of [[first, denied, 'denied'], [second, independent, 'visible']]) {
    const result = ok(f.core.confirm({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      actionId: event, receipt: receipt(event + '-confirmation') }));
    assert.equal(result.reviewEffects.transitions[0]?.predecessor?.memoryId, predecessor.id, JSON.stringify(result.reviewEffects));
  }
  return { ...f, forgotten, denied, visible: second };
}

test('review transition pages keep resolved rows with visible provenance', async t => {
  const f = await transitions(t);
  const input = { namespace: ns, status: 'all', limit: 1 };
  assert.equal(ok(f.core.listReviewTransitions({ ...input, limit: 20 })).transitions.length, 2);
  await deny(f, f.forgotten, [f.denied]);
  await twice(t, () => f.core.listReviewTransitions(input), result => {
    const page = ok(result);
    assert.deepEqual(page.transitions.map(row => row.replacement.memoryId), [f.visible.id]);
    assert.equal(page.exhausted, true);
    assert.equal(page.nextCursor, null);
    assert.ok(!JSON.stringify(result).includes(f.denied.id));
  });
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

const statementTrace = {
  false: {
    'initial': [4, '425195edd67b1171350b3114a8309e67ec70fdfdc05017a727e2ba7d9e12ca14'],
    'continued': [4, 'cd10136e7926cfa9b51ab892847e438fd8160d7244b747c40981b989ffcbd8ca'],
  },
  true: {
    'initial': [27, '037cf8962dc9abc46a54efad8a795f2482e06aa2f7fcc2653b35253c3ef4c91d'],
    'continued': [21, '6ba8e6758f38b70eec4203ea6d0b424e01a12e739de375617f7755d73d2e98dc'],
  },
};

for (const safety of [false, true]) {
  test('transition SQL parity with safety ' + safety, async t => {
    deterministicFixture(t);
    const f = await transitions(t, safety);
    const input = { namespace: ns, status: 'all', limit: 1 };
    const page = trace(t, 'initial', () => f.core.listReviewTransitions(input), statementTrace[safety]['initial']);
    assert.ok(page.nextCursor);
    trace(t, 'continued', () => f.core.listReviewTransitions({ ...input, cursor: page.nextCursor }), statementTrace[safety]['continued']);
  });
}

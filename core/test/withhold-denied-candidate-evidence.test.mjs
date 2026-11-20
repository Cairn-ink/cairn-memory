import crypto, { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { lineageHost } from '../testing/card-lineage-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { migrateCardLineage } from '../content-safety-migration.mjs';
import { attestContentSafety } from '../content-safety-schema.mjs';
import { copySqliteFixture, ns, ok, quiescence, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { localPlainPort, request, splitRaw } from '../testing/raw-capture-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const read = (core, memory) => core.get({ namespace: ns, memoryId: memory.id, includeAwaiting: true });

async function rawFixture(t, privateCards, safety = true) {
  const f = safetyFixture(t, 33);
  if (safety) {
    copySqliteFixture(f.path, f.backupPath);
    await migrateCardLineage({ path: f.path, backupPath: f.backupPath,
      expected: { storeId: f.storeId, base: 33 }, quiescence });
  }
  let items;
  const port = localPlainPort();
  const core = openRawCaptureCore({ path: f.path, decisionReview: 'required-v1', ...(privateCards ? { privateCards } : {}),
    model: { ...rationaleModel(), extract: () => ({ items }) } },
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

import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { accessDigest } from '../context-product-validation.mjs';

const readSet = [ns];
const access = { accessGenerations: accessDigest({ ownerId: ns.ownerId, namespaces: { readSet } }),
  check() {}, envelope: work => work() };
const ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic',
  requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
const ref = ({ id, revision }) => ({ namespace: ns, type: 'memory', memoryId: id, revision });

test('product evidence retains the visible member of a mixed reference request', async t => {
  const f = await rawFixture(t);
  const [forgotten, denied] = await f.capture('shared', ['fact', 'fact']);
  const [visible] = await f.capture('visible', ['fact']);
  const facade = openContextProductFacade(f.path, { authorize: () => access });
  t.after(() => facade.close());
  const input = { readSet, intent: 'current', refs: [ref(denied), ref(forgotten), ref(visible)] };
  const before = ok(facade.fetchCandidateEvidence(input));
  assert.equal(before.items.length, 3);
  await deny(f, forgotten, [denied]);
  await twice(t, () => facade.fetchCandidateEvidence(structuredClone(input)), result => {
    const value = ok(result);
    assert.deepEqual(value.items.map(item => item.ref.memoryId), [visible.id]);
    const payload = JSON.parse(Buffer.from(value.snapshot.split('.')[0], 'base64url').toString());
    for (const output of [value, payload]) {
      assert.ok(!JSON.stringify(output).includes(denied.id));
      assert.ok(!JSON.stringify(output).includes(forgotten.id));
    }
  });
  const fresh = ok(facade.fetchCandidateEvidence(input));
  assert.deepEqual(ok(facade.fetchCandidateEvidence({ readSet, snapshot: fresh.snapshot })).items, fresh.items);
  assert.equal(facade.fetchCandidateEvidence({ readSet, snapshot: before.snapshot }).error?.code, 'snapshot_stale');
  assert.equal(facade.fetchCandidateEvidence({ ...input, refs: [ref(denied)] }).error?.code, 'evidence_unavailable');
});

test('product index refresh retains visible Memory and Card search results', async t => {
  const host = lineageHost(), f = await rawFixture(t, host.options);
  const [forgotten, denied] = await f.capture('shared', ['fact', 'fact']);
  const [visible] = await f.capture('visible', ['fact']);
  function card(label) {
    const draft = ok(host.call(f.core, 'createCardDraft', { namespace: ns, actionId: label + '-draft',
      drafting: 'authored', input: { title: 'Synthetic ' + label, body: 'Synthetic ' + label + ' body',
        authoredInput: { text: 'Synthetic ' + label + ' source', occurredAt: null } } }));
    return ok(host.call(f.core, 'confirmCardDraft', { namespace: ns, cardId: draft.id,
      expectedRevision: draft.revision, actionId: label + '-confirm', applicability: 'current' }));
  }
  const hiddenCard = card('hidden'), visibleCard = card('visible');
  const facade = openContextProductFacade(f.path, { authorize: () => access });
  t.after(() => facade.close());
  const product = openProductIndex({ path: f.path, facade, authorize: () => access, maintenance: true,
    counter: { id: 'synthetic', countTokens: () => 1 }, ownerCoverage });
  t.after(() => product.close());
  const types = ['memory', 'card'], query = { readSet, types, intent: 'current', query: 'synthetic', deadlineMs: 5000 };
  const refresh = { readSet, types, intent: 'current', mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } };
  async function build() {
    for (let i = 0; i < 30; i++) {
      const result = await product.run('refreshContextIndex', structuredClone(refresh));
      if (!result.ok || result.value.status === 'complete') return result;
    }
    assert.fail('product refresh did not complete');
  }
  const ids = result => ok(result).items.map(item => item.ref.memoryId ?? item.ref.cardId).sort();
  assert.equal(ok(await build()).status, 'complete');
  assert.deepEqual(ids(product.run('findCandidates', query)), [forgotten.id, denied.id, visible.id, hiddenCard.id, visibleCard.id].sort());
  await deny(f, forgotten, [denied]);
  transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: 'card', key: hiddenCard.id,
    reason: 'privacy_erase', actionId: 'synthetic-denial' }));
  await twice(t, build, result => {
    assert.equal(ok(result).status, 'complete');
    const found = product.run('findCandidates', query);
    assert.deepEqual(ids(found), [visible.id, visibleCard.id].sort());
    assert.ok(!JSON.stringify(found).includes(denied.id));
    assert.ok(!JSON.stringify(found).includes(hiddenCard.id));
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
    'explicit refs': [80, 'f30370eef3b1bf655c7ae6306a755cf39c182cecfecceb6cc460b472920da78b'],
    'snapshot': [80, 'f30370eef3b1bf655c7ae6306a755cf39c182cecfecceb6cc460b472920da78b'],
  },
  true: {
    'explicit refs': [42, '893a418e2d86cbd55e0be00531eb024d6153caf1582c47e407d260271eafe525'],
    'snapshot': [42, '893a418e2d86cbd55e0be00531eb024d6153caf1582c47e407d260271eafe525'],
  },
};

for (const safety of [false, true]) {
  test('candidate evidence SQL parity with safety ' + safety, async t => {
    deterministicFixture(t);
    const f = await rawFixture(t, undefined, safety);
    const [a, b] = await f.capture('visible', ['fact', 'fact']);
    const facade = openContextProductFacade(f.path, { authorize: () => access });
    t.after(() => facade.close());
    const result = trace(t, 'explicit refs', () => facade.fetchCandidateEvidence({ readSet, intent: 'current', refs: [ref(a), ref(b)] }), statementTrace[safety]['explicit refs']);
    assert.equal(result.items.length, 2);
    trace(t, 'snapshot', () => facade.fetchCandidateEvidence({ readSet, snapshot: result.snapshot }), statementTrace[safety]['snapshot']);
  });
}

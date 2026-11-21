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
import { copySqliteFixture, ns, ok, quiescence, receipt, safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
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
    const result = trace(t, 'explicit refs', () => facade.fetchCandidateEvidence({ readSet, intent: 'current', refs: [ref(a), ref(b)] }), statementTrace[safety]['explicit refs'], responseTrace[safety]['explicit refs']);
    assert.equal(result.items.length, 2);
    trace(t, 'snapshot', () => facade.fetchCandidateEvidence({ readSet, snapshot: result.snapshot }), statementTrace[safety]['snapshot'], responseTrace[safety]['snapshot']);
  });
}

const claim = text => ({ version: 1,
  slot: { subject: 'I', property: 'transport', scope: null, applies: null },
  value: 'violet tram', attribution: 'direct', commitment: 'adopted',
  anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
    fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] });

for (const qualified of [false, true]) {
  test('candidate evidence handles a denied ' + (qualified ? 'qualification receipt' : 'ordinary receipt'), async t => {
    const f = await rawFixture(t);
    const deniedSource = { ...receipt('protected-source'), excerpt: 'Synthetic protected receipt excerpt' };
    const visibleSource = { ...receipt('kept-source'), excerpt: 'Synthetic kept receipt excerpt' };
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic candidate claim', kind: 'fact' },
      receipts: [deniedSource, visibleSource], ...(qualified ? { qualification: claim(deniedSource.excerpt) } : {}) })).memory;
    const unrelated = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic other candidate', kind: 'fact' },
      receipts: [receipt('another-source')] })).memory;
    const before = ok(read(f.core, memory)).receipts;
    assert.equal(before.length, 2);
    const hidden = before.find(source => source.eventId === deniedSource.eventId);
    const retained = before.find(source => source.eventId === visibleSource.eventId);
    const facade = openContextProductFacade(f.path, { authorize: () => access });
    t.after(() => facade.close());
    const input = { readSet, intent: 'current', refs: [ref(memory), ref(unrelated)] };
    assert.equal(ok(facade.fetchCandidateEvidence(input)).items.length, 2);
    transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: 'receipt', key: hidden.id,
      reason: 'user_forget', actionId: 'suppress-candidate-receipt' }));
    assert.deepEqual(ok(read(f.core, memory)).receipts, [retained]);
    if (qualified) {
      assert.equal(f.core.get({ namespace: ns, memoryId: memory.id, includeQualification: true }).error?.code, 'revision_conflict');
      assert.equal(facade.fetchCandidateEvidence({ ...input, refs: [ref(memory)] }).error?.code, 'revision_conflict');
    }
    await twice(t, () => facade.fetchCandidateEvidence(input), result => {
      const value = ok(result);
      assert.deepEqual(value.items.map(item => item.ref.memoryId), qualified ? [unrelated.id] : [memory.id, unrelated.id]);
      if (!qualified) {
        const { provenance } = value.items[0];
        assert.deepEqual(provenance.sources.map(source => source.receiptId), [retained.id]);
        assert.deepEqual(provenance.receiptMetadata.map(source => source.receiptId), [retained.id]);
        assert.deepEqual(provenance.coverage, { status: 'complete', included: 1, omitted: 0 });
      }
      const revalidated = facade.fetchCandidateEvidence({ readSet, snapshot: value.snapshot });
      assert.deepEqual(ok(revalidated).items, value.items);
      for (const envelope of [result, revalidated]) {
        const cursor = Buffer.from(ok(envelope).snapshot.split('.')[0], 'base64url').toString('utf8');
        for (const needle of [hidden.id, hidden.excerpt, ...(qualified ? [memory.id, memory.content] : [])]) {
          assert.ok(!JSON.stringify(envelope).includes(needle), needle);
          assert.ok(!cursor.includes(needle), needle);
        }
      }
    });
  });
}

test('an explicitly fenced denied candidate retains the exact refusal', async t => {
  const f = await rawFixture(t);
  const [forgotten, denied] = await f.capture('shared', ['fact', 'fact']);
  const [visible] = await f.capture('visible', ['fact']);
  const facade = openContextProductFacade(f.path, { authorize: () => access });
  t.after(() => facade.close());
  const input = { readSet, intent: 'current', refs: [ref(denied), ref(visible)] };
  const before = ok(facade.fetchCandidateEvidence(input));
  const payload = JSON.parse(Buffer.from(before.snapshot.split('.')[0], 'base64url').toString('utf8'));
  const fences = [payload.fences[0].slice(0, 8), null];
  assert.equal(ok(facade.fetchCandidateEvidence({ ...input, fences })).items.length, 2);
  await deny(f, forgotten, [denied]);
  await twice(t, () => facade.fetchCandidateEvidence({ ...input, fences }), result => {
    assert.deepEqual(result, facade.fetchCandidateEvidence({ ...input, refs: [ref(denied)], fences: fences.slice(0, 1) }));
    assert.equal(result.error?.code, 'evidence_unavailable');
  });
});

test('an all-denied candidate batch revalidates its empty snapshot', async t => {
  const f = await rawFixture(t);
  const [forgotten, denied, other] = await f.capture('shared', ['fact', 'fact', 'fact']);
  await deny(f, forgotten, [denied, other]);
  const facade = openContextProductFacade(f.path, { authorize: () => access });
  t.after(() => facade.close());
  await twice(t, () => facade.fetchCandidateEvidence({ readSet, intent: 'current', refs: [ref(denied), ref(other)] }), result => {
    const value = ok(result);
    assert.deepEqual(value.items, []);
    const payload = JSON.parse(Buffer.from(value.snapshot.split('.')[0], 'base64url').toString('utf8'));
    assert.deepEqual(payload.refs, []);
    assert.deepEqual(payload.fences, []);
    assert.deepEqual(facade.fetchCandidateEvidence({ readSet, snapshot: value.snapshot }), result);
  });
});

const responseTrace = {
  false: {
    'explicit refs': 'd56d7a9eb14846c1f0f0577dc5679c03fcb9158a2834962672e0a1d044783767',
    'snapshot': 'd56d7a9eb14846c1f0f0577dc5679c03fcb9158a2834962672e0a1d044783767'
  },
  true: {
    'explicit refs': '1436a5cc7954671c0e1d32949d368cadba0e5528230d9483fbbbf16b20a14443',
    'snapshot': '1436a5cc7954671c0e1d32949d368cadba0e5528230d9483fbbbf16b20a14443'
  }
};

test('product context references refetch ordinary evidence after a receipt is denied', async t => {
  const f = await rawFixture(t);
  const memory = ok(f.core.admit({ namespace: ns,
    memory: { kind: 'fact', content: 'Synthetic retained orchard evidence' },
    receipts: [receipt('protected-orchard-receipt'), receipt('visible-orchard-receipt')] })).memory;
  const before = ok(read(f.core, memory)).receipts;
  const denied = before.find(source => source.eventId === 'protected-orchard-receipt');
  const visible = before.find(source => source.eventId === 'visible-orchard-receipt');
  const facade = openContextProductFacade(f.path, { authorize: () => access });
  t.after(() => facade.close());
  const stale = ok(facade.fetchCandidateEvidence({ readSet, refs: [ref(memory)], intent: 'current' })).snapshot;
  transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns, kind: 'receipt', key: denied.id,
    reason: 'user_forget', actionId: 'suppress-orchard-receipt' }));
  assert.equal(facade.fetchCandidateEvidence({ readSet, snapshot: stale }).error?.code, 'snapshot_stale');
  const product = openProductIndex({ path: f.path, facade, authorize: () => access, maintenance: true,
    counter: { id: 'synthetic', countTokens: () => 1 }, ownerCoverage });
  t.after(() => product.close());
  const projection = { readSet, types: ['memory'], intent: 'current' };
  const refresh = { ...projection, mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } };
  let status;
  for (let i = 0; i < 30 && status !== 'complete'; i++) {
    status = ok(await product.run('refreshContextIndex', refresh)).status;
  }
  assert.equal(status, 'complete');
  const context = ok(await product.run('contextRead', { ...projection, query: 'orchard', raw: false,
    budget: { maxItems: 12, maxTokens: 4000 } }));
  const payload = JSON.parse(Buffer.from(context.snapshot.split('.')[0], 'base64url').toString('utf8'));
  assert.deepEqual(payload.refs, [[0, 'memory', memory.id, memory.revision]]);
  const explicit = { readSet, intent: 'current', refs: [ref(memory)], fences: [payload.fences[0].slice(0, 8)] };
  for (const input of [{ readSet, snapshot: context.snapshot }, explicit]) {
    await twice(t, () => facade.fetchCandidateEvidence(input), result => {
      const [item] = ok(result).items;
      assert.equal(item.ref.memoryId, memory.id);
      assert.deepEqual(item.provenance.receiptMetadata.map(source => source.receiptId), [visible.id]);
      assert.ok(!JSON.stringify(result).includes(denied.id));
      assert.ok(!JSON.stringify(result).includes(denied.excerpt));
    });
  }
});

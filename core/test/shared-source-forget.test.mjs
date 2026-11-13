import { readFileSync } from 'node:fs';
import { sourceEvidence } from '../source-evidence.mjs';
import { model as episodeModel, input as episodeCaptureInput } from '../testing/episode-capture-helpers.mjs';
import { options as episodeOptions } from '../testing/episode-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { sourceDigest } from '../procedural-storage.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { lineageFixture, lineageHost, ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { host as contextHost } from '../testing/context-read-core-fixture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { configured, descriptor } from '../testing/context-product-owner-fixture.mjs';
import { contentSafetyFacade } from '../content-safety-boundary.mjs';
import { transaction, readTransaction } from '../database.mjs';
import { receiptDeliverySnapshot, createContentReadMemo, receiptReadSafety } from '../content-safety.mjs';
import { receiptDenialsInside, receiptDenialTokens } from '../content-safety.mjs';

const survivor = 'Synthetic surviving signal';
const forgotten = 'Synthetic sibling secret';
const message = survivor + '. ' + forgotten + '.';
const independent = 'Synthetic independent support';
const ordinaryKinds = ['ordinary-53', 'ordinary-48', 'ordinary-33', 'fresh-default', 'fresh-cards'];
const kinds = [...ordinaryKinds, 'raw-53', 'raw-33'];
const operations = ['forget', 'correct', 'reject'];
const normalize = sql => sql.replace(/\s+/g, ' ').trim();
const insertSQL = 'INSERT OR IGNORE INTO suppressed(owner_id,scope,project_id,fingerprint) SELECT ?,?,?,value FROM json_each(?)';
const receiptSQL = 'SELECT r.id,r.receipt_key,r.client,r.session_id,r.event_id,r.role FROM receipts r WHERE r.memory_id=? AND EXISTS( SELECT 1 FROM memories m WHERE m.id=r.memory_id AND m.owner_id=? AND m.scope=? AND m.project_id=?)';
const lookupSQL = 'SELECT s.fingerprint,1 AS denied FROM json_each(?) w CROSS JOIN suppressed s WHERE s.owner_id=? AND s.scope=? AND s.project_id=? AND s.fingerprint=w.value';
const isLookup = row => row.sql === lookupSQL || row.sql.startsWith('SELECT s.owner_id,s.scope,s.project_id,s.fingerprint FROM json_each(?)');
const source = (excerpt = message) => ({ client: 'synthetic', sessionId: 'synthetic-session',
  eventId: 'synthetic-message', role: 'user', excerpt });
const otherNamespace = { ...ns, projectId: 'synthetic-other-project' };
const otherOwner = { ...ns, ownerId: 'synthetic-other-owner' };
const key = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const noLeak = (result, label) => assert.equal(JSON.stringify(result).includes(forgotten), false, label);
const hasId = (result, id) => JSON.stringify(result).includes(id);

// Serial, in-process execution tracing; no additional SQLite connection or
// file descriptor is opened by the meter. Restore prototypes even on failure.
async function trace(call, after = () => {}) {
  const methods = new Map(['get', 'all', 'run', 'iterate'].map(name => [name, StatementSync.prototype[name]]));
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare, databases = new WeakMap(), snapshots = new WeakMap(), rows = [];
  let nextSnapshot = 0;
  DatabaseSync.prototype.prepare = function (...args) {
    const statement = Reflect.apply(prepare, this, args); databases.set(statement, this); return statement;
  };
  for (const [name, original] of methods) StatementSync.prototype[name] = function (...args) {
    const sql = normalize(this.sourceSQL);
    rows.push({ sql, args, snapshot: snapshots.get(databases.get(this)) });
    const result = Reflect.apply(original, this, args);
    after(sql, args, databases.get(this));
    return result;
  };
  DatabaseSync.prototype.exec = function (sql) {
    if (/^BEGIN(?: |$)/.test(sql.trim())) snapshots.set(this, ++nextSnapshot);
    rows.push({ sql: normalize(sql), args: [], snapshot: snapshots.get(this) });
    return Reflect.apply(exec, this, [sql]);
  };
  try { return { result: await call(), rows }; }
  finally {
    for (const [name, original] of methods) StatementSync.prototype[name] = original;
    DatabaseSync.prototype.exec = exec;
    DatabaseSync.prototype.prepare = prepare;
  }
}

function scripted(operation) {
  const model = { contextWindow: 8192, countTokens: text => Math.ceil(String(text).length / 4), offered: [],
    items: [
      { content: survivor, kind: 'fact', confidence: .8, sourceIndices: [0] },
      { content: forgotten, kind: operation === 'reject' ? 'decision' : 'fact', confidence: .8, sourceIndices: [0] },
    ],
    extract() { return { items: this.items }; },
    select({ input }) {
      const refs = [];
      for (const page of input.maps) for (const item of page.items) {
        const ref = item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
          ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
        if (ref) refs.push({ namespaceIndex: page.namespaceIndex, ...ref });
      }
      model.offered.push(...refs);
      return { refs };
    },
    rank: ({ input }) => { if (model.denyWording) noLeak(input, 'actual rank request'); return { refs: input.candidates.map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
      memoryId: candidate.memory.id, revision: candidate.memory.revision })) }; },
  };
  // Avoid relying on a host function's `this` binding.
  model.extract = () => ({ items: model.items });
  return model;
}

async function fixture(t, kind, operation = 'forget') {
  const model = scripted(operation), trusted = contextHost();
  const options = { model, decisionReview: 'required-v1' };
  let f, core, host, path;
  if (kind.endsWith('-53')) {
    // Same migration path as the supplied sealed-lineage probe, but the
    // ordinary-53 cases call capture(), never captureRaw(). This reaches 53
    // through migrateCardLineage(base=33), without enabling receipt event time.
    f = await lineageFixture(t, { base: 33, raw: kind === 'raw-53', options });
    ({ core, host, path } = f);
  } else if (kind.startsWith('fresh-')) {
    path = join(createTestWorkspace(t, { prefix: 'shared-source-' }).path, 'store.sqlite');
    host = kind === 'fresh-cards' ? lineageHost() : null;
    core = openMemoryCore({ path, ...options, ...(host ? { privateCards: host.options } : {}) });
  } else {
    f = safetyFixture(t, 33);
    if (kind === 'ordinary-48') await f.migrate();
    path = f.path; host = lineageHost();
    const config = { path, ...options, privateCards: host.options };
    core = kind === 'raw-33' ? openRawCaptureCore(config, { mode: 'raw-v1', sources: true, deletion: true,
      port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) }) : openMemoryCore(config);
  }
  const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  const expected = { 'ordinary-53': 53, 'raw-53': 53, 'raw-33': 33, 'ordinary-48': 48, 'ordinary-33': 33,
    'fresh-default': 18, 'fresh-cards': 23 }[kind];
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, expected);
  const call = host ? (method, input) => host.call(core, method, input) : null;
  const context = openMemoryCore({ path, ...(host ? { privateCards: host.options } : {}), contextRead: {
    version: 'context-read-v1', authority: trusted.authority,
    counter: { id: 'synthetic', countTokens: () => 1 },
  } });
  t.after(() => context.close());
  return { ...f, core, model, db, path, host, call, context, trusted, kind };
}

async function capture(f, eventId = 'synthetic-batch', text = message, namespace = ns) {
  if (f.kind.startsWith('raw-')) {
    const captured = ok(await f.core.captureRaw(request(splitRaw(text)[0], { namespace })));
    const interpretation = captured.interpretation;
    return (interpretation.ok === undefined ? interpretation : ok(interpretation)).admission.memories;
  }
  const captured = ok(await f.core.capture({ namespace, client: 'synthetic', sessionId: 'synthetic-session', eventId,
    messages: [{ id: 'synthetic-message', role: 'user', content: text }] }));
  if (markers(f, namespace).length) noLeak(captured, 'capture result with denied source');
  return captured.admission.memories;
}
function act(f, operation, memory) {
  f.model.denyWording = true;
  const input = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision };
  return operation === 'correct' ? f.core.correct({ ...input, content: 'Synthetic corrected sibling', kind: 'fact',
    receipt: receipt('synthetic-correction') }) : f.core[operation]({ ...input,
    ...(operation === 'reject' ? { actionId: 'synthetic-rejection' } : {}) });
}
function markers(f, namespace = ns) {
  return f.db.prepare("SELECT fingerprint FROM suppressed WHERE owner_id=? AND scope=? AND project_id=? AND fingerprint GLOB 'rs1:*' ORDER BY fingerprint")
    .all(namespace.ownerId, namespace.scope, namespace.projectId ?? '').map(row => row.fingerprint);
}
function memoryRef(memory) { return { type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }; }
function originalRow(f, memory) { return f.db.prepare('SELECT * FROM memories WHERE id=?').get(memory.id); }

async function refreshContext(f) {
  const refreshed = await f.trusted.call(f.context, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current',
    budget: { maxItems: 1024, maxMs: 5000 } });
  if (!refreshed.ok && (f.kind.endsWith('-53') || f.kind === 'ordinary-48')) assert.equal(refreshed.error?.code, 'index_unavailable');
  else ok(refreshed);
}

async function reads(f, memory, expectedReceipts) {
  const get = ok(f.core.get({ namespace: ns, memoryId: memory.id, includeQualification: true }));
  assert.equal(get.memory.content, survivor);
  assert.equal(get.memory.revision, memory.revision);
  assert.deepEqual(get.receipts.map(row => row.excerpt), expectedReceipts);
  const values = { get,
    list: ok(f.core.list({ namespace: ns, limit: 20 })),
    recall: ok(await f.core.recall({ readSet: [ns], query: survivor, limit: 8 })),
    map: ok(f.core.map({ namespace: ns, purpose: 'recall' })),
    fetch: ok(f.core.fetch({ namespace: ns, refs: [{ memoryId: memory.id, revision: memory.revision }], tokenBudget: 4000 })),
    sourceFetch: ok(f.core.fetch({ namespace: ns, refs: [{ memoryId: memory.id, revision: memory.revision }],
      contextMode: 'source-evidence', tokenBudget: 4000 })),
    sourceRecall: ok(await f.core.recall({ readSet: [ns], query: survivor, limit: 8, contextMode: 'source-evidence' })),
  };
  assert.ok(f.model.offered.some(ref => ref.memoryId === memory.id), 'scripted selector was offered B');
  for (const name of ['recall', 'fetch', 'sourceFetch', 'sourceRecall']) {
    const item = (values[name].memories ?? values[name].items).find(item => item.memory.id === memory.id);
    assert.ok(item, name + ' returns B');
    assert.deepEqual(item.receipts.map(row => row.excerpt), expectedReceipts, name + ' receipt list');
    assert.equal(item.memory.revision, memory.revision);
  }
  if (f.call) {
    values.selectEvidence = ok(await f.call('selectEvidence', { intent: 'current', query: 'Synthetic', types: ['memory'], limit: 24 }));
    values.fetchEvidence = ok(await f.call('fetchEvidence', { intent: 'current', refs: [memoryRef(memory)] }));
    const item = values.fetchEvidence.items[0];
    assert.equal(item.content, survivor);
    assert.equal(item.provenance.sources.length, expectedReceipts.length);
    assert.equal(item.provenance.receiptMetadata.length, expectedReceipts.length);
    values.revalidateEvidence = ok(await f.call('revalidateEvidence', { snapshot: values.fetchEvidence.snapshot }));
    for (const ref of item.provenance.sources) {
      const resolved = ok(await f.call('getSource', { source: ref }));
      noLeak(resolved, 'independent source resolution');
      assert.ok(JSON.stringify(resolved).includes(independent));
    }
  } else {
    assert.equal(f.core.selectEvidence, undefined, 'default layout exposes no private Cards API');
    assert.equal(f.core.fetchEvidence, undefined);
  }
  await refreshContext(f);
  values.contextRead = ok(await f.trusted.call(f.context, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current',
    query: 'Synthetic', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } }));
  for (const [name, value] of Object.entries(values)) {
    noLeak(value, name);
    assert.ok(hasId(value, memory.id), name + ' includes B');
  }
  if (expectedReceipts.length) assert.ok(JSON.stringify(values.contextRead).includes(independent), 'context keeps independent evidence');
  return values;
}

for (const kind of ordinaryKinds) for (const operation of operations) for (const extra of [false, true])
test(`shared source ${kind} ${operation}, independent=${extra}`, async t => {
  const f = await fixture(t, kind, operation);
  let [b, a] = await capture(f);
  if (extra) b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-independent', independent)] })).memory;
  const before = originalRow(f, b);
  const deniedReceipt = f.db.prepare('SELECT * FROM receipts WHERE memory_id=? AND excerpt=?').get(b.id, message);
  let oldRef;
  if (f.call) oldRef = ok(await f.call('fetchEvidence', { intent: 'current', refs: [memoryRef(b)] }))
    .items[0].provenance.sources.find(ref => ref.receiptId === deniedReceipt.id);
  ok(await act(f, operation, a));
  assert.deepEqual(originalRow(f, b), before, 'B statement, revision and all stored Memory fields unchanged');
  assert.equal(markers(f).length, 2);
  assert.ok(markers(f).every(token => /^rs1:[ia]:[0-9a-f]{64}$/.test(token)), 'content-free disjoint domains');
  const values = await reads(f, b, extra ? [independent] : []);
  for (const value of Object.values(values)) assert.equal(hasId(value, deniedReceipt.id), false, 'denied reference omitted');
  if (oldRef) {
    const empty = ok(await f.call('getSource', { source: oldRef }));
    assert.deepEqual(empty, { source: null, parts: [], coverage: { status: 'complete', completeness: oldRef.completeness,
      conversationCoverage: 'unknown', included: 0, omitted: 0 }, nextCursor: null });
    noLeak(empty, 'saved source reference');assert.equal(hasId(empty, deniedReceipt.id), false);
  }
});

for (const kind of ordinaryKinds) for (const operation of operations)
test(`shared source replay and isolation ${kind} ${operation}`, async t => {
  const f = await fixture(t, kind, operation), [b, a] = await capture(f);
  const others = [otherNamespace, otherOwner].map(namespace => ({ namespace,
    memory: ok(f.core.admit({ namespace, memory: { content: survivor, kind: 'fact' }, receipts: [source()] })).memory }));
  ok(await act(f, operation, a));
  const tokens = markers(f);
  f.model.items = [{ content: 'Synthetic newly extracted signal', kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const [newMemory] = await capture(f, 'synthetic-new-batch', forgotten + '. Different excerpt window.');
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(newMemory.id).n, 1, 'capture stores the denied attachment');
  assert.deepEqual(ok(f.core.get({ namespace: ns, memoryId: newMemory.id })).receipts, [], 'address denies a changed window');
  f.model.items = [{ content: survivor, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const [attached] = await capture(f, 'synthetic-attachment', forgotten + '. Another excerpt window.');
  assert.equal(attached.id, b.id, 'attaching denied evidence succeeds');
  assert.deepEqual(ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts, []);
  assert.deepEqual(markers(f), tokens, 'capture adds no marker/provenance writes');
  for (const { namespace, memory } of others) {
    assert.equal(ok(f.core.get({ namespace, memoryId: memory.id })).receipts[0].excerpt, message);
    assert.deepEqual(markers(f, namespace), []);
  }
  const unrelated = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic unrelated fingerprint', kind: 'fact' },
    receipts: [receipt('synthetic-unrelated')] })).memory;
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: unrelated.id })).memory.revision, unrelated.revision);
  const late = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic later sibling', kind: 'fact' }, receipts: [source()] })).memory;
  assert.deepEqual(ok(f.core.get({ namespace: ns, memoryId: late.id })).receipts, [], 'denial predates this sibling');
});

async function withoutMarkers(f, work) {
  const retained = markers(f);
  f.db.prepare("DELETE FROM suppressed WHERE owner_id=? AND scope=? AND project_id=? AND fingerprint GLOB 'rs1:*'")
    .run(ns.ownerId, ns.scope, ns.projectId);
  try { return await work(); }
  finally { for (const token of retained) f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, token); }
}

for (const operation of operations) test(`Raw keeps existing cascade ${operation}`, async t => {
  const f = await fixture(t, 'raw-53', operation), [b, a] = await capture(f);
  ok(await act(f, operation, a));
  assert.equal(markers(f).length, 2);
  const get = f.core.get({ namespace: ns, memoryId: b.id });
  assert.equal(get.error?.code, 'memory_not_found'); noLeak(get, 'Raw get');
  const list = f.core.list({ namespace: ns, limit: 20 });
  assert.equal(list.error?.code, 'revision_conflict'); noLeak(list, 'Raw list');
  for (const method of ['selectEvidence', 'fetchEvidence']) {
    const value = await f.call(method, method === 'fetchEvidence' ? { intent: 'current', refs: [memoryRef(b)] }
      : { intent: 'current', query: 'Synthetic', types: ['memory'], limit: 24 });
    assert.equal(value.error?.code, 'evidence_unavailable'); noLeak(value, method);
  }
  const recallInput = { readSet: [ns], query: survivor, limit: 8 };
  const recall = ok(await f.core.recall(recallInput));
  const control = ok(await withoutMarkers(f, () => f.core.recall(recallInput)));
  assert.deepEqual(recall, control, 'successful Raw recall matches the unchanged Raw facts without markers');
  assert.equal(hasId(recall, b.id), false); noLeak(recall, 'Raw recall');
  const map = f.core.map({ namespace: ns, purpose: 'recall' });
  assert.equal(map.error?.code, 'evidence_unavailable');
  assert.equal(hasId(map, b.id), false); noLeak(map, 'Raw map');
  await refreshContext(f);
  const context = ok(await f.trusted.call(f.context, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current',
    query: 'Synthetic', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } }));
  assert.equal(hasId(context, b.id), false); noLeak(context, 'Raw context');
});

for (const operation of operations) test(`unpackaged Raw withholds evidence ${operation}`, async t => {
  const f = await fixture(t, 'raw-33', operation), [b, a] = await capture(f);
  const before = originalRow(f, b);
  ok(await act(f, operation, a));
  assert.deepEqual(originalRow(f, b), before);
  await reads(f, b, []);
});

for (const kind of ordinaryKinds) test(`denial is durable before a sibling exists ${kind}`, async t => {
  const f = await fixture(t, kind);
  f.model.items = [{ content: forgotten, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const [a] = await capture(f);
  ok(await act(f, 'forget', a));
  assert.equal(markers(f).length, 2);
  const reopened = openMemoryCore({ path: f.path, model: f.model });
  t.after(() => reopened.close());
  f.model.items = [{ content: survivor, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const captured = ok(await reopened.capture({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-session',
    eventId: 'synthetic-later-batch', messages: [{ id: 'synthetic-message', role: 'user', content: forgotten + '. Another window.' }] }));
  noLeak(captured, 'reopened capture result');
  const b = captured.admission.memories[0];
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(b.id).n, 1);
  assert.deepEqual(ok(reopened.get({ namespace: ns, memoryId: b.id })).receipts, []);
  for (const patch of [{ client: 'synthetic-other-client' }, { role: 'assistant' }, { sessionId: 'synthetic-other-session' }, { eventId: 'synthetic-other-message' }]) {
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic independent ' + Object.keys(patch)[0], kind: 'fact' },
      receipts: [{ ...source(), ...patch }] })).memory;
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: memory.id })).receipts[0].excerpt, message);
  }
});

for (const kind of ordinaryKinds) for (const operation of operations)
test(`denied qualification is omitted before reconstruction ${kind} ${operation}`, async t => {
  const f = await fixture(t, kind, operation);
  const qualification = { version: 1, slot: { subject: 'User', property: 'signal', scope: 'personal', applies: 'today' },
    value: forgotten, attribution: 'direct', commitment: 'considered', anchors: [{ receiptIndex: 0, start: 0, end: message.length,
      text: message, fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }] };
  ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [source()], qualification }));
  const [b, a] = await capture(f);
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: b.id, includeQualification: true })).qualification.value, forgotten);
  ok(await act(f, operation, a));
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: b.id, includeQualification: true })).qualification, null);
  const values = await reads(f, b, []);
  if (f.call) assert.equal(values.fetchEvidence.items[0].qualification, null);
  f.model.items = [{ content: survivor, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const [recaptured] = await capture(f, 'synthetic-qualified-recapture', forgotten + '. Another excerpt window.');
  assert.equal(recaptured.id, b.id, 'retained denied anchors do not make attachment fail');
  const reread = ok(f.core.get({ namespace: ns, memoryId: b.id, includeQualification: true }));
  assert.equal(reread.qualification, null);
  assert.deepEqual(reread.receipts, []);
});

test('a sibling own statement survives even when it repeats the wording', async t => {
  const f = await fixture(t, 'ordinary-48'), [, a] = await capture(f);
  const content = 'Synthetic own statement repeats ' + forgotten;
  const b = ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [source()] })).memory;
  ok(await act(f, 'forget', a));
  const value = ok(f.core.get({ namespace: ns, memoryId: b.id }));
  assert.equal(value.memory.content, content);
  assert.equal(value.memory.revision, b.revision);
  assert.deepEqual(value.receipts, []);
});

for (const operation of operations) test(`rationale links omit withheld receipts ${operation}`, async t => {
  const f = await fixture(t, 'ordinary-53', operation), [b, a] = await capture(f);
  const from = ok(f.core.fetch({ namespace: ns, refs: [{ memoryId: b.id, revision: b.revision }],
    contextMode: 'source-evidence', tokenBudget: 4000 })).items[0].receipts[0];
  f.db.prepare('INSERT INTO rationale_edges VALUES(?,?,?,?,?,?,?,?,?)')
    .run(b.id, b.revision, b.id, b.revision, 'supports-decision', from.id, from.id, key(from), key(from));
  assert.equal(ok(f.core.getRationale({ namespace: ns, memoryId: b.id, revision: b.revision })).edges.length, 1);
  ok(await act(f, operation, a));
  const rationale = ok(f.core.getRationale({ namespace: ns, memoryId: b.id, revision: b.revision }));
  assert.deepEqual(rationale.edges, []); noLeak(rationale, 'rationale links');
  const fetched = ok(f.core.fetch({ namespace: ns, refs: [{ memoryId: b.id, revision: b.revision }],
    contextMode: 'rationale-evidence', tokenBudget: 4000 }));
  noLeak(fetched, 'rationale source projection');
  assert.ok(hasId(fetched, b.id));
});

for (const kind of kinds) for (const operation of operations) test(`shared source ${operation} statement additions and rollback ${kind}`, async t => {
  const f = await fixture(t, kind, operation), [, a] = await capture(f);
  const failed = await trace(() => act(f, operation, a), sql => {
    if (sql === insertSQL) throw Error('synthetic rollback');
  });
  assert.equal(failed.result.ok, false);
  assert.equal(failed.rows.filter(row => row.sql === insertSQL).length, 1, 'rollback occurs after marker insert');
  assert.deepEqual(markers(f), [], 'rollback retains no source denial');
  const measured = await trace(() => act(f, operation, a));
  ok(measured.result);
  const added = measured.rows.filter(row => row.sql === insertSQL || row.sql === receiptSQL);
  const packaged = kind.endsWith('-53') || kind === 'ordinary-48';
  const reusedRootRead = kind === 'ordinary-33' || kind === 'raw-33';
  assert.deepEqual(added.map(row => row.sql), reusedRootRead ? [insertSQL] : [receiptSQL, insertSQL]);
  assert.equal(added.length - Number(packaged), packaged || reusedRootRead ? 1 : 2,
    'reuse an existing receipt scan; add a receipt read only where main has none');
  if (reusedRootRead) assert.ok(measured.rows.some(row => row.sql === 'SELECT * FROM receipts WHERE memory_id=?'));
  assert.equal(measured.rows.filter(row => row.sql === 'SELECT id FROM receipts WHERE memory_id=?').length, 0);
  assert.equal(measured.rows.filter(row => row.sql === insertSQL)[0].args[3] &&
    JSON.parse(measured.rows.find(row => row.sql === insertSQL).args[3]).length, 2);
  assert.equal(measured.rows.some(isLookup), false, 'no evidence lookup for simple terminal acknowledgement');
  if (operation === 'forget') for (const input of [{ memoryId: a.id }, { memoryId: 'synthetic-missing' }]) {
    const repeated = await trace(() => f.core.forget({ namespace: ns, expectedRevision: a.revision, ...input }));
    ok(repeated.result);
    assert.equal(repeated.rows.some(row => row.sql === insertSQL || row.sql === receiptSQL), false);
  }
});

test('denial batch uses one lookup, no empty lookup, and no memo survives a snapshot', async t => {
  const f = await fixture(t, 'ordinary-53'), [b, a] = await capture(f);
  ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [receipt('synthetic-batch-independent')] }));
  const rows = f.db.prepare('SELECT * FROM receipts WHERE memory_id IN (?,?)').all(a.id, b.id);
  const first = await trace(() => readTransaction(f.db, () => {
    const memo = createContentReadMemo(f.db);
    assert.equal(receiptDenialsInside(f.db, ns, [], memo).size, 0);
    assert.equal(receiptDenialsInside(f.db, ns, rows, memo).size, 0);
    for (const receipt of rows) assert.equal(receiptReadSafety(f.db, { namespace: ns, receipt, memo }).allowed, true);
  }));
  assert.equal(first.rows.filter(row => row.sql === lookupSQL).length, 1);
  ok(f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  readTransaction(f.db, () => assert.equal(receiptDenialsInside(f.db, ns, rows, createContentReadMemo(f.db)).size, 1));
});

for (const operation of operations) test(`missing/stale targets add no denial ${operation}`, async t => {
  const f = await fixture(t, 'ordinary-53', operation), [, a] = await capture(f);
  const result = await trace(() => act(f, operation, { ...a, revision: a.revision + 1 }));
  assert.equal(result.result.error?.code, 'revision_conflict');
  assert.equal(result.rows.some(row => row.sql === insertSQL), false);
  const missing = await trace(() => act(f, operation, { ...a, id: 'synthetic-missing' }));
  assert.equal(missing.rows.some(row => row.sql === insertSQL), false);
  if (operation === 'reject') {
    ok(await act(f, 'reject', a));
    const rows = markers(f), repeat = await trace(() => act(f, 'reject', a));
    ok(repeat.result); assert.deepEqual(markers(f), rows);
    assert.equal(repeat.rows.some(row => row.sql === insertSQL), false);
  }
});

test('package verifier refuses unrelated marker inserts without gating canonical output', async t => {
  const f = await fixture(t, 'ordinary-53');
  const api = contentSafetyFacade({ forget() { return transaction(f.db, () => {
    f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, 'rs1:i:' + '0'.repeat(64));
    return { ok: true, value: { forgotten: true } };
  }); } }, { check() {}, failure: error => ({ ok: false, error: { code: error.code } }) });
  assert.equal(api.forget({ namespace: ns }).error?.code, 'evidence_unavailable');
  assert.deepEqual(markers(f), []);
  const [, a] = await capture(f);
  let injected = false;
  const forged = await trace(() => act(f, 'forget', a), (sql, args, writer) => {
    if (sql === insertSQL && !injected) {
      injected = true;
      writer.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, 'rs1:a:' + '0'.repeat(64));
    }
  });
  assert.equal(forged.result.error?.code, 'evidence_unavailable');
  assert.deepEqual(markers(f), []);
  ok(await act(f, 'forget', a));
  const retained = f.db.prepare('SELECT * FROM receipts WHERE excerpt=?').get(message);
  const exposed = contentSafetyFacade({ admit() { return transaction(f.db, () => ({
    memory: { id: retained.memory_id }, deduplicated: false, insertedReceiptIds: [retained.id],
  })); } }, { check() {}, failure: error => ({ ok: false, error: { code: error.code } }) });
  const before = markers(f);
  assert.deepEqual(exposed.admit({ namespace: ns }), { memory: { id: retained.memory_id }, deduplicated: false, insertedReceiptIds: [retained.id] },
    'canonical output validation does not consult delivery markers');
  assert.deepEqual(markers(f), before, 'canonical output acceptance grants no marker insertion authority');
});

test('denial tokens are portable, message-addressed, and disjoint from Memory fingerprints', () => {
  const row = { receipt_key: key(source()), client: 'synthetic', session_id: 'synthetic-session',
    event_id: 'synthetic-message', role: 'user' };
  const tokens = receiptDenialTokens([row, row]);
  assert.equal(tokens.length, 2);
  assert.ok(tokens.every(token => !/^[0-9a-f]{64}$/.test(token)));
  assert.equal(tokens[1], 'rs1:a:' + key(['receipt-source-address-v1', row.client, row.session_id, row.event_id, row.role]));
  for (const field of ['client', 'session_id', 'event_id', 'role']) assert.notEqual(
    receiptDenialTokens([{ ...row, [field]: row[field] + '-other' }])[1], tokens[1]);
});

for (const kind of ordinaryKinds) test(`owner re-key preserves source denial ${kind}`, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  ok(await act(f, 'forget', a));
  const retained = markers(f);
  if (kind === 'ordinary-53' || kind === 'ordinary-48') {
    // Native identity guards deliberately refuse in-place owner updates.
    // Compare real independent stores instead of bypassing those guards.
    const separate = await fixture(t, kind);
    const other = [f, separate].map(store => ({ store,
      b: ok(store.core.admit({ namespace: otherOwner, memory: { content: survivor, kind: 'fact' }, receipts: [source()] })).memory,
      a: ok(store.core.admit({ namespace: otherOwner, memory: { content: forgotten, kind: 'fact' }, receipts: [source()] })).memory,
    }));
    const original = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(b.id);
    for (const { store, b: sibling, a: target } of other) {
      const own = store.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(target.id);
      assert.deepEqual(receiptDenialTokens([own]), receiptDenialTokens([original]), 'owner/store independent bytes');
      assert.equal(ok(store.core.get({ namespace: otherOwner, memoryId: sibling.id })).receipts[0].excerpt, message,
        'another owner denial is neither needed nor consulted');
      const forgotten = await store.core.forget({ namespace: otherOwner, memoryId: target.id, expectedRevision: target.revision });
      ok(forgotten);
      assert.deepEqual(markers(store, otherOwner), retained, 'same fingerprints, each in its own owner boundary');
      const measured = await trace(() => store.core.get({ namespace: otherOwner, memoryId: sibling.id }));
      assert.deepEqual(ok(measured.result).receipts, []);
      for (const row of measured.rows.filter(isLookup)) {
        if(row.sql.startsWith("SELECT 'memory'")) assert.ok(JSON.parse(row.args[0]).every(job=>job.owner===otherOwner.ownerId&&job.scope===otherOwner.scope&&job.project===(otherOwner.projectId??'')));
        else assert.deepEqual(row.args.slice(1), [otherOwner.ownerId, otherOwner.scope, otherOwner.projectId]);
      }
      assert.ok(measured.rows.some(isLookup), 'withholding performs the scoped lookup');
    }
    assert.deepEqual(markers(separate), [], 'other store never required the first owner rows');
    return;
  }
  // Receipts have no owner column: their unchanged memory_id points to the
  // re-keyed parent. A host moves the complete account boundary together.
  transaction(f.db, () => {
    f.db.prepare('UPDATE memories SET owner_id=? WHERE owner_id=?').run(otherOwner.ownerId, ns.ownerId);
    f.db.prepare('UPDATE suppressed SET owner_id=? WHERE owner_id=?').run(otherOwner.ownerId, ns.ownerId);
  });
  assert.deepEqual(markers(f, otherOwner), retained);
  assert.deepEqual(markers(f), []);
  assert.deepEqual(ok(f.core.get({ namespace: otherOwner, memoryId: b.id })).receipts, []);
  assert.equal(f.core.get({ namespace: ns, memoryId: b.id }).error?.code, 'memory_not_found');
  const oldList = f.core.list({ namespace: ns, limit: 20 });
  noLeak(oldList, 'old owner after re-key');
  assert.equal(hasId(oldList, b.id), false, 'old owner cannot list the moved Memory');
  const moved = ok(f.core.admit({ namespace: otherOwner, memory: { content: 'Synthetic moved signal', kind: 'fact' }, receipts: [source('Different window')] })).memory;
  assert.deepEqual(ok(f.core.get({ namespace: otherOwner, memoryId: moved.id })).receipts, []);
  const old = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic new account signal', kind: 'fact' }, receipts: [source()] })).memory;
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: old.id })).receipts[0].excerpt, message);
});

for (const kind of ['ordinary-53', 'ordinary-48']) for (const mutation of ['other-receipt', 'namespace', 'owner', 'fingerprint', 'malformed', 'update', 'remove'])
test(`package verifier rolls back ${mutation} during forget ${kind}`, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  const independentMemory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic unrelated target', kind: 'fact' },
    receipts: [receipt('synthetic-other-target')] })).memory;
  const other = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(independentMemory.id);
  const own = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(a.id);
  const token = receiptDenialTokens([own])[1], retained = 'rs1:a:' + '1'.repeat(64);
  f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, retained);
  const before = f.db.prepare('SELECT * FROM suppressed ORDER BY owner_id,scope,project_id,fingerprint').all();
  const memoryBefore = originalRow(f, a);
  let injected = false;
  const forged = await trace(() => act(f, 'forget', a), (sql, args, writer) => {
    if (sql !== insertSQL || injected) return;
    injected = true;
    if (mutation === 'update') writer.prepare('UPDATE suppressed SET fingerprint=? WHERE fingerprint=?').run('rs1:a:' + '2'.repeat(64), retained);
    else if (mutation === 'remove') writer.prepare('DELETE FROM suppressed WHERE fingerprint=?').run(retained);
    else writer.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(
      mutation === 'owner' ? otherOwner.ownerId : ns.ownerId, ns.scope,
      mutation === 'namespace' ? otherNamespace.projectId : ns.projectId,
      mutation === 'other-receipt' ? receiptDenialTokens([other])[0] : mutation === 'fingerprint' ? '3'.repeat(64)
        : mutation === 'malformed' ? 'rs1:a:invalid' : token);
  });
  assert.equal(injected, true);
  assert.equal(forged.result.error?.code, 'evidence_unavailable');
  assert.deepEqual(f.db.prepare('SELECT * FROM suppressed ORDER BY owner_id,scope,project_id,fingerprint').all(), before);
  assert.deepEqual(originalRow(f, a), memoryBefore);
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: b.id })).receipts[0].excerpt, message);
});

for (const kind of ordinaryKinds) test(`markers never suppress unrelated text ${kind}`, async t => {
  const f = await fixture(t, kind);
  const unrelated = 'Synthetic text with unrelated fingerprint';
  const real = 'Synthetic real suppressed fingerprint';
  const realMemory = ok(f.core.admit({ namespace: ns,
    memory: { content: real, kind: 'fact' }, receipts: [receipt('synthetic-real-fingerprint')] })).memory;
  ok(f.core.forget({ namespace: ns, memoryId: realMemory.id, expectedRevision: realMemory.revision }));
  const before = [unrelated, real].map(content => f.core.isSuppressed({ namespace: ns, content }));
  assert.deepEqual(before.map(result => ok(result).suppressed), [false, true]);
  for (let index = 0; index < 40; index++) for (const token of receiptDenialTokens([{ receipt_key: key(index), client: 'synthetic',
    session_id: 'synthetic-session', event_id: 'synthetic-' + index, role: 'user' }])) {
    assert.ok(token.startsWith('rs1:'));
    // A colon and an r cannot occur in the alphabet of any 64-hex value.
    assert.equal(/^[0-9a-f]{64}$/.test(token), false);
    f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, token);
  }
  assert.deepEqual([unrelated, real].map(content => f.core.isSuppressed({ namespace: ns, content })), before,
    'the production forgotten-text read is identical with many marker rows');
  const measured = await trace(() => f.core.admit({ namespace: ns,
    memory: { content: unrelated, kind: 'fact' },
    receipts: [receipt('synthetic-fingerprint-control')] }));
  const memory = ok(measured.result).memory, row = originalRow(f, memory);
  assert.match(row.fingerprint, /^[0-9a-f]{64}$/);
  const suppression = measured.rows.find(entry => /^SELECT 1 FROM suppressed WHERE /.test(entry.sql));
  assert.ok(suppression, 'admission executes its real exact fingerprint lookup');
  assert.deepEqual(suppression.args, [ns.ownerId, ns.scope, ns.projectId, row.fingerprint]);
  const lookup = f.db.prepare(suppression.sql);
  for (const value of [row.fingerprint, '0'.repeat(64), 'f'.repeat(64)])
    assert.equal(lookup.get(ns.ownerId, ns.scope, ns.projectId, value), undefined, 'markers never match fingerprint lookup');
  f.model.items = [{ content: 'Synthetic captured unrelated fingerprint', kind: 'fact', confidence: .8, sourceIndices: [0] }];
  const [captured] = await capture(f, 'synthetic-unrelated-capture', 'Synthetic unrelated source');
  assert.ok(captured, 'capture admission also succeeds among marker rows');
  const suppressed = 'a'.repeat(64);
  f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, suppressed);
  assert.ok(lookup.get(ns.ownerId, ns.scope, ns.projectId, suppressed), 'real content suppression still matches');
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: memory.id })).memory.content, row.content);
});

for (const kind of ordinaryKinds) test(`host owner erasure deletes source markers ${kind}`, async t => {
  const f = await fixture(t, kind), [, a] = await capture(f);
  ok(await act(f, 'forget', a));
  f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(otherOwner.ownerId, ns.scope, ns.projectId, 'rs1:a:' + '0'.repeat(64));
  assert.equal(markers(f).length, 2);
  // The engine has no account-deletion facade. Exercise the host's owner-keyed
  // logical deletion of Memory, receipt and suppressed data on this connection.
  transaction(f.db, () => {
    f.db.prepare('DELETE FROM receipts WHERE memory_id IN (SELECT id FROM memories WHERE owner_id=?)').run(ns.ownerId);
    f.db.prepare('DELETE FROM memories WHERE owner_id=?').run(ns.ownerId);
    f.db.prepare('DELETE FROM suppressed WHERE owner_id=?').run(ns.ownerId);
  });
  assert.equal(f.db.prepare('SELECT count(*) n FROM suppressed WHERE owner_id=?').get(ns.ownerId).n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE owner_id=?').get(ns.ownerId).n, 0);
  assert.equal(markers(f, otherOwner).length, 1);
});

test('marker-free receipt batch adds only one primary-key lookup without identity reads', async t => {
  const f = await fixture(t, 'fresh-default'), [b] = await capture(f);
  const rows = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(b.id);
  const measured = await trace(() => receiptDenialsInside(f.db, ns, rows, {}));
  assert.deepEqual([...measured.result], []);
  assert.deepEqual(measured.rows.map(row => row.sql), [lookupSQL]);
  const empty = await trace(() => receiptDenialsInside(f.db, ns, [], {}));
  assert.deepEqual(empty.rows, []);
  const plan = f.db.prepare('EXPLAIN QUERY PLAN ' + lookupSQL).all(JSON.stringify(receiptDenialTokens(rows)), ns.ownerId, ns.scope, ns.projectId);
  assert.ok(plan.some(row => /SEARCH s USING (?:COVERING )?INDEX sqlite_autoindex_suppressed_1/.test(row.detail) &&
    ['owner_id=?', 'scope=?', 'project_id=?', 'fingerprint=?'].every(part => row.detail.includes(part))));
});

for (const kind of ordinaryKinds) test(`receipt caps and cursors follow denial filtering ${kind}`, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  const denied = f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(b.id).id;
  // Put more withheld rows ahead of the allowed evidence than any private,
  // get, fetch or source projection cap, with stable synthetic timestamps.
  const rows = Array.from({ length: 105 }, (_, index) => ({ ...source(forgotten + ' window ' + index),
    eventId: 'synthetic-denied-' + index }));
  for (let offset = 0; offset < rows.length; offset += 4) b.revision = ok(f.core.admit({ namespace: ns,
    memory: { content: survivor, kind: 'fact' }, receipts: rows.slice(offset, offset + 4) })).memory.revision;
  const stored = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(b.id);
  for (const token of receiptDenialTokens(stored)) f.db.prepare('INSERT OR IGNORE INTO suppressed VALUES(?,?,?,?)')
    .run(ns.ownerId, ns.scope, ns.projectId, token);
  const withSupport = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-independent-cap', independent)] })).memory;
  b.revision = withSupport.revision;
  const allowed = f.db.prepare('SELECT id FROM receipts WHERE memory_id=? AND excerpt=?').get(b.id, independent).id;
  f.db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=?').run('2026-01-01T00:00:00.000Z', b.id);
  f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run('2026-01-02T00:00:00.000Z', allowed);
  ok(await act(f, 'forget', a));
  const page = ok(f.core.get({ namespace: ns, memoryId: b.id, receiptLimit: 1 }));
  assert.deepEqual(page.receipts.map(row => row.id), [allowed]);
  assert.equal(page.nextReceiptCursor, null);
  const legacy = openMemoryStore({ path: f.path }); t.after(() => legacy.close());
  assert.deepEqual(legacy.scope({ ownerId: ns.ownerId, projectId: ns.projectId }).get(b.id).receipts.map(row => row.excerpt), [independent]);
  const values = await reads(f, b, [independent]);
  for (const value of Object.values(values)) assert.equal(hasId(value, denied), false);
  // Reverse recency: a marker must not occupy the most-recent slot either.
  f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run('2025-12-31T00:00:00.000Z', allowed);
  const runtime = createMemoryRuntime({ path: f.path }); t.after(() => runtime.close());
  assert.deepEqual(runtime.recentReceipts(ns, { memoryId: b.id, revision: b.revision }, 1).map(row => row.id), [allowed]);
  const second = 'Synthetic second independent support';
  ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [receipt('synthetic-second-cap', second)] }));
  const firstPage = ok(f.core.get({ namespace: ns, memoryId: b.id, receiptLimit: 1 }));
  assert.deepEqual(firstPage.receipts.map(row => row.excerpt), [independent]);
  assert.equal(firstPage.exhausted, false);
  const nextPage = ok(f.core.get({ namespace: ns, memoryId: b.id, receiptLimit: 1, receiptCursor: firstPage.nextReceiptCursor }));
  assert.deepEqual(nextPage.receipts.map(row => row.excerpt), [second]);
  assert.equal(nextPage.exhausted, true); noLeak(nextPage, 'get cursor');
});

for (const kind of ['ordinary-53', 'ordinary-48']) test(`embedded and product context omit withheld provenance ids ${kind}`, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic third surviving signal', kind: 'fact' }, receipts: [source()] }));
  const denied = f.db.prepare('SELECT id FROM receipts WHERE excerpt=?').all(message).map(row => row.id);
  ok(await act(f, 'forget', a));
  const embedded = await reads(f, b, []);
  const service = configured(t, f.path, [ns], { service: true }), maintainer = await service.open();
  const refreshed = await maintainer.refreshContextIndex({ readSet: [ns], types: ['memory'], intent: 'current',
    mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } }, service.token);
  if (!refreshed.ok) assert.equal(refreshed.error?.code, 'index_unavailable');
  await maintainer.close();
  const config = configured(t, f.path, [ns]), reader = await config.open();
  const product = ok(await reader.contextRead({ readSet: [ns], types: ['memory'], intent: 'current', query: 'Synthetic',
    semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } }, config.token));
  for (const [name, value] of Object.entries({ embedded: embedded.contextRead, product })) {
    noLeak(value, name); for (const id of denied) assert.equal(hasId(value, id), false, name + ' withheld receipt id');
    assert.ok(hasId(value, b.id), name + ' retains B');
  }
});


for (const route of ['embedded', 'product']) for (const marked of [false, true])
for (const multiNamespace of [false, true])
test(`context receipt lookups are batched per snapshot ${route}, markers=${marked}, namespaces=${multiNamespace ? 2 : 1}`, async t => {
  const f = await fixture(t, 'ordinary-53');
  const readSet = multiNamespace ? [ns, { ...ns, scope: 'personal', projectId: null }] : [ns], expected = [];
  f.trusted.state.allowed = readSet;
  const deniedIds = [];
  for (let index = 0; index < 12; index++) {
    const namespace = readSet[index % readSet.length], excerpt = 'Synthetic context support ' + index;
    const evidence = receipt('synthetic-context-' + index, excerpt);
    const qualification = { version: 1, slot: { subject: 'User', property: 'signal', scope: null, applies: null },
      value: excerpt, attribution: 'direct', commitment: 'considered',
      anchors: [{ receiptIndex: 0, start: 0, end: excerpt.length, text: excerpt, fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] };
    const memory = ok(f.core.admit({ namespace, memory: { content: 'Synthetic context candidate ' + index, kind: 'fact' },
      receipts: [evidence], qualification })).memory;
    expected.push(memory.id);
    if (marked && index % 3 === 0) {
      const row = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
      deniedIds.push(row.id);
      for (const token of receiptDenialTokens([row])) f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)')
        .run(namespace.ownerId, namespace.scope, namespace.projectId ?? '', token);
    }
  }
  const input = { readSet, types: ['memory'], intent: 'current', query: 'Synthetic context', semantic: false,
    deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } };
  let call;
  if (route === 'embedded') {
    ok(await f.trusted.call(f.context, 'refreshContextIndex', { readSet, types: ['memory'], intent: 'current',
      budget: { maxItems: 1024, maxMs: 5000 } }));
    call = () => f.trusted.call(f.context, 'contextRead', input);
  } else {
    // The worker uses this exact private index. Running it in-process lets the
    // statement meter observe canonical SQLite execution without worker hooks.
    const facade = openContextProductFacade(f.path, {});
    const index = openProductIndex({ path: f.path, facade, ownerCoverage: descriptor(readSet), maintenance: true,
      counter: { id: 'synthetic', countTokens: () => 1 },
      authorize: () => ({ accessGenerations: accessDigest({ ownerId: ns.ownerId, namespaces: { readSet } }),
        check() {}, envelope: work => work() }) });
    t.after(() => { index.close(); facade.close(); });
    ok(index.run('refreshContextIndex', { readSet, types: ['memory'], intent: 'current', mode: 'lexical',
      budget: { maxItems: 1024, maxMs: 5000 } }, {}));
    call = () => index.run('contextRead', input, {});
  }
  const measured = await trace(call), value = ok(measured.result);
  assert.equal(value.metered.items.length, 12);
  for (const id of expected) assert.ok(hasId(value, id), 'every candidate remains readable');
  for (const id of deniedIds) assert.equal(hasId(value, id), false, 'withheld provenance id');
  for (let index = 0; index < 12; index++) assert.equal(
    JSON.stringify(value).includes('Synthetic context support ' + index + '"'), !(marked && index % 3 === 0),
    'only denied receipt excerpts are omitted');
  const lookups = measured.rows.filter(isLookup);
  assert.equal(lookups.length, 2, 'one preparation lookup and one independent final-delivery lookup');
  assert.equal(new Set(lookups.map(row => row.snapshot)).size, 2);
  for (const lookup of lookups) {
    assert.ok(lookup.snapshot, 'lookup belongs to an actual read transaction');
    const tokens=JSON.parse(lookup.args[0]);
    assert.equal(tokens.length,24,'two JavaScript tokens for each of twelve selected receipt headers');
    assert.ok(tokens.every(tuple=>readSet.some(namespace=>tuple[0]===namespace.ownerId&&tuple[1]===namespace.scope&&tuple[2]===(namespace.projectId??''))));
    assert.ok(tokens.every(tuple=>/^rs1:[ia]:[0-9a-f]{64}$/.test(tuple[3])));
    const plan = f.db.prepare('EXPLAIN QUERY PLAN ' + lookup.sql).all(...lookup.args);
    assert.ok(plan.some(row => /SEARCH s USING (?:COVERING )?INDEX sqlite_autoindex_suppressed_1/.test(row.detail) &&
      ['owner_id=?', 'scope=?', 'project_id=?', 'fingerprint=?'].every(part => row.detail.includes(part))));
  }
});

// Review sequence 8: an immutable invalidation must not read a denied sibling.
for (const kind of ['ordinary-48', 'ordinary-53']) for (const operation of ['forget', 'correct'])
test(`review 8 unrelated Card invalidation ${kind} ${operation}`, async t => {
  const f = await fixture(t, kind);
  const add = (content, evidence) => ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [evidence] })).memory;
  const a = add(forgotten, source()), d = add('Synthetic retained contributor', source());
  const b = add(survivor, receipt('synthetic-independent-card'));
  let card = ok(f.call('createCardDraft', { actionId: 'synthetic-dependent-card', drafting: 'authored',
    input: { title: 'Synthetic title', body: 'Synthetic independent Card body', memoryRefs: [memoryRef(b), memoryRef(d)], sourcePolicy: 'retained-receipts-v1' } }));
  card = ok(f.call('confirmCardDraft', { actionId: 'synthetic-confirm-card', cardId: card.id,
    expectedRevision: card.revision, applicability: 'current' }));
  const before = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(card.id);
  ok(act(f, 'forget', a));
  assert.deepEqual(f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(card.id), before);
  const result = ok(act(f, operation, b));
  assert.ok(result.indexRevision);
  assert.ok(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision > before.revision);
  const served = f.call('getCard', { cardId: card.id });
  assert.equal(ok(served).card, null, 'invalidation never waives Card delivery');
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: d.id })).memory.content, 'Synthetic retained contributor');
});

for (const marked of [false, true]) test(`review B one lookup per snapshot with a full page, markers=${marked}`, async t => {
  const f = await fixture(t, 'ordinary-53'), memories = [];
  f.model.countTokens = () => 1;
  for (let i=0; i<12; i++) {
    const evidence = { ...receipt('synthetic-batch-'+i), excerpt: 'Synthetic full page '+i };
    const qualification = { version: 1, slot: { subject: 'User', property: 'signal', scope: null, applies: null }, value: null,
      attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0, start: 0, end: evidence.excerpt.length,
        text: evidence.excerpt, fields: ['subject','property'] }] };
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic full page '+i, kind: 'instruction' },
      receipts: [evidence], qualification, procedural: { anchors: [{ receiptIndex: 0, start: 0, end: 8 }] } })).memory;
    memories.push(memory);
    if (marked && i<3) {
      const target = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic removed full page '+i, kind: 'fact' }, receipts: [evidence] })).memory;
      ok(f.core.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision }));
    }
  }
  const assertLookups = (rows, expected) => {
    const lookups=rows.filter(isLookup);
    assert.equal(lookups.length, expected);
    assert.equal(new Set(lookups.map(row=>row.snapshot)).size, expected, 'at most one statement per synchronous snapshot');
    return lookups;
  };
  assertLookups((await trace(()=>f.core.get({namespace:ns,memoryId:memories[0].id,includeQualification:true}))).rows,1);
  assertLookups((await trace(()=>f.core.fetch({namespace:ns,refs:memories.map(memory=>({memoryId:memory.id,revision:memory.revision})),includeQualification:true}))).rows,2);
  const recall=await trace(()=>f.core.recall({readSet:[ns],query:'Synthetic',limit:12,includeQualification:true}));
  assert.equal(ok(recall.result).memories.length,12); assertLookups(recall.rows,2);
  const fetched=await trace(()=>f.call('fetchEvidence',{intent:'current',refs:memories.map(memoryRef)}));
  assert.equal(ok(fetched.result).items.length,12);assertLookups(fetched.rows,1);
  const selected=await trace(()=>f.call('selectEvidence',{intent:'current',query:'Synthetic',types:['memory'],limit:24}));
  assert.equal(ok(selected.result).items.length,12);assertLookups(selected.rows,1);
  const absent=await trace(()=>f.call('selectEvidence',{intent:'current',query:'Unmatched absenttoken',types:['memory'],limit:24}));
  assert.equal(ok(absent.result).items.length,0);assertLookups(absent.rows,0);
  const runtime=createMemoryRuntime({path:f.path});t.after(()=>runtime.close());
  const queried=await trace(()=>runtime.queryCandidateRows(ns,{score:text=>text.includes('Synthetic')?1:0,memoryLabel:text=>text,
    sourceReceiptLimit:4}));
  assert.ok(queried.result.rows.length>=12); assertLookups(queried.rows,1);
  const sourceRecall=await trace(()=>f.core.recall({readSet:[ns],query:'Synthetic',limit:12,contextMode:'source-evidence'}));
  assert.equal(ok(sourceRecall.result).memories.length,12); assertLookups(sourceRecall.rows,3);
});

for (const kind of ['fresh-default','ordinary-48','ordinary-53']) test(`review A1 unchanged qualification retention ${kind}`, async t => {
  const f=await fixture(t,kind),qualification={version:1,slot:{subject:'User',property:'signal',scope:null,applies:null},value:forgotten,
    attribution:'direct',commitment:'considered',anchors:[{receiptIndex:0,start:0,end:message.length,text:message,
      fields:['subject','property','value','attribution','commitment']}]};
  const input={namespace:ns,memory:{content:survivor,kind:'fact'},receipts:[source()],qualification};
  const b=ok(f.core.admit(input)).memory;
  const a=ok(f.core.admit({namespace:ns,memory:{content:forgotten,kind:'fact'},receipts:[source()]})).memory;
  ok(act(f,'forget',a));
  assert.equal(ok(f.core.admit(input)).memory.id,b.id,'immutable qualification comparison is independent of delivery');
  const delivered=ok(f.core.get({namespace:ns,memoryId:b.id,includeQualification:true}));
  assert.equal(delivered.qualification,null);assert.deepEqual(delivered.receipts,[]);
});

for (const kind of ['ordinary-48','ordinary-53']) test(`review A1 rationale filing retains independent endpoints ${kind}`, async t => {
  const f=await fixture(t,kind),add=(content,id)=>ok(f.core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[source(),receipt(id)]})).memory;
  const b=add(survivor,'synthetic-filing-independent'),d=add('Synthetic rationale endpoint','synthetic-endpoint-independent');
  const a=ok(f.core.admit({namespace:ns,memory:{content:forgotten,kind:'fact'},receipts:[source()]})).memory;
  f.model.relate=({input})=>({edges:[{from:0,to:1,relation:'supports-decision',
    fromReceipt:input.memories[0].receipts.findIndex(receipt=>receipt.excerpt===message),
    toReceipt:input.memories[1].receipts.findIndex(receipt=>receipt.excerpt===message)}]});
  ok(await f.core.reviewRationale({namespace:ns,refs:[b,d].map(memory=>({memoryId:memory.id,revision:memory.revision}))}));
  ok(act(f,'forget',a));
  const map=ok(f.core.map({namespace:ns}));
  ok(f.core.applyPlacement({namespace:ns,expectedIndexRevision:map.indexRevision,
    expectedMemoryRevisions:[{memoryId:b.id,revision:b.revision}],
    proposal:{items:[{memoryId:b.id,parentIds:[],newL1:{title:'Synthetic filing topic',parentL2Ids:[]}}]}}));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n,1,'filing preserves the canonical edge as at the base');
  const current=ok(f.core.get({namespace:ns,memoryId:b.id})).memory;
  const delivered=ok(f.core.getRationale({namespace:ns,memoryId:b.id,revision:current.revision}));
  assert.deepEqual(delivered.edges,[]);noLeak(delivered,'filed rationale');
  assert.equal(ok(f.core.get({namespace:ns,memoryId:d.id})).memory.content,'Synthetic rationale endpoint');
});

test('review B full receipt pages resolve qualification and procedural tokens once', async t => {
  const f=await fixture(t,'ordinary-53');f.model.countTokens=()=>1;
  const evidence=receipt('synthetic-full-receipt-first');
  const qualification={version:1,slot:{subject:'User',property:null,scope:null,applies:null},value:null,attribution:'unknown',commitment:'unknown',
    anchors:[{receiptIndex:0,start:0,end:evidence.excerpt.length,text:evidence.excerpt,fields:['subject']}]};
  let memory=ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'instruction'},receipts:[evidence],qualification,
    procedural:{anchors:[{receiptIndex:0,start:0,end:8}]}})).memory;
  for(let i=0;i<26;i++)memory=ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'instruction'},
    receipts:Array.from({length:4},(_,j)=>receipt('synthetic-full-receipt-'+(i*4+j)))})).memory;
  for(const [name,call,expected]of [
    ['get',()=>f.core.get({namespace:ns,memoryId:memory.id,receiptLimit:100,includeQualification:true}),1],
    ['fetch',()=>f.core.fetch({namespace:ns,refs:[{memoryId:memory.id,revision:memory.revision}],includeQualification:true}),2],
  ]) {
    const measured=await trace(call),value=ok(measured.result);
    assert.equal((value.receipts??value.items[0].receipts).length,100,name+' full page');
    const lookups=measured.rows.filter(isLookup);assert.equal(lookups.length,expected,name);
    assert.equal(new Set(lookups.map(row=>row.snapshot)).size,expected);
  }
});

for (const kind of ['ordinary-48','ordinary-53']) for (const writer of ['capture','duplicate-extraction','admit','filing'])
test(`native nonterminal invalidation ${kind} ${writer}`, async t => {
  const f=await fixture(t,kind);
  const add=(content,evidence)=>ok(f.core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[evidence]})).memory;
  const a=add(forgotten,source()),d=add('Synthetic retained dependency',source()),b=add(survivor,receipt('synthetic-original'));
  let card=ok(f.call('createCardDraft',{actionId:'synthetic-native-draft',drafting:'authored',input:{title:'Synthetic',body:'Synthetic body',
    memoryRefs:[memoryRef(b),memoryRef(d)],sourcePolicy:'retained-receipts-v1'}}));
  card=ok(f.call('confirmCardDraft',{actionId:'synthetic-native-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
  ok(act(f,'forget',a));
  const extra=receipt('synthetic-additional');
  if(writer==='admit') assert.equal(add(survivor,extra).id,b.id);
  else if(writer==='filing') {
    assert.equal(add(survivor,extra).id,b.id);
    const current=ok(f.core.get({namespace:ns,memoryId:b.id})).memory,map=ok(f.core.map({namespace:ns}));
    ok(f.core.applyPlacement({namespace:ns,expectedIndexRevision:map.indexRevision,expectedMemoryRevisions:[{memoryId:b.id,revision:current.revision}],
      proposal:{items:[{memoryId:b.id,parentIds:[],newL1:{title:'Synthetic native topic',parentL2Ids:[]}}]}}));
  } else {
    f.model.items=[{content:survivor,kind:'fact',confidence:.8,sourceIndices:[0]}];
    if(writer==='duplicate-extraction') f.model.items.push({...f.model.items[0],sourceIndices:[1]});
    ok(await f.core.capture({namespace:ns,client:extra.client,sessionId:extra.sessionId,eventId:'synthetic-native-capture',
      messages:[{id:extra.eventId,role:extra.role,content:extra.excerpt},
        ...(writer==='duplicate-extraction'?[{id:'synthetic-extra-message',role:'user',content:'Synthetic other attachment'}]:[])]}));
  }
  const value=ok(f.core.get({namespace:ns,memoryId:b.id}));
  assert.ok(value.memory.revision>b.revision);
  assert.ok(value.receipts.some(r=>r.eventId===extra.eventId),'new independent receipt commits');
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
});

for(const kind of ['ordinary-33','ordinary-48','ordinary-53']) test(`selectEvidence skips denied Card including peek ${kind}`,async t=>{
  const f=await fixture(t,kind),[b,a]=await capture(f);
  let card=ok(f.call('createCardDraft',{actionId:'synthetic-select-draft',drafting:'authored',input:{title:'Unrelated title',body:'Unrelated body',
    memoryRefs:[memoryRef(b)],sourcePolicy:'retained-receipts-v1'}}));
  card=ok(f.call('confirmCardDraft',{actionId:'synthetic-select-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
  ok(act(f,'forget',a));
  for(const limit of [1,24]) {
    const value=ok(f.call('selectEvidence',{query:survivor,types:['memory','card'],intent:'current',limit}));
    assert.deepEqual(value.items.map(item=>item.ref.memoryId),[b.id]);
    assert.equal(value.nextCursor,null);noLeak(value,'selection omits denied Card');
  }
});

for(const kind of ['fresh-default','ordinary-48','ordinary-53']) for(const method of ['transitionQualified','transitionQualifiedSet']) test(`withheld qualification preserves binding and base transitions ${kind} ${method}`,async t=>{
  const f=await fixture(t,kind);
  const qualification=value=>({version:1,slot:{subject:'Synthetic subject',property:'Synthetic property',scope:'Synthetic scope',applies:'Synthetic applies'},
    value,attribution:'direct',commitment:'adopted',anchors:[{receiptIndex:0,start:0,end:message.length,text:message,
      fields:['subject','property','scope','applies','value','attribution','commitment']}]});
  const add=(content,value,evidence)=>ok(f.core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[evidence],qualification:qualification(value)})).memory;
  const b=add(survivor,'before',source()),c=add('Synthetic replacement claim','after',{...receipt('synthetic-qualified-replacement'),excerpt:message});
  const bind=(m,slotId=null)=>f.core.bindQualifiedClaim({namespace:ns,memoryId:m.id,expectedRevision:m.revision,slotId,singleClaim:true});
  const slot=ok(bind(b)).slotId;ok(bind(c,slot));
  const a=ok(f.core.admit({namespace:ns,memory:{content:forgotten,kind:'fact'},receipts:[source()]})).memory;
  ok(act(f,'forget',a));
  assert.equal(ok(bind(b)).slotId,slot);assert.equal(ok(bind(b,slot)).slotId,slot);
  assert.equal(bind(b,'synthetic-other-slot').error.code,'qualification_conflict');
  const predecessor={memoryId:b.id,expectedRevision:b.revision},replacement={memoryId:c.id,expectedRevision:c.revision};
  assert.equal(ok(f.core.get({namespace:ns,memoryId:b.id,includeQualification:true})).qualification,null);
  const value=ok(method==='transitionQualified' ? f.core.transitionQualified({namespace:ns,predecessor,replacement}) :
    f.core.transitionQualifiedSet({namespace:ns,predecessors:[predecessor],replacement}));
  assert.equal(value.status,'applied');

});

// Ordinary capture creates the shared receipts before any Episode fixture work.
// The explicit retained link isolates getEpisode delivery from its write path.
for (const kind of ordinaryKinds) for (const operation of operations)
test(`host receipt counts ${kind} ${operation}`, async t => {
  const f = await fixture(t, kind, operation), [initialB, a] = await capture(f);
  const storedCount = () => f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(initialB.id).n;
  const oldIds = f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(initialB.id).map(row => row.id);
  assert.equal(storedCount(), 1);
  const episode = openMemoryCore({ path: f.path, ...episodeOptions, decisionReview: 'required-v1',
    model: episodeModel({ extract: () => ({ items: [] }) }) });
  t.after(() => episode.close());
  const episodeInput = episodeCaptureInput(1, 'synthetic-count-episode', { namespace: ns });
  const episodeId = ok(await episode.capture(episodeInput)).episode.id;
  f.db.prepare('INSERT INTO episode_memory_links VALUES(?,?,?,?,?,?)').run(
    'synthetic-count-link', episodeId, initialB.id, episodeInput.eventId, initialB.revision, JSON.stringify(oldIds));
  assert.deepEqual(ok(episode.getEpisode({ namespace: ns, episodeId, sourceLimit: 16, memoryLimit: 50 }))
    .memoryLinks.items.find(link => link.memoryId === initialB.id).receiptIds, oldIds);
  ok(act(f, operation, a));
  // A separate retained Memory forces public fetch to finish across references.
  const spare = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic pagination neighbor', kind: 'fact' },
    receipts: [receipt('synthetic-pagination-neighbor')] })).memory;
  let b = initialB;
  async function assertReads(delivered) {
    const count = storedCount();
    assert.equal(count, delivered + 1);
    const detail = ok(f.core.get({ namespace: ns, memoryId: b.id }));
    assert.equal(detail.memory.id, b.id); assert.equal(detail.memory.receiptCount, count);
    assert.equal(detail.receipts.length, delivered); assert.ok(detail.receipts.length <= detail.memory.receiptCount);
    if (!delivered) {
      assert.deepEqual(detail.receipts, []);
      const row = f.db.prepare('SELECT * FROM memories WHERE id=?').get(b.id);
      assert.equal(sourceEvidence(row, [], count, key).receiptCount, 1);
    }
    const request = { namespace: ns, refs: [b, spare].map(m => ({ memoryId: m.id, revision: m.revision })), tokenBudget: 4000 };
    let cursor, pages = 0; const items = [];
    do {
      const page = ok(f.core.fetch({ ...request, ...(cursor ? { cursor } : {}) }));
      items.push(...page.items); cursor = page.nextCursor; pages++;
      assert.ok(pages <= 4); assert.deepEqual(page.invalidRefs, []); noLeak(page, 'host fetch');
      assert.equal(page.exhausted, cursor === null);
    } while (cursor);
    assert.ok(pages >= 2, 'all requested references finish');
    const fetched = items.find(item => item.memory.id === b.id);
    assert.ok(fetched); assert.equal(fetched.receiptCount, count); assert.equal(fetched.memory.receiptCount, count);
    assert.equal(fetched.receipts.length, delivered); assert.ok(fetched.receipts.length <= fetched.receiptCount);
    const recalled = ok(await f.core.recall({ readSet: [ns], query: survivor, limit: 12 }));
    const item = recalled.memories.find(item => item.memory.id === b.id);
    assert.ok(item); assert.equal(item.receiptCount, count); assert.equal(item.memory.receiptCount, count);
    assert.equal(item.receipts.length, delivered); assert.ok(item.receipts.length <= item.receiptCount);
    assert.equal(item.receiptsOmitted, undefined, 'an uncapped list has no omission field');
    const linked = ok(episode.getEpisode({ namespace: ns, episodeId, sourceLimit: 16, memoryLimit: 50 }));
    assert.equal(linked.episode.id, episodeId);
    assert.deepEqual(linked.memoryLinks.items.find(link => link.memoryId === b.id).receiptIds, []);
    for (const result of [detail, fetched, recalled, linked]) {
      noLeak(result, 'host evidence'); for (const id of oldIds) assert.equal(hasId(result, id), false);
    }
  }
  f.model.countTokens = () => 1;
  await assertReads(0);
  // Force packing to cap another candidate, while B has zero or one delivered
  // receipt. The existing packer keeps at least one, so B itself is uncapped.
  const crowd = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic capped neighbor', kind: 'fact' },
    receipts: [0, 1, 2].map(i => receipt('synthetic-capped-neighbor-' + i)) })).memory;
  const capCounter = text => {
    try { if (JSON.parse(text).input?.candidates?.some(item => item.receipts.length > 1)) return 6001; } catch {}
    return 1;
  };
  for (const delivered of [0, 1]) {
    f.model.countTokens = capCounter;
    const capped = ok(await f.core.recall({ readSet: [ns], query: survivor, limit: 12 }));
    const item = capped.memories.find(item => item.memory.id === b.id);
    assert.ok(item); assert.equal(item.receipts.length, delivered); assert.equal(item.receiptCount, delivered + 1);
    assert.equal(item.receiptsOmitted, undefined, 'B is below the existing minimum cap');
    const neighbor = capped.memories.find(item => item.memory.id === crowd.id);
    assert.equal(neighbor.receipts.length, 1); assert.equal(neighbor.receiptCount, 3); assert.equal(neighbor.receiptsOmitted, 2);
    assert.ok(capped.recallTruncated.receiptListsCapped >= 1); noLeak(capped, 'capped host recall');
    if (!delivered) {
      b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
        receipts: [{ ...receipt('synthetic-count-independent'), excerpt: independent }] })).memory;
      f.model.countTokens = () => 1;
      await assertReads(1);
    }
  }
  b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-count-extra-one'), receipt('synthetic-count-extra-two')] })).memory;
  f.model.countTokens = capCounter;
  const capped = ok(await f.core.recall({ readSet: [ns], query: survivor, limit: 12 }));
  const item = capped.memories.find(item => item.memory.id === b.id);
  assert.ok(item); assert.equal(storedCount(), 4); assert.equal(item.receiptCount, 4);
  assert.equal(item.memory.receiptCount, 4); assert.equal(item.receipts.length, 1);
  assert.equal(item.receiptsOmitted, 3, '4 stored - 1 delivered includes 1 withheld + 2 capped');
});

for (const kind of ordinaryKinds) test(`zero stored receipt corruption ${kind}`, async t => {
  const f = await fixture(t, kind), [b] = await capture(f);
  f.model.countTokens = () => 1;
  f.db.prepare('DELETE FROM receipts WHERE memory_id=?').run(b.id);
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(b.id).n, 0);
  const check = (result, project) => {
    if (!result.ok) { assert.equal(result.error.code, 'storage_error'); return; }
    const item = project(result.value); assert.ok(item, 'the corrupt Memory must be accounted for');
    assert.equal(item.memory.receiptCount ?? item.receiptCount, 0);
    if (Object.hasOwn(item, 'receiptCount')) assert.equal(item.receiptCount, 0);
    assert.deepEqual(item.receipts, []);
  };
  check(f.core.get({ namespace: ns, memoryId: b.id }), value => value);
  check(f.core.fetch({ namespace: ns, refs: [{ memoryId: b.id, revision: b.revision }] }), value => value.items[0]);
  check(await f.core.recall({ readSet: [ns], query: survivor, limit: 12 }), value => value.memories.find(item => item.memory.id === b.id));
  const row = f.db.prepare('SELECT * FROM memories WHERE id=?').get(b.id);
  assert.throws(() => sourceEvidence(row, [], 0, key), { code: 'storage_error' });
  for (const contextMode of ['source-evidence', 'rationale-evidence']) {
    assert.equal(f.core.fetch({ namespace: ns, refs: [{ memoryId: b.id, revision: b.revision }], contextMode }).error.code, 'storage_error');
    assert.equal((await f.core.recall({ readSet: [ns], query: survivor, limit: 12, contextMode })).error.code, 'storage_error');
  }
});

test('the recall hook prints a zero-delivered-receipt Memory without a receipt suffix', () => {
  const source = readFileSync(new URL('../../plugins/cairn-memory/scripts/hook.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  const lines = result.memories.map(');
  const end = source.indexOf('\n  await runIfActive', start);
  assert.ok(start >= 0 && end > start);
  const format = new Function('result', source.slice(start, end) + '\nreturn lines;');
  assert.deepEqual(format({ memories: [{ id: 'synthetic-memory', origin: 'agent-inferred', scope: 'project',
    confidence: .8, content: survivor, receipts: [], receiptCount: 1 }] }),
  [`- [synthetic-memory] (agent-inferred, project, confidence 0.80) ${survivor}`]);
});

// Delivery markers never participate in stored-proof validation.
for(const operation of operations) test(`delivery-only mixed evidence omits a marked Card and keeps its Memory ${operation}`,async t=>{
  const f=await fixture(t,'ordinary-53',operation),[b,a]=await capture(f);
  let card=ok(f.call('createCardDraft',{actionId:'synthetic-mixed-draft',drafting:'authored',input:{title:'Synthetic',body:message,
    memoryRefs:[memoryRef(b)],sourcePolicy:'retained-receipts-v1'}}));
  card=ok(f.call('confirmCardDraft',{actionId:'synthetic-mixed-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
  const ref={type:'card',namespace:ns,cardId:card.id,revision:card.revision,bodyRevision:card.bodyRevision};
  ok(act(f,operation,a));
  const fetched=ok(f.call('fetchEvidence',{intent:'current',refs:[memoryRef(b),ref]}));
  assert.deepEqual(fetched.items.map(item=>item.ref.memoryId),[b.id]);
  assert.deepEqual(fetched.items[0].provenance.sources,[]);
  assert.deepEqual(ok(f.call('revalidateEvidence',{snapshot:fetched.snapshot})).items,fetched.items);
  const selected=ok(f.call('selectEvidence',{intent:'current',query:'Synthetic',types:['memory','card'],limit:24}));
  assert.deepEqual(selected.items.map(item=>item.ref.memoryId),[b.id]);noLeak(fetched,'mixed fetch');
  for(const invalid of [{...ref,namespace:otherNamespace},{...ref,cardId:'synthetic-missing'}, {...ref,revision:0}])
    assert.equal(f.call('fetchEvidence',{intent:'current',refs:[memoryRef(b),invalid]}).ok,false);
});

for(const operation of operations) for(const existing of [false,true]) test(`delivery-only first qualified binding ${operation}, existing=${existing}`,async t=>{
  const f=await fixture(t,'ordinary-53',operation);
  const qualification={version:1,slot:{subject:'Synthetic subject',property:'Synthetic property',scope:'Synthetic scope',applies:'Synthetic applies'},
    value:'Synthetic value',attribution:'direct',commitment:'adopted',anchors:[{receiptIndex:0,start:0,end:message.length,text:message,
      fields:['subject','property','scope','applies','value','attribution','commitment']}]};
  const b=ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'fact'},receipts:[source()],qualification})).memory;
  // Qualification is immutable on deduplication. Seed it before the ordinary
  // capture instead of attempting to add it to an already unqualified Memory.
  const [initialB,a]=await capture(f);
  assert.equal(b.id,initialB.id);
  let slotId=null;
  if(existing){
    const c=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic other qualified claim',kind:'fact'},
      receipts:[{...receipt('synthetic-other-qualified'),excerpt:message}],qualification})).memory;
    slotId=ok(f.core.bindQualifiedClaim({namespace:ns,memoryId:c.id,expectedRevision:c.revision,slotId:null,singleClaim:true})).slotId;
  }
  ok(act(f,operation,a));
  const bound=ok(f.core.bindQualifiedClaim({namespace:ns,memoryId:b.id,expectedRevision:b.revision,slotId,singleClaim:true}));
  if(slotId)assert.equal(bound.slotId,slotId);else assert.equal(typeof bound.slotId,'string');
  assert.equal(ok(f.core.get({namespace:ns,memoryId:b.id,includeQualification:true})).qualification,null);
});

for(const operation of operations) test(`delivery-only procedural writes commit with their saved retained anchor ${operation}`,async t=>{
  const f=await fixture(t,'ordinary-53',operation);f.model.items[0].kind='instruction';
  const [b,a]=await capture(f),saved=ok(f.core.get({namespace:ns,memoryId:b.id}));
  const anchor={receiptId:saved.receipts[0].id,digest:sourceDigest(saved.receipts[0].excerpt),start:0,end:8};
  const write=expectedTagRevision=>f.core.setProceduralMemory({namespace:ns,memoryId:b.id,expectedRevision:b.revision,expectedTagRevision,
    procedural:{anchors:[anchor]}});
  const first=ok(write(0));ok(act(f,operation,a));
  const second=ok(write(first.tag.tagRevision));
  assert.deepEqual(Object.keys(second).sort(),['indexRevision','tag']);
  assert.equal(second.tag.tagRevision,first.tag.tagRevision+1);assert.deepEqual(second.tag.anchors,first.tag.anchors);
  assert.equal(ok(f.core.get({namespace:ns,memoryId:b.id})).procedural,undefined);
});

for(const operation of operations) test(`delivery-only unchanged Card confirmation and retained-receipt creation succeed ${operation}`,async t=>{
  const f=await fixture(t,'ordinary-53',operation),[b,a]=await capture(f);
  const draft=actionId=>ok(f.call('createCardDraft',{actionId,drafting:'authored',input:{title:'Synthetic title',body:message,
    memoryRefs:[memoryRef(b)],sourcePolicy:'retained-receipts-v1'}}));
  const card=draft('synthetic-retained-draft');ok(act(f,operation,a));
  const confirmed=ok(f.call('confirmCardDraft',{actionId:'synthetic-retained-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
  assert.equal(confirmed.state,'confirmed');
  const later=draft('synthetic-later-draft');
  for(const c of [confirmed,later]){const read=ok(f.call('getCard',{cardId:c.id}));assert.equal(read.card,null);noLeak(read,'Card projection');}
});

test('delivery-only marker-free rationale validates the root before eleven-edge overflow',async t=>{
  const f=await fixture(t,'ordinary-53'),memories=[];
  for(let i=0;i<6;i++){
    f.model.items=[{content:`Synthetic rationale claim ${i}`,kind:'fact',confidence:.8,sourceIndices:[0]}];
    memories.push((await capture(f,`synthetic-rationale-batch-${i}`,`Synthetic rationale support ${i}`))[0]);
  }
  const refs=memories.map(memoryRef).map(({memoryId,revision})=>({memoryId,revision}));
  const propose=async (chosen,edges)=>{f.model.relate=()=>({edges:edges.map(([from,to,relation])=>({from,to,relation,fromReceipt:0,toReceipt:0}))});
    ok(await f.core.reviewRationale({namespace:ns,refs:chosen}));};
  for(const neighbor of refs.slice(1))await propose([refs[0],neighbor],[[1,0,'supports-decision'],[1,0,'challenges-premise']]);
  await propose(refs.slice(1,3),[[1,0,'challenges-premise']]);
  assert.deepEqual(markers(f),[]);
  assert.equal(f.core.getRationale({namespace:ns,...refs[0],revision:refs[0].revision+1}).error.code,'revision_conflict');
  assert.equal(f.core.getRationale({namespace:ns,...refs[0]}).error.code,'rationale_limit');
});

test('Raw deletion and shared-source markers preserve the retained receipt count',async t=>{
  const f=await fixture(t,'raw-53');
  const rawCapture=async(sessionId,text,eventId)=>{
    const result=ok(await f.core.captureRaw(request(splitRaw(text,{id:eventId})[0],{namespace:ns,sessionId,eventId})));
    const interpreted=result.interpretation.ok===undefined?result.interpretation:ok(result.interpretation);
    return {conversationId:result.raw.conversationId,memories:interpreted.admission.memories};
  };
  // The shared address is ordinary evidence. Forgetting a real Raw-backed
  // sibling would also install the base Raw exclusion, which is a different
  // authority rule from delivery-only markers.
  // Explicit admission proves that the ordinary shared receipt has independent
  // ancestry; deletion conservatively removes recent unknown-origin receipts.
  ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'fact'},receipts:[{client:'synthetic',sessionId:'synthetic-ordinary-shared',
    eventId:'synthetic-shared-source',role:'user',excerpt:message}]}));
  const shared=ok(await f.core.capture({namespace:ns,client:'synthetic',sessionId:'synthetic-ordinary-shared',eventId:'synthetic-ordinary-batch',
    messages:[{id:'synthetic-shared-source',role:'user',content:message}]}));
  const [initialB,a]=shared.admission.memories;
  f.model.items=[{content:survivor,kind:'fact',confidence:.8,sourceIndices:[0]}];
  const removed=await rawCapture('synthetic-removed-conversation','Synthetic removed conversation support','synthetic-removed-source');
  const retainedText='Synthetic retained conversation support';
  const retained=await rawCapture('synthetic-retained-conversation',retainedText,'synthetic-retained-source');
  const stored=()=>f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(initialB.id).n;
  assert.equal(stored(),3);
  const conversation=ok(await f.core.getConversation({namespace:ns,conversationId:removed.conversationId})).conversation;
  ok(f.core.deleteConversation({namespace:ns,conversationId:removed.conversationId,expectedRevision:conversation.revision,actionId:'synthetic-combined-deletion'}));
  assert.equal(stored(),2,'conversation deletion removes its receipt');
  ok(act(f,'forget',a));
  async function assertDelivered(excerpts){
    const detail=ok(f.core.get({namespace:ns,memoryId:initialB.id}));
    assert.equal(detail.memory.content,survivor);assert.ok(detail.memory.receiptCount>=1);
    assert.deepEqual(detail.receipts.map(receipt=>receipt.excerpt),excerpts);noLeak(detail,'combined get');
    const request={namespace:ns,refs:[{memoryId:initialB.id,revision:detail.memory.revision}],tokenBudget:4000};
    let cursor;const items=[];
    do{const page=ok(f.core.fetch({...request,...(cursor?{cursor}:{})}));items.push(...page.items);cursor=page.nextCursor;noLeak(page,'combined fetch');}while(cursor);
    const recalled=ok(await f.core.recall({readSet:[ns],query:survivor,limit:8}));noLeak(recalled,'combined recall');
    const usage=ok(f.core.fetch({...request,contextMode:'source-evidence'}));noLeak(usage,'combined source fetch');
    for(const values of [items,recalled.memories,usage.items]){
      const item=values.find(item=>item.memory.id===initialB.id);assert.ok(item);
      assert.ok(item.receiptCount>=1);assert.deepEqual(item.receipts.map(receipt=>receipt.excerpt),excerpts);
    }
    assert.equal(JSON.stringify({detail,items,recalled,usage}).includes('Synthetic removed conversation support'),false);
  }
  await assertDelivered([retainedText]);
  const last=ok(await f.core.getConversation({namespace:ns,conversationId:retained.conversationId})).conversation;
  ok(f.core.deleteConversation({namespace:ns,conversationId:retained.conversationId,expectedRevision:last.revision,actionId:'synthetic-final-deletion'}));
  assert.equal(stored(),1,'the ordinary shared receipt remains stored and withheld');
  await assertDelivered([]);
});

for (const operation of operations) for (const route of ['embedded','product'])
test(`candidate fetch aligns omitted Cards and caller fences ${route} ${operation}`, async t => {
  const f=await fixture(t,'ordinary-53',operation),[b,a]=await capture(f);
  let card=ok(f.call('createCardDraft',{actionId:'synthetic-candidate-draft',drafting:'authored',input:{title:'Synthetic',body:message,
    memoryRefs:[memoryRef(b)],sourcePolicy:'retained-receipts-v1'}}));
  card=ok(f.call('confirmCardDraft',{actionId:'synthetic-candidate-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
  const cardRef={type:'card',namespace:ns,cardId:card.id,revision:card.revision,bodyRevision:card.bodyRevision};
  const c=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic unaffected candidate',kind:'fact'},receipts:[receipt('synthetic-candidate-independent')]})).memory;
  ok(act(f,operation,a));
  let call;
  if(route==='product') {
    const facade=openContextProductFacade(f.path,{authorize:()=>({accessGenerations:[1],check(){}})});
    t.after(()=>facade.close());call=input=>facade.fetchCandidateEvidence(input,{});
  } else call=input=>f.trusted.call(f.context,'fetchCandidateEvidence',input);
  // Put the omitted Card before both retained items to expose fence shifts.
  const input={readSet:[ns],intent:'current',refs:[cardRef,memoryRef(b),memoryRef(c)]};
  const first=ok(await call(input));
  assert.deepEqual(first.items.map(item=>item.ref.memoryId),[b.id,c.id]);
  assert.deepEqual(first.items[0].provenance.sources,[]);
  const saved=JSON.parse(Buffer.from(first.snapshot.split('.')[0],'base64url').toString());
  assert.equal(saved.refs.length,2);assert.equal(saved.fences.length,2);
  const checked=ok(await call({...input,fences:['omitted0',...saved.fences.map(value=>value.slice(0,8))]}));
  assert.deepEqual(checked.items,first.items);
  assert.deepEqual(ok(await call({readSet:[ns],snapshot:first.snapshot})).items,first.items);
  const wrong=await call({...input,fences:[null,null,'invalid0']});
  assert.equal(wrong.error.code,'snapshot_stale');
  const empty=ok(await call({...input,refs:[cardRef]}));assert.deepEqual(empty.items,[]);
  assert.deepEqual(ok(await call({readSet:[ns],snapshot:empty.snapshot})).items,[]);
  for(const result of [first,checked,empty]){noLeak(result,'candidate fetch');assert.equal(hasId(result,card.id),false);}
});

test('receipt snapshot deduplicates before count, offset and anchor reads',async t=>{
  const f=await fixture(t,'ordinary-53'),entries=[];
  for(let i=0;i<12;i++) {
    const b=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic deduplicated candidate '+i,kind:'fact'},receipts:[receipt('synthetic-deduplicated-'+i)]})).memory;
    entries.push({namespace:ns,memoryId:b.id});
  }
  const measured=await trace(()=>readTransaction(f.db,()=>{
    const memo=createContentReadMemo(f.db);
    for(let i=0;i<12;i++)receiptDeliverySnapshot(f.db,[...entries,...entries],memo,[],{limit:17});
    return memo.deliveryHeaders.size;
  }));
  assert.equal(measured.result,12);assert.equal(measured.rows.filter(isLookup).length,1);
  assert.equal(measured.rows.filter(row=>row.sql.startsWith('SELECT count(*) AS n FROM receipts r INDEXED BY memory_receipts')).length,12);
  assert.equal(measured.rows.filter(row=>row.sql.includes('FROM qualification_anchors q CROSS JOIN')).length,12);
});

test('get paging and context projection stay linear for a large receipt set',async t=>{
  const f=await fixture(t,'ordinary-53');f.model.countTokens=()=>1;
  let b;
  for(let i=0;i<2000;i++) b=ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'fact'},receipts:[receipt('synthetic-linear-'+String(i).padStart(4,'0'))]})).memory;
  const expected=f.db.prepare('SELECT id FROM receipts WHERE memory_id=? ORDER BY created_at,id').all(b.id).map(row=>row.id);
  const measured=await trace(async()=>{
    let cursor;const ids=[];
    do {const page=ok(f.core.get({namespace:ns,memoryId:b.id,receiptLimit:16,...(cursor?{receiptCursor:cursor}:{})}));
      ids.push(...page.receipts.map(row=>row.id));cursor=page.nextReceiptCursor;
    } while(cursor);
    return ids;
  });
  assert.deepEqual(measured.result,expected);
  assert.equal(measured.rows.some(row=>row.sql.includes('receipts previous')),false,'no repeated prefix counts');
  const headers=measured.rows.filter(row=>row.sql.startsWith('SELECT j.value AS input,r.id'));
  assert.ok(headers.length<=Math.ceil(2000/16)+1);
  assert.ok(headers.every(row=>row.args[1]===49),'page probe plus fixed header margin');
  const counted=measured.rows.filter(row=>row.sql.startsWith('SELECT count(*) AS n FROM receipts r INDEXED BY memory_receipts'));
  assert.ok(counted.length<=1,'stored count is cached under both native change counters');
  const result=ok(await f.trusted.call(f.context,'fetchCandidateEvidence',{readSet:[ns],intent:'current',refs:[memoryRef(b)]}));
  assert.equal(result.items[0].provenance.receiptMetadata.length,16);
});

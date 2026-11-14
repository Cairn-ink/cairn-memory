import assert from "node:assert/strict";
import { DatabaseSync, StatementSync } from "node:sqlite";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { roleTaskMeteredText, roleTaskToolResponse, openMemoryCore } from "../index.mjs";
import { openRawCaptureCore } from "../raw-capture.mjs";
import { lineageFixture, lineageHost, ns, ok, receipt } from "../testing/card-lineage-fixture.mjs";
import { safetyFixture } from "../testing/content-safety-s2h-fixture.mjs";
import { host as contextHost } from "../testing/context-read-core-fixture.mjs";
import { request, splitRaw, localPlainPort } from "../testing/raw-capture-fixtures.mjs";
import { createTestWorkspace } from "../../tools/testing/workspace.mjs";
import { transaction } from "../database.mjs";

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
    sourceFetch: f.core.fetch({ namespace: ns, refs: [{ memoryId: memory.id, revision: memory.revision }],
      contextMode: 'source-evidence', tokenBudget: 4000 }),
    sourceRecall: await f.core.recall({ readSet: [ns], query: survivor, limit: 8, contextMode: 'source-evidence' }),
  };
  const sourceError = get.memory.receiptCount > 100 ? 'context_item_too_large' : 'source_unavailable';
  for (const name of ['sourceFetch', 'sourceRecall'])
    assert.deepEqual(values[name], { ok: false, error: { code: sourceError, retryable: false } }, name);
  assert.ok(f.model.offered.some(ref => ref.memoryId === memory.id), 'scripted selector was offered B');
  for (const name of ['recall', 'fetch']) {
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
  values.exportedText = roleTaskMeteredText(values.contextRead.metered);
  values.exportedTool = roleTaskToolResponse({ok:true,value:values.contextRead});
  for (const [name, value] of Object.entries(values)) {
    noLeak(value, name);
    if (!['sourceFetch', 'sourceRecall'].includes(name)) assert.ok(hasId(value, memory.id), name + ' includes B');
  }
  if (expectedReceipts.length) assert.ok(JSON.stringify(values.contextRead).includes(independent), 'context keeps independent evidence');
  return values;
}

async function withoutMarkers(f, work) {
  const retained = markers(f);
  f.db.prepare("DELETE FROM suppressed WHERE owner_id=? AND scope=? AND project_id=? AND fingerprint GLOB 'rs1:*'")
    .run(ns.ownerId, ns.scope, ns.projectId);
  try { return await work(); }
  finally { for (const token of retained) f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId, ns.scope, ns.projectId, token); }
}

// Bulk fixture rows isolate receipt-read complexity from admission's write
// verification. Keep the same header digest and independent Raw-origin facts
// that public admission stores. Only the large read fixtures use this helper.
export function appendReceipts(f,memory,receipts) {
  transaction(f.db,()=>{
    const insert=f.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?)');
    const origins=f.db.prepare("INSERT INTO raw_receipt_origins VALUES(?,'independent')");
    for(const [index,row]of receipts.entries()) {
      const id='synthetic-bulk-'+memory.id+'-'+index;
      insert.run(id,memory.id,key(row),row.client,row.sessionId,row.eventId,row.role,row.excerpt,'2026-01-01T00:00:00.000Z');
      origins.run(id);
    }
  });
}

export { survivor, forgotten, message, independent, ordinaryKinds, kinds, operations, normalize, insertSQL, receiptSQL, lookupSQL, isLookup, source, otherNamespace, otherOwner, key, noLeak, hasId, trace, scripted, fixture, capture, act, markers, memoryRef, originalRow, refreshContext, reads, withoutMarkers };

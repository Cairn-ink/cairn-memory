import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, lstatSync, readFileSync, readdirSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { assertContextReadReadOnlyAuxiliaries, openContextReadSidecar } from '../context-read-sidecar.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { createBM25 } from '../context-read-bm25.mjs';
import { fixture, request, drain, snapshot, ns, ok, receipt, observeDatabaseFiles } from '../testing/context-read-fixture.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { sourceFixture, savedSource, anchor, resolve, draft, ns as rawNs } from '../testing/raw-source-fixtures.mjs';
const unavailable = fn => assert.throws(fn, { code: 'index_unavailable' });

test('R02/R03/R10 real canonical stores; shared query_only reads; lexical equals clean BM25', t => {
  const f = fixture(t), documents = ['apple apple pear', 'apple', 'pear', 'unfiled 中 資料庫 𠀀𠀁'];
  const rows = documents.map(text => ({ memoryId: f.admit(text).id, text }));
  const ddl = f.db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all();
  let reads = 0;
  const originalExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    const result = originalExec.call(this, sql);
    if (sql === 'BEGIN') {
      reads++; assert.equal(this.prepare('PRAGMA query_only').get().query_only, 1);
      assert.ok(this.isTransaction);
      assert.throws(() => originalExec.call(this, 'CREATE TABLE synthetic_forced_write(x)'), /readonly|read.only/i);
    }
    return result;
  };
  f.workspace.defer(() => { DatabaseSync.prototype.exec = originalExec; });
  const index = f.index({ batchSize: 2 });
  unavailable(() => index.lexical(request(), 'apple'));
  const built = drain(index);
  assert.equal(built.coverage.n, 4); assert.equal(built.totals.textRows, 4); assert.ok(reads > 0);
  for (const query of ['apple', 'apple apple', '資料', '𠀀𠀁', 'missing']) {
    const expected = createBM25(rows).search(query).map(({ memoryId, score }) => ({ id: memoryId, score }));
    assert.deepEqual(index.lexical(request(), query).map(row => ({ id: row.ref.memoryId, score: row.score })), expected);
  }
  assert.equal(f.db.prepare('PRAGMA query_only').get().query_only, 0);
  assert.deepEqual(f.db.prepare("SELECT name,sql FROM sqlite_master ORDER BY name").all(), ddl);
  assert.equal(lstatSync(f.path + '.context-read-v1.sqlite').mode & 0o777, 0o600);
  assert.equal(drain(index).totals.canonicalRows, 0, 'unchanged epochs require no projection scan');
});

test('R08 incremental one mutation scans metadata, reads one text, adjusts N/length/df and removes vectors', async t => {
  const f = fixture(t), memories = Array.from({ length: 25 }, (_, i) => f.admit(`synthetic apple item ${i}`));
  const index = f.index({ batchSize: 7 }); drain(index);
  const fake = createFakeEmbedder(); await index.refreshVectors(request(), fake, { isCurrent: () => true });
  assert.equal(index.semanticPreflight(request(), fake).state, 'ready');
  const target = memories[9];
  ok(f.core.correct({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
    content: 'synthetic banana corrected', kind: 'fact', receipt: receipt('correction') }));
  unavailable(() => index.lexical(request(), 'apple'));
  const sql = [], original = f.db.prepare;
  f.db.prepare = function(query) { sql.push(query); return original.call(this, query); };
  let result;
  try { result = drain(index); } finally { f.db.prepare = original; }
  assert.equal(result.totals.canonicalRows, 25); assert.equal(result.totals.textRows, 1);
  assert.equal(result.totals.transformed, 1); assert.equal(result.buildState, 'ready');
  assert.equal(sql.filter(query => /SELECT content AS text/.test(query)).length, 1);
  assert.ok(sql.filter(query => /FROM memories INDEXED/.test(query)).every(query => !/content|SELECT \*/i.test(query)));
  assert.equal(index.lexical(request(), 'banana')[0].ref.memoryId, target.id);
  assert.equal(index.lexical(request(), 'apple').length, 24);
  assert.equal(index.semanticPreflight(request(), fake).state, 'partial_coverage');
  const before = snapshot(f.path); index.close(); unlinkSync(f.path + '.context-read-v1.sqlite');
  const rebuilt = f.index(); drain(rebuilt);
  assert.deepEqual(snapshot(f.path), before, 'documents, postings, N, total length and df equal a clean rebuild');
});

test('R08/R09 one-mutation writes touch only the changed document and its postings/statistics', t => {
  const f = fixture(t), memories = Array.from({ length: 300 }, (_, i) => f.admit(`synthetic apple item ${i}`));
  const index = f.index(); drain(index);
  const path = f.path + '.context-read-v1.sqlite', audit = new DatabaseSync(path);
  f.workspace.defer(() => audit.close());
  audit.exec('CREATE TABLE write_audit(table_name TEXT,row_id TEXT,operation TEXT) STRICT;');
  for (const table of ['generations', 'documents', 'postings', 'statistics', 'vectors']) {
    const key = table === 'statistics' ? 'term' : 'id';
    for (const operation of ['INSERT', 'UPDATE', 'DELETE']) audit.exec(`CREATE TRIGGER audit_${table}_${operation}
      AFTER ${operation} ON ${table} BEGIN INSERT INTO write_audit VALUES('${table}',${operation === 'DELETE' ? 'OLD' : 'NEW'}.${key},'${operation}'); END;`);
  }
  const target = memories[150], oldTerms = audit.prepare('SELECT term FROM postings WHERE id=?').all(target.id).map(row => row.term),
    oldPostings = oldTerms.length;
  ok(f.core.correct({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
    content: 'synthetic banana updated', kind: 'fact', receipt: receipt('audit-correction') }));
  const refreshed = drain(index), newTerms = audit.prepare('SELECT term FROM postings WHERE id=?').all(target.id).map(row => row.term),
    newPostings = newTerms.length;
  const rows = audit.prepare('SELECT table_name,count(*) AS n FROM write_audit GROUP BY table_name').all();
  const counts = Object.fromEntries(rows.map(row => [row.table_name,row.n]));
  assert.equal(counts.documents, 2, 'one old row deleted and one new row inserted');
  assert.equal(counts.postings, oldPostings + newPostings, 'only the changed document postings are replaced');
  assert.equal(counts.generations, 2, 'fence and complete checkpoint published in one transaction');
  assert.equal(audit.prepare("SELECT count(*) AS n FROM write_audit WHERE table_name IN('documents','postings','vectors') AND row_id!=?").get(target.id).n, 0);
  const changedTerms = new Set(['', ...oldTerms, ...newTerms]);
  assert.ok(audit.prepare("SELECT row_id FROM write_audit WHERE table_name='statistics'").all().every(row => changedTerms.has(row.row_id)),
    'statistics writes contain only old/new terms and the projection totals');
  assert.ok((counts.statistics ?? 0) <= 2 * (oldPostings + newPostings) + 2);
  assert.ok(Object.values(counts).reduce((sum,n)=>sum+n,0) < 50);
  assert.equal(refreshed.totals.unchangedDocumentSqlMs, 0);
  assert.equal(refreshed.totals.canonicalRows, 300); assert.equal(refreshed.totals.sidecarRows, 300);
  assert.equal(refreshed.totals.textRows, 1); assert.equal(refreshed.totals.writeTransactions, 1);
  assert.equal(refreshed.coverage.n, 300);
});

test('R08 feature-off correction, supersession, forget and insertion reconcile through restart without resurrection', t => {
  const f = fixture(t), a = f.admit('apple old'), b = f.admit('apple remove');
  let index = f.index(); drain(index); index.close();
  const writer = openMemoryCore({ path: f.path }); f.workspace.defer(() => writer.close());
  ok(writer.supersede({ namespace: ns, memoryId: a.id, expectedRevision: a.revision,
    replacement: { content: 'banana replacement', kind: 'fact' }, receipts: [receipt('replacement')] }));
  ok(writer.forget({ namespace: ns, memoryId: b.id, expectedRevision: b.revision }));
  f.admit('cherry inserted');
  index = f.index(); unavailable(() => index.lexical(request(), 'apple')); drain(index);
  assert.deepEqual(index.lexical(request(), 'apple'), []);
  assert.equal(index.lexical(request(), 'banana').length, 1);
  assert.equal(index.lexical(request(), 'cherry').length, 1);
  const history = request({ intent: 'history' }); drain(index, history);
  assert.equal(index.lexical(history, 'old').length, 1);
  assert.equal(index.lexical(history, 'remove').length, 0);
});

test('R08 feature-off capture and direct confirmation/rejection follow current/history eligibility', async t => {
  let content = 'synthetic awaiting decision one';
  const f = fixture(t, { coreOptions: { decisionReview: 'required-v1', model: {
    ...rationaleModel(), extract: () => ({ items: [{ content, kind: 'decision', confidence: .8, sourceIndices: [0] }] }),
  } } });
  const index = f.index(), current = request(), history = request({ intent: 'history' }); drain(index);
  const capture = eventId => f.core.capture({ namespace: ns, client: 'synthetic', sessionId: 'capture', eventId,
    messages: [{ id: eventId, role: 'user', content }] });
  ok(await capture('one'));
  let awaiting = ok(f.core.list({ namespace: ns, reviewState: 'awaiting' })).memories[0];
  drain(index); drain(index, history);
  assert.equal(index.lexical(current, 'decision').length, 0); assert.equal(index.lexical(history, 'decision').length, 1);
  ok(f.core.confirm({ namespace: ns, memoryId: awaiting.id, expectedRevision: awaiting.revision, actionId: 'confirm', receipt: receipt('confirm') }));
  drain(index); assert.equal(index.lexical(current, 'decision').length, 1);
  content = 'synthetic awaiting decision two'; ok(await capture('two'));
  awaiting = ok(f.core.list({ namespace: ns, reviewState: 'awaiting' })).memories[0];
  drain(index, history); assert.equal(index.lexical(history, 'decision').length, 2);
  ok(f.core.reject({ namespace: ns, memoryId: awaiting.id, expectedRevision: awaiting.revision, actionId: 'reject' }));
  drain(index); drain(index, history); assert.equal(index.lexical(history, 'decision').length, 1);
});

test('R06/R09 bounded restart checkpoints, changed epochs/access fences and foreign-statistics isolation', t => {
  const f = fixture(t); Array.from({ length: 9 }, (_, i) => f.admit(`synthetic apple ${i}`));
  let index = f.index({ batchSize: 3 });
  const input = request({ budget: { maxItems: 1, maxMs: 5000 } }), first = index.reconcile(input);
  assert.equal(first.status, 'rebuilding'); assert.equal(first.metrics.transformed, 1); assert.equal(first.coverage.n, null);
  unavailable(() => index.lexical(input, 'apple')); index.close();
  index = f.index({ batchSize: 3 });
  const next = index.reconcile(input); assert.ok(next.progress.checkpoint > first.progress.checkpoint);
  assert.equal(next.metrics.textRows, 1, 'committed text is not replayed');
  f.admit('synthetic apple new');
  const changed = index.reconcile(input); assert.ok(changed.progress.sequence > next.progress.sequence);
  drain(index, input);
  const baseline = index.lexical(input, 'apple');
  f.admit('apple '.repeat(500), { ...ns, projectId: 'foreign' });
  assert.deepEqual(index.lexical(input, 'apple'), baseline);
  const accessChanged = request({ accessGeneration: 2 }); unavailable(() => index.lexical(accessChanged, 'apple'));
  const reconciled = drain(index, accessChanged); assert.equal(reconciled.totals.textRows, 0);
  assert.deepEqual(index.lexical(accessChanged, 'apple'), baseline);
});

test('R09 concurrent maintenance rejects a stale checkpoint instead of advancing another worker phase', t => {
  const f = fixture(t); Array.from({ length: 5 }, (_, i) => f.admit(`synthetic apple ${i}`));
  const peer = f.index(); let metadataRead = false, raced = false;
  const original = f.db.prepare;
  f.db.prepare = function(sql) { if (/FROM memories INDEXED/.test(sql)) metadataRead = true; return original.call(this, sql); };
  const originalExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    // Interleave after the canonical helper has restored/exited, before the
    // other connection starts its sidecar read transaction.
    if (this !== f.db && sql === 'BEGIN' && metadataRead && !raced) { raced = true; drain(peer); }
    return originalExec.call(this, sql);
  };
  const index = f.index();
  try {
    assert.throws(() => index.reconcile(request()), { code: 'index_unavailable', reason: 'stale_index' });
    assert.equal(raced, true); assert.equal(drain(index).coverage.n, 5);
    assert.equal(index.lexical(request(), 'apple').length, 5);
  } finally { f.db.prepare = original; DatabaseSync.prototype.exec = originalExec; }
});

function makeCard(f, key, input = { authoredInput: { text: 'synthetic support note', occurredAt: null } }, applicability = 'current') {
  const card = ok(f.call('createCardDraft', { namespace: ns, actionId: `draft-${key}`, drafting: 'authored',
    input: { title: `apple ${key}`, body: 'synthetic apple Card', ...input } }));
  return ok(f.call('confirmCardDraft', { namespace: ns, cardId: card.id, expectedRevision: card.revision,
    actionId: `confirm-${key}`, ...(applicability === undefined ? {} : { applicability }) }));
}
function canonicalCards(f, intent) {
  return ok(f.call('selectEvidence', { namespace: ns, types: ['card'], intent, query: 'apple', limit: 24, scanRows: 1024 })).items.map(row => row.ref.cardId).sort();
}
test('R08/R09 projected Card eligibility equals canonical predicate: notes, receipts, revisions and history', t => {
  const f = fixture(t, { cards: true }), memory = f.admit('synthetic apple receipt');
  const noteCard = makeCard(f, 'note');
  makeCard(f, 'receipt', { sourcePolicy: 'retained-receipts-v1', memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }] });
  makeCard(f, 'historical', undefined, 'historical');
  const index = f.index({ batchSize: 2 }), current = request({ types: ['card'] }), history = { ...current, intent: 'history' };
  const check = () => { for (const input of [current, history]) {
    drain(index, input);
    assert.deepEqual(index.lexical(input, 'apple').map(row => row.ref.cardId).sort(), canonicalCards(f, input.intent));
  } };
  check();
  const unchanged = drain(index, current); assert.equal(unchanged.totals.textRows, 0);
  let detail = ok(f.call('getCard', { namespace: ns, cardId: noteCard.id })).card;
  ok(f.call('editKnowledgeCard', { namespace: ns, cardId: noteCard.id, expectedRevision: detail.revision,
    actionId: 'edit-body', title: detail.title, body: 'synthetic apple edited Card',
    bindings: detail.bindings.map(binding => binding.source), applicability: 'current' }));
  check();
  const plan = f.db.prepare(`EXPLAIN QUERY PLAN SELECT id,revision,body_revision,state FROM private_cards
    INDEXED BY private_card_scope WHERE owner_id=? AND scope=? AND project_id=? AND state=? AND id>? ORDER BY id LIMIT ?`)
    .all(ns.ownerId, ns.scope, ns.projectId, 'confirmed', '', 128).map(row => row.detail).join('\n');
  assert.match(plan, /private_card_scope/); assert.doesNotMatch(plan, /TEMP B-TREE/);
  const note = ok(f.call('getCard', { namespace: ns, cardId: noteCard.id })).card.bindings[0].source;
  ok(f.call('deleteSourceNote', { namespace: ns, sourceId: note.sourceId, expectedRevision: note.revision, actionId: 'delete-note' }));
  check();
  const writer = openMemoryCore({ path: f.path }); f.workspace.defer(() => writer.close());
  ok(writer.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    content: 'synthetic corrected receipt', kind: 'fact', receipt: receipt('correct-receipt') }));
  check(); assert.equal(index.lexical(current, 'apple').length, 0); assert.equal(index.lexical(history, 'apple').length, 3);
  detail = ok(f.call('getCard', { namespace: ns, cardId: noteCard.id })).card;
  ok(f.call('deleteKnowledgeCard', { namespace: ns, cardId: noteCard.id, expectedRevision: detail.revision, actionId: 'delete-card' }));
  check(); assert.equal(index.lexical(history, 'apple').length, 2);
});

test('R08/R09 Raw support exclusion and conversation deletion match canonical eligibility', async t => {
  const f = sourceFixture(t, { model: { extract: () => ({ items: [{ content: 'synthetic locator', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  const source = await savedSource(f, 'Synthetic independently retained apple source.');
  const refs = await resolve(f, [anchor(source, 0, 9)]), card = ok(draft(f, refs));
  ok(f.call('confirmCardDraft', { namespace: rawNs, cardId: card.id, expectedRevision: card.revision, actionId: 'confirm', applicability: 'current' }));
  const index = openContextReadSidecar({ path: f.path, db: f.db }); f.workspace.defer(() => index.close());
  const input = request({ readSet: [rawNs], types: ['card'] });
  drain(index, input); assert.equal(index.lexical(input, 'synthetic').length, 1);
  const unchanged = index.reconcile(input); assert.equal(unchanged.metrics.textRows, 0);
  // The ordinary feature-off API excludes bound Raw support as part of forget.
  const off = openMemoryCore({ path: f.path }); f.workspace.defer(() => off.close());
  const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
  ok(off.forget({ namespace: rawNs, memoryId: memory.id, expectedRevision: memory.revision }));
  drain(index, input); assert.equal(index.lexical(input, 'synthetic').length, 0);
  const history = { ...input, intent: 'history' }; drain(index, history); assert.equal(index.lexical(history, 'synthetic').length, 1);
  const revision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision;
  ok(f.core.deleteConversation({ namespace: rawNs, conversationId: source.conversationId, expectedRevision: revision, actionId: 'delete-conversation' }));
  drain(index, input); drain(index, history); assert.equal(index.lexical(input, 'synthetic').length, 0);
});

test('R04/R09 vector refresh outside locks, complete preflight, float32 load refusal and late mutation', async t => {
  const f = fixture(t), memory = f.admit('synthetic automobile'), index = f.index(); drain(index);
  const fake = createFakeEmbedder({ aliases: { automobile: 'car' } }); let calls = 0;
  const port = { ...fake, async embed(texts, options) {
    calls++; assert.equal(f.db.isTransaction, false);
    const side = new DatabaseSync(f.path + '.context-read-v1.sqlite');
    try { side.exec('BEGIN IMMEDIATE'); side.exec('ROLLBACK'); } finally { side.close(); }
    return fake.embed(texts, options);
  } };
  assert.equal(index.semanticPreflight(request(), port).state, 'partial_coverage'); assert.equal(calls, 0);
  await index.refreshVectors(request(), port, { isCurrent: () => true });
  const ready = index.semanticPreflight(request(), port); assert.equal(ready.state, 'ready');
  assert.equal(ready.score((await fake.embed(['car']))[0])[0].ref.memoryId, memory.id);
  const peer = new DatabaseSync(f.path + '.context-read-v1.sqlite');
  const bad = Buffer.alloc(fake.dimensions * 4); bad.writeFloatLE(Infinity, 0);
  peer.prepare('UPDATE vectors SET data=?').run(bad); peer.close();
  assert.equal(index.semanticPreflight(request(), port).state, 'provider_error');
  assert.equal(index.lexical(request(), 'automobile').length, 1);
  const changed = { ...fake, revision: 'late', async embed(texts, options) {
    ok(f.core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'synthetic changed', kind: 'fact', receipt: receipt('during-embedding') }));
    return fake.embed(texts, options);
  } };
  await assert.rejects(index.refreshVectors(request(), changed, { isCurrent: () => true }), { code: 'index_unavailable' });
  drain(index); assert.equal(index.semanticPreflight(request(), changed).state, 'partial_coverage');
});

test('R04/R06 late vector completion cannot publish after revocation or deadline', async t => {
  const f = fixture(t); f.admit('synthetic apple'); const index = f.index(); drain(index);
  const fake = createFakeEmbedder(); let authorized = true, calls = 0;
  const revoked = { ...fake, async embed(texts, options) { calls++; authorized = false; return fake.embed(texts, options); } };
  await assert.rejects(index.refreshVectors(request(), revoked, { isCurrent: () => authorized }), { code: 'scope_changed' });
  assert.equal(calls, 1); assert.equal(index.semanticPreflight(request(), fake).state, 'partial_coverage');
  const late = { ...fake, async embed(texts, options) {
    await new Promise(resolve => setTimeout(resolve, 15)); return fake.embed(texts, options);
  } };
  await assert.rejects(index.refreshVectors(request({ budget: { maxItems: 1, maxMs: 10 } }), late,
    { isCurrent: () => true }), { code: 'index_unavailable', reason: 'timeout' });
  assert.equal(index.lexical(request(), 'apple').length, 1);
});

test('R04/R10 lexical and vector scans use <=128-row batches and cooperative query deadlines', async t => {
  const f = fixture(t); Array.from({ length: 260 }, (_, i) => f.admit(`synthetic apple ${i}`));
  const batches = [];
  const original = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = original.call(this, sql);
    if (!/SELECT d\.\*,p\.frequency|hex\(v\.data\) AS vector_data/.test(sql)) return statement;
    return new Proxy(statement, { get(target, property) {
      const value = Reflect.get(target, property);
      if (property === 'all') return (...args) => { const rows = value.apply(target, args); batches.push(rows.length); return rows; };
      return typeof value === 'function' ? value.bind(target) : value;
    } });
  };
  f.workspace.defer(() => { DatabaseSync.prototype.prepare = original; });
  const index = f.index();
  drain(index); assert.equal(index.lexical(request(), 'apple').length, 24);
  const fake = createFakeEmbedder();
  await index.refreshVectors(request(), fake, { isCurrent: () => true });
  const ready = index.semanticPreflight(request(), fake); assert.equal(ready.state, 'ready');
  assert.ok(batches.length >= 6); assert.ok(batches.every(size => size <= 128));
  assert.throws(() => index.lexical(request(), 'apple', 24, { deadlineAt: 0 }), { code: 'index_unavailable', reason: 'timeout' });
  assert.equal(index.semanticPreflight(request(), fake, { deadlineAt: 0 }).state, 'timeout');
  const query = (await fake.embed(['apple']))[0];
  assert.throws(() => ready.score(query, { deadlineAt: 0 }), { code: 'index_unavailable', reason: 'timeout' });
});

test('R06 projection statistics combine only explicitly authorized same-owner namespaces', t => {
  const f = fixture(t), personal = { ownerId: ns.ownerId, scope: 'personal', projectId: null };
  const project = f.admit('synthetic apple project'), own = f.admit('synthetic apple personal', personal);
  f.admit('apple foreign', { ...ns, ownerId: 'foreign-owner' });
  const index = f.index(), combined = request({ readSet: [ns, personal], accessGenerations: [1, 2] });
  const built = drain(index, combined); assert.equal(built.coverage.n, 2);
  assert.deepEqual(index.lexical(combined, 'apple').map(row => row.ref.memoryId).sort(), [project.id, own.id].sort());
  assert.throws(() => index.lexical({ ...combined, accessGenerations: [1, 3] }, 'apple'), { code: 'index_unavailable' });
  assert.throws(() => index.reconcile(request({ readSet: [ns, personal] })), { code: 'authority_required' });
  assert.throws(() => index.reconcile(request({ readSet: [ns, { ...ns, projectId: 'other' }], accessGenerations: [1, 1] })), { code: 'invalid_read_set' });
});

test('R09 rebuild reasons: corrupt, incompatible, wrong-store and deleted sidecar', t => {
  const f = fixture(t); f.admit('synthetic apple');
  let index = f.index(); drain(index); index.close();
  writeFileSync(f.path + '.context-read-v1.sqlite', 'synthetic corrupt sqlite', { mode: 0o600 });
  unavailable(() => f.index({ readOnly: true }));
  index = f.index(); assert.equal(drain(index).reason, 'corrupt'); index.close();
  let corrupt = new DatabaseSync(f.path + '.context-read-v1.sqlite');
  corrupt.exec("UPDATE statistics SET n=n+1 WHERE term=''"); corrupt.close();
  index = f.index(); assert.equal(drain(index).reason, 'corrupt'); index.close();
  corrupt = new DatabaseSync(f.path + '.context-read-v1.sqlite');
  corrupt.exec('DROP TABLE vectors'); corrupt.close();
  index = f.index(); assert.equal(drain(index).reason, 'incompatible'); index.close();
  const peer = new DatabaseSync(f.path + '.context-read-v1.sqlite'); peer.exec('PRAGMA user_version=99'); peer.close();
  index = f.index(); assert.equal(drain(index).reason, 'incompatible'); index.close();
  const other = fixture(t); other.admit('synthetic foreign'); const otherIndex = other.index(); drain(otherIndex); otherIndex.close();
  copyFileSync(other.path + '.context-read-v1.sqlite', f.path + '.context-read-v1.sqlite');
  index = f.index(); assert.equal(drain(index).reason, 'wrong_store'); index.close();
  unlinkSync(f.path + '.context-read-v1.sqlite'); index = f.index(); assert.equal(drain(index).reason, 'missing');
});

test('R12 read-only missing/stale/hot/auxiliary/unsafe sidecars create no files, including transient files', async t => {
  const f = fixture(t); f.admit('synthetic apple');
  const before = readdirSync(f.workspace.path).sort();
  const observed = await observeDatabaseFiles(f, () => unavailable(() => f.index({ readOnly: true })));
  assert.deepEqual(readdirSync(f.workspace.path).sort(), before); assert.deepEqual(observed.events, []);
  const index = f.index(); drain(index); index.close();
  const reader = f.index({ readOnly: true }); assert.equal(reader.lexical(request(), 'apple').length, 1);
  assert.throws(() => reader.reconcile(request()), { code: 'invalid_input' });
  f.admit('synthetic fresh'); unavailable(() => reader.lexical(request(), 'apple')); reader.close();
  for (const suffix of ['-journal', '-wal', '-shm']) {
    for (const path of [f.path, f.path + '.context-read-v1.sqlite']) {
      writeFileSync(path + suffix, Buffer.alloc(1024, 1), { mode: 0o600 });
      const files = readdirSync(f.workspace.path).sort();
      unavailable(() => f.index({ readOnly: true }));
      assert.deepEqual(readdirSync(f.workspace.path).sort(), files); unlinkSync(path + suffix);
    }
  }
  const path = f.path + '.context-read-v1.sqlite'; unlinkSync(path); symlinkSync(f.path, path);
  unavailable(() => f.index()); unavailable(() => f.index({ readOnly: true }));
  assert.ok(lstatSync(path).isSymbolicLink());
  assert.throws(() => openContextReadSidecar({ path: ':memory:', db: f.db }), { code: 'index_unavailable' });
});

test('R12 checkpointed WAL header without auxiliaries refuses before SQLite can create transient files', async t => {
  for (const location of ['canonical', 'sidecar']) {
    const f = fixture(t); f.admit('synthetic apple'); const index = f.index(); drain(index); index.close();
    const path = location === 'canonical' ? f.path : f.path + '.context-read-v1.sqlite';
    const writer = new DatabaseSync(path);
    assert.equal(writer.prepare('PRAGMA journal_mode=WAL').get().journal_mode, 'wal'); writer.close();
    assert.equal(readFileSync(path)[18], 2);
    const before = readdirSync(f.workspace.path).sort();
    assert.ok(!before.some(name => name.endsWith('-wal') || name.endsWith('-shm')));
    const observed = await observeDatabaseFiles(f, () => {
      unavailable(() => assertContextReadReadOnlyAuxiliaries(f.path));
      unavailable(() => f.index({ readOnly: true }));
    });
    assert.deepEqual(readdirSync(f.workspace.path).sort(), before); assert.deepEqual(observed.events, []);
    if (location === 'sidecar') assert.equal(drain(f.index()).reason, 'incompatible');
  }
});

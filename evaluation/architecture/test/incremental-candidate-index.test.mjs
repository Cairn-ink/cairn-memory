import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

const [major, minor] = process.versions.node.split('.').map(Number);
const available = major > 22 || (major === 22 && minor >= 16);
const load = () => import('../incremental-candidate-index.mjs');
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('IC1/IC4 native FTS preflight, current authorized projection and frozen query controls',
  { skip: !available }, async (t) => {
    const m = await load();
    assert.equal(m.preflightFts(), true);
    const f = m.createSyntheticFixture(100);
    t.after(() => f.close());
    m.publishGeneration(f);
    for (const item of m.FIXTURE.queries) {
      const indexed = m.indexedSearch({ db: f.db, query: item.query });
      const scanned = m.scanSearch({ db: f.db, query: item.query });
      assert.deepEqual(indexed.refs, scanned.refs, item.name);
      assert.equal(indexed.incomplete, false);
      assert.equal(scanned.incomplete, false);
      assert.ok(indexed.refs.length <= 5);
      assert.ok(scanned.scanned <= 20_000);
    }
    assert.equal(m.indexedSearch({ db: f.db, query: 'saffron ledger' }).refs[0].memoryId,
      f.labels.get('receipt'));
    assert.deepEqual(m.indexedSearch({ db: f.db, query: 'vermilion compass' }).refs, []);
    assert.deepEqual(m.indexedSearch({ db: f.db, query: 'cafe' }).refs, []);
    assert.deepEqual(m.indexedSearch({ db: f.db, query: '銅羅' }).refs, []);
    assert.doesNotThrow(() => m.indexedSearch({ db: f.db, query: 'NEAR/3 OR *' }));
    assert.throws(() => m.indexedSearch({ db: f.db, query: 'cobalt', expected: ['exact'] }),
      /invalid_query_input/u);
    assert.equal(m.materialize({ fixture: f,
      selection: m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' }) }).materialized, 1);
  });

test('IC1/IC2 public lifecycle updates sidecar, preserves exact current count and cold reopen',
  { skip: !available }, async (t) => {
    const m = await load();
    const f = m.createSyntheticFixture(100);
    t.after(() => f.close());
    m.publishGeneration(f);
    const times = m.applySyntheticLifecycle(f);
    assert.ok(Object.values(times).every(value => Number.isFinite(value) && value >= 0));
    assert.equal(m.storageCounts(f).currentMemories, 100);
    for (const [query, expected] of [['updated bronze', 'corrected'], ['saffron ledger', 'receipt']]) {
      assert.equal(m.indexedSearch({ db: f.db, query }).refs[0].memoryId, f.labels.get(expected));
    }
    for (const query of ['outdated copper', 'erased garnet', 'vermilion compass']) {
      assert.deepEqual(m.indexedSearch({ db: f.db, query }).refs, []);
    }
    const historical = m.indexedSearch({ db: f.db, query: 'former indigo' }).refs;
    assert.ok(historical.every(ref => ref.memoryId !== f.labels.get('historical')));
    const currentSelection = m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' });
    for (const ref of [
      { memoryId: f.labels.get('forgotten'), revision: 2 },
      { memoryId: f.labels.get('historical'), revision: 1 },
      { memoryId: f.labels.get('corrected'), revision: 1 },
    ]) assert.throws(() => m.materialize({ fixture: f,
      selection: { ...currentSelection, refs: [ref] } }), /stale_candidate/u);
    const appId = f.db.prepare('PRAGMA application_id').get().application_id;
    const version = f.db.prepare('PRAGMA user_version').get().user_version;
    f.reopen(); // Both handles close, then the persisted file opens cold.
    assert.equal(f.db.prepare('PRAGMA application_id').get().application_id, appId);
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, version);
    assert.equal(f.db.prepare('PRAGMA trusted_schema').get().trusted_schema, 0);
    assert.equal(ok(f.core.get({ namespace: m.NAMESPACE, memoryId: f.labels.get('exact') })).memory.state,
      'active');
    assert.equal(m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' }).refs.length, 1);
    const coldWrite = ok(f.core.admit({ namespace: m.NAMESPACE,
      memory: { content: 'Cold reopen jade caliper is current.', kind: 'fact' },
      receipts: [m.fixtureReceipt('Cold reopen jade caliper is current.', 'cold-reopen-source')] }));
    assert.equal(m.indexedSearch({ db: f.db, query: 'jade caliper' }).refs[0].memoryId,
      coldWrite.memory.id);
  });

test('IC1/IC3 missing generation, projection exclusion, stale derivative and query-to-get race fail closed',
  { skip: !available }, async (t) => {
    const m = await load();
    const f = m.createSyntheticFixture(100);
    t.after(() => f.close());
    let page = ok(f.core.rebuildIndex({ namespace: m.NAMESPACE,
      expectedIndexRevision: 1, limit: 1 }));
    assert.equal(page.state, 'staged');
    assert.throws(() => m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' }),
      /active_generation_unavailable/u);
    let pages = 1;
    while (page.nextCursor) {
      page = ok(f.core.rebuildIndex({ namespace: m.NAMESPACE,
        expectedIndexRevision: 1, limit: 1, cursor: page.nextCursor }));
      if (++pages > 200) throw new Error('staged_rebuild_did_not_finish');
    }
    assert.equal(page.state, 'published');
    const generation = f.db.prepare(`SELECT active_generation AS id FROM namespace_index_state
      WHERE owner_id=? AND scope=? AND project_id=?`).get(m.NAMESPACE.ownerId,
      m.NAMESPACE.scope, m.NAMESPACE.projectId).id;
    const exactId = f.labels.get('exact');
    const original = m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' });
    f.db.prepare('DELETE FROM index_memories WHERE generation=? AND id=?').run(generation, exactId);
    assert.deepEqual(m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' }).refs, []);
    const added = ok(f.core.admit({ namespace: m.NAMESPACE,
      memory: { content: 'Fresh onyx compass is present.', kind: 'fact' },
      receipts: [m.fixtureReceipt('Fresh onyx compass is present.', 'new-generation-source')] }));
    assert.equal(m.indexedSearch({ db: f.db, query: 'onyx compass' }).refs[0].memoryId,
      added.memory.id);
    const rebuilt = m.publishGeneration(f);
    assert.notEqual(rebuilt.generation, generation);
    assert.equal(m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' }).refs[0].memoryId, exactId);
    f.db.prepare(`UPDATE ci_documents SET memory_revision=999 WHERE memory_id=?`).run(exactId);
    assert.deepEqual(m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' }).refs, []);
    const corrected = ok(f.core.correct({ namespace: m.NAMESPACE, memoryId: exactId,
      expectedRevision: 1, content: 'Current cobalt astrolabe was corrected.', kind: 'fact',
      receipt: m.fixtureReceipt('Current cobalt astrolabe was corrected.', 'race-source') }));
    assert.equal(corrected.memory.revision, 2);
    assert.throws(() => m.materialize({ fixture: f, selection: original }), /index_epoch_changed/u);
  });

test('IC2 trigger failure rolls back both public core mutation and FTS documents',
  { skip: !available }, async (t) => {
    const m = await load();
    const f = m.createSyntheticFixture(100);
    t.after(() => f.close());
    m.publishGeneration(f);
    const id = f.labels.get('corrected');
    const before = ok(f.core.get({ namespace: m.NAMESPACE, memoryId: id })).memory;
    const count = f.db.prepare('SELECT count(*) AS n FROM ci_documents WHERE memory_id=?').get(id).n;
    f.db.exec(`CREATE TRIGGER ci_fault BEFORE INSERT ON ci_documents BEGIN
      SELECT RAISE(ABORT,'synthetic_sidecar_fault'); END;`);
    const failed = f.core.correct({ namespace: m.NAMESPACE, memoryId: id,
      expectedRevision: before.revision, content: m.FIXTURE.correctedReplacement,
      kind: 'fact', receipt: m.fixtureReceipt(m.FIXTURE.correctedReplacement, 'fault-source') });
    assert.equal(failed.ok, false);
    f.db.exec('DROP TRIGGER ci_fault');
    const after = ok(f.core.get({ namespace: m.NAMESPACE, memoryId: id })).memory;
    assert.equal(after.revision, before.revision);
    assert.equal(after.content, before.content);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM ci_documents WHERE memory_id=?').get(id).n, count);
    assert.equal(m.indexedSearch({ db: f.db, query: 'outdated copper' }).refs[0].memoryId, id);
  });

test('IC2 receipt update and public rebuild refresh only current authorized evidence',
  { skip: !available }, async (t) => {
    const m = await load();
    const f = m.createSyntheticFixture(100);
    t.after(() => f.close());
    m.publishGeneration(f);
    const id = f.labels.get('receipt');
    const source = f.db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY id LIMIT 1').get(id);
    const excerpt = 'Crimson ledger mutation is current.';
    const receipt = { client: source.client, sessionId: source.session_id,
      eventId: source.event_id, role: source.role, excerpt };
    const key = createHash('sha256').update(JSON.stringify(receipt)).digest('hex');
    f.db.prepare('UPDATE receipts SET excerpt=?,receipt_key=? WHERE id=?').run(excerpt, key, source.id);
    assert.equal(m.indexedSearch({ db: f.db, query: 'crimson ledger' }).refs[0].memoryId, id);
    assert.deepEqual(m.indexedSearch({ db: f.db, query: 'saffron' }).refs, []);
    const oldGeneration = f.db.prepare(`SELECT active_generation AS id FROM namespace_index_state
      WHERE owner_id=? AND scope=? AND project_id=?`).get(m.NAMESPACE.ownerId,
      m.NAMESPACE.scope, m.NAMESPACE.projectId).id;
    const { generation } = m.publishGeneration(f);
    assert.notEqual(generation, oldGeneration);
    assert.equal(m.indexedSearch({ db: f.db, query: 'crimson ledger' }).refs[0].memoryId, id);
  });

test('IC1/IC4 same-owner foreign volume cannot change authorized rank, cap or materialization',
  { skip: !available }, async (t) => {
    const m = await load();
    const f = m.createSyntheticFixture(10000);
    t.after(() => f.close());
    m.publishGeneration(f);
    const before = m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' });
    const tailId = f.labels.get('tail');
    const prior = f.db.prepare(`SELECT count(*) AS n FROM memories WHERE owner_id=?
      AND scope=? AND project_id=? AND id<? AND deleted=0 AND currentness='current'`)
      .get(m.NAMESPACE.ownerId, m.NAMESPACE.scope, m.NAMESPACE.projectId, tailId).n;
    assert.ok(prior > 1024);
    assert.equal(m.indexedSearch({ db: f.db, query: 'zirconium sextant' }).refs[0].memoryId, tailId);
    assert.equal(m.storageCounts(f).foreignCurrentMemories, 10000);
    assert.equal(m.indexedSearch({ db: f.db, query: 'private lilac charter' }).matchingDocuments, 0);
    const foreign = ok(f.core.admit({ namespace: m.FOREIGN,
      memory: { content: 'Foreign cobalt astrolabe is private.', kind: 'fact' },
      receipts: [m.fixtureReceipt('Foreign cobalt astrolabe is private.', 'foreign-source')] }));
    ok(f.core.admit({ namespace: { ...m.NAMESPACE, ownerId: 'ci-other-owner' },
      memory: { content: 'Other-owner cobalt astrolabe is private.', kind: 'fact' },
      receipts: [m.fixtureReceipt('Other-owner cobalt astrolabe is private.', 'other-owner-source')] }));
    const after = m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' });
    assert.deepEqual(after.refs, before.refs);
    assert.equal(after.matchingDocuments, before.matchingDocuments);
    assert.throws(() => m.materialize({ fixture: f,
      selection: { ...after, refs: [{ memoryId: foreign.memory.id, revision: foreign.memory.revision }] } }),
    /stale_candidate/u);
  });

test('IC3 materialization closes at its receipt-page cap even for a legitimate high-fanout memory',
  { skip: !available }, async (t) => {
    const m = await load();
    const f = m.createSyntheticFixture(100);
    t.after(() => f.close());
    m.publishGeneration(f);
    const id = f.labels.get('exact');
    const insert = f.db.prepare(`INSERT INTO receipts
      (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
      VALUES(?,?,?,'ci-synthetic','ci-session',?,'user',?,'2025-01-01')`);
    f.db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 1; index <= 105; index += 1) {
        const rid = `40000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        const excerpt = `Additional legitimate receipt ${index}.`;
        const source = { client: 'ci-synthetic', sessionId: 'ci-session', eventId: rid,
          role: 'user', excerpt };
        const key = createHash('sha256').update(JSON.stringify(source)).digest('hex');
        insert.run(rid, id, key, rid, excerpt);
      }
      f.db.exec('COMMIT');
    } catch (error) { f.db.exec('ROLLBACK'); throw error; }
    const selection = m.indexedSearch({ db: f.db, query: 'cobalt astrolabe' });
    assert.equal(selection.refs[0].memoryId, id);
    assert.ok(ok(f.core.get({ namespace: m.NAMESPACE, memoryId: id, receiptLimit: 4 })).nextReceiptCursor);
    assert.throws(() => m.materialize({ fixture: f, selection }), /receipt_page_cap/u);
  });

test('IC3 actual 20k scan and matching-document caps report incomplete, never a partial top five',
  { skip: !available }, async (t) => {
    const m = await load();
    const { fingerprint } = await import('../../../core/validation.mjs');
    const f = m.createSyntheticFixture(10000);
    t.after(() => f.close());
    m.publishGeneration(f);
    const insert = f.db.prepare(`INSERT INTO memories
      (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,
      deleted,created_at,updated_at,filing_status,currentness)
      VALUES(?,?,?,?,? ,?,'fact','explicit',1,1,0,'2025-01-01','2025-01-01','unfiled','current')`);
    f.db.exec('BEGIN IMMEDIATE');
    try {
      for (let index = 0; index < 10001; index += 1) {
        const id = `30000000-0000-4000-8000-${String(index).padStart(12, '0')}`;
        const content = `Neutral overload marker ${index}.`;
        insert.run(id, m.NAMESPACE.ownerId, m.NAMESPACE.scope, m.NAMESPACE.projectId,
          fingerprint(content), content);
      }
      f.db.exec('COMMIT');
    } catch (error) { f.db.exec('ROLLBACK'); throw error; }
    const indexed = m.indexedSearch({ db: f.db, query: 'neutral' });
    const scanned = m.scanSearch({ db: f.db, query: 'neutral' });
    assert.equal(indexed.incomplete, true);
    assert.equal(indexed.matchingDocuments, 20001); // Lower bound, not exact total.
    assert.deepEqual(indexed.refs, []);
    assert.equal(scanned.incomplete, true);
    assert.equal(scanned.scanned, 20000);
    assert.deepEqual(scanned.refs, []);
    assert.throws(() => m.materialize({ fixture: f, selection: indexed }), /incomplete_selection/u);
  });

test('IC5 finite privacy-safe report for small fixed size', { skip: !available }, async () => {
  const m = await load();
  const result = m.runOfflineExperiment(100);
  assert.equal(result.size, 100);
  assert.equal(result.counts.currentMemories, 100);
  assert.equal(result.queries.length, m.FIXTURE.queries.length);
  assert.equal(result.queries.find(item => item.name === 'historical').unexpected, 1);
  assert.equal(result.sqlitePostingWork, 'unknown');
  const serialized = JSON.stringify(result);
  for (const forbidden of ['Cobalt astrolabe', 'private lilac charter',
    '00000000-0000-4000', 'synthetic.sqlite', 'saffron ledger token']) {
    assert.equal(serialized.includes(forbidden), false);
  }
});

test('IC5 CLI retains completed size summary on later timeout without raw child error',
  { skip: !available }, async () => {
    const { main } = await import('../incremental-candidate-index-cli.mjs');
    const out = []; const err = [];
    let calls = 0;
    const runner = () => {
      calls += 1;
      return calls === 1 ? { status: 0, stdout: '{"size":100,"queryCount":13}' }
        : { status: null, error: { code: 'ETIMEDOUT', message: 'private child exception' } };
    };
    assert.equal(await main(['--demo'], { runner,
      stdout: { write: value => out.push(value) }, stderr: { write: value => err.push(value) } }), 1);
    assert.deepEqual(JSON.parse(out.join('')), { schemaVersion: 'incremental-candidate-index-v1',
      status: 'timeout', failedSize: 1000, completedReports: [{ size: 100, queryCount: 13 }] });
    assert.equal(err.join(''), 'size_timeout\n');
    assert.equal(out.join('').includes('private child exception'), false);
  });

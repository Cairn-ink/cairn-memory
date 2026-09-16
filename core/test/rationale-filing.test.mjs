import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const namespace = { ownerId: 'rationale-filing', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const input = (eventId, content) => ({ namespace, client: 'synthetic', sessionId: 'session', eventId,
  messages: [{ id: eventId, role: 'user', content }] });

function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-rationale-filing-')), 'memory.sqlite');
  const model = rationaleModel();
  const core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2',
    captureRationale: 'source-bound-v1' });
  const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  const detail = memoryId => ok(core.get({ namespace, memoryId }));
  const ref = memoryId => { const memory = detail(memoryId).memory; return { memoryId, revision: memory.revision }; };
  const place = items => ok(core.applyPlacement({ namespace, proposal: { items },
    expectedMemoryRevisions: items.map(item => ref(item.memoryId)),
    expectedIndexRevision: ok(core.map({ namespace, purpose: 'classification' })).indexRevision }));
  return { core, model, db, path, detail, ref, place };
}

async function capturedPair(f) {
  ok(await f.core.capture(input('decision', 'I chose A because it supports offline work.')));
  ok(await f.core.capture(input('challenge', 'I checked: A cannot work offline.')));
  const memories = ok(f.core.list({ namespace })).memories.map(memory => f.detail(memory.id).memory);
  const decision = memories.find(memory => memory.content.startsWith('I chose A'));
  const challenge = memories.find(memory => memory.content.startsWith('I checked'));
  assert.ok(decision && challenge);
  return { decision, challenge };
}

test('RF1 captured rationale survives filing-only revision, old ref fails, and cold inspection agrees', async t => {
  const f = fixture(t); const { decision } = await capturedPair(f);
  const beforeSource = f.detail(decision.id);
  const before = ok(f.core.getRationale({ namespace, ...f.ref(decision.id) }));
  assert.equal(before.status, 'reconfirmation-suggested');
  assert.equal(before.edges.length, 2);
  const placed = f.place([{ memoryId: decision.id, parentIds: [],
    newL1: { title: 'Offline decisions', parentL2Ids: [] } }]);
  const newRef = f.ref(decision.id);
  assert.equal(newRef.revision, decision.revision + 1);
  assert.ok(placed.indexRevision > before.indexRevision);
  assert.equal(f.core.getRationale({ namespace, memoryId: decision.id, revision: decision.revision }).error.code,
    'revision_conflict');
  const afterSource = f.detail(decision.id);
  assert.equal(afterSource.memory.content, beforeSource.memory.content);
  assert.deepEqual(afterSource.receipts, beforeSource.receipts);
  const after = ok(f.core.getRationale({ namespace, ...newRef }));
  assert.equal(after.status, 'reconfirmation-suggested');
  assert.deepEqual(after.edges, before.edges);
  assert.equal(after.sources.length, before.sources.length);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 2);
  f.core.close();
  const cold = openMemoryCore({ path: f.path }); t.after(() => cold.close());
  assert.deepEqual(ok(cold.getRationale({ namespace, ...newRef })), after);
});

test('RF2 two revised endpoints, self-edge and filing transitions retain one copy of each edge', async t => {
  const f = fixture(t); const { decision, challenge } = await capturedPair(f);
  const baseline = ok(f.core.getRationale({ namespace, ...f.ref(decision.id) }));
  const first = f.place([{ memoryId: decision.id, parentIds: [],
    newL1: { title: 'Decisions', parentL2Ids: [] } }, { memoryId: challenge.id, parentIds: [],
    newL1: { title: 'Evidence', parentL2Ids: [] } }]);
  assert.deepEqual(ok(f.core.getRationale({ namespace, ...f.ref(decision.id) })).edges, baseline.edges);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 2);
  const second = f.place([{ memoryId: decision.id, parentIds: [] }]);
  assert.equal(f.ref(decision.id).revision, decision.revision + 2);
  assert.ok(second.indexRevision > first.indexRevision);
  assert.deepEqual(ok(f.core.getRationale({ namespace, ...f.ref(decision.id) })).edges, baseline.edges);
  const third = f.place([{ memoryId: decision.id, parentIds: [],
    newL1: { title: 'Refiled decisions', parentL2Ids: [] } }]);
  assert.equal(f.ref(decision.id).revision, decision.revision + 3);
  assert.ok(third.indexRevision > second.indexRevision);
  const fourth = f.place([{ memoryId: decision.id, parentIds: [],
    newL1: { title: 'Other decisions', parentL2Ids: [] } }]);
  assert.equal(f.ref(decision.id).revision, decision.revision + 3);
  assert.ok(fourth.indexRevision > third.indexRevision);
  assert.deepEqual(ok(f.core.getRationale({ namespace, ...f.ref(decision.id) })).edges, baseline.edges);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 2);
});

for (const mutation of ['correct', 'receipt-update', 'receipt-add', 'forget', 'retire',
  'namespace', 'arbitrary-revision']) {
  test(`RF3 ${mutation} still invalidates proposals after a filing-only preservation`, async t => {
    const f = fixture(t); const { decision } = await capturedPair(f);
    f.place([{ memoryId: decision.id, parentIds: [],
      newL1: { title: 'Offline decisions', parentL2Ids: [] } }]);
    const current = f.ref(decision.id);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 2);
    if (mutation === 'correct') ok(f.core.correct({ namespace, memoryId: decision.id,
      expectedRevision: current.revision, content: 'I chose C instead.', kind: 'decision',
      receipt: { client: 'synthetic', sessionId: 'session', eventId: 'corrected', role: 'user', excerpt: 'I chose C instead.' } }));
    if (mutation === 'receipt-update') f.db.prepare('UPDATE receipts SET excerpt = ? WHERE memory_id = ?')
      .run('Changed evidence', decision.id);
    if (mutation === 'receipt-add') f.db.prepare(`INSERT INTO receipts
      (id, memory_id, receipt_key, client, session_id, event_id, role, excerpt, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('new-receipt', decision.id, 'new-key',
      'synthetic', 'session', 'new-event', 'user', 'Additional evidence', new Date().toISOString());
    if (mutation === 'forget') ok(f.core.forget({ namespace, memoryId: decision.id,
      expectedRevision: current.revision }));
    if (mutation === 'retire') f.db.prepare(`UPDATE memories SET currentness = 'historical',
      revision = revision + 1 WHERE id = ?`).run(decision.id);
    if (mutation === 'namespace') f.db.prepare('UPDATE memories SET owner_id = ? WHERE id = ?')
      .run('different-owner', decision.id);
    if (mutation === 'arbitrary-revision') f.db.prepare('UPDATE memories SET revision = revision + 1 WHERE id = ?')
      .run(decision.id);
    assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 0);
  });
}

for (const mutation of ['receipt-delete', 'supersede']) test(`RF3 ${mutation} still invalidates a preserved link`, async t => {
  const f = fixture(t);
  const admit = (eventId, content) => ok(f.core.admit({ namespace,
    memory: { content, kind: 'context' }, receipts: [{ client: 'synthetic', sessionId: 'session', eventId,
      role: 'user', excerpt: content }] })).memory;
  const decision = admit('manual-decision', 'I chose A because it supports offline work.');
  const challenge = admit('manual-challenge', 'I checked: A cannot work offline.');
  ok(await f.core.reviewRationale({ namespace, refs: [f.ref(decision.id), f.ref(challenge.id)] }));
  f.place([{ memoryId: decision.id, parentIds: [], newL1: { title: 'Manual decision', parentL2Ids: [] } }]);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 2);
  if (mutation === 'receipt-delete') f.db.prepare('DELETE FROM receipts WHERE memory_id = ?').run(decision.id);
  else ok(f.core.supersede({ namespace, memoryId: decision.id, expectedRevision: f.ref(decision.id).revision,
    replacement: { content: 'I chose C instead.', kind: 'decision' },
    receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'replacement', role: 'user',
      excerpt: 'I chose C instead.' }] }));
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 0);
});

test('RF2 filing during an in-flight rationale review rejects its stale snapshot', async t => {
  const f = fixture(t); const { decision, challenge } = await capturedPair(f);
  let called = 0;
  f.model.relate = () => { called++;
    f.place([{ memoryId: decision.id, parentIds: [], newL1: { title: 'Review race', parentL2Ids: [] } }]);
    return { edges: [] }; };
  const result = await f.core.reviewRationale({ namespace, refs: [f.ref(decision.id), f.ref(challenge.id)] });
  assert.equal(called, 1);
  assert.equal(result.error.code, 'revision_conflict');
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 2);
});

test('RF2 filing during recall rejects its stale read instead of returning old refs', async t => {
  const f = fixture(t); const { decision } = await capturedPair(f);
  let called = 0;
  f.model.rank = () => { called++;
    f.place([{ memoryId: decision.id, parentIds: [], newL1: { title: 'Recall race', parentL2Ids: [] } }]);
    return { refs: [] }; };
  const result = await f.core.recall({ readSet: [namespace], query: 'Why did I choose A?',
    contextMode: 'rationale-evidence' });
  assert.equal(called, 1);
  assert.equal(result.ok, false);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 2);
});

test('RF4 failed edge restoration rolls back placement, revisions and epoch', async t => {
  const f = fixture(t); const { decision } = await capturedPair(f);
  const before = {
    memories: f.db.prepare('SELECT * FROM memories ORDER BY id').all(),
    edges: f.db.prepare('SELECT * FROM rationale_edges ORDER BY from_id, to_id, relation').all(),
    mocs: f.db.prepare('SELECT * FROM mocs ORDER BY id').all(),
    epochs: f.db.prepare('SELECT * FROM namespace_epochs ORDER BY owner_id').all(),
  };
  f.db.exec(`CREATE TRIGGER rationale_restore_fault BEFORE INSERT ON rationale_edges
    BEGIN SELECT RAISE(ABORT, 'synthetic restore failure'); END`);
  const result = f.core.applyPlacement({ namespace,
    proposal: { items: [{ memoryId: decision.id, parentIds: [],
      newL1: { title: 'Should roll back', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [f.ref(decision.id)],
    expectedIndexRevision: ok(f.core.map({ namespace, purpose: 'classification' })).indexRevision });
  assert.equal(result.error.code, 'storage_error');
  assert.deepEqual({
    memories: f.db.prepare('SELECT * FROM memories ORDER BY id').all(),
    edges: f.db.prepare('SELECT * FROM rationale_edges ORDER BY from_id, to_id, relation').all(),
    mocs: f.db.prepare('SELECT * FROM mocs ORDER BY id').all(),
    epochs: f.db.prepare('SELECT * FROM namespace_epochs ORDER BY owner_id').all(),
  }, before);
});

test('RF4 a receipt metadata change during placement cannot be rehydrated', async t => {
  const f = fixture(t); const { decision } = await capturedPair(f);
  const before = { memory: f.detail(decision.id), edges: f.db.prepare('SELECT * FROM rationale_edges').all(),
    epoch: ok(f.core.map({ namespace })).indexRevision };
  f.db.exec(`CREATE TRIGGER filing_receipt_fault AFTER UPDATE OF filing_status ON memories
    WHEN NEW.filing_status != OLD.filing_status
    BEGIN UPDATE receipts SET event_id = 'changed-during-filing' WHERE memory_id = NEW.id; END`);
  const result = f.core.applyPlacement({ namespace,
    proposal: { items: [{ memoryId: decision.id, parentIds: [],
      newL1: { title: 'Unsafe filing', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [f.ref(decision.id)],
    expectedIndexRevision: before.epoch });
  assert.equal(result.error.code, 'revision_conflict');
  assert.deepEqual(f.detail(decision.id), before.memory);
  assert.deepEqual(f.db.prepare('SELECT * FROM rationale_edges').all(), before.edges);
  assert.equal(ok(f.core.map({ namespace })).indexRevision, before.epoch);
});

for (const corruption of ['digest', 'revision']) test(`RF4 ${corruption} corruption cannot be rebound by filing`, async t => {
  const f = fixture(t); const { decision } = await capturedPair(f);
  f.db.prepare(corruption === 'digest'
    ? "UPDATE rationale_edges SET from_digest = 'wrong' WHERE relation = 'supports-decision'"
    : 'UPDATE rationale_edges SET from_revision = from_revision + 1 WHERE relation = ?')
    .run(...(corruption === 'digest' ? [] : ['supports-decision']));
  const before = f.db.prepare('SELECT * FROM rationale_edges ORDER BY relation').all();
  const oldRef = f.ref(decision.id);
  const oldEpoch = ok(f.core.map({ namespace })).indexRevision;
  const result = f.core.applyPlacement({ namespace,
    proposal: { items: [{ memoryId: decision.id, parentIds: [],
      newL1: { title: 'Corrupt edge', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [oldRef], expectedIndexRevision: oldEpoch });
  assert.equal(result.error.code, 'revision_conflict');
  assert.deepEqual(f.ref(decision.id), oldRef);
  assert.equal(ok(f.core.map({ namespace })).indexRevision, oldEpoch);
  assert.deepEqual(f.db.prepare('SELECT * FROM rationale_edges ORDER BY relation').all(), before);
});

test('RF4 a previously invalidated edge is not resurrected by later filing', async t => {
  const f = fixture(t); const { decision } = await capturedPair(f);
  f.db.prepare('UPDATE receipts SET excerpt = ? WHERE memory_id = ?').run('Changed evidence', decision.id);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 0);
  f.place([{ memoryId: decision.id, parentIds: [], newL1: { title: 'After invalidation', parentL2Ids: [] } }]);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM rationale_edges').get().n, 0);
});

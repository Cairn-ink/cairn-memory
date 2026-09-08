import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';

const namespace = { ownerId: 'conflict-test', scope: 'personal', projectId: null };
const foreign = { ...namespace, ownerId: 'foreign' };
const receipt = (eventId) => ({ client: 'synthetic', sessionId: 'session', eventId,
  role: 'user', excerpt: 'Synthetic evidence.' });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); assert.equal(r.error.code, code); };
const hint = (m) => ({ memoryId: m.id, expectedRevision: m.revision, relation: 'contradicts' });
const projection = (m, source = 'explicit-hint') => ({ memoryId: m.id, revision: m.revision,
  relation: 'contradicts', source });
const detail = (c, m) => ok(c.get({ namespace, memoryId: m.id }));
const epoch = (c) => ok(c.map({ namespace })).indexRevision;
const input = (content, eventId = content) => ({ namespace, memory: { content, kind: 'fact' }, receipts: [receipt(eventId)] });
const admit = (c, content, hints = [], extra = {}) => ok(c.admit({ ...input(content), conflictHints: hints, ...extra })).memory;
const inferred = (content, conflictHints = [], eventId = content) => ({ content, kind: 'preference', confidence: 0.4,
  receipts: [receipt(eventId)], conflictHints });
const key = (eventId) => ({ namespace, client: 'synthetic', eventId, payloadDigest: 'a'.repeat(64) });
const claim = (c, eventId) => ok(c.claimAdmission({ ...key(eventId), leaseMs: 125000 }));
const finish = (c, eventId, token, items) => c.finishAdmission({ ...key(eventId), token, items });
function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-conflicts-')), 'memory.sqlite');
  const core = openMemoryCore({ path, model: { countTokens: () => 1 } });
  const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  return { core, db, path };
}
// Discover only the relation storage seam; behavior is exercised exclusively through public APIs.
const relationTable = (db) => {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  return tables.find(({ name }) => db.prepare(`PRAGMA table_info("${name}")`).all()
    .some(({ name: column }) => column === 'left_memory_id'))?.name ?? 'memory_conflicts';
};
const snapshot = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
function place(c, m, parentIds = [], title) {
  return ok(c.applyPlacement({ namespace, proposal: { items: [{ memoryId: m.id, parentIds,
    ...(title ? { newL1: { title, parentL2Ids: [] } } : {}) }] },
  expectedMemoryRevisions: [{ memoryId: m.id, revision: detail(c, m).memory.revision }],
  expectedIndexRevision: epoch(c) }));
}

test('K01 symmetric source-attributed hints, canonical replay, link epochs and reopen', (t) => {
  const { core, db, path } = fixture(t);
  const a = admit(core, 'Synthetic A');
  const b = admit(core, 'Synthetic B');
  const beforeA = detail(core, a);
  const cursor = ok(core.list({ namespace, limit: 1 })).nextCursor;
  const beforeEpoch = epoch(core);
  assert.deepEqual(admit(core, 'Synthetic A', [hint(b)]), a);
  assert.ok(epoch(core) > beforeEpoch);
  assert.equal(core.list({ namespace, limit: 1, cursor }).ok, false);
  assert.deepEqual(detail(core, a), { ...beforeA, conflicts: [projection(b)] });
  assert.deepEqual(detail(core, b).conflicts, [projection(a)]);
  const state = snapshot(db);
  admit(core, 'Synthetic A', [hint(b)]);
  admit(core, 'Synthetic B', [hint(a)]);
  assert.deepEqual(snapshot(db), state);
  const reopened = openMemoryCore({ path });
  t.after(() => reopened.close());
  assert.deepEqual(detail(reopened, a).conflicts, [projection(b)]);
});

test('K02 both call-assigned sources coexist without inferred metadata overwrite', (t) => {
  const { core } = fixture(t);
  const b = admit(core, 'Target');
  const a = admit(core, 'Explicit source', [hint(b)]);
  const before = detail(core, a).memory;
  ok(finish(core, 'inferred', claim(core, 'inferred').token, [inferred('Explicit source', [hint(b)])]));
  assert.deepEqual(detail(core, a).memory, before);
  assert.deepEqual(detail(core, a).conflicts, [projection(b), projection(b, 'inferred-hint')]);
  assert.deepEqual(detail(core, b).conflicts, [projection(a), projection(a, 'inferred-hint')]);
});

test('K03 closed dense bounded hint shapes validate atomically in direct and batch admission', (t) => {
  const { core, db } = fixture(t);
  const target = admit(core, 'Target');
  const h = hint(target);
  const sparse = Array(2); sparse[0] = h;
  const token = claim(core, 'malformed').token;
  const before = snapshot(db);
  for (const hints of [null, {}, sparse, [h, h], Array(6).fill(h), [null],
    [{ ...h, source: 'inferred-hint' }], [{ ...h, relation: 'supports' }],
    [{ ...h, expectedRevision: 0 }], [{ ...h, expectedRevision: 1.5 }],
    [{ ...h, expectedRevision: Number.MAX_SAFE_INTEGER + 1 }], [{ memoryId: target.id, relation: 'contradicts' }],
    [{ ...h, memoryId: '' }]]) {
    error(core.admit({ ...input('Novel'), conflictHints: hints }), 'invalid_input');
    error(finish(core, 'malformed', token, [inferred('Earlier valid'), inferred('Novel', hints)]), 'invalid_input');
    assert.deepEqual(snapshot(db), before);
  }
});

test('K03 missing, foreign, stale and exact-dedup self targets leave no partial writes', (t) => {
  const { core, db } = fixture(t);
  const target = admit(core, 'Target');
  const other = admit(core, 'Foreign', [], { namespace: foreign });
  for (const [content, h, code] of [
    ['Novel', { ...hint(target), memoryId: 'missing' }, 'memory_not_found'],
    ['Novel', hint(other), 'memory_not_found'],
    ['Novel', { ...hint(target), expectedRevision: target.revision + 1 }, 'revision_conflict'],
    ['Target', hint(target), 'invalid_ref'],
  ]) {
    const event = `failure-${code}-${content}-${h.memoryId}`;
    const token = claim(core, event).token;
    const before = snapshot(db);
    error(core.admit({ ...input(content, 'new receipt'), conflictHints: [h] }), code);
    assert.deepEqual(snapshot(db), before);
    error(finish(core, event, token, [inferred('Earlier valid'), inferred(content, [h], 'new receipt')]), code);
    assert.deepEqual(snapshot(db), before);
  }
});

test('K04 batch binds final deduplicated source revision and rejects changed targets', (t) => {
  const { core, db } = fixture(t);
  const target = admit(core, 'Target');
  const result = ok(finish(core, 'batch', claim(core, 'batch').token,
    [inferred('Source', [hint(target)], 'first'), inferred('Source', [hint(target)], 'second')]));
  assert.equal(result.memories.length, 1);
  const source = detail(core, result.memories[0]);
  assert.equal(source.receipts.length, 2);
  assert.equal(result.memories[0].revision, source.memory.revision);
  assert.deepEqual(source.conflicts, [projection(target, 'inferred-hint')]);
  assert.deepEqual(detail(core, target).conflicts, [projection(source.memory, 'inferred-hint')]);
  for (const reverse of [false, true]) {
    const event = `changed-${reverse}`;
    const token = claim(core, event).token;
    const before = snapshot(db);
    const items = [inferred('Another source', [hint(target)]), inferred('Target', [], 'new target evidence')];
    error(finish(core, event, token, reverse ? items.reverse() : items), 'revision_conflict');
    assert.deepEqual(snapshot(db), before);
  }
});

test('K05 suppression skips semantic checks, validates shape, and replay/lease fencing persist', (t) => {
  const { core, db } = fixture(t);
  const a = admit(core, 'Suppressed');
  ok(core.forget({ namespace, memoryId: a.id, expectedRevision: a.revision }));
  const token = claim(core, 'suppression').token;
  const badTarget = { memoryId: 'missing', expectedRevision: 1, relation: 'contradicts' };
  const before = snapshot(db);
  error(finish(core, 'suppression', token, [inferred('Suppressed', [{ ...badTarget, extra: 1 }])]), 'invalid_input');
  assert.deepEqual(snapshot(db), before);
  error(core.admit({ ...input('Suppressed'), conflictHints: [badTarget] }), 'memory_suppressed');
  const done = ok(finish(core, 'suppression', token, [inferred('Suppressed', [badTarget])]));
  assert.equal(done.suppressedCount, 1);
  assert.deepEqual(done.memories, []);
  assert.deepEqual(claim(core, 'suppression'), { duplicate: true, memoryIds: [], suppressedCount: 1 });
  error(finish(core, 'suppression', token, [inferred('Suppressed', [badTarget])]), 'stale_admission');
  const pending = claim(core, 'lease').token;
  db.exec("UPDATE admission_claims SET lease_expires_at=0 WHERE state='pending'");
  const expired = snapshot(db);
  error(finish(core, 'lease', pending, [inferred('Fresh', [badTarget])]), 'stale_admission');
  assert.deepEqual(snapshot(db), expired);
  const fresh = claim(core, 'lease').token;
  assert.notEqual(fresh, pending);
  error(finish(core, 'lease', pending, []), 'stale_admission');
});

for (const endpoint of ['source', 'target']) for (const mutation of ['correct', 'forget', 'receipt', 'metadata', 'filing', 'legacy-receipt', 'legacy-correct', 'legacy-forget']) {
  test(`K06 ${mutation} invalidates ${endpoint} endpoint relations`, (t) => {
    const { core, db, path } = fixture(t);
    const b = admit(core, 'Target');
    const a = admit(core, 'Source', [hint(b)]);
    const m = detail(core, endpoint === 'source' ? a : b).memory;
    const peer = endpoint === 'source' ? b : a;
    if (mutation === 'correct') ok(core.correct({ namespace, memoryId: m.id, expectedRevision: m.revision,
      content: 'Corrected', kind: 'fact', receipt: receipt('correct') }));
    if (mutation === 'forget') ok(core.forget({ namespace, memoryId: m.id, expectedRevision: m.revision }));
    if (mutation === 'receipt') admit(core, m.content, [], { receipts: [receipt('new evidence')] });
    if (mutation === 'metadata') admit(core, m.content, [], { memory: { content: m.content, kind: 'instruction' } });
    if (mutation === 'filing') place(core, m, [], 'Synthetic topic');
    if (mutation.startsWith('legacy-')) {
      const store = openMemoryStore({ path }); t.after(() => store.close());
      const scope = store.scope({ ownerId: namespace.ownerId });
      if (mutation === 'legacy-receipt') scope.remember({ content: m.content, kind: 'fact', receipt: receipt('legacy') });
      if (mutation === 'legacy-correct') scope.correct(m.id, { content: 'Legacy correction', kind: 'fact', receipt: receipt('legacy') }, m.revision);
      if (mutation === 'legacy-forget') scope.forget(m.id, m.revision);
    }
    assert.deepEqual(detail(core, peer).conflicts, []);
    assert.equal(db.prepare(`SELECT count(*) n FROM "${relationTable(db)}"`).get().n, 0);
  });
}

test('K06 explicit promotion invalidates links; filed same-revision placement and replay preserve them', (t) => {
  const { core } = fixture(t);
  const b = admit(core, 'Target');
  const a = ok(finish(core, 'infer', claim(core, 'infer').token, [inferred('Source', [hint(b)])])).memories[0];
  const promoted = admit(core, 'Source');
  assert.ok(promoted.revision > a.revision);
  assert.deepEqual(detail(core, b).conflicts, []);
  const group = place(core, promoted, [], 'Topic');
  const filed = detail(core, promoted).memory;
  admit(core, 'Source', [hint(b)]);
  const before = detail(core, filed);
  place(core, filed, [group.createdMocs[0].id]);
  assert.deepEqual(detail(core, filed), before);
  place(core, filed, [], 'Other topic');
  assert.equal(detail(core, filed).memory.revision, filed.revision);
  assert.deepEqual(detail(core, filed).conflicts, before.conflicts);
  place(core, filed, []);
  assert.ok(detail(core, filed).memory.revision > filed.revision);
  assert.deepEqual(detail(core, b).conflicts, []);
});

test('K07 incident bound counts incoming and both sources, rejects whole overflowing batch', (t) => {
  const { core, db } = fixture(t);
  const center = admit(core, 'Center');
  const first = admit(core, 'Leaf 0', [hint(center)]);
  ok(finish(core, 'dual', claim(core, 'dual').token, [inferred('Leaf 0', [hint(center)])]));
  for (let i = 1; i < 4; i++) admit(core, `Leaf ${i}`, [hint(center)]);
  assert.equal(detail(core, center).conflicts.length, 5);
  const sorted = [...detail(core, center).conflicts].sort((a, b) => a.memoryId < b.memoryId ? -1 : a.memoryId > b.memoryId ? 1 : a.source < b.source ? -1 : 1);
  assert.deepEqual(detail(core, center).conflicts, sorted);
  const token = claim(core, 'overflow').token;
  const before = snapshot(db);
  error(core.admit({ ...input('Sixth'), conflictHints: [hint(center)] }), 'conflict_limit');
  assert.deepEqual(snapshot(db), before);
  error(finish(core, 'overflow', token, [inferred('Earlier'), inferred('Sixth', [hint(center)])]), 'conflict_limit');
  assert.deepEqual(snapshot(db), before);
  admit(core, 'Leaf 0', [hint(center)]);
  assert.deepEqual(snapshot(db), before);
  assert.deepEqual(detail(core, first).conflicts, [projection(center), projection(center, 'inferred-hint')]);
});

test('K07 outgoing overflow also rolls back a link-only admission', (t) => {
  const { core, db } = fixture(t);
  const targets = Array.from({ length: 6 }, (_, i) => admit(core, `Target ${i}`));
  const source = admit(core, 'Source', targets.slice(0, 5).map(hint));
  const before = snapshot(db);
  error(core.admit({ ...input('Source'), conflictHints: [hint(targets[5])] }), 'conflict_limit');
  assert.deepEqual(snapshot(db), before);
  assert.equal(detail(core, source).conflicts.length, 5);
});

test('K05 completed replay cannot recreate forgotten linked content', (t) => {
  const { core, db, path } = fixture(t);
  const target = admit(core, 'Target');
  const token = claim(core, 'complete').token;
  const done = ok(finish(core, 'complete', token, [inferred('Source', [hint(target)])]));
  const source = done.memories[0];
  ok(core.forget({ namespace, memoryId: source.id, expectedRevision: source.revision }));
  const reopened = openMemoryCore({ path }); t.after(() => reopened.close());
  const before = snapshot(db);
  assert.deepEqual(claim(reopened, 'complete'), { duplicate: true, memoryIds: [source.id], suppressedCount: 0 });
  error(finish(reopened, 'complete', token, [inferred('Source', [hint(target)])]), 'stale_admission');
  assert.deepEqual(snapshot(db), before);
  assert.deepEqual(detail(reopened, target).conflicts, []);
});

for (const mutation of ['correct', 'forget', 'receipt', 'filing']) test(`K06 failed ${mutation} invalidation restores the entire transaction`, (t) => {
  const { core, db } = fixture(t);
  const target = admit(core, 'Target');
  const source = admit(core, 'Source', [hint(target)]);
  db.exec(`CREATE TRIGGER conflict_delete_fault BEFORE DELETE ON "${relationTable(db)}" BEGIN SELECT RAISE(ABORT,'synthetic'); END`);
  const before = snapshot(db);
  let result;
  if (mutation === 'correct') result = core.correct({ namespace, memoryId: source.id, expectedRevision: source.revision,
    content: 'Corrected', kind: 'fact', receipt: receipt('correct') });
  if (mutation === 'forget') result = core.forget({ namespace, memoryId: source.id, expectedRevision: source.revision });
  if (mutation === 'receipt') result = core.admit({ ...input('Source', 'new evidence') });
  if (mutation === 'filing') result = core.applyPlacement({ namespace,
    proposal: { items: [{ memoryId: source.id, parentIds: [], newL1: { title: 'Topic', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [{ memoryId: source.id, revision: source.revision }], expectedIndexRevision: epoch(core) });
  error(result, 'storage_error');
  assert.deepEqual(snapshot(db), before);
});

for (const stage of ['relation', 'completion']) test(`K08 late ${stage} failure restores receipts, links, revisions, epochs and claim`, (t) => {
  const { core, db } = fixture(t);
  const target = admit(core, 'Target');
  const source = admit(core, 'Source', [hint(target)]);
  const token = claim(core, 'fault').token;
  const table = relationTable(db);
  db.exec(stage === 'relation'
    ? `CREATE TRIGGER conflict_fault BEFORE INSERT ON "${table}" BEGIN SELECT RAISE(ABORT,'synthetic'); END`
    : "CREATE TRIGGER conflict_fault BEFORE UPDATE ON admission_claims WHEN NEW.state='completed' BEGIN SELECT RAISE(ABORT,'synthetic'); END");
  const before = snapshot(db);
  error(finish(core, 'fault', token, [inferred('Source', [hint(target)], 'new receipt'), inferred('Novel')]), 'storage_error');
  assert.deepEqual(snapshot(db), before);
  assert.deepEqual(detail(core, target).conflicts, [projection(source)]);
  db.exec('DROP TRIGGER conflict_fault');
  ok(finish(core, 'fault', token, [inferred('Source', [hint(target)], 'new receipt'), inferred('Novel')]));
});

for (const corruption of ['foreign', 'stale', 'missing', 'deleted']) test(`K08 inspection filters ${corruption} endpoint corruption`, (t) => {
  const { core, db } = fixture(t);
  const b = admit(core, 'Target');
  const a = admit(core, 'Source', [hint(b)]);
  // Deliberately bypass runtime lifecycle to simulate inconsistent persisted references.
  if (corruption === 'foreign') db.prepare("UPDATE memories SET owner_id='foreign' WHERE id=?").run(b.id);
  if (corruption === 'stale') db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(b.id);
  if (corruption === 'missing') db.prepare('DELETE FROM memories WHERE id=?').run(b.id);
  if (corruption === 'deleted') db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(b.id);
  assert.deepEqual(detail(core, a).conflicts, []);
});

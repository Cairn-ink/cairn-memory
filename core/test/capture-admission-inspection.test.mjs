import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createAdmissionStorage } from '../admission-storage.mjs';
import { openMemoryCore } from '../contract.mjs';

const namespace = { ownerId: 'admission-inspection', scope: 'personal', projectId: null };
const client = 'synthetic-client';
const digest = 'a'.repeat(64);
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
const receipt = (text) => ({ client, sessionId: 's', eventId: text, role: 'user', excerpt: text });
const item = (text) => ({ content: text, kind: 'fact', confidence: 0.8, receipts: [receipt(text)] });
const key = (eventId) => ({ namespace, client, eventId });
const unknown = { status: 'unknown' };

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cairn-admission-inspect-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, 'memory.sqlite');
  const core = openMemoryCore({ path, model: { countTokens: () => 1 } });
  t.after(() => core.close());
  return { core, path };
}
function finish(core, eventId, items) {
  const claimed = ok(core.claimAdmission({ ...key(eventId), payloadDigest: digest, leaseMs: 125000 }));
  return ok(core.finishAdmission({ ...key(eventId), payloadDigest: digest,
    token: claimed.token, items }));
}
const inspect = (core, eventId, other = {}) => ok(core.inspectAdmission({ ...key(eventId), ...other }));
const snapshot = (db) => ['admission_claims', 'memories', 'receipts']
  .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());

test('completed membership is atomic, distinct, cold and admission-only', (t) => {
  const { core, path } = fixture(t);
  const result = finish(core, 'batch', [item('Synthetic one'), item('Synthetic two'),
    item('Synthetic one')]);
  assert.equal(result.memories.length, 2);
  const db = new DatabaseSync(path); t.after(() => db.close());
  const stored = JSON.parse(db.prepare("SELECT memory_ids FROM admission_claims WHERE event_id='batch'").get().memory_ids);
  assert.deepEqual(stored, result.memories.map(({ id }) => id));
  const before = snapshot(db);
  core.close();
  const cold = openMemoryCore({ path }); t.after(() => cold.close());
  const found = inspect(cold, 'batch');
  assert.equal(found.status, 'completed');
  assert.deepEqual(found.classification, unknown);
  assert.equal(found.suppressedCount, 0);
  assert.deepEqual(found.members, result.memories.map(({ id, revision }) => ({ status: 'current',
    memoryId: id, revision, filing: { status: 'unfiled' } })));
  assert.equal(JSON.stringify(found).includes('Synthetic'), false);
  assert.equal(JSON.stringify(found).includes(digest), false);
  assert.deepEqual(snapshot(db), before);
  const readonly = new DatabaseSync(path, { readOnly: true }); t.after(() => readonly.close());
  readonly.exec('PRAGMA query_only=ON');
  assert.deepEqual(createAdmissionStorage({ db: readonly }).inspectAdmission(
    { ownerId: namespace.ownerId, scope: namespace.scope, projectId: '' },
    { client, eventId: 'batch' }), found);
  assert.deepEqual(inspect(cold, 'other'), { status: 'absent', classification: unknown });
  assert.deepEqual(inspect(cold, 'batch', { client: 'foreign-client' }),
    { status: 'absent', classification: unknown });
  assert.deepEqual(inspect(cold, 'batch', { namespace: { ...namespace, ownerId: 'other' } }),
    { status: 'absent', classification: unknown });
});

test('pending, expired pending, absent and empty completion never mutate or imply classification', (t) => {
  const { core, path } = fixture(t);
  const db = new DatabaseSync(path); t.after(() => db.close());
  assert.deepEqual(inspect(core, 'absent'), { status: 'absent', classification: unknown });
  ok(core.claimAdmission({ ...key('pending'), payloadDigest: digest, leaseMs: 125000 }));
  const before = snapshot(db);
  assert.deepEqual(inspect(core, 'pending'), { status: 'pending', classification: unknown });
  assert.deepEqual(snapshot(db), before);
  db.exec("UPDATE admission_claims SET lease_expires_at = 0 WHERE event_id = 'pending'");
  const expired = snapshot(db);
  assert.deepEqual(inspect(core, 'pending'), { status: 'pending', classification: unknown });
  assert.deepEqual(snapshot(db), expired);
  finish(core, 'empty', []);
  assert.deepEqual(inspect(core, 'empty'), { status: 'completed', classification: unknown,
    suppressedCount: 0, members: [] });
  const suppressed = ok(core.admit({ namespace, memory: { content: 'Synthetic suppressed', kind: 'fact' },
    receipts: [receipt('Synthetic suppressed')] })).memory;
  ok(core.forget({ namespace, memoryId: suppressed.id, expectedRevision: suppressed.revision }));
  finish(core, 'suppressed', [item('Synthetic suppressed')]);
  assert.deepEqual(inspect(core, 'suppressed'), { status: 'completed', classification: unknown,
    suppressedCount: 1, members: [] });
  for (const patch of [{ payloadDigest: digest }, { leaseMs: 1 }, { extra: true },
    { eventId: '' }, { client: '' }, { namespace: { ...namespace, extra: true } }]) {
    error(core.inspectAdmission({ ...key('empty'), ...patch }), 'invalid_input');
  }
});

test('fresh current states are per member; corrected, historical, deleted and foreign members leak no old ref or text', (t) => {
  const { core, path } = fixture(t);
  const result = finish(core, 'lifecycle', [item('File synthetic'), item('Correct synthetic'),
    item('Forget synthetic'), item('Historic synthetic'), item('Keep synthetic')]);
  const [filed, corrected, forgotten, historic, kept] = result.memories;
  const map = ok(core.map({ namespace, purpose: 'classification' }));
  ok(core.applyPlacement({ namespace, proposal: { items: [{ memoryId: filed.id, parentIds: [],
    newL1: { title: 'Synthetic topic', parentL2Ids: [] } }] },
  expectedMemoryRevisions: [{ memoryId: filed.id, revision: filed.revision }],
  expectedIndexRevision: map.indexRevision }));
  ok(core.correct({ namespace, memoryId: corrected.id, expectedRevision: corrected.revision,
    content: 'Corrected present only', kind: 'fact', receipt: receipt('Correction evidence') }));
  ok(core.forget({ namespace, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  ok(core.supersede({ namespace, memoryId: historic.id, expectedRevision: historic.revision,
    replacement: { content: 'Replacement synthetic', kind: 'fact' },
    receipts: [receipt('Replacement evidence')] }));
  const db = new DatabaseSync(path); t.after(() => db.close());
  const before = snapshot(db);
  const members = inspect(core, 'lifecycle').members;
  assert.deepEqual(members.map(({ status }) => status),
    ['current', 'current', 'closed', 'closed', 'current']);
  assert.deepEqual(members[0].filing, { status: 'filed' });
  assert.equal(members[1].revision, corrected.revision + 1);
  assert.deepEqual(members[1].filing, { status: 'unfiled' });
  assert.deepEqual(members[4], { status: 'current', memoryId: kept.id,
    revision: kept.revision, filing: { status: 'unfiled' } });
  assert.deepEqual(members[2], { status: 'closed' });
  assert.deepEqual(members[3], { status: 'closed' });
  assert.equal(JSON.stringify(members).includes('synthetic'), false);
  assert.deepEqual(snapshot(db), before);
  assert.deepEqual(inspect(core, 'lifecycle', { namespace: { ...namespace, ownerId: 'other' } }),
    { status: 'absent', classification: unknown });
});

test('exact project boundaries and corrupt stored membership fail closed', (t) => {
  const { core, path } = fixture(t);
  const projectA = { ownerId: namespace.ownerId, scope: 'project', projectId: 'project-a' };
  const projectB = { ownerId: namespace.ownerId, scope: 'project', projectId: 'project-b' };
  const projectC = { ownerId: namespace.ownerId, scope: 'project', projectId: 'project-c' };
  const foreign = ok(core.admit({ namespace: projectB,
    memory: { content: 'Foreign project source must not leak.', kind: 'fact' },
    receipts: [receipt('Foreign project source must not leak.')] })).memory;
  for (const ns of [projectA, projectB]) {
    const claimed = ok(core.claimAdmission({ namespace: ns, client, eventId: 'same-event',
      payloadDigest: digest, leaseMs: 125000 }));
    ok(core.finishAdmission({ namespace: ns, client, eventId: 'same-event',
      payloadDigest: digest, token: claimed.token, items: [] }));
  }
  assert.equal(inspect(core, 'same-event', { namespace: projectA }).status, 'completed');
  assert.equal(inspect(core, 'same-event', { namespace: projectB }).status, 'completed');
  assert.deepEqual(inspect(core, 'same-event', { namespace: projectC }),
    { status: 'absent', classification: unknown });
  assert.deepEqual(inspect(core, 'same-event'),
    { status: 'absent', classification: unknown });
  finish(core, 'tampered', []);
  const db = new DatabaseSync(path); t.after(() => db.close());
  const replace = db.prepare("UPDATE admission_claims SET memory_ids = ? WHERE event_id = 'tampered'");
  replace.run(JSON.stringify([foreign.id]));
  assert.deepEqual(inspect(core, 'tampered'), { status: 'completed', classification: unknown,
    suppressedCount: 0, members: [{ status: 'closed' }] });
  for (const malformed of [JSON.stringify([' bad']), JSON.stringify(['duplicate', 'duplicate']),
    'not-json']) {
    replace.run(malformed);
    error(core.inspectAdmission(key('tampered')), 'storage_error');
  }
});

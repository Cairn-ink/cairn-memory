import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

const namespace = { ownerId: 'admission-tests', scope: 'personal', projectId: null };
const digest = 'a'.repeat(64);
const receipt = (eventId = 'source') => ({ client: 'synthetic', sessionId: 'session', eventId,
  role: 'user', excerpt: 'Synthetic evidence only.' });
const item = (content = 'Prefer concise examples.', eventId = 'source') => ({ content,
  kind: 'preference', confidence: 0.7, receipts: [receipt(eventId)] });
const key = (eventId = 'event') => ({ namespace, client: 'test', eventId, payloadDigest: digest });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-admission-')), 'memory.sqlite');
  const core = openMemoryCore({ path, model: { countTokens: (s) => Math.ceil(s.length / 4) } });
  const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  return { path, core, db };
}
const claim = (core, event = 'event', leaseMs = 125000) => ok(core.claimAdmission({ ...key(event), leaseMs }));
const finish = (core, token, items = [item()], event = 'event') => core.finishAdmission({ ...key(event), token, items });
const detail = (core, memoryId) => ok(core.get({ namespace, memoryId }));
const snapshot = (db) => ['memories', 'receipts', 'namespace_epochs', 'admission_claims']
  .map((table) => db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all());

test('claim fencing, exact namespace keys, digest conflicts, abandon, and empty completion', (t) => {
  const { core, db } = fixture(t);
  const first = claim(core);
  assert.deepEqual(Object.keys(first), ['token']);
  assert.equal(typeof first.token, 'string');
  assert.ok(first.token.length >= 16);
  assert.deepEqual(claim(core), { processing: true });
  error(core.claimAdmission({ ...key(), leaseMs: 1, payloadDigest: 'b'.repeat(64) }), 'event_payload_conflict');
  const other = ok(core.claimAdmission({ ...key(), namespace: { ...namespace, scope: 'project', projectId: 'p' }, leaseMs: 1000 }));
  assert.notEqual(other.token, first.token);
  assert.deepEqual(ok(core.abandonAdmission({ ...key(), token: 'wrong' })), { abandoned: false });
  assert.deepEqual(ok(core.abandonAdmission({ ...key(), token: first.token })), { abandoned: true });
  error(core.claimAdmission({ ...key(), leaseMs: 1, payloadDigest: 'b'.repeat(64) }), 'event_payload_conflict');
  const next = claim(core);
  assert.notEqual(next.token, first.token);
  error(finish(core, first.token), 'stale_admission');
  assert.deepEqual(ok(core.abandonAdmission({ ...key(), token: first.token })), { abandoned: false });
  const result = ok(finish(core, next.token, []));
  assert.equal(result.duplicate, false);
  assert.deepEqual(result.memories, []);
  assert.equal(result.suppressedCount, 0);
  assert.deepEqual(claim(core), { duplicate: true, memoryIds: [], suppressedCount: 0 });
  error(finish(core, next.token, []), 'stale_admission');
  assert.deepEqual(ok(core.abandonAdmission({ ...key(), token: next.token })), { abandoned: false });
  assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n, 0);
});

test('synthetic and real expiry reject old owners and permit fresh takeover', async (t) => {
  const { core, db } = fixture(t);
  const first = claim(core);
  db.exec('UPDATE admission_claims SET lease_expires_at = 0');
  error(finish(core, first.token), 'stale_admission');
  error(core.claimAdmission({ ...key(), leaseMs: 1, payloadDigest: 'b'.repeat(64) }), 'event_payload_conflict');
  const next = claim(core);
  assert.notEqual(next.token, first.token);
  error(finish(core, first.token), 'stale_admission');
  ok(finish(core, next.token));
  const short = claim(core, 'short', 5);
  await delay(15);
  error(finish(core, short.token, [], 'short'), 'stale_admission');
  assert.notEqual(claim(core, 'short').token, short.token);
});

test('all input members validate before writes, with exact allowlists and dense arrays', (t) => {
  const { core, db } = fixture(t);
  for (const patch of [{ leaseMs: 0 }, { leaseMs: 125001 }, { leaseMs: 1.5 }, { leaseMs: NaN },
    { payloadDigest: digest.toUpperCase() }, { payloadDigest: 'a'.repeat(63) }, { client: ' test' },
    { eventId: '' }, { namespace: { ...namespace, extra: true } }, { unknown: true }]) {
    error(core.claimAdmission({ ...key(), leaseMs: 1000, ...patch }), 'invalid_input');
  }
  const { token } = claim(core);
  const before = snapshot(db);
  const sparse = Array(2); sparse[0] = item();
  for (const items of [sparse, Array(6).fill(item()), [item(), { ...item(), confidence: NaN }],
    [item(), { ...item(), confidence: undefined }], [item(), { ...item(), confidence: -1 }],
    [item(), { ...item(), confidence: 1.1 }], [item(), { ...item(), origin: 'explicit' }],
    [item(), { ...item(), id: 'chosen' }], [item(), { ...item(), kind: 'unknown' }],
    [item(), item('x'.repeat(599) + '😀')],
    [{ ...item(), receipts: Array(1) }], [{ ...item(), receipts: [] }],
    [{ ...item(), receipts: Array(5).fill(receipt()) }], [{ ...item(), receipts: [{ ...receipt(), extra: true }] }]]) {
    error(finish(core, token, items), 'invalid_input');
    assert.deepEqual(snapshot(db), before);
  }
  error(core.finishAdmission({ ...key(), token, items: [], conflicts: [] }), 'invalid_input');
  error(core.abandonAdmission({ ...key(), token, extra: true }), 'invalid_input');
  error(finish(core, 'absent', []), 'stale_admission');
  error(core.finishAdmission({ ...key(), token, items: [], payloadDigest: 'b'.repeat(64) }), 'stale_admission');
  ok(finish(core, token, []));
});

test('inferred content is bounded and redacted, receipts bounded, and same-batch IDs use final revisions', (t) => {
  const { core } = fixture(t);
  const { token } = claim(core);
  const long = { ...item('x'.repeat(598) + '😀'), receipts: [{ ...receipt(), excerpt: 'z'.repeat(799) + '😀tail' }] };
  const result = ok(finish(core, token, [item(), item('Second fact'), item(undefined, 'second-source'), long]));
  assert.equal(result.memories.length, 3);
  const first = detail(core, result.memories[0].id);
  assert.equal(first.memory.content, item().content);
  assert.equal(first.memory.origin, 'agent-inferred');
  assert.equal(first.memory.confidence, 0.7);
  assert.equal(first.receipts.length, 2);
  assert.equal(result.memories[0].revision, first.memory.revision);
  assert.equal(detail(core, result.memories[1].id).memory.content, 'Second fact');
  const bounded = detail(core, result.memories[2].id);
  assert.equal(bounded.memory.content, 'x'.repeat(598) + '😀');
  assert.equal(bounded.receipts[0].excerpt, 'z'.repeat(799));
  const redacted = { ...item('  API token sk-' + 'a'.repeat(48) + ' stays secret.  '), receipts: [receipt()] };
  const secretResult = ok(finish(core, claim(core, 'secret').token, [redacted], 'secret'));
  assert.ok(!detail(core, secretResult.memories[0].id).memory.content.includes('a'.repeat(48)));
});

test('explicit precedence, exact no-op filing preservation, new receipt invalidation, and cursor epochs', (t) => {
  const { core } = fixture(t);
  const explicit = ok(core.admit({ namespace, memory: { content: item().content, kind: 'instruction' }, receipts: [receipt()] }));
  ok(core.admit({ namespace, memory: { content: 'Another note', kind: 'fact' }, receipts: [receipt('other')] }));
  const placed = ok(core.applyPlacement({ namespace,
    proposal: { items: [{ memoryId: explicit.memory.id, parentIds: [], newL1: { title: 'Examples', parentL2Ids: [] } }] },
    expectedMemoryRevisions: [{ memoryId: explicit.memory.id, revision: explicit.memory.revision }],
    expectedIndexRevision: ok(core.map({ namespace })).indexRevision }));
  const cursor = ok(core.list({ namespace, limit: 1 })).nextCursor;
  const before = detail(core, explicit.memory.id);
  const pending = claim(core);
  ok(core.list({ namespace, limit: 1, cursor }));
  ok(core.abandonAdmission({ ...key(), token: pending.token }));
  ok(core.list({ namespace, limit: 1, cursor }));
  const noOp = ok(finish(core, claim(core).token));
  assert.equal(noOp.indexRevision, placed.indexRevision);
  assert.deepEqual(detail(core, explicit.memory.id), before);
  ok(core.list({ namespace, limit: 1, cursor }));
  const changed = ok(finish(core, claim(core, 'new-source').token, [item(undefined, 'new-source')], 'new-source'));
  const after = detail(core, explicit.memory.id);
  assert.equal(after.memory.kind, 'instruction');
  assert.equal(after.memory.origin, 'explicit');
  assert.equal(after.memory.confidence, 1);
  assert.equal(after.memory.content, before.memory.content);
  assert.equal(after.memory.filing.status, 'unfiled');
  assert.deepEqual(after.placements, []);
  assert.ok(changed.indexRevision > placed.indexRevision);
  const catalog = ok(core.map({ namespace, purpose: 'classification' }));
  assert.equal(catalog.items.find((i) => i.type === 'moc' && i.moc.id === placed.createdMocs[0].id).moc.title, null);
  assert.equal(core.list({ namespace, limit: 1, cursor }).ok, false);
});

test('completed outcomes accommodate five existing maximum-length opaque IDs with JSON escaping', (t) => {
  const { core, db } = fixture(t);
  const items = Array.from({ length: 5 }, (_, i) => item(`Synthetic maximum ID memory ${i}`));
  const ids = items.map((input, i) => {
    const admitted = ok(core.admit({ namespace, memory: { content: input.content, kind: 'fact' }, receipts: input.receipts }));
    const id = `${i}${'"\\'.repeat(99)}"`;
    assert.equal(id.length, 200);
    // Build a consistent synthetic legacy identity, retaining FK validation at commit.
    db.exec('BEGIN IMMEDIATE; PRAGMA defer_foreign_keys = ON');
    try {
      db.prepare('UPDATE memories SET id = ? WHERE id = ?').run(id, admitted.memory.id);
      db.prepare('UPDATE receipts SET memory_id = ? WHERE memory_id = ?').run(id, admitted.memory.id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return id;
  });
  const result = ok(finish(core, claim(core).token, items));
  assert.deepEqual(result.memories.map((m) => m.id), ids);
  assert.deepEqual(claim(core), { duplicate: true, memoryIds: ids, suppressedCount: 0 });
  assert.deepEqual(JSON.parse(db.prepare('SELECT memory_ids FROM admission_claims').get().memory_ids), ids);
});

test('completed outcomes survive restart, correction and forget without persisting input content', (t) => {
  const { core, path, db } = fixture(t);
  const result = ok(finish(core, claim(core).token));
  const id = result.memories[0].id;
  const completed = db.prepare('SELECT * FROM admission_claims').get();
  const serialized = JSON.stringify(completed);
  assert.ok(!serialized.includes(item().content));
  assert.ok(!serialized.includes(receipt().excerpt));
  assert.deepEqual(JSON.parse(completed.memory_ids), [id]);
  assert.equal(completed.token, null);
  core.close();
  const restarted = openMemoryCore({ path });
  t.after(() => restarted.close());
  assert.deepEqual(claim(restarted), { duplicate: true, memoryIds: [id], suppressedCount: 0 });
  const corrected = ok(restarted.correct({ namespace, memoryId: id, expectedRevision: result.memories[0].revision,
    content: 'Prefer full worked examples.', kind: 'instruction', receipt: receipt('correction') }));
  assert.deepEqual(claim(restarted), { duplicate: true, memoryIds: [id], suppressedCount: 0 });
  const suppressed = ok(finish(restarted, claim(restarted, 'suppressed').token,
    [item(), item(), item('Unsuppressed novel note')], 'suppressed'));
  assert.equal(suppressed.suppressedCount, 2);
  assert.equal(suppressed.memories.length, 1);
  ok(restarted.forget({ namespace, memoryId: id, expectedRevision: corrected.memory.revision }));
  assert.deepEqual(claim(restarted), { duplicate: true, memoryIds: [id], suppressedCount: 0 });
  const forgotten = ok(finish(restarted, claim(restarted, 'forgotten').token,
    [item('Prefer full worked examples.')], 'forgotten'));
  assert.equal(forgotten.suppressedCount, 1);
  assert.deepEqual(forgotten.memories, []);
  assert.deepEqual(claim(restarted, 'forgotten'), { duplicate: true, memoryIds: [], suppressedCount: 1 });
  error(restarted.claimAdmission({ ...key(), leaseMs: 1, payloadDigest: 'b'.repeat(64) }), 'event_payload_conflict');
});

for (const stage of ['second-memory', 'completion']) test(`atomic rollback at ${stage} preserves claim and all prior data`, (t) => {
  const { core, db } = fixture(t);
  const { token } = claim(core);
  const before = snapshot(db);
  db.exec(stage === 'second-memory'
    ? `CREATE TRIGGER admission_fault BEFORE INSERT ON memories WHEN NEW.content = 'Fail this item' BEGIN SELECT RAISE(ABORT, 'synthetic'); END`
    : `CREATE TRIGGER admission_fault BEFORE UPDATE ON admission_claims WHEN NEW.state = 'completed' BEGIN SELECT RAISE(ABORT, 'synthetic'); END`);
  error(finish(core, token, [item('First item'), item('Fail this item')]), 'storage_error');
  assert.deepEqual(snapshot(db), before);
  db.exec('DROP TRIGGER admission_fault');
  assert.equal(ok(finish(core, token, [item('First item'), item('Fail this item')])).memories.length, 2);
});

function worker(path, method, input) {
  const program = `import { openMemoryCore } from ${JSON.stringify(new URL('../contract.mjs', import.meta.url).href)};
    const core = openMemoryCore({path:process.argv[1]});
    process.send('ready'); process.once('message', () => {
      process.send(core[process.argv[2]](JSON.parse(process.argv[3]))); core.close(); process.disconnect();
    });`;
  const child = spawn(process.execPath, ['--input-type=module', '-e', program, path, method, JSON.stringify(input)],
    { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    child.once('message', resolve); child.once('error', reject);
    child.once('exit', (code) => { if (code) reject(new Error(stderr)); });
  });
  const result = new Promise((resolve, reject) => {
    child.on('message', (message) => { if (message !== 'ready') resolve(message); });
    child.once('error', reject); child.once('exit', (code) => { if (code) reject(new Error(stderr)); });
  });
  return { child, ready, result };
}

test('two independent processes race for one claim and one atomic finish', { timeout: 15000 }, async (t) => {
  const { path, core, db } = fixture(t);
  const claimers = [0, 1].map(() => worker(path, 'claimAdmission', { ...key(), leaseMs: 125000 }));
  t.after(() => claimers.forEach(({ child }) => child.kill()));
  await Promise.all(claimers.map((w) => w.ready));
  claimers.forEach((w) => w.child.send('go'));
  const claims = (await Promise.all(claimers.map((w) => w.result))).map(ok);
  assert.equal(claims.filter((c) => c.processing).length, 1);
  const token = claims.find((c) => c.token).token;
  const finishers = [0, 1].map(() => worker(path, 'finishAdmission', { ...key(), token, items: [item()] }));
  t.after(() => finishers.forEach(({ child }) => child.kill()));
  await Promise.all(finishers.map((w) => w.ready));
  finishers.forEach((w) => w.child.send('go'));
  const results = await Promise.all(finishers.map((w) => w.result));
  assert.equal(results.filter((r) => r.ok).length, 1);
  error(results.find((r) => !r.ok), 'stale_admission');
  assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n, 1);
  assert.equal(claim(core).memoryIds.length, 1);
});

test('finish checks lease after obtaining the writer lock', { timeout: 15000 }, async (t) => {
  const { core, path, db } = fixture(t);
  const { token } = claim(core);
  const contender = worker(path, 'finishAdmission', { ...key(), token, items: [item()] });
  t.after(() => contender.child.kill());
  await contender.ready;
  db.exec('BEGIN IMMEDIATE');
  db.prepare('UPDATE admission_claims SET lease_expires_at = ?').run(Date.now() + 60);
  contender.child.send('go');
  await delay(100);
  db.exec('COMMIT');
  error(await contender.result, 'stale_admission');
  assert.equal(db.prepare('SELECT count(*) n FROM memories').get().n, 0);
});

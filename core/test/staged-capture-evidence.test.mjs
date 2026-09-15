import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, existsSync, readFileSync, openSync, closeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { migrateVersion10 } from '../qualified-transition-schema.mjs';
import { migrateVersion11 } from '../rationale-schema.mjs';

// Scripted models and private temporary stores test lifecycle, not semantics.
const namespace = { ownerId: 'staging-tests', scope: 'personal', projectId: null };
const options = { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' };
const input = (patch = {}) => ({ namespace, client: 'synthetic', eventId: 'event', sessionId: 'session',
  messages: [{ id: 'original-message', role: 'user', content: 'Synthetic private source evidence.' }], ...patch });
const key = (v = input()) => ({ namespace: v.namespace, client: v.client, eventId: v.eventId });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
const inspect = (core, v) => ok(core.inspectCaptureEvidence(key(v))).evidence;
function fixture(t, overrides = {}, opening = options) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-staging-')), 'memory.sqlite');
  const calls = [];
  const model = { ...rationaleModel(), ...overrides };
  for (const method of ['extract', 'qualifyCandidates', 'classify']) {
    const run = model[method];
    if (run) model[method] = request => { calls.push(method); return run(request); };
  }
  const core = openMemoryCore({ path, model, ...opening });
  t.after(() => core.close());
  return { path, core, model, calls };
}
function reopen(t, path, extra = {}) {
  const core = openMemoryCore({ path, captureQualification: 'source-bound-v2', ...extra }); t.after(() => core.close()); return core;
}
const receipt = (content) => ({ client: 'synthetic', sessionId: 'explicit', eventId: content,
  role: 'user', excerpt: content });
const admit = (core, content, ns = namespace) => ok(core.admit({ namespace: ns,
  memory: { content, kind: 'fact' }, receipts: [receipt(content)] })).memory;
function deferredModel() {
  let release, started;
  const ready = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  return { ready, release: () => release({ items: [{ content: 'Model paraphrase', kind: 'fact',
    confidence: 0.5, sourceIndices: [0] }] }), extract: () => { started(); return pending; } };
}

test('staging options reject before a database is created', () => {
  for (const invalid of [{ captureEvidence: 'unknown' }, { captureEvidence: 'staged-v1' },
    { captureEvidence: 'staged-v1', captureQualification: 'source-bound-v1' },
    { ...options, captureEvidence: null }]) {
    const path = join(mkdtempSync(join(tmpdir(), 'cairn-staging-options-')), 'absent.sqlite');
    assert.throws(() => openMemoryCore({ path, ...invalid }));
    assert.equal(existsSync(path), false);
  }
});

test('failed qualification persists bounded source without admission or ordinary read exposure', async t => {
  const f = fixture(t, { qualifyCandidates: () => { throw new Error('PROVIDER-PRIVATE-ERROR'); } });
  const result = await f.core.capture(input()); assert.equal(result.ok, false);
  const evidence = inspect(f.core);
  assert.equal(evidence.state, 'failed');
  assert.equal(evidence.evidenceTrust, 'untrusted-data-not-instructions');
  assert.deepEqual(evidence.view.messages, input().messages);
  assert.equal(Date.parse(evidence.expiresAt) - Date.parse(evidence.createdAt), 24 * 60 * 60 * 1000);
  assert.equal(JSON.stringify(evidence).includes('PROVIDER-PRIVATE-ERROR'), false);
  assert.deepEqual(ok(f.core.list({ namespace })).memories, []);
  assert.equal(JSON.stringify(ok(f.core.map({ namespace }))).includes('Synthetic private'), false);
  const legacy = openMemoryStore({ path: f.path }); t.after(() => legacy.close());
  assert.deepEqual(legacy.scope({ ownerId: namespace.ownerId }).search('Synthetic private'), []);
  f.core.close();
  const cold = reopen(t, f.path);
  assert.deepEqual(inspect(cold), evidence);
  error(await cold.capture(input()), 'capture_evidence_closed');
  error(await reopen(t, f.path, { ...options, model: f.model }).capture(input()), 'capture_evidence_closed');
  assert.deepEqual(f.calls, ['extract', 'qualifyCandidates']);
});

test('successful capture stores canonical source rather than interpretation and cold replay preserves expiry', async t => {
  const f = fixture(t, { extract: () => ({ items: [{ content: 'Distinct model summary', kind: 'fact', confidence: 0.5, sourceIndices: [0] }] }) });
  const v = input({ messages: [{ id: 'source-id', role: 'assistant', content: '  ' + 'a'.repeat(900) + '  ' }] });
  const result = ok(await f.core.capture(v));
  const evidence = inspect(f.core, v);
  assert.equal(evidence.state, 'admitted');
  assert.deepEqual(evidence.view.messages, [{ id: 'source-id', role: 'assistant', content: 'a'.repeat(800) }]);
  assert.deepEqual(evidence.view.retainedSourceWindow, { maxUnitsPerMessage: 800, truncatedMessageIndices: [0] });
  assert.equal(JSON.stringify(evidence).includes('Distinct model summary'), false);
  const cold = reopen(t, f.path, options);
  const duplicate = ok(await cold.capture(v));
  assert.equal(duplicate.duplicate, true);
  assert.deepEqual(duplicate.memoryIds, result.admission.memories.map(m => m.id));
  assert.deepEqual(inspect(cold, v), evidence);
  error(await cold.capture({ ...v, sessionId: 'changed' }), 'event_payload_conflict');
});

test('default captures have no staged payload and cannot be retrospectively staged', async t => {
  const f = fixture(t, {}, { captureQualification: 'source-bound-v2' });
  ok(await f.core.capture(input()));
  assert.equal(inspect(f.core), null);
  const enabled = reopen(t, f.path, options);
  error(await enabled.capture(input()), 'capture_evidence_closed');
  assert.equal(inspect(enabled), null);
});

test('strict access validation, exact namespaces, malformed and causal capture reject without model calls', async t => {
  const f = fixture(t);
  for (const patch of [{ extra: true }, { messages: [] }, { causal: { streamId: 'stream', sequence: 1 } }]) {
    assert.equal((await f.core.capture(input(patch))).ok, false);
    assert.equal(inspect(f.core), null);
  }
  for (const method of ['inspectCaptureEvidence', 'discardCaptureEvidence']) {
    error(f.core[method]({ ...key(), extra: true }), 'invalid_input');
    error(f.core[method]({ ...key(), namespace: { ...namespace, extra: true } }), 'invalid_input');
  }
  assert.deepEqual(f.calls, []);
  ok(await f.core.capture(input()));
  const other = input({ namespace: { ...namespace, ownerId: 'other' } });
  assert.equal(inspect(f.core, other), null);
  assert.deepEqual(ok(f.core.discardCaptureEvidence(key(other))), { discarded: false });
  assert.notEqual(inspect(f.core).view, null);
});

test('discard fences deferred extraction and remains closed through disabled staging', async t => {
  const deferred = deferredModel(); t.after(deferred.release); const f = fixture(t, { extract: deferred.extract });
  const pending = f.core.capture(input()); await deferred.ready;
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  const claim = db.prepare('SELECT payload_digest, token FROM admission_claims').get();
  assert.equal(inspect(f.core).state, 'pending');
  assert.equal(ok(await f.core.capture(input())).processing, true);
  const cold = reopen(t, f.path);
  assert.deepEqual(ok(cold.discardCaptureEvidence(key())), { discarded: true });
  assert.deepEqual(ok(cold.discardCaptureEvidence(key())), { discarded: false });
  deferred.release(); error(await pending, 'capture_evidence_closed');
  assert.deepEqual(f.calls, ['extract']);
  assert.equal(inspect(cold).state, 'discarded'); assert.equal(inspect(cold).view, null);
  const manualKey = { ...key(), payloadDigest: claim.payload_digest };
  error(cold.claimAdmission({ ...manualKey, leaseMs: 125000 }), 'capture_evidence_closed');
  error(cold.finishAdmission({ ...manualKey, token: claim.token, items: [] }), 'capture_evidence_closed');
  assert.deepEqual(ok(cold.list({ namespace })).memories, []);
  error(await cold.capture(input()), 'capture_evidence_closed');
});

for (const action of ['forget', 'correct']) for (const facade of ['envelope', 'legacy']) {
  test(`${facade} ${action} clears exact namespace and fences deferred paraphrase admission`, async t => {
    const deferred = deferredModel(); t.after(deferred.release); const f = fixture(t, { extract: deferred.extract });
    const target = admit(f.core, 'Explicit mutation target');
    const survivor = admit(f.core, 'Unrelated admitted survivor');
    const otherNs = { ...namespace, ownerId: 'different-owner' };
    const other = reopen(t, f.path, { ...options, model: { ...rationaleModel(), extract: () => ({ items: [] }) } });
    ok(await other.capture(input({ namespace: otherNs })));
    ok(await other.capture(input({ eventId: 'older-stage' })));
    const pending = f.core.capture(input()); await deferred.ready;
    const cold = reopen(t, f.path);
    if (facade === 'legacy') {
      const store = openMemoryStore({ path: f.path }); t.after(() => store.close());
      if (action === 'forget') assert.equal(store.scope({ ownerId: namespace.ownerId }).forget(target.id, target.revision), true);
      else store.scope({ ownerId: namespace.ownerId }).correct(target.id, { content: 'Explicit replacement', kind: 'fact',
        receipt: receipt('Explicit replacement') }, target.revision);
    } else if (action === 'forget') ok(cold.forget({ namespace, memoryId: target.id, expectedRevision: target.revision }));
    else ok(cold.correct({ namespace, memoryId: target.id, expectedRevision: target.revision,
      content: 'Explicit replacement', kind: 'fact', receipt: receipt('Explicit replacement') }));
    deferred.release(); error(await pending, 'capture_evidence_closed');
    assert.deepEqual(f.calls, ['extract']);
    for (const v of [input(), input({ eventId: 'older-stage' })]) {
      assert.equal(inspect(cold, v).state, 'forgotten'); assert.equal(inspect(cold, v).view, null);
      error(await cold.capture(v), 'capture_evidence_closed');
    }
    assert.notEqual(inspect(cold, input({ namespace: otherNs })).view, null);
    assert.equal(ok(cold.get({ namespace, memoryId: survivor.id })).memory.content, 'Unrelated admitted survivor');
    ok(await other.capture(input({ eventId: 'new-unrelated' })));
  });
}

test('rejected memory mutations preserve staged content', async t => {
  const f = fixture(t, { extract: () => ({ items: [] }) });
  const target = admit(f.core, 'Unchanged explicit memory'); ok(await f.core.capture(input()));
  const before = inspect(f.core);
  assert.equal(ok(f.core.forget({ namespace, memoryId: 'missing', expectedRevision: 1 })).forgotten, false);
  assert.equal(f.core.correct({ namespace, memoryId: target.id, expectedRevision: target.revision + 1,
    content: 'Rejected replacement', kind: 'fact', receipt: receipt('Rejected replacement') }).ok, false);
  assert.deepEqual(inspect(f.core), before);
});

test('64 payload quota rejects atomically before model work and discard restores capacity', async t => {
  const f = fixture(t, { extract: () => ({ items: [] }) });
  for (let i = 0; i < 64; i++) ok(await f.core.capture(input({ eventId: `quota-${i}` })));
  const calls = f.calls.length;
  error(await f.core.capture(input({ eventId: 'overflow' })), 'capture_evidence_capacity');
  assert.equal(f.calls.length, calls); assert.equal(inspect(f.core, input({ eventId: 'overflow' })), null);
  ok(f.core.discardCaptureEvidence(key(input({ eventId: 'quota-0' }))));
  ok(await f.core.capture(input({ eventId: 'overflow' })));
});

test('1 MiB payload quota counts serialized UTF-8 and leaves rejected events absent', async t => {
  const f = fixture(t, { extract: () => ({ items: [] }) });
  const messages = Array.from({ length: 24 }, (_, i) => ({ id: `m-${i}`, role: 'user', content: '界'.repeat(800) }));
  let bytes = 0, count = 0;
  while (true) {
    const v = input({ eventId: `bytes-${count}`, messages }); const calls = f.calls.length;
    const result = await f.core.capture(v);
    if (!result.ok) {
      error(result, 'capture_evidence_capacity'); assert.equal(f.calls.length, calls);
      assert.equal(inspect(f.core, v), null); break;
    }
    const payloadBytes = Buffer.byteLength(JSON.stringify(inspect(f.core, v).view));
    assert.ok(payloadBytes <= 128 * 1024); bytes += payloadBytes; count++;
    assert.ok(count < 64);
  }
  assert.ok(bytes <= 1024 * 1024); assert.ok(bytes > 950 * 1024);
});

test('expiry remains purged across clock rollback and reopen without staging', async t => {
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const f = fixture(t, { extract: () => ({ items: [] }) });
  ok(await f.core.capture(input())); const before = inspect(f.core);
  now = Date.parse(before.expiresAt) + 1;
  assert.equal(inspect(f.core).view, null);
  f.core.close(); now = Date.parse(before.createdAt) - 10000;
  const cold = reopen(t, f.path);
  assert.equal(inspect(cold).view, null);
  error(await cold.capture(input()), 'capture_evidence_closed');
  const enabled = reopen(t, f.path, { ...options, model: f.model });
  const fresh = input({ eventId: 'after-clock-rollback' });
  ok(await enabled.capture(fresh));
  const later = inspect(enabled, fresh);
  assert.ok(Date.parse(later.createdAt) >= Date.parse(before.expiresAt) + 1);
  assert.equal(Date.parse(later.expiresAt) - Date.parse(later.createdAt), 86400000);
});

test('staged namespace watermark does not extend unrelated unstaged admission leases', async t => {
  const originalNow = Date.now; const start = originalNow(); let now = start;
  Date.now = () => now; t.after(() => { Date.now = originalNow; });
  const f = fixture(t, { extract: () => ({ items: [] }) });
  ok(await f.core.capture(input()));
  now += 86400001;
  assert.equal(inspect(f.core).state, 'expired');
  now = start;
  const cold = reopen(t, f.path);
  const manual = eventId => ({ namespace, client: 'manual', eventId, payloadDigest: 'a'.repeat(64) });
  const first = ok(cold.claimAdmission({ ...manual('lease'), leaseMs: 1000 }));
  const completion = ok(cold.claimAdmission({ ...manual('complete'), leaseMs: 1000 }));
  ok(cold.finishAdmission({ ...manual('complete'), token: completion.token, items: [] }));
  const abandoned = ok(cold.claimAdmission({ ...manual('abandon'), leaseMs: 1000 }));
  assert.equal(ok(cold.abandonAdmission({ ...manual('abandon'), token: abandoned.token })).abandoned, true);
  now += 1001;
  error(cold.finishAdmission({ ...manual('lease'), token: first.token, items: [] }), 'stale_admission');
  assert.notEqual(ok(cold.claimAdmission({ ...manual('lease'), leaseMs: 1000 })).token, first.token);
  assert.equal(inspect(cold).view, null);
});

test('abandoned pending lease fails closed instead of implicitly retrying', async t => {
  const originalNow = Date.now; let now = originalNow(); Date.now = () => now;
  t.after(() => { Date.now = originalNow; });
  const deferred = deferredModel(); t.after(deferred.release); const f = fixture(t, { extract: deferred.extract });
  const pending = f.core.capture(input()); await deferred.ready;
  now += 126000;
  const cold = reopen(t, f.path, { ...options, model: f.model });
  error(await cold.capture(input()), 'capture_evidence_closed');
  assert.equal(inspect(cold).state, 'failed'); assert.notEqual(inspect(cold).view, null);
  assert.deepEqual(f.calls, ['extract']);
  deferred.release(); error(await pending, 'capture_evidence_closed');
});

test('abrupt process exit leaves committed source inspectable and lease expiry cannot retry extraction', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-staging-crash-')), 'memory.sqlite');
  const v = input({ messages: [{ id: 'crash-source', role: 'assistant',
    content: 'Synthetic complete quotation survives an abrupt process exit before extraction returns.' }] });
  const program = `import { openMemoryCore } from ${JSON.stringify(new URL('../contract.mjs', import.meta.url).href)};
    const core = openMemoryCore({ path: process.argv[1], ...JSON.parse(process.argv[2]),
      model: { contextWindow: 8192, countTokens: () => 1, extract: () => process.exit(0) } });
    await core.capture(JSON.parse(process.argv[3]));
    process.exit(9);`;
  execFileSync(process.execPath, ['--input-type=module', '-e', program, path, JSON.stringify(options), JSON.stringify(v)],
    { env: {}, timeout: 10000, stdio: ['ignore', 'pipe', 'pipe'] });
  const cold = reopen(t, path);
  const before = inspect(cold, v);
  assert.equal(before.state, 'pending'); assert.deepEqual(before.view.messages, v.messages);
  assert.deepEqual(ok(cold.list({ namespace })).memories, []);
  const originalNow = Date.now;
  Date.now = () => Date.parse(before.createdAt) + 126000;
  t.after(() => { Date.now = originalNow; });
  const calls = [];
  const enabled = reopen(t, path, { ...options, model: rationaleModel(method => calls.push(method)) });
  error(await enabled.capture(v), 'capture_evidence_closed');
  assert.deepEqual(calls, []);
  const failed = inspect(cold, v);
  assert.equal(failed.state, 'failed'); assert.deepEqual(failed.view, before.view);
  assert.equal(failed.expiresAt, before.expiresAt);
});

test('staged source uses NFKC whitespace normalization and secret redaction before persistence', async t => {
  const secret = 'sk-' + 'a'.repeat(48);
  let extractionInput;
  const f = fixture(t, { extract: request => { extractionInput = request.input; return { items: [] }; } });
  const v = input({ messages: [{ id: 'canonical-source', role: 'assistant',
    content: `  Ａ\n token\t${secret}  stays private.  ` }] });
  ok(await f.core.capture(v));
  const expected = [{ id: 'canonical-source', role: 'assistant', content: 'A token [REDACTED] stays private.' }];
  assert.deepEqual(inspect(f.core, v).view.messages, expected);
  assert.equal(JSON.stringify(extractionInput).includes(secret), false);
  f.core.close();
  assert.deepEqual(inspect(reopen(t, f.path), v).view.messages, expected);
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  assert.equal(db.prepare('SELECT payload FROM staged_capture_evidence').get().payload.includes(secret), false);
});

test('same-owner project namespaces isolate inspect, discard and namespace-wide deletion', async t => {
  const f = fixture(t, { extract: () => ({ items: [] }) });
  const firstNs = { ...namespace, scope: 'project', projectId: 'first-project' };
  const secondNs = { ...namespace, scope: 'project', projectId: 'second-project' };
  const first = input({ namespace: firstNs }), second = input({ namespace: secondNs });
  ok(await f.core.capture(first)); ok(await f.core.capture(second));
  assert.equal(inspect(f.core), null);
  ok(f.core.discardCaptureEvidence(key(first)));
  assert.equal(inspect(f.core, first).view, null); assert.notEqual(inspect(f.core, second).view, null);
  const again = input({ namespace: firstNs, eventId: 'second-event' });
  ok(await f.core.capture(again));
  const target = admit(f.core, 'Project-specific explicit target', firstNs);
  ok(f.core.forget({ namespace: firstNs, memoryId: target.id, expectedRevision: target.revision }));
  assert.equal(inspect(f.core, again).state, 'forgotten');
  assert.equal(inspect(f.core, again).view, null);
  assert.equal(inspect(f.core, second).state, 'admitted'); assert.notEqual(inspect(f.core, second).view, null);
});

function version12Fixture(t) {
  // Reconstruct the frozen synthetic v10 fixture, then apply the unchanged v11
  // and v12 migrations. No v13 implementation constructs this old schema.
  const saved = JSON.parse(readFileSync(new URL('./qualified-transition-v10-fixture.json', import.meta.url), 'utf8'));
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-staging-v12-')), 'memory.sqlite');
  closeSync(openSync(path, 'ax', 0o600));
  const db = new DatabaseSync(path); t.after(() => db.close());
  for (const type of ['table', 'index', 'view']) for (const row of saved.schema.filter(r => r.type === type)) db.exec(row.sql);
  db.exec('BEGIN; PRAGMA defer_foreign_keys=ON');
  for (const { name, rows } of saved.tables) for (const row of rows) {
    const columns = Object.keys(row);
    db.prepare(`INSERT INTO "${name}" (${columns.map(c => `"${c}"`).join(',')}) VALUES (${columns.map(() => '?').join(',')})`).run(...Object.values(row));
  }
  db.exec('COMMIT');
  for (const row of saved.schema.filter(r => r.type === 'trigger')) db.exec(row.sql);
  migrateVersion10(db); migrateVersion11(db);
  db.exec('PRAGMA application_id=1128352082; PRAGMA user_version=12');
  const preserved = () => { for (const { name, rows } of saved.tables)
    assert.deepEqual(db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all().map(row => ({ ...row })), rows, name); };
  return { path, db, saved, preserved };
}

test('v12 migration adds empty staging tables while preserving old memories, receipts and replay identities', async t => {
  const f = version12Fixture(t); const core = reopen(t, f.path);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 13);
  f.preserved();
  for (const table of ['staged_capture_evidence', 'staged_capture_clocks']) {
    assert.equal(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n, 0);
    assert.equal(f.db.prepare('PRAGMA table_list').all().find(row => row.name === table).strict, 1);
  }
  assert.deepEqual(ok(core.get({ namespace: f.saved.namespace, memoryId: f.saved.history.memory.id })), f.saved.history);
  assert.equal(inspect(core, f.saved.captureInput), null);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(), []);
});

test('v12 migration collision rolls back all staging DDL and keeps the old schema readable for retry', t => {
  const f = version12Fixture(t);
  f.db.exec('CREATE TABLE staged_capture_clocks (synthetic_marker TEXT)');
  const before = f.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all();
  assert.throws(() => openMemoryCore({ path: f.path }));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 12);
  assert.deepEqual(f.db.prepare('SELECT * FROM sqlite_master ORDER BY name').all(), before); f.preserved();
  f.db.exec('DROP TABLE staged_capture_clocks');
  reopen(t, f.path);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 13); f.preserved();
});

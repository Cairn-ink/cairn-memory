import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { localPlainPort, rawRequest, splitRaw } from '../testing/raw-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const policy = 'append-matching-evidence-v1';
const namespace = { ownerId: 'synthetic-duplicate', scope: 'personal', projectId: null };
const fields = ['subject','property','scope','applies','value','attribution','commitment'];
const content = 'Synthetic shared qualified assertion.';
const labels = { subject: 'Synthetic', property: 'plan', scope: 'private', applies: 'Tuesday', value: 'tram', attribution: 'direct', commitment: 'adopted' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const denied = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
const request = (id, patch = {}) => ({ namespace, client: 'codex', sessionId: 'session-' + id, eventId: 'event-' + id,
  messages: [{ id: 'message-' + id, role: 'user', content: 'Synthetic source ' + id + '.' }], ...patch });
const qualification = text => ({ version: 1, slot: Object.fromEntries(fields.slice(0, 4).map(key => [key, labels[key]])),
  ...Object.fromEntries(fields.slice(4).map(key => [key, labels[key]])),
  anchors: [{ receiptIndex: 0, start: 0, end: text.length, text, fields }] });
const material = db => ['memories','receipts','memory_qualifications','qualification_anchors','namespace_epochs','conflicts','memory_moc_memberships']
  .filter(name => db.prepare("SELECT 1 FROM sqlite_master WHERE name=?").get(name))
  .map(name => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);

function fixture(t, options = {}, selected = true) {
  const workspace = createTestWorkspace(t, { prefix: 'qualified-duplicate-capture-' }), path = join(workspace.path, 'store.sqlite');
  const state = { content, labels: { ...labels }, confidence: .7, kind: 'fact', calls: 0, skip: false, malformed: false, abort: false };
  const base = rationaleModel();
  const model = { ...base, countTokens: text => state.skip && text.includes('"candidateIndex"') && text.includes('maxOutputTokens') ? 6001 : 1,
    extract() { state.calls++; if (state.abort) throw Object.assign(Error('synthetic cancellation'), { name: 'AbortError' });
      return { items: state.items ?? [{ content: state.content, kind: state.kind, confidence: state.confidence, sourceIndices: [0] }] }; },
    qualifyCandidates({ input }) { state.calls++; return { qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
      ...Object.fromEntries(fields.map(field => [field, { value: state.labels[field],
        evidenceIndices: [state.malformed ? 999 : item.candidates[0].candidateIndex] }])) })) }; } };
  let core;
  const reopen = (patch = {}) => { core?.close(); core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2',
    ...(selected ? { captureQualifiedDuplicates: policy } : {}), ...options, ...patch }); return core; };
  workspace.defer(() => core?.close()); reopen();
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  return { workspace, path, state, db, reopen, get core() { return core; } };
}
const detail = (core, id) => ok(core.get({ namespace, memoryId: id, includeQualification: true }));

test('QD-01 policy constructor rejects malformed, inherited and accessor authority before DB/getter/model work', t => {
  const workspace = createTestWorkspace(t, { prefix: 'qualified-duplicate-options-' }); let reads = 0;
  const path = join(workspace.path, 'never-created.sqlite');
  for (const value of [undefined, null, false, '', 'append-matching-evidence-v2']) {
    assert.throws(() => openMemoryCore({ path, captureQualification: 'source-bound-v2', captureQualifiedDuplicates: value }), { code: 'invalid_input' });
  }
  const valid = { path, captureQualification: 'source-bound-v2', captureQualifiedDuplicates: policy };
  for (const patch of [{ captureQualification: undefined }, { captureQualification: 'source-bound-v1' },
    { sessionEpisodes: { mode: 'episode-v1' }, captureEvidence: 'staged-v1' }, { captureSourcePolicy: 'indexed-evidence-v1' }]) {
    assert.throws(() => openMemoryCore({ ...valid, ...patch }), { code: 'invalid_input' });
  }
  for (const value of [Object.assign(Object.create({ captureQualifiedDuplicates: policy }), { path, captureQualification: 'source-bound-v2' }),
    Object.assign(Object.create({ get captureQualifiedDuplicates() { reads++; return policy; } }), { path, captureQualification: 'source-bound-v2' }),
    { ...valid, get captureQualifiedDuplicates() { reads++; return policy; } },
    { ...valid, get model() { reads++; return {}; } }, new Proxy(valid, { get() { reads++; }, has() { reads++; } })]) {
    assert.throws(() => openMemoryCore(value), { code: 'invalid_input' });
  }
  assert.equal(reads, 0); assert.equal(existsSync(path), false);
});

test('QD-02 default strict refusal, policy append, immutable original qualification and cold/model-free completed replay', async t => {
  const strict = fixture(t, {}, false); ok(await strict.core.capture(request('A')));
  const before = material(strict.db); denied(await strict.core.capture(request('B')), 'qualification_conflict');
  assert.deepEqual(material(strict.db), before);
  strict.reopen({ captureQualifiedDuplicates: policy }); ok(await strict.core.capture(request('B')));
  assert.equal(strict.db.prepare('SELECT count(*) n FROM memories').get().n, 1);
});

test('QD-02 ordinary policy append preserves original provenance and existing confidence/kind/revision rules', async t => {
  const f = fixture(t), a = ok(await f.core.capture(request('A'))), id = a.admission.memories[0].id;
  const original = detail(f.core, id).qualification;
  const rows = ['memory_qualifications','qualification_anchors'].map(name => f.db.prepare(`SELECT * FROM ${name}`).all());
  f.state.confidence = .9; f.state.kind = 'preference';
  const b = ok(await f.core.capture(request('B'))); assert.equal(b.admission.memories[0].id, id);
  const saved = detail(f.core, id); assert.equal(saved.receipts.length, 2); assert.equal(saved.memory.confidence, .9);
  assert.equal(saved.memory.kind, 'fact'); assert.ok(saved.memory.revision > a.admission.memories[0].revision);
  assert.deepEqual(saved.qualification, original);
  assert.deepEqual(['memory_qualifications','qualification_anchors'].map(name => f.db.prepare(`SELECT * FROM ${name}`).all()), rows);
  f.reopen(); const calls = f.state.calls; const before = material(f.db);
  assert.equal(ok(await f.core.capture(request('B'))).duplicate, true);
  assert.equal(f.state.calls, calls); assert.deepEqual(material(f.db), before); assert.deepEqual(detail(f.core, id), saved);
});

for (const field of fields) test(`QD-03 changed ${field} refuses atomically without replacing original qualification`, async t => {
  const f = fixture(t); ok(await f.core.capture(request('A'))); const before = material(f.db);
  f.state.labels[field] = field === 'attribution' ? 'reported' : field === 'commitment' ? 'considered' : 'Different';
  denied(await f.core.capture(request('B')), 'qualification_conflict'); assert.deepEqual(material(f.db), before);
  assert.equal(f.db.prepare("SELECT count(*) n FROM admission_claims WHERE state='completed'").get().n, 1);
});

for (const variant of ['content-case','corrupt-original','invalid-incoming','missing-incoming','unqualified-target']) {
  test(`QD-03 ${variant} cannot use matching-evidence exception`, async t => {
    const f = fixture(t);
    if (variant === 'unqualified-target') ok(f.core.admit({ namespace, memory: { content, kind: 'fact' },
      receipts: [{ client: 'manual', sessionId: 'manual', eventId: 'manual', role: 'user', excerpt: 'Synthetic manual source.' }] }));
    else ok(await f.core.capture(request('A')));
    if (variant === 'content-case') f.state.content = content.toUpperCase();
    if (variant === 'corrupt-original') f.db.prepare('UPDATE memory_qualifications SET content_digest=?').run('0'.repeat(64));
    if (variant === 'invalid-incoming') f.state.malformed = true;
    if (variant === 'missing-incoming') f.state.skip = true;
    const before = material(f.db);
    denied(await f.core.capture(request('B')), variant === 'corrupt-original' ? 'storage_error' : variant === 'invalid-incoming' ? 'invalid_model_output' : 'qualification_conflict');
    assert.deepEqual(material(f.db), before);
  });
}

test('QD-05 manual finish, explicit admit and ordered capture remain strict under selected policy', async t => {
  const f = fixture(t); ok(await f.core.capture(request('A')));
  const source = { client: 'codex', sessionId: 'manual', eventId: 'manual', role: 'user', excerpt: 'Synthetic manual source.' };
  const input = { namespace, memory: { content, kind: 'fact' }, receipts: [source], qualification: qualification(source.excerpt) };
  const before = material(f.db); denied(f.core.admit(input), 'qualification_conflict'); assert.deepEqual(material(f.db), before);
  const key = { namespace, client: 'codex', eventId: 'manual-job', payloadDigest: 'a'.repeat(64) };
  const { token } = ok(f.core.claimAdmission({ ...key, leaseMs: 125000 }));
  denied(f.core.finishAdmission({ ...key, token, items: [{ content, kind: 'fact', confidence: .8, receipts: [source], qualification: input.qualification }] }), 'qualification_conflict');
  assert.deepEqual(material(f.db), before);
  denied(await f.core.capture(request('ordered', { causal: { streamId: 'stream', sequence: 1 } })), 'qualification_conflict');
  assert.deepEqual(material(f.db), before);
});

test('QD-05 suppression skips inferred duplicate rather than reviving it', async t => {
  const f = fixture(t), first = ok(await f.core.capture(request('A'))), memory = detail(f.core, first.admission.memories[0].id).memory;
  ok(f.core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
  const saved = ok(await f.core.capture(request('B')));
  assert.equal(saved.admission.suppressedCount, 1); assert.deepEqual(saved.admission.memories, []);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0);
});

test('QD-05 later qualified conflict rolls back an earlier new batch member and all attachments', async t => {
  const f = fixture(t); ok(await f.core.capture(request('A'))); const before = material(f.db);
  f.state.items = [{ content: 'Synthetic new batch member.', kind: 'fact', confidence: .8, sourceIndices: [0] },
    { content, kind: 'fact', confidence: .8, sourceIndices: [0] }];
  f.state.labels.value = 'different'; denied(await f.core.capture(request('B')), 'qualification_conflict');
  assert.deepEqual(material(f.db), before);
});

test('QD-03 exact null and unknown labels match without substituting original anchors', async t => {
  const f = fixture(t); f.state.labels = { subject: null, property: null, scope: null, applies: null, value: null, attribution: 'unknown', commitment: 'unknown' };
  const a = ok(await f.core.capture(request('A'))), id = a.admission.memories[0].id, original = detail(f.core, id).qualification;
  ok(await f.core.capture(request('B'))); assert.deepEqual(detail(f.core, id).qualification, original);
});

test('QD-07 staged capture appends while failed/discarded evidence and ordinary failed retry keep existing contracts', async t => {
  const f = fixture(t, { captureEvidence: 'staged-v1' });
  const a = ok(await f.core.capture(request('A'))), b = ok(await f.core.capture(request('B')));
  assert.equal(a.admission.memories[0].id, b.admission.memories[0].id);
  f.state.labels.value = 'different'; denied(await f.core.capture(request('C')), 'qualification_conflict');
  f.state.labels.value = labels.value; const calls = f.state.calls;
  denied(await f.core.capture(request('C')), 'capture_evidence_closed'); assert.equal(f.state.calls, calls);
  const ordinary = fixture(t); ok(await ordinary.core.capture(request('A')));
  ordinary.state.labels.value = 'different'; denied(await ordinary.core.capture(request('B')), 'qualification_conflict');
  ordinary.state.labels.value = labels.value; ok(await ordinary.core.capture(request('B')));
});

test('QD-07 Raw policy binding changes refuse complete/incomplete old events; overlap cannot retry interpretation', async t => {
  const f = fixture(t, { rawConversations: { mode: 'raw-v1', port: localPlainPort(), capBytes: 1000000,
    readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
  const raw = id => rawRequest(splitRaw('Synthetic Raw ' + id + '.', { id: 'message-' + id })[0], { namespace, client: 'codex', sessionId: 'session-' + id, eventId: 'event-' + id });
  const a = ok(await f.core.captureRaw(raw('A'))); ok(a.interpretation);
  f.state.labels.value = 'different'; const failed = ok(await f.core.captureRaw(raw('B'))); denied(failed.interpretation, 'qualification_conflict');
  f.state.labels.value = labels.value; const calls = f.state.calls;
  const repeated = ok(await f.core.captureRaw(raw('B'))); assert.equal(ok(repeated.interpretation).status, 'incomplete');
  ok(await f.core.captureRaw({ ...raw('B'), eventId: 'overlap' })); assert.equal(f.state.calls, calls);
  const before = f.db.prepare('SELECT binding_digest FROM raw_capture_events ORDER BY event_id').all();
  f.core.close();
  const strict = openMemoryCore({ path: f.path, model: { extract: () => assert.fail('replay must not dispatch') }, captureQualification: 'source-bound-v2',
    rawConversations: { mode: 'off', readPolicy: () => ({ generation: 'synthetic', reason: null }) } }); f.workspace.defer(() => strict.close());
  for (const id of ['A','B']) denied(await strict.captureRaw(raw(id)), 'event_payload_conflict');
  assert.deepEqual(f.db.prepare('SELECT binding_digest FROM raw_capture_events ORDER BY event_id').all(), before);
});

test('QD-09 owned cancelled model and deliberate assertion failure remove their scratch', async t => {
  const workspace = createTestWorkspace(null, { prefix: 'qualified-duplicate-owned-failure-' }); let core;
  workspace.defer(() => core?.close());
  try {
    core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), captureQualification: 'source-bound-v2', captureQualifiedDuplicates: policy,
      model: { ...rationaleModel(), extract: () => { throw Object.assign(Error('synthetic'), { name: 'AbortError' }); } } });
    denied(await core.capture(request('cancel')), 'model_cancelled');
    assert.throws(() => assert.equal(1, 2), { code: 'ERR_ASSERTION' });
  } finally { await workspace.cleanup(); }
  assert.equal(existsSync(workspace.path), false);
});

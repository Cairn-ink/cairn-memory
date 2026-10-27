import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { createProductReaderRuntime } from '../context-product-reader.mjs';
import { existsSync, statSync, renameSync, chmodSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openContextProductReader, createContextReadSupervisor } from '../index.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { fixture, ns, ok } from '../testing/context-read-fixture.mjs';
import { host as legacyHost } from '../testing/context-read-core-fixture.mjs';
import { openContextReader } from '../context-reader.mjs';
import { installOverviewLayout } from '../testing/topic-overview-raw29-fixture.mjs';
import { openDatabase } from '../database.mjs';
import { migrateMethodPrerequisites } from '../method-package-migration.mjs';
import { installAssets } from '../asset-schema.mjs';
import { installRoleProfiles } from '../role-profile-schema.mjs';
import { installCardCurrentDependencies } from '../card-current-schema.mjs';
import { validateContextProductLayout } from '../context-product-schema.mjs';

const moduleUrl = new URL('../testing/context-product-host.mjs', import.meta.url).href;
function configured(t, path, patch = {}, readSet = [ns], credential = { nonce: randomUUID() }) {
  const supervisor = createContextReadSupervisor(); t.after(() => supervisor.close());
  const state = new SharedArrayBuffer(32), view = new Int32Array(state); view[0] = 1; view[3] = 4;
  const requestControl = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(), credentialExpiresUtcMs: null, requestMaxMs: 5000 };
  const ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: readSet.length, selectedNamespaces: readSet.length, omittedNamespaces: 0 };
  const binding = { kind: 'request', requestId: requestControl.requestId, handleId: requestControl.handleId,
    credentialBindingId: requestControl.credentialBindingId, credentialExpiresUtcMs: null, credentialDigest: credentialDigest(credential),
    ownerId: ns.ownerId, namespaces: { readSet, ownerCoverage }, issuedAt: 1, ...patch };
  const options = { supervisor, path, version: 'context-read-v1', profile: PRODUCT_PROFILE, readSet, ownerCoverage,
    requestControl, host: { moduleUrl, configuration: { requestBinding: binding, state, requestReservation: new SharedArrayBuffer(4) } }, diagnostics: true };
  return { credential, view, options, supervisor, async open() { const reader = await openContextProductReader(options); t.after(() => reader.close()); return reader; } };
}
const fetchInput = memory => ({ readSet: [ns], refs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }], intent: 'current' });
const denied = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
// SQLite owns all database descriptors. Fingerprint logical schema/data and
// file metadata without opening/closing a raw descriptor that drops POSIX locks.
const fingerprint = path => {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const schema = db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name").all();
    const rows = schema.filter(r => r.type === 'table').map(({ name }) =>
      [name, db.prepare('SELECT * FROM "' + name.replaceAll('"', '""') + '"').all()]);
    const stat = statSync(path);
    return JSON.stringify({ schema, rows, version: db.prepare('PRAGMA user_version').get(), size: stat.size, mtime: stat.mtimeMs });
  } finally { db.close(); }
};

function installVersion(path, version) {
  if (version <= 29) installOverviewLayout(path, version);
  else {
    const db = openDatabase(path);
    try {
      migrateMethodPrerequisites(db);
      if (version >= 31) { installAssets(db); db.exec('PRAGMA user_version=31'); }
      if (version >= 32) { installRoleProfiles(db); db.exec('PRAGMA user_version=32'); }
      if (version >= 33) { installCardCurrentDependencies(db); db.exec('PRAGMA user_version=33'); }
    } finally { db.close(); }
  }
}

for (const version of [18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33]) test(`P2-02/04/05 real Worker physical v${version} canonical fetch, no sidecar or migration`, async t => {
  const f = fixture(t), memory = f.admit('Ｆｕｌｌ width canonical body'); f.core.close();
  installVersion(f.path, version);
  const canonical = f.db.prepare('SELECT content FROM memories WHERE id=?').get(memory.id).content;
  const before = fingerprint(f.path), config = configured(t, f.path), reader = await config.open();
  const capabilities = ok(await reader.getContextReadCapabilities());
  assert.ok(config.view[4] > 0);
  assert.equal(capabilities.profile, PRODUCT_PROFILE); assert.equal(capabilities.execution, 'worker');
  assert.equal(capabilities.readSetMaximum, 2); assert.deepEqual(capabilities.methods, ['fetchCandidateEvidence']);
  assert.deepEqual(capabilities.types, version >= 23 ? ['memory', 'card'] : ['memory']);
  const fetched = ok(await reader.fetchCandidateEvidence(fetchInput(memory), config.credential));
  assert.equal(fetched.items[0].content, canonical); assert.equal(config.view[1], 2);
  assert.equal(typeof fetched.snapshot, 'string');
  assert.deepEqual(ok(await reader.fetchCandidateEvidence({ readSet: [ns], snapshot: fetched.snapshot }, config.credential)), fetched);
  assert.equal(config.view[1], 4);
  denied(await reader.findCandidates({ readSet: [ns], query: 'canonical', types: ['memory'], intent: 'current' }, config.credential), 'index_unavailable');
  await reader.close();
  assert.equal(fingerprint(f.path), before); assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, version);
  assert.equal(existsSync(f.path + '.context-read-product-v1.1.sqlite'), false);
  assert.equal(existsSync(f.path + '.context-read-v1.sqlite'), false);
  const deliveries = await config.supervisor.drain();
  assert.ok(deliveries.length >= 3); assert.ok(deliveries.every(d => d.state === 'complete' && d.telemetry === 'complete'));
});

for (const stage of ['entry', 'final', 'generation-entry', 'generation-final']) test(`P2-14/25/26 real Worker ${stage} refuses with exact sample count`, async t => {
  const f = fixture(t), memory = f.admit('private');
  const config = configured(t, f.path, stage.startsWith('generation') ? { ownerGeneration: 4 } : {});
  if (stage === 'entry') config.view[0] = 0;
  if (stage === 'final') config.view[2] = 2;
  if (stage === 'generation-entry') config.view[3] = 5;
  // The host publication hook revokes at the second sample; generation equality
  // is independently tested at entry and on both successful samples.
  if (stage === 'generation-final') config.view[5] = 2;
  const reader = await config.open(), final = stage.endsWith('final');
  denied(await reader.fetchCandidateEvidence(fetchInput(memory), config.credential), final ? 'scope_changed' : 'authority_required');
  assert.equal(config.view[1], final ? 2 : 1);
});

test('P2-22 separate service authority, cross-request/handle credential reuse and reservation reuse refuse', async t => {
  const f = fixture(t), memory = f.admit('private'), a = configured(t, f.path), b = configured(t, f.path);
  const readerA = await a.open(), readerB = await b.open();
  denied(await readerB.fetchCandidateEvidence(fetchInput(memory), a.credential), 'authority_required');
  assert.equal(b.view[1], 0);
  await assert.rejects(openContextProductReader(a.options), { code: 'authority_required' });
  const service = configured(t, f.path, { kind: 'service' });
  await assert.rejects(service.open(), { code: 'authority_required' });
  await readerA.close(); denied(await readerA.fetchCandidateEvidence(fetchInput(memory), a.credential), 'store_closed');
});

test('P2-01/11 product snapshot domains isolated; full-ref/fence semantics and legacy bytes unchanged', async t => {
  const f = fixture(t), memory = f.admit('canonical');
  const config = configured(t, f.path), reader = await config.open(), trusted = legacyHost();
  const legacy = openContextReader({ path: f.path, contextRead: { version: 'context-read-v1', authority: trusted.authority } }); t.after(() => legacy.close());
  const input = fetchInput(memory), before = trusted.call(legacy, 'fetchCandidateEvidence', input);
  const product = ok(await reader.fetchCandidateEvidence(input, config.credential));
  assert.deepEqual(product.items, ok(before).items);
  assert.notEqual(product.snapshot, before.value.snapshot);
  denied(await reader.fetchCandidateEvidence({ readSet: [ns], snapshot: before.value.snapshot }, config.credential), 'invalid_snapshot');
  denied(trusted.call(legacy, 'fetchCandidateEvidence', { readSet: [ns], snapshot: product.snapshot }), 'invalid_snapshot');
  denied(await reader.fetchCandidateEvidence({ ...input, fences: ['AAAAAAAA'] }, config.credential), 'snapshot_stale');
  assert.equal(JSON.stringify(trusted.call(legacy, 'fetchCandidateEvidence', input)), JSON.stringify(before));
  denied(trusted.call(legacy, 'fetchCandidateEvidence', { ...input, deadlineMs: 20 }), 'invalid_input');
});

test('P2-01 product evidence does not probe an unrelated legacy cache', async t => {
  const f = fixture(t), memory = f.admit('canonical');
  const cache = new DatabaseSync(f.path + '.context-read-v1.sqlite');
  cache.exec('PRAGMA journal_mode=WAL; CREATE TABLE unrelated(value TEXT)');
  t.after(() => cache.close());
  const config = configured(t, f.path), reader = await config.open();
  assert.equal((await reader.fetchCandidateEvidence(fetchInput(memory), config.credential)).ok, true);
});

for (const version of [19, 99]) test(`P2-05 unsupported schema ${version} remains untouched and failed open is supervised`, async t => {
  const f = fixture(t); f.core.close();
  const db = openDatabase(f.path); db.exec('PRAGMA user_version=' + version); db.close();
  const before = fingerprint(f.path), config = configured(t, f.path);
  let failure; await config.open().catch(error => { failure = error; });
  assert.equal(failure.code, 'unsupported_database'); assert.ok(failure.cleanupId);
  const drained = await config.supervisor.drain(failure.cleanupId);
  assert.equal(drained.state, 'complete'); assert.equal(fingerprint(f.path), before);
});

test('P2-14 generation equality and revocation after the final sample permit bounded completion without a third check', async t => {
  const f = fixture(t), memory = f.admit('canonical'), config = configured(t, f.path, { ownerGeneration: 4 });
  config.view[6] = 2;
  const reader = await config.open();
  assert.equal((await reader.fetchCandidateEvidence(fetchInput(memory), config.credential)).ok, true);
  assert.equal(config.view[0], 0); assert.equal(config.view[1], 2);
  denied(await reader.fetchCandidateEvidence(fetchInput(memory), config.credential), 'authority_required');
});

test('P2-16 failed host construction releases registered outer attribution with no returned reader', async t => {
  const f = fixture(t), config = configured(t, f.path);
  config.options.host.configuration.throwAfterResource = true;
  let failure; await config.open().catch(e => { failure = e; });
  assert.equal(failure.code, 'reader_failed');
  const cleanup = await config.supervisor.drain(failure.cleanupId);
  assert.equal(cleanup.state, 'complete'); assert.equal(cleanup.leasesReleased, true); assert.equal(config.view[7], 1);
});

test('P2-04 physical v18 old pin reopens after product fetch with unchanged SQLite contents and file metadata', async t => {
  const f = fixture(t), memory = f.admit('old pin canonical'); f.core.close();
  const before = fingerprint(f.path), config = configured(t, f.path), reader = await config.open();
  assert.equal((await reader.fetchCandidateEvidence(fetchInput(memory), config.credential)).ok, true);
  await reader.close();
  const { openDatabase } = await import('./fixtures/topic-overview-b2513501/core/database.mjs');
  const old = openDatabase(f.path);
  try { assert.equal(old.prepare('SELECT content FROM memories WHERE id=?').get(memory.id).content, f.db.prepare('SELECT content FROM memories WHERE id=?').get(memory.id).content); }
  finally { old.close(); }
  assert.equal(fingerprint(f.path), before);
});

for (const version of [23, 33]) test(`P2-05/11 real v${version} Card evidence uses canonical eligibility and exact revisions`, async t => {
  const f = fixture(t, { cards: true }), memory = f.admit('memory beside Card');
  const draft = ok(f.host.call(f.core, 'createCardDraft', { namespace: ns, actionId: 'draft', drafting: 'authored', input: {
    title: 'Synthetic Card', body: 'Canonical Card body', authoredInput: { text: 'Synthetic source', occurredAt: null } } }));
  const card = ok(f.host.call(f.core, 'confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: draft.revision, actionId: 'confirm', applicability: 'current' }));
  f.core.close();
  if (version === 33) {
    const db = openDatabase(f.path); try { migrateMethodPrerequisites(db); installAssets(db); installRoleProfiles(db); installCardCurrentDependencies(db); db.exec('PRAGMA user_version=33'); } finally { db.close(); }
  }
  const config = configured(t, f.path), reader = await config.open();
  const cardRef = { type: 'card', namespace: ns, cardId: card.id, revision: card.revision, bodyRevision: card.bodyRevision };
  const input = { readSet: [ns], refs: [fetchInput(memory).refs[0], cardRef], intent: 'current' };
  const value = ok(await reader.fetchCandidateEvidence(input, config.credential));
  assert.deepEqual(value.items.map(i => i.type), ['memory', 'card']); assert.equal(value.items[1].body, f.db.prepare('SELECT body FROM private_cards WHERE id=?').get(card.id).body);
  denied(await reader.fetchCandidateEvidence({ ...input, refs: [{ ...cardRef, revision: card.revision + 1 }] }, config.credential), 'revision_conflict');
});

test('P2-06 two namespaces preserve mapping under permutations and reject changed/omitted read sets', async t => {
  const f = fixture(t), personal = { ownerId: ns.ownerId, scope: 'personal', projectId: null };
  const a = f.admit('project evidence'), b = f.admit('personal evidence', personal), config = configured(t, f.path, {}, [ns, personal]);
  const reader = await config.open(), refs = [fetchInput(a).refs[0], { ...fetchInput(b).refs[0], namespace: personal }];
  const first = ok(await reader.fetchCandidateEvidence({ readSet: [personal, ns], refs, intent: 'current' }, config.credential));
  const second = ok(await reader.fetchCandidateEvidence({ readSet: [ns, personal], refs, intent: 'current' }, config.credential));
  assert.deepEqual(first, second);
  denied(await reader.fetchCandidateEvidence({ refs, intent: 'current' }, config.credential), 'invalid_read_set');
  denied(await reader.fetchCandidateEvidence({ readSet: [ns], refs: refs.slice(0, 1), intent: 'current' }, config.credential), 'invalid_read_set');
  denied(await reader.fetchCandidateEvidence({ readSet: [ns], refs: refs.slice(0, 1), intent: 'current' }), 'authority_required');
});

test('P2-11/22/25 fresh credentials can refetch durable snapshots; content epochs do not revoke authority', async t => {
  const f = fixture(t), memory = f.admit('durable evidence'), a = configured(t, f.path), first = await a.open();
  const value = ok(await first.fetchCandidateEvidence(fetchInput(memory), a.credential)); await first.close();
  const b = configured(t, f.path), second = await b.open();
  assert.deepEqual(ok(await second.fetchCandidateEvidence({ readSet: [ns], snapshot: value.snapshot }, b.credential)), value);
  f.admit('unrelated canonical commit');
  denied(await second.fetchCandidateEvidence({ readSet: [ns], snapshot: value.snapshot }, b.credential), 'snapshot_stale');
  assert.equal((await second.fetchCandidateEvidence(fetchInput(memory), b.credential)).ok, true);
});

test('P2-14 revocation after the Worker final canonical read permits receipt before cutoff without another sample', async t => {
  const { default: threads } = await import('node:worker_threads'), { syncBuiltinESMExports } = await import('node:module');
  const NativeWorker = threads.Worker;
  const f = fixture(t), memory = f.admit('after final read'), config = configured(t, f.path);
  threads.Worker = class extends NativeWorker {
    constructor(url, options) {
      super(url, options);
      this.prependListener('message', message => {
        if (message.result?.ok && message.result.value?.items) Atomics.store(config.view, 0, 0);
      });
    }
  };
  syncBuiltinESMExports();
  try {
    const reader = await config.open();
    assert.equal((await reader.fetchCandidateEvidence(fetchInput(memory), config.credential)).ok, true);
    assert.equal(config.view[0], 0); assert.equal(config.view[1], 2);
    await reader.close();
  } finally { threads.Worker = NativeWorker; syncBuiltinESMExports(); }
});

for (const version of [20,21,22,23,24,25,26,27,28,29,30,31,32,33]) test(`P2-05 relabelled v18 as v${version} refuses before returning a handle`, async t => {
  const f = fixture(t); f.core.close();
  const db = new DatabaseSync(f.path); db.exec('PRAGMA user_version=' + version); db.close();
  const config = configured(t, f.path); let failure;
  await config.open().catch(error => { failure = error; });
  assert.equal(failure?.code, 'unsupported_database');
  assert.equal((await config.supervisor.drain(failure.cleanupId)).state, 'complete');
});

for (const [version, mutation] of [
  [18, 'DROP TABLE memory_qualifications'],
  [18, 'ALTER TABLE memories RENAME COLUMN content TO removed_content'],
  [18, 'ALTER TABLE receipts RENAME COLUMN excerpt TO removed_excerpt'],
  [18, 'DROP INDEX memory_receipts'],
  [18, 'DROP INDEX memory_receipts; CREATE INDEX memory_receipts ON receipts(id,memory_id,created_at)'],
  [23, 'DROP TABLE private_cards'],
  [23, 'ALTER TABLE private_cards RENAME COLUMN body TO removed_body'],
  [23, 'ALTER TABLE card_notes RENAME COLUMN text TO removed_text'],
  [23, 'ALTER TABLE card_memory_bindings RENAME COLUMN source_ref TO removed_source_ref'],
  [23, 'DROP INDEX private_card_scope'],
  [23, 'DROP TABLE card_applicability_reviews'],
]) test(`P2-05 physical v${version} rejects malformed layout: ${mutation}`, async t => {
  const f = fixture(t); f.core.close(); installOverviewLayout(f.path, version);
  const db = new DatabaseSync(f.path); db.exec(mutation); db.close();
  const config = configured(t, f.path); let failure;
  await config.open().catch(error => { failure = error; });
  assert.equal(failure?.code, 'unsupported_database');
  assert.equal((await config.supervisor.drain(failure.cleanupId)).state, 'complete');
});

test('P2-05 legacy layout acceptance is unchanged by product attestation', t => {
  const f = fixture(t); f.core.close();
  const db = new DatabaseSync(f.path); db.exec('PRAGMA user_version=23'); db.close();
  const reader = openContextReader({ path: f.path, contextRead: { version: 'context-read-v1', authority: legacyHost().authority } });
  reader.close();
});

test('P2-08 canonical replacement preserves cursor_stale across the real Worker boundary', async t => {
  const f = fixture(t), memory = f.admit('replace canonical file'), config = configured(t, f.path), reader = await config.open();
  f.core.close(); renameSync(f.path, f.path + '.previous');
  const replacement = new DatabaseSync(f.path); replacement.close(); chmodSync(f.path, 0o600);
  denied(await reader.fetchCandidateEvidence(fetchInput(memory), config.credential), 'cursor_stale');
});

for (const dimension of ['depth', 'nodes']) test(`P2-28 real Worker accepts credential at inclusive ${dimension} limit`, async t => {
  let credential = dimension === 'nodes' ? Array(8191).fill(0) : 0;
  if (dimension === 'depth') for (let i = 0; i < 16; i++) credential = [credential];
  const f = fixture(t), memory = f.admit('boundary credential');
  const config = configured(t, f.path, {}, [ns], credential), reader = await config.open();
  assert.equal((await reader.fetchCandidateEvidence(fetchInput(memory), credential)).ok, true);
  const oversized = dimension === 'nodes' ? Array(8192).fill(0) : [credential];
  denied(await reader.fetchCandidateEvidence(fetchInput(memory), oversized), 'invalid_input');
});

for (const stage of ['authorize', 'entry', 'final']) test(`P2-26 real Worker observes rejected ${stage} Promise and remains healthy`, async t => {
  const f = fixture(t), memory = f.admit('canonical'), config = configured(t, f.path);
  config.options.host.configuration.rejectedAuthorityAt = stage;
  const reader = await config.open();
  denied(await reader.fetchCandidateEvidence(fetchInput(memory), config.credential), stage === 'final' ? 'scope_changed' : 'authority_required');
  assert.equal(config.view[1], stage === 'authorize' ? 0 : stage === 'entry' ? 1 : 2);
  assert.equal(config.view[7], 0);
  assert.equal((await reader.getContextReadCapabilities()).ok, true);
  // Graceful close requires the real Worker to exit zero after rejection checks.
  await reader.close();
  assert.ok((await config.supervisor.drain()).every(record => record.state === 'complete'));
});

for (const version of [18,20,21,22,23,24,25,26,27,28,29,30,31,32,33]) test(`P2-05 v${version} attests every required partial predicate`, t => {
  const f = fixture(t); f.core.close(); installVersion(f.path, version);
  const db = new DatabaseSync(f.path);
  try {
    validateContextProductLayout(db);
    const required = db.prepare("SELECT name,sql FROM sqlite_schema WHERE type='index' AND name IN ('active_identity','capture_current_memories') ORDER BY name").all();
    assert.equal(required.length, 2);
    for (const { name, sql } of required) {
      for (const mutation of [sql.replace(/deleted\s*=\s*0/i, 'deleted=1'), sql.replace(/\s+WHERE[\s\S]*$/i, '')]) {
        assert.notEqual(mutation, sql);
        db.exec(`DROP INDEX ${name}`); db.exec(mutation);
        assert.throws(() => validateContextProductLayout(db), { code: 'unsupported_database' });
        db.exec(`DROP INDEX ${name}`); db.exec(sql);
        validateContextProductLayout(db);
      }
    }
  } finally { db.close(); }
});

for (const predicate of ['WHERE deleted=1', '']) test(`P2-05 real Worker refuses active_identity predicate ${predicate || 'absent'}`, async t => {
  const f = fixture(t); f.core.close();
  const db = new DatabaseSync(f.path);
  try { db.exec(`DROP INDEX active_identity; CREATE UNIQUE INDEX active_identity ON memories(owner_id,scope,project_id,fingerprint) ${predicate}`); }
  finally { db.close(); }
  const config = configured(t, f.path); let failure;
  await config.open().catch(error => { failure = error; });
  assert.equal(failure?.code, 'unsupported_database');
  assert.equal((await config.supervisor.drain(failure.cleanupId)).state, 'complete');
});

function openingRuntime(results = []) {
  return createProductReaderRuntime({ spawnWorker: data => {
    const worker = new Worker(new URL('./fixtures/context-product-opening-worker.mjs', import.meta.url), {
      workerData: data, env: {}, execArgv: [], stdout: true, stderr: true,
    });
    worker.on('message', message => { if (message.result) results.push(message.result); });
    return worker;
  } });
}
for (const version of [32, 33]) test(`Fix round 4 v${version}: native content execution starts after entry isCurrent`, async t => {
  const f = fixture(t), memory = f.admit('selected canonical evidence'); f.core.close(); installVersion(f.path, version);
  const config = configured(t, f.path), state = new Int32Array(new SharedArrayBuffer(64)); state[0] = 1;
  config.options.host.configuration.state = state.buffer;
  const reader = await openingRuntime()(config.options); t.after(() => reader.close());
  assert.equal(state[1], 0); assert.equal(state[8], 0); assert.equal(state[9], 0); assert.ok(state[10] > 0);
  assert.equal((await reader.fetchCandidateEvidence(fetchInput(memory), config.credential)).ok, true);
  assert.equal(state[1], 2); assert.equal(state[8], 0); assert.ok(state[9] > 0);
});

for (const kind of ['native', 'probe']) for (const code of [5, 261, 6, 7, 10])
for (const stage of kind === 'native' ? ['open', 'configure', 'prepare'] : ['open', 'prepare', 'execute', 'close'])
test(`Fix round 4 real Worker ${kind} ${stage} SQLite ${code}: frozen mapping and native diagnostics`, async t => {
  const f = fixture(t); f.core.close();
  const config = configured(t, f.path);
  config.options.host.configuration.openingFault = { kind, stage, code };
  const messages = []; let failure;
  await openingRuntime(messages)(config.options).catch(error => { failure = error; });
  assert.deepEqual(messages.at(-1), { ok: false, error: { code: [5, 6].includes(code & 255) ? 'storage_busy' : 'storage_error', retryable: [5, 6].includes(code & 255) } });
  assert.equal(failure?.code, [5, 6].includes(code & 255) ? 'storage_busy' : 'storage_error');
  assert.equal(failure.message, failure.code);
  const status = await config.supervisor.drain(failure.cleanupId), diagnostic = status.diagnostics;
  assert.equal(status.state, 'complete'); assert.equal(diagnostic.coverage, 'complete');
  assert.equal(diagnostic.failures, 1); assert.equal(diagnostic.busy, [5, 6].includes(code & 255) ? 1 : 0);
  if (kind === 'probe') assert.equal(diagnostic.begun, { open: 1, prepare: 3, execute: 4, close: 4 }[stage]);
  const [record] = diagnostic.records;
  assert.equal(record.stage, stage); assert.equal(record.statement, kind === 'probe' && !['open', 'close'].includes(stage) ? 'journal_mode' : stage === 'configure' ? 'reader_configuration' : stage === 'prepare' ? 'user_version' : 'connection');
  assert.deepEqual(record.sqlite, { code: code & 255, extendedCode: code });
});

for (const damage of ['missing', 'unknown', 'lost-close']) test(`Fix round 4 real Worker ${damage} probe outcomes cannot seal complete`, async t => {
  const f = fixture(t); f.core.close(); const config = configured(t, f.path);
  config.options.host.configuration.openingFault = { kind: 'probe', damage };
  let failure; await openingRuntime()(config.options).catch(error => { failure = error; });
  assert.equal(failure?.code, 'index_unavailable');
  const status = await config.supervisor.drain(failure.cleanupId);
  assert.equal(status.state, 'complete'); assert.equal(status.telemetry, 'incomplete');
});

for (const kind of ['native', 'probe']) for (const code of [261, 7])
test(`Fix round 4 real Worker ${kind} SQLite ${code} mapping also applies with diagnostics disabled`, async t => {
  const f = fixture(t); f.core.close(); const config = configured(t, f.path);
  config.options.diagnostics = false; config.options.host.configuration.openingFault = { kind, stage: 'open', code };
  let failure; await openingRuntime()(config.options).catch(error => { failure = error; });
  assert.equal(failure?.code, code === 261 ? 'storage_busy' : 'storage_error');
  assert.equal((await config.supervisor.drain(failure.cleanupId)).telemetry, 'disabled');
});

test('Fix round 4 checkpointed WAL probe retains DELETE-only refusal and native CANTOPEN telemetry', async t => {
  const f = fixture(t); f.core.close();
  const db = new DatabaseSync(f.path); db.exec('PRAGMA journal_mode=WAL'); db.close();
  const config = configured(t, f.path); let failure;
  await config.open().catch(error => { failure = error; });
  assert.equal(failure?.code, 'index_unavailable');
  const status = await config.supervisor.drain(failure.cleanupId);
  assert.equal(status.telemetry, 'complete');
  assert.equal(status.diagnostics.records[0].statement, 'journal_mode');
  assert.equal(status.diagnostics.records[0].sqlite.code, 14);
});

import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore, openMemoryStore } from '../index.mjs';

const namespace = { ownerId: 'rationale-test', scope: 'personal', projectId: null };
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => { assert.equal(r.ok, false, JSON.stringify(r)); if (code) assert.equal(r.error.code, code); };
const receipt = (excerpt, role = 'user') => ({ client: 'private-client', sessionId: 'private-session', eventId: 'private-event', role, excerpt });
const edge = (from, to, relation = 'supports-decision') => ({ from, to, relation, fromReceipt: 0, toReceipt: 0 });
const proposal = () => ({ edges: [edge(1, 0), edge(2, 1, 'challenges-premise')] });
function fixture(t, overrides = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-rationale-')), 'memory.sqlite');
  const requests = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    relate(request) { requests.push(request); return proposal(); }, ...overrides };
  const core = openMemoryCore({ path, model }); const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  const admit = (text, extra = {}) => ok(core.admit({ namespace,
    memory: { content: `INTERPRETATION ${text}`, kind: 'context' }, receipts: [receipt(text)], ...extra })).memory;
  const memories = [admit('I chose A because it supports offline work.'), admit('A supports offline work.'),
    admit('I checked: A cannot work offline.')];
  const refs = memories.map(m => ({ memoryId: m.id, revision: m.revision }));
  const review = (patch = {}) => core.reviewRationale({ namespace, refs, ...patch });
  const inspect = () => core.getRationale({ namespace, ...refs[0] });
  return { core, db, path, model, requests, memories, refs, admit, review, inspect };
}

test('R1 source-only inference, persistent qualified suggestion, original choice unchanged and keyless cold inspection', async t => {
  const f = fixture(t); const before = ok(f.core.get({ namespace, memoryId: f.memories[0].id }));
  assert.equal(ok(await f.review()).inserted, 2);
  const report = ok(f.inspect()); assert.equal(report.status, 'reconfirmation-suggested');
  assert.equal(report.sources.length, 3); assert.equal(report.edges.length, 2);
  assert.ok(report.edges.every(e => e.interpretationStatus === 'model-proposed'));
  assert.deepEqual(ok(f.core.get({ namespace, memoryId: f.memories[0].id })), before);
  const input = JSON.stringify(f.requests[0].input);
  for (const forbidden of ['INTERPRETATION', 'private-client', 'private-session', 'private-event', namespace.ownerId, ...f.memories.map(m => m.id)]) assert.ok(!input.includes(forbidden));
  assert.deepEqual(f.requests[0].input.memories[0], { index: 0, receipts: [{ index: 0, role: 'user', excerpt: 'I chose A because it supports offline work.' }] });
  assert.equal(ok(await f.review()).inserted, 0);
  assert.deepEqual(ok(f.inspect()), report);
  f.core.close(); const cold = openMemoryCore({ path: f.path }); t.after(() => cold.close());
  assert.deepEqual(ok(cold.getRationale({ namespace, ...f.refs[0] })), report);
});

test('R2 empty proposals are unassessed, neither confirmation nor erasure of earlier evidence', async t => {
  const f = fixture(t, { relate: () => ({ edges: [] }) });
  assert.equal(ok(await f.review()).inserted, 0);
  assert.equal(ok(f.inspect()).status, 'unassessed');
  f.model.relate = proposal; ok(await f.review());
  f.model.relate = () => ({ edges: [] }); ok(await f.review());
  assert.equal(ok(f.inspect()).status, 'reconfirmation-suggested');
});

test('R3 strict output and input validation never partially writes', async t => {
  const f = fixture(t);
  for (const output of [null, {}, { edges: [], extra: true }, { edges: [edge(1, 0), edge(2, 9)] },
    { edges: [edge(1, 1, 'challenges-premise')] }, { edges: [edge(1, 0, 'supersedes')] }, { edges: [edge(1, 0), edge(1, 0)] },
    { edges: [{ ...edge(1, 0), fromReceipt: 100 }] }, { edges: [{ ...edge(1, 0), confidence: 1 }] },
    { edges: Array(11).fill(edge(1, 0)) }]) {
    f.model.relate = () => output; error(await f.review(), 'invalid_model_output');
    assert.equal(f.db.prepare('SELECT count(*) n FROM rationale_edges').get().n, 0);
  }
  for (const refs of [[], [f.refs[0], f.refs[0]], Array(7).fill(f.refs[0])]) error(await f.review({ refs }), 'invalid_input');
  error(await f.review({ extra: true }), 'invalid_input');
  error(await f.review({ namespace: { ...namespace, ownerId: 'other' } }), 'memory_not_found');
  error(await f.review({ refs: [{ ...f.refs[0], revision: 999 }, f.refs[1]] }), 'revision_conflict');
  error(f.core.getRationale({ namespace: { ...namespace, ownerId: 'other' }, ...f.refs[0] }), 'memory_not_found');
});

test('R4 provider failure, oversized input/output and missing model never write', async t => {
  const f = fixture(t, { relate() { throw new Error('secret provider body'); } });
  error(await f.review(), 'rationale_failed');
  delete f.model.relate; error(await f.review(), 'model_not_configured');
  f.model.relate = proposal; f.model.countTokens = () => 6001;
  error(await f.review(), 'context_budget_exceeded');
  f.model.countTokens = text => text.includes('"edges"') ? 1025 : 1;
  error(await f.review(), 'invalid_model_output');
  assert.equal(f.db.prepare('SELECT count(*) n FROM rationale_edges').get().n, 0);
});

for (const stage of ['provider', 'output-counter']) test(`R5 ${stage} mutation of even an unselected source prevents all writes`, async t => {
  const f = fixture(t); let changed = false;
  const mutate = () => {
    if (changed) return; changed = true;
    ok(f.core.forget({ namespace, memoryId: f.refs[2].memoryId, expectedRevision: f.refs[2].revision }));
  };
  f.model.relate = () => { if (stage === 'provider') mutate(); return { edges: [edge(1, 0)] }; };
  f.model.countTokens = text => { if (stage === 'output-counter' && text.includes('"edges"')) mutate(); return 1; };
  error(await f.review());
  assert.equal(f.db.prepare('SELECT count(*) n FROM rationale_edges').get().n, 0);
});

for (const action of ['correct', 'forget', 'legacy-correct', 'legacy-forget', 'receipt-update', 'receipt-delete', 'receipt-add', 'revision', 'supersede']) {
  test(`R6 ${action} invalidates incident links without retaining a usable challenge`, async t => {
    const f = fixture(t); ok(await f.review()); const m = f.memories[1];
    if (action === 'correct') ok(f.core.correct({ namespace, memoryId: m.id, expectedRevision: m.revision,
      content: 'A supports only online work.', kind: 'fact', receipt: receipt('A supports only online work.') }));
    if (action === 'forget') ok(f.core.forget({ namespace, memoryId: m.id, expectedRevision: m.revision }));
    if (action.startsWith('legacy')) {
      const store = openMemoryStore({ path: f.path }); t.after(() => store.close());
      const scope = store.scope({ ownerId: namespace.ownerId });
      if (action === 'legacy-forget') scope.forget(m.id, m.revision);
      else scope.correct(m.id, { content: 'A needs a connection.', kind: 'fact', origin: 'explicit', confidence: 1,
        receipt: receipt('A needs a connection.') }, m.revision);
    }
    if (action === 'receipt-update') f.db.prepare('UPDATE receipts SET excerpt = ? WHERE memory_id = ?').run('Changed evidence', m.id);
    if (action === 'receipt-delete') f.db.prepare('DELETE FROM receipts WHERE memory_id = ?').run(m.id);
    if (action === 'receipt-add') f.admit('A supports offline work.', { receipts: [receipt('Additional source')] });
    if (action === 'revision') f.db.prepare('UPDATE memories SET revision = revision + 1 WHERE id = ?').run(m.id);
    if (action === 'supersede') ok(f.core.supersede({ namespace, memoryId: m.id, expectedRevision: m.revision,
      replacement: { content: 'Offline unavailable', kind: 'fact' }, receipts: [receipt('Offline unavailable')] }));
    assert.equal(f.db.prepare('SELECT count(*) n FROM rationale_edges').get().n, 0);
    assert.equal(ok(f.inspect()).status, 'unassessed');
  });
}

test('R7 degree overflow rolls back whole batch and bounded inspection rejects instead of truncating', async t => {
  const f = fixture(t); f.model.relate = () => ({ edges: [edge(1, 0)] });
  for (let i = 0; i < 10; i++) {
    const m = f.admit(`Premise ${i}`);
    ok(await f.review({ refs: [f.refs[0], { memoryId: m.id, revision: m.revision }] }));
  }
  error(f.inspect(), 'rationale_limit');
  const last = f.admit('Overflow premise');
  error(await f.review({ refs: [f.refs[0], { memoryId: last.id, revision: last.revision }] }), 'rationale_limit');
  assert.equal(f.db.prepare('SELECT count(*) n FROM rationale_edges').get().n, 10);
});

test('R8 source digest mismatch rejects inspection and missing citations never become trusted', async t => {
  const f = fixture(t); ok(await f.review());
  f.db.exec("UPDATE rationale_edges SET from_digest = 'wrong'");
  error(f.inspect(), 'revision_conflict');
});

test('R9 schema 11 upgrade preserves previous state and migration failure is atomic', t => {
  const f = fixture(t); f.core.close();
  const removeNewSchema = () => {
    for (const row of f.db.prepare("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'rationale_%'").all()) f.db.exec(`DROP TRIGGER ${row.name}`);
    f.db.exec('DROP TABLE staged_capture_evidence; DROP TABLE staged_capture_clocks; DROP TABLE rationale_edges; PRAGMA user_version=11');
  };
  removeNewSchema();
  const before = f.db.prepare('SELECT * FROM memories ORDER BY id').all();
  const receipts = f.db.prepare('SELECT * FROM receipts ORDER BY id').all();
  const identity = f.db.prepare('SELECT * FROM store_metadata').all();
  f.db.exec('CREATE TABLE rationale_edges (collision TEXT)');
  assert.throws(() => openMemoryCore({ path: f.path }));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 11);
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE type='trigger' AND name LIKE 'rationale_%'").get().n, 0);
  f.db.exec('DROP TABLE rationale_edges');
  const migrated = openMemoryCore({ path: f.path }); t.after(() => migrated.close());
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 13);
  assert.deepEqual(f.db.prepare('SELECT * FROM memories ORDER BY id').all(), before);
  assert.deepEqual(f.db.prepare('SELECT * FROM receipts ORDER BY id').all(), receipts);
  assert.deepEqual(f.db.prepare('SELECT * FROM store_metadata').all(), identity);
});

test('R10 complete retained sources fail the character bound, never silently truncate or call the model', async t => {
  const f = fixture(t);
  for (let i = 0; i < 32; i++) f.admit('I chose A because it supports offline work.', {
    receipts: [receipt(`${i}: ${'a'.repeat(760)}`)],
  });
  const memory = ok(f.core.get({ namespace, memoryId: f.refs[0].memoryId })).memory;
  const root = { memoryId: memory.id, revision: memory.revision };
  error(f.core.getRationale({ namespace, ...root }), 'context_item_too_large');
  error(await f.review({ refs: [root, f.refs[1]] }), 'context_item_too_large');
  assert.equal(f.requests.length, 0);
});

test('R11 actual synthetic-clock timeout aborts without writes or leaking diagnostics content', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let started; let signal;
  const reached = new Promise(resolve => { started = resolve; }); const diagnostics = [];
  const f = fixture(t, { relate(request) { signal = request.signal; started(); return new Promise(() => {}); },
    onDiagnostic: event => diagnostics.push(event) });
  const pending = f.review(); await reached;
  t.mock.timers.tick(29999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1); error(await pending, 'model_timeout'); assert.equal(signal.aborted, true);
  assert.deepEqual(diagnostics, [{ version: 1, stage: 'relate', layer: 'core_call', reason: 'model_timeout' }]);
  assert.equal(f.db.prepare('SELECT count(*) n FROM rationale_edges').get().n, 0);
});

test('R12 a single receipt can record both decision and reason without manufacturing another memory', async t => {
  const f = fixture(t, { relate: () => ({ edges: [edge(0, 0), edge(1, 0, 'challenges-premise')] }) });
  ok(await f.review({ refs: [f.refs[0], f.refs[2]] }));
  const report = ok(f.inspect()); assert.equal(report.status, 'reconfirmation-suggested');
  assert.equal(report.sources.length, 2); assert.equal(report.edges.length, 2);
  assert.equal(report.edges[0].from, report.edges[0].to);
  assert.equal(report.edges[0].fromReceipt, report.edges[0].toReceipt);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 3);
});

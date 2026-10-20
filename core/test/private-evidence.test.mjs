import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { stripOrganizationFixture } from '../testing/private-organization-fixture.mjs';

const ns = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'evidence' };
const other = { ...ns, projectId: 'other' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
function trustedHost() {
  const tokens = new WeakMap(), grants = new WeakMap();
  const state = { generation: 1, enabled: true, hook: null, calls: 0 };
  const authority = {
    authorize(request, token) {
      const expected = tokens.get(token);
      if (!state.enabled || !expected || expected.method !== request.method || !isDeepStrictEqual(expected.input, request.input)) return null;
      const grant = {}, { input, ...binding } = request;
      grants.set(grant, binding); return grant;
    },
    isCurrent(grant) {
      state.hook?.(++state.calls);
      return state.enabled && grants.has(grant) ? { ...grants.get(grant), accessGeneration: state.generation } : null;
    },
  };
  return { state, options: { version: 'private-cards-local-v1', source: 'submitted-note-v1',
    storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1', authority },
  token(method, input) { const token = {}; tokens.set(token, { method, input: structuredClone(input) }); return token; } };
}
function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'private-evidence-' });
  const path = join(workspace.path, 'memory.sqlite'), host = trustedHost();
  let core = openMemoryCore({ path, privateCards: host.options });
  workspace.defer(() => core.close());
  return { path, host, get core() { return core; },
    call(method, input) { return core[method](input, host.token(method, input)); },
    reopen(enabled = true) { core.close(); core = openMemoryCore({ path, ...(enabled ? { privateCards: host.options } : {}) }); },
    db() { const db = new DatabaseSync(path); workspace.defer(() => db.close()); return db; } };
}
const receipt = (eventId, excerpt) => ({ client: 'synthetic', sessionId: 'session', eventId, role: 'user', excerpt });
function admit(f, content = 'tea evidence', namespace = ns, eventId = content) {
  const value = ok(f.core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [receipt(eventId, content)] })).memory;
  return { type: 'memory', namespace, memoryId: value.id, revision: value.revision };
}
function makeCard(f, key = 'one', body = 'tea evidence Card') {
  const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: `draft-${key}`, drafting: 'authored',
    input: { title: `Tea ${key}`, body, authoredInput: { text: `note ${key}`, occurredAt: null } } }));
  const confirmed = ok(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: `confirm-${key}` }));
  return { type: 'card', namespace: ns, cardId: draft.id, revision: confirmed.revision, bodyRevision: confirmed.bodyRevision };
}
function review(f, ref, applicability = 'current', actionId = `review-${ref.cardId}-${ref.revision}`) {
  const card = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  const changed = ok(f.call('editKnowledgeCard', { namespace: ns, cardId: ref.cardId,
    expectedRevision: card.revision, actionId, title: card.title, body: card.body,
    bindings: card.bindings.map(binding => binding.source), applicability }));
  return { ...ref, revision: changed.revision, bodyRevision: changed.bodyRevision };
}
const select = (options = {}) => ({ namespace: ns, query: 'tea evidence', types: ['memory', 'card'], intent: 'current', ...options });
const fetch = (refs, intent = 'current', options = {}) => ({ namespace: ns, refs, intent, ...options });

test('R02 explicit optional confirmation review is atomic and defaults to unknown', t => {
  const f = fixture(t);
  for (const applicability of ['current', 'historical', undefined]) {
    const key = applicability ?? 'omitted';
    const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: `draft-${key}`, drafting: 'authored',
      input: { title: 'Tea', body: 'tea evidence', authoredInput: { text: 'note', occurredAt: null } } }));
    const input = { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: `confirm-${key}`,
      ...(applicability === undefined ? {} : { applicability }) };
    error(f.call('confirmCardDraft', { ...input, applicability: 'truth' }), 'invalid_input');
    ok(f.call('confirmCardDraft', input));
    const card = ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card;
    assert.equal(card.support.applicability, applicability ?? 'unknown');
    assert.equal(card.support.applicabilityReviewedRevision, applicability === undefined ? null : 2);
  }
  assert.equal(ok(f.call('selectEvidence', select({ types: ['card'] }))).items.length, 1);
});

test('R01 optional facade requires opaque exact-payload read authority and strict bounded inputs', t => {
  const f = fixture(t), ref = admit(f), request = select();
  error(f.core.selectEvidence(request), 'authority_required');
  error(f.core.selectEvidence(request, { humanConfirmed: true }), 'authority_required');
  error(f.core.selectEvidence({ ...request, intent: 'history' }, f.host.token('selectEvidence', request)), 'authority_required');
  for (const extra of [{ query: '' }, { query: 'x'.repeat(4001) }, { types: ['memory', 'memory'] },
    { types: [] }, { limit: 25 }, { scanRows: 1025 }, { scanBodyUnits: 2_000_001 }, { deadlineMs: 5001 },
    { humanConfirmed: true }, { readSet: [ns] }]) error(f.call('selectEvidence', { ...request, ...extra }), 'invalid_input');
  error(f.call('fetchEvidence', fetch([{ ...ref, namespace: other }])), 'scope_changed');
  error(f.call('fetchEvidence', fetch([ref, ref])), 'invalid_input');
  f.reopen(false); assert.equal(f.core.selectEvidence, undefined); assert.equal(f.core.fetchEvidence, undefined);
  f.reopen(); assert.equal(ok(f.call('fetchEvidence', fetch([ref]))).items[0].content, 'tea evidence');
});

test('R02 applicability requires exact reviewed revision and cannot make unavailable sources current', t => {
  const f = fixture(t); let ref = makeCard(f);
  assert.equal(ok(f.call('selectEvidence', select())).items.length, 0);
  for (const applicability of ['historical', 'conflict', 'unknown']) {
    ref = review(f, ref, applicability);
    assert.equal(ok(f.call('selectEvidence', select())).items.length, 0);
  }
  ref = review(f, ref);
  const selected = ok(f.call('selectEvidence', select()));
  assert.deepEqual(selected.items[0].ref, ref);
  assert.equal(selected.items[0].support.applicabilityReviewedRevision, ref.revision);
  const card = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  const source = card.bindings[0].source;
  ok(f.call('deleteSourceNote', { namespace: ns, sourceId: source.sourceId, expectedRevision: 1, actionId: 'delete-source' }));
  const unsupported = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  assert.equal(unsupported.support.applicability, 'unknown');
  assert.equal(unsupported.support.applicabilityReviewedRevision, null);
  ref = review(f, { ...ref, revision: unsupported.revision });
  assert.equal(ok(f.call('selectEvidence', select())).items.length, 0);
  error(f.call('fetchEvidence', fetch([ref])), 'evidence_unavailable');
  const historical = ok(f.call('fetchEvidence', fetch([ref], 'history'))).items[0];
  assert.equal(historical.body, card.body); assert.equal(historical.provenance.support, 'unavailable');
  assert.equal(JSON.stringify(historical).includes('note one'), false);
});

test('R03 fair type interleaving shares row/body budgets and cursors bind settings, scope and generations', t => {
  const f = fixture(t);
  for (let i = 0; i < 4; i++) { admit(f, `tea evidence ${i}`); review(f, makeCard(f, `${i}`)); }
  admit(f, 'tea evidence foreign', other);
  const request = select({ scanRows: 2, limit: 24 });
  const first = ok(f.call('selectEvidence', request));
  assert.equal(first.coverage.scannedRows, 2);
  assert.equal(first.coverage.byType.memory.scanned, 1); assert.equal(first.coverage.byType.card.scanned, 1);
  assert.equal(first.coverage.byType.memory.partial, true); assert.equal(first.coverage.byType.card.partial, true);
  assert.equal(first.items.some(item => item.ref.namespace.projectId === 'other'), false);
  assert.equal(JSON.stringify(first.items).includes('tea evidence 0'), false);
  const seen = new Set(first.items.map(item => item.ref.memoryId ?? item.ref.cardId));
  let cursor = first.nextCursor;
  while (cursor) {
    const next = ok(f.call('selectEvidence', { ...request, cursor }));
    for (const item of next.items) { const id = item.ref.memoryId ?? item.ref.cardId; assert.equal(seen.has(id), false); seen.add(id); }
    cursor = next.nextCursor;
  }
  assert.equal(seen.size, 8);
  error(f.call('selectEvidence', { ...request, limit: 23, cursor: first.nextCursor }), 'invalid_cursor');
  error(f.call('selectEvidence', { ...request, namespace: other, cursor: first.nextCursor }), 'invalid_cursor');
  error(f.call('selectEvidence', { ...request, cursor: `${first.nextCursor}x` }), 'invalid_cursor');
  f.host.state.generation++;
  error(f.call('selectEvidence', { ...request, cursor: first.nextCursor }), 'cursor_stale');
  f.host.state.generation--;
  admit(f, 'new tea evidence');
  error(f.call('selectEvidence', { ...request, cursor: first.nextCursor }), 'cursor_stale');
});

test('R03 Unicode literal words and honest partial body coverage; no semantic matching', t => {
  const f = fixture(t);
  const ref = admit(f, 'CAFÉ 藍色 測試');
  review(f, makeCard(f, 'long', 'tea ' + 'x'.repeat(19000)));
  const result = ok(f.call('selectEvidence', select({ query: 'café', scanBodyUnits: 100 })));
  assert.deepEqual(result.items[0].ref, ref); assert.equal(result.items[0].score, 1);
  assert.equal(result.coverage.byType.memory.partial, false);
  assert.equal(result.coverage.byType.card.partial, true);
  assert.equal(result.coverage.reason, 'body_budget');
  assert.ok(result.coverage.scannedBodyUnits <= 100);
  assert.equal(ok(f.call('selectEvidence', select({ query: 'coffee', types: ['memory'] }))).items.length, 0);
  assert.equal(ok(f.call('selectEvidence', select({ query: '藍色', types: ['memory'] }))).items.length, 1);
});

test('R03 scan deadline reports a bounded partial prefix instead of complete coverage', t => {
  const f = fixture(t), db = f.db(), timestamp = '2026-10-20T00:00:00.000Z';
  const insert = db.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,
    content,kind,origin,confidence,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,'fact','explicit',1,1,?,?)`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (let index = 0; index < 1024; index++) {
      const id = `deadline-${String(index).padStart(4, '0')}`;
      insert.run(id, ns.ownerId, ns.scope, ns.projectId, id, 'synthetic unrelated body', timestamp, timestamp);
    }
    db.exec('COMMIT');
  } catch (cause) { db.exec('ROLLBACK'); throw cause; }
  const result = ok(f.call('selectEvidence', select({ query: 'absent', types: ['memory'],
    scanRows: 1024, deadlineMs: 1 })));
  assert.equal(result.coverage.status, 'budget_exhausted');
  assert.equal(result.coverage.reason, 'deadline');
  assert.equal(result.coverage.byType.memory.partial, true);
  assert.ok(result.coverage.scannedRows < 1024);
  assert.ok(result.nextCursor);
});

test('R04 canonical filed/unfiled Memory enumeration and qualified history omit purged content', t => {
  const f = fixture(t), first = admit(f, 'tea old evidence'), current = admit(f, 'tea current evidence');
  const db = f.db();
  db.prepare("UPDATE memories SET filing_status='filed' WHERE id=?").run(current.memoryId);
  db.prepare("UPDATE memories SET review_state='awaiting',revision=revision+1 WHERE id=?").run(first.memoryId);
  const awaiting = { ...first, revision: 2 };
  let result = ok(f.call('selectEvidence', select({ types: ['memory'] })));
  assert.deepEqual(result.items.map(item => item.ref.memoryId), [current.memoryId]);
  assert.equal(result.items[0].filing.status, 'filed');
  error(f.call('fetchEvidence', fetch([awaiting])), 'evidence_unavailable');
  assert.equal(ok(f.call('fetchEvidence', fetch([awaiting], 'history'))).items[0].reviewState, 'awaiting');
  db.prepare("UPDATE memories SET review_state='none',currentness='historical',revision=revision+1 WHERE id=?").run(first.memoryId);
  result = ok(f.call('selectEvidence', select({ types: ['memory'], intent: 'history' })));
  assert.equal(result.items.length, 2); assert.equal(result.items.some(item => item.state === 'historical'), true);
  ok(f.core.forget({ namespace: ns, memoryId: first.memoryId, expectedRevision: 3 }));
  result = ok(f.call('selectEvidence', select({ types: ['memory'], intent: 'history' })));
  assert.equal(result.items.length, 1);
  error(f.call('fetchEvidence', fetch([{ ...first, revision: 4 }], 'history')), 'evidence_unavailable');
});

test('R05 fetch exact versions, distinguishable types, bounded provenance and whole response', t => {
  const f = fixture(t), memory = admit(f), card = review(f, makeCard(f));
  const result = ok(f.call('fetchEvidence', fetch([memory, card])));
  assert.equal(result.items[0].type, 'memory'); assert.equal(result.items[1].type, 'card');
  assert.equal(result.items[0].content, 'tea evidence'); assert.equal(result.items[1].body, 'tea evidence Card');
  assert.equal(result.items[0].provenance.sources[0].type, 'receipt');
  assert.equal(result.items[0].provenance.completeness, 'excerpt-only');
  assert.equal(result.items[0].provenance.conversationCoverage, 'unknown');
  assert.equal(result.items[0].provenance.corroboration, 'not-assessed');
  assert.equal(Object.hasOwn(result.items[0].provenance.sources[0], 'excerpt'), false);
  assert.equal(result.items[0].qualification, null);
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: result })) <= 65536);
  error(f.call('fetchEvidence', fetch([memory], 'current', { responseByteLimit: 1 })), 'context_item_too_large');
  error(f.call('fetchEvidence', fetch([{ ...memory, revision: 9 }])), 'revision_conflict');
  error(f.call('fetchEvidence', fetch([{ ...card, bodyRevision: 9 }])), 'revision_conflict');
  for (let i = 0; i < 5; i++) ok(f.core.admit({ namespace: ns, memory: { content: 'tea evidence', kind: 'fact' },
    receipts: [0, 1, 2, 3].map(index => receipt(`additional-${i}-${index}`, `retained excerpt ${i}-${index}`)) }));
  const latest = ok(f.core.get({ namespace: ns, memoryId: memory.memoryId })).memory;
  const many = ok(f.call('fetchEvidence', fetch([{ ...memory, revision: latest.revision }]))).items[0];
  assert.equal(many.provenance.sources.length, 16); assert.equal(many.provenance.coverage.status, 'budget_exhausted');
  assert.equal(many.provenance.coverage.omitted, null);
});

test('R06 snapshots reject later changes, wrong store/scope, tampering and changed read grants', t => {
  const f = fixture(t), ref = admit(f), result = ok(f.call('fetchEvidence', fetch([ref])));
  let fresh = ok(f.call('revalidateEvidence', { namespace: ns, snapshot: result.snapshot }));
  assert.deepEqual(fresh.items, result.items);
  assert.equal(JSON.stringify(Buffer.from(result.snapshot.split('.')[0], 'base64url').toString()).includes('tea evidence'), false);
  error(f.call('revalidateEvidence', { namespace: other, snapshot: result.snapshot }), 'invalid_snapshot');
  error(f.call('revalidateEvidence', { namespace: ns, snapshot: `${result.snapshot}x` }), 'invalid_snapshot');
  const second = fixture(t);
  error(second.call('revalidateEvidence', { namespace: ns, snapshot: result.snapshot }), 'invalid_snapshot');
  f.host.state.generation++;
  error(f.call('revalidateEvidence', { namespace: ns, snapshot: result.snapshot }), 'snapshot_stale');
  f.host.state.generation--;
  f.reopen(); fresh = ok(f.call('revalidateEvidence', { namespace: ns, snapshot: result.snapshot }));
  assert.deepEqual(fresh.items, result.items);
  const selectResult = ok(f.call('selectEvidence', select({ types: ['memory'] })));
  ok(f.core.correct({ namespace: ns, memoryId: ref.memoryId, expectedRevision: 1,
    content: 'tea corrected evidence', kind: 'fact', receipt: receipt('correction', 'tea corrected evidence') }));
  error(f.call('revalidateEvidence', { namespace: ns, snapshot: result.snapshot }), 'snapshot_stale');
  error(f.call('revalidateEvidence', { namespace: ns, snapshot: selectResult.snapshot }), 'snapshot_stale');
  error(f.call('fetchEvidence', fetch([ref])), 'revision_conflict');
});

test('R06 final authority callbacks cannot return stale selected/fetched/revalidated bodies', t => {
  const f = fixture(t), ref = admit(f), fetched = ok(f.call('fetchEvidence', fetch([ref])));
  f.host.state.calls = 0;
  f.host.state.hook = count => { if (count === 2) ok(f.core.forget({ namespace: ns, memoryId: ref.memoryId, expectedRevision: 1 })); };
  error(f.call('revalidateEvidence', { namespace: ns, snapshot: fetched.snapshot }), 'snapshot_stale');
  f.host.state.hook = null;
  assert.equal(ok(f.call('selectEvidence', select())).items.length, 0);
  error(f.call('fetchEvidence', fetch([ref])), 'evidence_unavailable');
  f.host.state.calls = 0; f.host.state.hook = count => { if (count === 2) f.host.state.enabled = false; };
  error(f.call('selectEvidence', select()), 'scope_changed');
});

test('R07 opt-in latest schema and feature-off reopening preserve authored data and reset stale reviews', t => {
  const f = fixture(t), ref = review(f, makeCard(f));
  const db = f.db(); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
  f.reopen(false); assert.equal(f.core.getPrivateCardCapabilities, undefined); f.reopen();
  assert.equal(ok(f.call('fetchEvidence', fetch([ref]))).items.length, 1);
  // Existing source invalidation increments revision; reviews never follow it.
  const card = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  assert.equal(card.support.applicabilityReviewedRevision, ref.revision);
  assert.equal(db.prepare('SELECT count(*) n FROM card_applicability_reviews').get().n, 1);
});

test('R07 v18/v20/v21 opt-in migrations preserve exact existing note/Card content', t => {
  const f = fixture(t), ref = makeCard(f), card = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  let db = f.db();
  f.core.close();
  stripOrganizationFixture(db);
  db.exec('DROP TABLE card_applicability_reviews; PRAGMA user_version=21');
  f.reopen(false); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 21);
  f.reopen(); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card, card);
  f.core.close();
  stripOrganizationFixture(db);
  db.exec('DROP TABLE card_applicability_reviews; DROP TRIGGER card_memory_revision_invalidation; DROP TRIGGER card_memory_purge; DROP TABLE card_memory_bindings; PRAGMA user_version=20');
  f.reopen(false); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 20);
  f.reopen(); assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card, card);
  const workspace = createTestWorkspace(t), path = join(workspace.path, 'v18.sqlite');
  let core = openMemoryCore({ path }); core.close();
  db = new DatabaseSync(path); workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 18);
  core = openMemoryCore({ path, privateCards: f.host.options }); workspace.defer(() => core.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 23);
});

test('R08 retained receipt to reviewed current Card to feature-off correction/forget and qualified history', t => {
  const f = fixture(t), memory = admit(f), draft = ok(f.call('createCardDraft', {
    namespace: ns, actionId: 'from-memory', drafting: 'authored', input: { title: 'Tea Card',
      body: 'tea authored conclusion', sourcePolicy: 'retained-receipts-v1', memoryRefs: [memory] } }));
  const second = ok(f.call('createCardDraft', { namespace: ns, actionId: 'second-draft', drafting: 'authored',
    input: { title: 'Second', body: 'tea second', sourcePolicy: 'retained-receipts-v1', memoryRefs: [memory] } }));
  const confirmed = ok(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id,
    expectedRevision: 1, actionId: 'confirm-memory', applicability: 'current' }));
  const ref = { type: 'card', namespace: ns, cardId: draft.id, revision: confirmed.revision, bodyRevision: 1 };
  const selected = ok(f.call('selectEvidence', select({ query: 'tea', types: ['card'] })));
  assert.deepEqual(selected.items[0].ref, ref);
  const fetched = ok(f.call('fetchEvidence', fetch([memory, ref])));
  assert.equal(fetched.items[1].bindings[0].dependency, 'memory-interpretation');
  assert.equal(fetched.items[1].provenance.completeness, 'excerpt-only');
  assert.equal(ok(f.call('revalidateEvidence', { namespace: ns, snapshot: fetched.snapshot })).items.length, 2);
  f.reopen(false);
  const corrected = ok(f.core.correct({ namespace: ns, memoryId: memory.memoryId, expectedRevision: 1,
    content: 'new tea interpretation', kind: 'fact', receipt: receipt('corrected', 'retained correction') })).memory;
  f.reopen();
  assert.equal(ok(f.call('getCard', { namespace: ns, cardId: second.id })).card, null);
  assert.equal(ok(f.call('selectEvidence', select({ query: 'tea', types: ['card'] }))).items.length, 0);
  error(f.call('revalidateEvidence', { namespace: ns, snapshot: fetched.snapshot }), 'snapshot_stale');
  const old = ok(f.call('getCard', { namespace: ns, cardId: draft.id })).card;
  assert.equal(old.support.status, 'unavailable'); assert.equal(old.support.applicability, 'unknown');
  const historical = ok(f.call('fetchEvidence', fetch([{ ...ref, revision: old.revision }], 'history'))).items[0];
  assert.equal(historical.body, 'tea authored conclusion'); assert.equal(historical.provenance.support, 'unavailable');
  assert.equal(JSON.stringify(historical).includes('retained correction'), false);
  f.reopen(false); ok(f.core.forget({ namespace: ns, memoryId: memory.memoryId, expectedRevision: corrected.revision }));
  f.reopen();
  const afterForget = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  const history = ok(f.call('selectEvidence', select({ query: 'tea', intent: 'history' })));
  assert.equal(history.items.length, 1); assert.equal(history.items[0].type, 'card');
  assert.equal(history.items[0].ref.revision, afterForget.revision);
  error(f.call('getSource', { namespace: ns, source: historical.bindings[0].source }), 'source_unavailable');
});

test('R08 fresh process verifies durable snapshot and qualified retained history without a model', t => {
  const f = fixture(t), ref = review(f, makeCard(f)), result = ok(f.call('fetchEvidence', fetch([ref], 'history')));
  const modulePath = new URL('../contract.mjs', import.meta.url).href;
  const code = `import {openMemoryCore} from ${JSON.stringify(modulePath)};
    const grants=new WeakMap(), token={};
    const core=openMemoryCore({path:process.argv[1],privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',
      storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority:{
        authorize(request,authority){if(authority!==token)return null;const grant={};const {input,...binding}=request;grants.set(grant,binding);return grant},
        isCurrent(grant){return {...grants.get(grant),accessGeneration:1}}
      }}});
    try{const result=core.revalidateEvidence({namespace:JSON.parse(process.argv[2]),snapshot:process.argv[3]},token);
      if(!result.ok||result.value.items[0].body!=='tea evidence Card')process.exitCode=1;
      console.log(JSON.stringify({ok:result.ok,type:result.value?.items[0].type}));}finally{core.close()}`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, f.path, JSON.stringify(ns), result.snapshot],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
  assert.equal(child.status, 0, `${child.error ?? ''}\n${child.stdout}\n${child.stderr}`);
  assert.equal(JSON.parse(child.stdout.trim()).ok, true);
});

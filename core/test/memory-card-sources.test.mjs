import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { batch, digest, ns as episodeNs } from '../testing/episode-helpers.mjs';
import { stripOrganizationFixture } from '../testing/private-organization-fixture.mjs';

const ns = { ownerId: 'memory-card-owner', scope: 'personal', projectId: null };
const foreign = { ...ns, ownerId: 'foreign' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
const receipt = (id, text = `Retained excerpt ${id}.`) => ({ client: 'synthetic', sessionId: 'session',
  eventId: id, role: 'user', excerpt: text });
const memoryRef = (memory, namespace = ns) => ({ type: 'memory', namespace,
  memoryId: memory.id, revision: memory.revision });
const draftInput = (memories, actionId = 'draft', namespace = ns) => ({ namespace, actionId, drafting: 'authored',
  input: { sourcePolicy: 'retained-receipts-v1', memoryRefs: memories.map(m => memoryRef(m, namespace)),
    title: 'Authored title', body: 'Independent private authored body.' } });
function fixture(t) {
  const ws = createTestWorkspace(t, { prefix: 'memory-card-sources-' }), path = join(ws.path, 'store.sqlite');
  const tokens = new WeakMap(), grants = new WeakMap(), host = { checks: 0, hook: null };
  const privateCards = { version: 'private-cards-local-v1', source: 'submitted-note-v1',
    storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1', authority: {
      authorize(request, token) {
        const expected = tokens.get(token);
        if (!expected || expected.method !== request.method || !isDeepStrictEqual(expected.input, request.input)) return null;
        const grant = {}, { input, ...binding } = request;
        grants.set(grant, { ...binding, accessGeneration: 1 }); return grant;
      },
      isCurrent(grant) { host.hook?.(++host.checks); return grants.get(grant) ?? null; },
    } };
  const core = openMemoryCore({ path, privateCards }); ws.defer(() => core.close());
  const db = new DatabaseSync(path); ws.defer(() => db.close());
  function call(method, input, target = core) {
    const token = {}; tokens.set(token, { method, input: structuredClone(input) }); return target[method](input, token);
  }
  function admit(id = 'one', count = 1, namespace = ns) {
    let saved;
    for (let index = 0; index < count; index++) saved = ok(core.admit({ namespace,
      memory: { content: `Memory interpretation ${id}.`, kind: 'context' },
      receipts: [receipt(`${id}-${index}`)] })).memory;
    return saved;
  }
  const inspect = id => ok(call('getCard', { namespace: ns, cardId: id })).card;
  return { core, db, ws, path, privateCards, call, admit, inspect, host,
    off() { const value = openMemoryCore({ path }); ws.defer(() => value.close()); return value; } };
}

test('L01/L02 explicit receipt mode resolves every actual receipt with zero model configuration', t => {
  const f = fixture(t), memory = f.admit('many', 3);
  const draft = ok(f.call('createCardDraft', draftInput([memory])));
  const detail = f.inspect(draft.id);
  const actual = ok(f.core.get({ namespace: ns, memoryId: memory.id })).receipts;
  assert.deepEqual(detail.bindings.map(b => b.receiptId).sort(), actual.map(r => r.id).sort());
  for (const binding of detail.bindings) {
    assert.equal(binding.dependency, 'memory-interpretation'); assert.equal(binding.role, 'required');
    assert.deepEqual(binding.memoryRef, memoryRef(memory));
    assert.equal(binding.source.memoryRevision, memory.revision);
    assert.equal(binding.source.completeness, 'excerpt-only');
    assert.equal(binding.source.revision, undefined);
    const read = ok(f.call('getSource', { namespace: ns, source: binding.source }));
    assert.equal(read.parts.map(p => p.text).join(''), actual.find(r => r.id === binding.receiptId).excerpt);
    assert.equal(read.coverage.completeness, 'excerpt-only'); assert.equal(read.coverage.conversationCoverage, 'unknown');
  }
  assert.equal(ok(f.call('getPrivateCardUsage', { namespace: ns })).submittedNoteBytes, 0);
  const capabilities = ok(f.core.getPrivateCardCapabilities());
  assert.deepEqual(capabilities.memorySourcePolicies, ['retained-receipts-v1']); assert.equal(capabilities.raw, false);
  const implicit = draftInput([memory], 'implicit'); delete implicit.input.sourcePolicy;
  error(f.call('createCardDraft', implicit), 'invalid_input');
  error(f.call('createCardDraft', { ...implicit, input: { title: 'x', body: 'x', sources: [detail.bindings[0].source] } }), 'source_unavailable');
});

test('L02 complete receipt/Memory bounds refuse atomically without a convenient prefix', t => {
  const f = fixture(t), memories = Array.from({ length: 6 }, (_, i) => f.admit(`memory-${i}`, i < 4 ? 3 : 2));
  const draft = ok(f.call('createCardDraft', draftInput(memories, 'six')));
  assert.equal(f.inspect(draft.id).bindings.length, 16);
  const updated = ok(f.core.admit({ namespace: ns, memory: { content: 'Memory interpretation memory-5.', kind: 'context' },
    receipts: [receipt('seventeenth')] })).memory;
  error(f.call('createCardDraft', draftInput([...memories.slice(0, 5), updated], 'over')), 'source_unavailable');
  const seventh = f.admit('seventh');
  error(f.call('createCardDraft', draftInput([...memories, seventh], 'seven')), 'invalid_input');
  error(f.call('createCardDraft', draftInput([seventh, seventh], 'duplicate')), 'invalid_input');
  f.db.prepare('DELETE FROM receipts WHERE memory_id=?').run(seventh.id);
  error(f.call('createCardDraft', draftInput([seventh], 'empty')), 'source_unavailable');
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n, 1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_notes').get().n, 0);
});

test('L02/L03 foreign, stale, historical, awaiting, deleted and tampered refs refuse', t => {
  const f = fixture(t), memory = f.admit(), draft = ok(f.call('createCardDraft', draftInput([memory])));
  const source = f.inspect(draft.id).bindings[0].source;
  for (const tampered of [{ ...source, contentIdentity: 'a'.repeat(43) }, { ...source, memoryRevision: 2 },
    { ...source, namespace: foreign }, { ...source, receiptId: 'missing' }, { ...source, completeness: 'provided-note' }]) {
    error(f.call('getSource', { namespace: ns, source: tampered }), 'source_unavailable');
  }
  const other = fixture(t);
  error(other.call('getSource', { namespace: ns, source }), 'source_unavailable');
  const foreignInput = draftInput([memory], 'foreign'); foreignInput.input.memoryRefs[0].namespace = foreign;
  error(f.call('createCardDraft', foreignInput), 'source_unavailable');
  for (const [column, value] of [['review_state', 'awaiting'], ['currentness', 'historical']]) {
    f.db.prepare(`UPDATE memories SET ${column}=? WHERE id=?`).run(value, memory.id);
    error(f.call('createCardDraft', draftInput([memory], column)), 'source_unavailable');
    f.db.prepare(`UPDATE memories SET ${column}=? WHERE id=?`).run(column === 'review_state' ? 'none' : 'current', memory.id);
  }
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: 1 }));
  error(f.call('createCardDraft', draftInput([memory], 'deleted')), 'source_unavailable');
  error(f.call('getSource', { namespace: ns, source }), 'source_unavailable');
});

test('L04/L05/L06 feature-off correction invalidates once, preserves authored body, supports explicit rebind and replay', t => {
  const f = fixture(t), memory = f.admit(), original = draftInput([memory]);
  const draft = ok(f.call('createCardDraft', original));
  const confirmed = ok(f.call('createCardDraft', draftInput([memory], 'confirmed')));
  ok(f.call('confirmCardDraft', { namespace: ns, cardId: confirmed.id, expectedRevision: 1, actionId: 'confirm' }));
  const oldSource = f.inspect(confirmed.id).bindings[0].source;
  const note = ok(f.call('createCardDraft', { namespace: ns, actionId: 'note', drafting: 'authored',
    input: { title: 'Note', body: 'Independent note Card', authoredInput: { text: 'Independent note source', occurredAt: null } } }));
  const elsewhere = f.admit('elsewhere', 1, { ...ns, scope: 'project', projectId: 'other' });
  const other = ok(f.call('createCardDraft', draftInput([elsewhere], 'other', { ...ns, scope: 'project', projectId: 'other' })));
  const off = f.off();
  const corrected = ok(off.correct({ namespace: ns, memoryId: memory.id, expectedRevision: 1,
    content: 'Revised interpretation.', kind: 'context', receipt: receipt('revised', 'Revised exact source.') })).memory;
  const invalidations = f.db.prepare("SELECT * FROM card_effects WHERE kind='evidence_invalidated'").all();
  assert.equal(invalidations.length, 2);
  assert.deepEqual([...new Set(invalidations.map(effect => effect.action_id))], [`memory-revision-${memory.id}-2`]);
  assert.equal(f.inspect(draft.id), null); assert.equal(f.inspect(note.id).state, 'draft');
  const retained = f.inspect(confirmed.id);
  assert.equal(retained.revision, 3); assert.equal(retained.body, original.input.body); assert.equal(retained.support.status, 'unavailable');
  assert.deepEqual(retained.bindings[0].source, oldSource);
  assert.equal(ok(f.call('getCard', { namespace: elsewhere.namespace ?? { ...ns, scope: 'project', projectId: 'other' }, cardId: other.id })).card.state, 'draft');
  error(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'late' }), 'revision_conflict');
  assert.deepEqual(ok(f.call('createCardDraft', original)), draft);
  assert.deepEqual(f.db.prepare("SELECT * FROM card_effects WHERE kind='evidence_invalidated'").all(), invalidations);
  error(f.call('getSource', { namespace: ns, source: oldSource }), 'source_unavailable');
  const edit = { namespace: ns, cardId: retained.id, expectedRevision: retained.revision, actionId: 'edit-unsupported',
    title: 'Retained authored title', body: retained.body, applicability: 'unknown', bindings: [oldSource] };
  const edited = ok(f.call('editKnowledgeCard', edit)); assert.equal(f.inspect(edited.id).support.status, 'unavailable');
  const fresh = ok(f.call('createCardDraft', draftInput([corrected], 'resolve-fresh')));
  const freshRefs = f.inspect(fresh.id).bindings.map(b => b.source);
  ok(f.call('editKnowledgeCard', { ...edit, expectedRevision: edited.revision, actionId: 'review-rebind', bindings: freshRefs }));
  assert.equal(f.inspect(confirmed.id).support.status, 'eligible');
  ok(f.call('cancelCardDraft', { namespace: ns, cardId: fresh.id, expectedRevision: 1, actionId: 'cancel-fresh' }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings WHERE card_id=?').get(fresh.id).n, 0);
  ok(off.forget({ namespace: ns, memoryId: corrected.id, expectedRevision: corrected.revision }));
  assert.equal(f.inspect(confirmed.id).support.status, 'unavailable');
  const metadata = JSON.stringify(f.db.prepare('SELECT * FROM card_memory_bindings').all()) +
    JSON.stringify(ok(f.call('listCardEffects', { namespace: ns, limit: 50 })));
  assert.ok(!metadata.includes('Revised exact source.')); assert.ok(!metadata.includes(memory.content ?? 'Memory interpretation one.'));
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n, 0);
});

for (const mutation of ['remember', 'legacy-correct', 'legacy-forget', 'supersede', 'filing', 'reject']) {
  test(`L04/L05 every canonical revision path invalidates: ${mutation}`, t => {
    const f = fixture(t), memory = f.admit(), draft = ok(f.call('createCardDraft', draftInput([memory])));
    const legacy = openMemoryStore({ path: f.path }); f.ws.defer(() => legacy.close());
    const scope = legacy.scope({ ownerId: ns.ownerId });
    if (mutation === 'remember') scope.remember({ content: 'Memory interpretation one.', kind: 'context', receipt: receipt('added') });
    if (mutation === 'legacy-correct') scope.correct(memory.id, { content: 'Changed legacy', kind: 'context', receipt: receipt('changed') }, 1);
    if (mutation === 'legacy-forget') scope.forget(memory.id, 1);
    if (mutation === 'supersede') ok(f.off().supersede({ namespace: ns, memoryId: memory.id, expectedRevision: 1,
      replacement: { content: 'New current interpretation', kind: 'context' }, receipts: [receipt('replacement')] }));
    if (mutation === 'filing') {
      const counted = openMemoryCore({ path: f.path, model: { countTokens: () => 1 } }); f.ws.defer(() => counted.close());
      const epoch = ok(counted.map({ namespace: ns })).indexRevision;
      ok(counted.applyPlacement({ namespace: ns, proposal: { items: [{ memoryId: memory.id, parentIds: [],
        newL1: { title: 'Synthetic filing', parentL2Ids: [] } }] },
      expectedMemoryRevisions: [{ memoryId: memory.id, revision: 1 }], expectedIndexRevision: epoch }));
    }
    if (mutation === 'reject') {
      // Trusted synthetic setup reaches the review-only reject entrypoint after binding.
      f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(memory.id);
      const review = openMemoryCore({ path: f.path, decisionReview: 'required-v1' }); f.ws.defer(() => review.close());
      ok(review.reject({ namespace: ns, memoryId: memory.id, expectedRevision: 1, actionId: 'reject' }));
    }
    assert.equal(f.inspect(draft.id), null);
    const row = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(draft.id);
    assert.equal(row.revision, 2); assert.equal(row.title, null); assert.equal(row.body, null);
    assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings WHERE card_id=?').get(draft.id).n, 0);
  });
}

test('L04 direct qualified retirement and episode forgetting reach the same invalidation trigger', t => {
  const f = fixture(t);
  function qualified(value) {
    const text = `Project deadline is ${value}.`;
    return ok(f.core.admit({ namespace: ns, memory: { content: text, kind: 'fact' }, receipts: [receipt(value, text)], qualification: {
      version: 1, slot: { subject: 'Project', property: 'deadline', scope: 'local', applies: 'release' }, value,
      attribution: 'direct', commitment: 'adopted', anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
        fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }],
    } })).memory;
  }
  const previous = qualified('Friday'), next = qualified('Monday');
  const slotId = ok(f.core.bindQualifiedClaim({ namespace: ns, memoryId: previous.id, expectedRevision: 1, slotId: null, singleClaim: true })).slotId;
  ok(f.core.bindQualifiedClaim({ namespace: ns, memoryId: next.id, expectedRevision: 1, slotId, singleClaim: true }));
  const draft = ok(f.call('createCardDraft', draftInput([previous])));
  assert.equal(ok(f.off().transitionQualified({ namespace: ns, predecessor: { memoryId: previous.id, expectedRevision: 1 },
    replacement: { memoryId: next.id, expectedRevision: 1 } })).status, 'applied');
  assert.equal(f.inspect(draft.id), null);
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } }); f.ws.defer(() => runtime.close());
  const input = batch(), registered = runtime.reserveEpisodeBatch(episodeNs, input);
  const claim = runtime.claimAdmission(episodeNs, { ...input, leaseMs: 125000 });
  const admitted = runtime.finishAdmission(episodeNs, { ...input, token: claim.token, items: [{ content: 'Episode memory',
    kind: 'fact', origin: 'agent-inferred', confidence: 0.8, fingerprint: digest('episode memory'), conflictHints: [],
    receipts: [{ client: input.client, sessionId: registered.sessionKey, eventId: input.eventId, role: 'user', excerpt: input.view.messages[0].content }] }] });
  const episodeDraft = ok(f.call('createCardDraft', draftInput(admitted.memories, 'episode-card', episodeNs)));
  const revision = f.db.prepare('SELECT revision FROM session_episodes WHERE id=?').get(registered.episodeId).revision;
  ok(f.off().forgetEpisode({ namespace: episodeNs, episodeId: registered.episodeId, expectedRevision: revision }));
  assert.equal(ok(f.call('getCard', { namespace: episodeNs, cardId: episodeDraft.id })).card, null);
});

test('L06 authority callback mutation cannot commit stale Memory dependencies', t => {
  const f = fixture(t), memory = f.admit();
  f.host.hook = checks => { if (checks === 2) ok(f.core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: 1,
    content: 'Changed during verifier', kind: 'context', receipt: receipt('verifier') })); };
  error(f.call('createCardDraft', draftInput([memory])), 'source_unavailable');
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_operations').get().n, 0);
});

test('L07 per-Memory fanout deduplicates receipts; overflow and Memory-trigger failures roll back atomically', t => {
  const f = fixture(t), memory = f.admit('fanout', 2), drafts = [];
  for (let i = 0; i < 128; i++) drafts.push(ok(f.call('createCardDraft', draftInput([memory], `fanout-${i}`))));
  error(f.call('createCardDraft', draftInput([memory], 'over-cap')), 'dependency_limit_reached');
  assert.equal(f.db.prepare('SELECT count(*) n FROM private_cards').get().n, 128);
  const corruptId = randomUUID();
  f.db.prepare(`INSERT INTO private_cards SELECT ?,owner_id,scope,project_id,revision,state,title,body,body_revision,
    created_at,updated_at,confirmed_at FROM private_cards WHERE id=?`).run(corruptId, drafts[0].id);
  f.db.prepare(`INSERT INTO card_memory_bindings SELECT ?,memory_id,memory_revision,receipt_id,source_ref,position
    FROM card_memory_bindings WHERE card_id=?`).run(corruptId, drafts[0].id);
  const update = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    content: 'Over-bound update', kind: 'context', receipt: receipt('new') };
  error(f.off().correct(update), 'dependency_limit_reached');
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: memory.id })).memory.revision, memory.revision);
  assert.equal(f.inspect(drafts[0].id).state, 'draft');
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_effects').get().n, 0);
  ok(f.call('cancelCardDraft', { namespace: ns, cardId: corruptId, expectedRevision: 1, actionId: 'remove-corrupt-fixture' }));
  ok(f.off().correct(update));
  assert.equal(f.db.prepare("SELECT count(*) n FROM private_cards WHERE state='cancelled'").get().n, 129);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_effects').get().n, 129);
});

test('L04 failed enclosing Memory write restores dependent cards and content-free effects', t => {
  const f = fixture(t), memory = f.admit(), draft = ok(f.call('createCardDraft', draftInput([memory])));
  f.db.exec("CREATE TRIGGER fail_after_invalidation BEFORE INSERT ON receipts WHEN NEW.event_id='fail' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  error(f.off().correct({ namespace: ns, memoryId: memory.id, expectedRevision: 1,
    content: 'Rolled back change', kind: 'context', receipt: receipt('fail') }), 'storage_error');
  assert.equal(f.inspect(draft.id).revision, 1); assert.equal(f.inspect(draft.id).support.status, 'eligible');
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_effects').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings').get().n, 1);
});

test('L05 additive v20 migration preserves existing note Cards and disabled opening never upgrades v20', t => {
  const f = fixture(t);
  const note = ok(f.call('createCardDraft', { namespace: ns, actionId: 'old-note', drafting: 'authored',
    input: { title: 'Existing v20 note Card', body: 'Old current body', authoredInput: { text: 'Old note evidence', occurredAt: null } } }));
  const before = f.inspect(note.id);
  f.core.close();
  stripOrganizationFixture(f.db);
  // Exact v20 tables are unchanged by later versions. Remove additive empty slices
  // to construct a historical-layout fixture without depending on git history.
  f.db.exec('DROP TABLE card_applicability_reviews; DROP TRIGGER card_memory_revision_invalidation; DROP TRIGGER card_memory_purge; DROP TABLE card_memory_bindings; PRAGMA user_version=20;');
  const off = f.off(); assert.equal(off.getPrivateCardCapabilities, undefined);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 20);
  const upgraded = openMemoryCore({ path: f.path, privateCards: f.privateCards }); f.ws.defer(() => upgraded.close());
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 23);
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: note.id }, upgraded)).card, before);
  assert.equal(ok(f.call('getSource', { namespace: ns, source: before.bindings[0].source }, upgraded)).parts[0].text, 'Old note evidence');
});

test('L05/L08 separate feature-off process invalidates persisted dependencies and fresh process replays original receipt', t => {
  const f = fixture(t), memory = f.admit(), input = draftInput([memory]);
  const draft = ok(f.call('createCardDraft', input));
  const script = `import {openMemoryCore} from ${JSON.stringify(new URL('../index.mjs', import.meta.url).href)};
    import {isDeepStrictEqual} from 'node:util';
    const [path,mode,encoded]=process.argv.slice(1),input=JSON.parse(encoded),token={},grants=new WeakMap();
    const authority={authorize(request,supplied){if(supplied!==token||!isDeepStrictEqual(request.input,input))return null;
      const grant={}, {input:ignored,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},
      isCurrent(grant){return grants.get(grant)??null;}};
    const core=openMemoryCore({path,...(mode==='replay'?{privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',
      storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority}}:{})});
    try{console.log(JSON.stringify(mode==='replay'?core.createCardDraft(input,token):core.correct(input)));}finally{core.close();}`;
  function run(mode, value) {
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', script, f.path, mode, JSON.stringify(value)],
      { encoding: 'utf8', env: {}, timeout: 10_000 });
    assert.equal(child.status, 0, child.stderr); return JSON.parse(child.stdout);
  }
  ok(run('correct', { namespace: ns, memoryId: memory.id, expectedRevision: 1,
    content: 'A new process changed the Memory.', kind: 'context', receipt: receipt('cold-change') }));
  assert.equal(f.inspect(draft.id), null);
  assert.deepEqual(ok(run('replay', input)), draft);
  assert.equal(f.inspect(draft.id), null);
});

test('L06 source mutation during confirmation verification cancels draft rather than confirming stale support', t => {
  const f = fixture(t), memory = f.admit(), draft = ok(f.call('createCardDraft', draftInput([memory])));
  const finalCheck = f.host.checks + 2;
  f.host.hook = checks => { if (checks === finalCheck) ok(f.off().forget({ namespace: ns,
    memoryId: memory.id, expectedRevision: 1 })); };
  error(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'stale-confirm' }), 'revision_conflict');
  assert.equal(f.inspect(draft.id), null);
  assert.equal(f.db.prepare("SELECT count(*) n FROM card_operations WHERE action_id='stale-confirm'").get().n, 0);
});

test('L07 confirmed deletion purges dependencies before future Memory writes', t => {
  const f = fixture(t), memory = f.admit(), draft = ok(f.call('createCardDraft', draftInput([memory])));
  ok(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'confirm' }));
  ok(f.call('deleteKnowledgeCard', { namespace: ns, cardId: draft.id, expectedRevision: 2, actionId: 'delete' }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_memory_bindings').get().n, 0);
  ok(f.off().forget({ namespace: ns, memoryId: memory.id, expectedRevision: 1 }));
  assert.equal(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(draft.id).revision, 3);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_effects').get().n, 1);
});

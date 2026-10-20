import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { isDeepStrictEqual } from 'node:util';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { stripOrganizationFixture } from '../testing/private-organization-fixture.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const ns = { ownerId: 'organization-owner', scope: 'project', projectId: 'one' };
const foreign = { ...ns, projectId: 'foreign' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
const receipt = id => ({ client: 'synthetic', sessionId: 'session', eventId: id, role: 'user', excerpt: `tea ${id}` });
function fixture(t) {
  const ws = createTestWorkspace(t, { prefix: 'private-organization-' }), path = join(ws.path, 'store.sqlite');
  const tokens = new WeakMap(), grants = new WeakMap(), host = { generation: 1, hook: null, checks: 0, seen: [], enabled: true };
  const options = { version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
    disclosure: 'explicit-submitted-note-v1', authority: {
      authorize(request, token) {
        host.seen.push(request.actionClass);
        const expected = tokens.get(token);
        if (!expected || !host.enabled || expected.method !== request.method || !isDeepStrictEqual(expected.input, request.input) ||
            expected.actionClass !== request.actionClass) return null;
        const { input, ...binding } = request, grant = {}; grants.set(grant, binding); return grant;
      },
      isCurrent(grant) { host.hook?.(++host.checks); return host.enabled ? { ...grants.get(grant), accessGeneration: host.generation } : null; },
    } };
  let core = openMemoryCore({ path, privateCards: options, model: { countTokens: () => 1 } });
  ws.defer(() => core.close());
  const db = new DatabaseSync(path); ws.defer(() => db.close());
  return { ws, path, db, options, host, get core() { return core; },
    call(method, input, actionClass = ['mapEvidence', 'listEvidenceMappings', 'getCard', 'inspectCardOperation', 'selectEvidence', 'fetchEvidence'].includes(method) ? 'read' :
      ['applyCardPlacement', 'refreshCardTopic', 'proposeEvidenceMapping'].includes(method) ? 'organization' : 'explicit-user') {
      const token = {}; tokens.set(token, { method, input: structuredClone(input), actionClass }); return core[method](input, token);
    },
    reopen(on = true) { core.close(); core = openMemoryCore({ path, ...(on ? { privateCards: options } : {}), model: { countTokens: () => 1 } }); },
  };
}
function card(f, id = 'one') {
  const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: `draft-${id}`, drafting: 'authored',
    input: { title: `Tea ${id}`, body: `tea private authored ${id}`, authoredInput: { text: `note ${id}`, occurredAt: null } } }));
  const saved = ok(f.call('confirmCardDraft', { namespace: ns, actionId: `confirm-${id}`, cardId: draft.id, expectedRevision: 1, applicability: 'current' }));
  return { type: 'card', namespace: ns, cardId: draft.id, revision: saved.revision, bodyRevision: saved.bodyRevision };
}
const map = (type = 'card', extra = {}) => ({ namespace: ns, type, ...extra });
function place(f, ref, id = 'one', extra = {}) {
  const index = ok(f.call('mapEvidence', map())).indexRevision;
  return { namespace: ns, actionId: `placement-${id}`, refs: [ref], expectedIndexRevision: index,
    proposal: { items: [{ cardId: ref.cardId, parentIds: [], newL1: { title: `Tea L1 ${id}`, parentL2Ids: [], newL2Title: `Tea L2 ${id}` } }] }, ...extra };
}
function memoryTopic(f, id = 'one') {
  const admitted = ok(f.core.admit({ namespace: ns, memory: { content: `tea memory ${id}`, kind: 'fact' }, receipts: [receipt(id)] }));
  const placed = ok(f.core.applyPlacement({ namespace: ns, expectedIndexRevision: admitted.indexRevision,
    expectedMemoryRevisions: [{ memoryId: admitted.memory.id, revision: 1 }], proposal: { items: [{ memoryId: admitted.memory.id,
      parentIds: [], newL1: { title: `Memory topic ${id}`, parentL2Ids: [], newL2Title: `Memory root ${id}` } }] } }));
  return { placed, memory: placed.memories[0], l1: placed.createdMocs.find(moc => moc.level === 'L1'), l2: placed.createdMocs.find(moc => moc.level === 'L2') };
}
function endpoints(f, m, c, level = 'L1') {
  const ct = c.createdMocRefs.find(topic => topic.level === level), mt = level === 'L1' ? m.l1 : m.l2;
  return { memoryTopic: { mocId: mt.id, revision: mt.revision }, cardTopic: { mocId: ct.mocId, revision: ct.revision },
    expectedMemoryIndexRevision: ok(f.call('mapEvidence', map('memory'))).indexRevision,
    expectedCardIndexRevision: ok(f.call('mapEvidence', map())).indexRevision };
}

test('M01 typed wrappers reuse Memory index authority and never mix Card IDs into old maps', t => {
  const f = fixture(t), ref = card(f), m = memoryTopic(f), before = ok(f.core.map({ namespace: ns }));
  assert.equal(ok(f.call('mapEvidence', map())).items[0].type, 'unfiled');
  const placed = ok(f.call('applyCardPlacement', place(f, ref)));
  const cm = ok(f.call('mapEvidence', map())), mm = ok(f.call('mapEvidence', map('memory')));
  assert.equal(cm.items.filter(item => item.type === 'topic').length, 2);
  assert.equal(cm.items.some(item => item.type === 'ref' && item.ref.childType === 'card'), true);
  assert.equal(mm.items.some(item => item.type === 'ref' && item.ref.childType === 'memory'), true);
  assert.equal(JSON.stringify(ok(f.core.map({ namespace: ns }))).includes(ref.cardId), false);
  assert.deepEqual(ok(f.core.map({ namespace: ns })), before);
  const l2 = placed.createdMocRefs.find(topic => topic.level === 'L2');
  const children = ok(f.call('mapEvidence', map('card', { parentRef: { mocId: l2.mocId, revision: l2.revision } })));
  assert.equal(children.items.some(item => item.type === 'topic' && item.topic.level === 'L1'), true);
  assert.equal(children.items.some(item => item.type === 'ref' && item.ref.childType === 'card'), false);
  // Rebuild in progress explicitly disables the authoritative Memory projection.
  ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision: m.placed.indexRevision, limit: 1 }));
  error(f.call('mapEvidence', map('memory')), 'index_unavailable');
});

test('M02 guarded placement is atomic, bounded, replayable and preserves Card content/review revisions', t => {
  const f = fixture(t), ref = card(f), input = place(f, ref);
  error(f.call('applyCardPlacement', input, 'draft'), 'authority_required');
  error(f.call('applyCardPlacement', { ...input, expectedIndexRevision: 999 }), 'index_revision_conflict');
  error(f.call('applyCardPlacement', { ...input, refs: [{ ...ref, revision: 999 }] }), 'revision_conflict');
  error(f.call('applyCardPlacement', { ...input, refs: [{ ...ref, namespace: foreign }] }), 'scope_changed');
  error(f.call('applyCardPlacement', { ...input, refs: Array.from({ length: 6 }, () => ref) }), 'invalid_input');
  error(f.call('applyCardPlacement', { ...input, proposal: { items: [{ cardId: ref.cardId, parentIds: ['a', 'b', 'c', 'd'] }] } }), 'invalid_input');
  const before = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  const placed = ok(f.call('applyCardPlacement', input));
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card, before);
  assert.deepEqual(ok(f.call('applyCardPlacement', input)), placed);
  const ledger = JSON.stringify(f.db.prepare('SELECT * FROM card_operations').all());
  assert.equal(ledger.includes('Tea L1 one'), false); assert.equal(ledger.includes(before.body), false);
  assert.equal(ok(f.call('selectEvidence', { namespace: ns, query: 'tea', types: ['card'], intent: 'current' })).items.length, 1);
  const other = card(f, 'other'), invalid = place(f, other, 'bad');
  invalid.refs.push(ref); invalid.proposal.items.push({ cardId: ref.cardId, parentIds: ['missing'] });
  const count = f.db.prepare('SELECT count(*) n FROM card_mocs').get().n;
  error(f.call('applyCardPlacement', invalid), 'moc_not_found');
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_mocs').get().n, count);
});

test('M03 changed source hides derived titles and Card membership while history remains inspectable', t => {
  const f = fixture(t), ref = card(f), placed = ok(f.call('applyCardPlacement', place(f, ref)));
  const beforeIndex = placed.indexRevision;
  const detail = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  const source = detail.bindings[0].source;
  ok(f.call('deleteSourceNote', { namespace: ns, actionId: 'remove-source', sourceId: source.sourceId, expectedRevision: 1 }));
  const page = ok(f.call('mapEvidence', map()));
  assert.ok(page.indexRevision > beforeIndex);
  assert.equal(page.items.filter(item => item.type === 'topic').every(item => item.topic.title === null), true);
  assert.equal(page.items.some(item => item.type === 'ref' && item.ref.childType === 'card'), false);
  const history = ok(f.call('selectEvidence', { namespace: ns, query: 'tea', types: ['card'], intent: 'history' }));
  assert.equal(history.items.length, 1);
  assert.equal(ok(f.call('fetchEvidence', { namespace: ns, refs: [history.items[0].ref], intent: 'history' })).items[0].body, detail.body);
  assert.equal(f.db.prepare('SELECT count(*) n FROM card_moc_title_sources').get().n, 2);
});

test('M04 mappings require explicit review, remain navigable after activation, and refresh only with exact endpoints', t => {
  const f = fixture(t), ref = card(f), c = ok(f.call('applyCardPlacement', place(f, ref))), m = memoryTopic(f);
  let pair = endpoints(f, m, c);
  const proposed = ok(f.call('proposeEvidenceMapping', { namespace: ns, actionId: 'propose', ...pair }));
  let mappings = ok(f.call('listEvidenceMappings', map('card', { mocId: pair.cardTopic.mocId }))).items;
  assert.equal(mappings[0].state, 'proposed'); assert.equal(mappings[0].navigable, false);
  const activate = { namespace: ns, actionId: 'activate', mappingId: proposed.id, expectedRevision: 1, state: 'active', ...pair };
  error(f.call('reviewEvidenceMapping', activate, 'organization'), 'authority_required');
  const active = ok(f.call('reviewEvidenceMapping', activate));
  mappings = ok(f.call('listEvidenceMappings', map('memory', { mocId: pair.memoryTopic.mocId }))).items;
  assert.equal(mappings[0].navigable, true);
  assert.equal(ok(f.call('selectEvidence', { namespace: ns, query: 'L1', types: ['card'], intent: 'current' })).items.length, 0);
  assert.equal(ok(f.call('mapEvidence', map())).indexRevision, pair.expectedCardIndexRevision);
  // Unrelated canonical Memory write stales the exact checked index generation.
  ok(f.core.admit({ namespace: ns, memory: { content: 'other tea memory', kind: 'fact' }, receipts: [receipt('other')] }));
  assert.equal(ok(f.call('listEvidenceMappings', map('card', { mocId: pair.cardTopic.mocId }))).items[0].navigable, false);
  pair = endpoints(f, m, c);
  const refresh = { ...activate, ...pair, actionId: 'refresh', expectedRevision: active.revision };
  const refreshed = ok(f.call('reviewEvidenceMapping', refresh));
  assert.equal(ok(f.call('listEvidenceMappings', map('card', { mocId: pair.cardTopic.mocId }))).items[0].navigable, true);
  const removed = ok(f.call('reviewEvidenceMapping', { ...refresh, actionId: 'remove', expectedRevision: refreshed.revision, state: 'removed' }));
  error(f.call('reviewEvidenceMapping', { ...refresh, actionId: 'revive', expectedRevision: removed.revision }), 'mapping_state_conflict');
  assert.equal(ok(f.call('listEvidenceMappings', map('card', { mocId: pair.cardTopic.mocId }))).items[0].navigable, false);
  error(f.call('proposeEvidenceMapping', { namespace: ns, actionId: 'cross-level', ...pair,
    memoryTopic: { mocId: m.l2.id, revision: m.l2.revision } }), 'invalid_ref');
});

test('M04 max16 active incident mappings, scope isolation and stale support cannot expand navigation', t => {
  const f = fixture(t), ref = card(f), c = ok(f.call('applyCardPlacement', place(f, ref))), m = memoryTopic(f), pair = endpoints(f, m, c);
  for (let i = 0; i < 17; i++) {
    const proposal = ok(f.call('proposeEvidenceMapping', { namespace: ns, actionId: `propose-${i}`, ...pair }));
    const request = { namespace: ns, actionId: `activate-${i}`, mappingId: proposal.id, expectedRevision: 1, state: 'active', ...pair };
    if (i === 16) error(f.call('reviewEvidenceMapping', request), 'mapping_limit_reached'); else ok(f.call('reviewEvidenceMapping', request));
  }
  assert.equal(f.db.prepare("SELECT count(*) n FROM evidence_mappings WHERE state='active'").get().n, 16);
  assert.equal(ok(f.call('listEvidenceMappings', { namespace: foreign, type: 'card', mocId: pair.cardTopic.mocId })).items.length, 0);
  const oldIndex = pair.expectedCardIndexRevision;
  const detail = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  ok(f.call('deleteKnowledgeCard', { namespace: ns, actionId: 'delete', cardId: ref.cardId, expectedRevision: detail.revision }));
  assert.ok(ok(f.call('mapEvidence', map())).indexRevision > oldIndex);
  assert.equal(ok(f.call('listEvidenceMappings', map('card', { mocId: pair.cardTopic.mocId }))).items.every(item => !item.navigable), true);
});

test('M05 cursors bind read generation, scope/type/parent/settings and make bounded progress', t => {
  const f = fixture(t), ref = card(f); ok(f.call('applyCardPlacement', place(f, ref)));
  const first = ok(f.call('mapEvidence', map('card', { limit: 1 })));
  assert.ok(first.nextCursor); assert.equal(first.coverage.partial, true);
  const items = [...first.items]; let cursor = first.nextCursor, pages = 1;
  while (cursor) {
    const next = ok(f.call('mapEvidence', map('card', { limit: 1, cursor })));
    items.push(...next.items); cursor = next.nextCursor; assert.ok(++pages < 20);
    assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: next })) <= 65536);
  }
  assert.equal(items.length, 4);
  assert.equal(new Set(items.map(item => item.type === 'topic' ? item.topic.id :
    `${item.ref.parentId}:${item.ref.childType}:${item.ref.childId}`)).size, 4);
  error(f.call('mapEvidence', map('memory', { limit: 1, cursor: first.nextCursor })), 'invalid_cursor');
  error(f.call('mapEvidence', map('card', { limit: 2, cursor: first.nextCursor })), 'invalid_cursor');
  error(f.call('mapEvidence', { namespace: foreign, type: 'card', limit: 1, cursor: first.nextCursor }), 'invalid_cursor');
  f.host.generation++;
  error(f.call('mapEvidence', map('card', { limit: 1, cursor: first.nextCursor })), 'cursor_stale');
});

test('M06 schema22→23 is opt-in, feature-off Memory mutation stales routing, and restart preserves mappings', t => {
  const f = fixture(t), ref = card(f), detail = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  f.core.close(); stripOrganizationFixture(f.db); f.db.exec('PRAGMA user_version=22');
  f.reopen(false); assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 22);
  f.reopen(); assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 23);
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card, detail);
  const c = ok(f.call('applyCardPlacement', place(f, ref))), m = memoryTopic(f), pair = endpoints(f, m, c);
  const proposal = ok(f.call('proposeEvidenceMapping', { namespace: ns, actionId: 'propose', ...pair }));
  ok(f.call('reviewEvidenceMapping', { namespace: ns, actionId: 'activate', mappingId: proposal.id, expectedRevision: 1, state: 'active', ...pair }));
  f.reopen();
  assert.equal(ok(f.call('listEvidenceMappings', map('card', { mocId: pair.cardTopic.mocId }))).items[0].navigable, true);
  const code = `import {openMemoryCore} from ${JSON.stringify(new URL('../contract.mjs', import.meta.url).href)};
    const core=openMemoryCore({path:process.argv[1]});try{const r=core.correct({namespace:JSON.parse(process.argv[2]),
      memoryId:process.argv[3],expectedRevision:Number(process.argv[4]),content:'changed tea memory',kind:'fact',
      receipt:{client:'synthetic',sessionId:'session',eventId:'child',role:'user',excerpt:'changed tea'}});
      if(!r.ok)process.exitCode=1;}finally{core.close()}`;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', code, f.path, JSON.stringify(ns), m.memory.id, String(m.memory.revision)],
    { encoding: 'utf8', timeout: 15000, maxBuffer: 65536 });
  assert.equal(child.status, 0, `${child.stderr}\n${child.error ?? ''}`);
  assert.equal(ok(f.call('listEvidenceMappings', map('card', { mocId: pair.cardTopic.mocId }))).items[0].navigable, false);
});

test('M03/M06 feature-off Memory correction bumps Card index and hides exact dependent memberships', t => {
  const f = fixture(t), admitted = ok(f.core.admit({ namespace: ns, memory: { content: 'tea interpretation', kind: 'fact' }, receipts: [receipt('source')] }));
  const draft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'receipt-draft', drafting: 'authored', input: {
    title: 'Receipt Card', body: 'tea receipt authored body', sourcePolicy: 'retained-receipts-v1',
    memoryRefs: [{ type: 'memory', namespace: ns, memoryId: admitted.memory.id, revision: 1 }] } }, 'draft'));
  const confirmed = ok(f.call('confirmCardDraft', { namespace: ns, actionId: 'confirm-receipt', cardId: draft.id, expectedRevision: 1, applicability: 'current' }));
  const ref = { type: 'card', namespace: ns, cardId: draft.id, revision: confirmed.revision, bodyRevision: 1 };
  const placed = ok(f.call('applyCardPlacement', place(f, ref, 'receipt')));
  f.reopen(false);
  ok(f.core.correct({ namespace: ns, memoryId: admitted.memory.id, expectedRevision: 1,
    content: 'new tea interpretation', kind: 'fact', receipt: receipt('correction') }));
  f.reopen();
  const page = ok(f.call('mapEvidence', map()));
  assert.ok(page.indexRevision > placed.indexRevision);
  assert.equal(page.items.some(item => item.type === 'ref' && item.ref.childType === 'card'), false);
  assert.equal(page.items.filter(item => item.type === 'topic').every(item => item.topic.title === null), true);
});

test('M02/M04 final authority fence refuses organization or activation against changed source/index', t => {
  const f = fixture(t), ref = card(f), c = ok(f.call('applyCardPlacement', place(f, ref))), m = memoryTopic(f), pair = endpoints(f, m, c);
  const proposal = ok(f.call('proposeEvidenceMapping', { namespace: ns, actionId: 'propose-race', ...pair }));
  const request = { namespace: ns, actionId: 'activate-race', mappingId: proposal.id, expectedRevision: 1, state: 'active', ...pair };
  f.host.checks = 0;
  f.host.hook = count => {
    if (count === 2) ok(f.call('deleteKnowledgeCard', { namespace: ns, cardId: ref.cardId, expectedRevision: 2, actionId: 'delete-in-host' }));
  };
  error(f.call('reviewEvidenceMapping', request), 'index_revision_conflict');
  f.host.hook = null;
  assert.equal(ok(f.call('inspectCardOperation', { namespace: ns, operationActionId: 'activate-race' })).operation, null);
  assert.equal(ok(f.call('listEvidenceMappings', map('card', { mocId: pair.cardTopic.mocId }))).items[0].state, 'proposed');
  const other = card(f, 'other'), placement = place(f, other, 'other');
  f.host.checks = 0; f.host.hook = count => { if (count === 2) f.host.enabled = false; };
  error(f.call('applyCardPlacement', placement), 'scope_changed');
  f.host.hook = null; f.host.enabled = true;
  assert.equal(ok(f.call('inspectCardOperation', { namespace: ns, operationActionId: placement.actionId })).operation, null);
});

test('M02 filing an unknown-applicability Card never promotes it to current evidence', t => {
  const f = fixture(t), draft = ok(f.call('createCardDraft', { namespace: ns, actionId: 'unknown-draft', drafting: 'authored',
    input: { title: 'Tea', body: 'tea private artifact', authoredInput: { text: 'submitted note', occurredAt: null } } }));
  const confirmed = ok(f.call('confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: 1, actionId: 'unknown-confirm' }));
  const ref = { type: 'card', namespace: ns, cardId: draft.id, revision: confirmed.revision, bodyRevision: 1 };
  ok(f.call('applyCardPlacement', place(f, ref, 'unknown')));
  assert.equal(ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card.support.applicability, 'unknown');
  assert.equal(ok(f.call('selectEvidence', { namespace: ns, query: 'tea', types: ['card'], intent: 'current' })).items.length, 0);
  assert.equal(ok(f.call('selectEvidence', { namespace: ns, query: 'tea', types: ['card'], intent: 'history' })).items.length, 1);
});

function editCard(f, ref, actionId = 'edit-card') {
  const detail = ok(f.call('getCard', { namespace: ns, cardId: ref.cardId })).card;
  const changed = ok(f.call('editKnowledgeCard', { namespace: ns, cardId: ref.cardId,
    expectedRevision: detail.revision, actionId, title: detail.title, body: detail.body,
    bindings: detail.bindings.map(binding => binding.source), applicability: 'current' }));
  return { ...ref, revision: changed.revision, bodyRevision: changed.bodyRevision };
}
function refreshInput(f, ref, topic, actionId = 'refresh-topic', title = 'Tea L1 one') {
  return { namespace: ns, actionId, topicRef: { mocId: topic.mocId, revision: topic.revision },
    expectedIndexRevision: ok(f.call('mapEvidence', map())).indexRevision, title, refs: [ref] };
}

test('M07 same-body edit recovers existing topic IDs/hierarchy, then explicit placement and mapping review', t => {
  const f = fixture(t), original = card(f), c = ok(f.call('applyCardPlacement', place(f, original))), m = memoryTopic(f);
  const l1 = c.createdMocRefs.find(topic => topic.level === 'L1'), l2 = c.createdMocRefs.find(topic => topic.level === 'L2');
  const pair = endpoints(f, m, c), proposed = ok(f.call('proposeEvidenceMapping', { namespace: ns, actionId: 'propose-recovery', ...pair }));
  const active = ok(f.call('reviewEvidenceMapping', { namespace: ns, actionId: 'activate-recovery',
    mappingId: proposed.id, expectedRevision: proposed.revision, state: 'active', ...pair }));
  const fresh = editCard(f, original);
  assert.equal(fresh.bodyRevision, original.bodyRevision);
  const beforeCard = ok(f.call('getCard', { namespace: ns, cardId: fresh.cardId })).card;
  let page = ok(f.call('mapEvidence', map()));
  assert.equal(page.items.filter(item => item.type === 'topic').every(item => item.topic.title === null), true);
  const stalePlacement = { namespace: ns, actionId: 'stale-topic-placement', refs: [fresh],
    expectedIndexRevision: page.indexRevision, proposal: { items: [{ cardId: fresh.cardId, parentIds: [l1.mocId] }] } };
  error(f.call('applyCardPlacement', stalePlacement), 'evidence_unavailable');
  error(f.call('applyCardPlacement', place(f, fresh, 'duplicate-recovery', { proposal: {
    items: [{ cardId: fresh.cardId, parentIds: [], newL1: { title: 'Tea L1 one', parentL2Ids: [] } }] } })), 'moc_title_conflict');
  const request = refreshInput(f, fresh, l1), refreshed = ok(f.call('refreshCardTopic', request));
  assert.deepEqual(refreshed.topicRef, { mocId: l1.mocId, revision: l1.revision + 1 });
  assert.equal(refreshed.level, 'L1');
  page = ok(f.call('mapEvidence', map()));
  assert.equal(page.items.find(item => item.type === 'topic' && item.topic.id === l1.mocId).topic.title, 'Tea L1 one');
  assert.equal(page.items.find(item => item.type === 'topic' && item.topic.id === l2.mocId).topic.revision, l2.revision);
  assert.equal(page.items.some(item => item.type === 'ref' && item.ref.childType === 'card'), false);
  let edge = page.items.find(item => item.type === 'ref' && item.ref.childType === 'topic').ref;
  assert.equal(edge.parentId, l2.mocId); assert.equal(edge.childId, l1.mocId);
  assert.equal(edge.childRevision, refreshed.revision);
  const refreshedRoot = ok(f.call('refreshCardTopic', refreshInput(f, fresh, l2, 'refresh-root', 'Tea L2 one')));
  page = ok(f.call('mapEvidence', map()));
  edge = page.items.find(item => item.type === 'ref' && item.ref.childType === 'topic').ref;
  assert.equal(edge.parentRevision, refreshedRoot.revision); assert.equal(edge.childRevision, refreshed.revision);
  const mappingAfterTopics = ok(f.call('listEvidenceMappings', map('card', { mocId: l1.mocId }))).items[0];
  assert.equal(mappingAfterTopics.revision, active.revision); assert.equal(mappingAfterTopics.navigable, false);
  assert.deepEqual(ok(f.call('getCard', { namespace: ns, cardId: fresh.cardId })).card, beforeCard);
  ok(f.call('applyCardPlacement', { ...stalePlacement, actionId: 'fresh-topic-placement', expectedIndexRevision: page.indexRevision }));
  page = ok(f.call('mapEvidence', map()));
  assert.equal(page.items.some(item => item.type === 'ref' && item.ref.childType === 'card' && item.ref.childRevision === fresh.revision), true);
  const currentTopic = page.items.find(item => item.type === 'topic' && item.topic.id === l1.mocId).topic;
  const review = { namespace: ns, actionId: 'review-recovered-mapping', mappingId: proposed.id,
    expectedRevision: active.revision, state: 'active', ...pair,
    cardTopic: { mocId: currentTopic.id, revision: currentTopic.revision }, expectedCardIndexRevision: page.indexRevision };
  error(f.call('reviewEvidenceMapping', review, 'organization'), 'authority_required');
  ok(f.call('reviewEvidenceMapping', review));
  assert.equal(ok(f.call('listEvidenceMappings', map('card', { mocId: l1.mocId }))).items[0].navigable, true);
  f.reopen();
  assert.deepEqual(ok(f.call('refreshCardTopic', request)), refreshed);
  assert.equal(ok(f.call('mapEvidence', map())).indexRevision, page.indexRevision);
  assert.equal(ok(f.call('mapEvidence', map())).items.find(item => item.type === 'topic' && item.topic.id === l1.mocId).topic.revision, currentTopic.revision);
  error(f.call('refreshCardTopic', { ...request, title: 'Changed replay' }), 'action_conflict');
  const metadata = JSON.stringify(f.db.prepare("SELECT * FROM card_operations WHERE method='refreshCardTopic'").all());
  assert.equal(metadata.includes('Tea L1 one'), false); assert.equal(metadata.includes(beforeCard.body), false);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 23);
});

test('M07 refresh strictly guards title/refs/CAS/scope/collision and rolls back every write on failure', t => {
  const f = fixture(t), original = card(f), placed = ok(f.call('applyCardPlacement', place(f, original)));
  const fresh = editCard(f, original), second = card(f, 'collision');
  ok(f.call('applyCardPlacement', place(f, second, 'collision')));
  const l1 = placed.createdMocRefs.find(topic => topic.level === 'L1');
  const request = refreshInput(f, fresh, l1, 'refresh-guarded', 'Reviewed recovery');
  error(f.call('refreshCardTopic', request, 'draft'), 'authority_required');
  for (const extra of [{ title: '' }, { title: 'x'.repeat(121) }, { refs: [] },
    { refs: Array.from({ length: 6 }, () => fresh) }, { refs: [fresh, fresh] }, { humanConfirmed: true }]) {
    error(f.call('refreshCardTopic', { ...request, ...extra }), 'invalid_input');
  }
  error(f.call('refreshCardTopic', { ...request, refs: [{ ...fresh, namespace: foreign }] }), 'scope_changed');
  error(f.call('refreshCardTopic', { ...request, namespace: foreign, expectedIndexRevision: 1,
    refs: [{ ...fresh, namespace: foreign }] }), 'moc_not_found');
  error(f.call('refreshCardTopic', { ...request, expectedIndexRevision: 999 }), 'index_revision_conflict');
  error(f.call('refreshCardTopic', { ...request, topicRef: { ...request.topicRef, revision: 999 } }), 'revision_conflict');
  error(f.call('refreshCardTopic', { ...request, refs: [second, original] }), 'revision_conflict');
  error(f.call('refreshCardTopic', { ...request, title: '  Ｔｅａ Ｌ１ collision  ' }), 'moc_title_conflict');
  const before = f.db.prepare('SELECT * FROM card_mocs WHERE id=?').get(l1.mocId);
  const bindings = f.db.prepare('SELECT * FROM card_moc_title_sources WHERE moc_id=?').all(l1.mocId);
  f.db.exec("CREATE TRIGGER fail_refresh BEFORE INSERT ON card_moc_title_sources BEGIN SELECT RAISE(ABORT,'synthetic failure'); END");
  error(f.call('refreshCardTopic', request), 'storage_error');
  f.db.exec('DROP TRIGGER fail_refresh');
  assert.deepEqual(f.db.prepare('SELECT * FROM card_mocs WHERE id=?').get(l1.mocId), before);
  assert.deepEqual(f.db.prepare('SELECT * FROM card_moc_title_sources WHERE moc_id=?').all(l1.mocId), bindings);
  assert.equal(ok(f.call('mapEvidence', map())).indexRevision, request.expectedIndexRevision);
  assert.equal(ok(f.call('inspectCardOperation', { namespace: ns, operationActionId: request.actionId })).operation, null);
  const refreshed = ok(f.call('refreshCardTopic', request));
  assert.equal(refreshed.topicRef.mocId, l1.mocId);
  assert.equal(ok(f.call('mapEvidence', map())).items.find(item => item.type === 'topic' && item.topic.id === l1.mocId).topic.title, 'Reviewed recovery');
  const source = ok(f.call('getCard', { namespace: ns, cardId: fresh.cardId })).card.bindings[0].source;
  ok(f.call('deleteSourceNote', { namespace: ns, actionId: 'unavailable-refresh', sourceId: source.sourceId, expectedRevision: 1 }));
  const unavailable = ok(f.call('getCard', { namespace: ns, cardId: fresh.cardId })).card;
  error(f.call('refreshCardTopic', refreshInput(f, { ...fresh, revision: unavailable.revision }, refreshed.topicRef,
    'refresh-unavailable', 'Unavailable label')), 'evidence_unavailable');
});

test('M07 authority callback races cannot refresh a topic against changed sources or revoked access', t => {
  const f = fixture(t), original = card(f), placed = ok(f.call('applyCardPlacement', place(f, original)));
  const l1 = placed.createdMocRefs.find(topic => topic.level === 'L1');
  const request = refreshInput(f, original, l1, 'racing-refresh');
  f.host.checks = 0; f.host.hook = count => { if (count === 2) editCard(f, original, 'host-edit'); };
  error(f.call('refreshCardTopic', request), 'index_revision_conflict');
  f.host.hook = null;
  assert.equal(ok(f.call('inspectCardOperation', { namespace: ns, operationActionId: request.actionId })).operation, null);
  assert.equal(f.db.prepare('SELECT revision FROM card_mocs WHERE id=?').get(l1.mocId).revision, l1.revision);
  const detail = ok(f.call('getCard', { namespace: ns, cardId: original.cardId })).card;
  const freshRequest = refreshInput(f, { ...original, revision: detail.revision }, l1, 'revoked-refresh');
  f.host.checks = 0; f.host.hook = count => { if (count === 2) f.host.enabled = false; };
  error(f.call('refreshCardTopic', freshRequest), 'scope_changed');
  f.host.hook = null; f.host.enabled = true;
  assert.equal(ok(f.call('inspectCardOperation', { namespace: ns, operationActionId: freshRequest.actionId })).operation, null);
  assert.equal(f.db.prepare('SELECT revision FROM card_mocs WHERE id=?').get(l1.mocId).revision, l1.revision);
});

test('M07 maximum five title sources remain exact required bindings without silent prefix recovery', t => {
  const f = fixture(t), first = card(f), placed = ok(f.call('applyCardPlacement', place(f, first)));
  const refs = [first, ...Array.from({ length: 4 }, (_, index) => card(f, `support-${index}`))];
  const l1 = placed.createdMocRefs.find(topic => topic.level === 'L1');
  const request = { ...refreshInput(f, first, l1, 'refresh-five', 'Five reviewed sources'), refs };
  ok(f.call('refreshCardTopic', request));
  let label = ok(f.call('mapEvidence', map())).items.find(item => item.type === 'topic' && item.topic.id === l1.mocId).topic;
  assert.equal(label.title, 'Five reviewed sources');
  assert.deepEqual(label.titleSources.map(ref => ref.cardId).sort(), refs.map(ref => ref.cardId).sort());
  editCard(f, refs.at(-1), 'change-fifth');
  label = ok(f.call('mapEvidence', map())).items.find(item => item.type === 'topic' && item.topic.id === l1.mocId).topic;
  assert.equal(label.title, null); assert.equal(label.titleSources.length, 5);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { countOpenAITokens } from '../../adapters/openai/index.mjs';
import { packMixedAnswer } from '../../evaluation/longmemeval/mixed-answer.mjs';
import { openMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createMocStorage } from '../moc-storage.mjs';
import { modelRequestText } from '../model-call.mjs';
import { createQueryScore, mixMocPriorCandidates, MOC_PRIOR_SOURCE_CANDIDATES as bounds } from '../query-candidates.mjs';

const ns = { ownerId: 'moc-prior-tests', scope: 'personal', projectId: null };
const physicalNs = { ...ns, projectId: '' };
const legacy = 'bounded-keyset-v1', prior = 'moc-prior-keyset-v1';
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const memoryId = row => row.item.type === 'ref' ? row.item.ref.childId : row.item.ref.memoryId;
const itemRef = (item, namespaceIndex) => ({ namespaceIndex, ...(item.type === 'unfiled' ? item.ref
  : { memoryId: item.ref.childId, revision: item.ref.childRevision }) });
const receipt = (eventId, excerpt) => ({ client: 'synthetic', sessionId: 'moc-prior', eventId, role: 'user', excerpt });
const admit = (core, content, namespace = ns, kind = 'fact') => ok(core.admit({ namespace,
  memory: { content, kind }, receipts: [receipt(content.slice(0, 150), content)] })).memory;

// Frozen supported pressure fixture, verbatim source/query from the sealed
// diagnostic. No adaptive changes after the first run. No ID/gold in ports.
const supportedFixture = Object.freeze({
  count: 96,
  target: 'For Project Northstar, the approved service module is the replacement controller. Its assigned storage is drawer amber.',
  topic: 'Project Northstar service module',
  broad: 'Where is Project Northstar’s approved service module kept?',
  exact: 'Northstar replacement controller assigned storage drawer amber',
  noise: i => `Question-only log ${i}: Where is Project Northstar’s approved service module kept? ${'界'.repeat(300)} Unrelated inspection log: this quoted question makes no identity assertion or storage-location assertion.`,
});
const fixtureSources = () => [supportedFixture.target, ...Array.from({ length: 95 }, (_, i) => supportedFixture.noise(i))];
const fixtureSourceSha256 = sha(JSON.stringify(fixtureSources()));
const frozenSourceSha256 = 'b7fb4302d5ef6ea22f0bda66f7fe2598983b67949ab0bfeee5753f662a6bebcc';

function ports(counter = () => 1) {
  const calls = [];
  return { calls, contextWindow: 8192, countTokens: counter,
    async select(request) {
      const { input } = request, refs = [];
      for (const page of input.maps) {
        let used = 0;
        for (const item of page.items) {
          if (used >= 12 || refs.length >= input.maxRefs) break;
          refs.push(itemRef(item, page.namespaceIndex)); used++;
        }
      }
      calls.push({ stage: 'select', request, refs }); return { refs };
    },
    async rank(request) {
      const refs = request.input.candidates.slice(0, request.input.limit).map(({ namespaceIndex, memory }) =>
        ({ namespaceIndex, memoryId: memory.id, revision: memory.revision }));
      calls.push({ stage: 'rank', request, refs }); return { refs };
    } };
}
function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-moc-prior-' }), path = join(workspace.path, 'memory.sqlite');
  const model = ports(), core = openMemoryCore({ path, model }), db = new DatabaseSync(path), runtime = createMemoryRuntime({ path });
  let closed = false;
  const close = () => { if (!closed) { closed = true; runtime.close(); db.close(); core.close(); } };
  workspace.defer(close);
  return { workspace, path, core, db, runtime, model, close };
}
function place(core, memories, title, namespace = ns) {
  const current = memories.map(memory => ok(core.get({ namespace, memoryId: memory.id })).memory);
  return ok(core.applyPlacement({ namespace, proposal: { items: current.map(memory => ({
    memoryId: memory.id, parentIds: [], newL1: { title, parentL2Ids: [] } })) },
  expectedMemoryRevisions: current.map(memory => ({ memoryId: memory.id, revision: memory.revision })),
  expectedIndexRevision: ok(core.map({ namespace, purpose: 'classification' })).indexRevision }));
}
function rows(f, policy = prior, observe = () => {}, query = 'needle module', patch = {}) {
  const score = createQueryScore(query);
  return f.runtime.queryCandidateRows(physicalNs, { score: text => { observe(text); return score(text); },
    memoryLabel: text => [...text].slice(0, 120).join(''), sourceReceiptLimit: 4, sourceCandidatePolicy: policy, ...patch });
}
function pressure(t) {
  const f = fixture(t), target = admit(f.core, supportedFixture.target);
  for (let i = 0; i < 95; i++) admit(f.core, supportedFixture.noise(i), ns, 'context');
  place(f.core, [target], supportedFixture.topic);
  return { ...f, target };
}
function simple(t, title = 'needle module topic') {
  const f = fixture(t);
  for (let i = 0; i < 8; i++) admit(f.core, `needle module noise ${i}`);
  const target = admit(f.core, 'module stored in drawer');
  const placement = place(f.core, [target], title);
  return { ...f, target, topic: placement.createdMocs[0].id };
}
function publish(f, limit = 100) {
  const revision = ok(f.core.map({ namespace: ns })).indexRevision;
  let page = ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision: revision, limit }));
  while (!page.exhausted) page = ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision: revision, limit, cursor: page.nextCursor }));
  return page;
}

test('MP1 exact constructor policy rejects accessors/unknown/malformed without getter execution', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-moc-prior-input-' }), path = join(workspace.path, 'memory.sqlite');
  for (const sourceCandidatePolicy of [undefined, null, '', 1, {}, 'moc-prior-keyset-v2']) {
    assert.throws(() => openMemoryCore({ path, sourceCandidatePolicy }), error => error.code === 'invalid_input');
  }
  let calls = 0;
  assert.throws(() => openMemoryCore({ path, get sourceCandidatePolicy() { calls++; return prior; } }), error => error.code === 'invalid_input');
  assert.equal(calls, 0); assert.equal(existsSync(path), false);
  for (const policy of [legacy, prior]) { const core = openMemoryCore({ path, sourceCandidatePolicy: policy }); core.close(); }
  assert.deepEqual(bounds, { version: prior, scan: 20000, page: 256, top: 1024, sourceReceiptLimit: 4,
    topics: 64, titleBindings: 64, priorTopics: 2, priorMembers: 3, lexicalBatch: 2, priorBatch: 1 });
});

test('MP4 stable 2:1 mix preserves row identity/set, first2, duplicates and empty-prior order', () => {
  const make = id => ({ item: { type: 'unfiled', ref: { memoryId: id, revision: 1 }, label: id } });
  const lexical = Array.from({ length: 12 }, (_, i) => make(String(i)));
  const result = mixMocPriorCandidates(lexical, [lexical[10], lexical[11], lexical[10]]);
  assert.deepEqual(result.map(memoryId), ['0', '1', '10', '2', '3', '11', '4', '5', '6', '7', '8', '9']);
  assert.equal(mixMocPriorCandidates(lexical, []), lexical);
  assert.equal(mixMocPriorCandidates(lexical, [make('outside')]), lexical);
  assert.equal(new Set(result).size, lexical.length); assert.deepEqual(new Set(result), new Set(lexical));
  for (const row of result) assert.equal(row, lexical.find(x => memoryId(x) === memoryId(row)));
});

test('MP6 fixed96 public cold recall exposes/selects/packs supported target only with prior; exact control preserved', async t => {
  const f = pressure(t), targetId = f.target.id;
  assert.equal(fixtureSourceSha256, frozenSourceSha256);
  f.close();
  const before = sha(readFileSync(f.path));
  const outcomes = [];
  for (const policy of [legacy, prior]) {
    // Test-only ablation: keep the declared treatment expectation and all ports,
    // evidence and queries fixed; disabling only the policy must make it red.
    const installedPolicy = policy === prior && process.env.CAIRN_MOC_PRIOR_DISABLED_NEGATIVE === '1' ? legacy : policy;
    const model = ports(countOpenAITokens), core = openMemoryCore({ path: f.path, model, sourceCandidatePolicy: installedPolicy });
    try {
      const direct = ok(core.get({ namespace: ns, memoryId: targetId }));
      assert.equal(direct.memory.state, 'active'); assert.equal(direct.receipts[0].excerpt, supportedFixture.target);
      const placement = direct.placements[0];
      assert.ok(ok(core.map({ namespace: ns, parentRef: { mocId: placement.mocId, revision: placement.mocRevision }, tokenBudget: 4000 }))
        .items.some(item => item.ref?.childId === targetId));
      for (const query of [supportedFixture.exact, supportedFixture.broad]) {
        model.calls.length = 0;
        const result = ok(await core.recall({ readSet: [ns], query, contextMode: 'source-evidence', limit: 6 }));
        const selects = model.calls.filter(x => x.stage === 'select'), ranks = model.calls.filter(x => x.stage === 'rank');
        assert.equal(selects.length, 2); assert.equal(ranks.length, 1);
        for (const call of model.calls) {
          assert.ok(countOpenAITokens(modelRequestText(call.request.system, call.request.input)) <= 6000);
          assert.equal(call.request.maxOutputTokens, 1024); assert.ok(countOpenAITokens(JSON.stringify({ refs: call.refs })) <= 1024);
        }
        const visible = selects.some(call => call.request.input.maps.some(page => page.items.some(item =>
          itemRef(item, page.namespaceIndex).memoryId === targetId)));
        const expected = query === supportedFixture.exact || policy === prior;
        assert.equal(visible, expected, JSON.stringify({ policy, query, fixtureSourceSha256 }));
        assert.equal(result.memories.some(item => item.memory.id === targetId), expected);
        const units = result.memories.map(item => ({ text: JSON.stringify({ format: 'source-role-evidence-v1',
          sources: item.receipts.map(r => ({ recordedRole: r.role, text: r.excerpt })) }) }));
        const packed = packMixedAnswer({ question: { text: query, date: '2026-10-11' }, units, countTokens: countOpenAITokens });
        assert.equal(JSON.stringify(packed.request).includes(supportedFixture.target), expected);
        assert.ok(packed.inputTokens <= 6000);
        if (expected) assert.equal(result.memories.find(item => item.memory.id === targetId).receipts[0].excerpt, supportedFixture.target);
        outcomes.push({ policy, exact: query === supportedFixture.exact, visible, sourcePacked: expected,
          selectItems: selects.map(call => call.request.input.maps[0].items.length), inputTokens: packed.inputTokens });
      }
    } finally { core.close(); }
  }
  assert.equal(sha(readFileSync(f.path)), before);
  // This assertion becomes red if the candidate is disabled: no baseline-as-fix claim.
  assert.equal(outcomes.find(x => x.policy === prior && !x.exact).visible, true);
  t.diagnostic(JSON.stringify({ fixtureSourceSha256, outcomes, providerCalls: 0, qualityScore: null }));
});

test('MP1/4 no-topic and no-match exact parity, ordinary body/public map unchanged', async t => {
  const f = fixture(t);
  for (let i = 0; i < 12; i++) admit(f.core, `needle module ${i}`);
  const before = rows(f, legacy); assert.deepEqual(rows(f), before);
  place(f.core, [ok(f.core.list({ namespace: ns })).memories[0]], 'unrelated filing');
  assert.deepEqual(rows(f), rows(f, legacy));
  const old = openMemoryCore({ path: f.path, model: ports(), sourceCandidatePolicy: legacy });
  const mixed = openMemoryCore({ path: f.path, model: ports(), sourceCandidatePolicy: prior });
  try {
    assert.deepEqual(mixed.map({ namespace: ns }), old.map({ namespace: ns }));
    assert.deepEqual(await mixed.recall({ readSet: [ns], query: 'needle' }), await old.recall({ readSet: [ns], query: 'needle' }));
  } finally { mixed.close(); old.close(); }
});

test('MP4 misleading/unfiled and shared noisy topic retain lexical backstop without promised gain', t => {
  const f = simple(t, 'unrelated filing');
  assert.deepEqual(rows(f), rows(f, legacy));
  const current = ok(f.core.get({ namespace: ns, memoryId: f.target.id })).memory;
  ok(f.core.applyPlacement({ namespace: ns, proposal: { items: [{ memoryId: current.id, parentIds: [] }] },
    expectedMemoryRevisions: [{ memoryId: current.id, revision: current.revision }], expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision }));
  assert.deepEqual(rows(f), rows(f, legacy));
  const all = ok(f.core.list({ namespace: ns })).memories;
  place(f.core, all.slice(0, 5), 'needle module shared');
  const topicId = ok(f.core.map({ namespace: ns, purpose: 'classification' })).items.find(x => x.moc?.title === 'needle module shared').moc.id;
  for (const memory of all.slice(5)) ok(f.core.applyPlacement({ namespace: ns,
    proposal: { items: [{ memoryId: memory.id, parentIds: [topicId] }] },
    expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }], expectedIndexRevision: ok(f.core.map({ namespace: ns })).indexRevision }));
  const base = rows(f, legacy).rows, result = rows(f).rows;
  assert.equal(new Set(base.map(memoryId)).size, all.length);
  assert.deepEqual(result, base, 'first3 same-topic members are already lexical noise; target is not rescued');
  assert.ok(result.slice(3).some(row => memoryId(row) === f.target.id));
});

test('MP3 top2 topics and first3 lexical members, deterministic ID ties', t => {
  const f = fixture(t), topics = [];
  for (let i = 0; i < 9; i++) admit(f.core, `needle module noise ${i}`);
  for (let group = 0; group < 3; group++) {
    const members = Array.from({ length: 5 }, (_, i) => admit(f.core, `module member ${group}-${i}`));
    topics.push(place(f.core, members, `needle topic ${group}`).createdMocs[0].id);
  }
  const base = rows(f, legacy).rows, observed = [], actual = rows(f, prior, text => observed.push(text)).rows;
  const chosen = topics.sort().slice(0, 2), expected = chosen.flatMap(id => base.filter(row => row.item.ref.parentId === id).slice(0, 3));
  assert.deepEqual(actual, mixMocPriorCandidates(base, expected));
  assert.deepEqual(actual.slice(0, 2), base.slice(0, 2));
  assert.equal(observed.filter(text => /^needle topic [0-2]$/u.test(text)).length, 3);
  assert.equal(expected.length, 6); assert.equal(new Set(actual.map(memoryId)).size, base.length);
});

test('MP3 only64 opaque-ID topics scored; later high overlap cannot bypass bound', t => {
  const f = fixture(t);
  for (let i = 0; i < 65; i++) place(f.core, [admit(f.core, `module member ${i}`)], `needle title ${i}`);
  const topicRows = f.db.prepare('SELECT id,title FROM mocs ORDER BY id').all();
  const observed = []; rows(f, prior, text => observed.push(text));
  assert.deepEqual(observed.filter(text => /^needle title /u.test(text)).sort(), topicRows.slice(0, 64).map(x => x.title).sort());
  assert.ok(!observed.includes(topicRows[64].title));
});

test('MP3 exactly64 bindings allowed,65th overflow sentinel suppresses whole title', t => {
  const f = simple(t), observed = [];
  const insert = f.db.prepare('INSERT INTO moc_title_sources VALUES (?,?,?)');
  for (let i = 1; i < 64; i++) {
    const memory = admit(f.core, `source binding ${i}`); insert.run(f.topic, memory.id, memory.revision);
  }
  rows(f, prior, text => observed.push(text)); assert.ok(observed.includes('needle module topic'));
  observed.length = 0;
  const overflow = admit(f.core, 'overflow binding'); insert.run(f.topic, overflow.id, overflow.revision);
  assert.deepEqual(rows(f, prior, text => observed.push(text)), rows(f, legacy));
  assert.ok(!observed.includes('needle module topic'));
});

for (const corruption of ['stale', 'deleted', 'historical', 'awaiting', 'foreign', 'orphan', 'empty']) {
  test(`MP5 ${corruption} original binding suppresses title before scoring any invalid source text`, t => {
    const f = simple(t), extra = admit(f.core, 'excluded source secret marker');
    if (corruption === 'empty') f.db.prepare('DELETE FROM moc_title_sources WHERE moc_id=?').run(f.topic);
    else {
      f.db.prepare('INSERT INTO moc_title_sources VALUES (?,?,?)').run(f.topic, extra.id, extra.revision);
      if (corruption === 'stale') f.db.prepare('UPDATE moc_title_sources SET memory_revision=2 WHERE memory_id=?').run(extra.id);
      if (corruption === 'deleted') f.db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(extra.id);
      if (corruption === 'historical') f.db.prepare("UPDATE memories SET currentness='historical' WHERE id=?").run(extra.id);
      if (corruption === 'awaiting') f.db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(extra.id);
      if (corruption === 'foreign') f.db.prepare("UPDATE memories SET owner_id='foreign' WHERE id=?").run(extra.id);
      if (corruption === 'orphan') { f.db.exec('PRAGMA foreign_keys=OFF'); f.db.prepare('DELETE FROM memories WHERE id=?').run(extra.id); }
    }
    const observed = [];
    assert.deepEqual(rows(f, prior, text => observed.push(text)), rows(f, legacy));
    assert.ok(!observed.includes('needle module topic'));
    if (!['stale', 'empty'].includes(corruption)) assert.ok(!observed.includes('excluded source secret marker'));
  });
}

for (const excluded of ['title-source', 'source-memory', 'topic', 'placement', 'unpublished']) {
  test(`MP5 published projection ${excluded} exclusion prevents prior and leaves eligible backstop`, t => {
    const f = simple(t); publish(f);
    if (excluded === 'title-source') f.db.prepare('DELETE FROM index_title_sources WHERE moc_id=?').run(f.topic);
    if (excluded === 'source-memory') {
      const extra = admit(f.core, 'excluded published source marker');
      f.db.prepare('INSERT INTO moc_title_sources VALUES (?,?,?)').run(f.topic, extra.id, extra.revision);
      f.db.prepare('DELETE FROM index_memories WHERE id=?').run(extra.id);
    }
    if (excluded === 'topic') f.db.prepare('DELETE FROM index_mocs WHERE id=?').run(f.topic);
    if (excluded === 'placement') f.db.prepare('DELETE FROM index_memory_refs WHERE moc_id=?').run(f.topic);
    if (excluded === 'unpublished') f.db.exec('UPDATE index_generations SET published=0');
    const observed = [];
    assert.deepEqual(rows(f, prior, text => observed.push(text)), rows(f, legacy));
    assert.ok(!observed.includes('needle module topic')); assert.ok(rows(f).rows.some(row => memoryId(row) === f.target.id));
    assert.ok(!observed.includes('excluded published source marker'));
  });
}

test('MP5 old published generation survives staged rebuild; completed rebuild restores omitted prior', t => {
  const f = simple(t); publish(f);
  f.db.prepare('DELETE FROM index_title_sources WHERE moc_id=?').run(f.topic);
  const revision = ok(f.core.map({ namespace: ns })).indexRevision;
  const staged = ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision: revision, limit: 1 }));
  assert.equal(staged.state, 'staged'); assert.deepEqual(rows(f), rows(f, legacy));
  let page = staged;
  while (!page.exhausted) page = ok(f.core.rebuildIndex({ namespace: ns, expectedIndexRevision: revision, limit: 1, cursor: page.nextCursor }));
  assert.equal(memoryId(rows(f).rows[2]), f.target.id);
});

test('MP5 score/body-label/title-score callbacks cannot return stale prior rows', t => {
  for (const phase of ['body-score', 'label', 'title-score']) {
    const f = simple(t), current = ok(f.core.get({ namespace: ns, memoryId: f.target.id })).memory;
    // Direct-storage adversarial control only: the same connection owns the
    // transaction. A normal second-connection write is blocked storage_busy.
    const storage = createMocStorage({ db: f.db,
      epoch: namespace => f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?')
        .get(namespace.ownerId, namespace.scope, namespace.projectId).epoch,
      receiptKey: source => sha(JSON.stringify(source)), assertIndexAvailable: () => {},
    });
    let changed = false;
    const change = () => { if (!changed) {
      changed = true;
      f.db.prepare("UPDATE memories SET content='replacement body',revision=revision+1 WHERE id=?").run(current.id);
      f.db.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=? AND scope=? AND project_id=?')
        .run(ns.ownerId, ns.scope, '');
    } };
    const score = createQueryScore('needle module');
    assert.throws(() => storage.queryCandidateRows(physicalNs, {
      sourceCandidatePolicy: prior, sourceReceiptLimit: 4,
      score: text => { if (phase === 'body-score' && text === current.content || phase === 'title-score' && text === 'needle module topic') change(); return score(text); },
      memoryLabel: text => { if (phase === 'label') change(); return text; },
    }), error => error.code === 'index_revision_conflict', phase);
    assert.equal(changed, true);
  }
});

test('MP5 public count/select/rank callback correction is fenced before final use', async t => {
  for (const phase of ['count', 'select', 'rank']) {
    const f = simple(t), model = ports(), core = openMemoryCore({ path: f.path, model, sourceCandidatePolicy: prior });
    f.workspace.defer(() => core.close());
    const current = ok(core.get({ namespace: ns, memoryId: f.target.id })).memory;
    let changed = false;
    const change = () => { if (!changed) { changed = true; ok(core.correct({ namespace: ns, memoryId: current.id,
      expectedRevision: current.revision, content: 'replacement body', kind: 'fact', receipt: receipt(phase, 'replacement source') })); } };
    if (phase === 'count') model.countTokens = text => { if (text.includes('module stored in drawer')) change(); return 1; };
    else { const original = model[phase]; model[phase] = request => { change(); return original(request); }; }
    const result = await core.recall({ readSet: [ns], query: 'needle module', contextMode: 'source-evidence' });
    assert.equal(changed, true); assert.equal(result.ok, false);
    assert.ok(['revision_conflict', 'index_revision_conflict'].includes(result.error.code));
  }
});

test('MP1/2 cursor binds every fixed prior bound, source mode; body recall bypasses policy', async t => {
  const f = fixture(t);
  for (let i = 0; i < 201; i++) admit(f.core, `needle module ${i}`);
  const captured = [], model = ports(text => { try {
    const cursor = JSON.parse(text)?.value?.nextCursor;
    if (cursor) captured.push(JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url')));
  } catch { /* Other frames are not map pages. */ } return 1; });
  const core = openMemoryCore({ path: f.path, model, sourceCandidatePolicy: prior }); f.workspace.defer(() => core.close());
  for (const contextMode of ['source-evidence', 'rationale-evidence']) {
    captured.length = 0;
    ok(await core.recall({ readSet: [ns], query: 'needle', contextMode }));
    const b = captured[0]; assert.equal(b.policy, prior); assert.equal(b.sourceMode, contextMode);
    for (const field of ['scan', 'top', 'topics', 'titleBindings', 'priorTopics', 'priorMembers', 'lexicalBatch', 'priorBatch']) assert.equal(b[field], bounds[field]);
    assert.equal(b.physicalPage, 256); assert.equal(b.sourceReceiptLimit, 4);
  }
  captured.length = 0; ok(await core.recall({ readSet: [ns], query: 'needle' }));
  assert.equal(captured[0].policy, 'literal-current-memory-overlap-v2'); assert.equal(captured[0].topics, undefined);
});

test('MP2 same eligible row payloads/set and Unicode literal semantics unchanged', t => {
  const f = simple(t);
  const cjk = createQueryScore('記憶 module'); assert.equal(cjk('記憶 module'), 2); assert.equal(cjk('我的記憶系統 modules'), 0);
  const base = rows(f, legacy), mixed = rows(f);
  assert.equal(base.epoch, mixed.epoch); assert.equal(base.scanExhausted, mixed.scanExhausted);
  assert.deepEqual([...base.rows].sort((a, b) => memoryId(a).localeCompare(memoryId(b))),
    [...mixed.rows].sort((a, b) => memoryId(a).localeCompare(memoryId(b))));
  assert.throws(() => rows(f, prior, () => {}, 'needle', { sourceReceiptLimit: 0 }), error => error.code === 'invalid_input');
});

test('MP2 first4 receipt bound and canonical validation apply unchanged to prior', t => {
  const f = simple(t), insert = f.db.prepare(`INSERT INTO receipts
    (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES (?,?,?,'synthetic','moc-prior',?,'user',?,'2026-01-01')`);
  for (let i = 2; i <= 5; i++) {
    const id = `zz-receipt-${i}`, text = i === 5 ? 'fifthonly hidden source' : `plain source ${i}`;
    insert.run(id, f.target.id, sha(JSON.stringify(receipt(id, text))), id, text);
  }
  const observed = [];
  rows(f, prior, text => observed.push(text), 'fifthonly');
  assert.ok(!observed.includes('fifthonly hidden source'));
  const first = f.db.prepare('SELECT id FROM receipts WHERE memory_id=? ORDER BY id LIMIT 1').get(f.target.id);
  f.db.prepare("UPDATE receipts SET excerpt='corrupted canonical source' WHERE id=?").run(first.id);
  assert.throws(() => rows(f), error => error.code === 'storage_error');
});

test('MP2 a title cannot rescue a candidate pruned from the unchanged top1024', t => {
  const f = fixture(t);
  for (let i = 0; i < 1024; i++) admit(f.core, `needle module ${i}`);
  const excluded = admit(f.core, 'storage without overlap'); place(f.core, [excluded], 'needle module excluded');
  const observed = [], base = rows(f, legacy), actual = rows(f, prior, text => observed.push(text));
  assert.equal(actual.rows.length, 1024); assert.equal(actual.scanExhausted, false);
  assert.deepEqual(actual, base); assert.ok(!actual.rows.some(row => memoryId(row) === excluded.id));
  assert.ok(!observed.includes('needle module excluded'));
});

test('MP3 exact projected binding point reads stay indexed without view materialization', t => {
  const f = simple(t);
  for (const published of [false, true]) {
    if (published) publish(f);
    const checks = [
      [`SELECT memory_id FROM index_read_title_sources WHERE moc_id=? AND memory_id=? AND memory_revision=?`,
        [f.topic, f.target.id, 2]],
      [`SELECT id FROM index_read_memories WHERE owner_id=? AND scope=? AND project_id=? AND id=? AND revision=?
        AND deleted=0 AND currentness='current' AND review_state!='awaiting'`, [ns.ownerId, ns.scope, '', f.target.id, 2]],
      [`SELECT s.memory_revision,source.id,source.revision FROM moc_title_sources s
        LEFT JOIN memories source ON source.id=s.memory_id WHERE s.moc_id=? ORDER BY s.memory_id LIMIT ?`, [f.topic,65]],
    ];
    for (const [sql, args] of checks) {
      const details = f.db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...args).map(row => row.detail);
      assert.ok(!details.some(text => /MATERIALIZE|\bSCAN\b/u.test(text)), JSON.stringify({ published, sql, details }));
      assert.ok(details.some(text => /SEARCH .*USING/u.test(text)), JSON.stringify(details));
      t.diagnostic(JSON.stringify({ published, sql, details }));
    }
  }
});

test('MP7 owned scratch removes resources after success and intentional assertion failure', async () => {
  for (const fail of [false, true]) {
    const workspace = createTestWorkspace(null, { prefix: 'cairn-moc-prior-cleanup-' }), path = join(workspace.path, 'memory.sqlite');
    let caught = false;
    try {
      const core = openMemoryCore({ path }); workspace.defer(() => core.close());
      admit(core, 'synthetic cleanup'); if (fail) assert.fail('intentional diagnostic failure');
    } catch (error) { caught = true; assert.equal(error.message, 'intentional diagnostic failure'); }
    finally { await workspace.cleanup(); }
    assert.equal(caught, fail); assert.equal(existsSync(workspace.path), false);
  }
});

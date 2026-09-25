import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { openMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { createQueryScore } from '../query-candidates.mjs';

const namespace = { ownerId: 'bounded-keyset-tests', scope: 'personal', projectId: null };
const value = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const receipt = (eventId, excerpt) => ({ client: 'synthetic', sessionId: 'keyset',
  eventId, role: 'user', excerpt });
const admit = (core, ns, content, excerpt = content, eventId = content) => value(core.admit({
  namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt(eventId, excerpt)],
})).memory;
const ref = (item, namespaceIndex) => ({ namespaceIndex, ...(item.type === 'unfiled'
  ? item.ref : { memoryId: item.ref.childId, revision: item.ref.childRevision }) });
const syntheticId = index => `synthetic-${String(index).padStart(6, '0')}`;
const queryRows = (runtime, query, observe = () => {}, patch = {}) => runtime.queryCandidateRows(
  { ...namespace, projectId: '' }, { score: text => { observe(text); return createQueryScore(query)(text); },
    memoryLabel: text => [...text].slice(0, 120).join(''), sourceReceiptLimit: 4,
    sourceCandidatePolicy: 'bounded-keyset-v1', ...patch });
// Direct SQL seeds only deterministic scan-boundary controls in a fresh test DB;
// the real public admission and capture regressions below use their public ports.
function seedPhysical(db, count, ownerId = namespace.ownerId, content = index => `plain row ${index}`,
  source = content) {
  const insert = db.prepare(`INSERT INTO memories
    (id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,
      deleted,created_at,updated_at,filing_status,currentness)
    VALUES (?,?,'personal','',?,?,'fact','explicit',1,1,0,'2026-01-01','2026-01-01','unfiled','current')`);
  const receipt = db.prepare(`INSERT INTO receipts
    (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES (?,?,?,'synthetic','keyset',?,'user',?,'2026-01-01')`);
  db.exec('BEGIN');
  try {
    for (let index = 1; index <= count; index += 1) {
      const id = syntheticId(index);
      const text = content(index);
      const excerpt = source(index);
      const eventId = `${ownerId}-event-${index}`;
      const receiptKey = createHash('sha256').update(JSON.stringify({ client: 'synthetic',
        sessionId: 'keyset', eventId, role: 'user', excerpt })).digest('hex');
      insert.run(id, ownerId, `${ownerId}-fingerprint-${index}`, text);
      receipt.run(`${ownerId}-receipt-${index}`, id, receiptKey, eventId, excerpt);
    }
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
}
function addRawReceipt(db, memoryId, receiptId, excerpt) {
  const source = receipt(receiptId, excerpt);
  const receiptKey = createHash('sha256').update(JSON.stringify(source)).digest('hex');
  db.prepare(`INSERT INTO receipts
    (id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at)
    VALUES (?,?,?,'synthetic','keyset',?,'user',?,'2026-01-01')`)
    .run(receiptId, memoryId, receiptKey, receiptId, excerpt);
}
function model() {
  return { contextWindow: 16_384, countTokens: () => 1,
    select: async ({ input }) => ({ refs: input.maps.flatMap(page => page.items
      .filter(item => item.label?.split(/\s+/u).includes(input.query))
      .map(item => ref(item, page.namespaceIndex))).slice(0, input.maxRefs) }),
    rank: async ({ input }) => ({ refs: input.candidates.slice(0, input.limit)
      .map(item => ({ namespaceIndex: item.namespaceIndex,
        memoryId: item.memory.id, revision: item.memory.revision })) }),
  };
}

test('K1 constructor rejects malformed own policy before storage/model access', () => {
  const path = join(tmpdir(), 'nonexistent-keyset-constructor', 'memory.sqlite');
  for (const sourceCandidatePolicy of [null, undefined, '', 'bounded-keyset-v2', 1, {}]) {
    assert.throws(() => openMemoryCore({ path, sourceCandidatePolicy }),
      error => error?.code === 'invalid_input');
  }
  let getterCalls = 0;
  const input = { path, get sourceCandidatePolicy() { getterCalls += 1; return 'bounded-keyset-v1'; } };
  assert.throws(() => openMemoryCore(input), error => error?.code === 'invalid_input');
  assert.equal(getterCalls, 0);
});

test('K7 public-admit source beyond the 1024 current-ID prefix is opt-in reachable', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-keyset-public-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'memory.sqlite');
  const old = openMemoryCore({ path, model: model() });
  t.after(() => old.close());
  const admissions = [];
  for (let index = 0; index < 1025; index += 1) {
    const text = `marker${String(index).padStart(5, '0')} retained source`;
    const memory = value(old.admit({ namespace, memory: { content: text, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'keyset', eventId: `event-${index}`,
        role: 'user', excerpt: text }] })).memory;
    admissions.push({ ...memory, text });
  }
  admissions.sort((left, right) => left.id.localeCompare(right.id));
  const target = admissions.at(-1);
  const query = target.text.split(' ')[0];
  assert.equal(value(old.get({ namespace, memoryId: target.id })).receipts[0].excerpt, target.text);
  const input = { readSet: [namespace], query, contextMode: 'source-evidence', limit: 1 };
  assert.ok(!value(await old.recall(input)).memories.some(item => item.memory.id === target.id));
  const selectionFrames = [];
  const expandedModel = model();
  const select = expandedModel.select;
  expandedModel.select = async request => {
    selectionFrames.push(request.input.maps.flatMap(page => page.items));
    return select(request);
  };
  const expanded = openMemoryCore({ path, model: expandedModel,
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  t.after(() => expanded.close());
  const result = value(await expanded.recall(input));
  assert.ok(selectionFrames.flat().some(item => item.type === 'unfiled' &&
    item.ref?.memoryId === target.id), 'unfiled target MOC-visible');
  assert.equal(result.memories[0]?.memory.id, target.id);
  assert.equal(result.memories[0]?.receipts[0]?.excerpt, target.text);
  assert.equal(result.coverage, 'budget_exhausted'); // 1,025 eligible rows prune one top-K slot.
  const rationale = value(await expanded.recall({ ...input, contextMode: 'rationale-evidence' }));
  assert.equal(rationale.memories[0]?.memory.id, target.id);
  assert.equal(rationale.memories[0]?.receipts[0]?.excerpt, target.text);
  value(old.forget({ namespace, memoryId: admissions[0].id,
    expectedRevision: admissions[0].revision }));
  assert.equal(value(await old.recall(input)).memories[0]?.memory.id, target.id);
  assert.equal(value(await expanded.recall(input)).memories[0]?.memory.id, target.id);
  const runtime = createMemoryRuntime({ path });
  try {
    const arguments_ = { score: createQueryScore(query), memoryLabel: text => [...text].slice(0, 120).join(''),
      sourceReceiptLimit: 4 };
    const ns = { ...namespace, projectId: '' };
    const original = runtime.queryCandidateRows(ns, arguments_);
    const keyset = runtime.queryCandidateRows(ns, { ...arguments_, sourceCandidatePolicy: 'bounded-keyset-v1' });
    assert.deepEqual(keyset.rows, original.rows);
    assert.equal(keyset.scanExhausted, original.scanExhausted);
  } finally { runtime.close(); }
  for (const placement of ['correct', 'misfiled']) {
    const source = `${placement}marker retained source`;
    const memory = admit(old, namespace, `plain generated summary ${placement}`, source, placement);
    value(old.applyPlacement({ namespace,
      proposal: { items: [{ memoryId: memory.id, parentIds: [], newL1: {
        title: placement === 'correct' ? 'Correct source category' : 'Unrelated filing category',
        parentL2Ids: [],
      } }] },
      expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
      expectedIndexRevision: value(old.map({ namespace })).indexRevision }));
    for (const contextMode of ['source-evidence', 'rationale-evidence']) {
      selectionFrames.length = 0;
      const recalled = value(await expanded.recall({ readSet: [namespace],
        query: `${placement}marker`, contextMode, limit: 1 }));
      const visible = selectionFrames.flat().find(item => item.ref?.childId === memory.id);
      assert.equal(visible?.type, 'ref', `${placement}/${contextMode} MOC-visible`);
      assert.equal(recalled.memories[0]?.memory.id, memory.id,
        `${placement}/${contextMode} final-returned`);
      assert.equal(recalled.memories[0]?.receipts[0]?.excerpt, source,
        `${placement}/${contextMode} source-present`);
    }
  }
});

test('K3–K6 keyset scans indexed physical IDs, keeps top 1024, and reports pruning', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-keyset-boundary-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'memory.sqlite');
  const core = openMemoryCore({ path, model: model() });
  const db = new DatabaseSync(path);
  const runtime = createMemoryRuntime({ path });
  t.after(() => { runtime.close(); db.close(); core.close(); });
  assert.deepEqual(queryRows(runtime, 'needle').rows, []);
  assert.equal(queryRows(runtime, 'needle').scanExhausted, true);
  seedPhysical(db, 1025, namespace.ownerId,
    index => index === 1025 ? 'needle final body' : `plain body ${index}`,
    index => index === 1025 ? 'needle final source' : `plain receipt ${index}`);
  const scored = [];
  const page = queryRows(runtime, 'needle', text => scored.push(text));
  assert.equal(scored.length, 2050);
  assert.ok(scored.includes('needle final body'));
  assert.ok(scored.includes('needle final source'));
  assert.equal(page.rows.length, 1024);
  assert.equal(page.rows[0].item.ref.memoryId, syntheticId(1025));
  assert.equal(page.rows[0].item.label, 'needle final body'); // Body/source tie keeps body.
  assert.equal(page.scanExhausted, false);
  assert.ok(!page.rows.some(row => row.item.ref.memoryId === syntheticId(1024)));
  const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT id,revision FROM memories
    INDEXED BY capture_current_memories WHERE owner_id=? AND scope=? AND project_id=?
      AND deleted=0 AND currentness='current' AND id>? ORDER BY id LIMIT ?`)
    .all(namespace.ownerId, 'personal', '', '', 256);
  assert.ok(plan.some(row => row.detail.includes('SEARCH memories USING INDEX capture_current_memories')));
  assert.ok(plan.every(row => !row.detail.includes('TEMP B-TREE')));
});

test('K6 above-prefix results equal a complete same-policy authorized-prefix oracle', t => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-keyset-oracle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'memory.sqlite');
  const core = openMemoryCore({ path });
  const db = new DatabaseSync(path);
  const runtime = createMemoryRuntime({ path });
  t.after(() => { runtime.close(); db.close(); core.close(); });
  seedPhysical(db, 1131, namespace.ownerId,
    index => `${index % 17 === 0 ? 'amber copper ' : index % 7 === 0 ? 'amber ' : ''}plain body ${index}`,
    index => `${index % 11 === 0 ? 'amber copper ' : index % 5 === 0 ? 'copper ' : ''}plain source ${index}`);
  for (let index = 23; index <= 1131; index += 23) {
    addRawReceipt(db, syntheticId(index), `zz-extra-${index}-2`, `amber copper second source ${index}`);
    addRawReceipt(db, syntheticId(index), `zz-extra-${index}-3`, `amber third source ${index}`);
    addRawReceipt(db, syntheticId(index), `zz-extra-${index}-4`, `copper fourth source ${index}`);
  }
  const score = createQueryScore('amber copper');
  const preview = text => [...text].slice(0, 120).join('');
  // Test-only full oracle: materialize exactly this authorized physical prefix,
  // independently score body and the first four stable receipts, then sort and truncate.
  const physical = db.prepare(`SELECT id,content FROM memories
    WHERE owner_id=? AND scope='personal' AND project_id='' AND deleted=0
      AND currentness='current' ORDER BY id LIMIT 20000`).all(namespace.ownerId);
  assert.equal(physical.length, 1131);
  const source = db.prepare('SELECT excerpt FROM receipts WHERE memory_id=? ORDER BY id LIMIT 4');
  const oracle = physical.map(row => {
    const bodyScore = score(row.content);
    let bestScore = bodyScore;
    let label = preview(row.content);
    for (const { excerpt } of source.all(row.id)) {
      const sourceScore = score(excerpt);
      if (sourceScore > bestScore) { bestScore = sourceScore; label = preview(excerpt); }
    }
    return { id: row.id, score: bestScore, label };
  }).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 1024);
  const actual = runtime.queryCandidateRows({ ...namespace, projectId: '' }, {
    score, memoryLabel: preview, sourceReceiptLimit: 4,
    sourceCandidatePolicy: 'bounded-keyset-v1',
  });
  assert.deepEqual(actual.rows.map(row => ({ id: row.item.ref.memoryId, label: row.item.label })),
    oracle.map(({ id, label }) => ({ id, label })));
  assert.equal(actual.scanExhausted, false);
});

test('K8 public capture links a beyond-prefix original receipt to sourced recall', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-keyset-capture-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'memory.sqlite');
  const scripted = { ...model(),
    extract: async ({ input }) => ({ items: input.messages.map((message, index) => ({
      content: message.content, kind: 'fact', confidence: 1, sourceIndices: [index],
    })) }),
    classify: async () => { throw new Error('synthetic_classification_unavailable'); },
  };
  const core = openMemoryCore({ path, model: scripted, sourceCandidatePolicy: 'bounded-keyset-v1' });
  t.after(() => core.close());
  const captured = [];
  for (let batch = 0; batch < 410; batch += 1) {
    const messages = Array.from({ length: batch === 409 ? 4 : 5 }, (_, offset) => {
      const index = batch * 5 + offset;
      return { id: `message-${index}`, role: 'user',
        content: `capturemarker${String(index).padStart(5, '0')} original source` };
    });
    const result = value(await core.capture({ namespace, client: 'synthetic',
      sessionId: 'keyset-capture', eventId: `batch-${batch}`, messages }));
    assert.equal(result.admission.memories.length, messages.length);
    captured.push(...result.admission.memories.map((memory, offset) => ({ ...memory,
      source: messages[offset].content, eventId: messages[offset].id })));
  }
  captured.sort((left, right) => left.id.localeCompare(right.id));
  const target = captured.at(-1);
  assert.equal(captured.length, 2049);
  const direct = value(core.get({ namespace, memoryId: target.id }));
  assert.equal(direct.receipts[0].eventId, target.eventId);
  assert.equal(direct.receipts[0].excerpt, target.source);
  const query = target.source.split(' ')[0];
  const result = value(await core.recall({ readSet: [namespace], query,
    contextMode: 'source-evidence', limit: 1 }));
  assert.equal(result.memories[0]?.memory.id, target.id);
  assert.equal(result.memories[0]?.receipts[0]?.excerpt, target.source);
});

test('K9 opt-in source mode preserves exact namespaces and public lifecycle exclusion', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-keyset-lifecycle-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'memory.sqlite');
  const core = openMemoryCore({ path, model: model(), sourceCandidatePolicy: 'bounded-keyset-v1' });
  t.after(() => core.close());
  const project = { ...namespace, scope: 'project', projectId: 'project' };
  const foreign = { ...namespace, ownerId: 'foreign-keyset' };
  const original = admit(core, namespace, 'plain memory', 'needlesource original', 'original');
  const projectMemory = admit(core, project, 'plain project', 'projectsource private', 'project');
  admit(core, foreign, 'plain foreign', 'foreignsource hidden', 'foreign');
  const recall = (query, readSet = [namespace]) => core.recall({ readSet, query,
    contextMode: 'source-evidence', limit: 1 });
  assert.equal(value(await recall('needlesource')).memories[0].memory.id, original.id);
  assert.equal(value(await recall('projectsource', [namespace, project])).memories[0]
    .memory.id, projectMemory.id);
  assert.deepEqual(value(await recall('foreignsource')).memories, []);
  assert.deepEqual(value(await core.recall({ readSet: [namespace], query: 'needlesource',
    limit: 1 })).memories, []); // Body-only recall never activates the opt-in.
  const duplicate = admit(core, namespace, 'plain memory', 'freshsource added', 'dedup');
  assert.equal(duplicate.id, original.id);
  assert.equal(value(await recall('freshsource')).memories[0].memory.id, original.id);
  const current = value(core.get({ namespace, memoryId: original.id })).memory;
  const corrected = value(core.correct({ namespace, memoryId: original.id,
    expectedRevision: current.revision, content: 'corrected memory', kind: 'fact',
    receipt: receipt('corrected', 'correctedsource current') })).memory;
  assert.deepEqual(value(await recall('needlesource')).memories, []);
  assert.equal(value(await recall('correctedsource')).memories[0].memory.id, original.id);
  value(core.forget({ namespace, memoryId: original.id, expectedRevision: corrected.revision }));
  assert.deepEqual(value(await recall('correctedsource')).memories, []);
  const predecessor = admit(core, namespace, 'predecessor memory', 'oldsource historical', 'predecessor');
  const successor = value(core.supersede({ namespace, memoryId: predecessor.id,
    expectedRevision: predecessor.revision, replacement: { content: 'successor memory', kind: 'fact' },
    receipts: [receipt('successor', 'newsource active')] })).memory;
  assert.deepEqual(value(await recall('oldsource')).memories, []);
  assert.equal(value(await recall('newsource')).memories[0].memory.id, successor.id);
  assert.equal(value(core.get({ namespace, memoryId: predecessor.id })).memory.state, 'historical');
  const reopened = openMemoryCore({ path, model: model(),
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  try {
    assert.equal(value(await reopened.recall({ readSet: [namespace], query: 'newsource',
      contextMode: 'source-evidence', limit: 1 })).memories[0].memory.id, successor.id);
  } finally { reopened.close(); }
});

test('K9 source correction during count/select/rank fails closed on stale snapshot', async t => {
  for (const phase of ['count', 'select', 'rank']) {
    const directory = mkdtempSync(join(tmpdir(), 'cairn-keyset-freshness-'));
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const path = join(directory, 'memory.sqlite');
    const scripted = model();
    const core = openMemoryCore({ path, model: scripted,
      sourceCandidatePolicy: 'bounded-keyset-v1' });
    t.after(() => core.close());
    const saved = admit(core, namespace, 'plain generated interpretation',
      'violet keystone retained source', `freshness-${phase}`);
    let changed = false;
    const change = () => {
      if (changed) return;
      changed = true;
      value(core.correct({ namespace, memoryId: saved.id, expectedRevision: saved.revision,
        content: 'corrected interpretation', kind: 'fact',
        receipt: receipt(`corrected-${phase}`, 'corrected retained source') }));
    };
    const count = scripted.countTokens;
    const select = scripted.select;
    const rank = scripted.rank;
    scripted.countTokens = text => {
      if (phase === 'count') {
        try {
          const parsed = JSON.parse(text);
          if (parsed?.value?.items?.some(item => item.label?.includes('violet keystone'))) change();
        } catch { /* Other model frames are not map pages. */ }
      }
      return count(text);
    };
    scripted.select = async request => {
      if (phase === 'select') change();
      return select(request);
    };
    scripted.rank = async request => {
      if (phase === 'rank') change();
      return rank(request);
    };
    const result = await core.recall({ readSet: [namespace], query: 'violet',
      contextMode: 'source-evidence' });
    assert.equal(changed, true, phase);
    assert.equal(result.ok, false, phase);
    assert.ok(['revision_conflict', 'index_revision_conflict'].includes(result.error.code),
      JSON.stringify({ phase, result }));
  }
});

test('K9 first-four source validation and active projection remain fail-closed', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-keyset-projection-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'memory.sqlite');
  let selections = 0;
  const scripted = model();
  const select = scripted.select;
  scripted.select = async request => { selections += 1; return select(request); };
  const core = openMemoryCore({ path, model: scripted, sourceCandidatePolicy: 'bounded-keyset-v1' });
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); core.close(); });
  const target = admit(core, namespace, 'plain body', 'plain source', 'first');
  for (let ordinal = 2; ordinal <= 5; ordinal += 1) {
    addRawReceipt(db, target.id, `zz-${ordinal}`, ordinal === 5 ? 'fifthonly hidden'
      : `plain source ${ordinal}`);
  }
  const first = db.prepare('SELECT id,excerpt FROM receipts WHERE memory_id=? ORDER BY id LIMIT 1')
    .get(target.id);
  assert.deepEqual(value(await core.recall({ readSet: [namespace], query: 'fifthonly',
    contextMode: 'source-evidence' })).memories, []);
  db.prepare('UPDATE receipts SET excerpt=? WHERE id=?').run('tampered receipt', first.id);
  selections = 0;
  const poisoned = await core.recall({ readSet: [namespace], query: 'plain',
    contextMode: 'source-evidence' });
  assert.equal(poisoned.ok, false);
  assert.equal(poisoned.error.code, 'storage_error');
  assert.equal(selections, 0);
  db.prepare('UPDATE receipts SET excerpt=? WHERE id=?').run(first.excerpt, first.id);
  const excluded = admit(core, namespace, 'excluded body', 'excluded source', 'excluded');
  const revision = value(core.map({ namespace })).indexRevision;
  let page = value(core.rebuildIndex({ namespace, expectedIndexRevision: revision, limit: 100 }));
  while (!page.exhausted) page = value(core.rebuildIndex({ namespace,
    expectedIndexRevision: revision, limit: 100, cursor: page.nextCursor }));
  db.prepare('DELETE FROM index_memories WHERE id=?').run(excluded.id);
  db.prepare('UPDATE receipts SET excerpt=? WHERE memory_id=?').run('poison excluded', excluded.id);
  const runtime = createMemoryRuntime({ path });
  try {
    const scored = [];
    const result = queryRows(runtime, 'excluded', text => scored.push(text));
    assert.equal(result.rows.length, 1);
    assert.ok(!scored.some(text => text.includes('excluded') || text.includes('poison')));
  } finally { runtime.close(); }
  assert.deepEqual(value(await core.recall({ readSet: [namespace], query: 'excluded',
    contextMode: 'source-evidence' })).memories, []);
});

test('K5 private recall cursors bind the opt-in policy and source mode', async t => {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-keyset-cursor-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, 'memory.sqlite');
  const captured = [];
  const scripted = model();
  scripted.countTokens = text => {
    try {
      const cursor = JSON.parse(text)?.value?.nextCursor;
      if (typeof cursor === 'string') captured.push(JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url')));
    } catch { /* Other model frames are not map pages. */ }
    return 1;
  };
  const old = openMemoryCore({ path, model: scripted });
  const expanded = openMemoryCore({ path, model: scripted,
    sourceCandidatePolicy: 'bounded-keyset-v1' });
  const db = new DatabaseSync(path);
  t.after(() => { db.close(); expanded.close(); old.close(); });
  seedPhysical(db, 201);
  const input = { readSet: [namespace], query: 'absent', contextMode: 'source-evidence' };
  value(await old.recall(input));
  const oldBinding = captured[0];
  captured.length = 0;
  value(await expanded.recall(input));
  const newBinding = captured[0];
  assert.equal(oldBinding.policy, 'literal-current-memory-overlap-v2');
  assert.equal(oldBinding.scan, 1024);
  assert.equal(newBinding.policy, 'bounded-keyset-v1');
  assert.deepEqual([newBinding.scan, newBinding.physicalPage, newBinding.top,
    newBinding.sourceReceiptLimit], [20_000, 256, 1_024, 4]);
  assert.equal(oldBinding.sourceMode, newBinding.sourceMode);
  assert.notDeepEqual(newBinding, oldBinding);
  captured.length = 0;
  value(await expanded.recall({ ...input, contextMode: 'rationale-evidence' }));
  assert.equal(captured[0].sourceMode, 'rationale-evidence');
  captured.length = 0;
  value(await expanded.recall({ readSet: [namespace], query: 'absent' }));
  assert.equal(captured[0].policy, oldBinding.policy); // Body-only remains the old path.
});

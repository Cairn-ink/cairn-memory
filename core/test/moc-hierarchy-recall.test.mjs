import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openMemoryCore } from '../contract.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// Input-only scripted fixtures establish mechanics, not real-model semantics.
const personal = { ownerId: 'integrated-moc', scope: 'personal', projectId: null };
const project = { ...personal, scope: 'project', projectId: 'project' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const groupRef = ({ namespaceIndex, mocId, revision }) => ({ namespaceIndex, mocId, revision });
const memoryRef = item => item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
  ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
const rankRef = item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision });
const selectGroups = ({ input }) => ({ refs: input.maps.flatMap(map => map.groups.slice(0, input.maxRefsPerNamespace))
  .slice(0, input.maxRefs).map(groupRef) });
const select = ({ input }) => ({ refs: input.maps.flatMap(map => map.items.flatMap(item => {
  const ref = memoryRef(item);
  return ref && item.label.includes('fallback') ? [{ namespaceIndex: map.namespaceIndex, ...ref }] : [];
})).slice(0, input.maxRefs) });
const rank = ({ input }) => ({ refs: input.candidates.filter(item => item.receipts.some(receipt => receipt.excerpt.includes('hierarchy')))
  .concat(input.candidates.filter(item => !item.receipts.some(receipt => receipt.excerpt.includes('hierarchy')))).slice(0, input.limit).map(rankRef) });

function fixture(t, overrides = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-integrated-moc-' });
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
      kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => {
      const [domain, topicText] = memory.content.split(':')[0].split(' / ');
      if (domain === 'Unfiled') return { memoryId: memory.id, parentIds: [] };
      const topics = topicText.split('+');
      const groups = input.map.filter(item => item.type === 'moc').map(item => item.moc);
      const found = groups.filter(group => group.level === 'L1' && topics.includes(group.title));
      const absent = topics.filter(topic => !found.some(group => group.title === topic));
      assert.ok(absent.length <= 1);
      const parent = groups.find(group => group.level === 'L2' && group.title === domain);
      return { memoryId: memory.id, parentIds: found.map(group => group.id),
        ...(absent.length ? { newL1: { title: absent[0], parentL2Ids: parent ? [parent.id] : [],
          ...(parent || domain === 'Orphan' ? {} : { newL2Title: domain }) } } : {}) };
    }) }), selectGroups, select, rank, ...overrides };
  for (const method of ['selectGroups', 'select', 'rank']) {
    const adapter = model[method];
    if (typeof adapter === 'function') model[method] = async request => {
      calls.push({ method, system: request.system, input: structuredClone(request.input), maxOutputTokens: request.maxOutputTokens });
      return adapter(request);
    };
  }
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model });
  workspace.defer(() => core.close());
  return { core, model, calls, workspace };
}
async function capture(core, namespace = personal, count = 40, content = index =>
  `Work / ${index < 5 ? 'Alpha' : index < 10 ? 'Beta' : index === 10 ? 'Alpha+Beta' : index % 2 ? 'Alpha' : 'Beta'}: hierarchy receipt ${index}.`, event = 'batch') {
  for (let start = 0; start < count; start += 5) {
    const messages = Array.from({ length: Math.min(5, count - start) }, (_, offset) => ({
      id: `${event}-source-${start + offset}`, role: 'user', content: content(start + offset) }));
    const result = ok(await core.capture({ namespace, client: 'offline', sessionId: 'session',
      eventId: `${event}-${start}`, messages }));
    assert.equal(result.classification.status, 'applied', JSON.stringify(result.classification));
    assert.equal(result.admission.memories.length, messages.length);
  }
}
function snapshot(core, readSet = [personal]) {
  return readSet.map(namespace => {
    const details = []; let page;
    do {
      page = ok(core.list({ namespace, limit: 100, ...(page ? { cursor: page.nextCursor } : {}) }));
      details.push(...page.memories.map(memory => ok(core.get({ namespace, memoryId: memory.id }))));
    } while (!page.exhausted && page.nextCursor !== null);
    const maps = []; page = undefined;
    do {
      page = ok(core.map({ namespace, limit: 100, tokenBudget: 4000, ...(page ? { cursor: page.nextCursor } : {}) }));
      maps.push(page);
    } while (!page.exhausted && page.nextCursor !== null);
    return { namespace, details, maps };
  });
}
const recall = (core, patch = {}) => core.recall({ readSet: [personal], query: 'Work Alpha Beta hierarchy fallback',
  contextMode: 'source-evidence', selectionMode: 'moc-hierarchy-v1', ...patch });

if (process.env.CAIRN_MOC_INTEGRATED_CLEANUP) {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-moc-integration-child-' });
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model: { countTokens: () => 1, select, rank } });
  workspace.defer(() => core.close());
  try { assert.equal(ok(await recall(core)).memories.length, process.env.CAIRN_MOC_INTEGRATED_CLEANUP === 'pass' ? 0 : 1); }
  finally { await workspace.cleanup(); }
  process.exit(0);
}

test('I1/I5 opt-in real capture >36 refs reaches existing rank and exact authoritative receipts', async t => {
  const { core, calls } = fixture(t); await capture(core);
  const before = snapshot(core);
  const eligible = new Set(before[0].maps.flatMap(page => page.items).map(memoryRef).filter(Boolean)
    .map(ref => `${ref.memoryId}:${ref.revision}`));
  assert.equal(eligible.size, 40); assert.ok(eligible.size > 36);
  const result = ok(await recall(core));
  assert.equal(result.coverage, 'budget_exhausted');
  assert.equal(result.selection.snapshotGuarantee, 'atomic-finalization');
  assert.equal(result.selection.semanticCoverage, 'unassessed');
  assert.deepEqual(calls.map(call => call.method), ['selectGroups', 'selectGroups', 'select', 'rank']);
  const ranked = calls.at(-1).input.candidates;
  assert.ok(ranked.length > 0);
  assert.ok(result.selection.candidates.some(ref => ref.origins.length === 1 && ref.origins[0] === 'hierarchy'));
  for (const item of result.memories) {
    const exact = before[0].details.find(detail => detail.memory.id === item.memory.id);
    assert.equal(item.memory.revision, exact.memory.revision);
    assert.deepEqual(item.receipts, exact.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
    assert.ok(ranked.some(candidate => candidate.memory.id === item.memory.id));
  }
  assert.deepEqual(result.selection.rankVisibleRefs, ranked.map(rankRef));
  const audit = JSON.stringify(result.selection);
  assert.ok(!audit.includes('hierarchy receipt')); assert.ok(!audit.includes('excerpt'));
  assert.equal(result.selection.resources.modelCalls, 4);
  assert.ok(result.selection.resources.mapCalls <= 16);
  assert.deepEqual(snapshot(core), before);
  t.diagnostic('40 actual eligible refs and hierarchy-only selected target; scripted mechanics, no semantic/flat-opportunity claim');
});

test('I1 default/bounded-source-scan stay opt-out; wrong mode/context rejects before model work', async t => {
  const { core, calls } = fixture(t); await capture(core, personal, 5, index => `Unfiled / Note: fallback ${index}.`);
  const normal = ok(await core.recall({ readSet: [personal], query: 'fallback', contextMode: 'source-evidence' }));
  assert.deepEqual(calls.map(call => call.method), ['select', 'rank']);
  assert.equal('selection' in normal, false); calls.length = 0;
  const bounded = ok(await core.recall({ readSet: [personal], query: 'fallback', contextMode: 'source-evidence', selectionMode: 'bounded-source-scan' }));
  assert.deepEqual(calls.map(call => call.method), ['rank']);
  assert.equal(bounded.selection.strategy, 'complete-map'); calls.length = 0;
  for (const patch of [{ contextMode: undefined }, { contextMode: 'rationale-evidence' },
    { selectionMode: 'unknown' }, { selectionMode: ['bounded-source-scan', 'moc-hierarchy-v1'] }]) {
    const failure = await recall(core, patch); assert.equal(failure.ok, false); assert.equal(failure.error.code, 'invalid_input');
  }
  assert.deepEqual(calls, []);
});

test('I3 no groups/empty decisions retain actual unfiled and orphan fallback; errors do not recover', async t => {
  for (const domain of ['Unfiled', 'Orphan']) {
    const { core, calls } = fixture(t);
    await capture(core, personal, 5, index => `${domain} / Topic: fallback ${index}.`);
    const before = snapshot(core);
    const result = ok(await recall(core));
    assert.equal(result.memories.length, 5);
    assert.deepEqual(calls.map(call => call.method), ['select', 'rank']);
    assert.equal(result.selection.fallback.selectedRefs.length, 5);
    assert.deepEqual(snapshot(core), before);
  }
  const { core, model, calls } = fixture(t); await capture(core, personal, 5, index => `Work / Alpha: fallback ${index}.`);
  model.selectGroups = async () => ({ refs: [] });
  assert.equal(ok(await recall(core)).memories.length, 5); calls.length = 0;
  for (const action of [() => ({ refs: [{ namespaceIndex: 1, mocId: 'foreign', revision: 1 }] }),
    () => { throw new DOMException('cancel', 'AbortError'); }, () => { throw new Error('provider'); },
    () => { throw Object.assign(new Error('scripted port timeout'), { code: 'model_timeout' }); }]) {
    model.selectGroups = action;
    const failure = await recall(core); assert.equal(failure.ok, false);
    assert.ok(['invalid_model_output', 'model_cancelled', 'model_timeout', 'recall_failed'].includes(failure.error.code));
    assert.ok(!calls.some(call => call.method === 'select'));
  }
});

test('I3 actual cross-topic membership retains both routes while fetching one source set', async t => {
  const { core } = fixture(t, { select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items.flatMap(item => {
    const ref = memoryRef(item); return ref ? [{ namespaceIndex: map.namespaceIndex, ...ref }] : [];
  })).slice(0, input.maxRefs) }) });
  for (const topic of ['Alpha', 'Beta', 'Alpha+Beta']) await capture(core, personal, 1,
    () => `Work / ${topic}: hierarchy cross-topic evidence.`, `cross-${topic}`);
  const before = snapshot(core);
  const result = ok(await recall(core));
  assert.equal(result.selection.candidates.length, 3);
  const shared = result.selection.candidates.find(candidate => candidate.paths.length === 2);
  assert.ok(shared); assert.equal(new Set(shared.paths.map(path => path.l1.mocId)).size, 2);
  assert.deepEqual(shared.origins, ['fallback', 'hierarchy']);
  assert.equal(result.selection.resources.fetchCalls, 3);
  assert.equal(result.memories.filter(item => item.memory.id === shared.memoryId).length, 1);
  assert.deepEqual(snapshot(core), before);
});

test('I2/I3 both namespace orders, cross-topic dedup and fallback-first union obey caps', async t => {
  const { core, calls } = fixture(t, { select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items.flatMap(item => {
    const ref = memoryRef(item); return ref ? [{ namespaceIndex: map.namespaceIndex, ...ref }] : [];
  })).slice(0, input.maxRefs) }) });
  await capture(core, personal); await capture(core, project, 15);
  for (const readSet of [[personal, project], [project, personal]]) {
    const before = snapshot(core, readSet); calls.length = 0;
    const result = ok(await recall(core, { readSet }));
    const selection = result.selection;
    assert.deepEqual(result.namespaces.map(value => value.namespace), readSet);
    assert.ok(selection.candidates.length <= 36);
    assert.equal(new Set(selection.candidates.map(ref => `${ref.namespaceIndex}:${ref.memoryId}:${ref.revision}`)).size, selection.candidates.length);
    for (const index of [0, 1]) assert.ok(selection.candidates.filter(ref => ref.namespaceIndex === index).length <= 24);
    assert.equal(selection.candidates[0].origins[0], 'fallback');
    assert.equal(selection.resources.fetchCalls, selection.candidates.length);
    assert.ok(selection.candidates.some(ref => ref.origins.includes('fallback') && ref.origins.includes('hierarchy')));
    assert.ok(selection.resources.mapCalls <= 16); assert.equal(selection.resources.modelCalls, 4);
    assert.equal(calls.filter(call => call.method === 'select').length, 1);
    assert.equal(calls.find(call => call.method === 'select').input.maxRefs, 12);
    assert.deepEqual(snapshot(core, readSet), before);
  }
});

test('I2 private L2 catalog overcomes >200 memory rows without changing public root order', async t => {
  const { core, calls } = fixture(t); await capture(core, personal, 205, index => `Work / Alpha: hierarchy ${index}.`);
  const before = snapshot(core);
  assert.equal(before[0].details.length, 205);
  assert.ok(before[0].maps.slice(0, 2).every(page => !page.items.some(item => item.type === 'moc' && item.moc.level === 'L2')));
  const result = ok(await recall(core));
  assert.ok(result.memories.length > 0); assert.equal(result.selection.selectedL2.length, 1);
  assert.equal(calls.find(call => call.method === 'selectGroups').input.maps[0].groups.length, 1);
  assert.deepEqual(snapshot(core), before);
});

test('I2 private catalog cursors cannot continue public/classification/foreign maps', async t => {
  const { core, model } = fixture(t);
  for (let index = 0; index < 3; index++) await capture(core, personal, 1,
    () => `Domain-${index} / Topic-${index}: hierarchy ${index}.`, `domain-${index}`);
  model.countTokens = text => {
    const parsed = JSON.parse(text || 'null');
    return parsed?.ok && parsed.value?.items?.length > 1 && parsed.value.items.every(item => item.type === 'moc' && item.moc.level === 'L2') ? 4001 : 1;
  };
  const result = ok(await recall(core));
  const cursor = result.selection.partialPages.find(page => page.stage === 'root').nextCursor;
  assert.ok(cursor);
  for (const request of [{ namespace: personal, purpose: 'recall' }, { namespace: personal, purpose: 'classification' },
    { namespace: project, purpose: 'recall' }, { namespace: personal, purpose: 'recall', parentRef: { mocId: result.selection.selectedL2[0].mocId, revision: result.selection.selectedL2[0].revision } }]) {
    const failure = core.map({ ...request, cursor, limit: 100, tokenBudget: 4000 });
    assert.equal(failure.ok, false); assert.equal(failure.error.code, 'invalid_cursor');
  }
});

test('I2 >200 L1 structural load cannot crowd L2 catalog; public filing only, no oracle target', async t => {
  const { core, calls } = fixture(t);
  await capture(core, personal, 205, index => `Work / Alpha: structural load ${index}.`);
  const initial = snapshot(core)[0];
  const headers = initial.maps.flatMap(page => page.items).filter(item => item.type === 'moc').map(item => item.moc);
  const l1 = headers.find(group => group.level === 'L1');
  const l2 = headers.find(group => group.level === 'L2');
  let indexRevision = initial.maps[0].indexRevision;
  // Approved structural stress only: every unrelated new title derives from
  // its existing captured receipt, not a question's answer or oracle label.
  for (const detail of initial.details) {
    const memory = detail.memory;
    const placed = ok(core.applyPlacement({ namespace: personal, expectedIndexRevision: indexRevision,
      expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
      proposal: { items: [{ memoryId: memory.id, parentIds: [l1.id], newL1: {
        title: detail.receipts[0].excerpt, parentL2Ids: [l2.id] } }] } }));
    indexRevision = placed.indexRevision;
  }
  const before = snapshot(core);
  assert.equal(before[0].maps.flatMap(page => page.items).filter(item => item.type === 'moc' && item.moc.level === 'L1').length, 206);
  const result = ok(await recall(core));
  const rootGroups = calls.find(call => call.method === 'selectGroups').input.maps[0].groups;
  assert.equal(rootGroups.length, 1); assert.equal(rootGroups[0].mocId, l2.id);
  assert.equal(result.selection.selectedL2.length, 1);
  assert.deepEqual(snapshot(core), before);
  t.diagnostic('public-filing structural stress only; no semantic or normal-capture-to-200-L1 claim');
});

test('I2 group/select/rank and input/output-counter microtask mutations reject authoritative freshness', async t => {
  for (const stage of ['group1', 'group2', 'select', 'rank', 'correct', 'input-counter', 'output-counter', 'rank-output-counter', 'microtask', 'unavailable-index']) {
    const { core, model, calls } = fixture(t);
    await capture(core, personal, 5, index => `Work / Alpha: hierarchy fallback ${index}.`);
    const target = snapshot(core)[0].details[0].memory;
    let mutated = false;
    let rankStarted = false;
    const mutate = () => {
      if (mutated) return; mutated = true;
      if (stage === 'unavailable-index') {
        const indexRevision = ok(core.map({ namespace: personal })).indexRevision;
        ok(core.rebuildIndex({ namespace: personal, expectedIndexRevision: indexRevision, limit: 1 }));
      } else if (stage === 'correct') ok(core.correct({ namespace: personal, memoryId: target.id,
        expectedRevision: target.revision, content: 'Explicit concurrent correction', kind: 'fact',
        receipt: { client: 'offline', sessionId: 'session', eventId: 'correction', role: 'user', excerpt: 'Explicit concurrent correction' } }));
      else ok(core.forget({ namespace: personal, memoryId: target.id, expectedRevision: target.revision }));
    };
    if (stage.startsWith('group') || stage === 'microtask' || stage === 'unavailable-index') {
      let groups = 0;
      model.selectGroups = async request => {
        groups++;
        if (groups === (stage === 'group2' ? 2 : 1)) {
          if (stage === 'microtask') queueMicrotask(mutate); else mutate();
        }
        return selectGroups(request);
      };
    } else if (['select', 'rank', 'correct'].includes(stage)) {
      const method = stage === 'correct' ? 'rank' : stage;
      const original = model[method]; model[method] = async request => { mutate(); return original(request); };
    } else {
      if (stage === 'rank-output-counter') {
        const original = model.rank;
        model.rank = async request => { rankStarted = true; return original(request); };
      }
      model.countTokens = text => {
        const parsed = JSON.parse(text || 'null');
        if (stage === 'input-counter' && parsed?.input?.maxRefsPerNamespace === 2) queueMicrotask(mutate);
        if (stage === 'output-counter' && parsed?.refs?.[0]?.mocId) mutate();
        if (stage === 'rank-output-counter' && rankStarted && parsed?.refs?.[0]?.memoryId) mutate();
        return 1;
      };
    }
    const failure = await recall(core);
    assert.equal(failure.ok, false, stage);
    assert.ok(['revision_conflict', 'index_revision_conflict', 'index_unavailable'].includes(failure.error.code), `${stage}: ${failure.error.code}`);
    assert.equal(mutated, true);
    if (stage === 'input-counter') assert.equal(calls.filter(call => call.method === 'selectGroups').length, 0);
  }
});

test('I3 source packing reports selected versus actual rank-visible/omitted refs', async t => {
  const { core, model, calls } = fixture(t);
  await capture(core, personal, 40);
  model.countTokens = text => {
    const parsed = JSON.parse(text || 'null');
    return parsed?.input?.candidates ? parsed.input.candidates.length * 1500 + 1 : 1;
  };
  const result = ok(await recall(core));
  assert.equal(result.selection.rankVisibleRefs.length, 3);
  assert.ok(result.selection.rankOmittedRefs.length > 0);
  assert.deepEqual(result.selection.rankVisibleRefs, calls.at(-1).input.candidates.map(rankRef));
  assert.equal(result.recallTruncated.candidatesOmitted, result.selection.rankOmittedRefs.length);
  assert.ok(result.memories.every(item => result.selection.rankVisibleRefs.some(ref => ref.memoryId === item.memory.id)));
});

test('I2 both namespace orders reject a correction outside ranked candidates through observed epoch guards', async t => {
  for (const readSet of [[personal, project], [project, personal]]) {
    const { core, model } = fixture(t);
    await capture(core, personal, 15); await capture(core, project, 15);
    const before = snapshot(core, readSet);
    let corrected;
    model.rank = async ({ input }) => {
      const shown = new Set(input.candidates.filter(candidate => candidate.namespaceIndex === 0).map(candidate => candidate.memory.id));
      const target = before[0].details.find(detail => !shown.has(detail.memory.id));
      assert.ok(target, 'There must be an observed-namespace memory outside the rank input');
      corrected = ok(core.correct({ namespace: readSet[0], memoryId: target.memory.id,
        expectedRevision: target.memory.revision, content: 'Concurrent correction outside ranked refs', kind: 'fact',
        receipt: { client: 'offline', sessionId: 'session', eventId: 'outside', role: 'user', excerpt: 'Concurrent correction outside ranked refs' } }));
      return { refs: input.candidates.filter(candidate => candidate.namespaceIndex === 1).slice(0, 1).map(rankRef) };
    };
    const failure = await recall(core, { readSet });
    assert.equal(failure.ok, false); assert.equal(failure.error.code, 'index_revision_conflict');
    assert.ok(corrected);
  }
});

test('I5 owned integration behavior subprocesses clean up on pass and intentional assertion failure', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-moc-integration-parent-' });
  for (const mode of ['pass', 'fail']) {
    const child = spawnSync(process.execPath, ['tools/testing/run.mjs', '--script', 'core/test/moc-hierarchy-recall.test.mjs'],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, TMPDIR: workspace.path, TMP: workspace.path,
        TEMP: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1', CAIRN_MOC_INTEGRATED_CLEANUP: mode } });
    assert.equal(child.status, mode === 'pass' ? 0 : 1, child.stderr);
    assert.equal(existsSync(workspace.path), true); assert.deepEqual(readdirSync(workspace.path), []);
  }
});

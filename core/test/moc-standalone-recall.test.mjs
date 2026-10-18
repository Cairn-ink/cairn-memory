import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { mkdirSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { generateMocCandidates } from '../moc-recall-candidates.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const personal = { ownerId: 'standalone-h4', scope: 'personal', projectId: null };
const project = { ...personal, scope: 'project', projectId: 'project' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const groupRef = ({ namespaceIndex, mocId, revision }) => ({ namespaceIndex, mocId, revision });
const memoryRef = item => item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
  ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
const allRefs = input => input.maps.flatMap(map => map.items.flatMap(item => {
  const ref = memoryRef(item); return ref ? [{ namespaceIndex: map.namespaceIndex, ...ref }] : [];
}));
const rank = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(candidate => ({
  namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) });

function fixture(t, overrides = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-standalone-' });
  const path = join(workspace.path, 'memory.sqlite');
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
      kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => {
      const [domain, topic] = memory.content.split('|');
      if (domain === 'U') return { memoryId: memory.id, parentIds: [] };
      const catalog = input.map.filter(item => item.type === 'moc').map(item => item.moc);
      const found = catalog.find(group => group.level === 'L1' && group.title === topic);
      const parent = catalog.find(group => group.level === 'L2' && group.title === domain);
      return { memoryId: memory.id, parentIds: found ? [found.id] : [], ...(found ? {} : {
        newL1: { title: topic, parentL2Ids: parent ? [parent.id] : [],
          ...(domain === 'S' || parent ? {} : { newL2Title: domain }) } }) };
    }) }),
    selectGroups: ({ input }) => ({ refs: input.maps.flatMap(map => map.groups.slice(0, 2))
      .slice(0, input.maxRefs).map(groupRef) }), select: () => ({ refs: [] }), rank, ...overrides };
  for (const method of ['selectGroups', 'select', 'rank']) {
    const implementation = model[method];
    model[method] = async request => { calls.push({ method, system: request.system, input: structuredClone(request.input) });
      return implementation(request); };
  }
  let core = openMemoryCore({ path, model });
  workspace.defer(() => core.close());
  return { get core() { return core; }, model, calls, path, workspace,
    reopen() { core.close(); core = openMemoryCore({ path, model }); } };
}
async function capture(core, namespace, contents, event = 'batch') {
  const ids = [];
  for (let start = 0; start < contents.length; start += 5) {
    const result = ok(await core.capture({ namespace, client: 'synthetic', sessionId: 'session', eventId: `${event}-${start}`,
      messages: contents.slice(start, start + 5).map((content, offset) => ({ id: `${event}-${start + offset}`, role: 'user', content })) }));
    assert.equal(result.classification.status, 'applied', JSON.stringify(result.classification));
    ids.push(...result.admission.memories.map(memory => memory.id));
  }
  return ids;
}
const recall = (core, patch = {}) => core.recall({ readSet: [personal], query: 'retained target source',
  contextMode: 'source-evidence', selectionMode: 'moc-hierarchy-v2', ...patch });
function details(core, namespace = personal) {
  const all = []; let page;
  do {
    page = ok(core.list({ namespace, limit: 100, ...(page ? { cursor: page.nextCursor } : {}) }));
    all.push(...page.memories.map(memory => ok(core.get({ namespace, memoryId: memory.id }))));
  } while (page.nextCursor);
  return all;
}
function headers(core, namespace = personal) {
  const groups = []; let page;
  do {
    page = ok(core.map({ namespace, limit: 100, tokenBudget: 4000, ...(page ? { cursor: page.nextCursor } : {}) }));
    groups.push(...page.items.filter(item => item.type === 'moc').map(item => item.moc));
  } while (page.nextCursor);
  return groups;
}

if (process.env.CAIRN_H4_CLEANUP) {
  const f = fixture(null);
  try {
    await capture(f.core, personal, ['S|Alpha|retained cleanup source.']);
    assert.equal(ok(await recall(f.core)).memories.length, process.env.CAIRN_H4_CLEANUP === 'pass' ? 1 : 2);
  } finally { await f.workspace.cleanup(); }
  process.exit(0);
}

test('H4 ordinary standalone capture survives cold reopen and reaches exact canonical source; disabled control loses route', async t => {
  const f = fixture(t);
  await capture(f.core, personal, ['S|Alpha|retained target source.']); f.reopen();
  const before = details(f.core); f.calls.length = 0;
  const result = ok(await recall(f.core));
  assert.equal(result.memories.length, 1);
  assert.deepEqual(result.memories[0].receipts, before[0].receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
  assert.deepEqual(f.calls.map(call => call.method), ['selectGroups', 'select', 'rank']);
  assert.equal(result.selection.selectedL2.length, 0);
  const path = result.selection.candidates[0].paths[0];
  assert.equal(path.origin, 'standalone'); assert.equal('l2' in path, false); assert.equal('l2ToL1' in path, false);
  assert.equal(path.l1ToMemory.childId, result.memories[0].memory.id);
  assert.deepEqual(result.selection.rankVisibleRefs.map(ref => ref.memoryId), [result.memories[0].memory.id]);
  assert.ok(!JSON.stringify(result.selection).includes('retained target source'));
  const choose = f.model.selectGroups; f.model.selectGroups = () => ({ refs: [] });
  f.calls.length = 0;
  const disabled = ok(await recall(f.core));
  assert.deepEqual(disabled.memories, []); assert.equal(disabled.selection.resources.fetchCalls, 0);
  assert.equal(f.calls.some(call => call.method === 'rank'), false); f.model.selectGroups = choose;
  assert.deepEqual(details(f.core), before);
  await capture(f.core, personal, ['Work|Beta|unrelated connected source.'], 'unrelated');
  f.reopen(); f.calls.length = 0;
  const mixed = ok(await recall(f.core));
  const l1 = f.calls.filter(call => call.method === 'selectGroups').at(-1).input;
  assert.deepEqual(new Set(l1.maps[0].groups.map(group => group.title)), new Set(['Alpha', 'Beta']));
  assert.ok(mixed.selection.candidates.some(ref => ref.paths.some(path => path.origin === 'standalone')));
  assert.ok(mixed.selection.candidates.some(ref => ref.paths.some(path => path.origin === 'connected' && path.l2)));
  assert.ok(mixed.selection.resources.mapCalls <= 20); assert.ok(mixed.selection.resources.modelCalls <= 5);
});

test('H4 namespace order preserves mixed origins and per-namespace quotas on current revisions', async t => {
  const f = fixture(t);
  for (const ns of [personal, project]) await capture(f.core, ns,
    ['S|Alpha|standalone retained target source.', 'Work|Beta|connected retained target source.'], ns.scope);
  f.reopen();
  for (const readSet of [[personal, project], [project, personal]]) {
    f.calls.length = 0;
    const before = readSet.map(ns => details(f.core, ns));
    const result = ok(await recall(f.core, { readSet }));
    assert.equal(result.memories.length, 4);
    assert.equal(result.selection.selectedL1.length, 4);
    for (let index = 0; index < 2; index++) {
      assert.equal(result.selection.selectedL1.filter(ref => ref.namespaceIndex === index).length, 2);
      assert.deepEqual(result.selection.groupPacking.at(-1).lanes.filter(lane => lane.namespaceIndex === index)
        .map(lane => lane.origin), ['standalone', 'connected']);
      for (const candidate of result.selection.candidates.filter(ref => ref.namespaceIndex === index)) {
        assert.ok(before[index].some(item => item.memory.id === candidate.memoryId && item.memory.revision === candidate.revision));
      }
    }
    assert.deepEqual(readSet.map(ns => details(f.core, ns)), before);
  }
});

test('H4 exact two flat rounds match default serialized input for 0/12/24 first choices, namespace order and skew', async t => {
  const f = fixture(t);
  for (const ns of [personal, project]) await capture(f.core, ns,
    Array.from({ length: 105 }, (_, index) => `U|Note|flat retained target source ${ns.scope} ${index}.`), ns.scope);
  f.reopen();
  for (const readSet of [[personal, project], [project, personal]]) for (const first of [0, 12, 24]) {
    const run = async selectionMode => {
      let round = 0; f.calls.length = 0;
      f.model.select = async ({ input }) => {
        const maximum = round++ === 0 ? first : input.maxRefs;
        const selected = [];
        for (const map of input.maps) selected.push(...allRefs({ maps: [map] }).slice(0, Math.min(12, maximum - selected.length)));
        return { refs: selected };
      };
      // The fixture wrapper is replaced above, so record the exact request explicitly.
      const choose = f.model.select;
      f.model.select = async request => { f.calls.push({ method: 'select', system: request.system,
        input: structuredClone(request.input) }); return choose(request); };
      const request = { readSet, query: 'flat retained target source', contextMode: 'source-evidence',
        ...(selectionMode ? { selectionMode } : {}) };
      const result = ok(await f.core.recall(request));
      return { inputs: f.calls.filter(call => call.method === 'select').map(call => call.input), result };
    };
    const baseline = await run(); const candidate = await run('moc-hierarchy-v2');
    assert.equal(candidate.inputs.length, 2);
    assert.deepEqual(candidate.inputs, baseline.inputs);
    assert.equal(candidate.inputs[1].maxRefs, first === 24 ? 12 : 24);
    assert.ok(candidate.inputs[1].maps.every(map => map.items.length === 5));
    assert.equal(candidate.result.selection.resources.flatModelCalls, 2);
    assert.ok(candidate.result.selection.fallback.selectedRefs.some(ref => candidate.inputs[1].maps
      .some(map => map.namespaceIndex === ref.namespaceIndex && map.items.some(item => memoryRef(item)?.memoryId === ref.memoryId))));
  }
});

test('H4 invalid mode/context and malformed group refs fail closed; empty store does not claim complete coverage', async t => {
  const f = fixture(t);
  assert.equal(ok(await recall(f.core)).coverage, 'budget_exhausted');
  for (const contextMode of [undefined, 'rationale-evidence']) {
    const result = await recall(f.core, { contextMode }); assert.equal(result.error.code, 'invalid_input');
  }
  await capture(f.core, personal, ['S|Alpha|retained target source.']);
  for (const selectGroups of [() => ({ refs: [{ namespaceIndex: 0, mocId: 'invented', revision: 1 }] }),
    () => { throw Error('provider'); }, () => { throw new DOMException('cancelled', 'AbortError'); }]) {
    f.model.selectGroups = selectGroups;
    const result = await recall(f.core); assert.equal(result.ok, false);
    assert.ok(['invalid_model_output', 'recall_failed', 'model_cancelled'].includes(result.error.code));
  }
});

test('H4 mutations in group/count/queued-count/flat/fetch/rank work never return stale evidence', async t => {
  for (const stage of ['group', 'count', 'queued-count', 'flat', 'fetch', 'rank']) {
    const f = fixture(t);
    const [id] = await capture(f.core, personal, ['S|Alpha|retained target source.']);
    const memory = ok(f.core.get({ namespace: personal, memoryId: id })).memory;
    const mutate = () => ok(f.core.forget({ namespace: personal, memoryId: id, expectedRevision: memory.revision }));
    if (['group', 'flat', 'rank'].includes(stage)) {
      const method = { group: 'selectGroups', flat: 'select', rank: 'rank' }[stage], original = f.model[method];
      f.model[method] = request => { mutate(); return original(request); };
    } else {
      let armed = true;
      f.model.countTokens = text => {
        const parsed = JSON.parse(text || 'null');
        const hit = stage === 'fetch' ? parsed?.ok && parsed.value?.items?.[0]?.memory
          : parsed?.input?.maxRefsPerNamespace === 2;
        if (armed && hit) { armed = false; if (stage === 'queued-count') queueMicrotask(mutate); else mutate(); }
        return 1;
      };
    }
    const result = await recall(f.core); assert.equal(result.ok, false, stage);
    if (stage === 'fetch') assert.equal(result.error.code, 'cursor_stale');
    else assert.ok(['index_revision_conflict', 'revision_conflict'].includes(result.error.code), `${stage}:${JSON.stringify(result)}`);
    if (stage === 'queued-count') assert.equal(f.calls.filter(call => call.method === 'selectGroups').length, 0);
  }
});

test('H4 standalone catalog cursor has distinct purpose and unread tails remain unknown', async t => {
  const f = fixture(t);
  await capture(f.core, personal, Array.from({ length: 4 }, (_, index) => `S|Topic ${index}|retained target source ${index}.`));
  f.model.countTokens = text => {
    const value = JSON.parse(text || 'null');
    return value?.ok && value.value?.items?.length > 1 && value.value.items.every(item => item.type === 'moc') ? 4001 : 1;
  };
  const result = ok(await recall(f.core));
  const partial = result.selection.partialPages.find(page => page.stage === 'standalone');
  assert.ok(partial.nextCursor); assert.equal(partial.unreadTail, 'unknown');
  const decoded = JSON.parse(Buffer.from(partial.nextCursor.split('.')[0], 'base64url').toString());
  assert.equal(decoded.o, 'recall_standalone_l1_catalog_v1');
  for (const request of [{ namespace: personal }, { namespace: project }, { namespace: personal, purpose: 'classification' },
    { namespace: personal, parentRef: { mocId: result.selection.selectedL1[0].mocId, revision: result.selection.selectedL1[0].revision } }]) {
    const rejected = f.core.map({ ...request, limit: 100, tokenBudget: 4000, cursor: partial.nextCursor });
    assert.equal(rejected.error.code, 'invalid_cursor');
  }
  assert.equal(result.selection.groupPacking[0].observedGroups, 1);
});

test('H4 oversized real catalogs reserve all origins, report exact observed omissions and reject omitted refs', async t => {
  const f = fixture(t);
  for (const ns of [personal, project]) await capture(f.core, ns,
    [...Array.from({ length: 8 }, (_, index) => `S|Standalone ${index}|retained target source ${index}.`),
      'Work|Connected|connected retained target source.'], ns.scope);
  f.reopen(); f.calls.length = 0;
  f.model.countTokens = text => {
    const value = JSON.parse(text || 'null');
    return value?.input?.maxRefsPerNamespace === 2
      ? value.input.maps.reduce((sum, map) => sum + map.groups.length, 0) * 1000 : 1;
  };
  const result = ok(await recall(f.core, { readSet: [personal, project] }));
  const packing = result.selection.groupPacking.find(item => item.stage === 'L1');
  assert.equal(packing.observedGroups, 18); assert.equal(packing.packedRefs.length, 6);
  assert.equal(packing.omittedRefs.length, 12); assert.ok(packing.fitChecks <= packing.observedGroups + 3);
  assert.equal(packing.lanes.length, 4); assert.ok(packing.lanes.every(lane => lane.packedRefs.length >= 1));
  const shown = f.calls.filter(call => call.method === 'selectGroups').at(-1).input.maps.flatMap(map => map.groups);
  assert.deepEqual(shown.map(groupRef), packing.packedRefs.slice().sort((a, b) => a.namespaceIndex - b.namespaceIndex));
  const allObserved = packing.lanes.flatMap(lane => lane.observedRefs);
  assert.deepEqual(new Set([...packing.packedRefs, ...packing.omittedRefs].map(ref => JSON.stringify(ref))),
    new Set(allObserved.map(ref => JSON.stringify(ref))));
  const original = f.model.selectGroups;
  f.model.selectGroups = request => request.input.maxRefs === 4 ? { refs: [packing.omittedRefs[0]] } : original(request);
  assert.equal((await recall(f.core, { readSet: [personal, project] })).error.code, 'invalid_model_output');
  f.model.selectGroups = original;
  f.model.countTokens = text => {
    const value = JSON.parse(text || 'null');
    return value?.input?.maxRefs === 4 && value.input.maps.reduce((sum, map) => sum + map.groups.length, 0) >= 4 ? 6001 : 1;
  };
  f.calls.length = 0;
  assert.equal((await recall(f.core, { readSet: [personal, project] })).error.code, 'context_budget_exceeded');
  assert.equal(f.calls.filter(call => call.method === 'selectGroups').length, 1, 'L1 bundle rejects before its model call');
});

test('H4 anti-join sees valid parents beyond visited root pages and retains real multiple-parent provenance', async t => {
  const f = fixture(t);
  await capture(f.core, personal, ['Domain0|Topic0|retained target source zero.', 'Domain1|Topic1|retained target source one.',
    'Domain2|Topic2|retained target source two.']);
  f.reopen();
  f.model.countTokens = text => {
    const value = JSON.parse(text || 'null');
    return value?.ok && value.value?.items?.length > 1 &&
      value.value.items.every(item => item.type === 'moc' && item.moc.level === 'L2') ? 4001 : 1;
  };
  const limited = ok(await recall(f.core));
  assert.equal(limited.selection.selectedL2.length, 2);
  assert.equal(limited.selection.maps.find(map => map.stage === 'standalone').rows, 0);
  assert.ok(!f.calls.filter(call => call.method === 'selectGroups').at(-1).input.maps[0].groups.some(group => group.title === 'Topic2'));
  f.model.countTokens = () => 1;
  const groups = headers(f.core), child = groups.find(group => group.title === 'Topic0');
  const parent = groups.find(group => group.title === 'Domain1');
  const indexRevision = ok(f.core.map({ namespace: personal })).indexRevision;
  ok(f.core.linkMocs({ namespace: personal, parentId: parent.id, expectedParentRevision: parent.revision,
    childId: child.id, expectedChildRevision: child.revision, expectedIndexRevision: indexRevision }));
  const multiple = ok(await recall(f.core));
  const joined = multiple.selection.candidates.find(candidate => candidate.paths.length === 2);
  assert.ok(joined); assert.ok(joined.paths.every(path => path.origin === 'connected'));
  assert.equal(new Set(joined.paths.map(path => path.l2.mocId)).size, 2);
  assert.equal(multiple.selection.resources.fetchCalls, multiple.selection.candidates.length);
});

test('H4 projected generation authority excludes discarded raw topics and ignores unfinished generations', async t => {
  const f = fixture(t);
  await capture(f.core, personal, ['S|Alpha|retained target source alpha.', 'Work|Beta|retained target source beta.']);
  const revision = ok(f.core.map({ namespace: personal })).indexRevision;
  ok(f.core.rebuildIndex({ namespace: personal, expectedIndexRevision: revision, limit: 500 }));
  const before = ok(await recall(f.core)); assert.equal(before.memories.length, 2);
  // Negative authority injection: raw declaration remains, active projection discards this L1.
  const db = new DatabaseSync(f.path); f.workspace.defer(() => db.close());
  const standalone = headers(f.core).find(group => group.title === 'Alpha');
  const active = db.prepare('SELECT active_generation FROM namespace_index_state').get().active_generation;
  db.prepare('DELETE FROM index_mocs WHERE generation = ? AND id = ?').run(active, standalone.id);
  const discarded = ok(await recall(f.core));
  assert.equal(discarded.selection.maps.find(map => map.stage === 'standalone').rows, 0);
  assert.ok(!discarded.selection.selectedL1.some(ref => ref.mocId === standalone.id));
  const epoch = ok(f.core.map({ namespace: personal })).indexRevision;
  const staged = ok(f.core.rebuildIndex({ namespace: personal, expectedIndexRevision: epoch, limit: 1 }));
  assert.equal(staged.state, 'staged');
  const stillDiscarded = ok(await recall(f.core));
  assert.ok(!stillDiscarded.selection.selectedL1.some(ref => ref.mocId === standalone.id));
  assert.equal(db.prepare('SELECT active_generation FROM namespace_index_state').get().active_generation, active);
});

test('H4 pre-anchor changes may form initial snapshots, including a not-yet-observed second namespace', async t => {
  for (const second of [false, true]) {
    const f = fixture(t);
    await capture(f.core, personal, ['S|Alpha|personal retained target source.'], 'personal');
    const ns = second ? project : personal;
    if (second) await capture(f.core, project, ['S|Beta|project retained target source.'], 'project');
    const target = details(f.core, ns)[0].memory;
    let fired = false;
    f.model.countTokens = text => {
      const value = JSON.parse(text || 'null');
      const hit = second ? value?.ok && value.value?.indexRevision && value.value.items.length === 0 : text === '';
      if (!fired && hit) { fired = true; ok(f.core.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision })); }
      return 1;
    };
    const result = ok(await recall(f.core, { readSet: second ? [personal, project] : [personal] }));
    assert.equal(fired, true); assert.ok(!result.memories.some(item => item.memory.id === target.id));
    assert.equal(result.memories.length, second ? 1 : 0);
  }
});

test('H4 flat capacity has priority, overlap retains provenance and hierarchy omissions are explicit', async t => {
  const f = fixture(t);
  for (const ns of [personal, project]) {
    await capture(f.core, ns, Array.from({ length: 105 }, (_, index) => `U|Note|flat source ${ns.scope} ${index}.`), ns.scope);
    await capture(f.core, ns, Array.from({ length: 5 }, (_, index) => `S|Alpha|hierarchy source ${ns.scope} ${index}.`), `${ns.scope}-hierarchy`);
  }
  const run = async full => {
    let round = 0;
    f.model.select = ({ input }) => {
      const maximum = full ? input.maxRefs : round === 0 ? 12 : 0; round++;
      const refs = [];
      for (const map of input.maps) refs.push(...allRefs({ maps: [map] }).slice(0, Math.min(12, maximum - refs.length)));
      return { refs };
    };
    return ok(await recall(f.core, { readSet: [personal, project], query: 'flat source' }));
  };
  const full = await run(true);
  assert.equal(full.selection.fallback.selectedRefs.length, 36);
  assert.equal(full.selection.candidates.length, 36);
  assert.ok(full.selection.candidates.every(candidate => candidate.origins.includes('flat')));
  assert.ok(full.selection.candidates.some(candidate => candidate.origins.includes('hierarchy')));
  assert.ok(full.selection.hierarchyCapacityOmittedRefs.length > 0);
  assert.equal(full.selection.resources.fetchCalls, 36);
  const residual = await run(false);
  assert.equal(residual.selection.fallback.selectedRefs.length, 12);
  assert.ok(residual.selection.candidates.some(candidate => candidate.origins.length === 1 && candidate.origins[0] === 'hierarchy'));
  assert.deepEqual(residual.selection.hierarchyCapacityOmittedRefs, []);
});

test('H4 helper maximum maps/models/leaves/packing work is exact, not an implied single fetch per identity', async () => {
  const rootRounds = [0, 0]; let mapCalls = 0;
  const page = (items, exhausted = true, nextCursor = null) => ({ ok: true, value: { items, exhausted, nextCursor,
    invalidRefs: [], indexRevision: 1, truncatedBy: exhausted ? null : 'page_limit' } });
  const moc = (id, level) => ({ type: 'moc', moc: { id, level, revision: 1, title: id } });
  const edge = (parentId, childId, childType) => ({ type: 'ref', ref: { parentId, parentRevision: 1,
    childId, childRevision: 1, childType, relation: 'contains' } });
  const nsIndex = namespace => namespace.scope === 'personal' ? 0 : 1;
  const result = await generateMocCandidates({ selectionMode: 'moc-hierarchy-v2', readSet: [personal, project], query: 'bounded',
    groupModel: { countTokens: () => 1, contextWindow: 8192,
      selectGroups: ({ input }) => ({ refs: input.maps.flatMap(map => map.groups.slice(0, input.maxRefs === 2 ? 1 : 2))
        .slice(0, input.maxRefs).map(groupRef) }) },
    core: { standaloneMap: request => { mapCalls++; const index = nsIndex(request.namespace);
      return page(Array.from({ length: 100 }, (_, i) => moc(`standalone-${index}-${i}`, 'L1')), false, 'standalone-tail'); },
    map: request => {
      mapCalls++; const index = nsIndex(request.namespace), parent = request.parentRef?.mocId;
      if (!parent) {
        const round = rootRounds[index]++;
        return page(Array.from({ length: 100 }, (_, i) => moc(`root-${index}-${round}-${i}`, 'L2')),
          round === 1, round === 1 ? null : 'root-second');
      }
      if (parent.startsWith('root-')) {
        const round = request.cursor ? 1 : 0;
        return page(Array.from({ length: 25 }, (_, i) => {
          const id = `connected-${index}-${round}-${i}`; return [moc(id, 'L1'), edge(parent, id, 'moc')];
        }).flat(), round === 1, round === 1 ? null : 'children-second');
      }
      return page(Array.from({ length: 6 }, (_, i) => edge(parent, `memory-${parent}-${i}`, 'memory')));
    } } });
  assert.equal(mapCalls, 16); assert.equal(result.audit.resources.mapCalls, 16);
  assert.equal(result.audit.resources.modelCalls, 2); assert.equal(result.audit.selectedL1.length, 4);
  assert.equal(result.candidates.length, 24);
  for (const packing of result.audit.packing) {
    assert.ok(packing.observedGroups <= 400); assert.ok(packing.fitChecks <= packing.observedGroups + 3);
  }
});

test('H4 stale/foreign parents do not block standalone entry; ineligible memories and stale memberships never enter it', async t => {
  for (const mutation of ['stale-parent', 'foreign-parent', 'deleted', 'historical', 'awaiting', 'stale-membership']) {
    const f = fixture(t);
    await capture(f.core, personal, ['Work|Alpha|retained target source.']);
    const db = new DatabaseSync(f.path); f.workspace.defer(() => db.close());
    if (mutation === 'stale-parent') db.exec('UPDATE moc_edges SET parent_revision = parent_revision + 1');
    if (mutation === 'foreign-parent') db.exec("UPDATE mocs SET owner_id = 'foreign' WHERE level = 2");
    if (mutation === 'deleted') {
      const memory = details(f.core)[0].memory;
      ok(f.core.forget({ namespace: personal, memoryId: memory.id, expectedRevision: memory.revision }));
    }
    if (mutation === 'historical') db.exec("UPDATE memories SET currentness = 'historical'");
    if (mutation === 'awaiting') db.exec("UPDATE memories SET review_state = 'awaiting'");
    if (mutation === 'stale-membership') db.exec('UPDATE moc_memory_refs SET memory_revision = memory_revision + 1');
    const result = ok(await recall(f.core));
    const expected = ['stale-parent', 'foreign-parent'].includes(mutation) ? 1 : 0;
    assert.equal(result.selection.maps.find(map => map.stage === 'standalone').rows, expected, mutation);
    assert.equal(result.memories.length, expected, mutation);
    if (expected) assert.equal(result.selection.candidates[0].paths[0].origin, 'standalone');
  }
});

test('H4 whole-source rank packing distinguishes chosen, rank-visible and final evidence without shortening', async t => {
  const f = fixture(t);
  await capture(f.core, personal, Array.from({ length: 6 }, (_, index) => `S|Alpha|retained target source ${index}.`));
  const before = details(f.core);
  f.model.countTokens = text => {
    const value = JSON.parse(text || 'null');
    return value?.input?.candidates?.length > 2 ? 6001 : 1;
  };
  const result = ok(await recall(f.core));
  assert.equal(result.selection.candidates.length, 6);
  assert.equal(result.selection.rankVisibleRefs.length, 2); assert.equal(result.selection.rankOmittedRefs.length, 4);
  assert.equal(result.memories.length, 2); assert.equal(result.recallTruncated.candidatesOmitted, 4);
  for (const item of result.memories) {
    const source = before.find(source => source.memory.id === item.memory.id);
    assert.deepEqual(item.receipts, source.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
  }
  assert.deepEqual(details(f.core), before);
});

test('H4 success and deliberate assertion failure clean owned child scratch and expose actual exit codes', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-h4-cleanup-probe-' });
  for (const mode of ['pass', 'fail']) {
    const scratch = join(workspace.path, mode); mkdirSync(scratch);
    const result = spawnSync(process.execPath, ['tools/testing/run.mjs', '--script', 'core/test/moc-standalone-recall.test.mjs'], {
      encoding: 'utf8', timeout: 30_000,
      env: { PATH: process.env.PATH, TMPDIR: scratch, CAIRN_H4_CLEANUP: mode } });
    assert.ifError(result.error); assert.equal(result.status, mode === 'pass' ? 0 : 1, result.stderr);
    if (mode === 'fail') assert.match(result.stderr, /AssertionError/);
    assert.deepEqual(readdirSync(scratch), []);
  }
});

test('H4 more than one standalone catalog page cannot crowd the independent real L2 lane', async t => {
  const f = fixture(t);
  const ids = await capture(f.core, personal, Array.from({ length: 105 }, (_, index) =>
    `S|Alpha|ordinary unrelated catalog source ${index}.`));
  await capture(f.core, personal, ['Work|Connected|ordinary connected retained source.'], 'connected');
  const original = headers(f.core).find(group => group.title === 'Alpha');
  let indexRevision = ok(f.core.map({ namespace: personal })).indexRevision;
  // Structural unrelated load only, through public filing; preserve the ordinary captured targets.
  for (const id of ids) {
    const source = ok(f.core.get({ namespace: personal, memoryId: id }));
    indexRevision = ok(f.core.applyPlacement({ namespace: personal, expectedIndexRevision: indexRevision,
      expectedMemoryRevisions: [{ memoryId: id, revision: source.memory.revision }],
      proposal: { items: [{ memoryId: id, parentIds: [original.id], newL1: {
        title: source.receipts[0].excerpt, parentL2Ids: [] } }] } })).indexRevision;
  }
  f.reopen(); f.calls.length = 0;
  const result = ok(await recall(f.core, { limit: 12 }));
  const root = f.calls.find(call => call.method === 'selectGroups').input.maps[0].groups;
  assert.equal(root.length, 1); assert.equal(root[0].title, 'Work');
  const standalonePage = result.selection.maps.find(map => map.stage === 'standalone');
  assert.equal(standalonePage.rows, 100); assert.equal(standalonePage.exhausted, false);
  assert.equal(result.selection.partialPages.find(page => page.stage === 'standalone').unreadTail, 'unknown');
  assert.equal(result.selection.groupPacking.find(packing => packing.stage === 'L1').observedGroups, 101);
  assert.ok(result.memories.some(item => item.receipts.some(receipt => receipt.excerpt.includes('ordinary connected retained source'))));
  assert.ok(result.memories.some(item => item.receipts.some(receipt => receipt.excerpt.includes('ordinary unrelated catalog source'))));
  t.diagnostic('105 unrelated public-placement catalog rows are structural load, not ordinary-classification quality evidence');
});

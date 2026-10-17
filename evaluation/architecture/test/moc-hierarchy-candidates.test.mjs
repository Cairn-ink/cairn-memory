import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { generateMocCandidates } from '../moc-hierarchy-candidates.mjs';

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
const sqliteSupported = nodeMajor > 22 || nodeMajor === 22 && nodeMinor >= 16;
const { openMemoryCore } = sqliteSupported ? await import('../../../core/contract.mjs') : {};
const sqliteTest = (name, body) => test(name, { skip: sqliteSupported ? false
  : 'Actual SQLite integration requires Node >=22.16; synthetic map mechanics still run.' }, body);

if (process.env.CAIRN_MOC_CLEANUP_PROBE) {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-moc-behavior-' });
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'),
    model: { countTokens: () => 1 } });
  workspace.defer(() => core.close());
  try {
    const result = await generateMocCandidates({ core,
      readSet: [{ ownerId: 'cleanup-probe', scope: 'personal', projectId: null }], query: 'empty store' });
    assert.equal(result.candidates.length, process.env.CAIRN_MOC_CLEANUP_PROBE === 'pass' ? 0 : 1);
  }
  finally { await workspace.cleanup(); }
  process.exit(0);
}

// Input-only scripted adapters and token counters verify mechanics, not semantic
// quality, real token usage, costs or the existing flat recall baseline.
const personal = { ownerId: 'moc-mechanics', scope: 'personal', projectId: null };
const project = { ownerId: personal.ownerId, scope: 'project', projectId: 'project' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const ref = group => ({ namespaceIndex: group.namespaceIndex, mocId: group.mocId, revision: group.revision });
const groupModel = (select = ({ input }) => ({ refs: input.maps.flatMap(map => map.groups)
  .filter(group => typeof group.title === 'string' && input.query.includes(group.title))
  .slice(0, input.maxRefs).map(ref) })) => ({ contextWindow: 8192, countTokens: () => 1, select });

function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-moc-candidates-' });
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
      kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => {
      const [domain, topics] = memory.content.split(':')[0].split(' / ');
      const names = topics.split('+');
      const groups = input.map.filter(item => item.type === 'moc').map(item => item.moc);
      const existing = groups.filter(group => group.level === 'L1' && names.includes(group.title));
      const absent = names.filter(name => !existing.some(group => group.title === name));
      assert.ok(absent.length <= 1);
      const parent = groups.find(group => group.level === 'L2' && group.title === domain);
      return { memoryId: memory.id, parentIds: existing.map(group => group.id),
        ...(absent.length ? { newL1: { title: absent[0], parentL2Ids: parent ? [parent.id] : [],
          ...(parent ? {} : { newL2Title: domain }) } } : {}) };
    }) }) };
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model });
  workspace.defer(() => core.close());
  return { core, workspace };
}

async function capture(core, namespace, count = 40, oneTopic = false) {
  for (let start = 0; start < count; start += 5) {
    // First batch is one topic, second establishes Beta; shared membership is
    // then chosen from visible titles through normal capture classification.
    const messages = Array.from({ length: Math.min(5, count - start) }, (_, offset) => {
      const index = start + offset;
      const topic = oneTopic || index < 5 ? 'Alpha' : index < 10 ? 'Beta' : index === 10 ? 'Alpha+Beta' : index % 2 ? 'Alpha' : 'Beta';
      return { id: `message-${index}`, role: 'user', content: `Work / ${topic}: synthetic receipt ${index}.` };
    });
    const result = ok(await core.capture({ namespace, client: 'offline', sessionId: 'session',
      eventId: `batch-${start}`, messages }));
    assert.equal(result.classification.status, 'applied');
    assert.equal(result.admission.memories.length, messages.length);
  }
}

function snapshot(core, readSet) {
  return readSet.map(namespace => {
    const memories = [];
    let listed;
    do {
      listed = ok(core.list({ namespace, limit: 100, ...(listed ? { cursor: listed.nextCursor } : {}) }));
      memories.push(...listed.memories);
    } while (!listed.exhausted && listed.nextCursor !== null);
    const details = memories.map(memory => ok(core.get({ namespace, memoryId: memory.id })));
    const maps = [];
    let previous;
    do {
      previous = ok(core.map({ namespace, purpose: 'recall', limit: 100, tokenBudget: 4000,
        ...(previous ? { cursor: previous.nextCursor } : {}) }));
      maps.push(previous);
    } while (!previous.exhausted && previous.nextCursor !== null);
    return { namespace, details, maps };
  });
}
const route = (core, readSet = [personal], model = groupModel(), query = 'Work Alpha Beta') =>
  generateMocCandidates({ core, readSet, query, groupModel: model });

sqliteTest('H1/H3 actual capture, source binding, classification and two-hop paths; traversal-only red control', async t => {
  const { core } = fixture(t);
  await capture(core, personal);
  const before = snapshot(core, [personal]);
  // Establish actual eligible refs from public observations, not capture count.
  const eligible = new Set(before[0].maps.flatMap(page => page.items)
    .filter(item => item.type === 'ref' && item.ref.childType === 'memory')
    .map(item => JSON.stringify([item.ref.childId, item.ref.childRevision])));
  assert.equal(eligible.size, 40); assert.ok(eligible.size > 36);
  const result = await route(core);
  assert.equal(result.finalRetrieval, false); assert.equal(result.fallbackRequired, true);
  assert.equal(result.snapshotGuarantee, 'per-call-not-atomic');
  assert.equal(result.semanticCoverage, 'unassessed'); assert.equal(result.coverage, 'incomplete');
  assert.equal(result.audit.resources.modelCalls, 2);
  assert.equal(result.audit.resources.mapCalls, 5);
  assert.ok(result.candidates.length > 0 && result.candidates.length <= 12);
  assert.ok(result.audit.partialPages.some(page => page.stage === 'leaves'));
  for (const candidate of result.candidates) {
    const detail = before[0].details.find(item => item.memory.id === candidate.memoryId);
    assert.equal(candidate.revision, detail.memory.revision);
    assert.equal(detail.receipts.length, 1);
    assert.equal(detail.receipts[0].excerpt, detail.memory.content);
    assert.match(detail.receipts[0].eventId, /^message-/);
    for (const path of candidate.paths) {
      assert.equal(path.l2ToL1.parentId, path.l2.mocId);
      assert.equal(path.l2ToL1.parentRevision, path.l2.revision);
      assert.equal(path.l2ToL1.childId, path.l1.mocId);
      assert.equal(path.l2ToL1.childRevision, path.l1.revision);
      assert.equal(path.l1ToMemory.parentId, path.l1.mocId);
      assert.equal(path.l1ToMemory.childId, candidate.memoryId);
      assert.equal(path.l1ToMemory.childRevision, candidate.revision);
    }
  }
  // The exact routed target disappears with only group selection disabled.
  const target = result.candidates[0];
  const red = await route(core, [personal], groupModel(() => ({ refs: [] })));
  assert.equal(red.candidates.some(item => item.memoryId === target.memoryId), false);
  assert.equal(red.audit.resources.modelCalls, 1);
  assert.deepEqual(snapshot(core, [personal]), before);
  assert.equal('memories' in result, false); assert.equal('answer' in result, false);
  t.diagnostic(`mechanics only: ${eligible.size} eligible refs, ${result.candidates.length} bounded candidates; no semantic or flat-baseline claim`);
});

sqliteTest('H2 two namespaces preserve supplied order and never mix independent epochs', async t => {
  const { core } = fixture(t);
  await capture(core, personal, 15); await capture(core, project, 10);
  const readSet = [project, personal];
  const before = snapshot(core, readSet);
  const result = await route(core, readSet);
  assert.deepEqual(result.readSet, readSet);
  assert.deepEqual(result.namespaces.map(item => item.namespace), readSet);
  assert.notEqual(result.namespaces[0].indexRevision, result.namespaces[1].indexRevision);
  assert.equal(result.audit.resources.modelCalls, 2);
  assert.equal(result.audit.resources.mapCalls, 10);
  assert.ok(result.candidates.length <= 24);
  for (const index of [0, 1]) {
    assert.ok(result.candidates.filter(item => item.namespaceIndex === index).length <= 12);
    for (const item of result.candidates.filter(item => item.namespaceIndex === index)) {
      assert.ok(before[index].details.some(detail => detail.memory.id === item.memoryId));
    }
  }
  assert.deepEqual(snapshot(core, readSet), before);
});

sqliteTest('H2 model-invented, foreign-namespace, stale, duplicate and oversized group outputs fail closed', async t => {
  const { core } = fixture(t); await capture(core, personal, 5);
  const before = snapshot(core, [personal]);
  const selectors = [
    () => ({ refs: [{ namespaceIndex: 0, mocId: 'invented', revision: 1 }] }),
    ({ input }) => ({ refs: [{ ...ref(input.maps[0].groups[0]), namespaceIndex: 1 }] }),
    ({ input }) => ({ refs: [{ ...ref(input.maps[0].groups[0]), revision: 999 }] }),
    ({ input }) => ({ refs: [ref(input.maps[0].groups[0]), ref(input.maps[0].groups[0])] }),
    ({ input }) => ({ refs: Array(3).fill(ref(input.maps[0].groups[0])) }),
    () => ({ refs: [], answer: 'unsupported' }),
    () => ({ refs: Array(1) }),
  ];
  for (const selector of selectors) await assert.rejects(route(core, [personal], groupModel(selector)), error => {
    assert.equal(error.code, 'invalid_model_output'); assert.equal('candidates' in error, false); return true;
  });
  assert.deepEqual(snapshot(core, [personal]), before);
});

sqliteTest('H2 stale memory/parent/index mutations during either model stage fail without repair', async t => {
  for (const [stage, mutation] of [['L2', 'forget'], ['L1', 'correct'], ['L1', 'admit']]) {
    const { core } = fixture(t); await capture(core, personal, 5);
    const target = snapshot(core, [personal])[0].details[0].memory;
    let count = 0;
    const base = groupModel();
    const selector = groupModel(async request => {
      count++;
      if (count === (stage === 'L2' ? 1 : 2)) {
        if (mutation === 'forget') ok(core.forget({ namespace: personal, memoryId: target.id, expectedRevision: target.revision }));
        if (mutation === 'correct') ok(core.correct({ namespace: personal, memoryId: target.id,
          expectedRevision: target.revision, content: 'Explicit concurrent correction', kind: 'fact',
          receipt: { client: 'test', sessionId: 's', eventId: 'changed', role: 'user', excerpt: 'Explicit concurrent correction' } }));
        if (mutation === 'admit') ok(core.admit({ namespace: personal, memory: { content: 'Concurrent unfiled note', kind: 'fact' },
          receipts: [{ client: 'test', sessionId: 's', eventId: 'extra', role: 'user', excerpt: 'Concurrent unfiled note' }] }));
      }
      return base.select(request);
    });
    await assert.rejects(route(core, [personal], selector), error => {
      assert.ok(['revision_conflict', 'index_revision_conflict'].includes(error.code), error.code);
      assert.equal('candidates' in error, false); assert.ok(error.audit.resources.mapCalls <= 5); return true;
    });
  }
});

sqliteTest('H3 empty maps stop without model calls; cancellation and callModel budgets propagate', async t => {
  const { core } = fixture(t);
  const empty = await route(core);
  assert.deepEqual(empty.candidates, []); assert.equal(empty.audit.resources.modelCalls, 0);
  assert.equal(empty.audit.resources.mapCalls, 2); assert.equal(empty.notObservedMeansAbsent, false);
  await capture(core, personal, 5);
  const before = snapshot(core, [personal]);
  for (const [model, code] of [
    [groupModel(() => { throw Object.assign(new Error('cancelled'), { name: 'AbortError' }); }), 'model_cancelled'],
    [{ ...groupModel(), countTokens: () => 6001 }, 'context_budget_exceeded'],
    [{ ...groupModel(), contextWindow: 8191 }, 'context_budget_exceeded'],
    [{ ...groupModel(), countTokens: undefined }, 'token_count_unavailable'],
    [{ ...groupModel(), countTokens: text => text.includes('maxOutputTokens') ? 1 : 1025 }, 'invalid_model_output'],
  ]) await assert.rejects(route(core, [personal], model), error => error.code === code);
  assert.deepEqual(snapshot(core, [personal]), before);
});

sqliteTest('H3 real mixed root rows exhaust two fixed pages before L2; no forced third page or invented fallback', async t => {
  const { core } = fixture(t); await capture(core, personal, 205, true);
  const before = snapshot(core, [personal]);
  assert.equal(before[0].details.length, 205);
  const result = await route(core);
  assert.deepEqual(result.candidates, []); assert.equal(result.audit.resources.modelCalls, 0);
  const roots = result.audit.maps.filter(map => map.stage === 'root');
  assert.equal(roots.length, 2);
  assert.equal(roots.reduce((count, map) => count + map.result.value.items.length, 0), 200);
  assert.ok(roots.every(map => !map.result.value.items.some(item => item.type === 'moc' && item.moc.level === 'L2')));
  assert.equal(result.audit.resources.mapCalls, 3);
  assert.ok(result.audit.partialPages.some(page => page.stage === 'root'));
  assert.equal(result.notObservedMeansAbsent, false);
  assert.deepEqual(snapshot(core, [personal]), before);
});

// Small synthetic public-map port isolates boundary cases that do not need
// new persistence or hand-filed target memories. The positive fixture above is real.
function syntheticPort({ children = 4, leaves = 8, roots = 1, invalid = false, wrongParent = false } = {}) {
  const calls = [];
  const group = (id, level) => ({ type: 'moc', moc: { id, level, title: id, revision: 1 } });
  const edge = (parentId, childId, childType) => ({ type: 'ref', ref: { parentId, parentRevision: 1,
    childType, childId, childRevision: 1, relation: 'contains' }, label: childId });
  const port = { map(request) {
    calls.push(structuredClone(request));
    const prefix = request.namespace.scope;
    const parent = request.parentRef?.mocId;
    let rows;
    if (!parent) rows = Array.from({ length: roots }, (_, index) => group(`${prefix}-L2-${index}`, 'L2'));
    else if (parent.includes('-L2-')) rows = [group(`${prefix}-L1-0`, 'L1'),
      ...Array.from({ length: children }, (_, index) => [
        group(`${prefix}-L1-${index}`, 'L1'), edge(parent, `${prefix}-L1-${index}`, 'moc')]).flat()];
    else rows = Array.from({ length: leaves }, (_, index) => edge(wrongParent ? 'foreign' : parent, `${prefix}-memory-${index}`, 'memory'));
    // Cursor binds namespace, exact parent, limit and budget just as the real
    // public API does. Split child header/edge pairs across page boundaries.
    const binding = JSON.stringify([prefix, parent, request.limit, request.tokenBudget]);
    const cursor = request.cursor ? JSON.parse(request.cursor) : { binding, offset: 0 };
    assert.equal(cursor.binding, binding);
    const items = rows.slice(cursor.offset, cursor.offset + request.limit);
    const exhausted = cursor.offset + items.length >= rows.length;
    return { ok: true, value: { items, invalidRefs: invalid ? [{ parentId: 'bad', childId: 'stale', childType: 'moc', reason: 'stale' }] : [],
      exhausted, nextCursor: exhausted ? null : JSON.stringify({ binding, offset: cursor.offset + items.length }),
      truncatedBy: exhausted ? null : 'page_limit', indexRevision: prefix === 'personal' ? 2 : 7 } };
  } };
  return { port, calls };
}
const firstGroups = ({ input }) => ({ refs: input.maps.flatMap(map => map.groups.slice(0, input.maxRefsPerNamespace))
  .slice(0, input.maxRefs).map(ref) });

test('H1 strict 14-map/2-model cap, all row counts, child pagination/dedup and candidate provenance', async () => {
  const { port, calls } = syntheticPort({ roots: 101, children: 26 });
  const model = groupModel(({ input }) => {
    const groups = input.maps.flatMap(map => map.groups);
    if (groups[0].mocId.includes('-L2-')) return { refs: input.maps.map(map => ref(map.groups[0])) };
    assert.equal(new Set(groups.map(key => `${key.namespaceIndex}:${key.mocId}`)).size, 52);
    return firstGroups({ input });
  });
  const result = await route(port, [project, personal], model);
  assert.equal(result.audit.resources.mapCalls, 14); assert.equal(calls.length, 14);
  assert.equal(result.audit.resources.modelCalls, 2);
  assert.equal(result.candidates.length, 12);
  assert.ok(result.candidates.every(item => item.paths.length === 2));
  const childPages = result.audit.maps.filter(map => map.stage === 'children');
  assert.equal(childPages[0].result.value.items.at(-1).type, 'moc');
  assert.equal(childPages[1].result.value.items[0].type, 'ref');
  assert.ok(result.audit.maps.filter(map => map.stage === 'children').every(map => map.request.limit === 50));
  assert.ok(result.audit.maps.filter(map => map.stage === 'leaves').every(map => map.request.limit === 6));
  assert.ok(calls.every(call => call.purpose === 'recall' && call.tokenBudget === 4000));
});

test('H2 shared L1 reached through two L2 parents retains both paths and reads each leaf once', async () => {
  const { port } = syntheticPort({ roots: 2, children: 2, leaves: 1 });
  const result = await route(port, [personal], groupModel(firstGroups));
  assert.equal(result.audit.selectedL2.length, 2);
  assert.equal(result.audit.selectedL1.length, 2);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].paths.length, 4);
  assert.equal(new Set(result.candidates[0].paths.map(path => path.l2.mocId)).size, 2);
  assert.equal(result.audit.maps.filter(map => map.stage === 'leaves').length, 2);
});

test('H2 final namespace observation rejects drift after last leaf page', async () => {
  const { port } = syntheticPort({ leaves: 1 });
  let leafRead = false;
  const original = port.map;
  port.map = request => {
    const result = original(request);
    if (request.parentRef?.mocId.includes('-L1-')) leafRead = true;
    if (leafRead && !request.parentRef) result.value.indexRevision++;
    return result;
  };
  await assert.rejects(route(port, [personal], groupModel(firstGroups)), error => {
    assert.equal(error.code, 'index_revision_conflict');
    assert.equal(error.audit.maps.at(-1).stage, 'final-root'); return true;
  });
});

test('H3 orphan L1 and unfiled observations never become candidates or absence claims', async () => {
  const core = { map: () => ({ ok: true, value: { items: [
    { type: 'moc', moc: { id: 'orphan', level: 'L1', title: 'Orphan hint', revision: 1 } },
    { type: 'unfiled', ref: { memoryId: 'unfiled', revision: 1 }, label: 'unfiled hint' }],
  invalidRefs: [], indexRevision: 1, exhausted: true, nextCursor: null, truncatedBy: null } }) };
  const result = await route(core);
  assert.deepEqual(result.candidates, []); assert.equal(result.coverage, 'incomplete');
  assert.equal(result.notObservedMeansAbsent, false);
  assert.ok(result.unvisitedEvidence.includes('orphan-L1') && result.unvisitedEvidence.includes('unfiled'));
});

test('H2 invalid refs, bad joins and namespace group bounds reject, retaining observed invalid refs', async () => {
  for (const options of [{ invalid: true }, { wrongParent: true }]) {
    const { port } = syntheticPort(options);
    await assert.rejects(route(port, [personal], groupModel(firstGroups)), error => {
      assert.equal(error.code, 'invalid_ref');
      if (options.invalid) assert.equal(error.audit.maps[0].result.value.invalidRefs[0].reason, 'stale');
      return true;
    });
  }
  const { port } = syntheticPort();
  await assert.rejects(route(port, [personal], groupModel(({ input }) => ({ refs: input.maps[0].groups.slice(0, input.maxRefs).map(ref) }))),
    error => error.code === 'invalid_model_output');
});

test('H1 local query/readSet shape validation does not read map or model', async () => {
  for (const readSet of [[], [personal, personal], [personal, { ...project, ownerId: 'foreign' }],
    [{ ...personal, scope: 'project' }], [{ ...personal, extra: true }], Array(1)]) {
    const { port, calls } = syntheticPort();
    await assert.rejects(route(port, readSet), error => error.code === 'invalid_read_set');
    assert.equal(calls.length, 0);
  }
  for (const query of ['', 'x'.repeat(4001), null]) {
    const { port, calls } = syntheticPort();
    await assert.rejects(route(port, [personal], groupModel(), query));
    assert.equal(calls.length, 0);
  }
});

sqliteTest('H3 owned workspace cleanup after passing and deliberately failing behavior subprocesses', t => {
  const parent = createTestWorkspace(t, { prefix: 'cairn-moc-runner-probe-' });
  for (const failing of [false, true]) {
    const child = spawnSync(process.execPath, ['tools/testing/run.mjs', '--script',
      'evaluation/architecture/test/moc-hierarchy-candidates.test.mjs'],
      { cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, NODE_DISABLE_COMPILE_CACHE: '1',
        CAIRN_MOC_CLEANUP_PROBE: failing ? 'fail' : 'pass',
        TMPDIR: parent.path, TMP: parent.path, TEMP: parent.path } });
    assert.equal(child.status, failing ? 1 : 0, child.stderr);
    assert.deepEqual(readdirSync(parent.path), []);
    assert.equal(existsSync(parent.path), true);
  }
});

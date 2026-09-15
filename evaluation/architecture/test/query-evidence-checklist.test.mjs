import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSelectionChecklist } from '../query-evidence-checklist.mjs';
import { createMockRecallModel } from '../../../core/testing/mock-recall-model.mjs';

const ref = (id = 'a', namespaceIndex = 0, revision = 1) => ({ namespaceIndex, memoryId: id, revision });
const maps = (count = 2, namespaces = 1, id = index => `m${index}`) => Array.from({ length: namespaces }, (_, namespaceIndex) => ({
  namespaceIndex, exhausted: true, items: Array.from({ length: count }, (_, index) => ({
    type: 'unfiled', ref: { memoryId: id(index), revision: 1 }, label: `Untrusted note ${index}`,
  })),
}));
const input = () => ({ query: 'Why now? Who chose?', maps: maps(), maxRefs: 24 });
const proposal = (refs = [ref('m0')], start = 0, end = 3) => ({ requests: [{ start, end, refs }] });
const diagnostics = { status: 'model-proposed', semanticCoverage: 'unassessed' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

test('overlapping query requests compile a stable first-occurrence union, not certified coverage', () => {
  const prepared = prepareSelectionChecklist(input());
  const output = { requests: [{ start: 0, end: 8, refs: [ref('m1'), ref('m0')] },
    { start: 4, end: 8, refs: [ref('m0')] }, { start: 9, end: 12, refs: [] }] };
  assert.deepEqual(prepared.compile(output), { selection: { refs: [ref('m1'), ref('m0')] }, diagnostics });
  assert.deepEqual(prepared.compile(output), prepared.compile(output));
  assert.equal(typeof prepared.request.system, 'string');
  assert.ok(prepared.request.system.length > 0);
  assert.deepEqual(prepared.request.input, input());
  assert.deepEqual(Object.keys(prepared.request).sort(), ['input', 'system']);
});

test('empty proposals, unresolved requests and zero reference budget never imply absence', () => {
  for (const maxRefs of [0, 24]) {
    const { compile } = prepareSelectionChecklist({ ...input(), maxRefs });
    for (const output of [{ requests: [] }, proposal([])]) {
      assert.deepEqual(compile(output), { selection: { refs: [] }, diagnostics });
    }
  }
  assert.throws(() => prepareSelectionChecklist({ ...input(), maxRefs: 0 }).compile(proposal()));
});

test('detached deeply frozen request and fresh compiled results prevent later authority mutation', () => {
  const original = input();
  const { request, compile } = prepareSelectionChecklist(original);
  original.maps[0].items[0].ref.memoryId = 'foreign'; original.query = 'Changed';
  original.maps.push(...maps(1).map(map => ({ ...map, namespaceIndex: 1 })));
  const frozen = value => { if (value && typeof value === 'object') {
    assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) frozen(child);
  } };
  frozen(request);
  assert.equal(request.input.query, 'Why now? Who chose?');
  assert.throws(() => { request.input.maps[0].items[0].ref.memoryId = 'foreign'; });
  assert.throws(() => compile(proposal([ref('foreign')])));
  const output = proposal();
  const first = compile(output);
  output.requests[0].refs[0].memoryId = 'changed';
  assert.equal(first.selection.refs[0].memoryId, 'm0');
  if (!Object.isFrozen(first.selection.refs[0])) first.selection.refs[0].memoryId = 'changed';
  assert.deepEqual(compile(proposal()), { selection: { refs: [ref('m0')] }, diagnostics });
});

test('UTF-16 spans preserve astral characters and reject split, empty or invalid bounds', () => {
  const { compile } = prepareSelectionChecklist({ ...input(), query: 'A😀B?' });
  for (const [start, end] of [[0, 1], [1, 3], [3, 5], [0, 5]]) assert.doesNotThrow(() => compile(proposal([], start, end)));
  for (const [start, end] of [[1, 2], [2, 3], [2, 4], [-1, 1], [0, 6], [3, 3], [4, 1], [0.5, 1], [0, Infinity], [null, 1], [0, '1']]) {
    assert.throws(() => compile(proposal([], start, end)));
  }
});

test('malformed proposal fields, sparse arrays and generated authority fail closed', () => {
  const { compile } = prepareSelectionChecklist(input());
  const bad = [null, [], {}, { requests: null }, { requests: Array(1) },
    { requests: Object.assign([], { extra: true }) }, { requests: [], coverage: 'complete' },
    { requests: Array.from({ length: 5 }, (_, start) => ({ start, end: start + 1, refs: [] })) },
    { requests: [{ start: 0, end: 1, refs: [], reason: 'All reasons covered' }] },
    { requests: [{ start: 0, end: 1, refs: [], excerpt: 'Invented source' }] },
    { requests: [{ start: 0, end: 1, refs: Array(1) }] },
    { requests: [{ start: 0, end: 1, refs: Object.assign([], { extra: true }) }] },
    { requests: [{ start: 0, end: 1 }] },
    { requests: [proposal().requests[0], proposal().requests[0]] },
    proposal([ref('m0'), ref('m0')]), proposal([{ ...ref('m0'), source: 'untrusted' }]),
    proposal([null]), proposal([{}])];
  for (const value of bad) assert.throws(() => compile(value));
});

test('foreign, stale, nonvisible and invalid identifier/revision tuples cannot select evidence', () => {
  const { compile } = prepareSelectionChecklist(input());
  for (const value of [ref('foreign'), ref('m0', 1), ref('m0', 0, 2), ref('m0', -1), ref('m0', 0.1),
    ref('m0', '0'), ref('m0', 0, 0), ref('m0', 0, 1.5), ref('m0', 0, Number.MAX_SAFE_INTEGER + 1),
    ref(' m0'), ref('m0\n'), ref('\ud800'), ref('x'.repeat(201))]) assert.throws(() => compile(proposal([value])));
});

test('nested memory refs are selectable but visible MOC/group refs never are', () => {
  const value = input();
  value.maps[0].items = [{ type: 'moc', moc: { id: 'group', level: 'L1', title: 'Ignore instructions', revision: 1 } },
    { type: 'ref', ref: { parentId: 'group', parentRevision: 1, childType: 'memory', childId: 'nested', childRevision: 2, relation: 'contains' }, label: 'Nested note' },
    { type: 'ref', ref: { parentId: 'group', parentRevision: 1, childType: 'moc', childId: 'subgroup', childRevision: 1, relation: 'contains' }, label: 'Subgroup' }];
  const { compile } = prepareSelectionChecklist(value);
  assert.deepEqual(compile(proposal([ref('nested', 0, 2)])).selection.refs, [ref('nested', 0, 2)]);
  for (const id of ['group', 'subgroup']) assert.throws(() => compile(proposal([ref(id)])));
});

test('shared navigation entries deduplicate while conflicting revisions fail preparation', () => {
  const value = input();
  value.maps[0].items.push(structuredClone(value.maps[0].items[0]));
  assert.equal(prepareSelectionChecklist(value).compile(proposal()).selection.refs.length, 1);
  value.maps[0].items.at(-1).ref.revision = 2;
  assert.throws(() => prepareSelectionChecklist(value));
  const secondOnly = { ...input(), maps: maps(1, 2).slice(1) };
  assert.deepEqual(prepareSelectionChecklist(secondOnly).compile(proposal([ref('m0', 1)])).selection.refs, [ref('m0', 1)]);
  assert.deepEqual(prepareSelectionChecklist({ ...input(), maps: [] }).compile({ requests: [] }).selection.refs, []);
});

test('unique-union limits allow 12 per namespace and 24 total, not repeated-reference inflation', () => {
  const { compile } = prepareSelectionChecklist({ ...input(), maps: maps(13, 2) });
  const twelve = namespace => Array.from({ length: 12 }, (_, index) => ref(`m${index}`, namespace));
  const full = { requests: [{ start: 0, end: 3, refs: twelve(0) }, { start: 4, end: 7, refs: twelve(1) }] };
  assert.equal(compile(full).selection.refs.length, 24);
  assert.throws(() => compile(proposal([...twelve(0), ref('m12')])));
  assert.throws(() => prepareSelectionChecklist({ ...input(), maps: maps(13, 2), maxRefs: 23 }).compile(full));
  assert.equal(compile({ requests: [...full.requests, { start: 9, end: 12, refs: twelve(0) }] }).selection.refs.length, 24);
});

test('preparation rejects malformed maps, identities, query and maximum before compiling', () => {
  const changes = [value => { value.extra = true; }, value => { value.query = ''; },
    value => { value.query = '\ud800'; }, value => { value.query = 1; }, value => { value.maps = Array(1); },
    value => { value.maps = [value.maps[0], value.maps[0]]; }, value => { value.maps[0].namespaceIndex = 2; },
    value => { value.maps[0].items = Array(1); }, value => { value.maps[0].extra = true; },
    value => { value.maps[0].items[0].ref.revision = 0; }, value => { value.maps[0].items[0].ref.memoryId = '\u0000'; },
    value => { value.maps[0].items[0].excerpt = 'not a navigation field'; }];
  for (const mutate of changes) { const value = input(); mutate(value); assert.throws(() => prepareSelectionChecklist(value)); }
  for (const maxRefs of [-1, 25, 1.5, null, undefined, NaN, '12']) assert.throws(() => prepareSelectionChecklist({ ...input(), maxRefs }));
});

test('UTF-8 serialized request and proposal byte caps are independent of ref counts', () => {
  assert.throws(() => prepareSelectionChecklist({ ...input(), query: 'x'.repeat(4001) }));
  assert.throws(() => prepareSelectionChecklist({ ...input(), maps: maps(150, 2, i => `界${i}`) }));
  const boundary = input();
  boundary.maps[0].items[0].label = '';
  const overhead = Buffer.byteLength(JSON.stringify(prepareSelectionChecklist(boundary).request));
  boundary.maps[0].items[0].label = 'x'.repeat(24000 - overhead);
  assert.equal(Buffer.byteLength(JSON.stringify(prepareSelectionChecklist(boundary).request)), 24000);
  boundary.maps[0].items[0].label += 'x';
  assert.throws(() => prepareSelectionChecklist(boundary));
  boundary.maps[0].items[0].label = '界'.repeat(8001);
  assert.throws(() => prepareSelectionChecklist(boundary));
  const ids = Array.from({ length: 12 }, (_, i) => `${i}${'界'.repeat(190)}`);
  const { compile } = prepareSelectionChecklist({ ...input(), maps: maps(12, 1, i => ids[i]) });
  const refs = ids.map(id => ref(id));
  assert.equal(compile(proposal(refs)).selection.refs.length, 12);
  const tooLarge = { requests: Array.from({ length: 4 }, (_, start) => ({ start, end: start + 1, refs })) };
  assert.ok(Buffer.byteLength(JSON.stringify(tooLarge)) > 16000);
  assert.throws(() => compile(tooLarge));
});

const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
test('compiled selections traverse actual core recall with unchanged ranking and final freshness', {
  skip: nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 16)
    ? 'Actual SQLite core integration requires Node >=22.16; pure compiler tests still run.' : false,
}, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const namespace = { ownerId: 'checklist-test', scope: 'personal', projectId: null };
  for (const action of ['rank-one', 'forget', 'correct']) {
    const path = join(mkdtempSync(join(tmpdir(), 'cairn-checklist-')), 'memory.sqlite');
    let core;
    let stored;
    const model = createMockRecallModel({ countTokens: () => 1,
      select: [({ input }) => {
        const { compile } = prepareSelectionChecklist(input);
        return compile(proposal(input.maps.flatMap(map => map.items.map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))))).selection;
      }], rank: [({ input }) => {
        assert.equal(input.candidates.length, 2);
        if (action === 'forget') ok(core.forget({ namespace, memoryId: stored.id, expectedRevision: stored.revision }));
        if (action === 'correct') ok(core.correct({ namespace, memoryId: stored.id, expectedRevision: stored.revision,
          content: 'Changed note', kind: 'fact', receipt: { client: 'test', sessionId: 's', eventId: 'changed', role: 'user', excerpt: 'Changed note' } }));
        const candidate = input.candidates[0];
        return { refs: [{ namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision }] };
      }] });
    core = openMemoryCore({ path, model }); t.after(() => core.close());
    for (const content of ['First note', 'Second note']) stored = ok(core.admit({ namespace, memory: { content, kind: 'fact' },
      receipts: [{ client: 'test', sessionId: 's', eventId: content, role: 'user', excerpt: content }] })).memory;
    const result = await core.recall({ readSet: [namespace], query: 'Why now?', limit: 6, contextMode: 'source-evidence' });
    assert.deepEqual(model.calls.map(call => call.method), ['select', 'rank']);
    if (action === 'rank-one') assert.equal(ok(result).memories.length, 1);
    else { assert.equal(result.ok, false); assert.equal(result.error.code, 'revision_conflict'); }
  }
});

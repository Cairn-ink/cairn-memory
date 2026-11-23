import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const engineDir = process.env.ENGINE_DIR;
if (!engineDir) {
  console.error('Usage: ENGINE_DIR=<engine extract root> node tools/goldens/topics.generate.mjs');
  process.exit(2);
}

const load = (file) => import(pathToFileURL(resolve(engineDir, file)));
const [validation, { classify }, { packClassification }, { schemasFor }, { classificationWire },
  { openMemoryCore }, { createMockPlacementModel }, { createCjkTokenCounter }] = await Promise.all([
  'core/placement-input.mjs', 'core/classification.mjs', 'core/model-packing.mjs',
  'adapters/openai/schemas.mjs', 'adapters/openai/classification-wire.mjs', 'core/contract.mjs',
  'core/testing/mock-placement-model.mjs', 'core/testing/cjk-token-counter.mjs',
].map(load));

const prompt = await readFile(resolve(engineDir, 'core/prompts/classify-placement.md'), 'utf8');
const proposal = (...items) => ({ items });
const item = (memoryId = 'memory-a', parentIds = [], newL1) =>
  ({ memoryId, parentIds, ...(newL1 === undefined ? {} : { newL1 }) });
const topic = (title, parentL2Ids = [], newL2Title) =>
  ({ title, parentL2Ids, ...(newL2Title === undefined ? {} : { newL2Title }) });
const entry = (id, level, title = id) => ({ type: 'moc', moc: { id, level, title, revision: 1 } });
const memory = (id, content) => ({ id, revision: 1, kind: 'fact', content });
const input = (memories, map = [], mapExhausted = true) => ({ memories, map, mapExhausted });
const content = 'Explain the handshake using a sequence diagram.';

function capture(run) {
  try { return { value: run() }; }
  catch (error) { return { error: error.code ?? error.message }; }
}

const p1 = [];
function validate(name, method, args, hole) {
  const engineArgs = structuredClone(args);
  if (hole) delete (method === 'placementProposal' ? engineArgs[0].items : engineArgs[0])[0];
  p1.push({ name, method, args, ...(hole ? { hole } : {}), ...capture(() => validation[method](...engineArgs)) });
}

const requested = ['memory-a'];
// The proposal validator accepts opaque parent IDs. P2 exercises the catalog check.
validate('forged parent ID', 'placementProposal', [proposal(item('memory-a', ['foreign-or-invented'])), requested]);
validate('forged requested memory ID', 'placementProposal', [proposal(item('foreign-or-invented')), requested]);
validate('extra item key', 'placementProposal', [proposal({ ...item(), sourceIds: ['invented'] }), requested]);
validate('empty items', 'placementProposal', [proposal(), requested]);
validate('oversized title', 'placementProposal', [proposal(item('memory-a', [], topic('x'.repeat(121)))), requested]);
validate('junk top-level key', 'placementProposal', [{ items: [], junk: 'x'.repeat(50_000) }, requested]);
validate('duplicate memories', 'placementProposal', [proposal(item(), item())]);
validate('four L1 parents', 'placementProposal', [proposal(item('memory-a', ['a', 'b', 'c', 'd']))]);
validate('four L2 parents', 'placementProposal', [proposal(item('memory-a', [], topic('Topic', ['a', 'b', 'c', 'd'])))]);
validate('six items', 'placementProposal', [proposal(...Array.from({ length: 6 }, (_, i) => item('m' + i)))]);
validate('explicit six-item limit', 'placementProposal',
  [proposal(...Array.from({ length: 6 }, (_, i) => item('m' + i))), null, 6]);
validate('sparse items', 'placementProposal', [proposal(item())], true);
validate('new L2 title and requested ID order', 'placementProposal',
  [proposal(item('memory-b'), item('memory-a', ['shown'], topic('  Ａｌｐｈａ  topic ', ['domain'], '  Ｂｅｔａ  '))),
    ['memory-a', 'memory-b']]);
validate('unique IDs in input order', 'uniqueIds', [['b', 'a'], 3, 1]);
validate('duplicate IDs', 'uniqueIds', [['a', 'a'], 3]);
validate('invalid identifier', 'uniqueIds', [[' padded '], 3]);
validate('short ID array', 'uniqueIds', [[], 3, 1]);
validate('sparse ID array', 'uniqueIds', [['a', 'b'], 3], true);
validate('guards in input order', 'memoryGuards', [[{ memoryId: 'b', revision: 2 }, { memoryId: 'a', revision: 1 }], ['a', 'b']]);
validate('guard revision is positive', 'memoryGuards', [[{ memoryId: 'a', revision: 0 }], ['a']]);
validate('guard belongs to a requested memory', 'memoryGuards', [[{ memoryId: 'b', revision: 1 }], ['a']]);
validate('duplicate guard', 'memoryGuards', [[{ memoryId: 'a', revision: 1 }, { memoryId: 'a', revision: 2 }], ['a', 'b']]);
validate('invalid guard ID', 'memoryGuards', [[{ memoryId: '', revision: 1 }], ['a']]);
for (const [name, title] of [
  ['120 code points', '文'.repeat(120)],
  ['121 code points', '文'.repeat(121)],
  ['240 UTF-16 units', '😀'.repeat(120)],
  ['241 UTF-16 units', '😀'.repeat(120) + 'x'],
  ['surrogate pair straddles unit boundary', '😀'.repeat(119) + 'x😀'],
  ['CJK and width forms', '　 設計　ＡＰＩ\t１２３  '],
  ['secret inside title', 'Deploy with sk-synthetic000000000000'],
  ['secret-only title', 'sk-synthetic000000000000'],
]) validate(name, 'placementTitle', [title]);

const counter = {
  points: (text) => [...text].length,
  cjk: createCjkTokenCounter(),
  fits: () => 1,
  overflow: () => 6001,
  invalid: () => NaN,
};
const shown = [entry('architecture', 'L2'), { type: 'ref', ref: { childId: 'other' } }, entry('protocols', 'L1')];
const sample = input([memory('memory-a', content)], shown);
const p2 = [];
async function checkCatalog(name, output, payload) {
  const model = createMockPlacementModel([output], { countTokens: counter.fits });
  try {
    await classify({ model, snapshot: { memories: payload.memories, indexRevision: 1 },
      map: { items: payload.map, exhausted: payload.mapExhausted }, validateFresh() {} });
    p2.push({ name, proposal: output, shownMap: payload.map, mapExhausted: payload.mapExhausted, value: null });
  } catch (error) {
    assert.equal(error.code, 'invalid_model_output');
    p2.push({ name, proposal: output, shownMap: payload.map, mapExhausted: payload.mapExhausted, error: error.code });
  }
}
await checkCatalog('foreign L1 parent in a batch', proposal(item(), item('memory-b', ['foreign-or-invented'])),
  input([...sample.memories, memory('memory-b', 'Second target.')], shown));
await checkCatalog('existing L1 and L2', proposal(item('memory-a', ['protocols'], topic('Diagrams', ['architecture']))), sample);
await checkCatalog('L2 used as memory parent', proposal(item('memory-a', ['architecture'])), sample);
await checkCatalog('L1 used as topic parent', proposal(item('memory-a', [], topic('Diagrams', ['protocols']))), sample);
await checkCatalog('creation on an incomplete catalog', proposal(item('memory-a', [], topic('Launch planning'))),
  input(sample.memories, shown, false));
await checkCatalog('reuse on an incomplete catalog', proposal(item('memory-a', ['protocols'])), input(sample.memories, shown, false));

const p3 = [];
function pack(name, counterName, system, payload) {
  const model = { countTokens: counter[counterName] };
  const result = capture(() => {
    const packed = packClassification(model, system, payload);
    assert.deepStrictEqual(packClassification(model, system, payload), packed);
    return { ...packed, sameInput: packed.input === payload };
  });
  const record = { name, counter: counterName, system, input: payload, ...result };
  p3.push(record);
  return record;
}
const long = input([memory('m0', 'x'.repeat(2000)), memory('m1', 'x'.repeat(2000))],
  Array.from({ length: 60 }, (_, i) => entry('t' + i, 'L1', 'y'.repeat(40))));
pack('catalog tail after memory floor', 'points', 'system', long);
const small = input(long.memories.slice(0, 1));
pack('fitting request keeps object identity', 'fits', 'system', small);
pack('floor without a catalog overflows', 'overflow', 'system', small);
pack('invalid token count', 'invalid', 'system', small);

const passage = '我們今天把部署流程重新整理了一遍，決定先在測試環境驗證資料庫遷移，再請團隊成員檢查設定檔與監控告警。';
const zh = (length, seed) => Array.from({ length }, (_, i) => passage[(seed * 5 + i) % passage.length]).join('');
const fixtureTime = '2000-01-01T00:00:00.000Z';
const budgetNamespace = { ownerId: 'cr1-classify', scope: 'personal', projectId: null };
const sizedId = (prefix, i) => prefix + String(i).padStart(35, '0');
const sizedMemory = (i, content) => ({ ...memory(sizedId('m', i), content), namespace: budgetNamespace,
  origin: 'explicit', confidence: 1, state: 'active', filing: { status: 'unfiled' },
  receiptCount: 1, createdAt: fixtureTime, updatedAt: fixtureTime });
const sizedTopic = (i, title) => entry(sizedId('t', i), 'L1', title);
const chinese = input(Array.from({ length: 5 }, (_, i) => sizedMemory(i, `長篇決定${i}：${zh(600, i)}`)),
  Array.from({ length: 80 }, (_, i) => sizedTopic(i, `部署主題${i}：監控與遷移計畫`))
    .sort((a, b) => Buffer.compare(Buffer.from(a.moc.title), Buffer.from(b.moc.title))));
const packedChinese = pack('shorten five Chinese memories and retain all 80 topics', 'cjk', prompt, chinese);
assert.equal(packedChinese.value.memoriesShortened, 5);
assert.equal(packedChinese.value.catalogItemsOmitted, 0);

const hidden = input(
  Array.from({ length: 5 }, (_, i) => sizedMemory(i, `target ${i} ${'w'.repeat(3900)}`)),
  Array.from({ length: 30 }, (_, i) => sizedTopic(i, 'T' + String(i).padStart(2, '0'))),
);
const omitted = pack('first omitted topic is outside the shown map', 'points', prompt, hidden);
assert.ok(omitted.value.catalogItemsOmitted > 0);
const firstOmitted = hidden.map[omitted.value.input.map.length].moc.id;
await checkCatalog('packing omitted the proposed parent',
  proposal(...hidden.memories.map(({ id }) => item(id, [firstOmitted]))), omitted.value.input);

const p4 = [{ name: 'classification prompt bytes', value: prompt }];
const p5 = [];
function wireCase(name, payload, output) {
  const schema = capture(() => schemasFor('classify', payload));
  const wire = classificationWire(payload);
  const wireSchema = capture(() => schemasFor('classify', wire.input));
  p5.push({ name, input: payload, schema, wireInput: wire.input, wireSchema,
    ...(output ? { output, decode: capture(() => wire.decode(output)) } : {}) });
}

wireCase('zero memories and empty map', input([]), proposal());
wireCase('one memory and L1 only, complete', input(sample.memories, [entry('protocols', 'L1')]),
  proposal(item('m0', ['c0'], topic('Diagrams', [], 'Engineering'))));
wireCase('one memory and L2 only, complete', input(sample.memories, [entry('architecture', 'L2')]),
  proposal(item('m0', [], topic('Diagrams', ['c0']))));
const five = input(Array.from({ length: 5 }, (_, i) => memory('memory-' + (4 - i), 'Memory ' + i)), [
  entry('zz', 'L1'), entry('domain', 'L2'), entry('aa', 'L1'), entry('zz', 'L1'),
  { type: 'unfiled', ref: { memoryId: 'ignored' } },
], false);
wireCase('five memories and mixed catalog, incomplete', five, proposal(...five.memories.map((_, i) => item('m' + i, ['c2']))));
wireCase('duplicate memory reuses its wire alias and is rejected by the schema',
  input([...sample.memories, ...sample.memories]), proposal(item('m0')));
wireCase('unknown group level', input(sample.memories, [entry('opaque', 'L3')]));
wireCase('unknown memory alias', sample, proposal(item('m9')));
wireCase('unknown L1 alias', sample, proposal(item('m0', ['c9'])));
wireCase('unknown L2 alias', sample, proposal(item('m0', [], topic('Diagrams', ['c9']))));
wireCase('catalog aliases use base 36', input(sample.memories, Array.from({ length: 37 }, (_, i) => entry('group-' + i, 'L1'))),
  proposal(item('m0', ['cz', 'c10'])));

const placementNamespace = { ownerId: 'owner', scope: 'project', projectId: 'project' };
const catalogNamespace = { ownerId: 'catalog-test', scope: 'project', projectId: 'notes' };
const classifyNamespace = { ownerId: 'classifier-test', scope: 'project', projectId: 'notes' };
const reuse = ({ input }) => proposal(...input.memories.map(({ id }) => item(id,
  input.map.filter(({ moc }) => moc.level === 'L1').map(({ moc }) => moc.id))));
const abstain = ({ input }) => proposal(...input.memories.map(({ id }) => item(id)));
const diagram = ({ input }) => proposal(...input.memories.map(({ id }) =>
  item(id, [], topic('Protocol diagrams', [], 'Engineering'))));
const launch = ({ input }) => proposal(...input.memories.map(({ id }) => item(id, [], topic('Launch planning'))));
const useFirst = ({ input }) => proposal(...input.memories.map(({ id }) => item(id, [input.map[0].moc.id])));

function ok(result) {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.value;
}
function errorCode(result) {
  assert.equal(result.ok, false, JSON.stringify(result));
  return result.error.code;
}
const project = (fn) => (a, b) => Buffer.compare(Buffer.from(fn(a)), Buffer.from(fn(b)));
const byTitle = project((value) => value.title);
const byContent = project((value) => value.content);

let scratch;
let databaseCount = 0;
async function fixture(namespace, steps, options, run) {
  const path = join(scratch, `topics-${++databaseCount}.sqlite`);
  const model = createMockPlacementModel(steps, options);
  const core = openMemoryCore({ path, model });
  const memoryIds = new Map();
  const topicIds = new Map();
  const namedMemory = (id) => {
    assert.ok(memoryIds.has(id), 'known memory');
    return memoryIds.get(id);
  };
  const namedTopic = (id) => {
    assert.ok(topicIds.has(id), 'known topic');
    return topicIds.get(id);
  };
  const admit = (text, ns = namespace, kind = 'instruction', receipt) => {
    const admitted = ok(core.admit({ namespace: ns, memory: { content: text, kind },
      receipts: [receipt ?? { client: 'test', sessionId: 'session', eventId: text, role: 'user', excerpt: text }] })).memory;
    const { memory } = ok(core.get({ namespace: ns, memoryId: admitted.id }));
    memoryIds.set(memory.id, memory.content);
    return memory;
  };
  const map = (ns = namespace, purpose = 'classification') => ok(core.map({ namespace: ns, purpose }));
  const detail = (id) => ok(core.get({ namespace, memoryId: id }));
  const apply = (items, ns = namespace, guards, epoch) => core.applyPlacement({
    namespace: ns, proposal: { items },
    expectedMemoryRevisions: guards ?? items.map(({ memoryId }) => ({ memoryId,
      revision: ok(core.get({ namespace: ns, memoryId })).memory.revision })),
    expectedIndexRevision: epoch ?? map(ns).indexRevision,
  });
  const remember = (result) => {
    for (const moc of result.createdMocs) topicIds.set(moc.id, moc.title);
    return result;
  };
  const place = (items, ns) => remember(ok(apply(items, ns)));
  const create = (memory, title, newL2Title, ns) =>
    place([item(memory.id, [], topic(title, [], newL2Title))], ns).createdMocs;
  const request = (memories) => ({ namespace, memoryIds: memories.map(({ id }) => id),
    expectedMemoryRevisions: memories.map(({ id }) => ({ memoryId: id, revision: detail(id).memory.revision })),
    mapRevision: map().indexRevision });
  const applyClassified = ({ proposal, basedOn }) => remember(ok(core.applyPlacement({
    namespace, proposal, expectedMemoryRevisions: basedOn.memoryRevisions, expectedIndexRevision: basedOn.indexRevision,
  })));
  const topicView = ({ id, level, title }) => ({ id: namedTopic(id), level, title });
  const readCatalog = ({ input }) => ({
    topics: input.map.map(({ moc }) => topicView(moc)), count: input.map.length, mapExhausted: input.mapExhausted,
  });
  const storeState = (memories) => {
    const page = map(namespace, 'recall');
    assert.equal(page.exhausted, true);
    return {
      indexRevision: page.indexRevision,
      memories: memories.map(({ id }) => {
        const { memory, placements } = detail(id);
        return { content: memory.content, revision: memory.revision, filing: memory.filing.status,
          topics: placements.map(({ mocId }) => namedTopic(mocId)).sort() };
      }).sort(byContent),
      topics: page.items.filter(({ type }) => type === 'moc').map(({ moc }) => ({
        title: namedTopic(moc.id), visibleTitle: moc.title, level: moc.level, revision: moc.revision,
      })).sort(byTitle),
      edges: page.items.filter(({ type, ref }) => type === 'ref' && ref.childType === 'moc')
        .map(({ ref }) => ({ parent: namedTopic(ref.parentId), child: namedTopic(ref.childId) }))
        .sort(project(({ parent, child }) => parent + '\0' + child)),
    };
  };
  const placement = (result, memories) => ({
    created: { L1: result.createdMocs.filter(({ level }) => level === 'L1').length,
      L2: result.createdMocs.filter(({ level }) => level === 'L2').length },
    titleSources: result.createdMocs.map(({ title, titleSources }) => ({ title, sources: titleSources.map(
      ({ memoryId, memoryRevision }) => ({ content: namedMemory(memoryId), revision: memoryRevision })).sort(byContent),
    })).sort(byTitle),
    ...storeState(memories),
  });
  try {
    return await run({ core, model, path, admit, apply, place, create, request, applyClassified, map,
      namedTopic, namedMemory, topicView, readCatalog, storeState, placement });
  } finally {
    core.close();
  }
}

const p6 = [];
async function placementCase(name, run, { namespace = placementNamespace, steps = [] } = {}) {
  await fixture(namespace, steps, {}, async (f) => p6.push({ name, ...await run(f) }));
}

async function generateStorageCases() {
  const instructions = 'Use sequence diagrams to explain network protocols.';
  await placementCase('create an L1 and L2 with sourced edges', (f) => {
    const target = f.admit(instructions);
    const items = [item(target.id, [], topic('Protocol diagrams', [], 'Engineering'))];
    return { input: { items: [item(target.content, [], items[0].newL1)] }, value: f.placement(f.place(items), [target]) };
  });
  await placementCase('coalesce matching new titles across two sources', (f) => {
    const targets = [f.admit('Document client messages.'), f.admit('Document server messages.')];
    const newL1 = topic('Message formats', [], 'Protocols');
    return { input: { items: targets.map((m) => item(m.content, [], newL1)) },
      value: f.placement(f.place(targets.map((m) => item(m.id, [], newL1))), targets) };
  });
  await placementCase('coalesced existing L2 union exceeds three', (f) => {
    const parents = Array.from({ length: 4 }, (_, i) =>
      f.create(f.admit(`Parent source ${i}`), `Child ${i}`, `Parent ${i}`).find(({ level }) => level === 'L2'));
    const targets = [f.admit('First contributor'), f.admit('Second contributor')];
    const items = (key, parentKey) => targets.map((m, i) =>
      item(m[key], [], topic('Combined topic', parents.slice(i * 2, i * 2 + 2).map((parent) => parent[parentKey]))));
    const before = f.storeState(targets);
    const error = errorCode(f.apply(items('id', 'id')));
    const after = f.storeState(targets);
    assert.deepStrictEqual(after, before);
    return { input: { items: items('content', 'title') }, error, after };
  });
  await placementCase('many-to-many replacement, no-op and hierarchy linking', (f) => {
    const a = f.admit('Keep protocol notes.');
    const ga = f.create(a, 'Networking', 'Work');
    const b = f.admit('Keep meeting notes.');
    const gb = f.create(b, 'Meetings', 'Collaboration');
    const l1a = ga.find(({ level }) => level === 'L1');
    const l1b = gb.find(({ level }) => level === 'L1');
    const l2a = ga.find(({ level }) => level === 'L2');
    const targets = [a, b];
    const moved = f.placement(f.place([item(a.id, [l1a.id, l1b.id])]), targets);
    const noOp = f.placement(f.place([item(a.id, [l1b.id, l1a.id])]), targets);
    assert.deepStrictEqual(noOp, moved);
    const current = (moc) => moved.topics.find(({ title }) => title === moc.title).revision;
    const link = { namespace: placementNamespace, parentId: l2a.id, expectedParentRevision: current(l2a),
      childId: l1b.id, expectedChildRevision: current(l1b), expectedIndexRevision: noOp.indexRevision };
    const linked = ok(f.core.linkMocs(link));
    const duplicate = ok(f.core.linkMocs({ ...link, expectedParentRevision: linked.ref.parentRevision,
      expectedIndexRevision: linked.indexRevision }));
    const staleParent = errorCode(f.core.map({ namespace: placementNamespace,
      parentRef: { mocId: l2a.id, revision: link.expectedParentRevision } }));
    const unfiled = f.placement(f.place([item(a.id)]), targets);
    return { input: { memory: a.content, added: l1b.title, linked: { parent: l2a.title, child: l1b.title } },
      value: { moved, noOp, linked: { duplicate: linked.duplicate, parentRevision: linked.ref.parentRevision },
        duplicate: { duplicate: duplicate.duplicate, indexRevision: duplicate.indexRevision }, staleParent, unfiled } };
  });
  await placementCase('scope, level, title and stale guards are atomic', (f) => {
    const a = f.admit(instructions);
    const groups = f.create(a, 'Diagrams', 'Engineering');
    const b = f.admit('Another independent memory.');
    const foreign = { ...placementNamespace, ownerId: 'other-owner' };
    const other = f.admit('Foreign note.', foreign);
    const [foreignGroup] = f.place([item(other.id, [], topic('Private'))], foreign).createdMocs;
    const l2 = groups.find(({ level }) => level === 'L2');
    const before = f.storeState([a, b]);
    const revision = [{ memoryId: b.id, revision: 1 }];
    const newItems = [item(b.id, [], topic('Must not be created'))];
    const outcomes = {
      foreign: errorCode(f.apply([item(b.id, [foreignGroup.id])])),
      level: errorCode(f.apply([item(b.id, [l2.id])])),
      title: errorCode(f.apply([item(b.id, [], topic('  DIAGRAMS '))])),
      memoryRevision: errorCode(f.apply(newItems, placementNamespace, [{ memoryId: b.id, revision: 99 }])),
      indexRevision: errorCode(f.apply(newItems, placementNamespace, revision, before.indexRevision - 1)),
      missingGuard: errorCode(f.apply(newItems, placementNamespace, [])),
    };
    const after = f.storeState([a, b]);
    assert.deepStrictEqual(after, before);
    return { input: { memory: b.content, foreign: foreignGroup.title, wrongLevel: l2.title,
      duplicateTitle: '  DIAGRAMS ', proposedTitle: 'Must not be created' }, value: { outcomes, after } };
  });
  await placementCase('reuse two existing topics without creating another', async (f) => {
    const titles = ['Protocol notes', 'Diagram conventions'];
    const seeds = titles.map((title) => {
      const seed = f.admit(title);
      f.create(seed, title);
      return seed;
    });
    const target = f.admit(content);
    const classified = ok(await f.core.classifyPlacement(f.request([target])));
    return { input: { titles, memory: target.content }, value: f.placement(f.applyClassified(classified), [...seeds, target]) };
  }, { namespace: classifyNamespace, steps: [reuse] });

  await generateCatalogCases();
  await generateClassifyCases();
}

const p7 = [];
const catalogSnapshot = ({ topics, mapExhausted }) => ({ topics, count: topics.length, mapExhausted });

async function generateCatalogCases() {
  await fixture(catalogNamespace, [abstain], {}, async (f) => {
    const seed = f.admit('Old source body.', catalogNamespace, 'fact');
    const [created] = f.create(seed, 'Old source topic');
    ok(f.core.forget({ namespace: catalogNamespace, memoryId: seed.id, expectedRevision: 2 }));
    const foreign = [
      { ...catalogNamespace, ownerId: 'other' },
      { ...catalogNamespace, projectId: 'other' },
      { ...catalogNamespace, scope: 'personal', projectId: null },
    ];
    for (const ns of foreign) {
      const memory = f.admit('Foreign private body.', ns, 'fact');
      f.create(memory, 'Foreign private topic', undefined, ns);
    }
    const target = f.admit('Current source body.', catalogNamespace, 'fact');
    ok(await f.core.classifyPlacement(f.request([target])));
    const value = f.readCatalog(f.model.calls[0]);
    const visible = [f.topicView({ ...created, title: null })];
    assert.deepStrictEqual(value, catalogSnapshot({ topics: visible, mapExhausted: true }));
    p7.push({ name: 'empty group retained with a stale title and other namespaces excluded',
      orderInput: visible, value });
  });
  await fixture(classifyNamespace, [diagram, useFirst], { countTokens: counter.fits }, async (f) => {
    const topics = [];
    for (let i = 0; i < 101; i++) {
      const [created] = f.create(f.admit(`Seed topic ${i}.`), `Topic ${i}`);
      topics.push(f.topicView(created));
    }
    const target = f.admit(content);
    const request = f.request([target]);
    const rejected = errorCode(await f.core.classifyPlacement(request));
    const classified = ok(await f.core.classifyPlacement(request));
    const value = f.readCatalog(f.model.calls[0]);
    assert.equal(value.count, 100);
    assert.equal(value.mapExhausted, false);
    assert.deepStrictEqual(f.readCatalog(f.model.calls[1]), value);
    p7.push({ name: '101 topics cap the catalog at 100', orderInput: topics.reverse(), value,
      classification: { speculativeCreation: rejected, reused: f.namedTopic(classified.proposal.items[0].parentIds[0]),
        created: f.applyClassified(classified).createdMocs.length } });
  });
  let constrain = false;
  const catalogCursors = new Set();
  await fixture(catalogNamespace, [launch, useFirst], { countTokens(text) {
    const parsed = text ? JSON.parse(text) : null;
    if (constrain && parsed?.value?.items) {
      const { nextCursor } = parsed.value;
      if (nextCursor && JSON.parse(Buffer.from(nextCursor.split('.')[0], 'base64url')).o === 'classification_catalog') {
        catalogCursors.add(nextCursor);
      }
      return parsed.value.items.length > 1 ? 4001 : 1;
    }
    return 1;
  } }, async (f) => {
    const topics = Array.from({ length: 3 }, (_, i) =>
      f.topicView(f.create(f.admit(`Topic source ${i}.`, catalogNamespace, 'fact'), `Topic ${i}`)[0]));
    const target = f.admit('Launch review happens Thursday.', catalogNamespace, 'fact');
    const request = f.request([target]);
    constrain = true;
    const speculativeCreation = errorCode(await f.core.classifyPlacement(request));
    const classified = ok(await f.core.classifyPlacement(request));
    assert.ok(catalogCursors.size > 0);
    const cursorOnPublicMap = [...new Set([...catalogCursors].map((cursor) => errorCode(f.core.map({
      namespace: catalogNamespace, purpose: 'classification', cursor,
    }))))];
    p7.push({ name: 'token envelope truncation and cursor scope', input: { topics }, value: f.readCatalog(f.model.calls[1]),
      classification: { speculativeCreation, reused: f.namedTopic(classified.proposal.items[0].parentIds[0]),
        cursorOnPublicMap } });
  });

  // Stable synthetic rows exercise the engine's SQLite ordering expression,
  // including ties where randomized engine IDs would make a pin unstable.
  const rows = [
    { id: '😀', level: 'L1', title: null },
    { id: '\ue000', level: 'L1', title: '' },
    { id: 'z', level: 'L1', title: '😀' },
    { id: 'a', level: 'L1', title: '\ue000' },
    { id: 'middle', level: 'L1', title: 'Z' },
    { id: 'first', level: 'L2', title: null },
  ];
  const db = new DatabaseSync(join(scratch, 'catalog-order.sqlite'));
  try {
    db.exec('CREATE TABLE topics (id TEXT, level INTEGER, title TEXT)');
    const insert = db.prepare('INSERT INTO topics VALUES (?, ?, ?)');
    for (const { id, level, title } of rows) insert.run(id, Number(level[1]), title);
    const ordered = db.prepare("SELECT id, level, title FROM topics ORDER BY level, COALESCE(title, ''), id LIMIT 100")
      .all().map(({ id, level, title }) => ({ id, level: 'L' + level, title }));
    p7.push({ name: 'SQLite UTF-8 order for titles, nulls and ID ties', orderInput: rows,
      value: catalogSnapshot({ topics: ordered, mapExhausted: true }) });
  } finally {
    db.close();
  }
}

const p8 = [];
async function generateClassifyCases() {
  await fixture(classifyNamespace, [diagram], {}, async (f) => {
    const memory = f.admit(content);
    const request = f.request([memory]);
    const before = f.storeState([memory]);
    const result = ok(await f.core.classifyPlacement(request));
    const after = f.storeState([memory]);
    assert.deepStrictEqual(after, before);
    p8.push({ name: 'cold start proposes a hierarchy before an explicit apply',
      input: { content, memoryRevisions: [{ memoryId: content, revision: memory.revision }], mapRevision: request.mapRevision },
      value: {
        proposal: { items: result.proposal.items.map((item) => ({ ...item, memoryId: f.namedMemory(item.memoryId) })) },
        basedOn: { ...result.basedOn, memoryRevisions: result.basedOn.memoryRevisions.map(({ memoryId, revision }) =>
          ({ memoryId: f.namedMemory(memoryId), revision })) },
        afterClassify: after,
        afterApply: f.placement(f.applyClassified(result), [memory]),
      },
      calls: modelCalls(f, f.model),
    });
  });
  await fixture(classifyNamespace, [], {}, async (f) => {
    const target = f.admit(content);
    const request = f.request([target]);
    const before = f.storeState([target]);
    let missingCounterCalls = 0;
    for (const [name, model] of [
      ['missing model', undefined],
      ['missing counter', { contextWindow: 8192, classify() { missingCounterCalls++; throw new Error('must not call'); } }],
      ['NaN counter', createMockPlacementModel([], { countTokens: counter.invalid })],
      ['4096-token context', createMockPlacementModel([], { contextWindow: 4096 })],
      ['6001-token request', createMockPlacementModel([], {
        countTokens: (text) => text.includes('"system"') ? 6001 : Math.ceil(text.length / 4),
      })],
      ['adapter timeout', createMockPlacementModel([() => {
        throw Object.assign(new Error('synthetic timeout'), { code: 'model_timeout' });
      }])],
    ]) {
      const core = openMemoryCore({ path: f.path, ...(model ? { model } : {}) });
      try {
        const result = await core.classifyPlacement(request);
        const after = f.storeState([target]);
        assert.deepStrictEqual(after, before);
        assert.equal(missingCounterCalls, 0);
        p8.push({ name, input: { content, mapRevision: request.mapRevision }, error: errorCode(result),
          retryable: result.error.retryable, after, calls: modelCalls(f, model) });
      } finally {
        core.close();
      }
    }
  });
}

function modelCalls(f, model) {
  return (model?.calls ?? []).map(({ system, input, maxOutputTokens, signal }) => ({
    system, input: { ...input,
      memories: input.memories.map((memory) => ({
        ...memory, id: f.namedMemory(memory.id), createdAt: fixtureTime, updatedAt: fixtureTime,
      })),
      map: input.map.map(({ type, moc }) => ({ type, moc: { ...moc, id: f.namedTopic(moc.id) } })),
    }, maxOutputTokens, hasAbortSignal: signal instanceof AbortSignal,
  }));
}

scratch = await mkdtemp(join(resolve(engineDir), 'topics-goldens-'));
try {
  await generateStorageCases();
} finally {
  await rm(scratch, { recursive: true, force: true });
}
const golden = { P1: p1, P2: p2, P3: p3, P4: p4, P5: p5, P6: p6, P7: p7, P8: p8 };
await writeFile(new URL('../../packages/core/test/fixtures/topics/engine-goldens.json', import.meta.url),
  JSON.stringify(golden, null, 2) + '\n');

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { checkProposalAgainstCatalog, compareUtf8, CoreError, placePendingBatch } from '@cairn-ink/core';
import { createMemoryAdapter } from '@cairn-ink/adapter-memory';

const golden = JSON.parse(readFileSync(new URL('../../core/test/fixtures/topics/engine-goldens.json', import.meta.url), 'utf8'));
const engineCodes = {
  invalid_input: 'invalid_input',
  invalid_ref: 'invalid_ref',
  moc_title_conflict: 'moc_title_conflict',
  moc_not_found: 'not_found',
  index_revision_conflict: 'revision_conflict',
  memory_not_found: 'revision_conflict',
  revision_conflict: 'revision_conflict',
};
const scope = { owner: 'owner', namespace: 'topics' };
const query = { cursor: null, limit: 100 };
const item = (memoryId, parentIds = [], newL1) => ({ memoryId, parentIds, ...(newL1 && { newL1 }) });
const topic = (title, parentL2Ids = [], newL2Title) => ({ title, parentL2Ids, ...(newL2Title && { newL2Title }) });
const by = (key) => (a, b) => compareUtf8(key(a), key(b));
const byEdge = by(({ parent, child }) => parent + '\0' + child);

function fixture() {
  const reserved = [];
  let next = 0;
  const { uow, memories, placement, harness } = createMemoryAdapter({
    capabilities: { placement: true }, now: () => 10, newId: () => reserved.shift() ?? `generated-${++next}`,
  });
  const topicNames = new Map();
  const memoryNames = new Map();
  const read = (target, fn) => uow.run(target.owner, { readOnly: true }, fn);
  const write = (target, fn) => uow.run(target.owner, { pauseLock: true }, fn);
  const catalog = (target = scope, page = query) => read(target, (tx) => placement.catalog(tx, target, page));
  const index = async () => (await catalog()).indexRevision;

  async function seed(content, target = scope) {
    const { id } = await write(target, (tx) => memories.insert(tx, target, {
      kind: 'fact', origin: 'explicit', confidence: 0.9, embedding: null,
      text: content, textHash: 'sha256:' + createHash('sha256').update(content).digest('hex'),
      source: { kind: 'mcp', client: null, sessionId: null },
    }, [], 1));
    memoryNames.set(content, id);
    return id;
  }

  async function apply(items, target = scope, overrides = {}) {
    const result = await write(target, async (tx) => {
      const memoryRevisions = overrides.memoryRevisions ?? await Promise.all(items.map(async ({ memoryId }) =>
        ({ memoryId, revision: (await memories.readRevision(tx, target, memoryId)).revision })));
      const indexRevision = overrides.indexRevision ?? (await placement.catalog(tx, target, query)).indexRevision;
      return placement.applyPlacement(tx, target, { memoryRevisions, indexRevision }, { items });
    });
    for (const { id, title } of result.createdTopics) topicNames.set(id, title);
    return result;
  }

  const create = async (content, title, parent, target = scope) => {
    const id = await seed(content, target);
    return (await apply([item(id, [], topic(title, [], parent))], target)).createdTopics;
  };

  async function state(contents) {
    const { items } = await catalog();
    const topics = items.map(({ id, level, title: visibleTitle }) => ({
      title: topicNames.get(id), level, visibleTitle,
    })).sort(by(({ title }) => title));
    const memberships = await read(scope, (tx) => Promise.all(contents.map(async (content) => ({
      content, topics: (await placement.forMemory(tx, scope, memoryNames.get(content))).map((id) => topicNames.get(id)).sort(),
    }))));
    const edges = items.flatMap(({ id, parentIds }) => parentIds.map((parentId) =>
      ({ parent: topicNames.get(parentId), child: topicNames.get(id) }))).sort(byEdge);
    return { topics, memories: memberships.sort(by(({ content }) => content)), edges };
  }

  return {
    reserved, seed, apply, create, state, catalog, index, topicNames,
    erase: (id, target = scope) => write(target, (tx) => memories.erase(tx, target, id)),
    dump: harness.dump,
    async prepareReplay(items) {
      for (const { memoryId } of items) await seed(memoryId);
      const topicId = (title) => [...topicNames].find(([, name]) => name === title)[0];
      return () => apply(items.map(({ memoryId, parentIds, newL1 }) => item(memoryNames.get(memoryId),
        parentIds.map(topicId), newL1 && { ...newL1, parentL2Ids: newL1.parentL2Ids.map(topicId) })));
    },
    batch: (classify) => placePendingBatch({ uow, scope, memories, placement, classify }),
  };
}

const contents = (expected) => expected.memories.map(({ content }) => content);

function expectedState({ topics, memories, edges }) {
  return {
    topics: topics.map(({ title, level, visibleTitle }) => ({ title, level, visibleTitle })),
    memories: memories.map(({ content, topics }) => ({ content, topics })),
    edges,
  };
}

async function compare(f, expected, result) {
  assert.deepEqual(await f.state(contents(expected)), expectedState(expected));
  if (result) {
    const created = Object.fromEntries(['L1', 'L2'].map((level) =>
      [level, result.createdTopics.filter((entry) => entry.level === level).length]));
    assert.deepEqual(created, expected.created);
  }
}

async function expectCode(f, action, engineCode) {
  assert.ok(Object.hasOwn(engineCodes, engineCode), engineCode);
  const before = await f.dump();
  await assert.rejects(action, { name: CoreError.name, code: engineCodes[engineCode] });
  assert.deepEqual(await f.dump(), before);
}

const scenarios = {
  async 'create an L1 and L2 with sourced edges'(f, { input, value }) {
    await compare(f, value, await (await f.prepareReplay(input.items))());
  },
  async 'coalesce matching new titles across two sources'(f, { input, value }) {
    await compare(f, value, await (await f.prepareReplay(input.items))());
  },
  async 'coalesced existing L2 union exceeds three'(f, { input, error, after }) {
    for (let i = 0; i < 4; i++) await f.create(`Parent source ${i}`, `Child ${i}`, `Parent ${i}`);
    await expectCode(f, await f.prepareReplay(input.items), error);
    await compare(f, after);
  },
  async 'many-to-many replacement, no-op and hierarchy linking'(f, { input, value }) {
    const a = await f.seed(input.memory);
    const aTopics = await f.apply([item(a, [], topic('Networking', [], input.linked.parent))]);
    const bTopics = await f.create('Keep meeting notes.', input.added, 'Collaboration');
    const first = aTopics.createdTopics.find(({ level }) => level === 'L1').id;
    const second = bTopics.find(({ level }) => level === 'L1').id;
    const before = await f.index();
    await compare(f, value.moved, await f.apply([item(a, [first, second])]));
    const moved = await f.index();
    assert.equal(moved - before, 1);
    await compare(f, value.noOp, await f.apply([item(a, [second, first])]));
    assert.equal((await f.index()) - moved, value.noOp.indexRevision - value.moved.indexRevision);

    const result = await f.apply([item(a)]);
    // The intervening link steps have no TopicStore operation. Catalog keeps the
    // creation-time hierarchy and titles, including topics that are now empty.
    await compare(f, { ...value.unfiled, topics: value.moved.topics, edges: value.moved.edges }, result);
    assert.equal((await f.index()) - moved, value.unfiled.indexRevision - value.duplicate.indexRevision);
  },
  async 'scope, level, title and stale guards are atomic'(f, { input, value }) {
    const original = value.after.memories.find(({ content }) => content !== input.memory).content;
    const seed = value.after.memories.find(({ content }) => content === original).topics[0];
    const [{ id: privateId }] = await f.create('Foreign note.', input.foreign, undefined, { ...scope, owner: 'another' });
    const groups = await f.create(original, seed, input.wrongLevel);
    const wrongLevel = groups.find(({ level }) => level === 'L2').id;
    const b = await f.seed(input.memory);
    const newItems = [item(b, [], topic(input.proposedTitle))];
    const revision = await f.index();
    const attempts = {
      foreign: () => f.apply([item(b, [privateId])]),
      level: () => f.apply([item(b, [wrongLevel])]),
      title: () => f.apply([item(b, [], topic(input.duplicateTitle))]),
      memoryRevision: () => f.apply(newItems, scope, { memoryRevisions: [{ memoryId: b, revision: 99 }] }),
      indexRevision: () => f.apply(newItems, scope, { indexRevision: revision - 1 }),
      missingGuard: () => f.apply(newItems, scope, { memoryRevisions: [] }),
    };
    for (const [name, code] of Object.entries(value.outcomes)) await expectCode(f, attempts[name], code);
    await compare(f, value.after);
  },
  async 'reuse two existing topics without creating another'(f, { input, value }) {
    const ids = [];
    for (const title of input.titles) ids.push((await f.create(title, title))[0].id);
    const memory = await f.seed(input.memory);
    await compare(f, value, await f.apply([item(memory, ids)]));
  },
};

for (const entry of golden.P6) {
  test(`P6 / ${entry.name}`, () => scenarios[entry.name](fixture(), entry));
}

const catalogCases = {
  async 'empty group retained with a stale title and other namespaces excluded'(f, { orderInput }) {
    const [old] = orderInput;
    const source = await f.seed('Old source body.');
    await f.apply([item(source, [], topic(old.id))]);
    await f.erase(source);
    for (const target of [{ ...scope, owner: 'another' }, { ...scope, namespace: 'other' }, { ...scope, namespace: null }]) {
      await f.create('Foreign source body', 'Foreign topic', undefined, target);
    }
  },
  async '101 topics cap the catalog at 100'(f, { orderInput }) {
    for (const { title } of orderInput) await f.create(`Seed for ${title}`, title);
    await f.seed('Pending catalog limit probe');
  },
  async 'SQLite UTF-8 order for titles, nulls and ID ties'(f, { orderInput }) {
    const parent = orderInput.find(({ level }) => level === 'L2');
    const child = orderInput.find(({ level, title }) => level === 'L1' && title === null);
    for (const { id, level, title } of orderInput) {
      if (level === 'L2') continue;
      const memory = await f.seed(`Source for ${id}`);
      const newL2 = id === child.id ? 'Source-bound parent' : undefined;
      f.reserved.push(...(newL2 ? [parent.id, id] : [id]));
      await f.apply([item(memory, [], topic(title || `Source-bound title ${id}`, [], newL2))]);
      if (!title) await f.erase(memory);
    }
  },
};

for (const entry of golden.P7.filter(({ orderInput }) => orderInput)) {
  test(`P7 / ${entry.name}`, async () => {
    const f = fixture();
    await catalogCases[entry.name](f, entry);
    const { topics: expected, count, mapExhausted } = entry.value;
    const idsAreTitles = entry.classification || entry.orderInput.length === 1;
    const project = ({ id, level, title }) => ({ id: idsAreTitles ? f.topicNames.get(id) : id, level, title });
    const page = await f.catalog();
    assert.deepEqual({ topics: page.items.map(project), count: page.items.length, mapExhausted: page.exhausted }, {
      // Empty titles are synthetic engine rows. A stale title has the same ordering key.
      topics: expected.map((entry) => ({ ...entry, title: entry.title || null })), count, mapExhausted,
    });

    if (entry.classification) {
      const { speculativeCreation, reused, created } = entry.classification;
      const result = await f.batch(async ({ memories: [memory] }, { map, mapExhausted }, { validateFresh }) => {
        assert.equal(mapExhausted, page.exhausted);
        assert.deepEqual(map.map(({ moc }) => project(moc)), expected);
        assert.throws(() => checkProposalAgainstCatalog({ items: [item(memory.id, [], topic('Speculative title'))] },
          map, mapExhausted), { code: speculativeCreation });
        const proposal = { items: [item(memory.id, [map[0].moc.id])] };
        await validateFresh();
        return proposal;
      });
      assert.equal(result.status, 'applied');
      assert.equal(result.createdTopics.length, created);
      assert.deepEqual(result.placed[0].topicIds.map((id) => f.topicNames.get(id)), [reused]);
    }
  });
}

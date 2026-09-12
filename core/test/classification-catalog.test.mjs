import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createMockPlacementModel } from '../testing/mock-placement-model.mjs';

const namespace = { ownerId: 'catalog-test', scope: 'project', projectId: 'notes' };
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
function fixture(t, steps, options) {
  const model = createMockPlacementModel(steps, options);
  const core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-catalog-')), 'memory.sqlite'), model });
  t.after(() => core.close());
  return { core, model };
}
const receipt = (content) => ({ client: 'test', sessionId: 'session', eventId: content,
  role: 'user', excerpt: content });
const admit = (core, content, ns = namespace) => ok(core.admit({ namespace: ns,
  memory: { content, kind: 'fact' }, receipts: [receipt(content)] })).memory;
const map = (core, ns = namespace) => ok(core.map({ namespace: ns, purpose: 'classification' }));
const request = (core, memory) => ({ namespace, memoryIds: [memory.id],
  expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
  mapRevision: map(core).indexRevision });
const newTopic = ({ input }) => ({ items: input.memories.map((m) => ({ memoryId: m.id,
  parentIds: [], newL1: { title: 'Launch planning', parentL2Ids: [] } })) });
function place(core, memory, item, ns = namespace) {
  return ok(core.applyPlacement({ namespace: ns, proposal: { items: [{ memoryId: memory.id, ...item }] },
    expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
    expectedIndexRevision: map(core, ns).indexRevision }));
}

test('one or 101 unfiled memories allow a first topic without exposing unrelated bodies', async (t) => {
  for (const count of [1, 101]) {
    const { core, model } = fixture(t, [newTopic]);
    const target = admit(core, 'Launch review happens Thursday.');
    for (let i = 1; i < count; i++) admit(core, `Unrelated private body ${i}.`);
    const before = map(core);
    if (count === 101) assert.equal(before.exhausted, false);
    const classified = ok(await core.classifyPlacement(request(core, target)));
    assert.equal(classified.basedOn.mapExhausted, true);
    assert.deepEqual(model.calls[0].input.map, []);
    assert.deepEqual(model.calls[0].input.memories.map((m) => m.id), [target.id]);
    assert.equal(JSON.stringify(model.calls[0].input).includes('Unrelated private body'), false);
    assert.deepEqual(map(core), before, 'proposal generation is read-only and public map is unchanged');
    const applied = ok(core.applyPlacement({ namespace, proposal: classified.proposal,
      expectedMemoryRevisions: classified.basedOn.memoryRevisions,
      expectedIndexRevision: classified.basedOn.indexRevision }));
    assert.equal(applied.createdMocs.length, 1);
  }
});

test('many references do not hide the small catalog or prevent reuse and creation', async (t) => {
  const reuse = ({ input }) => ({ items: input.memories.map((m) => ({ memoryId: m.id,
    parentIds: [input.map.find((i) => i.moc.level === 'L1').moc.id] })) });
  const { core, model } = fixture(t, [reuse, newTopic]);
  const seed = admit(core, 'Service operation notes.');
  const created = place(core, seed, { parentIds: [], newL1: {
    title: 'Service operations', parentL2Ids: [], newL2Title: 'Engineering' } });
  const parent = created.createdMocs.find((m) => m.level === 'L1');
  for (let i = 0; i < 101; i++) {
    place(core, admit(core, `Unrelated operational body ${i}.`), { parentIds: [parent.id] });
  }
  const target = admit(core, 'Launch review happens Thursday.');
  const before = map(core);
  assert.equal(before.exhausted, false);
  const reused = ok(await core.classifyPlacement(request(core, target)));
  assert.deepEqual(reused.proposal.items[0].parentIds, [parent.id]);
  const classified = ok(await core.classifyPlacement(request(core, target)));
  assert.equal(classified.basedOn.mapExhausted, true);
  assert.deepEqual(model.calls[1].input.map.map((i) => i.moc.level), ['L1', 'L2']);
  assert.equal(JSON.stringify(model.calls[1].input).includes('Unrelated operational body'), false);
  assert.deepEqual(map(core), before);
});

test('catalog retains empty groups with null stale titles and excludes other namespaces', async (t) => {
  const { core, model } = fixture(t, [({ input }) => ({ items: input.memories.map((m) => ({
    memoryId: m.id, parentIds: [] })) })]);
  const seed = admit(core, 'Old source body.');
  const created = place(core, seed, { parentIds: [], newL1: { title: 'Old source topic', parentL2Ids: [] } });
  ok(core.forget({ namespace, memoryId: seed.id, expectedRevision: created.memories[0].revision }));
  for (const foreign of [
    { ...namespace, ownerId: 'other' },
    { ...namespace, projectId: 'other' },
    { ...namespace, scope: 'personal', projectId: null },
  ]) {
    const memory = admit(core, 'Foreign private body.', foreign);
    place(core, memory, { parentIds: [], newL1: { title: 'Foreign private topic', parentL2Ids: [] } }, foreign);
  }
  const target = admit(core, 'Current source body.');
  ok(await core.classifyPlacement(request(core, target)));
  const items = model.calls[0].input.map;
  assert.equal(items.length, 1);
  assert.equal(items[0].moc.id, created.createdMocs[0].id);
  assert.equal(items[0].moc.title, null);
  assert.equal(JSON.stringify(model.calls[0].input).includes('Foreign private'), false);
  assert.equal(JSON.stringify(model.calls[0].input).includes('Old source'), false);
});

test('catalog token truncation forbids creation and its cursors cannot continue public maps', async (t) => {
  let constrain = false;
  const cursors = new Set();
  const { core, model } = fixture(t, [newTopic, ({ input }) => ({ items: input.memories.map((m) => ({
    memoryId: m.id, parentIds: [input.map[0].moc.id] })) })], {
    // Synthetic counting isolates packing and cursor authority, not provider cost.
    countTokens(text) {
      const parsed = text ? JSON.parse(text) : null;
      if (constrain && parsed?.value?.items) {
        if (parsed.value.nextCursor) cursors.add(parsed.value.nextCursor);
        return parsed.value.items.length > 1 ? 4001 : 1;
      }
      return 1;
    },
  });
  for (let i = 0; i < 3; i++) place(core, admit(core, `Topic source ${i}.`), {
    parentIds: [], newL1: { title: `Topic ${i}`, parentL2Ids: [] } });
  const target = admit(core, 'Launch review happens Thursday.');
  const input = request(core, target);
  constrain = true;
  assert.equal((await core.classifyPlacement(input)).error.code, 'invalid_model_output');
  const classified = ok(await core.classifyPlacement(input));
  assert.equal(classified.basedOn.mapExhausted, false);
  assert.equal(model.calls[1].input.map.length, 1);
  const catalogCursors = [...cursors].filter((cursor) =>
    JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url')).o === 'classification_catalog');
  assert.ok(catalogCursors.length > 0);
  for (const cursor of catalogCursors) assert.equal(core.map({ namespace,
    purpose: 'classification', cursor }).error.code, 'invalid_cursor');
  assert.equal(core.map({ namespace, catalogOnly: true }).error.code, 'invalid_input');
});

test('a foreign or wrong-level parent invalidates the full selected batch without writes', async (t) => {
  for (const kind of ['foreign', 'wrong-level']) {
    let invalidParent;
    const { core, model } = fixture(t, [({ input }) => ({ items: input.memories.map((m, i) => ({
      memoryId: m.id, parentIds: i === 0 ? [] : [invalidParent],
    })) })]);
    const foreign = { ...namespace, ownerId: 'other' };
    const ns = kind === 'foreign' ? foreign : namespace;
    const created = place(core, admit(core, 'Group source.', ns), { parentIds: [],
      newL1: { title: 'Source topic', parentL2Ids: [], newL2Title: 'Source domain' } }, ns);
    invalidParent = created.createdMocs.find((m) => m.level === (kind === 'foreign' ? 'L1' : 'L2')).id;
    const targets = [admit(core, 'First target.'), admit(core, 'Second target.')];
    const before = map(core);
    const result = await core.classifyPlacement({ namespace, memoryIds: targets.map((m) => m.id),
      expectedMemoryRevisions: targets.map((m) => ({ memoryId: m.id, revision: m.revision })),
      mapRevision: before.indexRevision });
    assert.equal(result.error.code, 'invalid_model_output');
    assert.deepEqual(map(core), before);
    if (kind === 'foreign') assert.deepEqual(model.calls[0].input.map, []);
    for (const memory of targets) assert.deepEqual(ok(core.get({ namespace, memoryId: memory.id })).placements, []);
  }
});

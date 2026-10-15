import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { classify } from '../classification.mjs';
import { placementProposal, uniqueIds } from '../placement-input.mjs';
import { emitDiagnostic } from '../model-diagnostics.mjs';
import { openMemoryCore } from '../contract.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const canary = 'SYNTHETIC_PRIVATE_CLASSIFICATION_CANARY';
const ids = ['synthetic-memory-id-a', 'synthetic-memory-id-b'];
const item = (memoryId = ids[0]) => ({ memoryId, parentIds: [] });
const topic = (title = 'Synthetic leaf') => ({ ...item(), newL1: { title, parentL2Ids: [] } });
const proposal = (first = item()) => ({ items: [first, item(ids[1])] });
const diagnostic = reason => ({ version: 1, stage: 'classify', layer: 'core_validation', reason });
const groups = ['L1', 'L1', 'L2', 'L2'].map((level, index) => ({ type: 'moc',
  moc: { id: `synthetic-topic-id-${index}`, level, title: 'Synthetic visible topic' } }));

function compensatedParents(parentId) {
  const parents = [parentId];
  parents.length = 2;
  parents[canary] = `${canary}:${ids[0]}`;
  assert.equal(Object.keys(parents).length, parents.length);
  assert.equal(Object.hasOwn(parents, 1), false);
  return parents;
}

function compensatedProposal(role) {
  return role === 'L1' ? proposal({ ...item(), parentIds: compensatedParents(groups[0].moc.id) }) :
    proposal({ ...topic(), newL1: { title: 'Synthetic leaf', parentL2Ids: compensatedParents(groups[2].moc.id) } });
}

async function run(output, { exhausted = true, onDiagnostic, callback } = {}) {
  const events = [], calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    classify: () => { calls.push('classify'); return callback ? callback() : output; },
    onDiagnostic: event => { events.push(event); return onDiagnostic?.(event); } };
  try {
    const value = await classify({ model, snapshot: { memories: ids.map(id => ({ id, revision: 1, content: canary })),
      indexRevision: 1 }, map: { items: groups, exhausted }, validateFresh: () => {} });
    return { value, events, calls };
  } catch (error) { return { error, events, calls }; }
}

async function rejection(output, reason, options) {
  const result = await run(output, options);
  assert.equal(result.error?.code, 'invalid_model_output');
  assert.deepEqual(result.calls, ['classify']);
  assert.deepEqual(result.events, [diagnostic(reason)]);
  assert.equal(Object.isFrozen(result.events[0]), true);
  for (const value of [canary, ...ids, ...groups.map(group => group.moc.id)]) {
    assert.equal(JSON.stringify(result.events).includes(value), false);
  }
}

test('CR2/CR3: deterministic rejecting seams emit exactly one finite classification category', async () => {
  for (const [output, reason, options] of [
    [{ items: [item(), item()] }, 'classification_duplicate_targets'],
    [proposal({ ...item(), parentIds: ['synthetic-topic-id-0', 'synthetic-topic-id-0'] }), 'classification_duplicate_l1_parents'],
    [proposal({ ...topic(), newL1: { title: 'Synthetic leaf', parentL2Ids: ['synthetic-topic-id-2', 'synthetic-topic-id-2'] } }),
      'classification_duplicate_l2_parents'],
    [{ items: [] }, 'classification_target_mismatch'],
    [{ items: Array.from({ length: 6 }, (_, index) => item(`synthetic-extra-target-${index}`)) }, 'classification_target_mismatch'],
    [{ items: [item()] }, 'classification_target_mismatch'],
    [{ items: [item(), item('synthetic-foreign-memory-id')] }, 'classification_target_mismatch'],
    [proposal({ ...item(), parentIds: ['synthetic-foreign-topic-id'] }), 'classification_parent_visibility'],
    [proposal({ ...item(), parentIds: ['synthetic-topic-id-2'] }), 'classification_parent_visibility'],
    [proposal({ ...topic(), newL1: { title: 'Synthetic leaf', parentL2Ids: ['synthetic-topic-id-0'] } }),
      'classification_parent_visibility'],
    [proposal({ ...topic(), newL1: { title: 'Synthetic leaf', parentL2Ids: ['synthetic-foreign-topic-id'] } }),
      'classification_parent_visibility'],
    [proposal(topic()), 'classification_create_policy', { exhausted: false }],
    [{ items: [item(), item(ids[1])], extra: canary }, 'invalid_classification'],
    [proposal({ ...item(), memoryId: '\0' }), 'invalid_classification'],
  ]) await rejection(output, reason, options);
});

test('CR3: both title roles retain normalization, codepoint and UTF-16 rejection boundaries', async () => {
  for (const invalid of ['x'.repeat(121), '😀'.repeat(121), '😀'.repeat(120) + 'x',
    'ﬃ'.repeat(41), 'Ａ'.repeat(121), ' ', '[REDACTED]', `topic\0${canary}`, null, 1, 'x'.repeat(20_001)]) {
    for (const role of ['l1', 'l2']) {
      const first = topic();
      if (role === 'l1') first.newL1.title = invalid;
      else first.newL1.newL2Title = invalid;
      await rejection(proposal(first), `classification_${role}_title`);
    }
  }
  for (const [title, expected] of [['x'.repeat(120), 'x'.repeat(120)], ['😀'.repeat(120), '😀'.repeat(120)],
    ['  Ａ\n B  ', 'A B']]) {
    const first = topic(title); first.newL1.newL2Title = title;
    const result = await run(proposal(first));
    assert.equal(result.error, undefined);
    assert.equal(result.value.proposal.items[0].newL1.title, expected);
    assert.equal(result.value.proposal.items[0].newL1.newL2Title, expected);
    assert.deepEqual(result.events, []);
  }
});

test('CR1/CR3: direct placement consumers keep original rejection codes with absent or hostile observers', async () => {
  for (const observer of [undefined, () => { throw new Error(canary); }, () => Promise.reject(new Error(canary))]) {
    for (const [output, code] of [
      [{ items: [item(), item()] }, 'invalid_input'],
      [proposal({ ...item(), parentIds: ['synthetic-topic-id-0', 'synthetic-topic-id-0'] }), 'invalid_input'],
      [proposal({ ...topic(), newL1: { title: 'Synthetic leaf', parentL2Ids: ['synthetic-topic-id-2', 'synthetic-topic-id-2'] } }), 'invalid_input'],
      [proposal(topic('x'.repeat(121))), 'invalid_input'],
      [proposal(topic('😀'.repeat(121))), 'invalid_text'],
      [proposal(topic(' ')), 'invalid_text'],
      [proposal({ ...item(), memoryId: '\0' }), 'invalid_identifier'],
      [{ items: [item()] }, 'invalid_input'],
    ]) assert.throws(() => placementProposal(output, ids, observer), error => error.code === code);
  }
  await setImmediate();
});

test('CR5: sparse, malformed and hostile getters fail closed without copying error fields', async () => {
  const sparseItems = [item(), item(ids[1])]; delete sparseItems[1];
  const sparseParents = Array(2); sparseParents[1] = 'synthetic-topic-id-0';
  const hostileTitle = { parentL2Ids: [] };
  Object.defineProperty(hostileTitle, 'title', { get() {
    throw Object.assign(new Error(canary), { reason: 'classification_duplicate_targets', memoryId: ids[0], code: canary });
  } }); // Non-enumerable: the bounded serialization check precedes this getter.
  for (const output of [null, { items: sparseItems }, proposal({ ...item(), parentIds: sparseParents }),
    proposal({ ...item(), newL1: hostileTitle }), proposal({ ...item(), parentIds: [null] }),
    proposal({ ...item(), newL1: [] })]) {
    assert.throws(() => placementProposal(output, ids));
    await rejection(output, 'invalid_classification');
  }
  const result = await run(null, { callback: () => { throw Object.assign(new Error(canary), {
    reason: 'classification_l1_title', stage: canary, memoryId: ids[0], code: canary }); } });
  assert.equal(result.error.code, 'classification_failed');
  assert.deepEqual(result.events, [{ version: 1, stage: 'classify', layer: 'core_call', reason: 'provider_failure' }]);
  const events = [];
  emitDiagnostic({ onDiagnostic: event => events.push(event) }, 'classify', 'core_validation', canary);
  assert.deepEqual(events, []);
});

test('CR5 review: compensated sparse parents keep direct placement invalid_input', async t => {
  for (const role of ['L1', 'L2']) await t.test(role, async () => {
    for (const observer of [undefined, () => { throw new Error(canary); }, () => Promise.reject(new Error(canary))]) {
      assert.throws(() => placementProposal(compensatedProposal(role), ids, observer), error => error.code === 'invalid_input');
      assert.throws(() => uniqueIds(compensatedParents(ids[0]), 5, 1, observer), error => error.code === 'invalid_input');
    }
    await setImmediate();
  });
});

test('CR5 review: compensated sparse parents reach actual classify and emit only generic rejection', async t => {
  for (const role of ['L1', 'L2']) await t.test(role, async () => {
    for (const onDiagnostic of [undefined, () => { throw new Error(`${canary}:${ids[0]}`); },
      () => Promise.reject(new Error(`${canary}:${ids[0]}`))]) {
      await rejection(compensatedProposal(role), 'invalid_classification', { onDiagnostic });
    }
    await setImmediate();
  });
});

test('CR5 review: classifyPlacement rejects compensated sparse parents without writes or retry', async t => {
  const namespace = { ownerId: 'synthetic-sparse-parent-owner', scope: 'personal', projectId: null };
  for (const role of ['L1', 'L2']) await t.test(role, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'classification-sparse-parent-' });
    const path = join(workspace.path, 'store.sqlite'), events = [], calls = [];
    const model = { contextWindow: 8192, countTokens: () => 1,
      onDiagnostic: event => {
        events.push(event);
        const error = new Error(`${canary}:${ids[0]}`);
        if (role === 'L1') throw error;
        return Promise.reject(error);
      },
      classify: ({ input }) => {
        calls.push('classify');
        const visible = input.map.find(entry => entry.type === 'moc' && entry.moc.level === role);
        assert.ok(visible, 'the valid indexed parent is visible to the actual classifier');
        const parents = compensatedParents(visible.moc.id), memoryId = input.memories[0].id;
        return { items: [role === 'L1' ? { memoryId, parentIds: parents } :
          { memoryId, parentIds: [], newL1: { title: 'Synthetic new leaf', parentL2Ids: parents } }] };
      } };
    const core = openMemoryCore({ path, model });
    workspace.defer(() => core.close());
    const admitted = core.admit({ namespace, memory: { content: 'Synthetic topic seed', kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic-session', eventId: 'synthetic-seed',
        role: 'user', excerpt: 'Synthetic topic seed' }] });
    assert.equal(admitted.ok, true);
    const seed = admitted.value.memory;
    const seeded = core.applyPlacement({ namespace,
      proposal: { items: [{ memoryId: seed.id, parentIds: [], newL1: {
        title: 'Synthetic seed leaf', parentL2Ids: [], newL2Title: 'Synthetic seed root' } }] },
      expectedMemoryRevisions: [{ memoryId: seed.id, revision: seed.revision }],
      expectedIndexRevision: core.map({ namespace, purpose: 'classification' }).value.indexRevision });
    assert.equal(seeded.ok, true);
    const target = core.admit({ namespace, memory: { content: canary, kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic-session', eventId: 'synthetic-target',
        role: 'user', excerpt: canary }] });
    assert.equal(target.ok, true);
    const memory = target.value.memory;
    const before = core.get({ namespace, memoryId: memory.id });
    const mapped = core.map({ namespace, purpose: 'classification' });
    assert.equal(before.ok, true); assert.equal(mapped.ok, true);
    const result = await core.classifyPlacement({ namespace, memoryIds: [memory.id],
      expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
      mapRevision: mapped.value.indexRevision });
    assert.equal(result.ok, false);
    assert.deepEqual(result.error, { code: 'invalid_model_output', retryable: false });
    assert.deepEqual(calls, ['classify']);
    assert.deepEqual(events, [diagnostic('invalid_classification')]);
    assert.equal(Object.isFrozen(events[0]), true);
    for (const value of [canary, ...ids, memory.id, seed.id, ...seeded.value.createdMocs.map(moc => moc.id)]) {
      assert.equal(JSON.stringify(events).includes(value), false);
    }
    assert.deepEqual(core.get({ namespace, memoryId: memory.id }), before);
    assert.deepEqual(core.map({ namespace, purpose: 'classification' }), mapped);
    const cold = openMemoryCore({ path });
    workspace.defer(() => cold.close());
    assert.deepEqual(cold.get({ namespace, memoryId: memory.id }), before);
    await setImmediate();
  });
});

test('CR2: unexpected internal title error retains the generic fallback', async t => {
  const normalization = t.mock.method(String.prototype, 'normalize', () => {
    throw Object.assign(new Error(canary), { reason: 'classification_l1_title', memoryId: ids[0], code: canary });
  });
  try { await rejection(proposal(topic()), 'invalid_classification'); }
  finally { normalization.mock.restore(); }
});

test('CR1/CR5: observer throws, rejects or attempts event mutation do not change capture or retry', async t => {
  const namespace = { ownerId: 'synthetic-observer-owner', scope: 'personal', projectId: null };
  for (const onDiagnostic of [undefined, () => { throw new Error(canary); }, () => Promise.reject(new Error(canary)),
    event => { event.reason = canary; }]) {
    const workspace = createTestWorkspace(t, { prefix: 'classification-observer-' });
    const calls = [];
    const model = { contextWindow: 8192, countTokens: () => 1, onDiagnostic,
      extract: () => { calls.push('extract'); return { items: [{ content: canary, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }; },
      classify: ({ input }) => { calls.push('classify'); return { items: [topic('x'.repeat(121))].map(first => ({ ...first,
        memoryId: input.memories[0].id })) }; } };
    const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), model });
    workspace.defer(() => core.close());
    const batch = { namespace, client: 'synthetic', sessionId: 'synthetic-session', eventId: 'synthetic-event',
      messages: [{ id: 'synthetic-message', role: 'user', content: canary }] };
    const result = await core.capture(batch);
    assert.equal(result.ok, true);
    assert.deepEqual(result.value.classification, { status: 'failed', error: { code: 'invalid_model_output', retryable: false } });
    assert.equal(result.value.admission.memories.length, 1);
    const stored = core.get({ namespace, memoryId: result.value.admission.memories[0].id });
    assert.equal(stored.ok, true);
    assert.equal(stored.value.memory.filing.status, 'unfiled');
    assert.equal(stored.value.receipts.length, 1);
    assert.equal((await core.capture(batch)).value.duplicate, true);
    assert.deepEqual(calls, ['extract', 'classify']);
    await setImmediate();
  }
});

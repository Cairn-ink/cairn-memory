import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifyPlacement, CoreError, placePending } from '../src/index.mjs';

const scope = { owner: 'owner', namespace: 'notes' };
const memory = { id: 'memory-a', revision: 7, kind: 'fact', content: 'Sequence diagrams explain handshakes.' };
const snapshot = { memories: [memory], indexRevision: 13 };
const catalog = { map: [{ type: 'moc', moc: { id: 'topic-a', level: 'L1', title: 'Protocol diagrams' } }],
  mapExhausted: true };
const wireItem = { memoryId: 'm0', parentIds: ['c0'] };
const output = { items: [wireItem] };
const modelWith = (call) => ({ model: 'scripted', contextWindow: 8192, countTokens: () => 1, call });
const event = (layer, reason) => ({ version: 1, stage: 'classify', layer, reason });

function classify(options) {
  return classifyPlacement({ snapshot, catalog, async validateFresh() {}, ...options });
}

test('rejects extra fields in structured output and emits output_shape', async () => {
  const diagnostics = [];
  const model = modelWith(async () => ({ items: [{ ...wireItem, confidence: 1 }] }));
  await assert.rejects(classify({ model, onDiagnostic: (value) => diagnostics.push(value) }),
    { code: 'invalid_model_output' });
  assert.deepEqual(diagnostics, [event('adapter', 'output_shape'), event('core_call', 'adapter_output_invalid')]);
});

test('rejects a forged memory alias', async () => {
  const model = modelWith(async () => ({ items: [{ ...wireItem, memoryId: 'm1' }] }));
  await assert.rejects(classify({ model }), { code: 'invalid_model_output' });
});

test('rejects an alias for a topic omitted by packing', async () => {
  const map = Array.from({ length: 80 }, (_, index) => ({
    type: 'moc', moc: { id: 'topic-' + index, level: 'L1', title: String(index) + 'y'.repeat(110) },
  }));
  const omittedAlias = 'c' + (map.length - 1).toString(36);
  const calls = [];
  const model = {
    ...modelWith(async (_stage, { input }) => {
      calls.push(input);
      return { items: [{ ...wireItem, parentIds: [omittedAlias] }] };
    }),
    countTokens: (text) => [...text].length,
  };
  await assert.rejects(classify({ model, catalog: { map, mapExhausted: true } }), { code: 'invalid_model_output' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].mapExhausted, false);
  assert.ok(calls[0].map.length > 0 && calls[0].map.length < map.length);
  assert.ok(!calls[0].map.some(({ moc }) => moc.id === omittedAlias));
});

test('schema-valid output still needs core proposal validation', async () => {
  const diagnostics = [];
  const model = modelWith(async () => ({ items: [{ ...wireItem, newL1: { title: ' ', parentL2Ids: [] } }] }));
  await assert.rejects(classify({ model, onDiagnostic: (value) => diagnostics.push(value) }),
    { code: 'invalid_model_output' });
  assert.deepEqual(diagnostics, [event('core_validation', 'invalid_classification')]);
});

test('missing model methods emit the engine diagnostic before reading freshness', async () => {
  for (const model of [undefined, { countTokens: () => { assert.fail('must not pack'); } }]) {
    const diagnostics = [];
    await assert.rejects(classify({ model, async validateFresh() { assert.fail('must not read'); },
      onDiagnostic: (value) => diagnostics.push(value) }), { code: 'model_not_configured' });
    assert.deepEqual(diagnostics, [event('core_call', 'model_not_configured')]);
  }
});

for (const phase of ['before', 'after']) {
  test(`freshness failure ${phase} the provider call records failure without applying`, async () => {
    const operations = [];
    let activeTx;
    let modelCalled = false;
    const model = modelWith(async () => {
      assert.equal(activeTx, undefined);
      operations.push('call');
      modelCalled = true;
      return output;
    });
    const uow = {
      async run(owner, { readOnly = false }, body) {
        assert.equal(owner, scope.owner);
        assert.equal(activeTx, undefined);
        activeTx = { readOnly };
        try { return await body(activeTx); }
        finally { activeTx = undefined; }
      },
    };
    const memories = {
      async get() { return { ...memory, text: memory.content }; },
      async readRevision(tx) {
        assert.equal(tx, activeTx);
        assert.equal(tx.readOnly, true);
        operations.push('fresh');
        return { revision: phase === 'before' || modelCalled ? memory.revision + 1 : memory.revision };
      },
    };
    const placement = {
      async pending() { return [{ memoryId: memory.id, revision: memory.revision }]; },
      async catalog() {
        return { items: catalog.map.map(({ moc }) => moc), exhausted: true, indexRevision: snapshot.indexRevision };
      },
      async applyPlacement() { assert.fail('must not apply'); },
      async markFailed(tx, actualScope, ids, code) {
        assert.equal(tx, activeTx);
        assert.equal(tx.readOnly, false);
        assert.deepEqual([actualScope, ids, code], [scope, [memory.id], 'revision_conflict']);
        operations.push('failure');
      },
    };
    const gate = { async assertOpen() {} };
    assert.deepEqual(await placePending({ scope, uow, memories, placement, model, gate }), {
      status: 'failed', error: { code: 'revision_conflict', retryable: false },
    });
    assert.deepEqual(operations, phase === 'before' ? ['fresh', 'failure'] : ['fresh', 'call', 'fresh', 'failure']);
  });
}

test('gate closing at dispatch prevents the provider call', async () => {
  const phases = [];
  let calls = 0;
  const model = modelWith(async () => { calls++; return output; });
  const gate = {
    async assertOpen(owner, phase) {
      phases.push([owner, phase]);
      if (phase === 'dispatch') throw new CoreError('capture_paused');
    },
  };
  await assert.rejects(classify({ model, gate, owner: scope.owner }), { code: 'capture_paused' });
  assert.deepEqual(phases, [[scope.owner, 'pre-send'], [scope.owner, 'dispatch']]);
  assert.equal(calls, 0);
});

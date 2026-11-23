import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CoreError, placePendingBatch, relatePlaced } from '../src/index.mjs';
import { modelReturning, rationaleFixture } from './fixtures/rationale/store.mjs';

const oneEdge = { edges: [{ from: 0, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] };
const basic = () => rationaleFixture([{ id: 'root', excerpt: 'The chosen approach.' }]);

for (const closedPhase of ['pre-send', 'dispatch']) {
  test('the gate stops the provider request at ' + closedPhase, async () => {
    const f = basic();
    const phases = [];
    let sends = 0;
    const result = await relatePlaced({ ...f, refs: [f.guard('root')], model: modelReturning(() => { sends++; return oneEdge; }),
      gate: { async assertOpen(_owner, phase) {
        phases.push(phase);
        if (phase === closedPhase) throw new CoreError('capture_paused');
      } } });
    assert.deepEqual(phases, closedPhase === 'pre-send' ? ['pre-send'] : ['pre-send', 'dispatch']);
    assert.equal(sends, 0);
    assert.equal(result.error.code, 'capture_paused');
    assert.equal(f.writes, 0);
  });
}

for (const phase of ['before dispatch', 'after output', 'in write tx']) {
  test('whole snapshot freshness blocks a change ' + phase, async () => {
    const f = rationaleFixture([{ id: 'root', excerpt: 'The chosen approach.' }, { id: 'second', excerpt: 'Another source.' }]);
    let sends = 0;
    const mutate = () => { f.state.sources.get('second').receipts[0].excerpt = 'Uncited source changed.'; };
    if (phase === 'before dispatch') f.options.beforeRead = number => { if (number === 2) mutate(); };
    if (phase === 'in write tx') f.options.beforeWrite = mutate;
    const model = modelReturning(() => {
      sends++;
      if (phase === 'after output') mutate();
      return oneEdge;
    });
    const result = await relatePlaced({ ...f, refs: [f.guard('root'), f.guard('second')], model });
    assert.equal(result.status, 'failed');
    assert.equal(result.error.code, 'revision_conflict');
    assert.equal(sends, phase === 'after output' || phase === 'in write tx' ? 1 : 0);
    assert.equal(f.state.edges.size, 0);
    assert.equal(f.state.epoch, 0);
  });
}

test('an unrelated owner index advance after output prevents the write', async () => {
  const f = basic();
  const result = await relatePlaced({ ...f, refs: [f.guard('root')], model: modelReturning(() => {
    f.state.epoch++;
    return oneEdge;
  }) });
  assert.equal(result.error.code, 'revision_conflict');
  assert.equal(f.writes, 0);
});

test('a complete snapshot over 24,000 units is refused ahead of any model work', async () => {
  const f = rationaleFixture([{ id: 'root', excerpts: Array(30).fill('x'.repeat(800)) }]);
  let calls = 0;
  const model = { ...modelReturning(() => { calls++; return oneEdge; }), countTokens() { calls++; return 1; } };
  const result = await relatePlaced({ ...f, refs: [f.guard('root')], model });
  assert.equal(result.error.code, 'context_item_too_large');
  assert.equal(calls, 0);
  assert.equal(f.writes, 0);
});

test('discovery uses the full source prefix, trims a split surrogate, and fills after admitted refs in lexical order', async () => {
  const f = rationaleFixture([{ id: 'root', excerpt: 'a'.repeat(3999) + '😀 trailing' },
    ...Array.from({ length: 8 }, (_, i) => ({ id: 'm' + i, excerpt: 'source ' + i }))]);
  const row = (id, namespace = null, type = 'memory') => ({ ref: { type, id, namespace } });
  f.options.candidates = (_tx, readScope, query) => {
    assert.deepEqual(readScope, { owner: f.scope.owner, namespaces: [null] });
    assert.equal(query, 'a'.repeat(3999));
    return [row('m4'), row('m0'), row('root'), row('m5', 'foreign'), row('raw', null, 'raw'),
      row('m4'), row('m3'), row('m2'), row('m1'), row('m6')];
  };
  const result = await relatePlaced({ ...f, refs: [f.guard('root')],
    model: modelReturning((stage, request) => {
      assert.equal(stage, 'rationale');
      assert.deepEqual(request.input.memories.map(m => m.receipts[0].excerpt),
        ['a'.repeat(800), 'source 4', 'source 0', 'source 3', 'source 2', 'source 1']);
      return oneEdge;
    }) });
  assert.equal(result.status, 'reviewed');
  assert.deepEqual(result.discovery, { candidateCount: 6, scanExhausted: true, candidatesTruncated: true,
    queryTruncated: true, semanticCoverage: 'unassessed' });
});

test('a failed single attempt leaves a committed placement untouched', async () => {
  const f = basic();
  const guard = f.guard('root');
  let disposition;
  const placement = {
    async pending() { return [guard]; },
    async catalog() { return { items: [], exhausted: true, indexRevision: 0 }; },
    async applyPlacement(_tx, _scope, basedOn, proposal) {
      assert.deepEqual(basedOn.memoryRevisions, [guard]);
      disposition = { placed: proposal.items, createdTopics: [] };
      return disposition;
    },
  };
  const applied = await placePendingBatch({ ...f, placement,
    memories: { async get() { return { id: 'root', revision: 1, kind: 'fact', text: 'The chosen approach.' }; } },
    async classify() { return { items: [{ memoryId: 'root', parentIds: [] }] }; },
  });
  assert.equal(applied.status, 'applied');
  const before = structuredClone(disposition);
  let sends = 0;
  const result = await relatePlaced({ ...f, refs: [guard], model: modelReturning(() => {
    sends++;
    throw Error('fixture provider failure');
  }) });
  assert.equal(result.status, 'failed');
  assert.equal(result.error.code, 'rationale_failed');
  assert.equal(sends, 1);
  assert.deepEqual(disposition, before);
  assert.equal(f.state.edges.size, 0);
});

test('disabled and empty passes skip, and malformed batches fail with no send', async () => {
  const f = basic();
  assert.equal((await relatePlaced({ ...f, store: undefined, refs: [f.guard('root')] })).status, 'skipped');
  assert.equal((await relatePlaced({ ...f, refs: [] })).status, 'skipped');
  for (const refs of [[f.guard('root'), f.guard('root')], Array(6).fill(f.guard('root'))]) {
    assert.equal((await relatePlaced({ ...f, refs })).error.code, 'invalid_input');
  }
});

test('a thrown port error with an unreadable code stays within the failure report', async () => {
  const f = basic();
  f.options.candidates = () => {
    throw new Proxy(new CoreError('storage_busy'), {
      get() { throw new Error('Unreadable port error'); },
    });
  };
  const result = await relatePlaced({ ...f, refs: [f.guard('root')], model: modelReturning(oneEdge) });
  assert.deepEqual(result, { status: 'failed', proposed: 0, inserted: 0, error: { code: 'rationale_failed', retryable: false } });
  assert.equal(f.writes, 0);
});

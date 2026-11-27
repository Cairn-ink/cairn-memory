import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CoreError, placePending, placePendingBatch } from '../src/index.mjs';

const scope = { owner: 'owner', namespace: 'notes' };
const a = { id: 'a', revision: 7, kind: 'fact', text: 'First note' };
const b = { id: 'b', revision: 3, kind: 'instruction', text: 'Second note' };
const guards = [a, b].map(({ id, revision }) => ({ memoryId: id, revision }));
const topic = (id) => ({ id, level: 'L1', title: id, parentIds: [] });
const abstain = ({ memories }) => ({ items: memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) });

function fixture({ rows = [a, b], pending = guards, topics = [topic('existing')], pageSize = 100, classify } = {}) {
  const stored = new Map(rows.map((memory) => [memory.id, memory]));
  let indexRevision = 13;
  let active = null;
  let receiptWriteExpected = false;
  const calls = [];
  const runModes = [];
  const catalogRequests = [];

  function check(tx, actualScope, readOnly) {
    assert.equal(tx, active);
    assert.notEqual(tx, null);
    assert.equal(actualScope, scope);
    assert.equal(tx.readOnly, readOnly);
  }
  const options = {
    scope,
    uow: {
      async run(owner, { readOnly = false }, fn) {
        assert.equal(owner, scope.owner);
        assert.equal(active, null);
        runModes.push(readOnly ? 'read' : 'write');
        const receiptWrite = !readOnly && receiptWriteExpected;
        receiptWriteExpected = false;
        active = { owner, readOnly, receiptWrite };
        try { return await fn(active); }
        finally { active = null; }
      },
    },
    placement: {
      async pending(tx, scope, query) {
        check(tx, scope, true);
        assert.deepEqual(query, { limit: 5 });
        return pending.filter(({ memoryId }) => !calls.some((call) =>
          call.method === 'markFailed' && call.memoryIds.includes(memoryId))).slice(0, query.limit);
      },
      async catalog(tx, scope, query) {
        check(tx, scope, !tx.receiptWrite);
        if (tx.receiptWrite) assert.deepEqual(query, { cursor: null, limit: 1 });
        catalogRequests.push(query);
        const start = Number(query.cursor ?? 0);
        const items = topics.slice(start, start + Math.min(query.limit, pageSize));
        const offset = start + items.length;
        const exhausted = offset === topics.length;
        return { items, exhausted, nextCursor: exhausted ? null : String(offset), indexRevision };
      },
      async applyPlacement(tx, scope, basedOn, proposal) {
        check(tx, scope, false);
        calls.push({ method: 'apply', basedOn, proposal });
        if (basedOn.indexRevision !== indexRevision || basedOn.memoryRevisions.some(
          ({ memoryId, revision }) => stored.get(memoryId)?.revision !== revision,
        )) {
          receiptWriteExpected = true;
          throw new CoreError('revision_conflict');
        }
        return { placed: proposal.items.map(({ memoryId, parentIds: topicIds }) => ({ memoryId, topicIds })), createdTopics: [] };
      },
      async markFailed(tx, scope, memoryIds, code) {
        check(tx, scope, false);
        assert.equal(tx.receiptWrite, true);
        calls.push({ method: 'markFailed', memoryIds, code });
      },
    },
    memories: {
      async get(tx, scope, id) {
        check(tx, scope, true);
        return stored.get(id) ?? null;
      },
      async readRevision(tx, scope, id) {
        check(tx, scope, !tx.receiptWrite);
        const memory = stored.get(id);
        return memory ? { revision: memory.revision, textHash: 'unused' } : null;
      },
    },
    async classify(snapshot, catalog, hooks) {
      assert.equal(active, null);
      calls.push({ method: 'classify', snapshot, catalog });
      try { return await classify(snapshot, catalog, hooks); }
      catch (error) {
        receiptWriteExpected = true;
        throw error;
      }
    },
  };
  return {
    run: () => placePendingBatch(options), calls, runModes, catalogRequests,
    runWithModel: (modelOptions) => placePending({ ...options, ...modelOptions }),
    forget(id) { stored.delete(id); indexRevision++; },
    changeIndex() { indexRevision++; },
    changeMemory(id) { stored.set(id, { ...stored.get(id), revision: stored.get(id).revision + 1 }); },
  };
}

for (const [name, gateOptions] of [['omitted', {}], ['missing assertOpen', { gate: {} }]]) {
  test(`placePending rejects a gate that is ${name} before reading or calling the model`, async () => {
    const f = fixture({ topics: [] });
    let modelCalls = 0;
    const model = {
      model: 'scripted', contextWindow: 8192, countTokens: () => 1,
      async call() {
        modelCalls++;
        return { items: ['m0', 'm1'].map((memoryId) => ({ memoryId, parentIds: [] })) };
      },
    };
    await assert.rejects(f.runWithModel({ model, ...gateOptions }), { code: 'invalid_input' });
    assert.deepEqual(f.runModes, []);
    assert.equal(modelCalls, 0);
  });
}

test('idle skips catalog and classification', async () => {
  const f = fixture({ pending: [] });
  assert.deepEqual(await f.run(), { status: 'idle' });
  assert.deepEqual(f.runModes, ['read']);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.catalogRequests, []);
});

test('applied uses the projected snapshot and its original guards outside the read run', async () => {
  const proposal = { items: [{ memoryId: a.id, parentIds: ['existing'] }, { memoryId: b.id, parentIds: [] }] };
  const f = fixture({ classify: async (_snapshot, _catalog, { validateFresh }) => {
    await validateFresh();
    return proposal;
  } });
  assert.deepEqual(await f.run(), {
    status: 'applied', placed: [{ memoryId: a.id, topicIds: ['existing'] }, { memoryId: b.id, topicIds: [] }], createdTopics: [],
  });
  assert.deepEqual(f.calls, [
    { method: 'classify', snapshot: { memories: [a, b].map(({ id, revision, kind, text: content }) => ({ id, revision, kind, content })) },
      catalog: { map: [{ type: 'moc', moc: { id: 'existing', level: 'L1', title: 'existing' } }], mapExhausted: true } },
    { method: 'apply', basedOn: { memoryRevisions: guards, indexRevision: 13 }, proposal },
  ]);
  assert.deepEqual(f.runModes, ['read', 'read', 'write']);
});

test('missing and changed pending entries are excluded before classification', async () => {
  const missing = { memoryId: 'gone', revision: 1 };
  const f = fixture({ rows: [{ ...a, revision: a.revision + 1 }, b], pending: [missing, ...guards], classify: abstain });
  assert.deepEqual(await f.run(), { status: 'applied', placed: [{ memoryId: b.id, topicIds: [] }], createdTopics: [] });
  assert.deepEqual(f.calls[1].basedOn.memoryRevisions, [guards[1]]);
  const empty = fixture({ rows: [], pending: [missing, ...guards] });
  assert.deepEqual(await empty.run(), { status: 'idle' });
  assert.deepEqual(empty.calls, []);
});

test('a provider_error on the oldest five pending memories lets the sixth run next', async () => {
  const rows = Array.from({ length: 6 }, (_, i) => ({ ...a, id: `memory-${i + 1}` }));
  const pending = rows.map(({ id, revision }) => ({ memoryId: id, revision }));
  let batches = 0;
  const f = fixture({ rows, pending, classify(snapshot) {
    if (++batches === 1) throw new CoreError('provider_error');
    return abstain(snapshot);
  } });
  assert.deepEqual(await f.run(), { status: 'failed', error: { code: 'provider_error', retryable: true } });
  assert.deepEqual(await f.run(), {
    status: 'applied', placed: [{ memoryId: rows[5].id, topicIds: [] }], createdTopics: [],
  });
  assert.deepEqual(f.calls[1], {
    method: 'markFailed', memoryIds: rows.slice(0, 5).map(({ id }) => id), code: 'provider_error',
  });
});

test('CoreError reports retryability and writes a fresh failure receipt unless paused', async () => {
  for (const [code, retryable, recorded] of [
    ['storage_busy', true, true], ['provider_error', true, true],
    ['capture_evidence_closed', false, false], ['memory_conflict', false, true], ['invalid_model_output', false, true],
  ]) {
    const f = fixture({ classify: () => { throw new CoreError(code); } });
    assert.deepEqual(await f.run(), { status: 'failed', error: { code, retryable } });
    assert.deepEqual(f.calls.slice(1), recorded ? [{ method: 'markFailed', memoryIds: [a.id, b.id], code }] : [], code);
    assert.deepEqual(f.runModes, recorded ? ['read', 'write'] : ['read'], code);
  }
});

test('forget between classification and apply reports the conflict without a receipt', async () => {
  const f = fixture({ classify: async (snapshot, _catalog, { validateFresh }) => {
    await validateFresh();
    f.forget(a.id);
    return abstain(snapshot);
  } });
  assert.deepEqual(await f.run(), { status: 'failed', error: { code: 'revision_conflict', retryable: false } });
  assert.deepEqual(f.calls.map(({ method }) => method), ['classify', 'apply']);
  assert.deepEqual(f.runModes, ['read', 'read', 'write', 'write']);
});

test('validateFresh catches a changed revision or index before the model call', async () => {
  for (const [change, code, retryable] of [
    ['changeMemory', 'revision_conflict', false], ['changeIndex', 'topic_index_moved', true],
  ]) {
    let modelCalls = 0;
    const f = fixture({ classify: async (snapshot, _catalog, { validateFresh }) => {
      f[change](a.id);
      await validateFresh();
      modelCalls++;
      return abstain(snapshot);
    } });
    assert.deepEqual(await f.run(), { status: 'failed', error: { code, retryable } });
    assert.equal(modelCalls, 0);
    assert.deepEqual(f.calls.slice(1), retryable ? [{ method: 'markFailed', memoryIds: [a.id, b.id], code }] : []);
    assert.deepEqual(f.runModes, retryable ? ['read', 'read', 'write'] : ['read', 'read']);
  }
});

test('catalog paging stops at 100 and distinguishes truncation from exact exhaustion', async () => {
  for (const length of [99, 100, 101]) {
    const topics = Array.from({ length }, (_, i) => topic(`Topic ${i}`));
    const f = fixture({ topics, pageSize: 37, classify: abstain });
    assert.equal((await f.run()).status, 'applied');
    const { map, mapExhausted } = f.calls[0].catalog;
    assert.deepEqual(map.map(({ moc }) => moc.id), topics.slice(0, 100).map(({ id }) => id));
    assert.equal(mapExhausted, length <= 100);
    assert.deepEqual(f.catalogRequests, [
      { cursor: null, limit: 100 }, { cursor: '37', limit: 63 }, { cursor: '74', limit: 26 },
    ]);
  }
});

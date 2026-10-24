import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { assemblyFixture, assemblyQuery, controlledClock, counter, sample, ns, personal, ok } from '../testing/context-read-assembly-fixture.mjs';
import { denied, receipt, policy, refresh, mutateProcess, waitForContextEntry } from '../testing/context-read-core-fixture.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';

test('A06 second-process correction, supersession and forget during counting refuse stale prepared text', async t => {
  // Child-process startup and storage contention consume wall time, not the
  // cooperative assembly clock. Deadline expiry has its own tests below.
  const clock = controlledClock(t);
  for (const method of ['correct', 'supersede', 'forget']) {
    let f, memory, fired = false;
    const port = { id: 'race-' + method, countTokens(text) {
      if (!fired) {
        fired = true;
        const input = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
          ...(method === 'correct' ? { content: 'assembly corrected', kind: 'fact', receipt: receipt('correction') } :
            method === 'supersede' ? { replacement: { content: 'assembly replacement', kind: 'fact' }, receipts: [receipt('replacement')] } : {}) };
        const changed = mutateProcess(f, { method, input }, { sync: true });
        if (method === 'correct') assert.equal(changed.memory.revision, 2);
      }
      return counter.countTokens(text);
    } };
    f = assemblyFixture(t, { counter: port }); memory = f.admit('assembly original');
    const result = await f.call('contextRead', assemblyQuery({ budget: { maxTokens: 4000, maxItems: 24 } }));
    assert.equal(fired, true); denied(result, 'snapshot_stale');
    assert.equal(clock.now(), 0);
    assert.equal(result.error.retryable, false); assert.equal(JSON.stringify(result).includes('original'), false);
  }
});

test('A06 second connection deletion, refiling, receipt invalidation and Card changes stale admitted fences', async t => {
  controlledClock(t);
  for (const change of ['delete', 'refile', 'receipt', 'card-revision', 'card-delete', 'card-source']) {
    let f, memory, card, fired = false;
    const port = { id: 'race-' + change, countTokens(text) {
      if (!fired) {
        fired = true;
        if (change === 'delete') {
          f.writer.prepare('DELETE FROM receipts WHERE memory_id=?').run(memory.id);
          f.writer.prepare('DELETE FROM memories WHERE id=?').run(memory.id);
        }
        if (change === 'refile') f.writer.prepare("UPDATE memories SET filing_status='filed',revision=revision+1 WHERE id=?").run(memory.id);
        if (change === 'receipt' || change === 'card-source') f.writer.prepare('DELETE FROM receipts WHERE memory_id=?').run(memory.id);
        if (change === 'card-revision') f.writer.prepare('UPDATE private_cards SET revision=revision+1 WHERE id=?').run(card.id);
        if (change === 'card-delete') ok(f.host.call(f.core, 'deleteKnowledgeCard', { namespace: ns, cardId: card.id,
          expectedRevision: card.revision, actionId: 'delete' }));
      }
      return counter.countTokens(text);
    } };
    const cards = change.startsWith('card');
    f = assemblyFixture(t, { counter: port, cards }); memory = f.admit('assembly memory');
    if (cards) {
      const draft = ok(f.host.call(f.core, 'createCardDraft', { namespace: ns, actionId: 'draft', drafting: 'authored', input: {
        title: 'assembly Card', body: 'Synthetic Card body.',
        ...(change === 'card-source' ? { sourcePolicy: 'retained-receipts-v1', memoryRefs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }] } :
          { authoredInput: { text: 'Synthetic note.', occurredAt: null } }) } }));
      card = ok(f.host.call(f.core, 'confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: draft.revision,
        actionId: 'confirm', applicability: 'current' }));
    }
    denied(await f.call('contextRead', assemblyQuery({ types: cards ? ['card'] : ['memory'], budget: { maxTokens: 4000, maxItems: 24 } })), 'snapshot_stale');
    assert.equal(fired, true);
  }
});

test('A06 preparation omits unavailable candidates outside the prepared universe', async t => {
  const f = assemblyFixture(t), memory = f.admit('assembly before preparation');
  let resumed = false, armed = false, checks = 0, changed = false;
  f.trusted.state.hook = request => {
    if (request.method === 'contextRead' && !armed) {
      armed = true;
      queueMicrotask(() => { resumed = true; });
    }
    // Outer result check, search check, lease acquisition, then the access
    // check immediately before preparation. The search fence has passed.
    if (resumed && ++checks === 4) {
      changed = true;
      ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    }
  };
  try {
    const actual = ok(await f.call('contextRead', assemblyQuery()));
    assert.equal(changed, true); assert.equal(actual.diagnostics.candidates.count, 1);
    assert.equal(actual.diagnostics.omitted.unavailable, 1);
    assert.equal(actual.diagnostics.omitted.bodies, 0); assert.equal(actual.diagnostics.omitted.sources, 0);
    assert.deepEqual(actual.metered.items, []); assert.equal(actual.snapshot, null);
  } finally { f.trusted.state.hook = null; }
});

test('A06 authoritative read follows every host callback and count; a later microtask write leaves delivered text intact', async t => {
  let f, memory, queued = false, finalRead = false, evidenceReads = 0, counterCalls = 0, lateWrite = false;
  const port = { id: 'linearization', countTokens(text) {
    assert.equal(finalRead, false, 'no counter follows final read'); counterCalls++;
    if (!queued) {
      queued = true;
      queueMicrotask(() => {
        assert.equal(finalRead, true, 'no await occurs between counting and final read');
        ok(f.core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
          content: 'assembly written after final read', kind: 'fact', receipt: receipt('later') }));
        lateWrite = true;
      });
    }
    return counter.countTokens(text);
  } };
  f = assemblyFixture(t, { counter: port }); memory = f.admit('assembly original intact');
  const originalPrepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(sql) {
    if (sql.startsWith('SELECT * FROM memories WHERE') &&
        originalPrepare.call(this, 'PRAGMA query_only').get().query_only === 1 && ++evidenceReads === 2) finalRead = true;
    return originalPrepare.call(this, sql);
  };
  f.trusted.state.hook = request => { if (request.method === 'contextRead') assert.equal(finalRead, false, 'no authority callback follows final read'); };
  let value;
  try { value = ok(await f.call('contextRead', assemblyQuery({ budget: { maxTokens: 4000, maxItems: 24 } }))); }
  finally { DatabaseSync.prototype.prepare = originalPrepare; f.trusted.state.hook = null; }
  assert.equal(lateWrite, true); assert.equal(evidenceReads, 2);
  assert.equal(value.diagnostics.trace.counterCalls, counterCalls);
  assert.equal(value.metered.items[0].body, 'assembly original intact');
  denied(f.call('fetchCandidateEvidence', { readSet: [ns], snapshot: value.snapshot }), 'snapshot_stale');
});

test('A06/A07 revocation at search-result await, counter callbacks and final check returns scope_changed', async t => {
  for (const stage of ['outer-await', 'counter', 'final-check']) {
    let f, counted = false;
    const port = { id: 'revocation', countTokens(text) {
      counted = true;
      if (stage === 'counter') f.trusted.state.enabled = false;
      return counter.countTokens(text);
    } };
    f = assemblyFixture(t, { counter: port }); f.admit('assembly revocation');
    let queued = false;
    f.trusted.state.hook = request => {
      if (request.method !== 'contextRead') return;
      if (stage === 'outer-await' && !queued) { queued = true; queueMicrotask(() => { f.trusted.state.enabled = false; }); }
      if (stage === 'final-check' && counted) f.trusted.state.enabled = false;
    };
    denied(await f.call('contextRead', assemblyQuery()), 'scope_changed');
    if (stage === 'outer-await') assert.equal(counted, false);
  }
  let f, counted = false;
  f = assemblyFixture(t, { counter: { id: 'cross-namespace-revocation', countTokens(text) {
    counted = true; f.trusted.state.allowed = [ns]; f.trusted.state.generation++; return counter.countTokens(text);
  } } });
  f.seed(sample.items.slice(1, 3), [ns, personal]);
  denied(await f.call('contextRead', assemblyQuery({ readSet: [ns, personal], budget: { maxTokens: 4000, maxItems: 24 } })), 'scope_changed');
  assert.equal(counted, true);
});

test('A07 inner embedding await rechecks outer contextRead authority and search fences; no repeated embedding', async t => {
  controlledClock(t);
  for (const change of ['revoke', 'mutate']) {
    const base = createFakeEmbedder();
    let pending = false, entered, release, calls = 0;
    const embedder = { ...base, async embed(texts, options) {
      calls++;
      if (pending) { entered(); await new Promise(resolve => { release = resolve; }); }
      options.beforeDispatch(); return base.embed(texts, options);
    } };
    const f = assemblyFixture(t, { embedder, selectedPolicy: policy() }), memory = f.admit('assembly embed fence');
    ok(await f.call('refreshContextIndex', refresh()));
    const before = calls, gate = new Promise(resolve => { entered = resolve; }); pending = true;
    const operation = f.call('contextRead', assemblyQuery({ semantic: true }));
    try {
      await waitForContextEntry(gate, operation);
      if (change === 'revoke') f.trusted.state.enabled = false;
      else mutateProcess(f, { method: 'correct', input: { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
        content: 'assembly changed at await', kind: 'fact', receipt: receipt('await') } }, { sync: true });
      release();
      denied(await operation, change === 'revoke' ? 'scope_changed' : 'index_unavailable');
      assert.equal(calls, before + 1);
      assert.ok(f.trusted.state.requests.filter(request => request.method === 'contextRead').length > 0);
    } finally { release?.(); await operation; }
  }
});

test('A06/A09 counter callbacks run outside read transactions and burn the same cooperative deadline', async t => {
  let f, calls = 0, offset = 0;
  const originalNow = performance.now.bind(performance), descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => originalNow() + offset });
  t.after(() => { if (descriptor) Object.defineProperty(performance, 'now', descriptor); else delete performance.now; });
  const active = new Set(), originalExec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    const value = originalExec.call(this, sql);
    if (sql === 'BEGIN' || sql === 'BEGIN IMMEDIATE') active.add(this);
    if (sql === 'COMMIT' || sql === 'ROLLBACK') active.delete(this);
    return value;
  };
  const port = { id: 'deadline-burn', countTokens(text) {
    assert.equal(active.size, 0); calls++;
    if (calls === 2) offset = 10000;
    return counter.countTokens(text);
  } };
  try {
    f = assemblyFixture(t, { counter: port }); f.seed(sample.items.slice(0, 3));
    const actual = ok(await f.call('contextRead', assemblyQuery({ budget: { maxTokens: 4000, maxItems: 24 } })));
    assert.equal(actual.diagnostics.stops.deadline, true); assert.equal(calls, 3);
    assert.equal(actual.metered.items.length, 0); assert.equal(actual.diagnostics.omitted.bodies, 3);
    assert.equal(actual.diagnostics.omitted.sources, 3); assert.equal(active.size, 0);
  } finally { DatabaseSync.prototype.exec = originalExec; offset = 0; }
});

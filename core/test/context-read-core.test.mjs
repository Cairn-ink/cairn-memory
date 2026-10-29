import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { coreFixture, query, refresh, policy, ns, personal, foreign, ok, denied, receipt, openContextReader, mutateProcess, host, waitForContextEntry } from '../testing/context-read-core-fixture.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { createBM25 } from '../context-read-bm25.mjs';
import { fuseCandidates } from '../context-read-fusion.mjs';
import { readTransaction, isConnectionDiscarded } from '../database.mjs';
import { child } from '../testing/method-package-fixtures.mjs';
import { sourceFixture, savedSource, anchor, resolve as resolveRaw, draft as draftRaw, ns as rawNs } from '../testing/raw-source-fixtures.mjs';
import { observeDatabaseFiles } from '../testing/context-read-fixture.mjs';
import { openMemoryCore } from '../index.mjs';

const ref = (memory, namespace = ns) => ({ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision });
function spyEmbedder(base = createFakeEmbedder(), behavior) {
  const calls = [];
  return { port: { id: base.id, revision: base.revision, dimensions: base.dimensions, normalization: base.normalization,
    async embed(texts, options = {}) { calls.push([...texts]); options.beforeDispatch?.();
      return behavior ? behavior(texts, options, base) : base.embed(texts, options); } }, calls };
}

test('R01 flag-off core surface, serialized DTOs and errors stay unchanged', () => {
  child(`
    import assert from 'node:assert/strict';
    import {openMemoryCore} from './core/index.mjs';
    const core=openMemoryCore({path:':memory:'});
    for(const name of ['findCandidates','refreshContextIndex','fetchCandidateEvidence','getContextReadCapabilities'])assert.equal(name in core,false);
    const ns={ownerId:'synthetic',scope:'personal',projectId:null};
    assert.equal(JSON.stringify(core.list({namespace:ns})),'{"ok":true,"value":{"memories":[],"nextCursor":null,"exhausted":true}}');
    assert.equal(JSON.stringify(core.list({namespace:ns,unknown:true})),'{"ok":false,"error":{"code":"invalid_input","retryable":false}}');
    core.close();
  `);
});

test('R02/R06 capabilities reveal configuration only; authorize exact methods and every namespace before sidecar creation', async t => {
  const f = coreFixture(t); f.admit('apple unfiled');
  const caps = ok(f.context.getContextReadCapabilities());
  assert.deepEqual(caps.types, ['memory']); assert.equal(caps.maintenance, true);
  caps.types.push('card');
  assert.deepEqual(ok(f.context.getContextReadCapabilities()).types, ['memory']);
  assert.equal(JSON.stringify(caps).includes('eligible'), false);
  denied(await f.context.findCandidates(query(), {}), 'authority_required');
  assert.equal(existsSync(f.path + '.context-read-v1.sqlite'), false);
  const forged = f.trusted.token('refreshContextIndex', query());
  denied(await f.context.findCandidates(query(), forged), 'authority_required');
  denied(await f.call('findCandidates', query({ readSet: [ns, foreign] })), 'invalid_read_set');
  denied(await f.call('findCandidates', query({ readSet: [foreign] })), 'authority_required');
  assert.equal(existsSync(f.path + '.context-read-v1.sqlite'), false);
  const result = ok(await f.call('findCandidates', query()));
  assert.equal(result.items.length, 1); assert.equal(result.items[0].fusionScore, null);
  assert.deepEqual(Object.keys(result.items[0]).sort(), ['channels', 'fusionScore', 'rank', 'ref']);
  for (const request of f.trusted.state.requests) { assert.equal(request.actionClass, 'read'); assert.equal(request.actionId, null); }
  f.trusted.state.allowed = [ns];
  denied(await f.call('findCandidates', query({ readSet: [personal, ns] })), 'authority_required');
  denied(await f.call('findCandidates', query({ types: ['card'] })), 'invalid_input');
  denied(await f.call('findCandidates', { ...query(), authority: {} }), 'invalid_input');
});

test('R03 frozen HR-1 and exact-term/CJK fixtures replay through product BM25 and both frozen fused rankings', async t => {
  const sample = JSON.parse(readFileSync(new URL('./fixtures/context-read/hr1-sample.json', import.meta.url)));
  assert.equal(sample.source.sha256, '1ce357439f1ed28cfd2e2c8bf31e0bde1581e1110c40577f06d0a915d8db0bf5');
  for (const family of ['local', 'hosted']) {
    const fake = spyEmbedder(createFakeEmbedder({ dimensions: 256 })), f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy({ family }) });
    const documents = [...sample.documents.map(row => row.text), '中', '中文資料庫', '𠀀𠀁𠀂', 'ＡＢＣ１２']
      .map(text => {
        const admitted = f.admit(text), memory = ok(f.core.get({ namespace: ns, memoryId: admitted.id })).memory;
        return { ref: ref(memory), text: memory.content };
      });
    assert.equal(documents.at(-1).text, 'ABC12', 'reference rankings use the canonical stored mixed-width content');
    const bm25 = createBM25(documents);
    ok(await f.call('refreshContextIndex', refresh()));
    for (const text of ['SQLite', '月報庫', '資料庫', 'RelayCart response', 'hosting 預算', '中', '資料', '𠀁𠀂', 'abc12', 'ABC12', 'ＡＢＣ１２']) {
      const lexical = bm25.search(text), value = ok(await f.call('findCandidates', query({ query: text, limit: 24 })));
      assert.deepEqual(value.items.map(row => ({ ref: row.ref, score: row.channels.lexical.rawScore })), lexical.map(row => ({ ref: row.ref, score: row.score })));
      const hybrid = ok(await f.call('findCandidates', query({ query: text, semantic: true, limit: 24 })));
      const vector = (await fake.port.embed([text]))[0];
      const vectors = await fake.port.embed(documents.map(row => row.text));
      const semantic = documents.map((doc, i) => ({ ref: doc.ref, score: vectors[i].reduce((n, x, j) => n + x * vector[j], 0) /
        Math.sqrt(vectors[i].reduce((n, x) => n + x*x, 0) * vector.reduce((n, x) => n + x*x, 0)) }));
      const expected = fuseCandidates(lexical, semantic, { preset: family === 'local' ? 'rrf-k60-d12' : 'rrf-k10', semanticState: 'ready', coverageComplete: true });
      assert.deepEqual(hybrid.items.map(row => row.ref), expected.rows.map(row => row.ref));
      hybrid.items.forEach((row, i) => assert.equal(row.fusionScore, expected.rows[i].fusionScore));
      if (text === '中') assert.deepEqual(value.items.map(row => row.ref), [documents.at(-4).ref], 'documented embedded single-Han miss');
      if (['abc12', 'ABC12', 'ＡＢＣ１２'].includes(text)) assert.deepEqual(value.items.map(row => row.ref), [documents.at(-1).ref]);
    }
  }
});

test('R04/R05 fake HTTP paraphrase retrieval; default/false and predictable partial coverage dispatch zero query embeddings', async t => {
  let httpCalls = 0;
  const fake = spyEmbedder(createFakeEmbedder({ dimensions: 256, aliases: { automobile: 'car', vehicle: 'car' } }), async (texts, options, base) => {
    options.beforeDispatch(); httpCalls++;
    const response = new Response(JSON.stringify({ data: (await base.embed(texts, options)).map(embedding => ({ embedding: [...embedding] })) }));
    return (await response.json()).data.map(row => row.embedding);
  });
  const f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy({ family: 'hosted' }) });
  const car = f.admit('car'), pear = f.admit('pear');
  const partial = ok(await f.call('findCandidates', query({ query: 'automobile', semantic: true })));
  assert.equal(partial.channels.semantic.state, 'partial_coverage'); assert.equal(httpCalls, 0); assert.equal(partial.items.length, 0);
  ok(await f.call('findCandidates', query({ query: 'car' })));
  ok(await f.call('findCandidates', query({ query: 'car', semantic: false })));
  assert.equal(httpCalls, 0);
  assert.equal(ok(await f.call('refreshContextIndex', refresh())).status, 'complete');
  const before = httpCalls, result = ok(await f.call('findCandidates', query({ query: 'automobile', semantic: true })));
  assert.equal(httpCalls, before + 1); assert.equal(result.trace.preset, 'rrf-k10');
  assert.equal(result.items[0].ref.memoryId, car.id); assert.equal(result.coverage.byType.memory.scanned, 2);
  assert.notEqual(car.id, pear.id);
});

test('R04/R05 all provider degradation preserves lexical, with complete-only publication and sanitized diagnostics', async t => {
  const mode = { error: null };
  const fake = spyEmbedder(createFakeEmbedder(), (texts, options, base) => {
    if (mode.error) throw mode.error;
    return base.embed(texts, options);
  });
  const f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy() }); f.admit('apple');
  ok(await f.call('refreshContextIndex', refresh()));
  for (const [error, state] of [[{ status: 429 }, 'rate_limited'], [{ code: 'provider_error', message: 'private-path-key' }, 'provider_error'],
    [{ code: 'unavailable' }, 'unavailable'], [{ code: 'stale_index' }, 'stale_index'],
    [{ code: 'dimension_mismatch' }, 'dimension_mismatch'], [{ code: 'budget_denied' }, 'budget_denied'], [{ code: 'timeout' }, 'timeout']]) {
    mode.error = error;
    const value = ok(await f.call('findCandidates', query({ semantic: true })));
    assert.equal(value.channels.semantic.state, state); assert.equal(value.items.length, 1); assert.equal(value.trace.effective, 'lexical');
    assert.equal(JSON.stringify(value).includes('private-path-key'), false);
  }
  mode.error = { status: 429, code: 'provider_error' };
  const multiple = ok(await f.call('findCandidates', query({ semantic: true })));
  assert.deepEqual(multiple.channels.semantic, { state: 'rate_limited', causes: ['rate_limited', 'provider_error'] });
  mode.error = { code: 'context_item_too_large' };
  const oversized = ok(await f.call('findCandidates', query({ semantic: true })));
  assert.deepEqual(oversized.channels.semantic, { state: 'provider_error', causes: ['provider_error', 'context_item_too_large'] });
  assert.equal(oversized.trace.effective, 'lexical');
  mode.error = null;
  const missing = coreFixture(t); missing.admit('apple');
  const absent = await missing.call('findCandidates', query({ semantic: true })); denied(absent, 'invalid_input');
  assert.equal(absent.error.details.channels.semantic.state, 'absent');
  const unbudgeted = coreFixture(t, { embedder: fake.port });
  denied(await unbudgeted.call('findCandidates', query({ semantic: true })), 'invalid_input');
  const bad = spyEmbedder(createFakeEmbedder(), () => [[Number.MAX_VALUE]]);
  const overflow = coreFixture(t, { embedder: { ...bad.port, dimensions: 1, normalization: 'none' }, selectedPolicy: policy() });
  overflow.admit('apple');
  const refreshed = ok(await overflow.call('refreshContextIndex', refresh()));
  assert.equal(refreshed.channels.lexical.state, 'ready'); assert.equal(refreshed.channels.semantic.state, 'provider_error');
  const lexical = ok(await overflow.call('findCandidates', query())); assert.equal(lexical.items.length, 1);
});

test('R04/R05 refresh reports committed vector batches when a later batch fails and resumes without duplicate dispatch', async t => {
  let calls = 0, refuse = true;
  const fake = spyEmbedder(createFakeEmbedder(), (texts, options, base) => {
    if (++calls === 2 && refuse) throw { code: 'rate_limited' };
    return base.embed(texts, options);
  });
  const f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy() });
  for (let i = 0; i < 65; i++) f.admit('apple synthetic batch ' + i);
  const partial = ok(await f.call('refreshContextIndex', refresh()));
  assert.equal(partial.status, 'partial'); assert.equal(partial.channels.semantic.state, 'rate_limited');
  assert.equal(partial.progress.embeddingAttempts, 65); assert.equal(partial.progress.embedded, 64);
  const side = new DatabaseSync(f.path + '.context-read-v1.sqlite', { readOnly: true });
  try { assert.equal(side.prepare('SELECT count(*) AS n FROM vectors').get().n, 64); } finally { side.close(); }
  refuse = false;
  const resumed = ok(await f.call('refreshContextIndex', refresh()));
  assert.equal(resumed.status, 'complete'); assert.equal(resumed.progress.embeddingAttempts, 1); assert.equal(resumed.progress.embedded, 1);
  assert.equal(resumed.coverage.byType.memory.embedded, 65); assert.equal(calls, 3);
});

test('R06 unrelated scope cache leaves counts/channels/rankings unchanged and no foreign text enters embeddings', async t => {
  const fake = spyEmbedder(), f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy() });
  f.admit('apple'); f.admit('apple private other scope', personal); f.admit('FOREIGN_SECRET apple', foreign);
  ok(await f.call('refreshContextIndex', refresh()));
  const before = ok(await f.call('findCandidates', query({ semantic: true })));
  ok(await f.call('refreshContextIndex', refresh({ readSet: [personal] })));
  const after = ok(await f.call('findCandidates', query({ semantic: true })));
  assert.deepEqual(after.coverage, before.coverage); assert.deepEqual(after.channels, before.channels); assert.deepEqual(after.items, before.items);
  assert.ok(fake.calls.flat().every(text => !text.includes('FOREIGN_SECRET')));
  f.trusted.state.enabled = false;
  denied(await f.call('findCandidates', query()), 'authority_required');
});

test('R06/R10 revoke and mutate at provider await/dispatch fences; independent writer commits with no model lock', async t => {
  let gate, pending, f, entered;
  const fake = spyEmbedder(createFakeEmbedder(), async (texts, options, base) => {
    if (pending) { entered(); await new Promise(resolve => { gate = resolve; }); }
    options.beforeDispatch(); return base.embed(texts, options);
  });
  f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy() }); const a = f.admit('apple'), b = f.admit('pear');
  ok(await f.call('refreshContextIndex', refresh()));
  pending = true;
  const started = new Promise(resolve => { entered = resolve; });
  const lookup = f.call('findCandidates', query({ semantic: true, deadlineMs: 5000 }));
  try {
    await waitForContextEntry(started, lookup);
    const writer = await mutateProcess(f, { method: 'correct', input: { namespace: ns, memoryId: b.id, expectedRevision: b.revision,
      content: 'pear changed independently', kind: 'fact', receipt: receipt('concurrent') } });
    assert.equal(writer.memory.revision, 2); gate();
    denied(await lookup, 'index_unavailable');
  } finally { gate?.(); await lookup; }
  pending = false; ok(await f.call('refreshContextIndex', refresh()));
  pending = true; gate = undefined;
  const awaiting = new Promise(resolve => { entered = resolve; });
  const revoked = f.call('findCandidates', query({ semantic: true, deadlineMs: 5000 }));
  try {
    await waitForContextEntry(awaiting, revoked);
    f.trusted.state.enabled = false; gate(); denied(await revoked, 'scope_changed');
  } finally { gate?.(); await revoked; }
  assert.equal(a.revision, 1);
});

test('R07 snapshot fetch/refetch refuses second-process correction, supersession and forget', async t => {
  for (const method of ['correct', 'supersede', 'forget']) {
    const f = coreFixture(t), memory = f.admit('apple target');
    const result = ok(await f.call('findCandidates', query())), fetched = ok(f.call('fetchCandidateEvidence', { readSet: [ns], refs: result.items.map(row => row.ref), intent: 'current' }));
    const input = { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      ...(method === 'correct' ? { content: 'banana corrected', kind: 'fact', receipt: receipt(method) } :
        method === 'supersede' ? { replacement: { content: 'banana replacement', kind: 'fact' }, receipts: [receipt(method)] } : {}) };
    await mutateProcess(f, { method, input });
    denied(f.call('fetchCandidateEvidence', { readSet: [ns], snapshot: fetched.snapshot }), 'snapshot_stale');
    const direct = f.call('fetchCandidateEvidence', { readSet: [ns], refs: [ref(memory)], intent: 'current' });
    assert.equal(direct.ok, false); assert.ok(['revision_conflict', 'evidence_unavailable'].includes(direct.error.code));
  }
});

test('R07 final canonical refetch occurs after last host check and catches a second-process mutation', t => {
  const f = coreFixture(t), memory = f.admit('apple target');
  let checks = 0;
  f.trusted.state.hook = request => {
    if (request.method === 'fetchCandidateEvidence' && ++checks === 3) mutateProcess(f, { method: 'forget',
      input: { namespace: ns, memoryId: memory.id, expectedRevision: memory.revision } }, { sync: true });
  };
  denied(f.call('fetchCandidateEvidence', { readSet: [ns], refs: [ref(memory)], intent: 'current' }), 'evidence_unavailable');
  assert.equal(checks, 3);
});

test('R08 feature-off mutations reconcile automatically; current/history qualification and Card eligibility reuse canonical readers', async t => {
  const f = coreFixture(t, { cards: true }), a = f.admit('apple current'), b = f.admit('apple old');
  const draft = ok(f.host.call(f.core, 'createCardDraft', { namespace: ns, actionId: 'draft', drafting: 'authored', input: {
    title: 'apple Card', body: 'Synthetic Card body', authoredInput: { text: 'Synthetic source', occurredAt: null } } }));
  const card = ok(f.host.call(f.core, 'confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: draft.revision, actionId: 'confirm', applicability: 'current' }));
  const first = ok(await f.call('findCandidates', query({ types: ['memory', 'card'] })));
  assert.equal(first.items.length, 3);
  const fetched = ok(f.call('fetchCandidateEvidence', { readSet: [ns], refs: first.items.map(row => row.ref), intent: 'current' }));
  assert.equal(fetched.items.find(row => row.type === 'card').body, 'Synthetic Card body');
  ok(f.core.supersede({ namespace: ns, memoryId: b.id, expectedRevision: b.revision,
    replacement: { content: 'banana new', kind: 'fact' }, receipts: [receipt('replacement')] }));
  const current = ok(await f.call('findCandidates', query({ types: ['memory', 'card'] })));
  assert.equal(current.items.length, 2);
  const history = ok(await f.call('findCandidates', query({ types: ['memory', 'card'], intent: 'history' })));
  assert.equal(history.items.length, 3);
  ok(f.host.call(f.core, 'deleteKnowledgeCard', { namespace: ns, cardId: card.id, expectedRevision: card.revision, actionId: 'delete' }));
  assert.equal(ok(await f.call('findCandidates', query({ types: ['memory', 'card'] }))).items.length, 1);
  assert.equal(a.revision, 1);
});

test('R11 frozen rankings partition top 24; semantic/default bindings, tamper, epochs, access and restart', async t => {
  const fake = spyEmbedder(), f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy({ family: 'hosted' }) });
  Array.from({ length: 26 }, (_, i) => f.admit('apple ' + i));
  ok(await f.call('refreshContextIndex', refresh()));
  const first = ok(await f.call('findCandidates', query({ semantic: true, limit: 3 }))), calls = fake.calls.length;
  const items = [...first.items]; let cursor = first.nextCursor;
  while (cursor) {
    const next = ok(await f.call('findCandidates', query({ semantic: true, limit: 3, cursor })));
    items.push(...next.items); cursor = next.nextCursor;
  }
  assert.equal(items.length, 24); assert.equal(new Set(items.map(row => row.ref.memoryId)).size, 24); assert.equal(fake.calls.length, calls);
  denied(await f.call('findCandidates', query({ semantic: false, cursor: first.nextCursor })), 'invalid_cursor');
  denied(await f.call('findCandidates', query({ semantic: true, query: 'pear', cursor: first.nextCursor })), 'invalid_cursor');
  denied(await f.call('findCandidates', query({ semantic: true, cursor: first.nextCursor + 'a' })), 'invalid_cursor');
  const lexical = ok(await f.call('findCandidates', query({ limit: 1 })));
  lexical.coverage.byType.memory.eligible = 999;
  lexical.channels.semantic.state = 'ready';
  const continued = ok(await f.call('findCandidates', query({ semantic: false, limit: 1, cursor: lexical.nextCursor })));
  assert.equal(continued.coverage.byType.memory.eligible, 26); assert.equal(continued.channels.semantic.state, 'disabled');
  f.trusted.state.generation++;
  denied(await f.call('findCandidates', query({ semantic: true, cursor: first.nextCursor })), 'cursor_stale');
  f.trusted.state.generation--;
  const fresh = ok(await f.call('findCandidates', query({ limit: 1 })));
  f.reopen(); denied(await f.call('findCandidates', query({ limit: 1, cursor: fresh.nextCursor })), 'cursor_stale');
});

test('R11 ranking eviction and five-minute creation expiry never renew on continuation', async t => {
  const f = coreFixture(t); f.admit('apple'); f.admit('apple pear');
  const saved = Date.now; let time = saved(); Date.now = () => time;
  try {
    const first = ok(await f.call('findCandidates', query({ limit: 1 })));
    time += 299000; ok(await f.call('findCandidates', query({ limit: 1, cursor: first.nextCursor })));
    time += 1001; denied(await f.call('findCandidates', query({ limit: 1, cursor: first.nextCursor })), 'cursor_stale');
    const evicted = ok(await f.call('findCandidates', query({ limit: 1 })));
    for (let i = 0; i < 128; i++) ok(await f.call('findCandidates', query({ query: 'apple ' + i, limit: 1 })));
    denied(await f.call('findCandidates', query({ limit: 1, cursor: evicted.nextCursor })), 'cursor_stale');
  } finally { Date.now = saved; }
});

test('R12 read-only handles never maintain or create files; stale generations fail and canonical DDL is unchanged', async t => {
  const f = coreFixture(t), memory = f.admit('apple'), ddl = f.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
  const reader = openContextReader({ path: f.path, contextRead: f.config }); f.workspace.defer(() => reader.close());
  const before = readdirSync(f.workspace.path).sort();
  const observed = await observeDatabaseFiles(f, async () => {
    denied(await f.trusted.call(reader, 'findCandidates', query()), 'index_unavailable');
    denied(await f.trusted.call(reader, 'refreshContextIndex', refresh()), 'invalid_input');
  });
  assert.deepEqual(readdirSync(f.workspace.path).sort(), before); assert.deepEqual(observed.events, []);
  ok(await f.call('findCandidates', query()));
  ok(await f.trusted.call(reader, 'findCandidates', query()));
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  denied(await f.trusted.call(reader, 'findCandidates', query()), 'index_unavailable');
  assert.deepEqual(f.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), ddl);
});

test('R10 shared helper forbids writes and discards a connection whose cleanup fails', t => {
  const f = coreFixture(t), db = new DatabaseSync(f.path), original = db.exec;
  assert.throws(() => readTransaction(db, () => { db.exec('CREATE TABLE forbidden(x)'); }), /readonly|read.only/i);
  assert.equal(db.prepare('PRAGMA query_only').get().query_only, 0);
  db.exec = function(sql) { if (sql === 'PRAGMA query_only=OFF') throw Error('synthetic cleanup failure'); return original.call(this, sql); };
  assert.throws(() => readTransaction(db, () => []), /synthetic cleanup/); assert.equal(isConnectionDiscarded(db), true);
  assert.throws(() => readTransaction(db, () => []), { code: 'store_closed' });
});

test('R04/R05 budgets retain concurrency until actual settlement and enforce request/spend caps before HTTP', async t => {
  let hang = false, release, settled, clockOffset = 0;
  const originalNow = performance.now.bind(performance), descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => originalNow() + clockOffset });
  t.after(() => { if (descriptor) Object.defineProperty(performance, 'now', descriptor); else delete performance.now; });
  const fake = spyEmbedder(createFakeEmbedder(), (texts, options, base) => {
    if (!hang) return base.embed(texts, options);
    clockOffset = 10000; // Advance only after dispatch; timeout is independent of host load.
    settled = new Promise(resolve => { release = () => resolve(base.embed(texts, {})); });
    return settled;
  });
  const f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy({ maxConcurrent: 1 }) }); f.admit('apple');
  ok(await f.call('refreshContextIndex', refresh())); hang = true;
  const timed = ok(await f.call('findCandidates', query({ semantic: true, deadlineMs: 5000 })));
  assert.equal(timed.channels.semantic.state, 'timeout'); assert.equal(timed.items.length, 1);
  clockOffset = 0;
  const count = fake.calls.length;
  const blocked = ok(await f.call('findCandidates', query({ semantic: true })));
  assert.equal(blocked.channels.semantic.state, 'budget_denied'); assert.equal(fake.calls.length, count);
  hang = false; release(); await settled; await new Promise(resolve => setImmediate(resolve));
  assert.equal(ok(await f.call('findCandidates', query({ semantic: true }))).channels.semantic.state, 'ready');
  const cappedPort = spyEmbedder({ ...createFakeEmbedder(), id: 'synthetic-capped-test' }), capped = coreFixture(t, { embedder: cappedPort.port,
    selectedPolicy: policy({ maxRequests: 1, maxUsd: .25, estimateUsd: () => .25 }) }); capped.admit('apple');
  ok(await capped.call('refreshContextIndex', refresh()));
  assert.equal(ok(await capped.call('findCandidates', query({ semantic: true }))).channels.semantic.state, 'budget_denied');
  assert.equal(cappedPort.calls.length, 1);
  capped.reopen({ policy: policy({ maxRequests: 1, maxUsd: .25, estimateUsd: () => .25 }) });
  assert.equal(ok(await capped.call('findCandidates', query({ semantic: true }))).channels.semantic.state, 'budget_denied');
  assert.equal(cappedPort.calls.length, 1, 'closing/reopening a handle cannot reset the process policy ledger');
  const expensivePort = spyEmbedder({ ...createFakeEmbedder(), id: 'synthetic-expensive-test' }), expensive = coreFixture(t, { embedder: expensivePort.port,
    selectedPolicy: policy({ maxUsd: .1, estimateUsd: () => .2 }) }); expensive.admit('apple');
  const stopped = ok(await expensive.call('refreshContextIndex', refresh()));
  assert.equal(stopped.channels.semantic.state, 'budget_denied'); assert.equal(expensivePort.calls.length, 0);
});

test('R04 cache-byte preflight refuses an oversized authorized projection before allocating vectors or dispatching', async t => {
  let calls = 0;
  const port = { id: 'synthetic-wide', revision: '1', dimensions: 32768, normalization: 'none', embed() { calls++; throw Error('must not dispatch'); } };
  const f = coreFixture(t, { embedder: port, selectedPolicy: policy() });
  for (let i = 0; i < 1025; i++) f.admit('apple bounded ' + i);
  const first = await f.call('findCandidates', query({ semantic: true, deadlineMs: 5000 }));
  denied(first, 'index_unavailable');
  assert.equal(first.error.details.coverage.byType.memory.eligible, null);
  assert.equal(first.error.details.coverage.stops.budget, first.error.details.trace.maintenance.transformed >= 1024);
  assert.ok(first.error.details.coverage.stops.budget || first.error.details.coverage.stops.deadline);
  let resumed;
  // Rebuilding is the documented resumable protocol, not a test retry. The
  // projection must finish before asserting semantic coverage under any load.
  for (let step = 0; step < 32; step++) {
    resumed = await f.call('findCandidates', query({ semantic: true, deadlineMs: 5000 }));
    if (resumed.ok) break;
    denied(resumed, 'index_unavailable');
    assert.equal(resumed.error.details.coverage.maintenance.buildState, 'rebuilding');
  }
  const complete = ok(resumed);
  assert.equal(complete.channels.semantic.state, 'partial_coverage'); assert.equal(calls, 0);
  assert.equal(complete.coverage.byType.memory.eligible, 1025); assert.equal(complete.coverage.byType.memory.scanned, 0);
});

test('R06 refresh revocation after await and reservation revocation discard results and private diagnostics', async t => {
  let release, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const fake = spyEmbedder(createFakeEmbedder(), async (texts, options, base) => {
    entered(); await new Promise(resolve => { release = resolve; }); options.beforeDispatch(); return base.embed(texts, options);
  });
  const f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy() }); f.admit('apple');
  const pending = f.call('refreshContextIndex', refresh());
  try {
    await waitForContextEntry(started, pending);
    f.trusted.state.enabled = false; release();
    const result = await pending; denied(result, 'scope_changed'); assert.equal(result.error.details, undefined);
  } finally { release?.(); await pending; }
  const side = new DatabaseSync(f.path + '.context-read-v1.sqlite', { readOnly: true });
  try { assert.equal(side.prepare('SELECT count(*) AS n FROM vectors').get().n, 0); } finally { side.close(); }
  let other;
  const noDispatch = spyEmbedder();
  other = coreFixture(t, { embedder: noDispatch.port, selectedPolicy: policy({ estimateUsd() { other.trusted.state.enabled = false; return 0; } }) });
  other.admit('apple'); const refused = await other.call('refreshContextIndex', refresh());
  denied(refused, 'scope_changed'); assert.equal(refused.error.details, undefined); assert.equal(noDispatch.calls.length, 0);
});

test('R08 product-path Raw source exclusion and conversation deletion preserve canonical current/history eligibility', async t => {
  const trusted = host(); trusted.state.allowed = [rawNs];
  const f = sourceFixture(t, {
    model: { extract: () => ({ items: [{ content: 'synthetic locator', kind: 'fact', confidence: .8, sourceIndices: [0] }] }) } });
  const context = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority: trusted.authority } });
  f.workspace.defer(() => context.close());
  const source = await savedSource(f, 'Synthetic independently retained apple source.'), sources = await resolveRaw(f, [anchor(source, 0, 9)]);
  const card = ok(draftRaw(f, sources));
  ok(f.call('confirmCardDraft', { namespace: rawNs, cardId: card.id, expectedRevision: card.revision, actionId: 'confirm', applicability: 'current' }));
  const request = query({ readSet: [rawNs], types: ['card'], query: 'synthetic' });
  const initial = ok(await trusted.call(context, 'findCandidates', request)); assert.equal(initial.items.length, 1);
  ok(trusted.call(context, 'fetchCandidateEvidence', { readSet: [rawNs], refs: initial.items.map(row => row.ref), intent: 'current' }));
  const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
  ok(f.core.forget({ namespace: rawNs, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.equal(ok(await trusted.call(context, 'findCandidates', request)).items.length, 0);
  assert.equal(ok(await trusted.call(context, 'findCandidates', { ...request, intent: 'history' })).items.length, 0);
  const revision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision;
  ok(f.core.deleteConversation({ namespace: rawNs, conversationId: source.conversationId, expectedRevision: revision, actionId: 'delete-conversation' }));
  assert.equal(ok(await trusted.call(context, 'findCandidates', { ...request, intent: 'history' })).items.length, 0);
});

test('R07 second-process Card deletion stales candidate snapshots and prevents body delivery', async t => {
  const f = coreFixture(t, { cards: true });
  const draft = ok(f.host.call(f.core, 'createCardDraft', { namespace: ns, actionId: 'draft', drafting: 'authored', input: {
    title: 'apple Card', body: 'Synthetic Card body', authoredInput: { text: 'Synthetic source', occurredAt: null } } }));
  const card = ok(f.host.call(f.core, 'confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: draft.revision, actionId: 'confirm', applicability: 'current' }));
  const selected = ok(await f.call('findCandidates', query({ types: ['card'] })));
  const fetched = ok(f.call('fetchCandidateEvidence', { readSet: [ns], refs: selected.items.map(row => row.ref), intent: 'current' }));
  await mutateProcess(f, { card: true, method: 'deleteKnowledgeCard', input: { namespace: ns, cardId: card.id, expectedRevision: card.revision, actionId: 'delete' } });
  denied(f.call('fetchCandidateEvidence', { readSet: [ns], snapshot: fetched.snapshot }), 'snapshot_stale');
});

test('R12 real-process read-only/managed matrix creates no transient database auxiliaries and never changes DDL', async t => {
  const methodAuthority = { authorize() { return null; }, isCurrent() { return null; } };
  const f = coreFixture(t, { coreOptions: { methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority: methodAuthority } } });
  f.admit('apple'); ok(await f.call('findCandidates', query()));
  const storeId = f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  const ddl = f.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
  for (const mode of ['read-only', 'managed']) {
      const ordinary = await observeDatabaseFiles(f, async () => {
        ok(await mutateProcess(f, { mode, storeId, method: 'findCandidates', input: query(), envelope: true }));
        denied(await mutateProcess(f, { mode, storeId, method: 'refreshContextIndex', input: refresh(), envelope: true }), 'invalid_input');
      });
      assert.deepEqual(ordinary.events, []);
      const journal = f.path + '.context-read-v1.sqlite-journal';
      writeFileSync(journal, 'synthetic auxiliary', { mode: 0o600 });
      const refused = await observeDatabaseFiles(f, async () => {
        denied(await mutateProcess(f, { mode, storeId, method: 'findCandidates', input: query(), envelope: true }), 'index_unavailable');
      });
      assert.deepEqual(refused.events, []); unlinkSync(journal);
  }
  assert.deepEqual(f.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), ddl);
});

test('R02/R11 evidence snapshots bind the complete authorized read set; request and envelope size limits refuse', async t => {
  const f = coreFixture(t), a = f.admit('apple'), b = f.admit('apple personal', personal);
  const input = { readSet: [personal, ns], refs: [ref(a), ref(b, personal)], intent: 'current' };
  const fetched = ok(f.call('fetchCandidateEvidence', input));
  assert.equal(fetched.items.length, 2);
  assert.deepEqual(ok(f.call('fetchCandidateEvidence', { readSet: [ns, personal], snapshot: fetched.snapshot })).items, fetched.items);
  denied(f.call('fetchCandidateEvidence', { readSet: [ns], snapshot: fetched.snapshot }), 'invalid_snapshot');
  denied(f.call('fetchCandidateEvidence', { ...input, responseByteLimit: 1 }), 'context_item_too_large');
  denied(f.call('fetchCandidateEvidence', { readSet: [ns], snapshot: fetched.snapshot + 'a' }), 'invalid_snapshot');
  denied(await f.call('findCandidates', query({ limit: 25 })), 'invalid_input');
  denied(await f.call('findCandidates', query({ deadlineMs: 5001 })), 'invalid_input');
  denied(await f.call('findCandidates', query({ query: 'x'.repeat(4001) })), 'invalid_input');
  denied(await f.call('findCandidates', query({ cursor: 'x'.repeat(8193) })), 'invalid_cursor');
  denied(f.call('fetchCandidateEvidence', { readSet: [ns], snapshot: 'x'.repeat(16385) }), 'invalid_snapshot');
});

test('R06 concurrent scope access cannot evict a pending request or alter its coverage and ranking', async t => {
  let pending = false, entered, release;
  const fake = spyEmbedder(createFakeEmbedder(), async (texts, options, base) => {
    if (pending) { entered(); await new Promise(resolve => { release = resolve; }); }
    options.beforeDispatch(); return base.embed(texts, options);
  });
  const f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy() });
  f.admit('apple project'); f.admit('pear personal', personal);
  ok(await f.call('refreshContextIndex', refresh())); ok(await f.call('refreshContextIndex', refresh({ readSet: [personal] })));
  const expected = ok(await f.call('findCandidates', query({ semantic: true })));
  const gate = new Promise(resolve => { entered = resolve; }); pending = true;
  const request = f.call('findCandidates', query({ semantic: true, deadlineMs: 5000 }));
  try {
    await waitForContextEntry(gate, request);
    ok(await f.call('findCandidates', query({ readSet: [personal], query: 'pear' })));
    pending = false; release(); const actual = ok(await request);
    assert.deepEqual(actual.items, expected.items); assert.deepEqual(actual.channels, expected.channels); assert.deepEqual(actual.coverage, expected.coverage);
  } finally { pending = false; release?.(); await request; }
});

test('R10 every context read is query_only and all authority/provider callbacks run after transactions end', async t => {
  const active = new Set(), fake = spyEmbedder(createFakeEmbedder(), (texts, options, base) => {
    assert.equal(active.size, 0); return base.embed(texts, options);
  });
  const f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy() }); f.admit('apple');
  const originalExec = DatabaseSync.prototype.exec, originalPrepare = DatabaseSync.prototype.prepare;
  let canonical = 0, sidecar = 0;
  DatabaseSync.prototype.exec = function(sql) {
    const value = originalExec.call(this, sql);
    if (sql === 'BEGIN' || sql === 'BEGIN IMMEDIATE') active.add(this);
    if (sql === 'COMMIT' || sql === 'ROLLBACK') active.delete(this);
    return value;
  };
  DatabaseSync.prototype.prepare = function(sql) {
    if (/FROM memories INDEXED|SELECT content AS text|SELECT \* FROM memories WHERE/.test(sql)) canonical++;
    else if (/SELECT d\.\*,p\.frequency|hex\(v\.data\) AS vector_data/.test(sql)) sidecar++;
    else return originalPrepare.call(this, sql);
    assert.equal(this.isTransaction, true); assert.equal(originalPrepare.call(this, 'PRAGMA query_only').get().query_only, 1);
    assert.throws(() => originalExec.call(this, 'CREATE TABLE context_forbidden(x)'), /readonly|read.only/i);
    return originalPrepare.call(this, sql);
  };
  f.trusted.state.hook = () => assert.equal(active.size, 0);
  try {
    ok(await f.call('refreshContextIndex', refresh()));
    const result = ok(await f.call('findCandidates', query({ semantic: true })));
    const fetched = f.call('fetchCandidateEvidence', { readSet: [ns], refs: result.items.map(row => row.ref), intent: 'current' });
    assert.equal(typeof fetched.then, 'undefined'); ok(fetched);
    assert.ok(canonical > 0); assert.ok(sidecar > 0); assert.equal(active.size, 0);
  } finally { DatabaseSync.prototype.exec = originalExec; DatabaseSync.prototype.prepare = originalPrepare; f.trusted.state.hook = null; }
});

test('R08 ordinary lookup incrementally reconciles a feature-off write with one text read and bounded row writes', async t => {
  const f = coreFixture(t), memories = Array.from({ length: 25 }, (_, i) => f.admit('apple item ' + i));
  ok(await f.call('findCandidates', query()));
  const target = memories[12];
  ok(f.core.correct({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
    content: 'banana corrected', kind: 'fact', receipt: receipt('product-incremental') }));
  const value = ok(await f.call('findCandidates', query({ query: 'banana' })));
  assert.equal(value.items[0].ref.memoryId, target.id);
  assert.equal(value.trace.maintenance.canonicalRows, 25); assert.equal(value.trace.maintenance.sidecarRows, 25);
  assert.equal(value.trace.maintenance.textRows, 1); assert.ok(value.trace.maintenance.rowWrites < 50);
  assert.equal(value.trace.maintenance.writeTransactions, 1);
});

test('R09/R11 deleting a live sidecar rebuilds lexical only and stales cursors even when sequence numbers repeat', async t => {
  const fake = spyEmbedder(), f = coreFixture(t, { embedder: fake.port, selectedPolicy: policy() });
  f.admit('apple first'); f.admit('apple second');
  ok(await f.call('refreshContextIndex', refresh()));
  const first = ok(await f.call('findCandidates', query({ semantic: true, limit: 1 })));
  assert.ok(first.nextCursor); const calls = fake.calls.length;
  unlinkSync(f.path + '.context-read-v1.sqlite');
  const rebuilt = ok(await f.call('findCandidates', query({ semantic: true })));
  assert.equal(rebuilt.channels.lexical.state, 'ready'); assert.equal(rebuilt.channels.semantic.state, 'partial_coverage');
  assert.equal(fake.calls.length, calls, 'rebuilding lexical never reconstructs document vectors or embeds a query with gaps');
  denied(await f.call('findCandidates', query({ semantic: true, cursor: first.nextCursor })), 'cursor_stale');
});

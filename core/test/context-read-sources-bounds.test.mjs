import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { readTransaction } from '../database.mjs';
import { rankMoc } from '../context-read-moc.mjs';
import { sourceBudget, sourceStateBytes, SourceStop, chargedSourceDatabase } from '../context-read-relations.mjs';
import { sourcesFixture, ns, ok, sourceQuery } from '../testing/context-read-sources-fixture.mjs';
import { denied } from '../testing/context-read-core-fixture.mjs';

// Independent implementation of the documented accounting model.
function accounted(value) {
  if (typeof value === 'string') return 64 + value.length * 2;
  if (value instanceof Uint8Array) return 64 + value.byteLength;
  if (value === null || typeof value !== 'object') return 64;
  if (value instanceof Map) return 64 + [...value].reduce((n, [k, v]) => n + 64 + accounted(k) + accounted(v), 0);
  return 64 + Object.entries(value).reduce((n, [k, v]) => n + 64 + accounted(k) + accounted(v), 0);
}
test('C10 independent work/state instrumentation stops before a support batch grows past caps', t => {
  const f = sourcesFixture(t); const memory = f.admit('needle measured source'); f.topic(memory, 'needle measured topic');
  const db = new DatabaseSync(f.path, { readOnly: true }); t.after(() => db.close());
  const budget = sourceBudget(Infinity), charged = chargedSourceDatabase(db, budget), native = DatabaseSync.prototype.prepare;
  let actualLookups = 0, actualRecords = 0;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = native.call(this, sql), original = statement.get;
    statement.get = function (...args) { actualLookups++; const row = original.apply(this, args); actualRecords += Number(Boolean(row)); return row; };
    return statement;
  });
  readTransaction(db, () => {
    // A real authorized support record is charged once per repeated lookup.
    const statement = charged.prepare('SELECT id,revision FROM memories WHERE id=?');
    assert.throws(() => { for (let i = 0; i < 50000; i++) statement.get(memory.id); }, error => error instanceof SourceStop && error.reason === 'work_limit');
  });
  // Remove transaction helper PRAGMAs from the independent instrumented total.
  assert.ok(actualLookups <= 25000 + 4); assert.ok(actualRecords <= 25000 + 4);
  assert.equal(budget.stats().lookups + budget.stats().records, budget.stats().work);
  assert.ok(budget.stats().work + budget.stats().reservedWork <= 50000);
  const state = sourceBudget(Infinity), row = { ref: { namespace: ns, memoryId: memory.id, revision: memory.revision }, tokens: new Map([['needle', 2]]) };
  assert.equal(sourceStateBytes(row), accounted(row)); let size = 0;
  assert.throws(() => { while (true) { state.hold(accounted(row)); size += accounted(row); } }, error => error instanceof SourceStop && error.reason === 'state_limit');
  assert.equal(state.stats().stateBytes, size + 65536); assert.ok(size <= 8 * 1024 * 1024);
});
test('C10 optional deadline stop discards MOC and continues direct retrieval without fabricated complete-empty', async t => {
  const f = sourcesFixture(t); f.topic(f.admit('needle member'), 'needle title');
  ok(await f.find());
  const original = DatabaseSync.prototype.prepare, clock = performance.now.bind(performance); let expired = false, offset = 0;
  const descriptor = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => clock() + offset });
  t.after(() => { if (descriptor) Object.defineProperty(performance, 'now', descriptor); else delete performance.now; });
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = original.call(this, sql), get = statement.get;
    if (/SELECT id,revision,level,title FROM mocs/.test(sql)) statement.get = function (...args) { const row = get.apply(this, args); if (!expired) { expired = true; offset = 10000; } return row; };
    return statement;
  });
  const value = ok(await f.find()); assert.ok(value.items.length > 0); assert.equal(value.trace.sources['moc-v1'].complete, false);
  assert.deepEqual(value.trace.sources['moc-v1'].reasons, ['deadline']); assert.equal(value.trace.sources['moc-v1'].topicsMatched, null);
  assert.deepEqual(value.trace.sources['relations-one-hop-v1'].reasons, ['deadline']);
});
test('C10 retained occupancy through 128 rankings obeys 16 MiB and evicts oldest without renewing expiry', async t => {
  const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'] });
  const scope = { ownerId: 'o'.repeat(200), scope: 'project', projectId: 'p'.repeat(200) }; f.trusted.state.allowed.push(scope);
  const seeds = Array.from({ length: 24 }, (_, i) => f.admit('needle direct ' + i, scope));
  for (const seed of seeds.sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id))).slice(0, 4)) for (let i = 0; i < 2; i++) await f.relate(f.admit('Other endpoint ' + seed.id + i, scope), seed, 'supports-decision', scope);
  const originalSet = Map.prototype.set, originalDelete = Map.prototype.delete, retained = new Map(); let peak = 0, last = 0, evictions = 0;
  t.mock.method(Map.prototype, 'set', function (id, value) {
    const result = originalSet.call(this, id, value);
    if (value?.sourceBytes) {
      const independentlyAccounted = accounted({ items: value.items, sourceState: value.sourceState, sources: value.trace.sources });
      assert.equal(value.sourceBytes, independentlyAccounted);
      originalSet.call(retained, id, independentlyAccounted);
      assert.ok([...retained.values()].reduce((a, b) => a + b, 0) <= 16 * 1024 * 1024, 'budget holds even at Map insertion');
      assert.ok(retained.size <= 128);
    }
    return result;
  });
  t.mock.method(Map.prototype, 'delete', function (id) {
    if (retained.has(id)) { originalDelete.call(retained, id); evictions++; }
    return originalDelete.call(this, id);
  });
  let first;
  for (let i = 0; i < 130; i++) {
    const value = ok(await f.find({ readSet: [scope], query: 'needle variant' + i, limit: 1 })); first ??= value;
    last = [...retained.values()].reduce((a, b) => a + b, 0); peak = Math.max(peak, last);
    assert.ok(last <= 16 * 1024 * 1024); assert.ok(retained.size <= 128);
  }
  denied(await f.find({ readSet: [scope], query: 'needle variant0', limit: 1, cursor: first.nextCursor }), 'cursor_stale');
  assert.ok(evictions >= 2); console.log(JSON.stringify({ kind: 'retained_source_occupancy', peakBytes: peak, lastBytes: last, rankings: retained.size, evictions }));
});

test('C10 expanded-universe metering, omission algebra and 24-ref snapshot bound remain exact', async t => {
  const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'], counter: { id: 'synthetic-exact-bytes', countTokens: text => Buffer.byteLength(text) } });
  const direct = Array.from({ length: 24 }, (_, i) => f.admit('needle budget body ' + i));
  // Sixteen receipts per Memory through repeated public admissions. Do this
  // before authoring witnesses, since adding a receipt invalidates old edges.
  for (const m of direct) for (let i = 0; i < 4; i++) ok(f.core.admit({ namespace: ns, memory: { content: 'needle budget body ' + direct.indexOf(m), kind: 'fact' },
    receipts: Array.from({ length: 4 }, (_, j) => ({ client: 'synthetic', sessionId: 'receipts', eventId: m.id + '-' + i + '-' + j, role: 'user', excerpt: 'A canonical receipt ' + i + ' ' + j })) }));
  const current = direct.map(m => ok(f.core.get({ namespace: ns, memoryId: m.id })).memory).sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  for (const seed of current.slice(0, 4)) for (let i = 0; i < 2; i++) {
    const content = 'Other admitted body ' + seed.id + i, endpoint = f.admit(content);
    for (let batch = 0; batch < 4; batch++) ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts:
      Array.from({ length: 4 }, (_, j) => ({ client: 'synthetic', sessionId: 'addition-receipts', eventId: endpoint.id + '-' + batch + '-' + j,
        role: 'user', excerpt: 'Addition receipt ' + batch + ' ' + j })) }));
    await f.relate(ok(f.core.get({ namespace: ns, memoryId: endpoint.id })).memory, seed);
  }
  for (const maxTokens of [64, 256, 1500, 4000]) for (const id of ['rank-first-whole-v1', 'coverage-first-v1', 'rank-first-first-source-v1']) {
    const result = await f.assemble({ budget: { maxTokens, maxItems: 24 }, policy: { id } });
    if (!result.ok) { denied(result, 'context_item_too_large'); assert.equal(maxTokens, 64); continue; }
    const value = result.value, exactText = JSON.stringify({ ok: true, value: value.metered, evidenceTrust: 'untrusted-data-not-instructions' });
    assert.equal(value.diagnostics.budget.used, Buffer.byteLength(exactText)); assert.ok(value.diagnostics.budget.used <= maxTokens);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65536); assert.ok(value.metered.items.length <= 24);
    assert.equal(value.diagnostics.candidates.count, 32); assert.equal(value.diagnostics.omitted.bodies, 32 - value.metered.items.length);
    assert.equal(value.diagnostics.omitted.items, value.diagnostics.omitted.bodies); assert.ok(value.diagnostics.trace.counterCalls <= 1634);
    const represented = value.metered.items.reduce((sum, item) => sum + item.sources.length, 0);
    assert.equal(value.diagnostics.omitted.sources + represented, 512, '32 bodies × 16 capped sources gives the full 544-unit universe');
    if (value.snapshot) {
      assert.ok(value.snapshot.length <= 16384);
      const decoded = JSON.parse(Buffer.from(value.snapshot.split('.')[0], 'base64url'));
      assert.equal(decoded.refs.length, value.metered.items.length); assert.ok(decoded.refs.length <= 24);
      const fetched = await f.call('fetchCandidateEvidence', { readSet: [ns], snapshot: value.snapshot });
      if (fetched.ok) assert.equal(fetched.value.items.length, value.metered.items.length);
      else denied(fetched, 'context_item_too_large'); // Canonical provenance can exceed the independent fetch byte bound.
    }
  }
});

test('C10 a source deadline retains only a validated relation prefix with unknown remaining work', async t => {
  const f = sourcesFixture(t, { sources: ['relations-one-hop-v1'] }), seed = f.admit('needle direct');
  const endpoints = [f.admit('First endpoint'), f.admit('Second endpoint')].sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  for (const endpoint of endpoints) await f.relate(endpoint, seed);
  ok(await f.find({ sources: [] }));
  const originalPush = Array.prototype.push, descriptor = Object.getOwnPropertyDescriptor(performance, 'now'), now = performance.now.bind(performance); let offset = 0, stopped = false;
  Object.defineProperty(performance, 'now', { configurable: true, value: () => now() + offset });
  t.after(() => { if (descriptor) Object.defineProperty(performance, 'now', descriptor); else delete performance.now; });
  t.after(() => { Array.prototype.push = originalPush; });
  Array.prototype.push = function (...values) {
    const result = originalPush.apply(this, values);
    if (!stopped && values[0]?.ref?.memoryId === endpoints[0].id && values[0]?.via && Object.keys(values[0]).length === 2) { stopped = true; offset = 10000; }
    return result;
  };
  const result = ok(await f.find()); assert.equal(stopped, true);
  assert.deepEqual(result.items.map(i => i.ref.memoryId), [seed.id, endpoints[0].id]);
  const diagnostic = result.trace.sources['relations-one-hop-v1']; assert.deepEqual(diagnostic.reasons, ['deadline']);
  assert.equal(diagnostic.added, 1); assert.equal(diagnostic.remaining, null); assert.equal(diagnostic.examined, 2);
});

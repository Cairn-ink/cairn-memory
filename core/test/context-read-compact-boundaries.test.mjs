import test from 'node:test';
import assert from 'node:assert/strict';
import { assemblyFixture, assemblyQuery, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { openContextReader, openMemoryCore } from '../index.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { eventTimeFixture } from '../testing/receipt-event-time-fixture.mjs';
import { meteredText } from '../context-read-assembly.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
const representation = 'memory-compact-v1';
const request = patch => assemblyQuery({ representation, raw: false, ...patch });

for (const readOnly of [false, true]) test(`compact early refusal without SQL/authority/provider, readOnly=${readOnly}`, async t => {
  const f = assemblyFixture(t);
  let calls = 0;
  const config = { ...f.config, sources: ['relations-one-hop-v1'],
    embedder: { id: 'forbidden', revision: '1', dimensions: 2, normalization: 'l2', embed() { calls++; assert.fail('provider'); } } };
  const core = readOnly ? openContextReader({ path: f.path, contextRead: config }) : f.reopen(config);
  if (readOnly) t.after(() => core.close());
  for (const patch of [{ raw: undefined }, { raw: true }, { types: ['card'] }, { types: ['memory', 'card'] },
    { sources: ['relations-one-hop-v1'] }, { sources: undefined }]) {
    const input = request({ semantic: true, sources: [], ...patch });
    // undefined represents omitted input, rather than an invalid JS value.
    for (const key of Object.keys(input)) if (input[key] === undefined) delete input[key];
    const before = f.trusted.state.requests.length;
    const measured = await measureContentRead('contextRead', 'compact-invalid', () => f.trusted.call(core, 'contextRead', input));
    assert.deepEqual(measured.result, { ok: false, error: { code: 'invalid_input', retryable: false } });
    assert.equal(measured.statements, 0); assert.equal(calls, 0);
    assert.equal(f.trusted.state.requests.length, before);
  }
});

for (const readOnly of [false, true]) test(`compact canonical read, positional fetch and unchanged v1 snapshot, readOnly=${readOnly}`, async t => {
  const f = assemblyFixture(t, { counter: { id: 'fit', countTokens: () => 1 } });
  for (let i = 0; i < 24; i++) f.admit('assembly telescope whole body ' + i);
  const built = ok(await f.call('refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  assert.equal(built.status, 'complete');
  const core = readOnly ? openContextReader({ path: f.path, contextRead: { ...f.config, counter: { id: 'fit', countTokens: () => 1 } } }) : f.context;
  if (readOnly) t.after(() => core.close());
  const value = ok(await f.trusted.call(core, 'contextRead', request()));
  assert.equal(value.metered.items.length, 24);
  assert.ok(value.metered.items.every(item => item.date === null && Object.keys(item).join(',') === 'date,body'));
  const snapshot = JSON.parse(Buffer.from(value.snapshot.split('.')[0], 'base64url'));
  assert.equal(snapshot.v, 1); assert.equal(snapshot.refs.length, 24);
  const refs = value.diagnostics.items.map(item => item.ref);
  const canonical = ok(await f.trusted.call(core, 'fetchCandidateEvidence', { readSet: [ns], refs, intent: 'current' }));
  assert.deepEqual(canonical.items.map(item => item.content), value.metered.items.map(item => item.body));
  assert.deepEqual(ok(await f.trusted.call(core, 'fetchCandidateEvidence', { readSet: [ns], snapshot: value.snapshot })), canonical);
  const legacy = ok(await f.trusted.call(core, 'contextRead', request({ representation: 'representation-v2-dated' })));
  assert.equal(value.snapshot, legacy.snapshot);
  assert.equal(value.diagnostics.budget.used, 1);
  assert.equal(value.diagnostics.omitted.sources, 24);
});

test('compact uses receipt event dates on embedded and read-only paths; snapshot remains v1', async t => {
  const f = await eventTimeFixture(t), trusted = host();
  const counter = { id: 'bytes', countTokens: text => Buffer.byteLength(text) };
  const config = { version: 'context-read-v1', authority: trusted.authority, counter };
  const writer = openMemoryCore({ path: f.path, contextRead: config }); t.after(() => writer.close());
  for (const [id, occurredAt] of [['late', '2026-03-01T08:00:00.000Z'], ['early', '2026-01-01T08:00:00.000Z'], ['unknown', null]])
    ok(writer.admit({ namespace: ns, memory: { content: 'assembly telescope ' + id, kind: 'fact' }, receipts: [
      { client: 'synthetic', sessionId: 'compact', eventId: id, role: 'user', excerpt: 'source ' + id, ...(occurredAt ? { occurredAt } : {}) }] }));
  ok(await trusted.call(writer, 'refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  const reader = openContextReader({ path: f.path, contextRead: config }); t.after(() => reader.close());
  for (const core of [writer, reader]) {
    const compact = ok(await trusted.call(core, 'contextRead', request()));
    const dated = ok(await trusted.call(core, 'contextRead', request({ representation: 'representation-v2-dated' })));
    assert.deepEqual(compact.metered.items, dated.metered.items.map(item => ({ date: item.date ?? null, body: item.body })));
    assert.deepEqual(compact.metered.items.map(item => item.date), ['2026-01-01T08:00Z', '2026-03-01T08:00Z', null]);
    assert.equal(compact.diagnostics.budget.used, counter.countTokens(meteredText(compact.metered)));
    assert.equal(compact.snapshot, dated.snapshot);
  }
});

test('product rejects compact before SQL, authority, semantic snapshot or counter; capabilities stay legacy', async t => {
  const f = assemblyFixture(t), facade = openContextProductFacade(f.path, {}); t.after(() => facade.close());
  const forbidden = () => assert.fail('compact must refuse before host/provider work');
  const product = openProductIndex({ path: f.path, facade, maintenance: true, authorize: forbidden,
    ownerCoverage: { omittedNamespaces: 0 }, counter: { id: 'forbidden', countTokens: forbidden },
    semantic: { snapshot: forbidden, call: forbidden } });
  t.after(() => product.close());
  assert.deepEqual(product.assembly.representations, ['representation-v2', 'representation-v2-dated']);
  for (const semantic of [false, true]) {
    const measured = await measureContentRead('contextRead', 'compact-product', () => product.run('contextRead', request({ semantic })));
    assert.deepEqual(measured.result, { ok: false, error: { code: 'invalid_input', retryable: false } });
    assert.equal(measured.statements, 0);
  }
});

test('compact snapshot overflow returns null while keeping all selected refs in diagnostics', async t => {
  const f = assemblyFixture(t, { counter: { id: 'fit', countTokens: () => 1 } });
  // IDs are valid 200-unit identifiers whose UTF-8 snapshot bytes exceed 16,384.
  // Fixture-only rename before indexing; no SQLite descriptors escape the engine.
  for (let i = 0; i < 24; i++) {
    const memory = f.admit('assembly telescope long-id body ' + i), id = '界'.repeat(195) + String(i).padStart(5, '0');
    f.writer.exec('BEGIN');
    try {
      f.writer.exec('PRAGMA defer_foreign_keys=ON');
      f.writer.prepare('UPDATE memories SET id=? WHERE id=?').run(id, memory.id);
      f.writer.prepare('UPDATE receipts SET memory_id=? WHERE memory_id=?').run(id, memory.id);
      f.writer.exec('COMMIT');
    } catch (error) { f.writer.exec('ROLLBACK'); throw error; }
  }
  ok(await f.call('refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } }));
  const value = ok(await f.call('contextRead', request()));
  assert.equal(value.metered.items.length, 24);
  assert.equal(value.diagnostics.items.length, 24);
  assert.equal(value.snapshot, null);
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value })) <= 65536);
});

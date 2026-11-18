import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assembleContext, meteredText, resolveMemorySourceDates } from '../context-read-assembly.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { contextInput, ASSEMBLY_LIMITS, ASSEMBLY_POLICIES, ASSEMBLY_REPRESENTATIONS } from '../context-read-input.mjs';
import { createContextCounter } from '../../adapters/openai/context-counter.mjs';
import { compactRepresentation as representation, compactRequest, compactPrepared, compactAssemblyOptions, legacyCases } from '../testing/context-read-compact-fixture.mjs';
const bytes = JSON.parse(readFileSync(new URL('./fixtures/context-read/compact-s01-bytes.json', import.meta.url)));
const parse = (patch = {}, sources, profile) => contextInput('contextRead', compactRequest(patch), ['memory', 'card'], sources, profile).input;
const assemble = patch => assembleContext(compactAssemblyOptions({ representation, ...patch }));

test('compact parser requires Memory only, explicit raw:false and no extra sources; ceiling is 64', () => {
  assert.deepEqual(ASSEMBLY_REPRESENTATIONS, ['representation-v2', 'representation-v2-dated']);
  assert.ok(Object.isFrozen(ASSEMBLY_REPRESENTATIONS));
  assert.equal(parse().representation, representation);
  assert.deepEqual(parse().budget, { maxTokens: 6000, maxItems: 64 });
  assert.equal(ASSEMBLY_LIMITS.counterCalls, 1226);
  for (const patch of [{ types: ['card'] }, { types: ['card', 'memory'] }, { raw: true }, { raw: undefined },
    { budget: { maxItems: 0 } }, { budget: { maxItems: 65 } }, { budget: { maxItems: 1.5 } }, { surprise: true }])
    assert.throws(() => parse(patch), { code: 'invalid_input' });
  for (const sources of [['relations-one-hop-v1'], ['moc-v1'], ['relations-one-hop-v1', 'moc-v1']]) {
    assert.throws(() => parse({}, sources), { code: 'invalid_input' });
    assert.throws(() => parse({ sources }, sources), { code: 'invalid_input' });
    assert.deepEqual(parse({ sources: [] }, sources).sources, []);
  }
  assert.throws(() => parse({}, undefined, 'context-read-product-v1.1'), { code: 'invalid_input' });
  const { representation: _representation, ...defaultRequest } = compactRequest();
  assert.equal(contextInput('contextRead', defaultRequest, ['memory']).input.representation, 'representation-v2-dated');
  const { raw: _raw, ...implicitRawDefault } = defaultRequest;
  assert.equal(contextInput('contextRead', implicitRawDefault, ['memory']).input.raw, true);
  for (const representation of ASSEMBLY_REPRESENTATIONS)
    assert.equal(contextInput('contextRead', { ...implicitRawDefault, representation }, ['memory']).input.representation, representation);
  assert.throws(() => contextInput('findCandidates', compactRequest(), ['memory']), { code: 'invalid_input' });
});

test('real o200k metering counts exact compact engine success text at the token boundary', async () => {
  const counter = await createContextCounter(), options = compactAssemblyOptions({ representation, counter });
  const value = assembleContext(options), text = meteredText(value.metered);
  assert.equal(counter.id, 'tiktoken-o200k_base');
  const used = counter.countTokens(text);
  assert.equal(value.diagnostics.budget.used, used);
  const exact = assembleContext({ ...options, budget: { maxTokens: used, maxItems: 24 } });
  assert.deepEqual(exact.metered, value.metered);
  const smaller = assembleContext({ ...options, budget: { maxTokens: used - 1, maxItems: 24 } });
  assert.ok(smaller.metered.items.length < value.metered.items.length);
});

test('exact date/body wire bytes, full bodies and positional diagnostics across every policy', () => {
  for (const id of ASSEMBLY_POLICIES) {
    const counted = [], counter = { id: 'bytes', countTokens(text) { counted.push(text); return Buffer.byteLength(text); } };
    const result = assemble({ policy: { id }, counter });
    assert.equal(meteredText(result.metered), bytes.compactText);
    assert.deepEqual(result.metered.items.map(item => Object.keys(item)), Array(4).fill(['date', 'body']));
    assert.deepEqual(result.diagnostics.items.map(item => item.ref.memoryId), ['earlier', 'equal', 'later', 'unknown']);
    result.diagnostics.items.forEach((detail, index) => {
      const canonical = compactPrepared().find(item => item.ref.memoryId === detail.ref.memoryId);
      assert.equal(result.metered.items[index].body, canonical.text);
      assert.deepEqual(detail.metadata, canonical.metadata);
      assert.equal(detail.fence, canonical.fence);
      assert.equal(detail.f, canonical.fence.slice(0, 8));
      assert.equal(detail.sourceAccess, canonical.sourceAccess);
      assert.equal(detail.sourcesComplete, canonical.sourcesComplete);
      assert.deepEqual(detail.sources, []);
    });
    assert.equal(result.diagnostics.policy.id, id);
    assert.equal(result.diagnostics.budget.used, Buffer.byteLength(bytes.compactText));
    assert.equal(counted.at(-1), bytes.compactText);
    assert.ok(!counted.some(text => text.startsWith('Source prose') || text === 'Shared source prose'));
    assert.equal(result.diagnostics.omitted.sources, 8);
    assert.deepEqual(result.diagnostics.dedup, { sources: 0, body: 0 });
    assert.deepEqual(result.diagnostics.stops, { budget: false, items: false, deadline: false });
    assert.equal(result.diagnostics.trace.counterCalls, 10);
  }
});

test('relevance selection, whole-body rejection, source accounting and exact budget boundary', () => {
  const full = assemble(), exact = full.diagnostics.budget.used;
  assert.deepEqual(assemble({ budget: { maxTokens: exact, maxItems: 24 } }).metered, full.metered);
  const short = assemble({ budget: { maxTokens: exact - 1, maxItems: 24 } });
  assert.equal(short.metered.items.length, 3);
  assert.equal(short.diagnostics.budget.used, Buffer.byteLength(meteredText(short.metered)));
  const first = assemble({ budget: { maxTokens: 6000, maxItems: 2 } });
  assert.deepEqual(first.diagnostics.items.map(item => item.ref.memoryId), ['later', 'unknown']);
  assert.equal(first.diagnostics.omitted.sources, compactPrepared().reduce((n, item) => n + item.sources.length, 0));
  const prepared = compactPrepared(); prepared[0].text = '界'.repeat(6000);
  const oversize = assemble({ prepared });
  assert.equal(oversize.metered.items.length, 3);
  assert.ok(!oversize.diagnostics.items.some(item => item.ref.memoryId === 'later'));
  assert.equal(oversize.diagnostics.omitted.oversized, 1);
  assert.equal(oversize.diagnostics.stops.budget, true);
});

test('date uses only existing authorized resolution, preserving receipt date and Raw ordering', () => {
  const prepared = compactPrepared().slice(0, 2);
  prepared[0].date = '2025-01-01T08:00Z';
  prepared[1].date = null;
  let statements = 0;
  const db = { isTransaction: true, prepare(sql) {
    statements++; assert.match(sql, /LIMIT 4097/);
    return { all() { return [{ id: 'receipt-0', occurred_at: '2026-01-01T08:00:00.000Z' },
      { id: 'receipt-1', occurred_at: '2024-01-01T08:00:00.000Z' }]; } };
  } };
  prepared.forEach(item => { item.sources = item.sources.slice(0, 1); item.created_at = '1900-01-01'; });
  assert.equal(resolveMemorySourceDates(db, prepared.map((item, i) => ({ item, rows: [{ id: 'receipt-' + i, source_time_available: 1 }] })), Infinity), true);
  const result = assemble({ prepared });
  assert.equal(statements, 1);
  assert.deepEqual(result.metered.items.map(item => item.date), ['2024-01-01T08:00Z', '2025-01-01T08:00Z']);
  assert.doesNotMatch(meteredText(result.metered), /1900/);
  const unknown = compactPrepared().slice(1, 2); unknown[0].created_at = '1900-01-01';
  assert.equal(assemble({ prepared: unknown }).metered.items[0].date, null);
});

test('compact trials reserve complete envelope bytes, and counters remain exact for nonadditive/zero/invalid ports', () => {
  let trials = 0;
  const result = assemble({ responseBytes({ selected, diagnostics }) {
    trials++; assert.ok(diagnostics.items.every(item => item.fence)); return selected.length <= 2;
  } });
  assert.ok(trials > 2); assert.equal(result.metered.items.length, 2);
  for (const countTokens of [() => 0, text => text.includes('"ok":true') ? 127 : 1]) {
    const next = assemble({ counter: { id: 'nonadditive', countTokens } });
    assert.equal(next.diagnostics.budget.used, countTokens(meteredText(next.metered)));
  }
  for (const countTokens of [() => -1, () => NaN, () => Promise.resolve(1), () => { throw Error('counter'); }])
    assert.throws(() => assemble({ counter: { id: 'invalid', countTokens } }), { code: 'token_count_unavailable' });
});

test('pre-change fixture pins every legacy representation/policy and default: exact text, result and counter inputs', () => {
  for (const { name, ...patch } of legacyCases) {
    const { representation: _compact, ...request } = compactRequest();
    const { input } = contextInput('contextRead', { ...request, ...patch }, ['memory']);
    const calls = [], args = compactAssemblyOptions({ ...patch, representation: input.representation,
      counter: { id: 'compact-utf8', countTokens(text) { calls.push(text); return Buffer.byteLength(text); } } });
    const { selected, validateRaw, ...result } = assembleThreeLayerContext(args);
    const baseline = bytes.rows.find(row => row.name === name);
    assert.equal(meteredText(result.metered), baseline.text, name);
    assert.equal(JSON.stringify(result), JSON.stringify(baseline.result), name);
    assert.deepEqual(calls, baseline.calls, name);
    assemble(); // Interleaving compact must leave no shared projection state.
  }
});

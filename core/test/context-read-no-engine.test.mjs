import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assembleContext, ASSEMBLY_FRAMING, completeResponseBytes, meteredText, receiptEventDate, receiptSourceRows } from '../context-read-assembly.mjs';
import { ASSEMBLY_DEFAULTS, ASSEMBLY_LIMITS, CONTEXT_LIMITS, contextInput, namespaceKey } from '../context-read-input.mjs';
import { assembleThreeLayerContext, citedRawTurns } from '../context-read-three-layer.mjs';
import { deepFreeze } from '../private-card-input.mjs';
import { fail, MemoryStoreError } from '../validation.mjs';

const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const policies = ['rank-first-whole-v1', 'rank-first-first-source-v1', 'coverage-first-v1'];
const definitions = [
  { id: 'later', text: 'Synthetic later body', date: '2024-01-01T00:00:00.000Z' },
  { id: 'earlier', text: 'Synthetic earlier body', date: '2023-01-01T00:00:00.000Z' },
];
const expectedText = metered => JSON.stringify({ ok: true, value: metered, evidenceTrust: 'untrusted-data-not-instructions' });
const bind = (_purpose, value) => createHash('sha256').update(JSON.stringify(value)).digest('base64url');

function inputs() {
  const canonical = definitions.map(({ id, text }) => {
    const metadata = { ...ASSEMBLY_DEFAULTS.metadata.memory };
    delete metadata.origin; // Existing byte-boundary ports need not supply it.
    return { type: 'memory', ref: { type: 'memory', namespace, memoryId: id, revision: 1 },
      ...metadata, content: text, provenance: { sourceAccess: 'available',
        receiptMetadata: [{ receiptId: id }], coverage: { status: 'complete' } } };
  });
  const rows = new Map(definitions.map(({ id, date }) => [id, [{ id, role: 'user', excerpt: 'Shared synthetic receipt', occurred_at: date }]]));
  const prepared = canonical.map((item, i) => ({ type: 'memory', ref: item.ref, ns: 0, rank: i + 1,
    metadata: { state: item.state, reviewState: item.reviewState, filing: item.filing,
      kind: item.kind, origin: item.origin, confidence: item.confidence }, text: item.content,
    date: definitions[i].date.slice(0, 16) + 'Z', sources: [{ index: 0, role: 'user', excerpt: 'Shared synthetic receipt' }],
    sourceAccess: 'available', sourcesComplete: true, fence: bind('snapshot-item', item.ref) }));
  return { canonical, rows, prepared };
}
function port() {
  const calls = [];
  return { calls, counter: { id: 'synthetic-bytes', countTokens(text) { calls.push(text); return Buffer.byteLength(text); } } };
}
function expectedWire(prepared, representation, maxItems) {
  const ordered = prepared.slice(0, maxItems);
  if (representation === 'representation-v2-dated') ordered.sort((a, b) => a.date.localeCompare(b.date));
  return { framing: ASSEMBLY_FRAMING, items: ordered.map((item, i) => ({
    ref: { ns: 0, type: 'memory', id: item.ref.memoryId, rev: 1, f: item.fence.slice(0, 8) }, rank: item.rank,
    ...(representation === 'representation-v2-dated' ? { date: item.date } : {}), body: item.text, metadata: {},
    sources: i ? [{ index: 0, sameAs: { item: 0, source: 0 } }] : [{ index: 0, role: 'user', excerpt: 'Shared synthetic receipt' }],
  })) };
}

// Like the dated byte-boundary tests, run the production enclosing functions
// with deterministic I/O. A memory-only read needs no engine Card helper port.
function reader(kind, canonical, rows, counter) {
  const candidates = { items: canonical.map((item, i) => ({ ref: item.ref, rank: i + 1 })),
    channels: {}, coverage: {}, trace: {}, observed: { publication: {} } };
  const access = { accessGenerations: 'synthetic', check() {} };
  let assemblies = 0;
  const dependencies = { counter, options: { counter }, supportedTypes: ['memory'],
    performance: { now: () => 0 }, ready() {}, contextInput, authorize: () => access,
    searchCandidates: async () => ({ ok: true, horizon: candidates, check() {} }), read: work => work(),
    canonicalFence: () => [{ memory: 1 }], cachedContentLayout: () => null,
    db: { prepare: () => ({ all: id => rows.get(id) }) },
    evidence: { itemsInside: (_ns, refs) => refs.map(ref => canonical.find(item => item.ref.memoryId === ref.memoryId)) },
    namespaceKey, receiptEventDate, receiptSourceRows, resolveMemorySourceDates: () => true, validateSourceReceipt: (_id, row) => row, createHash,
    citedRawTurns, cardLineageItemInside: (_db, item) => item.ref, bind,
    encode: (_purpose, value) => JSON.stringify(value), ASSEMBLY_LIMITS, CONTEXT_LIMITS,
    assembleThreeLayerContext(args, raw) { assemblies++; return assembleThreeLayerContext({ ...args, now: () => 0 }, raw); },
    completeResponseBytes, success: value => ({ ok: true, value }),
    failure: error => { throw error; }, MemoryStoreError, fail, deepFreeze,
    same: (a, b) => JSON.stringify(a) === JSON.stringify(b), bytes: value => Buffer.byteLength(JSON.stringify(value)),
    final: (_p, _access, _publication, work, _code, prepare) => { prepare(); return work(); } };
  const source = readFileSync(new URL(kind === 'product' ? '../context-product-index.mjs' : '../context-read-facade.mjs', import.meta.url), 'utf8');
  const start = kind === 'product' ? '  function assemble(' : '  async function contextRead(';
  const end = kind === 'product' ? '  function metadataRead(' : '  function fetchCandidateEvidence(';
  const implementation = source.slice(source.indexOf(start), source.indexOf(end));
  assert.ok(implementation.startsWith(start));
  const run = new Function(...Object.keys(dependencies), 'return (' + implementation + ');')(...Object.values(dependencies));
  return { get assemblies() { return assemblies; }, run: input => { const { deadlineAt, ...original } = input; return kind === 'product' ? run(input, access, candidates) : run(original); } };
}

for (const kind of ['product', 'facade']) test(`${kind}: memory-only preparation preserves legacy assembly without a tokenizer`, async () => {
  for (const policy of policies) for (const representation of ['representation-v2', 'representation-v2-dated']) for (const maxItems of [1, 2]) {
    const { canonical, rows, prepared } = inputs(), direct = port(), enclosing = port();
    const input = { readSet: [namespace], types: ['memory'], intent: 'current', query: 'synthetic',
      deadlineMs: 5000, deadlineAt: Infinity, budget: { maxTokens: 4000, maxItems }, policy: { id: policy }, representation };
    const expected = expectedText(expectedWire(prepared, representation, maxItems));
    const assembled = assembleContext({ ...input, prepared, counter: direct.counter, now: () => 0, snapshotOf: () => null });
    assert.equal(meteredText(assembled.metered), expected);
    assert.deepEqual(assembled.selected, prepared.slice(0, maxItems));
    assert.equal(assembled.diagnostics.budget.used, Buffer.byteLength(expected));
    assert.equal(assembled.diagnostics.trace.counterCalls, 2 + 4 * maxItems);
    assert.equal(direct.calls.length, 2 + 4 * maxItems);
    const scheduled = policy === 'coverage-first-v1'
      ? [...prepared.slice(0, maxItems).map(item => item.text), ...prepared.slice(0, maxItems).map(() => 'Shared synthetic receipt')]
      : prepared.slice(0, maxItems).flatMap(item => [item.text, 'Shared synthetic receipt']);
    assert.deepEqual(direct.calls.slice(1, -1).filter((_text, i) => i % 2 === 0), scheduled);
    assert.equal(direct.calls.at(-1), expected);
    const r = reader(kind, canonical, rows, enclosing.counter), actual = await r.run(input);
    assert.equal(actual.ok, true);
    assert.equal(r.assemblies, 1);
    assert.equal(meteredText(actual.value.metered), expected);
    assert.deepEqual(enclosing.calls, direct.calls, 'reader preparation preserves every counter input and call');
    assert.equal(actual.value.diagnostics.trace.counterCalls, direct.calls.length);
    const { selected, ...expectedValue } = assembled;
    expectedValue.snapshot = JSON.stringify({ v: 1, scope: bind('snapshot-scope', [namespace]), intent: 'current',
      refs: selected.map(item => [0, 'memory', item.ref.memoryId, 1]), generations: [{ memory: 1 }],
      access: 'synthetic', fences: selected.map(item => item.fence) });
    expectedValue.diagnostics.coverage = { raw: 'unavailable' };
    expectedValue.diagnostics.candidates = { count: 2, channels: {}, coverage: {}, trace: {} };
    assert.equal(JSON.stringify(actual), JSON.stringify({ ok: true, value: expectedValue }), 'complete response bytes');
    const refused = { ...input, budget: { maxTokens: 64, maxItems } };
    assert.throws(() => assembleContext({ ...refused, prepared, counter: direct.counter, now: () => 0, snapshotOf: () => null }), { code: 'context_item_too_large' });
    await assert.rejects(async () => r.run(refused), { code: 'context_item_too_large' });
  }
});

// Legacy assembly only needs the numeric namespace slot for its wire refs;
// full source identities belong to engine Card de-duplication.
test('memory-only assembly does not require engine source identities', () => {
  for (const policy of policies) for (const representation of ['representation-v2', 'representation-v2-dated']) {
    const { prepared } = inputs();
    for (const item of prepared) {
      const { namespace: _namespace, ...ref } = item.ref;
      item.ref = ref;
    }
    const { calls, counter } = port();
    const result = assembleContext({ prepared, counter, policy: { id: policy }, representation,
      budget: { maxTokens: 4000, maxItems: 2 }, deadlineAt: Infinity, now: () => 0, snapshotOf: () => null });
    assert.equal(meteredText(result.metered), expectedText(expectedWire(prepared, representation, 2)));
    assert.equal(result.diagnostics.trace.counterCalls, 10);
    assert.equal(calls.length, 10);
  }
});

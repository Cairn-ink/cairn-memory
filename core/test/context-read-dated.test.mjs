import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { chmodSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assembleContext, meteredText, receiptEventDate, completeResponseBytes } from '../context-read-assembly.mjs';
import { ASSEMBLY_REPRESENTATIONS, ASSEMBLY_LIMITS, ASSEMBLY_DEFAULTS, CONTEXT_LIMITS, contextInput, namespaceKey } from '../context-read-input.mjs';
import { assemblyQuery, fixedPrepared, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { host, receipt } from '../testing/context-read-core-fixture.mjs';
import { openMemoryCore, openContextReader } from '../index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { drain } from '../testing/context-read-fixture.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { roleEvidence } from '../role-context-evidence.mjs';
import { readTransaction, transaction } from '../database.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { migrateEventTime } from '../testing/receipt-event-time-fixture.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { savedSource, cardHost } from '../testing/raw-source-fixtures.mjs';

import { optionalRoleCounter } from './role-fixture.mjs';
import { validateSourceReceipt } from '../source-evidence.mjs';
import { MemoryStoreError, fail } from '../validation.mjs';
import { deepFreeze } from '../private-card-input.mjs';

const dated = 'representation-v2-dated';
const counter = { id: 'synthetic-all-fit', countTokens: () => 1 };
const request = (namespace = ns, patch = {}) => assemblyQuery({ readSet: [namespace], budget: { maxTokens: 4000, maxItems: 24 }, ...patch });

async function datedFixture(t, { eventTime = true, base = 18 } = {}) {
  const f = safetyFixture(t, base);
  if (eventTime) await migrateEventTime(f);
  const core = openMemoryCore({ path: f.path }), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, eventTime ? { 18: 51, 23: 52, 33: 53 }[base] : base);
  assert.equal(db.prepare('PRAGMA table_info(receipts)').all().some(row => row.name === 'occurred_at'), eventTime);
  return { ...f, core, context: core, db };
}
function seed(t, f, definitions) {
  // Admit each receipt through the public contract. Distinct admission clocks
  // make the physical LIMIT 16 window deterministic without rewriting SQL times.
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse('2026-01-01T00:00:00.000Z') });
  try {
    return definitions.map(definition => {
      let memory;
      for (const source of definition.receipts) {
        memory = ok(f.core.admit({ namespace: ns, memory: { content: definition.input, kind: 'fact' }, receipts: [source] })).memory;
        t.mock.timers.tick(1);
      }
      return { definition, namespace: ns, memory };
    });
  } finally { t.mock.timers.reset(); }
}
function readers(t, f, namespace = ns) {
  const trusted = host(); trusted.state.allowed = [namespace];
  const context = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority: trusted.authority, counter } });
  t.after(() => context.close());
  const readOnly = openContextReader({ path: f.path, contextRead: { version: 'context-read-v1', authority: trusted.authority, counter } });
  t.after(() => readOnly.close());
  const facade = openContextProductFacade(f.path, {}); t.after(() => facade.close());
  const product = openProductIndex({ path: f.path, facade, maintenance: true, counter,
    authorize: () => ({ accessGenerations: accessDigest({ ownerId: namespace.ownerId, namespaces: { readSet: [namespace] } }), check() {}, envelope: work => work() }),
    ownerCoverage: { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 } });
  t.after(() => product.close());
  const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const role = roleEvidence({ db: f.db, identity, ready() {} }, { path: f.path });
  return { context, readOnly, product, role,
    facadeRead: input => trusted.call(context, 'contextRead', input),
    readOnlyRead: input => trusted.call(readOnly, 'contextRead', input),
    async build(intent = 'current', types = ['memory']) {
      const p = { readSet: [namespace], types, intent, budget: { maxItems: 1024, maxMs: 5000 } };
      for (let i = 0; i < 100; i++) if (ok(await trusted.call(context, 'refreshContextIndex', p)).status === 'complete') break;
      this.buildProduct(intent, types);
    },
    buildProduct(intent = 'current', types = ['memory']) {
      const p = { readSet: [namespace], types, intent, budget: { maxItems: 1024, maxMs: 5000 } };
      for (let i = 0; i < 100; i++) if (ok(product.run('refreshContextIndex', { ...p, mode: 'lexical' })).status === 'complete') return;
      assert.fail('test index did not finish');
    },
  };
}
function roleAssembly(f, r, refs, namespace = ns, intent = 'current') {
  const prepared = readTransaction(f.db, () => refs.map((ref, i) => r.role.item(ref, [namespace], i + 1, intent)));
  return assembleContext({ prepared: prepared.map(item => ({ ...item, sourcesComplete: item.canonicalSourcesComplete })),
    representation: dated, counter, policy: { id: 'rank-first-whole-v1' }, budget: { maxTokens: 4000, maxItems: 24 }, deadlineAt: Infinity, snapshotOf: () => null });
}
const ref = (memory, namespace = ns) => ({ type: 'memory', namespace, memoryId: memory.id, revision: memory.revision });
function expandedItems(metered) {
  return metered.items.map(item => ({ ...item, sources: item.sources.map(source => {
    const concrete = source.sameAs ? metered.items[source.sameAs.item].sources[source.sameAs.source] : source;
    assert.equal(concrete.sameAs, undefined, 'aliases point directly to a concrete source');
    return { index: source.index, role: concrete.role, excerpt: concrete.sameAsBody ? item.body : concrete.excerpt };
  }) })).sort((a, b) => a.rank - b.rank);
}
function onlyDateDiff(v2, next, expected) {
  assert.equal(next.diagnostics.representation, dated);
  assert.equal(next.diagnostics.trace.counterCalls, v2.diagnostics.trace.counterCalls);
  assert.equal(next.snapshot, v2.snapshot, 'full fence and snapshot bytes stay identical');
  const stripped = structuredClone(next.metered);
  for (const item of stripped.items) delete item.date;
  assert.deepEqual(expandedItems(stripped), expandedItems(v2.metered));
  if (!expected.size) assert.equal(meteredText(next.metered), meteredText(v2.metered), 'date-free layouts keep exact v2 bytes and order');
  for (const item of next.metered.items) {
    assert.equal(item.date, expected.get(item.ref.id));
    if (item.date) assert.deepEqual(Object.keys(item).slice(0, 4), ['ref', 'rank', 'date', 'body']);
    const previous = v2.metered.items.find(value => value.ref.id === item.ref.id);
    assert.equal(JSON.stringify(item.ref), JSON.stringify(previous.ref));
    // Independently strict {ns,type,id,rev,f} grammar for a copied Memory ref.
    const copied = JSON.parse(JSON.stringify(item.ref));
    assert.deepEqual(Object.keys(copied).sort(), ['f', 'id', 'ns', 'rev', 'type']);
    assert.ok(Number.isSafeInteger(copied.ns) && copied.ns >= 0);
    assert.equal(copied.type, 'memory'); assert.equal(typeof copied.id, 'string');
    assert.ok(Number.isSafeInteger(copied.rev) && copied.rev >= 1);
    assert.match(copied.f, /^[A-Za-z0-9_-]{8}$/);
  }
  assert.equal(JSON.stringify(next).includes('occurred_at'), false);
  assert.equal(JSON.stringify(next.diagnostics).includes('2023-'), false, 'times appear only in date');
}

test('dated input is opt-in, strict and contextRead-only; helper omits missing/null and truncates UTC', () => {
  const parse = patch => contextInput('contextRead', request(ns, patch), ['memory']);
  assert.equal(parse({}).input.representation, 'representation-v2');
  for (const representation of ASSEMBLY_REPRESENTATIONS) assert.equal(parse({ representation }).input.representation, representation);
  for (const representation of ['candidate-text-v1', 'representation-v3', '', null, 1, {}, []]) assert.throws(() => parse({ representation }), { code: 'invalid_input' });
  assert.throws(() => contextInput('findCandidates', { ...request(), representation: dated }, ['memory']), { code: 'invalid_input' });
  assert.equal(receiptEventDate([{}, { occurred_at: null }]), null);
  assert.equal(receiptEventDate([{ occurred_at: '2023-05-22T05:55:00.000Z' }, {}, { occurred_at: '2023-05-22T05:54:59.999Z' }]), '2023-05-22T05:54Z');
  assert.equal(ASSEMBLY_LIMITS.counterCalls, 1226);
});

test('frozen v2 projection ignores prepared dates; Card never gets a date; per-visit counter schedule is unchanged', () => {
  const prepared = fixedPrepared().slice(0, 3), options = { prepared, counter, policy: { id: 'rank-first-whole-v1' },
    budget: { maxTokens: 4000, maxItems: 24 }, deadlineAt: Infinity, snapshotOf: () => 'fixed' };
  const baseline = assembleContext(options);
  assert.equal(createHash('sha256').update(meteredText(baseline.metered)).digest('hex'),
    '1295ace17029968104c85567c2b1d56297eb9337f2decfa94b616282d523f637', 'frozen pre-ordering v2 bytes');
  for (const item of prepared) item.date = '2023-05-22T05:54Z';
  assert.equal(meteredText(assembleContext(options).metered), meteredText(baseline.metered));
  onlyDateDiff(baseline, assembleContext({ ...options, representation: dated }), new Map(prepared.map(item => [item.ref.memoryId, item.date])));
  const card = { ...prepared[0], type: 'card', ref: { ...prepared[0].ref, memoryId: undefined, cardId: 'card', bodyRevision: 1 }, metadata: { state: 'confirmed', support: {}, origin: {} }, sourceAccess: 'unsupported' };
  assert.equal(assembleContext({ ...options, prepared: [card], representation: dated }).metered.items[0].date, undefined);
});

test('dated emission sorts dates stably, leaves undated memories/cards after, and preserves relevance selection and ranks', () => {
  const dates = ['2024-01-01T00:00Z', null, '2022-01-01T00:00Z', '2022-01-01T00:00Z', null, '2021-01-01T00:00Z'];
  const prepared = dates.map((date, index) => ({ ...structuredClone(fixedPrepared()[0]),
    ref: { ...fixedPrepared()[0].ref, memoryId: 'ordered-' + index }, rank: index + 1,
    text: 'Synthetic ordered body ' + index, date,
    sources: [{ index: 7, role: 'user', excerpt: 'Shared synthetic receipt' }] }));
  prepared[2].sources = [{ index: 4, role: 'user', excerpt: 'Unique synthetic receipt' },
    { index: 9, role: 'user', excerpt: 'Shared synthetic receipt' }];
  prepared[5].sources = [{ index: 3, role: 'user', excerpt: 'Earliest synthetic receipt' }];
  prepared[4] = { ...prepared[4], type: 'card', date: '1970-01-01T00:00Z',
    ref: { ...prepared[4].ref, memoryId: undefined, cardId: 'ordered-card', bodyRevision: 1 },
    metadata: { state: 'confirmed', support: {}, origin: {} }, sourceAccess: 'unsupported', sources: [] };
  for (const id of ['rank-first-whole-v1', 'rank-first-first-source-v1', 'coverage-first-v1']) {
    for (const maxItems of [4, 6]) {
      const options = { prepared, counter, policy: { id }, budget: { maxTokens: 4000, maxItems },
        deadlineAt: Infinity, snapshotOf: included => included.map(item => item.rank) };
      const relevance = assembleContext(options), result = assembleContext({ ...options, representation: dated });
      const items = result.metered.items;
      assert.deepEqual(items.map(item => item.rank), maxItems === 4 ? [3, 4, 1, 2] : [6, 3, 4, 1, 2, 5]);
      assert.deepEqual(result.selected, relevance.selected, 'selection stays in relevance order, even when the earliest item is excluded');
      assert.deepEqual(prepared.map(item => item.rank), [1, 2, 3, 4, 5, 6], 'emission does not mutate prepared relevance order');
      assert.deepEqual(result.snapshot, relevance.snapshot);
      const stripped = structuredClone(result.metered);
      for (const item of stripped.items) delete item.date;
      assert.deepEqual(expandedItems(stripped), expandedItems(relevance.metered), 'same bodies, sources, refs and relevance ranks');
      assert.deepEqual(items.filter(item => !item.date).map(item => item.rank), maxItems === 4 ? [2] : [2, 5]);
      if (id !== 'rank-first-first-source-v1') {
        const aliasItem = items.find(item => item.rank === 1), targetIndex = maxItems === 4 ? 0 : 1;
        assert.deepEqual(aliasItem.sources[0], { index: 7, sameAs: { item: targetIndex, source: 1 } });
        assert.deepEqual(items[targetIndex].sources[1], { index: 9, role: 'user', excerpt: 'Shared synthetic receipt' });
        assert.equal(result.diagnostics.items[items.indexOf(aliasItem)].sources[0].item, targetIndex);
      }
    }
  }
});

test('dated budget uses the exact emitted envelope bytes, including reordered aliases', () => {
  const prepared = fixedPrepared().slice(0, 3).map((item, index) => ({ ...item,
    text: 'Synthetic budget body ' + index, date: `2023-01-0${3 - index}T00:00Z`,
    sources: [{ index: 7 + index, role: 'user', excerpt: 'Shared synthetic budget receipt' }] }));
  const counted = [], bytes = { id: 'synthetic-utf8-bytes', countTokens(text) { counted.push(text); return Buffer.byteLength(text); } };
  const options = { prepared, representation: dated, counter: bytes, policy: { id: 'rank-first-whole-v1' },
    budget: { maxTokens: 4000, maxItems: 3 }, deadlineAt: Infinity, snapshotOf: () => null };
  const full = assembleContext(options), text = meteredText(full.metered), exact = Buffer.byteLength(text);
  assert.deepEqual(full.metered.items.map(item => item.rank), [3, 2, 1]);
  assert.equal(full.diagnostics.budget.used, exact);
  assert.equal(counted.at(-1), text, 'final count measures actual emitted bytes');
  assert.deepEqual(assembleContext({ ...options, budget: { maxTokens: exact, maxItems: 3 } }).metered, full.metered);
  const smaller = assembleContext({ ...options, budget: { maxTokens: 600, maxItems: 3 } });
  assert.ok(smaller.diagnostics.stops.budget);
  assert.ok(smaller.diagnostics.budget.used <= 600);
  assert.equal(smaller.diagnostics.budget.used, Buffer.byteLength(meteredText(smaller.metered)));
});

test('reordered alias growth packs emitted bytes within budget instead of refusing', () => {
  const prepared = fixedPrepared().slice(0, 2).map((item, index) => ({ ...item,
    text: 'Synthetic boundary body ' + index, date: index ? '2023-01-01T00:00Z' : '2024-01-01T00:00Z' }));
  const shared = { index: 0, role: 'user', excerpt: 'Shared synthetic boundary receipt' };
  prepared[0].sources = [shared];
  prepared[1].sources = [...Array.from({ length: 11 }, (_, index) => ({ index, role: 'user', excerpt: 'Unique receipt ' + index })),
    { ...shared, index: 11 }];
  const counted = [], bytes = { id: 'synthetic-utf8-bytes', countTokens(text) { counted.push(text); return Buffer.byteLength(text); } };
  const options = { prepared, representation: dated, counter: bytes, policy: { id: 'rank-first-whole-v1' },
    budget: { maxTokens: 4000, maxItems: 2 }, deadlineAt: Infinity, snapshotOf: () => null };
  const full = assembleContext(options), v2 = assembleContext({ ...options, representation: 'representation-v2' });
  // Reconstruct the previous dated representation independently from frozen v2.
  const relevance = { ...v2.metered, items: v2.metered.items.map(({ ref, rank, ...rest }) =>
    ({ ref, rank, date: prepared[rank - 1].date, ...rest })) };
  const previousBytes = Buffer.byteLength(meteredText(relevance));
  assert.equal(full.diagnostics.budget.used, previousBytes + 1, 'alias source position grows from 0 to 11');
  assert.equal(full.metered.items[1].sources[0].sameAs.source, 11);
  for (const id of ['rank-first-whole-v1', 'coverage-first-v1']) {
    const limited = { ...options, policy: { id }, budget: { maxTokens: previousBytes, maxItems: 2 } };
    assert.equal(assembleContext({ ...limited, representation: 'representation-v2' }).metered.items.length, 2);
    counted.length = 0;
    const result = assembleContext(limited), emitted = meteredText(result.metered);
    assert.deepEqual(result.metered.items.map(item => item.rank), [2, 1]);
    assert.equal(result.metered.items[0].sources.length, 11, 'last source is omitted to fit date-order bytes');
    assert.equal(result.metered.items[1].sources[0].excerpt, shared.excerpt, 'remaining receipt becomes concrete');
    assert.ok(result.diagnostics.stops.budget);
    assert.ok(result.diagnostics.budget.used <= previousBytes);
    assert.equal(result.diagnostics.budget.used, Buffer.byteLength(emitted));
    assert.ok(counted.includes(meteredText(full.metered)), 'trial measures the overflowing date-order payload');
    assert.ok(!counted.includes(meteredText(relevance)), 'trial never measures relevance-order bytes');
    assert.equal(counted.at(-1), emitted);
    for (const text of counted.filter(text => text.startsWith('{"ok":true,'))) {
      const items = JSON.parse(text).value.items;
      assert.deepEqual(items.map(item => item.rank), items.map(item => item.rank).sort((a, b) => b - a),
        'every envelope count, including the minimal probe, uses date order');
    }
  }
});

// Execute the enclosing production functions unchanged, with deterministic I/O
// ports. This covers preparation, reader-owned diagnostics/snapshots and the
// defensive outer gates, without depending on lexical scores or random IDs.
function enclosingReader(kind, definitions, port, { unavailable = 0, localStatus = false, safety = false } = {}) {
  const namespace = safety ? { ownerId: 'synthetic-owner', scope: 'project', projectId: 'synthetic-project' } : { ownerId: 'owner', scope: 'personal', projectId: null };
  const canonical = new Map(), rows = new Map(), counts = [], predictions = [];
  for (const [index, definition] of definitions.entries()) {
    const id = definition.id, ref = { type: 'memory', namespace, memoryId: id, revision: 1 };
    const receipts = definition.sources.map((excerpt, source) => {
      const value = { client: 'synthetic', sessionId: 'session', eventId: `event-${index}-${source}`, role: 'user', excerpt };
      return { id: `receipt-${index}-${source}`, memory_id: id, client: value.client, session_id: value.sessionId,
        event_id: value.eventId, role: value.role, excerpt, occurred_at: definition.date,
        receipt_key: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
    });
    rows.set(id, receipts);
    canonical.set(id, { type: 'memory', ref, ...ASSEMBLY_DEFAULTS.metadata.memory, content: definition.text,
      provenance: { sourceAccess: 'available', receiptMetadata: receipts.map(row => ({ receiptId: row.id })), coverage: { status: 'complete' } } });
  }
  const candidates = { items: [...canonical.values()].map((item, i) => ({ ref: item.ref, rank: i + 1 })),
    channels: { lexical: { state: 'ready', causes: [] }, semantic: { state: 'disabled', causes: ['disabled'] } },
    coverage: { byType: { memory: { eligible: definitions.length, indexed: definitions.length, scanned: 0,
      embeddedFraction: null, scannedFraction: 0 } }, freshness: 'current',
      maintenance: { available: true, state: 'ready', buildState: 'ready', reason: null, progress: null },
      depths: { lexical: 24, semantic: 0 }, omitted: { lexical: 0, semantic: null, horizon: 0 }, stops: { deadline: false, budget: false } },
    trace: { requested: 'lexical', effective: 'lexical', family: 'local', preset: 'rrf-k60-d12', embedder: null,
      tokenizer: 'hr1-t1-v1', representation: 'candidate-text-v1',
      timings: { maintenanceMs: 0, lexicalMs: 0, semanticPreflightMs: 0, embeddingMs: 0, fusionMs: 0 } },
    observed: { publication: { publicationId: 'synthetic' } } };
  if (safety) Object.assign(candidates, { channels: {}, coverage: {}, trace: {} });
  for (let i = 0; i < unavailable; i++) candidates.items.push({ ref: { type: 'memory', namespace, memoryId: 'missing-' + i, revision: 1 }, rank: definitions.length + i + 1 });
  const size = value => Buffer.byteLength(JSON.stringify(value));
  const bind = (purpose, value) => createHash('sha256').update(JSON.stringify([purpose, value])).digest('base64url');
  const encode = (purpose, value) => Buffer.from(JSON.stringify(value)).toString('base64url') + '.' + bind(purpose, value);
  const access = { accessGenerations: safety ? 'a'.repeat(43) : 'access', check() {} };
  const counter = { id: port.id, countTokens(text) { counts.push(text); return port.countTokens(text); } };
  const dependencies = { counter, options: { counter, ...(localStatus ? { localStatus: {} } : {}) }, supportedTypes: ['memory'],
    performance: { now: () => 0 }, ready() {}, contextInput, authorize: () => access,
    searchCandidates: async () => ({ ok: true, horizon: candidates, check() {} }), read: work => work(),
    canonicalFence: () => [{ memory: 1 }], cardDependencyFence: () => ({}),
    db: { prepare(sql) { assert.match(sql, /^SELECT \* FROM receipts/); return { all: id => rows.get(id) }; } },
    evidence: { itemsInside: (_ns, refs) => refs.map(ref => { const item = canonical.get(ref.memoryId); if (!item) fail('evidence_unavailable'); return item; }) },
    namespaceKey, receiptEventDate, validateSourceReceipt, createHash, bind, encode, ASSEMBLY_LIMITS, CONTEXT_LIMITS,
    success: value => ({ ok: true, value }), failure: error => ({ ok: false, error: { code: error.code } }), MemoryStoreError, fail, deepFreeze,
    same: (a, b) => JSON.stringify(a) === JSON.stringify(b), bytes: size,
    final: (_p, _access, _publication, work) => work(), sampleLocalStatus: () => ({ state: 'ready', detail: 'synthetic status' }),
    assembleContext: args => assembleContext({ ...args, now: () => 0 }),
    completeResponseBytes(envelope, meteredBytes, snapshotValue) {
      const bytes = completeResponseBytes(envelope, meteredBytes, snapshotValue);
      predictions.push({ bytes, items: structuredClone(envelope.value.diagnostics.items), used: envelope.value.diagnostics.budget.used });
      // Exact arithmetic against an independent serialization, even with UTF-8,
      // escaping, and every base64 remainder in snapshot payloads.
      const snapshot = snapshotValue === null ? null : encode('snapshot', snapshotValue);
      assert.equal(bytes, size({ ...envelope, value: { ...envelope.value, snapshot } }) - 4 + meteredBytes);
      return bytes;
    } };
  const file = kind === 'product' ? '../context-product-index.mjs' : '../context-read-facade.mjs';
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const start = kind === 'product' ? '  function assemble(' : '  async function contextRead(';
  const end = kind === 'product' ? '  function statusDelivery(' : '  function fetchCandidateEvidence(';
  const implementation = source.slice(source.indexOf(start), source.indexOf(end));
  assert.ok(implementation.includes('context_item_too_large'), 'exercise the enclosing defensive byte gate');
  const read = new Function(...Object.keys(dependencies), 'return (' + implementation + ');')(...Object.values(dependencies));
  return { counts, predictions, candidates, namespace,
    async run(representation, { maxTokens = 4000, maxItems = definitions.length, policy = 'rank-first-whole-v1' } = {}) {
      counts.length = 0; predictions.length = 0;
      const input = { readSet: [namespace], types: ['memory'], intent: 'current', query: 'assembly',
        deadlineMs: 5000, budget: { maxTokens, maxItems }, policy: { id: policy }, representation };
      try {
        const result = kind === 'product' ? read({ ...input, policy: { id: policy }, deadlineAt: Infinity }, access, candidates) : await read(input);
        if (result.ok) {
          const value = result.value;
          // Compare the actual reader prediction (including conservative scalar
          // reserves) with the complete bytes actually returned by that reader.
          if (representation === dated) {
            const accepted = predictions.find(prediction => JSON.stringify(prediction.items) === JSON.stringify(value.diagnostics.items));
            assert.ok(accepted, 'accepted selection has a reader-supplied byte prediction');
            assert.ok(size(result) <= accepted.bytes, `${kind}: measured ${size(result)}, predicted ${accepted.bytes}`);
            assert.ok(accepted.bytes - size(result) < 40, 'reserve is limited to volatile diagnostic scalars');
          } else assert.equal(predictions.length, 0, 'v2 never invokes the byte predictor');
        }
        return result;
      } catch (error) { return { ok: false, error: { code: error.code, message: error.message } }; }
    } };
}
function boundaryDefinitions(kind) {
  return Array.from({ length: kind === 'spec' ? 24 : 12 }, (_, i) => {
    const id = kind === 'spec' ? 'memory-' + String(i).padStart(2, '0') : '00000000-0000-4000-8000-' + String(i).padStart(12, '0');
    return { id, text: 'assembly ' + (kind === 'spec' ? id : id.slice(-3)) + ' ' + (kind === 'spec' ? '_'.repeat(2004 + (i === 23 ? 7 : 0)) : '.'.repeat(3922)),
      date: kind === 'spec' ? (i === 0 ? '2024-01-01T00:00:00.000Z' : i === 23 ? '2023-01-01T00:00:00.000Z' : null) : '2023-01-01T00:00:00.000Z',
      sources: kind === 'spec' ? (i === 0 ? ['Shared boundary receipt'] : i === 23 ? [...Array.from({ length: 11 }, (_, j) => 'Unique receipt ' + j), 'Shared boundary receipt'] : ['assembly receipt ' + i]) : ['source ' + id + ' ' + '.'.repeat(700)] };
  });
}

for (const kind of ['product', 'facade']) test(`${kind}: both reviewer byte-boundary fixtures pack the complete dated response`, async t => {
  const real = await optionalRoleCounter(t); if (!real) return;
  for (const fixture of ['spec', 'safety']) {
    const definitions = boundaryDefinitions(fixture), reader = enclosingReader(kind, definitions, real, { safety: fixture === 'safety' });
    const options = { maxTokens: fixture === 'spec' ? 4000 : 3000 };
    const baseline = await reader.run('representation-v2', options), baselineCalls = [...reader.counts];
    assert.equal(baseline.ok, true, JSON.stringify(baseline));
    assert.equal(baseline.value.metered.items.length, definitions.length);
    assert.equal(reader.counts.length, fixture === 'spec' ? 120 : 50);
    // Frozen against the enclosing readers and assembler at the pre-fix head.
    assert.equal(createHash('sha256').update(JSON.stringify(baseline)).digest('hex'), fixture === 'spec'
      ? 'b48a4955943cf55e755b9ab83bf85afb835bb5f9193d69dd0d8791ade509872d'
      : '9a3619ceb76aeadd93437c61e001a30c19820aae33fa87947e9647af87f784cc');
    assert.equal(createHash('sha256').update(JSON.stringify(baselineCalls)).digest('hex'), fixture === 'spec'
      ? '82edbf4502cf7deb41cce3f5f7cb57f9910b1d5ce3890602c21976c18692e0be'
      : 'd307f52edcf6fd295c6ce1d20ea6cba1ec7a2b3c5d7d7bc16b55658f6e7e173d');
    const result = await reader.run(dated, options);
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65536);
    assert.ok(result.value.diagnostics.stops.budget, `${fixture}: baseline ${Buffer.byteLength(JSON.stringify(baseline))}, dated ${Buffer.byteLength(JSON.stringify(result))}; byte pressure is a packing stop`);
    assert.ok(result.value.diagnostics.budget.used <= options.maxTokens);
    assert.ok(reader.counts.length <= baselineCalls.length, 'byte rejection adds no minimal token probe');
    const time = item => item.date ? Date.parse(item.date) : Infinity;
    const items = result.value.metered.items;
    assert.deepEqual(items.map(item => item.rank), [...items].sort((a, b) => time(a) - time(b) || a.rank - b.rank).map(item => item.rank));
    const repeated = await reader.run('representation-v2', options);
    assert.deepEqual(repeated, baseline, 'dated packing never changes subsequent v2 bytes');
    assert.deepEqual(reader.counts, baselineCalls, 'v2 counter text and calls stay identical');
  }
});

test('fixed-seed generated reads never gain a dated refusal and always meter emitted date order', async () => {
  let state = 0x5eedcafe;
  const random = limit => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % limit; };
  const base = fixedPrepared()[0], counted = [];
  const bytes = { id: 'synthetic-generated-bytes', countTokens(text) { counted.push(text); return Buffer.byteLength(text); } };
  let successes = 0, budgetStops = 0, refusals = 0;
  for (let fixture = 0; fixture < 300; fixture++) {
    const prepared = Array.from({ length: 2 + random(13) }, (_, index) => {
      const text = 'Synthetic generated body ' + index + ' ' + 'x'.repeat(random(80));
      const item = { ...structuredClone(base), rank: index + 1,
        ref: { ...base.ref, memoryId: 'generated-' + index }, text,
        date: random(4) ? `202${random(5)}-01-01T00:00Z` : null,
        sources: Array.from({ length: random(17) }, (_, source) => ({ index: source,
          role: random(3) ? 'user' : 'assistant', excerpt: random(5) ? 'Shared generated receipt ' + random(6) : text })) };
      if (random(7) === 0) Object.assign(item, { type: 'card',
        ref: { ...item.ref, memoryId: undefined, cardId: 'generated-card-' + index, bodyRevision: 1 },
        metadata: { state: 'confirmed', support: {}, origin: {} }, sourceAccess: 'unsupported', sources: [] });
      return item;
    });
    for (const id of ['rank-first-whole-v1', 'rank-first-first-source-v1', 'coverage-first-v1']) {
      const options = { prepared, counter: bytes, policy: { id },
        budget: { maxTokens: 1000000, maxItems: 1 + random(prepared.length) }, deadlineAt: Infinity, snapshotOf: () => null };
      const full = assembleContext({ ...options, representation: dated });
      const emptyBytes = Buffer.byteLength(meteredText({ framing: full.metered.framing, items: [] }));
      const fullBytes = full.diagnostics.budget.used;
      const maxTokens = [emptyBytes - 1, emptyBytes, fullBytes - 1, fullBytes, fullBytes + 1,
        emptyBytes + random(fullBytes - emptyBytes + 1)][fixture % 6];
      const budget = { ...options.budget, maxTokens }, label = `fixture ${fixture}, ${id}, budget ${maxTokens}`;
      let v2;
      try { v2 = assembleContext({ ...options, budget }); }
      catch (error) { assert.equal(error.code, 'context_item_too_large', label); refusals++; continue; }
      counted.length = 0;
      const result = assembleContext({ ...options, budget, representation: dated });
      successes++;
      if (result.diagnostics.stops.budget) budgetStops++;
      const emitted = meteredText(result.metered);
      assert.ok(Buffer.byteLength(emitted) <= maxTokens, label);
      assert.equal(result.diagnostics.budget.used, Buffer.byteLength(emitted), label);
      assert.equal(counted.at(-1), emitted, label);
      // Independently derive the timeline from selected prepared items: Cards
      // and undated memories follow dated memories, with relevance as tie-break.
      const time = item => item.type === 'memory' && item.date ? Date.parse(item.date) : Infinity;
      const expected = [...result.selected].sort((a, b) => time(a) - time(b) || a.rank - b.rank);
      assert.deepEqual(result.metered.items.map(item => item.rank), expected.map(item => item.rank), label);
      for (const text of counted.filter(text => text.startsWith('{"ok":true,'))) {
        const items = JSON.parse(text).value.items;
        const ranks = new Set(items.map(item => item.rank));
        const timeline = prepared.filter(item => ranks.has(item.rank))
          .sort((a, b) => time(a) - time(b) || a.rank - b.rank);
        assert.deepEqual(items.map(item => item.rank), timeline.map(item => item.rank), label + ' trial/probe');
      }
      assert.equal(v2.diagnostics.representation, 'representation-v2');
    }
  }
  assert.equal(successes + refusals, 900, '300 fixtures across all three greedy policies');
  assert.ok(successes >= 700 && budgetStops >= 100 && refusals >= 100, 'exercise success, budget pressure and shared empty-envelope refusals');
  const compressed = { id: 'synthetic-padding-compression', countTokens: text => Math.ceil(Buffer.byteLength(text.replace(/[_.]{32,}/g, '')) / 4) };
  let enclosingSuccesses = 0, outerRefusals = 0, byteStops = 0;
  for (let fixture = 0; fixture < 100; fixture++) {
    const definitions = Array.from({ length: 18 + random(7) }, (_, index) => ({ id: 'padded-' + index,
      text: 'assembly padded body ' + index + ' ' + (index % 2 ? '_' : '.').repeat(2200 + random(1500)),
      date: random(4) ? `202${random(5)}-01-01T00:00:00.000Z` : null,
      sources: Array.from({ length: 1 + random(4) }, () => 'Shared padded receipt ' + random(9)) }));
    for (const policy of ['rank-first-whole-v1', 'rank-first-first-source-v1', 'coverage-first-v1']) {
      for (const kind of ['product', 'facade']) {
        const reader = enclosingReader(kind, definitions, compressed, { unavailable: fixture % 3, localStatus: fixture % 2 === 0 });
        const options = { policy, maxTokens: [64, 1000, 3000, 4000][fixture % 4] };
        const baseline = await reader.run('representation-v2', options);
        if (!baseline.ok) { assert.equal(baseline.error.code, 'context_item_too_large'); outerRefusals++; continue; }
        const result = await reader.run(dated, options);
        assert.equal(result.ok, true, `${kind} fixture ${fixture}, ${policy}: ${JSON.stringify(result)}`);
        enclosingSuccesses++;
        assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65536);
        assert.ok(result.value.diagnostics.budget.used <= options.maxTokens);
        if (result.value.diagnostics.stops.budget) byteStops++;
        const items = result.value.metered.items, time = item => item.date ? Date.parse(item.date) : Infinity;
        assert.deepEqual(items.map(item => item.rank), [...items].sort((a, b) => time(a) - time(b) || a.rank - b.rank).map(item => item.rank));
      }
    }
  }
  assert.equal(enclosingSuccesses + outerRefusals, 600);
  assert.ok(enclosingSuccesses > 100 && outerRefusals > 10 && byteStops > 10, 'exercise enclosing-reader success, byte pressure and unchanged v2 outer refusals');
});

for (const column of [false, true]) test(`all preparation paths: ${column ? 'bounded event dates' : 'old layout without column'}`, async t => {
  const f = await datedFixture(t, { eventTime: column });
  const times = { 'has-time-0': '2023-05-23T01:00:00.000Z', 'has-time-2': '2023-05-22T05:54:59.999Z', 'window-16': '1970-01-01T00:00:00.000Z' };
  const definition = (id, n) => ({ id, input: 'assembly ' + id, receipts: Array.from({ length: n }, (_, i) => {
    const eventId = id + '-' + i;
    return { ...receipt(eventId), ...(column && times[eventId] ? { occurredAt: times[eventId] } : {}) };
  }) });
  const seeded = seed(t, f, [definition('has-time', 3), definition('no-time', 1), definition('window', 17)]);
  const r = readers(t, f);
  if (column) assert.equal(f.db.prepare('SELECT occurred_at FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 1 OFFSET 16').get(seeded[2].memory.id).occurred_at,
    times['window-16'], 'the earlier event time is stored outside the physical source window');
  await r.build();
  const expected = new Map(column ? [[seeded[0].memory.id, '2023-05-22T05:54Z']] : []);
  for (const read of [r.facadeRead, r.readOnlyRead, input => r.product.run('contextRead', input)]) {
    const v2 = ok(await read(request())), explicit = ok(await read(request(ns, { representation: 'representation-v2' })));
    assert.equal(meteredText(v2.metered), meteredText(explicit.metered));
    assert.equal(v2.diagnostics.trace.counterCalls, explicit.diagnostics.trace.counterCalls);
    onlyDateDiff(v2, ok(await read(request(ns, { representation: dated }))), expected);
    const policy = { id: 'rank-first-first-source-v1' };
    onlyDateDiff(ok(await read(request(ns, { policy }))),
      ok(await read(request(ns, { policy, representation: dated }))), expected);
  }
  const projected = roleAssembly(f, r, seeded.map(({ memory }) => ref(memory)));
  for (const item of projected.metered.items) assert.equal(item.date, expected.get(item.ref.id));
  assert.equal(projected.metered.items.find(item => item.ref.id === seeded[2].memory.id).sources.length, 16);
  assert.ok(ok(r.context.getContextReadCapabilities()).assembly.representations.includes(dated));
  assert.ok(r.product.assembly.representations.includes(dated));
  for (const [path, read] of [['facade', r.facadeRead], ['product', input => r.product.run('contextRead', input)]]) {
    // Warm both reads before counting SQL; counting includes executions and BEGIN.
    await read(request()); await read(request(ns, { representation: dated }));
    const a = await measureContentRead('contextRead', path, () => read(request()));
    const b = await measureContentRead('contextRead', path, () => read(request(ns, { representation: dated })));
    ok(a.result); ok(b.result);
    assert.equal(b.statements, a.statements); assert.equal(b.begin, a.begin);
    assert.deepEqual(b.sql, a.sql, 'no SQL or transaction added by representation selection');
    assert.equal(b.result.value.diagnostics.trace.counterCalls, a.result.value.diagnostics.trace.counterCalls);
  }
});

test('history sourceAccess denial suppresses dates on all three preparation paths', async t => {
  const f = await datedFixture(t), memory = ok(f.core.admit({ namespace: ns,
    memory: { content: 'assembly historical', kind: 'fact' }, receipts: [{ ...receipt('historical'), occurredAt: '2023-05-22T05:54:59.999Z' }] })).memory;
  const r = readers(t, f);
  ok(f.context.supersede({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    replacement: { content: 'Replacement context', kind: 'fact' }, receipts: [receipt('replacement')] }));
  const current = ref({ ...memory, revision: memory.revision + 1 });
  await r.build('history');
  for (const read of [r.facadeRead, input => r.product.run('contextRead', input)]) {
    const result = ok(await read(request(ns, { representation: dated, intent: 'history' })));
    const item = result.metered.items.find(item => item.ref.id === memory.id);
    assert.ok(item); assert.equal(item.sourceAccess, 'unavailable-for-noncurrent-memory');
    assert.equal(item.date, undefined); assert.deepEqual(item.sources, []);
  }
  assert.equal(roleAssembly(f, r, [current], ns, 'history').metered.items[0].date, undefined);
});

// Clone through SQLite itself; no raw file descriptor is opened on a live DB.
// Both stores retain identical Memory/ref/fence identities for exact byte checks.
function cloneStore(t, f) {
  const path = join(f.workspace.path, 'never-written.sqlite');
  f.db.exec("VACUUM INTO '" + path.replaceAll("'", "''") + "'");
  chmodSync(path, 0o600);
  const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON');
  const core = openMemoryCore({ path });
  t.after(() => { core.close(); db.close(); });
  return { path, db, core };
}
for (const mutation of ['forget', 'correct', 'Raw-delete', 'erase']) for (const retainedTime of [null, '2023-05-22T05:54:59.999Z']) {
  test(`dated safety ${mutation}: exact never-written bytes, surviving date=${retainedTime !== null}`, async t => {
    const layout = safetyFixture(t, 33); await migrateEventTime(layout);
    const { openRawCaptureCore } = await import('../raw-capture.mjs');
    const { localPlainPort } = await import('../testing/raw-capture-fixtures.mjs');
    let extractItems = [];
    const core = openRawCaptureCore({ path: layout.path, privateCards: cardHost().options, model: {
      ...rationaleModel(), countTokens: () => 1,
      extract: () => ({ items: extractItems }),
    } }, { mode: 'raw-v1', sources: true, deletion: true, port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) });
    const db = layout.connect(); t.after(() => { core.close(); db.close(); });
    const f = { ...layout, core, db };
    assert.equal(db.prepare('PRAGMA user_version').get().user_version, 53);
    const memory = ok(core.admit({ namespace: ns, memory: { content: 'assembly surviving memory', kind: 'fact' },
      receipts: [{ ...receipt('surviving'), occurredAt: retainedTime }] })).memory;
    const companion = ok(core.admit({ namespace: ns, memory: { content: 'assembly companion memory', kind: 'fact' },
      receipts: [{ ...receipt('companion'), occurredAt: '2020-01-01T00:00:00.000Z' }] })).memory;
    const never = cloneStore(t, f);
    // The fixture holds public ref identity fixed: Raw attach/removal advances
    // the surviving Memory twice. This baseline has that same visible revision,
    // but never receives the sensitive receipt or its event time.
    if (mutation === 'Raw-delete') never.db.prepare('UPDATE memories SET revision=revision+2 WHERE id=?').run(memory.id);
    const actualReaders = readers(t, f), neverReaders = readers(t, never);
    let target = memory, source;
    if (mutation === 'Raw-delete') {
      source = await savedSource(f, 'Synthetic removable raw source', { namespace: ns, sessionId: 'dated-removable' });
      // Raw timestamps do not authorize Memory event times. Capture the same
      // message independently with PR 1's input; normal lineage binds it to Raw.
      extractItems = [{ content: 'assembly surviving memory', kind: 'fact', confidence: 1, sourceIndices: [0] }];
      const captured = ok(await core.capture({ namespace: ns, client: 'codex', sessionId: 'dated-removable', eventId: 'dated-timed-capture',
        messages: [{ id: source.messageId, role: 'user', content: source.text, occurredAt: '1970-01-01T00:00:59.999Z' }] }));
      assert.equal(captured.admission.memories[0].id, memory.id);
      const rows = db.prepare('SELECT id,occurred_at FROM receipts WHERE memory_id=? AND event_id<>?').all(memory.id, 'surviving');
      assert.equal(rows.length, 1);
      assert.equal(rows[0].occurred_at, '1970-01-01T00:00:59.999Z');
      source.expectedConversationRevision = db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversationId).revision;
    } else {
      target = ok(core.admit({ namespace: ns, memory: { content: 'assembly sensitive target', kind: 'fact' },
        receipts: [{ ...receipt('removed'), occurredAt: '1970-01-01T00:00:59.999Z' }] })).memory;
    }
    await actualReaders.build();
    const before = ok(await actualReaders.facadeRead(request(ns, { representation: dated })));
    assert.equal(before.metered.items[0].ref.id, target.id, 'sensitive receipt sorts first before removal');
    assert.equal(before.metered.items.find(item => item.ref.id === target.id).date, '1970-01-01T00:00Z');
    assert.ok(db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(target.id).n <= 16);
    if (mutation === 'forget') ok(core.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision }));
    if (mutation === 'correct') ok(core.correct({ namespace: ns, memoryId: target.id, expectedRevision: target.revision,
      content: 'Unrelated replacement', kind: 'fact', receipt: receipt('replacement') }));
    if (mutation === 'Raw-delete') ok(core.deleteConversation({ namespace: ns, conversationId: source.conversationId,
      expectedRevision: source.expectedConversationRevision, actionId: 'dated-delete' }));
    if (mutation === 'erase') transaction(db, () => writeContentSuppressionInside(db, {
      namespace: ns, kind: 'memory', key: target.id, reason: 'privacy_erase', actionId: 'dated-erase' }));
    // Embedded maintenance refuses a same-scope suppression epoch on this
    // base. Product maintenance supports rebuilding its ready-only projection.
    for (let i = 0; i < 100; i++) {
      const value = ok(actualReaders.product.run('refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current',
        mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } }));
      if (value.status === 'complete') break;
      assert.ok(i < 99, 'product lifecycle rebuild must complete');
    }
    await neverReaders.build();
    for (const path of ['facadeRead', 'readOnlyRead', 'product']) {
      const read = (r, input) => path === 'product' ? r.product.run('contextRead', input) : r[path](input);
      const input = request(ns, { representation: dated });
      const actual = ok(await read(actualReaders, input)), expected = ok(await read(neverReaders, input));
      assert.equal(actual.metered.items.length, 2, path);
      assert.equal(actual.metered.items[0].ref.id, companion.id, 'surviving timeline reorders after receipt removal');
      assert.equal(actual.metered.items[1].date, retainedTime ? '2023-05-22T05:54Z' : undefined);
      assert.equal(meteredText(actual.metered), meteredText(expected.metered), path + ' exact bytes including refs and date presence');
      assert.equal(actual.diagnostics.trace.counterCalls, expected.diagnostics.trace.counterCalls);
    }
    const surviving = db.prepare('SELECT id,revision FROM memories WHERE id=?').get(memory.id);
    assert.equal(meteredText(roleAssembly(f, actualReaders, [ref(surviving), ref(companion)]).metered),
      meteredText(roleAssembly(never, neverReaders, [ref(surviving), ref(companion)]).metered), 'role preparation exact bytes');
  });
}

test('correction drops the old receipt time and never falls back to the replacement recorded time', async t => {
  const f = await datedFixture(t), memory = ok(f.core.admit({ namespace: ns,
    memory: { content: 'assembly before correction', kind: 'fact' }, receipts: [{ ...receipt('before'), occurredAt: '2023-05-22T05:54:59.999Z' }] })).memory;
  const corrected = ok(f.context.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
    content: 'assembly after correction', kind: 'fact', receipt: receipt('new-source') })).memory;
  // The public maintenance acknowledgement refuses scoped suppression facts
  // even after doing its work. Build via the internal fixture seam, retaining
  // the same public facade/product reads and date assertions below.
  const r = readers(t, f);
  const sidecar = openContextReadSidecar({ path: f.path, db: f.db });
  try {
    assert.equal(drain(sidecar, { readSet: [ns], types: ['memory'], intent: 'current', accessGeneration: 1,
      budget: { maxItems: 1024, maxMs: 5000 } }).status, 'complete');
  } finally { sidecar.close(); }
  r.buildProduct();
  for (const read of [r.facadeRead, input => r.product.run('contextRead', input)]) {
    const result = ok(await read(request(ns, { representation: dated })));
    assert.equal(result.metered.items.length, 1); assert.equal(result.metered.items[0].date, undefined);
  }
  assert.equal(roleAssembly(f, r, [ref(corrected)]).metered.items[0].date, undefined);
});

test('a suppressed receipt still in the physical window cannot contribute a date on any preparation path', async t => {
  const f = safetyFixture(t, 18); await migrateEventTime(f);
  const db = f.connect(), core = openMemoryCore({ path: f.path }); t.after(() => { core.close(); db.close(); });
  const store = { ...f, db, core }, r = readers(t, store);
  const memory = ok(core.admit({ namespace: ns, memory: { content: 'assembly filtered receipts', kind: 'fact' },
    receipts: [{ ...receipt('denied'), occurredAt: '1970-01-01T00:00:59.999Z' },
      { ...receipt('visible'), occurredAt: '2023-05-22T05:54:59.999Z' }] })).memory;
  await r.build();
  const id = db.prepare('SELECT id FROM receipts WHERE memory_id=? AND event_id=?').get(memory.id, 'denied').id;
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'receipt', key: id, reason: 'privacy_erase', actionId: 'dated-receipt-erase' }));
  assert.equal(db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n, 2, 'denied row remains physically present');
  for (const read of [r.facadeRead, r.readOnlyRead, input => r.product.run('contextRead', input)]) {
    const v2 = ok(await read(request())), next = ok(await read(request(ns, { representation: dated })));
    onlyDateDiff(v2, next, new Map([[memory.id, '2023-05-22T05:54Z']]));
    assert.equal(next.metered.items[0].sources.length, 1);
    assert.equal(next.metered.items[0].sources[0].excerpt, 'visible');
  }
  const role = roleAssembly(store, r, [ref(memory)]);
  assert.equal(role.metered.items[0].date, '2023-05-22T05:54Z');
  assert.equal(role.metered.items[0].sources.length, 1);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { chmodSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { assembleContext, meteredText, receiptEventDate } from '../context-read-assembly.mjs';
import { ASSEMBLY_REPRESENTATIONS, ASSEMBLY_LIMITS, contextInput } from '../context-read-input.mjs';
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

test('reordered alias growth keeps relevance selection and applies the existing final budget refusal', () => {
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
  counted.length = 0;
  assert.throws(() => assembleContext({ ...options, budget: { maxTokens: previousBytes, maxItems: 2 } }),
    { code: 'context_item_too_large' });
  assert.ok(counted.includes(meteredText(relevance)), 'selection accepted the exact previous relevance-order trial');
  assert.equal(counted.at(-1), meteredText(full.metered), 'final gate refuses the unchanged selection instead of dropping a source');
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

import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { eventTimeFixture } from '../testing/receipt-event-time-fixture.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { cardHost, localPlainPort, ns, ok, request, splitRaw } from '../testing/raw-source-fixtures.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { host } from '../testing/context-read-core-fixture.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { openMemoryCore, openContextReader } from '../index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { assembleContext, meteredText, completeResponseBytes } from '../context-read-assembly.mjs';
import { assembleThreeLayerContext, queryExcerpt, countListQuestion, readRawChannel } from '../context-read-three-layer.mjs';
import { fixedPrepared } from '../testing/context-read-assembly-fixture.mjs';
import { ASSEMBLY_LIMITS, contextInput } from '../context-read-input.mjs';
import { configured } from '../testing/context-product-owner-fixture.mjs';
import { requestAuthority } from '../context-product-authority.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';

test.beforeEach(installRawSearchTestClock);
const counter = { id: 'synthetic-quarter-bytes', countTokens: text => Math.ceil(Buffer.byteLength(text) / 4) };
const dated = 'representation-v2-dated';
const query = (text = '蛋餅', patch = {}) => ({ readSet: [ns], types: ['memory'], intent: 'current', query: text, ...patch });

async function fixture(t, { extract, portCounter = counter } = {}) {
  const base = await eventTimeFixture(t, 33), privateHost = cardHost(), crypto = localPlainPort();
  const core = openRawCaptureCore({ path: base.path, privateCards: privateHost.options,
    model: { ...rationaleModel(), extract: extract ?? (() => ({ items: [] })) } },
  { mode: 'raw-v1', sources: true, port: crypto, readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  const db = base.connect(); base.workspace.defer(() => core.close()); base.workspace.defer(() => db.close());
  const f = { ...base, core, db, port: crypto };
  const trusted = host(); trusted.state.allowed = [ns];
  let service, reader, readOnly, product, rawPort;
  async function capture(text, { id = 'message', role = 'user', occurredAt = null, sessionId = 'synthetic-session', ordinal = 1, namespace = ns } = {}) {
    let saved;
    for (const part of splitRaw(text, { id, role, occurredAt, ordinal })) saved = ok(await core.captureRaw(request(part,
      { namespace, client: 'codex', sessionId, eventId: id + '-' + part.part.index })));
    return { conversationId: saved.raw.conversationId, messageId: id, text, namespace };
  }
  async function build({ allowLegacyUnavailable = false } = {}) {
    service ??= await searchFixture(f);
    await service.maintain();
    let ready = false;
    for (let i = 0; i < 16; i++) {
      if ((await service.search({ query: 'indexreadinessprobe' })).coverage.status === 'complete') { ready = true; break; }
      await service.tick();
    }
    assert.equal(ready, true, 'synthetic Raw inventory completes before exercising reads');
    rawPort ??= { search: input => service.search(input),
      prepare: (candidate, settings) => service.service.prepare(candidate, settings, service.host.token),
      revalidate: handles => service.service.revalidate(handles) };
    if (!reader) {
      const contextRead = { version: 'context-read-v1', authority: trusted.authority, counter: portCounter, rawSearch: rawPort };
      reader = openMemoryCore({ path: f.path, contextRead }); base.workspace.defer(() => reader.close());
      readOnly = openContextReader({ path: f.path, contextRead }); base.workspace.defer(() => readOnly.close());
      const facade = openContextProductFacade(f.path, {}); base.workspace.defer(() => facade.close());
      const token = { opaque: 'synthetic-product' }, binding = { ownerId: ns.ownerId,
        namespaces: { readSet: [ns] }, credentialDigest: credentialDigest(token) };
      const enter = requestAuthority({ authorize: () => binding, isCurrent: () => true }, binding, {});
      product = openProductIndex({ path: f.path, facade, counter: portCounter, rawSearch: rawPort, maintenance: true,
        authorize: (method, payload) => enter(method, payload, token),
        ownerCoverage: { policy: 'recent-projects-v1', selectionRevision: 'synthetic', requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 } });
      base.workspace.defer(() => product.close());
    }
    const input = { readSet: [ns], types: ['memory'], intent: 'current', budget: { maxItems: 1024, maxMs: 5000 } };
    for (let i = 0; i < 100; i++) {
      const result = await trusted.call(reader, 'refreshContextIndex', input);
      if (allowLegacyUnavailable && !result.ok && result.error.code === 'index_unavailable') break;
      if (ok(result).status === 'complete') break;
    }
    for (let i = 0; i < 100; i++) if (ok(product.run('refreshContextIndex', { ...input, mode: 'lexical' })).status === 'complete') break;
  }
  return { ...f, capture, build, get service() { return service; }, get rawPort() { return rawPort; },
    read: input => trusted.call(reader, 'contextRead', input),
    readers: () => [input => trusted.call(reader, 'contextRead', input), input => trusted.call(readOnly, 'contextRead', input), input => product.run('contextRead', input)] };
}

test('dated default preserves the egg-pancake preference change and coalesces cited Raw on all read paths', async t => {
  const f = await fixture(t, { extract: ({ input }) => ({ items: input.messages.filter(message => message.content.startsWith('我喜歡'))
    .map(message => ({ content: message.content, kind: 'fact', confidence: 1, sourceIndices: [message.index] })) }) });
  await f.capture('我喜歡蛋餅。', { id: 'day-1', occurredAt: '2026-01-01T08:00:00.000Z' });
  await f.capture('我已經不喜歡蛋餅了，因為地溝油。', { id: 'day-3', ordinal: 2, occurredAt: '2026-01-03T08:00:00.000Z' });
  await f.build();
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_receipt_lineage').get().n, 1);
  for (const read of f.readers()) {
    const result = ok(await read(query('我現在喜歡蛋餅嗎？')));
    assert.equal(result.diagnostics.representation, dated);
    assert.deepEqual(result.diagnostics.budget.maxTokens, 6000); assert.equal(result.diagnostics.budget.maxItems, 24);
    assert.equal(result.diagnostics.coverage.raw, 'included');
    assert.equal(result.metered.items.length, 2, 'Memory + its cited Raw use one item');
    assert.deepEqual(result.metered.items.map(item => item.date), ['2026-01-01T08:00Z', '2026-01-03T08:00Z']);
    assert.match(result.metered.items[0].body, /我喜歡蛋餅/);
    assert.equal(result.metered.items[0].evidence.length, 1);
    assert.match(result.metered.items[1].body, /不喜歡蛋餅.*地溝油/);
    assert.equal(result.metered.items[1].ref.messageId, 'day-3');
    assert.equal(result.metered.items[1].occurredAt, '2026-01-03T08:00:00.000Z');
    assert.match(result.metered.framing, /untrusted recollection/);
    assert.equal(result.diagnostics.budget.used, counter.countTokens(meteredText(result.metered)));
    assert.ok(Buffer.byteLength(JSON.stringify(result)) < 65536);
    t.diagnostic('egg-pancake rendered: ' + meteredText(result.metered));
  }
});

test('a query-matched assistant fact beyond 800 characters is delivered as an exact Raw excerpt', async t => {
  const f = await fixture(t);
  const text = 'Unrelated opening text. '.repeat(120) + 'The telescope access code is ZEPHYR-739. 😀';
  await f.capture(text, { role: 'assistant', occurredAt: '2026-02-03T01:00:00.000Z' }); await f.build();
  for (const read of f.readers()) {
    const result = ok(await read(query('What is the telescope access code?'))), item = result.metered.items[0];
    assert.equal(item.layer, 'Raw'); assert.equal(item.role, 'assistant');
    assert.match(item.body, /ZEPHYR-739/); assert.ok(item.start > 800);
    assert.equal(text.slice(item.start, item.end), item.body); assert.ok(item.body.isWellFormed());
    assert.ok(counter.countTokens(item.body) <= 200);
  }
});

test('forgotten best-matching Raw never appears anywhere in a read', async t => {
  const f = await fixture(t, { extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
    kind: 'fact', confidence: 1, sourceIndices: [message.index] })) }) });
  const secret = 'Synthetic violet telescope private password'; await f.capture(secret); await f.build();
  assert.match(JSON.stringify(ok(await f.read(query('violet telescope')))), /private password/);
  const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  await f.build({ allowLegacyUnavailable: true });
  const productRead = f.readers()[2];
  assert.equal(ok(await productRead(query('violet telescope'))).metered.items.length, 0);
  for (const read of f.readers()) {
    const result = await read(query('violet telescope'));
    assert.ok(!JSON.stringify(result).includes('private password'));
    if (result.ok) assert.equal(result.value.metered.items.length, 0);
  }
});

for (const path of [0, 1, 2]) for (const mutation of ['denied', 'suppressed', 'excluded']) test(`reader ${path}: partial Raw ${mutation} during token counting never retains text`, async t => {
  let armed = false, changed = false, mutate;
  const guarded = { ...counter, countTokens(text) {
    if (armed && !changed && text.includes('secret-orchid')) { changed = true; mutate(); }
    return counter.countTokens(text);
  } };
  const f = await fixture(t, { portCounter: guarded });
  const source = await f.capture('secret-orchid telescope', { role: 'assistant' }); await f.build();
  const search = f.rawPort.search;
  f.rawPort.search = async input => ({ ...await search(input), coverage: { status: 'partial' } });
  if (mutation === 'denied') mutate = () => f.service.host.revoke();
  else if (mutation === 'suppressed') mutate = () => transaction(f.db, () => writeContentSuppressionInside(f.db,
    { namespace: ns, kind: 'raw', key: source.conversationId, matchMode: 'span', messageId: source.messageId, start: 0, end: source.text.length, reason: 'purge', actionId: 'synthetic-suppression' }));
  else mutate = () => f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,?)')
    .run(source.conversationId, source.messageId, 0, source.text.length, 1);
  armed = true;
  const result = await f.readers()[path](query('secret-orchid telescope'));
  assert.equal(changed, true);
  assert.ok(!JSON.stringify(result).includes('secret-orchid'));
  if (mutation === 'denied') assert.equal(result.ok, true, JSON.stringify(result));
  if (result.ok) { assert.equal(result.value.metered.items.length, 0); assert.equal(result.value.diagnostics.coverage.raw, 'partial'); }
});

test('Raw and Memory remain isolated by both owner and namespace', async t => {
  const f = await fixture(t, { extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
    kind: 'fact', confidence: 1, sourceIndices: [message.index] })) }) });
  await f.capture('telescope public-synthetic');
  const foreignSources = [];
  for (const [label, namespace] of [['other-project', { ...ns, scope: 'project', projectId: 'other-project' }],
    ['other-owner', { ...ns, ownerId: 'other-owner' }]]) {
    foreignSources.push(await f.capture('telescope foreign-synthetic-' + label, { namespace, sessionId: label }));
    foreignSources.push(await f.capture('telescope public-synthetic', { namespace, sessionId: label, id: 'identical', ordinal: 2 }));
  }
  await f.build();
  const search = f.rawPort.search;
  f.rawPort.search = async input => ({ ...await search(input), coverage: { status: 'partial' } });
  for (const read of f.readers()) {
    const result = ok(await read(query('telescope')));
    assert.ok(!JSON.stringify(result).includes('foreign-synthetic'));
    for (const source of foreignSources) assert.ok(!JSON.stringify(result).includes(source.conversationId));
    assert.match(JSON.stringify(result.metered), /public-synthetic/);
    assert.equal(result.diagnostics.coverage.raw, 'partial');
    assert.ok(result.metered.items.some(item => item.layer === 'Raw' || item.evidence?.length), 'Raw isolation is exercised without falling back');
  }
});

test('all readers deliver dated Raw from a partial search', async t => {
  const f = await fixture(t);
  await f.capture('telescope partial dated evidence', { occurredAt: '2026-01-01T08:00:00.000Z' }); await f.build();
  const search = f.rawPort.search;
  f.rawPort.search = async input => ({ ...await search(input), coverage: { status: 'partial' } });
  for (const read of f.readers()) {
    const result = ok(await read(query('telescope')));
    assert.equal(result.diagnostics.coverage.raw, 'partial');
    assert.equal(result.metered.items[0].layer, 'Raw'); assert.equal(result.metered.items[0].date, '2026-01-01T08:00Z');
  }
});

for (const path of [0, 1, 2]) for (const mutation of ['forgotten', 'suppressed', 'excluded', 'denied'])
  test(`reader ${path}: partial Raw ${mutation} after prepare never reaches assembly text projection`, async t => {
    const extract = mutation === 'forgotten' ? ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
      kind: 'fact', confidence: 1, sourceIndices: [message.index] })) }) : undefined;
    const f = await fixture(t, { extract });
    const source = await f.capture('secret-partial-orchid telescope', { occurredAt: '2026-01-01T08:00:00.000Z' }); await f.build();
    const search = f.rawPort.search, prepare = f.rawPort.prepare, revalidate = f.rawPort.revalidate;
    let changed = false;
    f.rawPort.search = async input => ({ ...await search(input), coverage: { status: 'partial' } });
    f.rawPort.prepare = async (...args) => {
      const handle = await prepare(...args);
      if (!changed) {
        changed = true;
        if (mutation === 'forgotten') {
          const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
          ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
        } else if (mutation === 'suppressed') transaction(f.db, () => writeContentSuppressionInside(f.db,
          { namespace: ns, kind: 'raw', key: source.conversationId, matchMode: 'span', messageId: source.messageId,
            start: 0, end: source.text.length, reason: 'purge', actionId: 'synthetic-partial-suppression' }));
        else if (mutation === 'excluded') f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,?)')
          .run(source.conversationId, source.messageId, 0, source.text.length, 1);
        else f.service.host.revoke();
      }
      return handle;
    };
    f.rawPort.revalidate = handles => { assert.equal(handles.length, 1); return revalidate(handles); };
    const result = await f.readers()[path](query('secret-partial-orchid telescope'));
    assert.equal(changed, true);
    assert.ok(!JSON.stringify(result).includes('secret-partial-orchid'));
    if (result.ok) { assert.equal(result.value.diagnostics.coverage.raw, 'partial'); assert.equal(result.value.metered.items.length, 0); }
  });

for (const mutation of ['forgotten', 'suppressed', 'excluded', 'denied'])
  test(`partial set batch validation blocks Raw ${mutation} between preparation and assembly`, async t => {
    const f = await fixture(t, { extract: ({ input }) => ({ items: input.messages.map(message => ({ content: message.content,
      kind: 'fact', confidence: 1, sourceIndices: [message.index] })) }) });
    const source = await f.capture('secret-partial-batch telescope', { occurredAt: '2026-01-01T08:00:00.000Z' }); await f.build();
    const search = f.rawPort.search, revalidate = f.rawPort.revalidate;
    f.rawPort.search = async input => ({ ...await search(input), coverage: { status: 'partial' } });
    const raw = await readRawChannel(f.rawPort, { ...channelInput(), query: 'secret-partial-batch telescope' }, {}, performance.now() + 1000);
    assert.equal(raw.coverage, 'partial'); assert.equal(raw.items.length, 1);
    if (mutation === 'forgotten') {
      const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
      ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    } else if (mutation === 'suppressed') transaction(f.db, () => writeContentSuppressionInside(f.db,
      { namespace: ns, kind: 'raw', key: source.conversationId, matchMode: 'span', messageId: source.messageId,
        start: 0, end: source.text.length, reason: 'purge', actionId: 'synthetic-partial-batch-suppression' }));
    else if (mutation === 'excluded') f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,?)')
      .run(source.conversationId, source.messageId, 0, source.text.length, 1);
    else f.service.host.revoke();
    let batches = 0;
    f.rawPort.revalidate = handles => { batches++; assert.equal(handles.length, 1); return revalidate(handles); };
    const result = assembleThreeLayerContext(packedArgs({ prepared: [] }), raw);
    assert.equal(batches, 1); assert.equal(result.diagnostics.coverage.raw, 'partial');
    assert.deepEqual(result.metered.items, []); assert.ok(!JSON.stringify(result.metered).includes('secret-partial-batch'));
  });

const packedArgs = (patch = {}) => ({ prepared: fixedPrepared().slice(0, 2), counter, policy: { id: 'rank-first-whole-v1' },
  budget: { maxTokens: 6000, maxItems: 24 }, query: 'assembly telescope', readSet: [ns], representation: dated,
  deadlineAt: Infinity, snapshotOf: items => JSON.stringify(items.map(item => item.ref)), ...patch });
function syntheticRaw(texts) {
  const values = texts.map((text, i) => ({ namespace: ns, conversationId: 'session-' + i, messageId: 'turn-' + i,
    role: 'assistant', occurredAt: i % 2 ? null : '2026-01-01T00:00:00.000Z',
    ranges: [{ source: { span: { start: 0, end: text.length } }, text }] }));
  const items = values.map((value, i) => ({ key: JSON.stringify([JSON.stringify([ns.ownerId, ns.scope, ns.projectId]), value.conversationId, value.messageId]),
    rank: i + 1, value, handle: { index: i } }));
  return { items, coverage: 'included', rawSearch: { revalidate: handles => handles.map(handle => values[handle.index]) } };
}

test('absent, empty partial and timed-out Raw preserve the exact Memory-only dated projection and snapshot', async () => {
  const args = packedArgs(), baseline = assembleContext(args);
  for (const raw of [undefined, { items: [], coverage: 'partial' }]) {
    const value = assembleThreeLayerContext(args, raw);
    assert.deepEqual(value.metered, baseline.metered); assert.equal(value.snapshot, baseline.snapshot);
  }
  const payload = contextInput('contextRead', query(), ['memory']).input;
  const partial = await readRawChannel({ search: async () => ({ coverage: { status: 'partial' }, candidates: [] }) }, payload, {}, performance.now() + 1000);
  assert.deepEqual(partial, { items: [], coverage: 'partial' });
  // Incomplete search with candidates now retains its validated evidence.
  const available = syntheticChannel(['assembly telescope dated prefix']);
  available.service.search = async () => ({ coverage: { status: 'partial' }, candidates: available.candidates });
  const prefix = await readRawChannel(available.service, payload, {}, performance.now() + 1000);
  const assembled = assembleThreeLayerContext(args, prefix);
  assert.equal(prefix.items.length, 1); assert.equal(assembled.diagnostics.coverage.raw, 'partial');
  assert.ok(assembled.metered.items.some(item => item.layer === 'Raw' && item.date === '2026-01-01T00:00Z'));
  const absent = await readRawChannel(null, payload, {}, performance.now() + 1000);
  assert.deepEqual(absent, { items: [], coverage: 'unavailable' });
  const at = Date.now();
  const timeout = await readRawChannel({ search: () => new Promise(() => {}) }, payload, {}, performance.now() + 150);
  assert.deepEqual(timeout, { items: [], coverage: 'partial' }); assert.ok(Date.now() - at < 500);
});

function syntheticChannel(texts = ['assembly telescope first', 'assembly telescope second', 'assembly telescope third']) {
  const raw = syntheticRaw(texts), candidates = raw.items.map(item => item.value);
  const handles = raw.items.map(item => ({ ...item.handle, value: item.value }));
  const service = { ...raw.rawSearch,
    search: async () => ({ coverage: { status: 'complete' }, candidates }),
    prepare: async candidate => handles[candidates.indexOf(candidate)] };
  return { candidates, handles, service };
}
function channelClock(t) {
  let time = 100;
  const previous = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
  t.after(() => Object.defineProperty(performance, 'now', previous));
  return ms => { time += ms; };
}
const channelInput = () => contextInput('contextRead', query(), ['memory']).input;

for (const k of [0, 1, 2]) test(`Raw cutoff retains exactly ${k} validated candidates in rank order`, async t => {
  const advance = channelClock(t), { candidates, handles, service } = syntheticChannel();
  let prepares = 0, lateValueReads = 0;
  service.prepare = async candidate => {
    const index = candidates.indexOf(candidate); prepares++;
    if (index === k) {
      advance(400);
      return { get value() { lateValueReads++; return candidate; } };
    }
    return handles[index];
  };
  const result = await readRawChannel(service, channelInput(), {}, 1100);
  assert.equal(result.coverage, 'partial'); assert.equal(prepares, k + 1);
  assert.deepEqual(result.items.map(item => item.handle), handles.slice(0, k));
  assert.deepEqual(result.items.map(item => item.rank), Array.from({ length: k }, (_, i) => i + 1));
  assert.equal(lateValueReads, 0, 'a prepare returned at cutoff is not inspected');
});

test('Raw timer snapshots a validated prefix while a prepare hangs and ignores its late result', async t => {
  channelClock(t); t.mock.timers.enable({ apis: ['setTimeout'] });
  const { candidates, handles, service } = syntheticChannel();
  let release, hung, prepares = 0, lateValueReads = 0;
  const started = new Promise(resolve => { hung = resolve; });
  service.prepare = candidate => {
    prepares++;
    if (candidate === candidates[0]) return handles[0];
    hung(); return new Promise(resolve => { release = resolve; });
  };
  const reading = readRawChannel(service, channelInput(), {}, 1100);
  await started; t.mock.timers.tick(400);
  const result = await reading;
  assert.equal(result.coverage, 'partial'); assert.deepEqual(result.items.map(item => item.handle), [handles[0]]);
  const before = [...result.items]; Object.freeze(result.items);
  release({ get value() { lateValueReads++; return candidates[1]; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(result.items, before); assert.equal(lateValueReads, 0); assert.equal(prepares, 2);
});

for (const invalid of ['outside-readSet', 'identity-mismatch', 'prepare-throws']) test(`Raw skips only the ${invalid} candidate`, async () => {
  const { candidates, handles, service } = syntheticChannel(); let prepares = 0;
  if (invalid === 'outside-readSet') candidates[1] = { ...candidates[1], namespace: { ...ns, ownerId: 'foreign-owner' } };
  service.prepare = async candidate => {
    prepares++; const index = candidates.indexOf(candidate);
    if (index === 1 && invalid === 'identity-mismatch') return { value: { ...candidate, messageId: 'wrong-turn' } };
    if (index === 1 && invalid === 'prepare-throws') throw Error('synthetic prepare failure');
    return handles[index];
  };
  const result = await readRawChannel(service, channelInput(), {}, performance.now() + 1000);
  assert.equal(result.coverage, 'partial');
  assert.deepEqual(result.items.map(item => item.handle), [handles[0], handles[2]]);
  assert.deepEqual(result.items.map(item => item.rank), [1, 2]);
  assert.equal(prepares, invalid === 'outside-readSet' ? 2 : 3);
});

for (const status of ['partial', 'unavailable', undefined]) test(`Raw uses candidates from non-complete search status ${status}`, async () => {
  const { candidates, handles, service } = syntheticChannel();
  service.search = async () => ({ coverage: { status }, candidates });
  const result = await readRawChannel(service, channelInput(), {}, performance.now() + 1000);
  assert.equal(result.coverage, 'partial'); assert.deepEqual(result.items.map(item => item.handle), handles);
  const assembled = assembleThreeLayerContext(packedArgs({ prepared: [] }), result);
  assert.equal(assembled.diagnostics.coverage.raw, 'partial'); assert.equal(assembled.metered.items.length, 3);
  assert.equal(assembled.metered.items.filter(item => item.date).length, 2); assert.ok(assembled.validateRaw());
});

test('unsupported Raw store stays unavailable and complete empty search stays included and Memory-only', async () => {
  const { candidates, service } = syntheticChannel(); let prepares = 0;
  service.prepare = () => { prepares++; throw Error('must not prepare'); };
  service.search = async () => ({ coverage: { status: 'unsupported_store' }, candidates });
  assert.deepEqual(await readRawChannel(service, channelInput(), {}, performance.now() + 1000), { items: [], coverage: 'unsupported_store' });
  service.search = async () => ({ coverage: { status: 'complete' }, candidates: [] });
  const empty = await readRawChannel(service, channelInput(), {}, performance.now() + 1000);
  assert.equal(empty.coverage, 'included'); assert.deepEqual(empty.items, []); assert.equal(prepares, 0);
  const args = packedArgs(), result = assembleThreeLayerContext(args, empty);
  assert.deepEqual(result.metered, assembleContext(args).metered); assert.equal(result.diagnostics.coverage.raw, 'included');
});

for (const error of [{ reason: 'deadline' }, { code: 'search_deadline' }, { code: 'read_timeout' }, { code: 'timeout' },
  { name: 'AbortError' }, { code: 'unexpected' }]) test(`Raw search error ${JSON.stringify(error)} retains its coverage classification`, async () => {
  const service = { search: async () => { throw Object.assign(Error('synthetic search failure'), error); } };
  assert.deepEqual(await readRawChannel(service, channelInput(), {}, performance.now() + 1000),
    { items: [], coverage: error.code === 'unexpected' ? 'unavailable' : 'partial' });
});

test('explicit raw:false skips configured Raw on all readers and retains dated Memory', async t => {
  const f = await fixture(t);
  await f.capture('telescope memory', { occurredAt: '2026-01-01T00:00:00.000Z' });
  ok(f.core.admit({ namespace: ns, memory: { content: 'telescope memory', kind: 'fact' }, receipts: [{
    client: 'synthetic-date', sessionId: 'dated', eventId: 'dated-memory', role: 'user', excerpt: 'telescope memory',
    occurredAt: '2026-01-01T00:00:00.000Z',
  }] }));
  await f.build();
  let rawCalls = 0;
  f.rawPort.search = () => { rawCalls++; throw Error('synthetic Raw unavailable'); };
  for (const read of f.readers()) {
    const before = rawCalls;
    const value = ok(await read(query('telescope', { raw: false })));
    assert.equal(value.metered.items[0].date, '2026-01-01T00:00Z');
    assert.equal(value.metered.items[0].evidence, undefined);
    assert.equal(rawCalls, before, 'explicit off never calls Raw');
    const unavailable = ok(await read(query('telescope')));
    assert.equal(rawCalls, before + 1);
    assert.deepEqual(unavailable.metered, value.metered); assert.equal(unavailable.snapshot, value.snapshot);
    assert.equal(unavailable.diagnostics.coverage.raw, 'unavailable');
    const legacy = ok(await read(query('telescope', { raw: false, representation: 'representation-v2' })));
    assert.equal(legacy.metered.items[0].date, undefined);
  }
});

test('cost-aware fill obeys token/item and byte caps, including zero and nonadditive counters', () => {
  const raw = syntheticRaw(Array.from({ length: 24 }, (_, i) => 'telescope assembly source ' + i + ' ' + '😀 evidence '.repeat(90)));
  for (const maxTokens of [64, 250, 1000, 6000]) for (const maxItems of [1, 3, 24]) {
    const args = packedArgs({ budget: { maxTokens, maxItems } }), result = assembleThreeLayerContext(args, raw);
    assert.ok(result.metered.items.length <= maxItems);
    assert.ok(counter.countTokens(meteredText(result.metered)) <= maxTokens);
    assert.equal(result.diagnostics.budget.used, counter.countTokens(meteredText(result.metered)));
    assert.ok(result.validateRaw());
  }
  const huge = packedArgs({ counter: { id: 'zero', countTokens: () => 0 }, prepared: Array.from({ length: 24 }, (_, i) => ({ ...fixedPrepared()[0],
    text: 'telescope ' + '界'.repeat(3500), rank: i + 1, ref: { ...fixedPrepared()[0].ref, memoryId: 'memory-' + i } })) });
  const predict = ({ meteredBytes, diagnostics, selected }) => completeResponseBytes({ ok: true, value: { metered: null, snapshot: null, diagnostics } },
    meteredBytes, selected.length ? selected.map(item => item.ref) : null) <= 65536;
  const value = assembleThreeLayerContext({ ...huge, responseBytes: predict, snapshotOf: items => items.length ? items.map(item => item.ref) : null }, raw);
  const { selected, validateRaw, ...envelope } = value;
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: envelope })) <= 65536);
  const nonlinear = { id: 'nonadditive', countTokens: text => Math.ceil(Buffer.byteLength(text) / 3) + (text.includes('telescope') ? 7 : 0) };
  const result = assembleThreeLayerContext(packedArgs({ counter: nonlinear, budget: { maxTokens: 1000, maxItems: 3 } }), raw);
  assert.ok(result.diagnostics.budget.used <= 1000); assert.equal(result.diagnostics.budget.used, nonlinear.countTokens(meteredText(result.metered)));
});

test('query windows cut only code points and find late Chinese matches', () => {
  for (const text of ['😀'.repeat(900) + '蛋餅地溝油的原因。', '無關文字'.repeat(900) + '蛋餅地溝油的原因。']) {
    const excerpt = queryExcerpt(text, '蛋餅地溝油', counter);
    assert.match(excerpt.body, /蛋餅地溝油/); assert.equal(text.slice(excerpt.start, excerpt.end), excerpt.body);
    assert.ok(excerpt.body.isWellFormed()); assert.ok(counter.countTokens(excerpt.body) <= 200);
  }
  assert.equal(ASSEMBLY_LIMITS.maxTokens, 6000); assert.equal(ASSEMBLY_LIMITS.responseBytes, 65536);
  assert.equal(countListQuestion('How many telescopes?'), true); assert.equal(countListQuestion('Which telescope?'), true);
  assert.equal(countListQuestion('How much earlier?'), false);
});


test('the actual product Worker accepts the host Raw port and default budget, with explicit off', async t => {
  const f = await fixture(t);
  await f.capture('worker telescope memory source', { occurredAt: '2026-01-01T08:00:00.000Z' });
  ok(f.core.admit({ namespace: ns, memory: { content: 'worker telescope memory source', kind: 'fact' }, receipts: [{
    client: 'synthetic-date', sessionId: 'dated', eventId: 'worker-dated-memory', role: 'user', excerpt: 'worker telescope memory source',
    occurredAt: '2026-01-01T08:00:00.000Z',
  }] }));
  await f.build();
  const configuredReader = configured(t, f.path, [ns]);
  configuredReader.options.wal = true;
  configuredReader.options.host.moduleUrl = new URL('../testing/context-read-three-layer-host.mjs', import.meta.url).href;
  configuredReader.options.host.configuration.rawText = 'worker telescope synthetic-fact';
  const reader = await configuredReader.open();
  const capabilities = ok(await reader.getContextReadCapabilities());
  assert.deepEqual(capabilities.assembly.raw, { default: true, configured: true });
  assert.equal(capabilities.assembly.representation, dated);
  const result = ok(await reader.contextRead(query('worker telescope', { deadlineMs: 5000 }), configuredReader.token));
  assert.equal(result.metered.items.length, 2); assert.match(result.metered.items[1].body, /synthetic-fact/);
  assert.deepEqual(result.metered.items.map(item => item.date), ['2026-01-01T08:00Z', '2026-01-03T08:00Z']);
  const off = ok(await reader.contextRead(query('worker telescope', { raw: false, deadlineMs: 5000 }), configuredReader.token));
  assert.equal(off.metered.items.length, 1); assert.match(off.metered.items[0].body, /memory source/);
});

test('Memories sharing a source turn and its Raw count as one item while snapshot keeps both refs', () => {
  const raw = syntheticRaw(['assembly telescope shared source']), key = raw.items[0].key;
  const prepared = fixedPrepared().slice(0, 2).map((item, i) => ({ ...item, turnIds: [key],
    text: i ? 'The telescope warranty covers rain damage.' : 'Assembly preference: choose the winter telescope.' }));
  const result = assembleThreeLayerContext(packedArgs({ prepared, budget: { maxTokens: 6000, maxItems: 1 } }), raw);
  assert.equal(result.metered.items.length, 1); assert.equal(result.selected.length, 2);
  assert.equal(result.metered.items[0].evidence.length, 1);
  assert.equal(JSON.parse(result.snapshot).length, 2);
  assert.match(result.metered.items[0].body, /winter telescope/); assert.match(result.metered.items[0].body, /rain damage/);
});


test('a budget-shaped Raw deadline degrades one read and leaves the service reusable', async () => {
  let interrupted = true;
  const service = { async search() {
    if (interrupted) throw Object.assign(Error('interrupted'), { reason: 'deadline', code: 'search_deadline' });
    return { coverage: { status: 'complete' }, candidates: [] };
  } };
  const input = contextInput('contextRead', query(), ['memory']).input;
  assert.deepEqual(await readRawChannel(service, input, {}, performance.now() + 1000), { items: [], coverage: 'partial' });
  interrupted = false;
  const next = await readRawChannel(service, input, {}, performance.now() + 1000);
  assert.equal(next.coverage, 'included');
  assert.equal(next.rawSearch, service);
});


test('Raw packing leaves time to return the Memory-only fallback before the read deadline', t => {
  let time = 100, moved = false;
  const previous = Object.getOwnPropertyDescriptor(performance, 'now');
  Object.defineProperty(performance, 'now', { configurable: true, value: () => time });
  t.after(() => Object.defineProperty(performance, 'now', previous));
  const advancing = { id: 'synthetic-one-delay', countTokens(text) {
    if (!moved && text.includes('raw-delay-marker')) { moved = true; time = 176; }
    return counter.countTokens(text);
  } };
  const args = packedArgs({ deadlineAt: 200, counter: advancing });
  const value = assembleThreeLayerContext(args, syntheticRaw(['raw-delay-marker telescope']));
  assert.equal(moved, true); assert.ok(time < args.deadlineAt);
  assert.equal(value.diagnostics.coverage.raw, 'partial');
  assert.deepEqual(value.metered, assembleContext(args).metered);
  assert.ok(!JSON.stringify(value.metered).includes('raw-delay-marker'));
});


test('expanded-source coalescing preserves the existing snapshot reference ceiling', () => {
  const raw = syntheticRaw(['assembly shared source']), template = fixedPrepared()[0];
  const prepared = Array.from({ length: 25 }, (_, i) => ({ ...template, rank: i + 1,
    ref: { ...template.ref, memoryId: 'expanded-' + i }, turnIds: [raw.items[0].key] }));
  const result = assembleThreeLayerContext(packedArgs({ prepared }), raw);
  assert.equal(result.diagnostics.coverage.raw, 'partial');
  assert.ok(result.selected.length <= 24);
  assert.ok(JSON.parse(result.snapshot).length <= 24);
  assert.ok(result.metered.items.every(item => item.ref.type === 'memory'));
});

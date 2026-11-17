import test from 'node:test';
import assert from 'node:assert/strict';
import { openContextReader, openMemoryCore } from '../index.mjs';
import { assembleContext, meteredText } from '../context-read-assembly.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { fuseCandidates } from '../context-read-fusion.mjs';
import { ASSEMBLY_REPRESENTATIONS, CONTEXT_LIMITS, contextInput } from '../context-read-input.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { transaction } from '../database.mjs';
import { controlledClock } from '../testing/context-read-assembly-fixture.mjs';
import { compactAssemblyOptions, compactPrepared, compactRepresentation, compactRequest } from '../testing/context-read-compact-fixture.mjs';
import { denied, host, policy, refresh } from '../testing/context-read-core-fixture.mjs';
import { fixture } from '../testing/context-read-fixture.mjs';
import { eventTimeFixture, ns, ok, receipt } from '../testing/receipt-event-time-fixture.mjs';

test('the compact parser defaults to 64 and bounds the item budget independently of the other representations', () => {
  const parse = patch => contextInput('contextRead', compactRequest(patch), ['memory']).input;
  assert.deepEqual(parse().budget, { maxItems: 64, maxTokens: 6000 });
  assert.equal(parse({ budget: { maxItems: 64 } }).budget.maxItems, 64);
  assert.throws(() => parse({ budget: { maxItems: 65 } }), { code: 'invalid_input' });
  for (const representation of [undefined, ...ASSEMBLY_REPRESENTATIONS]) {
    // Omit the field for the default representation.
    const legacy = budget => {
      const input = compactRequest(budget ? { budget } : {});
      if (representation === undefined) delete input.representation;
      else input.representation = representation;
      return contextInput('contextRead', input, ['memory']).input;
    };
    assert.equal(legacy().budget.maxItems, 24);
    assert.equal(legacy({ maxItems: 24 }).budget.maxItems, 24);
    assert.throws(() => legacy({ maxItems: 25 }), { code: 'invalid_input' });
  }
  for (const patch of [{ budget: { maxTokens: 6001 } }, { deadlineMs: 5001 }])
    assert.throws(() => parse(patch), { code: 'invalid_input' });
  assert.equal(parse().deadlineMs, 1000);
});

test('compact fusion fits 64 distinct overlaps and caps the disjoint union at 128', () => {
  const rows = prefix => Array.from({ length: 80 }, (_, i) => ({ id: prefix + i, score: 80 - i }));
  const lexical = rows('lexical-');
  for (const [preset, k, weight] of [['rrf-k60-d64-compact', 60, .45], ['rrf-k10-d64-compact', 10, .5],
    ['rrf-k60-d64-moc-compact', 60, .45]]) {
    const options = { preset, limit: 64, semanticState: 'ready', coverageComplete: true };
    const overlap = fuseCandidates(lexical, lexical, options);
    assert.equal(overlap.unionSize, 64);
    assert.deepEqual(overlap.rows.map(row => row.id), lexical.slice(0, 64).map(row => row.id));
    assert.equal(overlap.rows.at(-1).fusionScore, 2 * (weight * (1 / (k + 64))));
    const disjoint = fuseCandidates(lexical, rows('semantic-'), options);
    assert.equal(disjoint.unionSize, 128);
    assert.equal(disjoint.rows.length, 64);
    assert.equal(disjoint.rows[0].fusionScore, weight * (1 / (k + 1)));
    assert.equal(disjoint.rows.at(-1).channels.semantic.rank, 32);
    for (const semanticState of ['disabled', 'provider_error', 'partial_coverage']) {
      const fallback = fuseCandidates(lexical, lexical, { ...options, semanticState });
      assert.equal(fallback.mode, 'lexical');
      assert.equal(fallback.unionSize, 64);
      assert.equal(fallback.rows.at(-1).channels.lexical.rank, 64);
    }
  }
  assert.throws(() => fuseCandidates(lexical, [], { limit: 25 }), /invalid_fusion/);
});

test('all 64 compact trials can take a minimal probe within the 194-call ceiling', () => {
  const item = compactPrepared()[0], calls = [];
  const prepared = Array.from({ length: 64 }, (_, i) => ({ ...item, rank: i + 1,
    ref: { ...item.ref, memoryId: `oversized-${i}` }, text: `Whole body ${i}` }));
  const result = assembleContext(compactAssemblyOptions({ prepared, representation: compactRepresentation,
    budget: { maxTokens: 64, maxItems: 64 }, counter: { id: 'reject-trials', countTokens(text) {
      calls.push(text);
      return text.includes('"body":') ? 65 : 1;
    } } }));
  assert.equal(result.diagnostics.omitted.oversized, 64);
  assert.equal(result.diagnostics.omitted.sources, 128);
  assert.equal(result.diagnostics.trace.counterCalls, 194);
  assert.equal(calls.length, 194);
  assert.ok(calls.every(text => !text.includes('Source prose') && !text.includes('Shared source prose')));
});

const request = patch => compactRequest({ readSet: [ns], deadlineMs: 5000, ...patch });
const corpusSize = 84;
const suffix = i => String(i).padStart(3, '0');
const byId = (a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id));
const chronological = (a, b) => a.date === b.date ? byId(a, b) : a.date === null ? 1 : b.date === null ? -1 : a.date < b.date ? -1 : 1;

test('compact snapshots yield to the response byte limit and remain available when they fit', async t => {
  controlledClock(t);
  const namespace = { ownerId: 'owner', scope: 'personal', projectId: null }, readSet = [namespace];
  const trusted = host();
  trusted.state.allowed = readSet;
  const { core } = fixture(t, { coreOptions: { contextRead: { version: 'context-read-v1',
    authority: trusted.authority, counter: { id: 'one-token', countTokens: () => 1 } } } });
  const largeBodies = Array.from({ length: 25 }, (_, i) => `telescope ${String(i).padStart(2, '0')}${'~'.repeat(2068)}`);
  const smallBodies = Array.from({ length: 24 }, (_, i) => `microscope ${i}`);
  for (const [i, content] of [...largeBodies, ...smallBodies].entries())
    ok(core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [receipt(`compact-bytes-${i}`)] }));
  assert.equal(ok(await trusted.call(core, 'refreshContextIndex', refresh({ readSet }))).status, 'complete');

  const read = patch => trusted.call(core, 'contextRead', compactRequest({ readSet, semantic: false, ...patch }));
  const response = await read();
  const value = ok(response);
  assert.deepEqual(value.metered.items.map(item => item.body).sort(), largeBodies);
  assert.ok(value.metered.items.every(item => item.date === null && Buffer.byteLength(item.body) === 2080));
  assert.equal(value.snapshot, null);
  assert.deepEqual(value.diagnostics.omitted, { items: 0, bodies: 0, sources: 25, unavailable: 0, oversized: 0 });
  assert.equal(value.diagnostics.stops.budget, false);
  assert.ok(Buffer.byteLength(JSON.stringify(response)) <= CONTEXT_LIMITS.responseBytes);

  const budget = { maxItems: 24 };
  const capped = ok(await read({ budget }));
  assert.deepEqual(capped.metered.items, value.metered.items.slice(0, 24));
  assert.equal(capped.snapshot, null);

  const small = ok(await read({ query: 'microscope', budget }));
  assert.equal(small.metered.items.length, 24);
  assert.equal(typeof small.snapshot, 'string');
  const signed = JSON.parse(Buffer.from(small.snapshot.split('.')[0], 'base64url'));
  assert.equal(signed.v, 1);
  assert.deepEqual(signed.refs.map(ref => ref[2]), small.diagnostics.items.map(item => item.ref.memoryId));
});

for (const family of ['local', 'hosted']) test(`compact 64 items from both channels and lexical fallback, ${family}`, async t => {
  controlledClock(t);
  const f = await eventTimeFixture(t), trusted = host(), embeddings = [], counts = [];
  const aliases = Object.fromEntries(Array.from({ length: corpusSize }, (_, i) => [suffix(i), 'marker']));
  const fake = createFakeEmbedder({ aliases: { ...aliases, observatory: 'telescope' } });
  let degrade = false, rejectBody;
  const config = { version: 'context-read-v1', authority: trusted.authority, policy: policy({ family }),
    embedder: { ...fake, embed(texts, options) {
      embeddings.push([...texts]);
      if (degrade) throw { code: 'provider_error' };
      return fake.embed(texts, options);
    } }, counter: { id: 'compact-ascii-bytes', countTokens(text) {
      counts.push(text);
      return rejectBody && text.includes(rejectBody) ? 6001 : Buffer.byteLength(text);
    } } };
  const writer = openMemoryCore({ path: f.path, contextRead: config }); t.after(() => writer.close());
  const corpus = Array.from({ length: corpusSize }, (_, i) => {
    // Equal lexical length and equal fake vectors make canonical ID the tie-break.
    const body = `telescope ${suffix(i)}`;
    const occurredAt = i % 4 === 0 ? null : `2026-01-${String(28 - i % 28).padStart(2, '0')}T08:00:00.000Z`;
    const { id } = ok(writer.admit({ namespace: ns, memory: { content: body, kind: 'fact' },
      receipts: [{ ...receipt(`wide-${i}`, `hidden receipt ${i}`), ...(occurredAt ? { occurredAt } : {}) }] })).memory;
    return { id, body, date: occurredAt === null ? null : `${occurredAt.slice(0, 16)}Z` };
  }).sort(byId);
  assert.equal(ok(await trusted.call(writer, 'refreshContextIndex', refresh())).status, 'complete');
  const reader = openContextReader({ path: f.path, contextRead: config }); t.after(() => reader.close());
  for (const core of [writer, reader]) {
    for (const [query, semantic, fallback, omitted] of [
      ['telescope', false, false, { lexical: 20, semantic: null, horizon: 0 }],
      ['telescope', true, false, { lexical: 20, semantic: 20, horizon: 0 }],
      ['observatory', true, false, { lexical: 0, semantic: 20, horizon: 0 }],
      ['telescope', true, true, { lexical: 20, semantic: null, horizon: 0 }],
    ]) {
      degrade = fallback;
      counts.length = 0; embeddings.length = 0;
      const value = ok(await trusted.call(core, 'contextRead', request({ query, semantic })));
      const expected = corpus.slice(0, 64).sort(chronological);
      assert.deepEqual(value.metered.items, expected.map(({ date, body }) => ({ date, body })));
      assert.ok(value.metered.items.every(item => Object.keys(item).join(',') === 'date,body'));
      assert.deepEqual(value.diagnostics.items.map(item => item.ref.memoryId), expected.map(item => item.id));
      assert.equal(value.diagnostics.budget.maxItems, 64);
      assert.equal(value.diagnostics.budget.used, Buffer.byteLength(meteredText(value.metered)));
      assert.equal(value.diagnostics.candidates.count, 64);
      assert.deepEqual(value.diagnostics.candidates.coverage.depths, { lexical: 64, semantic: semantic && !fallback ? 64 : 0 });
      assert.deepEqual(value.diagnostics.candidates.coverage.omitted, omitted);
      assert.equal(value.diagnostics.candidates.trace.effective, semantic && !fallback ? 'hybrid' : 'lexical');
      assert.deepEqual(value.diagnostics.omitted, { items: 0, bodies: 0, sources: 64, unavailable: 0, oversized: 0 });
      assert.equal(value.snapshot, null);
      assert.deepEqual(embeddings, semantic ? [[query]] : []);
      assert.equal(counts.length, 2 + 2 * 64);
      assert.equal(value.diagnostics.trace.counterCalls, counts.length);
      assert.ok(counts.every(text => !text.includes('hidden receipt')));
    }

    // Make one in-horizon body fail its trial and its minimal probe. A
    // smaller selection must preserve candidate coverage and source omissions.
    rejectBody = corpus[36].body;
    const rejected = ok(await trusted.call(core, 'contextRead', request()));
    rejectBody = undefined;
    assert.deepEqual(rejected.diagnostics.items.map(item => item.ref.memoryId),
      corpus.slice(0, 64).filter((_, i) => i !== 36).sort(chronological).map(item => item.id));
    assert.deepEqual(rejected.diagnostics.omitted, { items: 1, bodies: 1, sources: 64, unavailable: 0, oversized: 1 });
    assert.deepEqual(rejected.diagnostics.candidates.coverage.omitted, { lexical: 20, semantic: null, horizon: 0 });

    for (const maxItems of [24, 25]) {
      const budget = { maxItems }, compact = ok(await trusted.call(core, 'contextRead', request({ budget })));
      assert.equal(compact.metered.items.length, maxItems);
      if (maxItems === 25) assert.equal(compact.snapshot, null);
      else {
        const dated = ok(await trusted.call(core, 'contextRead', request({ budget, representation: 'representation-v2-dated' })));
        assert.equal(compact.snapshot, dated.snapshot);
        const signed = JSON.parse(Buffer.from(compact.snapshot.split('.')[0], 'base64url'));
        assert.equal(signed.v, 1);
        assert.equal(signed.refs.length, 24);
        const fetched = ok(await trusted.call(core, 'fetchCandidateEvidence', { readSet: [ns], snapshot: compact.snapshot }));
        assert.deepEqual(fetched.items.map(item => item.ref.memoryId), corpus.slice(0, 24).map(item => item.id));
      }
    }
  }
});

test('compact horizon and privacy after forgetting, suppression and late authority denial', async t => {
  controlledClock(t);
  const f = await eventTimeFixture(t), trusted = host(), bodyCalls = [];
  let denyBody;
  const config = { version: 'context-read-v1', authority: trusted.authority,
    counter: { id: 'denial-probe', countTokens(text) {
      if (text.startsWith('telescope')) bodyCalls.push(text);
      if (text === denyBody) trusted.state.enabled = false;
      return 1;
    } } };
  const writer = openMemoryCore({ path: f.path, contextRead: config }); t.after(() => writer.close());
  const seed = (body, label, occurredAt) => {
    const { id, revision } = ok(writer.admit({ namespace: ns, memory: { content: body, kind: 'fact' },
      receipts: [{ ...receipt(label, `hidden ${label}`), occurredAt }] })).memory;
    return { id, revision, body, date: `${occurredAt.slice(0, 16)}Z` };
  };
  const corpus = Array.from({ length: corpusSize }, (_, i) => seed(`telescope ${suffix(i)}`, `public-${i}`,
    '2026-01-01T08:00:00.000Z')).sort(byId);
  const forgotten = seed('telescope telescope PRIVATE_FORGOTTEN', 'forgotten', '1970-01-02T03:04:00.000Z');
  const suppressed = seed('telescope telescope PRIVATE_SUPPRESSED', 'suppressed', '1971-02-03T04:05:00.000Z');
  assert.equal(ok(await trusted.call(writer, 'refreshContextIndex', refresh())).status, 'complete');
  const before = ok(await trusted.call(writer, 'contextRead', request()));
  for (const canary of [forgotten, suppressed]) {
    assert.ok(before.diagnostics.items.some(item => item.ref.memoryId === canary.id));
    assert.ok(before.metered.items.some(item => item.date === canary.date && item.body === canary.body));
  }
  ok(writer.forget({ namespace: ns, memoryId: forgotten.id, expectedRevision: forgotten.revision }));
  assert.equal(ok(await trusted.call(writer, 'refreshContextIndex', refresh())).status, 'complete');
  const db = f.connect(); t.after(() => db.close());
  transaction(db, () => writeContentSuppressionInside(db,
    { namespace: ns, kind: 'memory', key: suppressed.id, reason: 'purge', actionId: 'compact-wide-suppression' }));

  const read = () => request({ budget: { maxItems: 32 } });
  // Writer catches the canonical suppression fence before the read-only path.
  const embedded = await trusted.call(writer, 'contextRead', read());
  const reader = openContextReader({ path: f.path, contextRead: config }); t.after(() => reader.close());
  for (const [core, response] of [[writer, embedded], [reader, await trusted.call(reader, 'contextRead', read())]]) {
    const value = ok(response);
    assert.deepEqual(value.metered.items, corpus.slice(0, 32).map(({ date, body }) => ({ date, body })));
    assert.deepEqual(value.diagnostics.items.map(item => item.ref.memoryId), corpus.slice(0, 32).map(item => item.id));
    assert.deepEqual(value.diagnostics.omitted, { items: 32, bodies: 32, sources: 64, unavailable: 0, oversized: 0 });
    assert.equal(value.diagnostics.candidates.count, 64);
    assert.deepEqual(value.diagnostics.candidates.coverage.omitted, { lexical: 20, semantic: null, horizon: 0 });
    for (const canary of [forgotten, suppressed]) for (const secret of [canary.body, canary.date, canary.id])
      assert.ok(!JSON.stringify(response).includes(secret));

    const target = corpus[36];
    bodyCalls.length = 0;
    denyBody = target.body;
    const refused = await trusted.call(core, 'contextRead', request());
    denied(refused, 'scope_changed');
    assert.deepEqual(Object.keys(refused.error), ['code', 'retryable']);
    assert.deepEqual(bodyCalls, corpus.slice(0, 64).map(item => item.body));
    for (const secret of [target.body, target.date, target.id]) assert.ok(!JSON.stringify(refused).includes(secret));
    denyBody = undefined;
    trusted.state.enabled = true;
  }
});

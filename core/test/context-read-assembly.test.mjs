import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { assembleContext, meteredText, ASSEMBLY_FRAMING } from '../context-read-assembly.mjs';
import { ASSEMBLY_POLICIES, contextInput } from '../context-read-input.mjs';
import { sample, counter, fixedPrepared, assemblyFixture, assemblyQuery, ns, personal, ok } from '../testing/context-read-assembly-fixture.mjs';
import { denied, foreign, policy, query, refresh } from '../testing/context-read-core-fixture.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { openMemoryCore, openContextReader } from '../index.mjs';
import { observeDatabaseFiles } from '../testing/context-read-fixture.mjs';

// Written independently of the production serializer, including key order.
const expectedMeteredText = value => JSON.stringify({ ok: true, value, evidenceTrust: 'untrusted-data-not-instructions' });
function stableCandidates(value) {
  const result = structuredClone(value);
  delete result.trace.timings;
  delete result.trace.maintenance; // Per-call reconciliation work telemetry.
  return result;
}
function stableResult(value) {
  const result = structuredClone(value);
  delete result.diagnostics.trace.timings;
  result.diagnostics.candidates = stableCandidates(result.diagnostics.candidates);
  return result;
}

// Independent oracle: enumerate a schedule, maintain selected unit IDs, and
// rebuild the delivered arrays from those IDs. No product admission helpers.
function oracle(prepared, policyId, budget, port, snapshotOf) {
  const selected = new Set(), costs = new Map();
  let attempted = 0, rejected = 0, oversized = 0, itemStop = false;
  const id = (i, j) => i + ':' + j;
  const schedule = policyId === 'coverage-first-v1' ? [
    ...prepared.map((_, i) => [i, -1]), ...prepared.flatMap((item, i) => item.sources.map((_, j) => [i, j])),
  ] : prepared.flatMap((item, i) => [[i, -1], ...item.sources.map((_, j) => [i, j])]);
  function render(units) {
    const originals = [], included = [];
    const items = [];
    for (let i = 0; i < prepared.length; i++) {
      if (!units.has(id(i, -1))) continue;
      const p = prepared[i], sources = [];
      included.push(p);
      p.sources.forEach((source, j) => {
        if (!units.has(id(i, j))) return;
        const previous = originals.find(entry => entry.role === source.role && entry.excerpt === source.excerpt);
        if (previous) sources.push({ index: source.index, sameAs: { item: previous.item, source: previous.source } });
        else {
          originals.push({ role: source.role, excerpt: source.excerpt, item: items.length, source: sources.length });
          sources.push({ index: source.index, role: source.role, excerpt: source.excerpt, tokens: costs.get(id(i, j)) });
        }
      });
      items.push({ ref: p.ref, rank: p.rank, type: p.type, metadata: p.metadata,
        body: { text: p.text, tokens: costs.get(id(i, -1)) }, sources, sourceAccess: p.sourceAccess,
        sourcesComplete: p.sourceAccess === 'available' && p.sourcesComplete && sources.length === p.sources.length });
    }
    return { version: 'context-read-v1', policy: { id: policyId }, representation: 'representation-v1',
      counter: { id: port.id }, framing: ASSEMBLY_FRAMING, items, snapshot: items.length ? snapshotOf(included) : null };
  }
  if (port.countTokens(expectedMeteredText(render(selected))) > budget.maxTokens) return null;
  for (const [i, j] of schedule) {
    if (j >= 0 && !selected.has(id(i, -1))) continue;
    if (j < 0 && prepared.filter((_, k) => selected.has(id(k, -1))).length >= budget.maxItems) { itemStop = true; continue; }
    attempted++;
    costs.set(id(i, j), port.countTokens(j < 0 ? prepared[i].text : prepared[i].sources[j].excerpt));
    const trial = new Set([...selected, id(i, j)]);
    if (port.countTokens(expectedMeteredText(render(trial))) <= budget.maxTokens) selected.add(id(i, j));
    else {
      rejected++;
      const minimal = new Set([id(i, -1), id(i, j)]);
      if (port.countTokens(expectedMeteredText(render(minimal))) > budget.maxTokens) oversized++;
    }
  }
  const metered = render(selected), bodies = prepared.length - metered.items.length;
  const sources = metered.items.flatMap(item => item.sources);
  return { metered, omitted: { items: bodies, bodies, sources: prepared.reduce((n, item) => n + item.sources.length, 0) - sources.length,
    unavailable: 0, oversized }, dedup: { sources: sources.filter(source => source.sameAs).length },
    stops: { budget: rejected > 0, items: itemStop || metered.items.length === budget.maxItems, deadline: false }, attempted, rejected };
}
const fixedSnapshot = items => 'snapshot:' + items.map(item => item.ref.memoryId).join(',');
function invariant(result, port, maxTokens) {
  assert.equal(result.diagnostics.budget.used, port.countTokens(expectedMeteredText(result.metered)));
  assert.ok(result.diagnostics.budget.used <= maxTokens);
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: result })) <= 65536);
  assert.ok(Object.isFrozen(result.metered));
  result.metered.items.forEach((item, i) => item.sources.forEach((source, j) => {
    if (source.sameAs) {
      assert.ok(source.sameAs.item < i || source.sameAs.item === i && source.sameAs.source < j);
      assert.equal(result.metered.items[source.sameAs.item].sources[source.sameAs.source].sameAs, undefined);
    }
  }));
}

test('A02 pinned HR-2 section 6 hashes, schedules and greedy skip-and-continue match the product', () => {
  const section = readFileSync(new URL('./fixtures/context-read/hr2-protocol-section6.md', import.meta.url), 'utf8');
  assert.equal(sample.protocol.commit, 'c863e9d6');
  assert.equal(sample.protocol.section6File, 'hr2-protocol-section6.md');
  assert.equal(createHash('sha256').update(section).digest('hex'), sample.protocol.section6Sha256);
  assert.ok(section.includes('| P-top | for each item in rank order: its body, then its spans in order (rank-first whole-unit) |'));
  assert.ok(section.includes('| P-cover | body of every item in order | all spans, item order then span order |'));
  assert.ok(section.includes('otherwise it skips that unit and continues'));
  for (const policyId of ASSEMBLY_POLICIES) {
    const prepared = fixedPrepared().slice(0, 4), seen = [];
    assembleContext({ prepared, policy: { id: policyId }, budget: { maxTokens: 4000, maxItems: 24 },
      counter: { id: 'schedule', countTokens(text) { if (!text.startsWith('{')) seen.push(text); return 0; } },
      snapshotOf: fixedSnapshot, deadlineAt: Infinity });
    const expected = policyId === 'rank-first-whole-v1' ? prepared.flatMap(item => [item.text, ...item.sources.map(source => source.excerpt)]) :
      [...prepared.map(item => item.text), ...prepared.flatMap(item => item.sources.map(source => source.excerpt))];
    assert.deepEqual(seen, expected);
  }
});

test('A03/A09 metered serialization matches a literal known answer independently of the oracle', () => {
  const value = { version: 'context-read-v1', policy: { id: 'rank-first-whole-v1' }, representation: 'representation-v1',
    counter: { id: 'test' }, framing: 'quoted "line"\n界', items: [], snapshot: null };
  const known = String.raw`{"ok":true,"value":{"version":"context-read-v1","policy":{"id":"rank-first-whole-v1"},"representation":"representation-v1","counter":{"id":"test"},"framing":"quoted \"line\"\n界","items":[],"snapshot":null},"evidenceTrust":"untrusted-data-not-instructions"}`;
  assert.equal(expectedMeteredText(value), known);
  assert.equal(meteredText(value), known);
});

test('A02–A05 independent oracle compares every represented unit, snapshot, omission and cap across frozen rankings', () => {
  let bindingCases = 0;
  for (const order of sample.rankings) for (const policyId of ASSEMBLY_POLICIES) for (const maxTokens of sample.budgets) for (const maxItems of [1, 3, 24]) {
    const prepared = fixedPrepared(order), budget = { maxTokens, maxItems };
    const expected = oracle(prepared, policyId, budget, counter, fixedSnapshot);
    const run = () => assembleContext({ prepared, policy: { id: policyId }, budget, counter, snapshotOf: fixedSnapshot, deadlineAt: Infinity });
    if (!expected) { assert.throws(run, { code: 'context_item_too_large' }); continue; }
    const actual = run();
    assert.deepEqual(actual.metered, expected.metered);
    assert.deepEqual(actual.diagnostics.omitted, expected.omitted);
    assert.deepEqual(actual.diagnostics.dedup, expected.dedup);
    assert.deepEqual(actual.diagnostics.stops, expected.stops);
    assert.equal(actual.diagnostics.trace.counterCalls, 2 + 2 * expected.attempted + expected.rejected);
    invariant(actual, counter, maxTokens);
    if (expected.rejected) bindingCases++;
    for (const item of actual.metered.items) assert.equal(item.body.text, prepared.find(p => p.ref.memoryId === item.ref.memoryId).text);
  }
  assert.ok(bindingCases > 0);
});

test('A03/A04/A09 nonadditive whole-envelope counting, long whole bodies, capped receipts, alias indices and deadline boundaries', () => {
  const prepared = fixedPrepared(), port = { id: 'all-fit', countTokens: () => 1 };
  const all = assembleContext({ prepared, policy: { id: 'coverage-first-v1' }, budget: { maxTokens: 64, maxItems: 24 },
    counter: port, snapshotOf: fixedSnapshot, deadlineAt: Infinity });
  invariant(all, port, 64);
  assert.equal(all.metered.items.at(-1).sources.length, 16);
  assert.equal(all.metered.items.at(-1).sourcesComplete, false);
  assert.equal(all.metered.items[0].sourcesComplete, true);
  assert.equal(all.diagnostics.omitted.sources, 0, '17th receipt is outside the universe');
  assert.deepEqual(all.metered.items[2].sources[1], { index: 1, sameAs: { item: 1, source: 0 } });
  assert.equal(all.metered.items[2].sources[0].sameAs, undefined, 'same client/session/event with different text stays concrete');
  const capped = assembleContext({ prepared: prepared.slice(1, 4), policy: { id: 'coverage-first-v1' }, budget: { maxTokens: 64, maxItems: 1 },
    counter: port, snapshotOf: fixedSnapshot, deadlineAt: Infinity });
  assert.equal(capped.metered.items.length, 1); assert.equal(capped.metered.items[0].sources.length, 1);
  assert.equal(capped.diagnostics.stops.items, true); assert.equal(capped.diagnostics.omitted.bodies, 2);
  const roles = structuredClone(prepared.slice(1, 3)); roles[1].sources[1].role = 'assistant';
  const differentRole = assembleContext({ prepared: roles, policy: { id: 'rank-first-whole-v1' }, budget: { maxTokens: 64, maxItems: 24 },
    counter: port, snapshotOf: fixedSnapshot, deadlineAt: Infinity });
  assert.equal(differentRole.diagnostics.dedup.sources, 0, 'equal excerpt with a different role stays concrete');
  assert.ok(counter.countTokens(prepared.at(-1).text) > 4000);
  let clock = 0, calls = 0;
  const expires = { id: 'expiry', countTokens(text) { calls++; if (calls === 4) clock = 10; return text.length; } };
  const stopped = assembleContext({ prepared, policy: { id: 'rank-first-whole-v1' }, budget: { maxTokens: 4000, maxItems: 24 },
    counter: expires, snapshotOf: fixedSnapshot, deadlineAt: 5, now: () => clock });
  assert.equal(stopped.diagnostics.stops.deadline, true); assert.equal(calls, 5, 'unit count that expires is followed only by final metering');
  assert.equal(stopped.metered.items.length, 1); assert.equal(stopped.diagnostics.omitted.bodies, 17);
  assert.equal(stopped.diagnostics.omitted.sources, prepared.reduce((n, item) => n + item.sources.length, 0));
  let before = 0;
  const alreadyExpired = assembleContext({ prepared, policy: { id: 'coverage-first-v1' }, budget: { maxTokens: 4000, maxItems: 24 },
    counter: { id: 'expired', countTokens() { before++; return 0; } }, snapshotOf: fixedSnapshot, deadlineAt: 0, now: () => 0 });
  assert.equal(before, 2); assert.equal(alreadyExpired.metered.snapshot, null);
  assert.equal(alreadyExpired.diagnostics.omitted.bodies, 18);
  const nonadditive = { id: 'nonadditive', countTokens: text => text.startsWith('{') ? 500 + Math.ceil(text.length / 3) : 9999 };
  const value = assembleContext({ prepared: prepared.slice(0, 4), policy: { id: 'rank-first-whole-v1' }, budget: { maxTokens: 1500, maxItems: 24 },
    counter: nonadditive, snapshotOf: fixedSnapshot, deadlineAt: Infinity });
  invariant(value, nonadditive, 1500); assert.ok(value.metered.items.length > 0);
});

test('A09 deadline expiry during trial and minimal envelopes stops admission and retains final metering', () => {
  for (const policyId of ASSEMBLY_POLICIES) for (const stage of ['trial', 'minimal']) {
    const prepared = fixedPrepared().slice(0, 2), counted = [];
    let clock = 0, expiredAt = null;
    const port = { id: 'envelope-expiry', countTokens(text) {
      counted.push(text);
      if (!text.startsWith('{')) return 1;
      const items = JSON.parse(text).value.items;
      if (stage === 'trial' && items.length === 1) { clock = 10; expiredAt ??= counted.length; }
      if (stage === 'minimal') {
        if (items.length === 2) return 5000; // Reject the second body's trial.
        if (items.length === 1 && items[0].ref.memoryId === prepared[1].ref.memoryId) {
          clock = 10; expiredAt = counted.length; return 5000;
        }
      }
      return 1;
    } };
    const actual = assembleContext({ prepared, policy: { id: policyId }, budget: { maxTokens: 64, maxItems: 24 },
      counter: port, snapshotOf: fixedSnapshot, deadlineAt: 10, now: () => clock });
    assert.equal(actual.diagnostics.stops.deadline, true);
    assert.equal(counted.length, expiredAt + 1, 'only mandatory final metering follows expiry');
    assert.equal(counted.at(-1), expectedMeteredText(actual.metered));
    assert.equal(actual.diagnostics.trace.counterCalls, stage === 'trial' ? 4 : 7);
    assert.equal(actual.metered.items.length, stage === 'trial' ? 0 : 1);
    assert.deepEqual(actual.diagnostics.omitted, { items: stage === 'trial' ? 2 : 1, bodies: stage === 'trial' ? 2 : 1,
      sources: 1, unavailable: 0, oversized: stage === 'trial' ? 0 : 1 });
    assert.equal(actual.diagnostics.stops.budget, stage === 'minimal');
    invariant(actual, port, 64);
  }
});

test('A04 product receipts use created_at then id, cap the universe at 16 and mark incomplete coverage', async t => {
  const definition = sample.receiptOrderCase;
  const order = definition.receiptOrder;
  assert.deepEqual(order, definition.receiptStorage.map((_, i) => i).sort((a, b) =>
    definition.receiptStorage[a].createdAt.localeCompare(definition.receiptStorage[b].createdAt) ||
    definition.receiptStorage[a].id.localeCompare(definition.receiptStorage[b].id)));
  const idOnly = definition.receiptStorage.map((_, i) => i).sort((a, b) => definition.receiptStorage[a].id.localeCompare(definition.receiptStorage[b].id));
  assert.notDeepEqual(order, idOnly, 'timestamp order deliberately conflicts with ID order');
  assert.notDeepEqual(order, definition.receipts.map((_, i) => i), 'timestamp ties require the ID tiebreak');
  const port = { id: 'synthetic-quarter-bytes', countTokens: text => Math.ceil(Buffer.byteLength(text) / 4) };
  const f = assemblyFixture(t, { counter: port }), [{ memory }] = f.seed([definition]);
  const expected = order.slice(0, 16).map((ordinal, index) => ({ index, role: definition.receipts[ordinal].role,
    excerpt: definition.receipts[ordinal].excerpt, tokens: port.countTokens(definition.receipts[ordinal].excerpt) }));
  for (const policyId of ASSEMBLY_POLICIES) for (const intent of ['current', 'history']) {
    const actual = ok(await f.call('contextRead', assemblyQuery({ intent, policy: { id: policyId }, budget: { maxTokens: 4000, maxItems: 24 } })));
    invariant(actual, port, 4000);
    assert.equal(actual.metered.items.length, 1); assert.equal(actual.metered.items[0].ref.memoryId, memory.id);
    assert.equal(actual.metered.items[0].body.text, definition.text);
    assert.deepEqual(actual.metered.items[0].sources, expected);
    assert.equal(actual.metered.items[0].sourcesComplete, false);
    assert.deepEqual(actual.diagnostics.omitted, { items: 0, bodies: 0, sources: 0, unavailable: 0, oversized: 0 });
    assert.equal(actual.diagnostics.dedup.sources, 0); assert.equal(actual.diagnostics.stops.budget, false);
    assert.equal(expectedMeteredText(actual.metered).includes(definition.receipts[order[16]].excerpt), false);
  }
  const reject = assemblyFixture(t, { counter: { id: 'reject-nonempty', countTokens(text) {
    return text.startsWith('{') && JSON.parse(text).value.items.length ? 5000 : 1;
  } } });
  reject.seed([definition]);
  for (const policyId of ASSEMBLY_POLICIES) {
    const actual = ok(await reject.call('contextRead', assemblyQuery({ policy: { id: policyId }, budget: { maxTokens: 64, maxItems: 24 } })));
    assert.deepEqual(actual.metered.items, []);
    assert.deepEqual(actual.diagnostics.omitted, { items: 1, bodies: 1, sources: 16, unavailable: 0, oversized: 1 });
  }
});

test('A01/A07/A09 capabilities, optional counter, strict input, payload binding and allowlists', async t => {
  const f = assemblyFixture(t); f.admit('assembly fact');
  const caps = ok(f.context.getContextReadCapabilities());
  assert.ok(caps.methods.includes('contextRead')); assert.ok(!caps.unsupported.includes('assembly'));
  assert.deepEqual(caps.assembly.policies, ASSEMBLY_POLICIES); assert.deepEqual(caps.assembly.counter, { id: counter.id });
  assert.equal(caps.assembly.defaultPolicy, 'rank-first-whole-v1');
  const bare = assemblyFixture(t, { counter: null });
  assert.equal(ok(bare.context.getContextReadCapabilities()).assembly.counter, null);
  const absent = await bare.call('contextRead', assemblyQuery()); denied(absent, 'invalid_input');
  assert.deepEqual(absent.error.details, { counter: 'absent' });
  ok(await bare.call('findCandidates', query()));
  for (const patch of [{ cursor: 'no' }, { policy: 'coverage-first-v1' }, { policy: {} }, { policy: { id: 'other' } },
    { policy: { id: 'rank-first-whole-v1', extra: true } }, { budget: { maxTokens: 63 } }, { budget: { maxTokens: 4001 } },
    { budget: { maxItems: 0 } }, { budget: { maxItems: 25 } }, { budget: { maxMs: 1 } }, { query: '\0' }, { semantic: 1 }, { intent: 'guess' }]) {
    denied(await f.call('contextRead', assemblyQuery(patch)), 'invalid_input');
  }
  denied(await f.context.contextRead(assemblyQuery(), f.trusted.token('findCandidates', assemblyQuery())), 'authority_required');
  denied(await f.context.contextRead(assemblyQuery({ budget: { maxTokens: 4000 } }), f.trusted.token('contextRead', assemblyQuery())), 'authority_required');
  f.trusted.state.methods.delete('contextRead'); denied(await f.call('contextRead', assemblyQuery()), 'authority_required');
  f.trusted.state.methods.add('contextRead');
  f.trusted.state.allowed = [ns]; denied(await f.call('contextRead', assemblyQuery({ readSet: [ns, personal] })), 'authority_required');
  for (const countTokens of [null, () => { throw Error('secret'); }, () => -1, () => .5, () => NaN, async () => 1]) {
    const invalid = assemblyFixture(t, { counter: { id: 'bad', countTokens } });
    const result = await invalid.call('contextRead', assemblyQuery()); denied(result, 'token_count_unavailable');
    assert.equal(JSON.stringify(result).includes('secret'), false);
  }
  assert.throws(() => f.reopen({ counter: { id: '', countTokens: () => 0 } }), { code: 'invalid_input' });
  assert.throws(() => contextInput('contextRead', assemblyQuery({ policy: { id: 'rank-first-whole-v1', counter: 1 } }), ['memory']), { code: 'invalid_input' });
});

// Independently derive the §13 snapshot encoding from canonical evidence and
// store metadata, so the oracle measures the exact product snapshot each trial.
function canonicalOracle(f, horizon, definitions, readSet, intent) {
  const ordered = [...readSet].sort((a, b) => Buffer.compare(Buffer.from(JSON.stringify([a.ownerId, a.scope, a.projectId])), Buffer.from(JSON.stringify([b.ownerId, b.scope, b.projectId]))));
  const identity = f.db.prepare('SELECT store_id,cursor_secret FROM store_metadata').get();
  const bind = (purpose, value) => createHmac('sha256', identity.cursor_secret)
    .update(JSON.stringify(['context-read-v1', purpose, identity.store_id, value])).digest('base64url');
  const prepared = horizon.items.map(candidate => {
    const fetched = ok(f.call('fetchCandidateEvidence', { readSet: ordered, refs: [candidate.ref], intent })).items[0];
    const definition = definitions.find(entry => entry.memory.id === candidate.ref.memoryId)?.definition;
    const { type, ref, state, origin } = fetched;
    return { ref, rank: candidate.rank, type,
      metadata: type === 'memory' ? { state, reviewState: fetched.reviewState, filing: fetched.filing, kind: fetched.kind, origin, confidence: fetched.confidence } :
        { state, support: fetched.support, origin }, text: type === 'memory' ? fetched.content : fetched.title + '\n' + fetched.body,
      sources: type === 'memory' && fetched.provenance.sourceAccess === 'available' ? definition.receipts.slice(0, 16).map(({ role, excerpt }, index) => ({ index, role, excerpt })) : [],
      sourceAccess: type === 'card' ? 'unsupported' : fetched.provenance.sourceAccess,
      sourcesComplete: type === 'memory' && fetched.provenance.coverage.status === 'complete', fence: bind('snapshot-item', fetched) };
  });
  const generations = ordered.map(namespace => ({ memory: f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?')
    .get(namespace.ownerId, namespace.scope, namespace.projectId ?? '')?.epoch ?? 1,
  ...(horizon.items.some(item => item.ref.type === 'card') ? { card: f.db.prepare('SELECT generation FROM card_epochs WHERE owner_id=? AND scope=? AND project_id=?')
    .get(namespace.ownerId, namespace.scope, namespace.projectId ?? '')?.generation ?? 1 } : {}) }));
  const snapshotOf = included => {
    const payload = { v: 1, scope: bind('snapshot-scope', ordered), intent,
      refs: included.map(({ ref }) => [ordered.findIndex(namespace => JSON.stringify(namespace) === JSON.stringify(ref.namespace)), ref.type,
        ref.memoryId ?? ref.cardId, ref.revision, ...(ref.type === 'card' ? [ref.bodyRevision] : [])]),
      generations: generations.map(value => ({ memory: value.memory, ...(included.some(item => item.type === 'card') ? { card: value.card } : {}) })),
      access: ordered.map(() => 1), fences: included.map(item => item.fence) };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return body + '.' + bind('snapshot', body);
  };
  return { prepared, snapshotOf };
}

test('A02–A05/A08 product search, canonical preparations and per-trial snapshots equal the oracle, for Memory and Card stores', async t => {
  for (const cards of [false, true]) {
    const f = assemblyFixture(t, { cards }), definitions = f.seed();
    if (cards) {
      const draft = ok(f.host.call(f.core, 'createCardDraft', { namespace: ns, actionId: 'draft', drafting: 'authored', input: {
        title: 'assembly Card', body: 'Canonical synthetic Card body.', authoredInput: { text: 'Synthetic note.', occurredAt: null } } }));
      ok(f.host.call(f.core, 'confirmCardDraft', { namespace: ns, cardId: draft.id, expectedRevision: draft.revision, actionId: 'confirm', applicability: 'current' }));
    }
    const input = assemblyQuery({ types: cards ? ['memory', 'card'] : ['memory'] });
    const horizon = ok(await f.call('findCandidates', { ...input, limit: 24 }));
    const { prepared, snapshotOf } = canonicalOracle(f, horizon, definitions, [ns], 'current');
    assert.equal(prepared.length, cards ? 19 : 18);
    assert.equal(prepared.find(item => item.text.includes('ABC')).text, sample.items[3].text, 'NFKC and whitespace canonicalization');
    for (const policyId of ASSEMBLY_POLICIES) for (const maxTokens of sample.budgets) {
      const budget = { maxTokens, maxItems: 24 }, expected = oracle(prepared, policyId, budget, counter, snapshotOf);
      const result = await f.call('contextRead', { ...input, policy: { id: policyId }, budget });
      if (!expected) { denied(result, 'context_item_too_large'); continue; }
      const actual = ok(result); invariant(actual, counter, maxTokens);
      assert.deepEqual(actual.metered, expected.metered);
      assert.deepEqual(actual.diagnostics.omitted, expected.omitted);
      assert.equal(actual.diagnostics.trace.counterCalls, 2 + 2 * expected.attempted + expected.rejected);
      assert.equal(actual.diagnostics.candidates.count, prepared.length);
      assert.deepEqual(actual.diagnostics.candidates.channels, horizon.channels);
      assert.equal(actual.diagnostics.omitted.oversized > 0, true, 'canonical long body cannot fit');
      if (actual.metered.snapshot) {
        const fetched = ok(f.call('fetchCandidateEvidence', { readSet: [ns], snapshot: actual.metered.snapshot }));
        assert.deepEqual(fetched.items.map(item => item.ref), actual.metered.items.map(item => item.ref));
      }
    }
    const history = ok(await f.call('contextRead', { ...input, intent: 'history', budget: { maxTokens: 4000, maxItems: 24 } }));
    assert.ok(history.metered.items.some(item => item.sources.length > 0), 'canonically current items retain sources for history intent');
  }
});

test('A05/A07 foreign scope isolation and two-namespace canonical aliases', async t => {
  for (const cards of [false, true]) for (const policyId of ASSEMBLY_POLICIES) {
    const port = { id: 'synthetic-quarter-bytes', countTokens: text => Math.ceil(Buffer.byteLength(text) / 4) };
    const f = assemblyFixture(t, { cards, counter: port });
    f.seed(sample.items.slice(0, 3), [ns, personal]);
    const addCard = (namespace, label) => {
      const draft = ok(f.host.call(f.core, 'createCardDraft', { namespace, actionId: 'draft-' + label, drafting: 'authored', input: {
        title: 'assembly ' + label, body: 'Synthetic Card ' + label, authoredInput: { text: 'Synthetic source ' + label, occurredAt: null } } }));
      return ok(f.host.call(f.core, 'confirmCardDraft', { namespace, cardId: draft.id, expectedRevision: draft.revision,
        actionId: 'confirm-' + label, applicability: 'current' }));
    };
    if (cards) { addCard(ns, 'target-project'); addCard(personal, 'target-personal'); }
    const input = assemblyQuery({ types: cards ? ['memory', 'card'] : ['memory'], readSet: [ns, personal],
      policy: { id: policyId }, budget: { maxTokens: 4000, maxItems: 24 } });
    const warm = async request => { ok(await f.call('contextRead', request)); return ok(await f.call('contextRead', request)); };
    const before = await warm(input);
    invariant(before, port, 4000);
    assert.equal(before.diagnostics.dedup.sources, 1);
    assert.equal(before.metered.items.filter(item => item.type === 'card').length, cards ? 2 : 0);
    const aliasItem = before.metered.items.find(item => item.sources.some(source => source.sameAs));
    const alias = aliasItem.sources.find(source => source.sameAs);
    assert.notDeepEqual(aliasItem.ref.namespace, before.metered.items[alias.sameAs.item].ref.namespace);
    f.admit('assembly FOREIGN_MEMORY_SECRET', foreign);
    if (cards) addCard(foreign, 'FOREIGN_CARD_SECRET');
    f.trusted.state.allowed.push(foreign);
    const populated = await warm({ ...input, readSet: [foreign] });
    assert.equal(populated.diagnostics.candidates.count, cards ? 2 : 1);
    const after = await warm(input);
    assert.equal(expectedMeteredText(after.metered), expectedMeteredText(before.metered), 'metered bytes are scope-isolated');
    assert.deepEqual(stableResult(after), stableResult(before), 'all fields except timing and reconciliation work stay identical');
    assert.equal(JSON.stringify(after).includes('FOREIGN_'), false);
  }
});

test('A08 provider errors, rate limits and timeout retain lexical assembly and candidate diagnostics', async t => {
  const base = createFakeEmbedder(); let error, calls = 0;
  const embedder = { ...base, embed(texts, options) { calls++; if (error) throw error; return base.embed(texts, options); } };
  const f = assemblyFixture(t, { embedder, selectedPolicy: policy() }); f.admit('assembly lexical survivor');
  ok(await f.call('refreshContextIndex', refresh()));
  for (const [cause, state] of [[{ code: 'provider_error', message: 'SECRET_PROVIDER_DETAIL' }, 'provider_error'],
    [{ status: 429, message: 'SECRET_PROVIDER_DETAIL' }, 'rate_limited'], [{ code: 'timeout', message: 'SECRET_PROVIDER_DETAIL' }, 'timeout']]) {
    error = cause;
    const input = assemblyQuery({ semantic: true, budget: { maxTokens: 4000, maxItems: 24 } });
    const { budget, ...search } = input;
    const candidates = ok(await f.call('findCandidates', { ...search, limit: 24 }));
    const before = calls, actual = ok(await f.call('contextRead', input));
    assert.equal(calls, before + 1); assert.equal(actual.metered.items.length, 1);
    assert.deepEqual(stableCandidates(actual.diagnostics.candidates), stableCandidates({ count: candidates.items.length,
      channels: candidates.channels, coverage: candidates.coverage, trace: candidates.trace }));
    assert.equal(actual.diagnostics.candidates.channels.lexical.state, 'ready');
    assert.equal(actual.diagnostics.candidates.channels.semantic.state, state);
    assert.ok(actual.diagnostics.candidates.channels.semantic.causes.includes(state));
    assert.equal(actual.diagnostics.candidates.trace.effective, 'lexical');
    assert.equal(actual.diagnostics.candidates.trace.requested, 'hybrid');
    invariant(actual, counter, 4000);
    assert.equal(JSON.stringify(actual).includes('SECRET_PROVIDER_DETAIL'), false);
  }
});

test('A08 internal search propagates candidate diagnostics and semantic degradation without retaining rankings', async t => {
  const bare = assemblyFixture(t);
  const refused = await bare.call('contextRead', assemblyQuery({ semantic: true })); denied(refused, 'invalid_input');
  assert.equal(refused.error.details.candidates.channels.semantic.state, 'absent');
  let calls = 0;
  const fake = createFakeEmbedder();
  const embedder = { ...fake, embed(texts, options) { calls++; return fake.embed(texts, options); } };
  const f = assemblyFixture(t, { embedder, selectedPolicy: policy() }); f.admit('assembly fact');
  ok(await f.call('contextRead', assemblyQuery())); assert.equal(calls, 0);
  ok(await f.call('contextRead', assemblyQuery({ semantic: false }))); assert.equal(calls, 0);
  const degraded = ok(await f.call('contextRead', assemblyQuery({ semantic: true })));
  assert.equal(degraded.diagnostics.candidates.channels.semantic.state, 'partial_coverage'); assert.equal(calls, 0);
  for (let i = 0; i < 13; i++) f.admit('assembly ranking ' + i);
  const page = ok(await f.call('findCandidates', query({ query: 'assembly', limit: 1 })));
  for (let i = 0; i < 130; i++) ok(await f.call('contextRead', assemblyQuery()));
  ok(await f.call('findCandidates', query({ query: 'assembly', limit: 1, cursor: page.nextCursor })));
});

test('A03 complete core byte bound is independent of an all-fit token counter', async t => {
  const f = assemblyFixture(t, { counter: { id: 'zero', countTokens: () => 0 } });
  f.seed(sample.items.map(item => ({ ...item, receipts: item.receipts.map((source, i) => ({ ...source, excerpt: String(i).padStart(2, '0') + '界'.repeat(790) })) })));
  denied(await f.call('contextRead', assemblyQuery({ budget: { maxTokens: 4000, maxItems: 24 } })), 'context_item_too_large');
});

test('A10 read-only and managed-existing assembly creates no transient files or DDL; memory stores refuse index access', async t => {
  const authority = { authorize() { return null; }, isCurrent() { return null; } };
  const f = assemblyFixture(t, { coreOptions: { methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority } } });
  f.admit('assembly canonical');
  const input = assemblyQuery(), expected = ok(await f.call('contextRead', input));
  const ddl = f.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
  const reader = openContextReader({ path: f.path, contextRead: f.config }); f.workspace.defer(() => reader.close());
  const storeId = f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  const managed = openMemoryCore({ path: f.path, existingStore: { version: 'schema30-existing-v1', storeId }, contextRead: f.config });
  f.workspace.defer(() => managed.close());
  const observed = await observeDatabaseFiles(f, async () => {
    for (const core of [reader, managed]) {
      const actual = ok(await f.trusted.call(core, 'contextRead', input));
      assert.deepEqual(actual.metered, expected.metered); invariant(actual, counter, 1500);
      denied(await f.trusted.call(core, 'refreshContextIndex', refresh()), 'invalid_input');
    }
  });
  assert.deepEqual(observed.events, []);
  const processRead = (mode, name) => {
    const report = join(f.workspace.path, name + '.json'), outPath = report + '.out', errPath = report + '.err';
    const out = openSync(outPath, 'wx', 0o600), err = openSync(errPath, 'wx', 0o600);
    let child;
    try { child = spawnSync(process.execPath, [new URL('../testing/context-read-assembly-worker.mjs', import.meta.url).pathname,
      f.path, JSON.stringify({ mode, storeId, input }), report], { stdio: ['ignore', out, err], timeout: 30000 }); }
    finally { closeSync(out); closeSync(err); }
    assert.equal(child.error, undefined); assert.equal(child.signal, null);
    assert.equal(child.status, 0, readFileSync(errPath, 'utf8'));
    return JSON.parse(readFileSync(report, 'utf8'));
  };
  for (const mode of ['read-only', 'managed']) {
    const watched = await observeDatabaseFiles(f, async () => {
      assert.deepEqual(ok(processRead(mode, mode)).metered, expected.metered);
    });
    assert.deepEqual(watched.events, []);
    const journal = f.path + '.context-read-v1.sqlite-journal';
    writeFileSync(journal, 'synthetic auxiliary', { mode: 0o600 });
    try {
      const refused = await observeDatabaseFiles(f, async () => { denied(processRead(mode, mode + '-auxiliary'), 'index_unavailable'); });
      assert.deepEqual(refused.events, []);
    } finally { unlinkSync(journal); }
  }
  assert.deepEqual(f.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all(), ddl);
  const memory = openMemoryCore({ path: ':memory:', contextRead: f.config }); f.workspace.defer(() => memory.close());
  denied(await f.trusted.call(memory, 'contextRead', input), 'index_unavailable');
});

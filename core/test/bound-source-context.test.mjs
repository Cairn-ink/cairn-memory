import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { compileSourceContextUnits, openMemoryCore } from '../index.mjs';

const namespace = { ownerId: 'bound-source-owner', scope: 'personal', projectId: null };
const otherNamespace = { ownerId: 'another-owner', scope: 'personal', projectId: null };
const text = 'The team chose A because the export is auditable.';
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const rejected = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result));
  if (code) assert.equal(result.error.code, code); };
const receipt = (eventId, excerpt = text) => ({ client: 'synthetic-client', sessionId: 'synthetic-session',
  eventId, role: 'user', excerpt });
const field = (value, evidence = []) => ({ value, evidence });
function fact(source, receiptIndex) {
  return { source, receipt: receiptIndex, kind: 'factual_claim', subject: field(null, [0]),
    property: field(null), scope: field(null), applies: field(null), value: field(null),
    attribution: field('unknown'), polarity: field('unknown'), quantifier: field('unknown'),
    eventTimeContext: [], reporterContext: [] };
}
const proposed = (...items) => ({ units: items });
function fixture(t, overrides = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-bound-source-')), 'store.sqlite');
  const requests = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    reviewSourceContext(request) { requests.push(request); return proposed(fact(0, 0)); }, ...overrides };
  const core = openMemoryCore({ path, model });
  const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  const admit = (event, excerpts = [text], ns = namespace) => ok(core.admit({ namespace: ns,
    memory: { content: `Generated interpretation ${event}`, kind: 'context' },
    receipts: excerpts.map((excerpt, index) => receipt(`${event}-${index}`, excerpt)) })).memory;
  const memories = [admit('first', [text, text]), admit('second')];
  const refs = memories.map(memory => ({ memoryId: memory.id, revision: memory.revision }));
  const review = (patch = {}) => core.reviewSourceContext({ namespace, refs, ...patch });
  const stored = () => ({ memories: db.prepare('SELECT * FROM memories ORDER BY id').all(),
    receipts: db.prepare('SELECT * FROM receipts ORDER BY id').all(),
    edges: db.prepare('SELECT * FROM rationale_edges ORDER BY from_id').all(),
    epochs: db.prepare('SELECT * FROM namespace_epochs ORDER BY owner_id').all() });
  return { path, core, db, model, requests, admit, refs, review, stored };
}

test('BCU1/2/4 same-text receipts bind distinct persistent IDs without leaking them to model', async t => {
  const f = fixture(t); const before = f.stored();
  f.model.reviewSourceContext = request => {
    f.requests.push(request);
    return proposed(fact(0, 0), fact(0, 1), fact(1, 0));
  };
  const value = ok(await f.review());
  assert.equal(value.units.length, 3);
  assert.deepEqual(value.units.map(unit => [unit.memoryId, unit.revision, unit.receiptId]), [
    [f.refs[0].memoryId, f.refs[0].revision, value.sources[0].receipts[0].id],
    [f.refs[0].memoryId, f.refs[0].revision, value.sources[0].receipts[1].id],
    [f.refs[1].memoryId, f.refs[1].revision, value.sources[1].receipts[0].id],
  ]);
  assert.equal(new Set(value.units.map(unit => unit.receiptId)).size, 3);
  assert.equal(value.status, 'assessment-only'); assert.equal(value.persistence, 'not-stored');
  assert.equal(value.sourceSelectionCoverage, 'unassessed');
  assert.equal(value.semanticCoverage, 'unassessed');
  assert.ok(value.units.every(unit => unit.interpretationStatus === 'model-proposed-unverified'
    && unit.qualification.slot.subject === null));
  const request = f.requests[0];
  assert.equal(request.maxOutputTokens, 3072);
  assert.equal(request.responseSchema.properties.units.maxItems, 8);
  assert.deepEqual(request.input.sources.map(source => source.receipts.map(receipt => receipt.passages[0].text)),
    [[text, text], [text]]);
  assert.match(request.system, /never as instructions/);
  for (const privateValue of [namespace.ownerId, 'synthetic-client', 'synthetic-session',
    'Generated interpretation', ...value.sources.flatMap(source => [source.memory.id,
      ...source.receipts.map(sourceReceipt => sourceReceipt.id)])]) {
    assert.equal(JSON.stringify({ system: request.system, input: request.input, schema: request.responseSchema })
      .includes(privateValue), false);
  }
  assert.deepEqual(f.stored(), before);
  const cold = openMemoryCore({ path: f.path }); t.after(() => cold.close());
  assert.equal(ok(cold.getRationale({ namespace, ...f.refs[0] })).edges.length, 0);
  assert.deepEqual(ok(cold.get({ namespace, memoryId: f.refs[0].memoryId })).memory.revision,
    f.refs[0].revision);
  value.sources[0].receipts[0].excerpt = 'caller changed result';
  assert.equal(ok(await f.review()).sources[0].receipts[0].excerpt, text);
});

test('BCU1/4 caller input is captured before assay; unrelated namespaces do not stale it', async t => {
  const f = fixture(t);
  const request = { namespace: { ...namespace }, refs: f.refs.map(ref => ({ ...ref })) };
  f.model.reviewSourceContext = () => {
    request.namespace.ownerId = 'mutated-owner';
    request.refs.reverse(); request.refs[0].revision = 999;
    f.admit('other-namespace-change', ['Unrelated source'], otherNamespace);
    return proposed(fact(0, 0));
  };
  const value = ok(await f.core.reviewSourceContext(request));
  assert.deepEqual(value.sources.map(source => source.memory.id), f.refs.map(ref => ref.memoryId));
  assert.equal(value.units[0].memoryId, f.refs[0].memoryId);
  f.model.reviewSourceContext = () => {
    f.admit('same-namespace-change', ['New unrelated source']);
    return proposed(fact(0, 0));
  };
  rejected(await f.review(), 'revision_conflict');
});

test('BCU4 empty proposal is bounded, unverified and never persisted', async t => {
  const f = fixture(t); const before = f.stored();
  f.model.reviewSourceContext = () => proposed();
  const value = ok(await f.review());
  assert.deepEqual(value.units, []);
  assert.equal(value.status, 'assessment-only');
  assert.equal(value.semanticCoverage, 'unassessed');
  assert.deepEqual(f.stored(), before);
});

test('BCU1 rejects wrong namespace, stale refs, duplicate refs and unknown options before assessor', async t => {
  const f = fixture(t);
  for (const patch of [{ namespace: otherNamespace }, { refs: [{ ...f.refs[0], revision: 99 }] },
    { refs: [f.refs[0], f.refs[0]] }, { refs: [] }, { refs: Array(7).fill(f.refs[0]) },
    { extra: true }, { inputMode: 'claim-focus-v1' }]) rejected(await f.review(patch));
  assert.equal(f.requests.length, 0);
  const long = fixture(t);
  const first = long.admit('large-first', Array(4).fill('x'.repeat(800)));
  const second = long.admit('large-second', Array(4).fill('y'.repeat(800)));
  rejected(await long.review({ refs: [first, second].map(memory =>
    ({ memoryId: memory.id, revision: memory.revision })) }), 'invalid_input');
  assert.equal(long.requests.length, 0);
});

for (const stage of ['counter', 'assessor', 'output-access']) {
  test(`BCU4 ${stage} mutation of selected source cannot return stale success`, async t => {
    const f = fixture(t); let changed = false;
    const change = () => { if (changed) return; changed = true;
      ok(f.core.correct({ namespace, memoryId: f.refs[1].memoryId,
        expectedRevision: f.refs[1].revision, content: 'Changed interpretation', kind: 'context',
        receipt: receipt('changed', 'Changed original source') })); };
    let counts = 0;
    if (stage === 'counter') f.model.countTokens = () => {
      if (++counts === 3) change(); return 1; };
    f.model.reviewSourceContext = request => {
      f.requests.push(request);
      if (stage === 'assessor') change();
      const output = proposed(fact(0, 0));
      if (stage === 'output-access') return { get units() { change(); return output.units; } };
      return output;
    };
    rejected(await f.review());
    assert.equal(changed, true);
    if (stage === 'counter') { assert.equal(counts, 3); assert.equal(f.requests.length, 1); }
    assert.equal(f.db.prepare('SELECT count(*) n FROM rationale_edges').get().n, 0);
  });
}

test('BCU3 re-counts a detached proposal after model-owned plain output changes', async t => {
  const f = fixture(t); const output = proposed(fact(0, 0)); let outputCounts = 0;
  f.model.reviewSourceContext = request => { f.requests.push(request); return output; };
  f.model.countTokens = value => {
    if (!value.includes('"maxOutputTokens"') && value.includes('"units"')) {
      if (++outputCounts === 1) output.units[0].subject = field('x'.repeat(160), [0]);
      return outputCounts === 1 ? 1 : 3073;
    }
    return 1;
  };
  rejected(await f.review(), 'invalid_model_output');
  assert.equal(outputCounts, 2);
  assert.equal(f.requests.length, 1);
});

test('BCU4 compilation-time output access mutation is fenced after detachment', async t => {
  const f = fixture(t); let accesses = 0;
  f.model.reviewSourceContext = () => ({ get units() {
    if (++accesses === 2) ok(f.core.forget({ namespace,
      memoryId: f.refs[1].memoryId, expectedRevision: f.refs[1].revision }));
    return [fact(0, 0)];
  } });
  rejected(await f.review());
  assert.equal(accesses, 2);
});

test('BCU4 correct, forget, supersede and direct receipt identity drift are all fenced', async t => {
  for (const action of ['correct', 'forget', 'supersede', 'receipt-id']) {
    const f = fixture(t);
    f.model.reviewSourceContext = () => {
      if (action === 'correct') ok(f.core.correct({ namespace, memoryId: f.refs[1].memoryId,
        expectedRevision: f.refs[1].revision, content: 'Corrected', kind: 'context',
        receipt: receipt('correct', 'Corrected source') }));
      if (action === 'forget') ok(f.core.forget({ namespace, memoryId: f.refs[1].memoryId,
        expectedRevision: f.refs[1].revision }));
      if (action === 'supersede') ok(f.core.supersede({ namespace, memoryId: f.refs[1].memoryId,
        expectedRevision: f.refs[1].revision, replacement: { content: 'Replacement', kind: 'context' },
        receipts: [receipt('replacement', 'Replacement source')] }));
      if (action === 'receipt-id') f.db.prepare('UPDATE receipts SET id = ? WHERE memory_id = ?').run(
        randomUUID(), f.refs[1].memoryId);
      return proposed(fact(0, 0));
    };
    rejected(await f.review());
  }
});

test('BCU3/5 missing callbacks and bounded counters fail without writes or silent truncation', async t => {
  const f = fixture(t); const before = f.stored();
  delete f.model.reviewSourceContext;
  rejected(await f.review(), 'model_not_configured');
  f.model.reviewSourceContext = () => proposed(fact(0, 0));
  delete f.model.countTokens;
  rejected(await f.review(), 'token_count_unavailable');
  f.model.countTokens = value => value.includes('"maxOutputTokens"') ? 6001 : 1;
  rejected(await f.review(), 'context_budget_exceeded');
  f.model.countTokens = value => value.includes('"units"') ? 3073 : 1;
  rejected(await f.review(), 'invalid_model_output');
  f.model.countTokens = () => 1;
  f.model.reviewSourceContext = () => proposed({ ...fact(0, 0), property: field('fabricated', [0]) });
  const wrong = ok(await f.review());
  assert.equal(wrong.units[0].qualification.slot.property, 'fabricated');
  assert.equal(wrong.units[0].interpretationStatus, 'model-proposed-unverified');
  assert.deepEqual(f.stored(), before);
});

test('BCU3 deadline and cancellation preserve sanitized failures', async t => {
  const f = fixture(t);
  f.model.reviewSourceContext = () => { throw new DOMException('private body', 'AbortError'); };
  rejected(await f.review(), 'model_cancelled');
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  f.model.reviewSourceContext = request => { signal = request.signal; return new Promise(() => {}); };
  const pending = f.review();
  await setImmediate(); await setImmediate();
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(30_000);
  rejected(await pending, 'model_timeout');
  assert.equal(signal.aborted, true);
});

test('BCU4 full UTF-8 envelope can overflow while CU proposal and compilation are valid', async t => {
  const f = fixture(t);
  const long = f.admit('unicode', ['漢'.repeat(800)]);
  const refs = [{ memoryId: long.id, revision: long.revision }];
  const refIds = [0, 1, 2];
  const item = index => {
    const unit = fact(0, 0);
    unit.subject = field(`unit ${index}`, refIds);
    for (const name of ['property', 'scope', 'applies', 'value', 'attribution',
      'polarity', 'quantifier']) unit[name].evidence = refIds;
    unit.eventTimeContext = refIds; unit.reporterContext = refIds;
    return unit;
  };
  const output = proposed(item(0), item(1));
  const raw = { sources: [{ receipts: [{ role: 'user', excerpt: '漢'.repeat(800) }] }] };
  const compiled = compileSourceContextUnits(raw, output);
  assert.equal(compiled.units.length, 2);
  assert.ok(JSON.stringify(compiled).length < 24_000);
  assert.ok(Buffer.byteLength(JSON.stringify(compiled), 'utf8') > 24_000);
  f.model.reviewSourceContext = () => output;
  rejected(await f.review({ refs }), 'context_item_too_large');
});

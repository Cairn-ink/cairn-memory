import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { requestAuthority } from '../context-product-authority.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { completeResponseBytes } from '../context-read-assembly.mjs';
import { ASSEMBLY_LIMITS, namespaceKey } from '../context-read-input.mjs';
import { fail } from '../validation.mjs';

// Run the production closures with synthetic canonical/host ports and the
// native single-use authority contract. This is a focused finalization test,
// not a hosted Worker integration test.
const source = readFileSync(new URL('../context-product-index.mjs', import.meta.url), 'utf8');
function closure(name) {
  const start = source.indexOf(`  function ${name}(`);
  const end = source.indexOf('\n  function ', start + 1);
  assert.ok(start >= 0 && end > start, `production ${name} closure exists`);
  return source.slice(start, end);
}
const ns = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const memoryText = 'Remember the quiet observatory.';
const rawText = 'secret-orchid telescope';
const ref = { type: 'memory', namespace: ns, memoryId: 'synthetic-memory', revision: 1 };
const item = { type: 'memory', ref, content: memoryText, state: 'active', reviewState: 'none',
  filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1,
  provenance: { sourceAccess: 'unsupported', coverage: { status: 'complete' } } };

function fixture(mutation, coverage) {
  let samples = 0, batches = 0, rawValid = true, insideRead = false;
  const events = [];
  const token = { opaque: 'synthetic' };
  const binding = { ownerId: ns.ownerId, namespaces: { readSet: [ns] }, credentialDigest: credentialDigest(token) };
  const access = requestAuthority({ authorize: () => binding, isCurrent() {
    samples++;
    events.push(samples === 1 ? 'product-entry' : 'product-final');
    if (samples === 2 && mutation === 'product-sample') rawValid = false;
    return !(samples === 2 && mutation === 'product-denied');
  } }, binding, {})('contextRead', {}, token);
  const publication = { publicationId: 'synthetic-publication' };
  const dependencies = {
    db: {}, read: work => {
      assert.equal(insideRead, false);
      insideRead = true;
      try { return work(); } finally { insideRead = false; }
    }, storage: { observe: () => ({ dto: { lexical: { state: 'ready' } }, publication }) },
    inContentSuppressionRequestInside: (_db, work) => work(),
    evidence: { itemsInside: () => [item] }, canonicalFence: () => [{ memory: 1 }],
    bind: (kind, value) => JSON.stringify([kind, value]), encode: () => 'synthetic-snapshot',
    cardLineageItemInside: (_db, value) => value, citedRawTurns: () => [], receiptEventDate: () => null,
    receiptSourceRows: () => [], resolveMemorySourceDates: () => true,
    assembleThreeLayerContext, completeResponseBytes, ASSEMBLY_LIMITS, namespaceKey, fail,
    success: value => ({ ok: true, value }), same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    counter: { id: 'synthetic-quarter-bytes', countTokens(text) {
      events.push('counter');
      if (mutation === 'counting' && text.includes(rawText)) rawValid = false;
      return Math.ceil(Buffer.byteLength(text) / 4);
    } },
  };
  const { assemble, final } = new Function(...Object.keys(dependencies),
    `${closure('final')}\n${closure('assemble')}\nreturn {assemble, final};`)(...Object.values(dependencies));
  const value = { namespace: ns, conversationId: 'synthetic-conversation', messageId: 'synthetic-message',
    role: 'assistant', ranges: [{ text: rawText, source: { span: { start: 0, end: rawText.length } } }] };
  const handle = { value };
  const raw = { coverage, items: [{ handle, value, key: 'synthetic-turn', rank: 1 }], rawSearch: { revalidate(handles) {
    assert.equal(insideRead, false, 'Raw callbacks precede the canonical final read');
    assert.deepEqual(handles, [handle]);
    batches++;
    events.push(`raw-${batches}`);
    if (batches === 2 && mutation === 'validation') rawValid = false;
    if (!rawValid) throw Error('raw_denied');
    return [value];
  } } };
  const p = { readSet: [ns], types: ['memory'], intent: 'current', query: 'telescope',
    representation: 'representation-v2-dated', policy: { id: 'rank-first-whole-v1' },
    budget: { maxTokens: 6000, maxItems: 2 }, deadlineAt: performance.now() + 5000 };
  const c = { items: [{ ref, rank: 1 }], observed: { publication }, channels: {}, coverage: {}, trace: {} };
  return { access, run(deferred) {
    if (!deferred) return assemble(p, access, c, false, raw);
    const delivery = assemble(p, access, c, true, raw);
    assert.equal(samples, 1, 'deferred assembly has not sampled final product authority');
    return final(p, access, publication, () => delivery.complete(), 'snapshot_stale', delivery.prepare);
  }, observations: () => ({ samples, batches, events }) };
}

function refuses(f, deferred, code) {
  let delivered;
  assert.throws(() => { delivered = f.run(deferred); }, error => {
    assert.equal(error.code, code);
    const refusal = JSON.stringify({ error, message: error.message });
    assert.ok(!refusal.includes(rawText), 'refusal contains no Raw text');
    assert.ok(!refusal.includes(memoryText), 'refusal contains no Memory text');
    return true;
  });
  assert.equal(delivered, undefined, 'no response is delivered, including Memory-only output');
  assert.equal(f.observations().samples, 2, 'entry and exactly one final product sample');
}

for (const deferred of [false, true]) for (const coverage of ['partial', 'included']) {
  const label = `${deferred ? 'deferred' : 'direct'} ${coverage === 'included' ? 'complete' : 'partial'} Raw`;
  test(`${label}: valid Raw is delivered with exactly one final product sample`, () => {
    const f = fixture('none', coverage), result = f.run(deferred);
    assert.equal(result.ok, true);
    assert.ok(JSON.stringify(result.value.metered).includes(rawText));
    assert.ok(JSON.stringify(result.value.metered).includes(memoryText));
    assert.equal(result.value.diagnostics.coverage.raw, coverage);
    const { samples, batches, events } = f.observations();
    assert.equal(samples, 2, 'entry and exactly one final product sample');
    assert.equal(batches, 2, 'initial and final Raw validation both ran');
    assert.ok(events.indexOf('raw-1') < events.indexOf('product-final'));
    assert.ok(events.indexOf('product-final') < events.indexOf('raw-2'));
    assert.throws(() => f.access.check(), { code: 'reader_failed' }, 'native final check remains single-use');
    assert.equal(f.observations().samples, 2, 'a repeated check cannot sample the host again');
  });
  for (const mutation of ['counting', 'validation', 'product-sample'])
    test(`${label}: known limit: late Raw invalidation refuses instead of falling back (${mutation})`, () => {
      const f = fixture(mutation, coverage);
      refuses(f, deferred, 'reader_failed');
      assert.equal(f.observations().batches, 2, 'initial validation succeeded before final validation denied Raw');
    });
  test(`${label}: loss of product authority at the final sample refuses all delivery`, () => {
    const f = fixture('product-denied', coverage);
    refuses(f, deferred, 'scope_changed');
    assert.equal(f.observations().batches, 1, 'product denial stops before final Raw validation');
  });
}

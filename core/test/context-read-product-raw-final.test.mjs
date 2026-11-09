import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestAuthority } from '../context-product-authority.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { assembleThreeLayerContext } from '../context-read-three-layer.mjs';
import { completeResponseBytes } from '../context-read-assembly.mjs';
import { ASSEMBLY_LIMITS, namespaceKey } from '../context-read-input.mjs';
import { fail } from '../validation.mjs';

// Exercise the production closures in both call shapes without duplicating
// their implementation or requiring a hosted embedding provider.
const source = readFileSync(new URL('../context-product-index.mjs', import.meta.url), 'utf8');
const closure = name => {
  const start = source.indexOf(`  function ${name}(`);
  assert.ok(start >= 0);
  return source.slice(start, source.indexOf('\n  function ', start + 1));
};
const ns = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const memoryText = 'Remember the quiet observatory.';
const rawText = 'secret-orchid telescope';
const ref = { type: 'memory', namespace: ns, memoryId: 'synthetic-memory', revision: 1 };
const item = { type: 'memory', ref, content: memoryText, state: 'active', reviewState: 'none',
  filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1,
  provenance: { sourceAccess: 'unsupported', coverage: { status: 'complete' } } };

function fixture(mutation, coverage, denied = false) {
  let samples = 0, counts = 0, finalCounts, rawValid = true, batches = 0, insideRead = false, refetches = 0;
  const token = { opaque: 'synthetic' };
  const binding = { ownerId: ns.ownerId, namespaces: { readSet: [ns] }, credentialDigest: credentialDigest(token) };
  const access = requestAuthority({ authorize: () => binding, isCurrent() {
    samples++;
    if (samples === 2) {
      finalCounts = counts;
      if (mutation === 'authority') rawValid = false;
      return !denied;
    }
    return true;
  } }, binding, {})('contextRead', {}, token);
  const publication = { publicationId: 'synthetic-publication' };
  const dependencies = {
    db: {}, read: work => {
      insideRead = true;
      try { return work(); } finally { insideRead = false; }
    }, storage: { observe: () => ({ dto: { lexical: { state: 'ready' } }, publication }) },
    inContentSuppressionRequestInside: (_db, work) => work(),
    evidence: { itemsInside: () => { refetches++; return [item]; } }, canonicalFence: () => [{ memory: 1 }],
    bind: (kind, value) => JSON.stringify([kind, value]), encode: () => 'synthetic-snapshot',
    cardLineageItemInside: (_db, value) => value, citedRawTurns: () => [], receiptEventDate: () => null,
    assembleThreeLayerContext, completeResponseBytes, ASSEMBLY_LIMITS, namespaceKey, fail,
    success: value => ({ ok: true, value }), same: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    counter: { id: 'synthetic-quarter-bytes', countTokens(text) {
      counts++;
      if (mutation === 'counting' && text.includes(rawText)) rawValid = false;
      return Math.ceil(Buffer.byteLength(text) / 4);
    } },
  };
  const { assemble, final } = new Function(...Object.keys(dependencies),
    `${closure('final')}\n${closure('assemble')}\nreturn {assemble, final};`)(...Object.values(dependencies));
  const value = { namespace: ns, conversationId: 'synthetic-conversation', messageId: 'synthetic-message',
    role: 'assistant', ranges: [{ text: rawText, source: { span: { start: 0, end: rawText.length } } }] };
  const handle = { value };
  const raw = { coverage, items: [{ handle, value, key: 'synthetic-turn', rank: 1 }], rawSearch: { revalidate() {
    assert.equal(insideRead, false, 'Raw callbacks precede the canonical final read');
    batches++;
    if (!rawValid || mutation === 'validation' && batches > 1) throw Error('raw_denied');
    return [value];
  } } };
  const p = { readSet: [ns], types: ['memory'], intent: 'current', query: 'telescope',
    representation: 'representation-v2-dated', policy: { id: 'rank-first-whole-v1' },
    budget: { maxTokens: 6000, maxItems: 1 }, deadlineAt: performance.now() + 5000 };
  const c = { items: [{ ref, rank: 1 }], observed: { publication }, channels: {}, coverage: {}, trace: {} };
  return { access, run(deferred) {
    if (!deferred) return assemble(p, access, c, false, raw);
    const delivery = assemble(p, access, c, true, raw);
    return final(p, access, publication, () => delivery.complete(), 'snapshot_stale', delivery.prepare);
  }, observations: () => ({ samples, counts, finalCounts, batches, refetches }) };
}

for (const deferred of [false, true]) for (const coverage of ['partial', 'included']) {
  for (const mutation of ['counting', 'validation', 'authority'])
    test(`${deferred ? 'deferred' : 'direct'} ${coverage} Raw invalidated by ${mutation} delivers checked Memory-only`, () => {
      const f = fixture(mutation, coverage), result = f.run(deferred);
      assert.equal(result.ok, true);
      assert.equal(result.value.diagnostics.coverage.raw, 'partial');
      assert.match(JSON.stringify(result.value.metered), /quiet observatory/);
      assert.ok(!JSON.stringify(result).includes(rawText));
      const { samples, counts, finalCounts, batches, refetches } = f.observations();
      assert.equal(samples, 2, 'entry and exactly one final authority sample');
      assert.equal(counts, finalCounts, 'all response counting precedes the final sample');
      assert.ok(batches >= 2, 'Raw is checked before projection and after counting/authority');
      assert.equal(refetches, 2, 'canonical final validation covers the fallback Memory selection');
      assert.throws(() => f.access.check(), { code: 'reader_failed' }, 'native final check remains single-use');
    });
  test(`${deferred ? 'deferred' : 'direct'} ${coverage} Raw cannot bypass final authority denial`, () => {
    const f = fixture('counting', coverage, true);
    assert.throws(() => f.run(deferred), { code: 'scope_changed' });
    assert.equal(f.observations().samples, 2);
  });
  test(`${deferred ? 'deferred' : 'direct'} ${coverage} valid Raw still receives a single final check`, () => {
    const f = fixture('none', coverage), result = f.run(deferred);
    assert.match(JSON.stringify(result.value.metered), /secret-orchid/);
    assert.equal(result.value.diagnostics.coverage.raw, coverage);
    assert.equal(f.observations().samples, 2);
    assert.equal(f.observations().counts, f.observations().finalCounts);
    assert.equal(f.observations().refetches, 1, 'the Raw-only selection has no delivered Memory to refetch');
  });
}

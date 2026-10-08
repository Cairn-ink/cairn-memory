import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import test from 'node:test';

import { createOpenAIModel, countOpenAITokens } from '../../../adapters/openai/index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createRecallWitness } from '../../long-history/recall-witness.mjs';
import * as recallLineage from '../../long-history/recall-witness.mjs';
import { packMixedAnswer } from '../mixed-answer.mjs';
import { reportSnapshot } from '../mixed-validation.mjs';

const namespace = { ownerId: 'synthetic-witness-owner', scope: 'personal', projectId: null };
const foreign = { ...namespace, ownerId: 'synthetic-foreign-owner' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const refFromMap = (item, namespaceIndex) => item.type === 'unfiled'
  ? { namespaceIndex, ...item.ref } : item.type === 'ref' && item.ref.childType === 'memory'
    ? { namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
const rankRefs = input => input.candidates.slice(0, input.limit).map(candidate => ({
  namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision,
}));
const sources = ['source0 fixture alpha evidence.', 'source1 fixture beta evidence.'];

async function fixture(t, mode, observed, shared) {
  const workspace = shared?.workspace ?? createTestWorkspace(t, { prefix: 'cairn-recall-witness-' });
  const path = shared?.path ?? join(workspace.path, 'memory.sqlite');
  const requests = [], counters = [], methods = [], diagnostics = [];
  const aliases = shared?.aliases ?? new Map();
  const seeded = shared?.seeded ?? [];
  let core, model, projectionReads = 0, releaseRank, rankStarted;
  const waitingForRank = new Promise(resolve => { rankStarted = resolve; });
  const delayedRank = new Promise(resolve => { releaseRank = resolve; });
  function onDiagnostic(event) { diagnostics.push({ event, detached: this === undefined }); }
  const adapter = createOpenAIModel({ apiKey: 'synthetic-offline-key', onDiagnostic,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      requests.push({ url: String(url), body, bytes: options.body, signal: options.signal });
      if (String(url).endsWith('/input_tokens')) {
        return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      }
      const method = body.text.format.name;
      const input = JSON.parse(body.input[0].content[0].text);
      let output;
      if (method === 'cairn_extract') output = { items: [{
        content: `Synthetic summary ${input.messages[0].content.split(' ')[0]}`,
        kind: 'fact', confidence: 0.9, sourceIndices: [0],
      }] };
      else if (method === 'cairn_classify') output = { items: input.memories.map(memory => ({
        memoryId: memory.id, parentIds: [],
      })) };
      else if (method === 'cairn_select') {
        const refs = input.maps.flatMap(page => page.items.map(item => refFromMap(item, page.namespaceIndex)).filter(Boolean));
        output = { refs: mode === 'empty-select' ? [] : mode === 'invalid-refs'
          ? [refs[0], { ...refs[0] }] : refs.slice(0, input.maxRefs) };
      } else {
        assert.equal(method, 'cairn_rank');
        if (mode === 'correction') {
          const memory = input.candidates[0].memory;
          ok(core.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
            content: 'Synthetic corrected interpretation.', kind: 'fact', receipt: {
              client: 'witness-test', sessionId: 's', eventId: 'correction', role: 'user',
              excerpt: 'Synthetic correction source.',
            } }));
        }
        if (mode === 'late') { rankStarted(); await delayedRank; }
        output = { refs: mode === 'empty-rank' ? [] : rankRefs(input) };
      }
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    } });
  const invoke = (stage, request) => {
    const row = { stage, request };
    methods.push(row);
    let promise = adapter[stage](request);
    if (mode === 'projection' && stage === 'select') promise = promise.then(value => {
      const refs = value.refs;
      return Object.defineProperty({}, 'refs', { enumerable: true, get() { projectionReads++; return refs; } });
    });
    row.promise = promise;
    promise.then(output => { row.output = output; }, error => { row.error = error; });
    return promise;
  };
  model = Object.freeze({ ...adapter,
    countTokens(text) {
      assert.equal(this, model); counters.push(text);
      const actual = adapter.countTokens(text);
      // Controlled counter stress, not a claim about the actual tokenizer:
      // retain one same-namespace card in the real core's packSelect path.
      if (mode === 'bounded-visibility') {
        try {
          const envelope = JSON.parse(text);
          if (envelope.input?.maps?.reduce((sum, page) => sum + page.items.length, 0) > 1) return 6001;
        } catch { /* Other legitimate core count envelopes use the real counter. */ }
      }
      return actual;
    },
    select(request) { assert.equal(this, model); return invoke('select', request); },
    rank(request) { assert.equal(this, model); return invoke('rank', request); },
  });
  const witness = observed ? createRecallWitness(model, mode === 'overflow'
    ? { calls: 1, refs: 1, receipts: 1, identities: 1 } : {}) : null;
  core = openMemoryCore({ path, model: witness?.model ?? model,
    captureSourcePolicy: 'indexed-evidence-v1', sourceCandidatePolicy: 'bounded-keyset-v1' });
  workspace.defer(() => core.close());
  if (witness) workspace.defer(() => witness.dispose());
  if (!shared) {
    const text = mode === 'packing' ? [0, 1, 2, 3].map(index => `source${index} fixture ${'龘'.repeat(785)}`)
      : mode === 'correction' || mode === 'late' ? sources.slice(0, 1) : sources;
    for (const [index, source] of text.entries()) {
      const ns = mode === 'visibility' && index === 1 ? foreign : namespace;
      const capture = ok(await core.capture({ namespace: ns, client: 'witness-test', sessionId: 's',
        eventId: `batch-${index}`, messages: [{ id: `source-${index}`, role: 'user', content: source }] }));
      assert.equal(capture.classification.status, 'applied');
      const memoryId = capture.admission.memories[0].id;
      const detail = ok(core.get({ namespace: ns, memoryId }));
      aliases.set(memoryId, `memory-${index}`);
      detail.receipts.forEach((receipt, receiptIndex) => aliases.set(receipt.id, `receipt-${index}-${receiptIndex}`));
      seeded.push({ ns, memoryId, source });
    }
  }
  if (mode === 'packing') {
    const measurements = seeded.map(item => {
      const fetched = core.fetch({ namespace, refs: [{ memoryId: item.memoryId, revision: 1 }],
        tokenBudget: 4000, contextMode: 'source-evidence' });
      const value = ok(fetched);
      assert.equal(value.exhausted, true, 'each candidate is independently fetchable');
      const tokens = countOpenAITokens(JSON.stringify(fetched));
      assert.ok(tokens <= 4000);
      return { tokens, receiptUnits: value.items[0].receipts.map(receipt => receipt.excerpt.length) };
    });
    t.diagnostic(`packing precondition ${JSON.stringify(measurements)}`);
  }
  requests.length = 0; counters.length = 0; methods.length = 0; diagnostics.length = 0;
  const recall = () => core.recall({ readSet: [namespace], query: 'fixture alpha', limit: 6,
    contextMode: 'source-evidence', ...(mode === 'complete-map' ? { selectionMode: 'bounded-source-scan' } : {}) });
  return { core, model, witness, requests, counters, methods, diagnostics, aliases, seeded, path, workspace,
    recall, waitingForRank, releaseRank, projectionReads: () => projectionReads };
}

// Only comparison boundaries replace generated identities/timestamps. The real
// adapter, model inputs, source receipts and witness never receive these aliases.
function comparable(value, aliases) {
  const text = JSON.stringify(value);
  return text.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu,
    raw => aliases.get(raw) ?? raw).replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/gu, '<generated-time>');
}
const ref = (memoryId, revision = 1, namespaceIndex = 0) => ({ namespaceIndex, memoryId, revision });
const expectedDigest = (salt, kind, reference, receiptId) => {
  const association = JSON.stringify([reference.namespaceIndex, reference.memoryId, reference.revision]);
  const key = kind === 'ref' ? `ref:${association}` : `receipt:${association}:${receiptId}`;
  return createHash('sha256').update(JSON.stringify([
    'cairn.recall-witness.identity.v2', salt, kind, key,
  ]), 'utf8').digest('hex');
};

test('N27B actual core witness exports a detached bounded join before disposal', async t => {
  const f = await fixture(t, 'success', true);
  const result = await f.recall();
  assert.equal(result.ok, true);
  f.witness.finish(result);
  assert.equal(typeof f.witness.exportAfterClose, 'function');
  const exported = f.witness.exportAfterClose();
  assert.equal(exported.version, 2);
  assert.equal(exported.status, 'available');
  assert.match(exported.salt, /^[a-f0-9]{64}$/u);
  assert.equal(exported.events.length, 2);
  assert.equal(typeof recallLineage.recallWitnessIdentityDigest, 'function');
  const memory = result.value.memories[0];
  const reference = ref(memory.memory.id, memory.memory.revision);
  const digest = recallLineage.recallWitnessIdentityDigest({ salt: exported.salt,
    kind: 'ref', ref: reference });
  const identity = exported.identities.find(row => row.digest === digest);
  assert.ok(identity);
  assert.equal(digest, expectedDigest(exported.salt, 'ref', reference));
  assert.equal(identity.kind, 'ref');
  assert.ok(exported.final.refs.includes(identity.token));
  const before = structuredClone(exported);
  f.witness.dispose();
  assert.deepEqual(exported, before);
  assert.throws(() => f.witness.exportAfterClose(), /recall_witness_disposed/u);
});

test('N27D exported joins retain actual shown/selected/rank/final loss and uncertainty controls', async t => {
  for (const mode of ['bounded-visibility', 'empty-select', 'empty-rank', 'success',
    'invalid-refs', 'correction', 'projection', 'overflow', 'complete-map']) {
    const { observed, snapshot, result } = await pair(t, mode);
    const exported = observed.witness.exportAfterClose();
    assert.deepEqual(exported.events, snapshot.events);
    assert.deepEqual(exported.final, snapshot.final);
    assert.deepEqual(exported.limits, mode === 'overflow'
      ? { calls: 1, refs: 1, receipts: 1, identities: 1 }
      : { calls: 4, refs: 128, receipts: 256, identities: 1024 });
    const select = exported.events.find(event => event.stage === 'select');
    const rank = exported.events.find(event => event.stage === 'rank');
    const identities = new Map(exported.identities.map(row => [row.digest, row]));
    for (const item of observed.seeded) {
      const reference = ref(item.memoryId);
      const expected = expectedDigest(exported.salt, 'ref', reference);
      const lookup = observed.witness.lookupRefAfterClose(reference);
      if (lookup.status === 'known') assert.deepEqual(identities.get(expected), {
        token: lookup.token, kind: 'ref', digest: expected,
      });
      else assert.equal(identities.has(expected), false);
    }
    if (mode === 'bounded-visibility') {
      const unshown = observed.seeded.find(item => !identities.has(
        expectedDigest(exported.salt, 'ref', ref(item.memoryId))));
      assert.ok(unshown);
      assert.equal(ok(observed.core.get({ namespace, memoryId: unshown.memoryId }))
        .receipts[0].excerpt, unshown.source, 'stored source exists despite no shown token');
      assert.equal(select.input.pages[0].exhausted, false);
    } else if (mode === 'empty-select') {
      assert.equal(select.input.refs.length, 2);
      assert.equal(select.returned.refs.length, 0);
      assert.equal(rank, undefined);
    } else if (mode === 'empty-rank') {
      assert.deepEqual(rank.input.refs, select.returned.refs);
      assert.equal(rank.returned.refs.length, 0);
      assert.equal(exported.final.refs.length, 0);
    } else if (mode === 'success') {
      assert.deepEqual(exported.final.refs, rank.returned.refs);
      for (const memory of result.value.memories) {
        const reference = ref(memory.memory.id, memory.memory.revision);
        for (const receipt of memory.receipts) {
          const row = identities.get(expectedDigest(exported.salt, 'receipt', reference, receipt.id));
          assert.ok(row);
          assert.equal(row.kind, 'receipt');
          assert.ok(rank.input.candidates.some(candidate => candidate.receipts.includes(row.token)));
          assert.ok(exported.final.receipts.includes(row.token));
        }
      }
    } else if (['invalid-refs', 'correction'].includes(mode)) {
      assert.equal(exported.final.outcome, 'failed');
      assert.equal(exported.summary.referenceAcceptance, 'not-observed');
    } else if (['projection', 'overflow'].includes(mode)) {
      assert.equal(exported.summary.observation, 'partial');
    } else assert.equal(exported.summary.selectVisibility, 'unobservable');
    const serialized = JSON.stringify(exported);
    for (const forbidden of ['fixture alpha', 'Synthetic summary', namespace.ownerId,
      foreign.ownerId, ...observed.aliases.keys()]) assert.equal(serialized.includes(forbidden), false);
    observed.witness.dispose();
    assert.deepEqual(exported.events, snapshot.events, 'disposal cannot erase detached trace');
    exported.events.length = 0;
    assert.equal(observed.witness.snapshot().events.length, 0);
  }
});

test('N27B/N27C exact associated digests separate namespaces/revisions/receipts and malformed Unicode', () => {
  const canary = 'PRIVATE_N27_MEMORY_CANARY', receipt = 'PRIVATE_N27_RECEIPT_CANARY';
  const references = [ref(canary), ref(canary, 1, 1), ref(canary, 2),
    ref('\ud800'), ref('\ufffd')];
  const model = { countTokens: () => 1, select: () => ({ refs: [] }),
    rank: () => ({ refs: references }) };
  const witness = createRecallWitness(model);
  assert.throws(() => witness.exportAfterClose(), /recall_witness_not_closed/u);
  const request = { input: { candidates: references.map(reference => ({
    namespaceIndex: reference.namespaceIndex,
    memory: { id: reference.memoryId, revision: reference.revision },
    receipts: [{ id: receipt }, { id: `${receipt}_OTHER` }, { id: '\ud800' }, { id: '\ufffd' }],
  })) } };
  witness.model.rank(request);
  witness.close();
  const first = witness.exportAfterClose(), second = witness.exportAfterClose();
  assert.notEqual(first.salt, second.salt);
  const refs = references.map(reference => expectedDigest(first.salt, 'ref', reference));
  assert.equal(new Set(refs).size, references.length);
  assert.ok(refs.every(digest => first.identities.some(row => row.digest === digest)));
  const receipts = references.flatMap(reference => [receipt, `${receipt}_OTHER`, '\ud800', '\ufffd']
    .map(receiptId => expectedDigest(first.salt, 'receipt', reference, receiptId)));
  assert.equal(new Set(receipts).size, receipts.length);
  assert.ok(receipts.every(digest => first.identities.some(row => row.digest === digest)));
  for (const reference of references) for (const receiptId of [receipt, '\ud800', '\ufffd']) {
    assert.equal(recallLineage.recallWitnessIdentityDigest({ salt: first.salt,
      kind: 'receipt', ref: reference, receiptId }),
    expectedDigest(first.salt, 'receipt', reference, receiptId));
  }
  request.input.candidates[0].memory.id = 'PRIVATE_MUTATION_CANARY';
  references[0].memoryId = 'PRIVATE_MUTATION_CANARY';
  assert.deepEqual(witness.exportAfterClose().events, first.events);
  first.identities[0].digest = 'mutated';
  first.events[0].input.refs.length = 0;
  assert.deepEqual(witness.exportAfterClose().events, second.events);
  assert.ok(witness.exportAfterClose().identities.every(row => row.digest !== 'mutated'));
  for (const text of [canary, receipt, 'PRIVATE_MUTATION_CANARY', '\ud800', '\ufffd']) {
    assert.equal(JSON.stringify(second).includes(text), false);
  }
  witness.dispose();
  assert.throws(() => witness.exportAfterClose(), /recall_witness_disposed/u);
  assert.deepEqual(witness.lookupRefAfterClose(ref(canary)), { status: 'unknown' });
});

test('N27D digest helper rejects exact-shape/accessor/proxy/malformed inputs without getter execution', () => {
  let reads = 0;
  const value = { salt: 'a'.repeat(64), kind: 'ref', ref: ref('private') };
  const getterRef = { namespaceIndex: 0, revision: 1 };
  Object.defineProperty(getterRef, 'memoryId', { enumerable: true,
    get() { reads++; return 'private'; } });
  const getterOptions = { ...value };
  Object.defineProperty(getterOptions, 'kind', { enumerable: true,
    get() { reads++; return 'ref'; } });
  const proxy = new Proxy(value, { getOwnPropertyDescriptor() { reads++; throw Error('PRIVATE'); } });
  const proxyRef = new Proxy(value.ref, {
    getPrototypeOf() { reads++; throw Error('PRIVATE'); },
    ownKeys() { reads++; throw Error('PRIVATE'); },
  });
  const hiddenRef = { ...value.ref };
  Object.defineProperty(hiddenRef, 'memoryId', { value: 'private', enumerable: false });
  const revoked = Proxy.revocable(value, {}); revoked.revoke();
  for (const options of [null, [], proxy, revoked.proxy, getterOptions,
    { ...value, ref: getterRef }, { ...value, ref: proxyRef }, { ...value, ref: hiddenRef },
    { ...value, toJSON() { reads++; return value; } }, { ...value, extra: 'private' },
    { ...value, salt: 'private' }, { ...value, kind: 'unknown' },
    { ...value, ref: { ...value.ref, extra: true } },
    { ...value, ref: Object.create(value.ref) },
    ...[-1, -0, NaN, Infinity, 0.5].map(namespaceIndex => ({ ...value,
      ref: { ...value.ref, namespaceIndex } })),
    { ...value, ref: { ...value.ref, revision: 0 } },
    { ...value, ref: { ...value.ref, memoryId: 'x'.repeat(201) } },
    { ...value, kind: 'receipt', receiptId: '' },
    { ...value, receiptId: 'not_allowed_for_ref' },
  ]) assert.throws(() => recallLineage.recallWitnessIdentityDigest(options), /invalid_recall_witness/u);
  assert.equal(reads, 0);
});

test('N27D pending early close, failed finish and disposal retain finite unknown/partial observations', async () => {
  for (const failed of [false, true]) {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const model = { countTokens: () => 1, select: () => ({ refs: [] }), rank: () => pending };
    const witness = createRecallWitness(model);
    assert.equal(witness.model.rank({ input: { candidates: [] } }), pending);
    if (failed) witness.finish({ ok: false, error: Error('PRIVATE_ERROR_CANARY') });
    else witness.close();
    const exported = witness.exportAfterClose();
    assert.equal(exported.summary.observation, failed ? 'partial' : 'unknown');
    assert.equal(exported.events[0].returned.boundary, 'pending');
    witness.dispose();
    release({ refs: [] });
    await pending;
    assert.equal(exported.events[0].returned.boundary, 'pending');
    assert.equal(witness.summary().observation, failed ? 'partial' : 'unknown');
    assert.equal(JSON.stringify(exported).includes('PRIVATE_ERROR_CANARY'), false);
  }
});

test('N27B thirty maximal lineage subtrees fit alone in the existing report envelope', () => {
  const model = { countTokens: () => 1, select: () => ({ refs: [] }), rank: () => ({ refs: [] }) };
  const witness = createRecallWitness(model);
  for (let call = 0; call < 5; call++) witness.model.rank({ input: {
    candidates: Array.from({ length: 32 }, (_, index) => ({ namespaceIndex: 0,
      memory: { id: `PRIVATE_MAX_${call}_${index}`, revision: 1 },
      receipts: Array.from({ length: 8 }, (_, receiptIndex) => ({ id: `PRIVATE_RECEIPT_${receiptIndex}` })),
    })),
  } });
  witness.close();
  const exported = witness.exportAfterClose();
  assert.equal(exported.events.length, 4);
  assert.equal(exported.identities.length, 1024);
  assert.equal(exported.summary.overflow, true);
  assert.equal(exported.summary.omittedCalls, 1);
  assert.equal(exported.summary.observation, 'partial');
  assert.ok(Buffer.byteLength(JSON.stringify(exported), 'utf8') < 192 * 1024);
  assert.doesNotThrow(() => reportSnapshot({ cases: Array.from({ length: 30 }, () => ({
    arms: [{ diagnostics: { recallWitness: exported } }],
  })) }), 'lineage subtrees alone fit; this is not worst-case combined diagnostics');
  witness.dispose();
});

async function pair(t, mode) {
  const baseline = await fixture(t, mode, false);
  const observed = await fixture(t, mode, true, mode === 'correction' ? undefined : baseline);
  const first = await baseline.recall();
  const result = await observed.recall();
  const before = structuredClone(result);
  observed.witness.finish(result);
  observed.witness.finish({ ok: false });
  assert.deepEqual(result, before, 'finish cannot mutate the core result');
  assert.equal(comparable(result, observed.aliases), comparable(first, baseline.aliases));
  const requestView = f => f.requests.map(({ url, bytes }) => ({ url, bytes }));
  assert.equal(comparable(requestView(observed), observed.aliases), comparable(requestView(baseline), baseline.aliases),
    'actual HTTP request bytes/order must remain equal after generated identity normalization');
  assert.equal(comparable(observed.counters, observed.aliases), comparable(baseline.counters, baseline.aliases),
    'no extra or changed core counter call');
  assert.deepEqual(observed.methods.map(row => row.stage), baseline.methods.map(row => row.stage));
  assert.deepEqual(observed.diagnostics, baseline.diagnostics);
  assert.equal(observed.projectionReads(), baseline.projectionReads(), 'observer must not invoke output getters');
  for (const f of [baseline, observed]) {
    for (const row of f.methods) {
      assert.ok(row.request.signal instanceof AbortSignal);
      const calls = f.requests.filter(call => call.body.text.format.name === `cairn_${row.stage}`);
      assert.ok(calls.every(call => call.signal === row.request.signal), 'original signal reaches HTTP');
      assert.equal(row.request.maxOutputTokens, 1024);
    }
    assert.ok(f.diagnostics.every(row => row.detached), 'diagnostic callback retains undefined receiver');
  }
  if (result.ok) {
    const pack = value => packMixedAnswer({ question: { text: 'fixture alpha', date: '2026-09-30' },
      units: value.memories.map(item => ({ text: item.receipts.map(receipt => receipt.excerpt).join('\n') })),
      countTokens: countOpenAITokens });
    assert.deepEqual(pack(result.value), pack(first.value), 'existing answer packing is unchanged');
  }
  const snapshot = observed.witness.snapshot();
  const serialized = JSON.stringify({ snapshot, summary: observed.witness.summary() });
  for (const forbidden of ['fixture alpha', 'Synthetic summary', 'synthetic-witness-owner',
    'synthetic-foreign-owner', '龘', ...observed.aliases.keys()]) {
    assert.equal(serialized.includes(forbidden), false, `witness leaked ${forbidden}`);
  }
  assert.equal(observed.witness.summary().referenceAcceptance, 'not-observed');
  return { baseline, observed, result, snapshot };
}

test('W01/W04 actual frozen adapter/core facade preserves successful requests, counts and final evidence', async t => {
  const { observed, result, snapshot } = await pair(t, 'success');
  assert.equal(result.ok, true);
  assert.equal(snapshot.events.length, 2);
  assert.equal(snapshot.events[0].input.refCount, 2);
  assert.equal(snapshot.events[0].returned.refs.length, 2);
  assert.equal(snapshot.events[1].input.candidates.length, 2);
  assert.equal(snapshot.events[1].returned.refs.length, 2);
  assert.equal(observed.witness.summary().recallOutcome, 'completed');
  assert.equal(observed.witness.summary().observation, 'complete');
  const memory = result.value.memories[0];
  const reference = ref(memory.memory.id, memory.memory.revision);
  const token = observed.witness.lookupRefAfterClose(reference).token;
  assert.ok(snapshot.events[0].returned.refs.includes(token));
  assert.ok(snapshot.events[1].input.refs.includes(token));
  const receiptToken = observed.witness.lookupReceiptAfterClose(memory.receipts[0].id, reference).token;
  assert.ok(snapshot.events[1].input.candidates.find(candidate => candidate.ref === token).receipts.includes(receiptToken));
  assert.ok(snapshot.final.receipts.includes(receiptToken));
  observed.witness.dispose();
  assert.equal(observed.witness.summary().observation, 'complete');
});

test('W04 stage loss controls distinguish unshown refs, empty selection, packed rank omission and empty rank', async t => {
  for (const mode of ['visibility', 'bounded-visibility', 'empty-select', 'packing', 'empty-rank']) {
    const { observed, result, snapshot } = await pair(t, mode);
    assert.equal(result.ok, true);
    const select = snapshot.events.find(event => event.stage === 'select');
    const rank = snapshot.events.find(event => event.stage === 'rank');
    if (mode === 'visibility') {
      const target = observed.seeded[1];
      assert.equal(ok(observed.core.get({ namespace: foreign, memoryId: target.memoryId })).receipts[0].excerpt, target.source);
      assert.equal(select.input.refCount, 1);
      assert.deepEqual(observed.witness.lookupRefAfterClose(ref(target.memoryId)), { status: 'unknown' });
    } else if (mode === 'bounded-visibility') {
      const shownIds = observed.methods.find(row => row.stage === 'select').request.input.maps
        .flatMap(page => page.items.map(item => refFromMap(item, page.namespaceIndex)?.memoryId));
      const target = observed.seeded.find(item => !shownIds.includes(item.memoryId));
      assert.ok(target, 'one eligible same-namespace stored candidate is omitted');
      assert.deepEqual(target.ns, namespace);
      assert.equal(ok(observed.core.get({ namespace, memoryId: target.memoryId })).receipts[0].excerpt, target.source);
      assert.ok(observed.counters.some(text => {
        try { return JSON.parse(text).input.maps[0].items.length === 2; } catch { return false; }
      }), 'core initially counted both eligible navigation cards');
      assert.equal(select.input.refCount, 1);
      assert.equal(select.input.pages[0].exhausted, false);
      assert.ok(result.value.recallTruncated.navigationItemsOmitted > 0);
      assert.deepEqual(observed.witness.lookupRefAfterClose(ref(target.memoryId)), { status: 'unknown' });
    } else if (mode === 'empty-select') {
      assert.equal(select.input.refCount, 2);
      assert.equal(select.returned.refCount, 0);
      assert.equal(rank, undefined);
      assert.equal(result.value.memories.length, 0);
    } else if (mode === 'packing') {
      const measuredRank = observed.counters.filter(text => {
        try { return Array.isArray(JSON.parse(text).input?.candidates); } catch { return false; }
      });
      t.diagnostic(`packing measured rank input tokens ${measuredRank.map(text => countOpenAITokens(text)).join(',')}`);
      assert.ok(measuredRank.some(text => JSON.parse(text).input.candidates.length === 4 &&
        countOpenAITokens(text) > 6000), 'real source-evidence prompt/envelope exceeds rank input budget');
      assert.equal(select.returned.refCount, 4);
      assert.ok(rank.input.refCount < select.returned.refCount);
      assert.ok(result.value.recallTruncated.candidatesOmitted > 0);
      assert.equal(result.value.recallTruncated.candidatesShortened, 0, 'atomic source sets are not shortened');
      assert.ok(rank.input.candidates.every(candidate => !candidate.textShortened));
      assert.ok(select.returned.refs.some(token => !rank.input.refs.includes(token)));
      // This witnesses the join gap, not which internal fetch/pack operation caused it.
      assert.equal(result.value.coverage, 'budget_exhausted');
    } else {
      assert.equal(rank.input.refCount, 2);
      assert.equal(rank.returned.refCount, 0);
      assert.equal(result.value.memories.length, 0);
    }
  }
});

test('W03 adapter-returned refs do not become accepted when core rejects duplicates or rank freshness', async t => {
  for (const mode of ['invalid-refs', 'correction']) {
    const { observed, result, snapshot } = await pair(t, mode);
    assert.equal(result.ok, false);
    assert.equal(result.error.code, mode === 'invalid-refs' ? 'invalid_model_output' : 'revision_conflict');
    const event = snapshot.events.at(-1);
    assert.equal(event.returned.boundary, 'adapter-returned');
    assert.ok(event.returned.refCount > 0);
    assert.equal(snapshot.final.outcome, 'failed');
    assert.equal(observed.witness.summary().referenceAcceptance, 'not-observed');
    assert.equal(snapshot.final.refs.length, 0);
  }
});

test('W02 projection failure and configured overflow are partial rather than evidence absent', async t => {
  for (const mode of ['projection', 'overflow']) {
    const { observed, result } = await pair(t, mode);
    assert.equal(result.ok, true);
    const summary = observed.witness.summary();
    assert.equal(summary.observation, 'partial');
    assert.equal(summary.recallOutcome, 'completed');
    assert.equal(mode === 'projection' ? summary.projectionFailures > 0 : summary.overflow, true);
    if (mode === 'overflow') {
      const snapshot = observed.witness.snapshot();
      assert.equal(snapshot.events.length, 1);
      assert.equal(summary.omittedCalls, 1);
      assert.ok(snapshot.events[0].input.refs.length <= 1);
      const before = observed.witness.snapshot();
      assert.deepEqual(observed.witness.lookupRefAfterClose(ref('new-private-id')), { status: 'unknown' });
      assert.deepEqual(observed.witness.snapshot(), before, 'post-close join cannot allocate mappings');
    }
  }
});

test('W03 complete-map bypass records unobservable selection instead of an empty shown map', async t => {
  const { observed, result, snapshot } = await pair(t, 'complete-map');
  assert.equal(result.ok, true);
  assert.equal(result.value.selection.strategy, 'complete-map');
  assert.deepEqual(snapshot.events.map(event => event.stage), ['rank']);
  assert.equal(observed.witness.summary().selectVisibility, 'unobservable');
  assert.equal(snapshot.final.strategy, 'complete-map');
});

test('W01/W03 native Promise and request/output identities survive close and late completion', async t => {
  const f = await fixture(t, 'late', true);
  const pending = f.recall();
  await f.waitingForRank;
  f.witness.close();
  const before = f.witness.snapshot();
  assert.equal(before.events.at(-1).returned.boundary, 'pending');
  f.releaseRank();
  const result = await pending;
  assert.equal(result.ok, true);
  f.witness.finish(result);
  assert.deepEqual(f.witness.snapshot(), before, 'late completion cannot enter a closed witness');
  assert.equal(f.witness.summary().recallOutcome, 'unknown');
  assert.equal(f.witness.summary().observation, 'unknown');

  const direct = createRecallWitness(f.model);
  const request = { system: 'Synthetic direct selection.', maxOutputTokens: 1024,
    signal: new AbortController().signal, input: { query: 'fixture', maxRefs: 24,
      maps: [{ namespaceIndex: 0, exhausted: true, items: [{ type: 'unfiled',
        ref: { memoryId: f.seeded[0].memoryId, revision: 1 }, label: 'Synthetic direct cue.' }] }] } };
  const returned = direct.model.select(request);
  const called = f.methods.at(-1);
  assert.equal(called.request, request);
  assert.equal(returned, called.promise);
  assert.equal(await returned, called.output);
  assert.notEqual(direct.model, f.model);
  assert.equal(direct.model.contextWindow, f.model.contextWindow);
  assert.equal(direct.model.onDiagnostic, f.model.onDiagnostic);
  direct.dispose();
  f.witness.dispose();
  assert.equal(f.witness.summary().recallOutcome, 'unknown');
  assert.equal(f.witness.summary().observation, 'unknown');
});

test('W02 namespace/revision/receipt association, exact cap and ambiguous final joins remain distinct', () => {
  const privateId = 'PRIVATE_CUSTOM_MEMORY_SOURCE';
  const receiptId = 'PRIVATE_CUSTOM_RECEIPT_SOURCE';
  const references = [ref(privateId, 1, 0), ref(privateId, 1, 1), ref(privateId, 2, 0)];
  const model = Object.freeze({ contextWindow: 8192, countTokens: () => 1,
    select: request => ({ refs: request.input.refs }), rank: () => ({ refs: references.slice(0, 2) }) });
  const witness = createRecallWitness(model, { refs: 5 });
  const request = { input: { candidates: references.map(reference => ({ namespaceIndex: reference.namespaceIndex,
    memory: { id: reference.memoryId, revision: reference.revision },
    receipts: [{ id: receiptId, excerpt: 'PRIVATE_SOURCE_TEXT' }] })) } };
  const output = witness.model.rank(request);
  assert.equal(output.refs.length, 2);
  assert.equal(witness.snapshot().events[0].returned.refs.length, 2, 'fixed take reaches exact shared slot cap');
  const result = { ok: true, value: { memories: [{ memory: { id: privateId, revision: 1 }, receipts: [{ id: receiptId }] }] } };
  const before = structuredClone(result);
  witness.finish(result);
  assert.deepEqual(result, before);
  assert.equal(new Set(references.map(reference => witness.lookupRefAfterClose(reference).token)).size, 3);
  assert.equal(new Set(references.map(reference => witness.lookupReceiptAfterClose(receiptId, reference).token)).size, 3);
  const snapshot = witness.snapshot();
  assert.equal(snapshot.final.refs.length, 0, 'ambiguous namespace cannot be attributed to first mapping');
  assert.equal(snapshot.final.observation, 'partial');
  assert.equal(witness.summary().observation, 'partial');
  const serialized = JSON.stringify({ snapshot, summary: witness.summary() });
  for (const text of [privateId, receiptId, 'PRIVATE_SOURCE_TEXT']) assert.equal(serialized.includes(text), false);
  witness.dispose();
  assert.deepEqual(witness.lookupRefAfterClose(references[0]), { status: 'unknown' });
  assert.equal(witness.snapshot().events.length, 0);
});

test('W01/W02 constructor rejection and synchronous/rejected errors retain original identity without raw errors', async () => {
  const secret = new Error('PRIVATE_PROVIDER_ERROR');
  const model = Object.freeze({ contextWindow: 8192, countTokens: () => 1,
    select() { throw secret; }, rank() { return Promise.reject(secret); } });
  for (const options of [{ calls: 0 }, { refs: 129 }, { identities: Infinity }, { source: 'private' }]) {
    assert.throws(() => createRecallWitness(model, options), /invalid_recall_witness/u);
  }
  const witness = createRecallWitness(model);
  const request = { input: { maps: [], candidates: [] } };
  assert.throws(() => witness.model.select(request), error => error === secret);
  await assert.rejects(witness.model.rank(request), error => error === secret);
  witness.finish({ ok: false, error: secret });
  assert.equal(JSON.stringify(witness.snapshot()).includes(secret.message), false);
  assert.equal(witness.summary().referenceAcceptance, 'not-observed');

  // Controlled caller-supplied failure while a native Promise remains pending;
  // this is the timeout-shaped boundary, not a simulated paid timeout claim.
  let resolveRank;
  const pending = new Promise(resolve => { resolveRank = resolve; });
  const late = createRecallWitness(Object.freeze({ ...model, rank: () => pending }));
  assert.equal(late.model.rank(request), pending);
  late.finish({ ok: false, error: secret });
  const before = late.snapshot();
  assert.equal(before.events[0].returned.boundary, 'pending');
  assert.equal(before.events[0].returned.refCount, null);
  assert.equal(late.summary().recallOutcome, 'failed');
  assert.equal(late.summary().observation, 'partial');
  resolveRank({ refs: [] });
  await pending;
  assert.deepEqual(late.snapshot(), before, 'completion after failed finish cannot rewrite observation');
  late.dispose();
  assert.equal(late.summary().recallOutcome, 'failed');
  assert.equal(late.summary().observation, 'partial', 'disposal cannot promote pending failure to complete');
});

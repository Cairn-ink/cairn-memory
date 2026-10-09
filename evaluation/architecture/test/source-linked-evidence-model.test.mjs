import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createSourceLinkedEvidenceModel, assembleSourceLinkedEvidence } from '../source-linked-evidence-model.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const code = expected => error => error.code === expected && error.name === 'MemoryStoreError';
const candidate = (id, excerpt = 'Unrelated retained passage.', namespaceIndex = 0) => ({
  namespaceIndex, memory: { id, revision: 1, currentness: 'current' },
  receipts: [{ id: `${id}-receipt`, role: 'user', excerpt }], receiptCount: 1,
  interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' });
const ref = card => ({ namespaceIndex: card.namespaceIndex, memoryId: card.memory.id, revision: card.memory.revision });
const input = (candidates, limit = 6) => ({ query: 'Who handles the linked display?', limit, candidates });
const request = value => ({ system: 'Original unchanged rank instructions', input: value,
  maxOutputTokens: 1024, signal: new AbortController().signal });
const chain = () => [candidate('seed', '🙂 The display uses PO-63.'),
  candidate('bridge', 'PO-63 is handled through BR-6.'), candidate('support', 'BR-6 names the synthetic contact.')];
const compile = (cards, seeds = [cards[0]], limit = 6) => assembleSourceLinkedEvidence(input(cards, limit), { refs: seeds.map(ref) });
function fixture(overrides = {}) {
  const calls = [], counts = [];
  const model = { contextWindow: 8192, countTokens(text) { assert.equal(this, model); counts.push(text); return 1; },
    async rank(value) { assert.equal(this, model); calls.push(value);
      return { refs: value.input.candidates.slice(0, 1).map(ref) }; },
    select: value => value, extract: value => value, classify: value => value, ...overrides };
  return { model, calls, counts, wrapped: createSourceLinkedEvidenceModel(model) };
}

test('E1 delegates exactly once for empty, small and larger pools with original immutable requests and captured counter binding', async () => {
  for (const count of [0, 1, 3, 12, 36]) {
    const f = fixture(), incoming = request(input(Array.from({ length: count }, (_, i) => candidate(`card-${i}`))));
    const expected = structuredClone(incoming.input);
    f.model.rank = () => assert.fail('Captured rank must be used');
    f.model.countTokens = () => assert.fail('Captured counter must be used');
    assert.equal(f.wrapped.countTokens('Explicit binding probe'), 1);
    const output = await f.wrapped.rank(incoming);
    assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].input, expected);
    assert.notEqual(f.calls[0].input, incoming.input);
    assert(Object.isFrozen(f.calls[0]) && Object.isFrozen(f.calls[0].input.candidates));
    if (count) assert(Object.isFrozen(f.calls[0].input.candidates[0].receipts[0]));
    assert.equal(f.calls[0].system, incoming.system); assert.equal(f.calls[0].signal, incoming.signal);
    assert.equal(f.calls[0].maxOutputTokens, 1024);
    assert.deepEqual(output.refs, expected.candidates.slice(0, 1).map(ref));
    for (const port of ['select', 'extract', 'classify', 'contextWindow']) assert.equal(f.wrapped[port], f.model[port]);
    assert(f.counts.includes(JSON.stringify({ system: incoming.system, input: expected, maxOutputTokens: 1024 })));
  }
});

test('E2 exact source links retain receipt/revision identity and UTF-16 ranges, including hyphenated and single-letter codes', () => {
  const cards = chain(), result = compile(cards);
  assert.deepEqual(result.output.refs, cards.map(ref));
  assert(Object.isFrozen(result) && Object.isFrozen(result.diagnostics.links[0].from));
  assert.equal(result.diagnostics.semanticCoverage, 'unassessed');
  assert.deepEqual(result.diagnostics.links.map(link => link.identifier), ['PO-63', 'BR-6']);
  for (const link of result.diagnostics.links) for (const endpoint of [link.from, link.to]) {
    const card = cards.find(item => item.memory.id === endpoint.memoryId);
    assert.equal(endpoint.namespaceIndex, card.namespaceIndex); assert.equal(endpoint.revision, card.memory.revision);
    const receipt = card.receipts.find(item => item.id === endpoint.receiptId);
    assert.equal(receipt.excerpt.slice(endpoint.start, endpoint.end), link.identifier);
  }
  assert.equal(result.diagnostics.links[0].from.start, cards[0].receipts[0].excerpt.indexOf('PO-63'));
  for (const token of ['L8', 'E17', 'PO63', 'PO-63', 'BR-6', 'ab-27']) {
    const pair = [candidate('one', `One ${token}.`), candidate('two', `Two ${token}.`)];
    assert.equal(compile(pair).diagnostics.links[0].identifier, token);
  }
});

test('E2/E6 repeated receipts create one neighbor and preserve the first exact occurrence, not extra cards', () => {
  const cards = [candidate('one', 'E17 and E17.'), candidate('two', 'Other E17.')];
  cards[0].receipts.push({ id: 'second-receipt', role: 'assistant', excerpt: 'E17 again.' }); cards[0].receiptCount++;
  const result = compile(cards);
  assert.equal(result.diagnostics.links.length, 1); assert.equal(result.output.refs.length, 2);
  assert.equal(result.diagnostics.links[0].from.receiptId, 'one-receipt');
  assert.equal(result.diagnostics.links[0].from.start, 0);
});

test('E2/E6 ambiguity, namespace separation, summary-only evidence, case and unsupported token shapes cannot link', () => {
  const ambiguous = [candidate('one', 'Shared L8.'), candidate('two', 'Shared L8.'), candidate('three', 'Shared L8.')];
  const result = compile(ambiguous);
  assert.deepEqual(result.output.refs, [ref(ambiguous[0])]); assert.equal(result.diagnostics.links.length, 0);
  assert.deepEqual(result.diagnostics.ambiguousIdentifiers, [{ namespaceIndex: 0, identifier: 'L8', cardCount: 3 }]);
  const foreign = [candidate('one', 'Shared L8.'), candidate('two', 'Shared L8.', 1)];
  assert.equal(compile(foreign).diagnostics.links.length, 0);
  const reused = [candidate('one', 'Clinic uses PO-63.'), candidate('two', 'Unrelated theater also uses PO-63.')];
  assert.equal(compile(reused).output.refs.length, 2);
  assert.equal(compile(reused).diagnostics.semanticCoverage, 'unassessed'); // Literal navigation risk, not proven identity.
  const summary = [candidate('one'), candidate('two')];
  summary.forEach(card => { card.memory.content = 'Generated interpretation names PO-63.'; });
  assert.equal(compile(summary).diagnostics.links.length, 0);
  const casePair = [candidate('one', 'PO-63.'), candidate('two', 'po-63.')];
  assert.equal(compile(casePair).diagnostics.links.length, 0);
  for (const token of ['63', '2026-10-10', 'Jan17', 'JAN-17', 'Monday12', 'T00', 'UTC12', 'display',
    'PO 63', 'PO--63', 'X-PO-63', 'PO-63-tail', '_PO-63', 'PO-63_', '漢PO-63', 'PO-63漢', 'ABCDEFGHI63', 'PO123456789']) {
    const pair = [candidate('one', `One ${token}.`), candidate('two', `Two ${token}.`)];
    assert.equal(compile(pair).diagnostics.links.length, 0, token);
  }
});

test('E3 admits whole components by ranked-seed order then candidate order, with explicit displacement and permutations', () => {
  const original = [...chain(), ...Array.from({ length: 9 }, (_, i) => candidate(`decoy-${i}`))];
  const seeds = [original[0], ...original.slice(3, 8)];
  const result = compile(original, seeds);
  assert.deepEqual(result.output.refs, [...original.slice(0, 3), ...original.slice(3, 6)].map(ref));
  assert.deepEqual(result.diagnostics.displacedSeeds, original.slice(6, 8).map(ref));
  assert.equal(result.output.refs.length, 6); assert.equal(original.length, 12);
  const reordered = [original[2], original[4], original[0], original[1], ...original.filter((_, i) => ![0, 1, 2, 4].includes(i))];
  const permuted = compile(reordered, seeds);
  assert.deepEqual(permuted.output.refs.slice(0, 3), [original[0], original[2], original[1]].map(ref));
  assert.deepEqual(new Set(permuted.output.refs.slice(0, 3).map(item => item.memoryId)), new Set(['seed', 'bridge', 'support']));
  assert.deepEqual(compile(original, [original[1], original[0], original[2]]).output.refs,
    [original[1], original[0], original[2]].map(ref));
});

test('E3/E6 oversized components and insufficient capacity retain seeds without partial expansion; absent seeds stay absent', () => {
  const cards = [...chain(), candidate('fourth', 'BR-6 is also named here.')];
  // BR-6 now occurs on three cards: it is ambiguous, not a three-neighbor edge.
  assert.equal(compile(cards).diagnostics.ambiguousIdentifiers.length, 1);
  const long = [candidate('one', 'L8.'), candidate('two', 'L8 and E17.'),
    candidate('three', 'E17 and BR-6.'), candidate('four', 'BR-6.')];
  const oversize = compile(long, [long[1], long[3]]);
  assert.deepEqual(oversize.output.refs, [long[1], long[3]].map(ref));
  assert.equal(oversize.diagnostics.components[0].expandable, false);
  assert(oversize.diagnostics.skippedExpansions.every(item => item.reason === 'component_too_large'));
  const insufficient = compile(chain(), [chain()[0]], 2);
  assert.deepEqual(insufficient.output.refs, [ref(chain()[0])]);
  assert.equal(insufficient.diagnostics.skippedExpansions[0].reason, 'insufficient_capacity');
  const late = [candidate('first'), ...chain()];
  const partial = compile(late, [late[0], late[1]], 3);
  assert.deepEqual(partial.output.refs, [late[0], late[1]].map(ref));
  assert.equal(partial.diagnostics.skippedExpansions.length, 1);
  assert.deepEqual(compile(chain(), []).output.refs, []);
  assert.deepEqual(compile([...chain(), candidate('unlinked')], [candidate('unlinked')]).output.refs, [ref(candidate('unlinked'))]);
  for (const limit of [1, 12]) assert(compile(chain(), [chain()[0]], limit).output.refs.length <= limit);
});

test('E4 rejects malformed, accessor-bearing and non-JSON inputs without executing hooks or calling rank', async () => {
  let hooks = 0;
  for (const root of [null, true, 1, 'input', [], undefined]) {
    assert.throws(() => assembleSourceLinkedEvidence(root, { refs: [] }), code('invalid_input'));
    const f = fixture(); await assert.rejects(() => f.wrapped.rank(request(root)), code('invalid_input'));
    assert.equal(f.calls.length, 0);
  }
  const mutations = [r => { r.input.limit = 0; }, r => { r.input.limit = 13; }, r => { r.input.query = ''; },
    r => { r.input.query = '\ud800'; }, r => { r.input.candidates = Array(1); },
    r => { r.input.candidates = Array.from({ length: 37 }, (_, i) => candidate(`c-${i}`)); },
    r => { r.input.candidates[1] = r.input.candidates[0]; }, r => { r.input.candidates[0].memory.revision = 0; },
    r => { r.input.candidates[0].namespaceIndex = -1; }, r => { r.input.candidates[0].receipts[0].role = 'system'; },
    r => { r.input.candidates[0].receipts[0].excerpt = 'x'.repeat(801); },
    r => { r.input.candidates[0].receipts.push(r.input.candidates[0].receipts[0]); },
    r => { r.signal = {}; }, r => { r.maxOutputTokens = 1025; }, r => { r.system = 'x'.repeat(24001); },
    r => Object.defineProperty(r, 'input', { get() { hooks++; return {}; } }),
    r => Object.defineProperty(r.input.candidates[0].receipts[0], 'excerpt', { get() { hooks++; return ''; } }),
    r => { r.input.toJSON = () => { hooks++; return {}; }; }, r => { r.input.candidates.extra = true; },
    r => { r.input.circular = r.input; }];
  for (const mutate of mutations) {
    const f = fixture(), incoming = request(input(chain())); mutate(incoming);
    await assert.rejects(() => f.wrapped.rank(incoming), code('invalid_input')); assert.equal(f.calls.length, 0);
  }
  assert.equal(hooks, 0);
  const accessorModel = { contextWindow: 8192, countTokens: () => 1 };
  Object.defineProperty(accessorModel, 'rank', { enumerable: true, get() { hooks++; return () => ({ refs: [] }); } });
  assert.throws(() => createSourceLinkedEvidenceModel(accessorModel), code('invalid_input'));
  assert.equal(hooks, 0);
  for (const [change, expected] of [[{ rank: null }, 'model_not_configured'], [{ countTokens: null }, 'token_count_unavailable'],
    [{ contextWindow: 8191 }, 'context_budget_exceeded']]) assert.throws(() => fixture(change), code(expected));
});

test('E4 invalid, duplicate, foreign and stale rank refs fail rather than being repaired', async () => {
  const cards = chain(); let hooks = 0;
  for (const output of [null, [], {}, { refs: null }, { refs: [ref(cards[0]), ref(cards[0])] },
    { refs: [{ ...ref(cards[0]), memoryId: 'foreign' }] }, { refs: [{ ...ref(cards[0]), namespaceIndex: 1 }] },
    { refs: [{ ...ref(cards[0]), revision: 2 }] }, { refs: [ref(cards[0])], rationale: 'Extra output' },
    { refs: [{ ...ref(cards[0]), extra: true }] }, { refs: Array(1) },
    { refs: [ref(cards[0]), ref(cards[1]), ref(cards[2])] }]) {
    const f = fixture({ rank: async value => { f.calls.push(value); return output; } });
    await assert.rejects(() => f.wrapped.rank(request(input(cards, 2))), code('invalid_model_output'));
    assert.equal(f.calls.length, 1);
  }
  const output = { refs: [ref(cards[0])] };
  Object.defineProperty(output.refs[0], 'memoryId', { get() { hooks++; return 'seed'; } });
  await assert.rejects(() => fixture({ rank: async () => output }).wrapped.rank(request(input(cards))), code('invalid_model_output'));
  assert.equal(hooks, 0);
});

test('E4 input, raw-output and assembled-output counters are bounded independently and inclusive', async () => {
  for (const [counter, expected, calls] of [[() => 6001, 'context_budget_exceeded', 0],
    [() => NaN, 'token_count_unavailable', 0], [() => -1, 'token_count_unavailable', 0],
    [() => 1.5, 'token_count_unavailable', 0], [() => { throw new Error('Synthetic counter'); }, 'token_count_unavailable', 0],
    [text => JSON.parse(text).system ? 1 : 1025, 'invalid_model_output', 1],
    [text => JSON.parse(text).refs?.length === 3 ? 1025 : 1, 'invalid_model_output', 1]]) {
    const f = fixture({ countTokens: counter }); await assert.rejects(() => f.wrapped.rank(request(input(chain()))), code(expected));
    assert.equal(f.calls.length, calls);
  }
  const f = fixture({ countTokens: text => JSON.parse(text).system ? 6000 : 1024 });
  assert.deepEqual((await f.wrapped.rank(request(input(chain())))).refs, chain().map(ref));
});

test('E4 snapshots survive caller mutation; provider errors, cancellation and raw-output mutation remain failures', async () => {
  let start, finish;
  const ready = new Promise(resolve => { start = resolve; });
  const f = fixture({ rank: value => { f.calls.push(value); start(); return new Promise(resolve => { finish = resolve; }); } });
  const incoming = request(input(chain())), pending = f.wrapped.rank(incoming); await ready;
  incoming.input.candidates[1].receipts[0].excerpt = 'Changed'; incoming.input.candidates[0].memory.id = 'changed';
  assert.throws(() => { f.calls[0].input.candidates[1].receipts[0].excerpt = 'Mutated'; });
  finish({ refs: [ref(chain()[0])] }); assert.deepEqual((await pending).refs, chain().map(ref));
  const failure = new Error('Original provider failure'); let calls = 0;
  await assert.rejects(() => fixture({ rank: async () => { calls++; throw failure; } }).wrapped.rank(request(input(chain()))), error => error === failure);
  assert.equal(calls, 1);
  for (const stage of ['before', 'input', 'rank', 'output']) {
    const controller = new AbortController(); let rankCalls = 0;
    if (stage === 'before') controller.abort();
    const g = fixture({ countTokens: text => { if (stage === 'input' && JSON.parse(text).system || stage === 'output' && JSON.parse(text).refs) controller.abort(); return 1; },
      rank: async value => { rankCalls++; if (stage === 'rank') controller.abort(); return { refs: value.input.candidates.slice(0, 1).map(ref) }; } });
    await assert.rejects(() => g.wrapped.rank({ ...request(input(chain())), signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(rankCalls, ['rank', 'output'].includes(stage) ? 1 : 0);
  }
  for (const stage of ['raw', 'assembled']) {
    const raw = { refs: [ref(chain()[0])] }; let counted = 0;
    const g = fixture({ rank: async () => raw, countTokens: text => {
      if (JSON.parse(text).refs && ++counted === (stage === 'raw' ? 1 : 2)) raw.refs[0].memoryId = 'changed';
      return 1;
    } });
    await assert.rejects(() => g.wrapped.rank(request(input(chain()))), code('invalid_model_output'));
  }
});

const [major, minor] = process.versions.node.split('.').map(Number);
const sqlite = { skip: major < 22 || major === 22 && minor < 16 ? 'SQLite integration requires Node >=22.16.' : false };
const baselineOnly = process.env.CAIRN_EVIDENCE_SET_BASELINE_ONLY === '1';
const ok = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };
// Deterministic mechanical test counter, not a provider tokenizer or cost claim.
const mechanicalCounter = text => Math.ceil(text.length / 4);

async function coreComparison({ fullSeeds = false, redOnly = false, mutation = null } = {}) {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const { prepareMixedSourceCase } = await import('../../longmemeval/mixed-source.mjs');
  const { verifiedEvidence } = await import('../../longmemeval/mixed-evidence.mjs');
  const { packMixedAnswer } = await import('../../longmemeval/mixed-answer.mjs');
  const texts = ['The synthetic mural order is PO-63.', 'PO-63 is routed through BR-6.',
    'BR-6 names the synthetic billing contact.', ...Array.from({ length: fullSeeds ? 9 : 7 }, (_, i) => `Unrelated synthetic inventory item ${i}.`)];
  const source = { id: 'source-linked-integration', family: 'synthetic-link-chain',
    question: { text: 'Who handles the synthetic mural order?', date: '2026-10-10' },
    sessions: [{ id: 'synthetic-session', eventTime: '2026-10-09T12:00:00Z',
      messages: texts.map(content => ({ role: 'user', content })) }] };
  const syntheticId = (kind, name) => `lme-${kind}-${createHash('sha256').update(name).digest('hex')}`;
  const caseId = syntheticId('case', source.id);
  const namespace = { ownerId: 'source-linked-synthetic', scope: 'project', projectId: caseId };
  const plan = prepareMixedSourceCase({ namespace,
    history: { question_id: caseId, sessions: [{ session_index: 0,
      session_id: syntheticId('session', 'source-linked-session'), date: '2026/10/09 (Fri) 12:00',
      turns: texts.map((content, index) => ({ turn_id: syntheticId('turn', `source-linked-${index}`), role: 'user', content })) }] },
    question: { question_id: caseId, text: source.question.text, date: '2026/10/10 (Sat) 23:59' } }, 'indexed-evidence-v1');
  const workspace = createTestWorkspace(null, { prefix: 'cairn-source-linked-' });
  let core = null;
  workspace.defer(() => { core?.close(); core = null; });
  const snapshotPath = join(workspace.path, 'captured.sqlite'), memoryIds = [];
  try {
    core = openMemoryCore({ path: snapshotPath });
    for (const batch of plan.cairnPlan.batches) for (const window of batch.indexedWindows) {
      const admitted = ok(core.admit({ namespace, memory: { content: `Synthetic routing card ${memoryIds.length}.`, kind: 'context' },
        receipts: [{ client: batch.captureInput.client, sessionId: batch.captureInput.sessionId,
          eventId: window.id, role: window.role, excerpt: window.content }] }));
      memoryIds.push(admitted.memory.id);
    }
    assert.equal(memoryIds.length, texts.length);
    core.close(); core = null;
    const runs = [];
    for (const treatment of redOnly ? [false] : [false, true]) {
      const path = join(workspace.path, treatment ? 'treatment.sqlite' : 'baseline.sqlite'); copyFileSync(snapshotPath, path);
      const calls = [];
      const seedIds = fullSeeds ? [memoryIds[0], ...memoryIds.slice(3, 8)] : [memoryIds[0]];
      const model = { contextWindow: 8192, countTokens: mechanicalCounter,
        select: async ({ input: selection }) => ({ refs: selection.maps.flatMap(map => map.items
          .filter(item => item.type === 'unfiled').map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }),
        rank: async request => {
          calls.push({ system: request.system, input: structuredClone(request.input), maxOutputTokens: request.maxOutputTokens });
          if (mutation) {
            const target = memoryIds[mutation.target === 'added' ? 1 : 0];
            if (mutation.action === 'forget') ok(core.forget({ namespace, memoryId: target, expectedRevision: 1 }));
            else ok(core.correct({ namespace, memoryId: target, expectedRevision: 1, content: 'Corrected synthetic content.', kind: 'context',
              receipt: { client: 'test', sessionId: 'changed', eventId: 'changed', role: 'user', excerpt: 'Corrected synthetic source.' } }));
          }
          return { refs: seedIds.map(memoryId => ({ namespaceIndex: 0, memoryId, revision: 1 })) };
        } };
      core = openMemoryCore({ path, model: treatment ? createSourceLinkedEvidenceModel(model) : model,
        sourceCandidatePolicy: 'bounded-keyset-v1' });
      const result = await core.recall({ readSet: [namespace], query: plan.mem0Input.query, limit: 6, contextMode: 'source-evidence' });
      assert.equal(calls.length, 1); assert.equal(calls[0].input.candidates.length, texts.length);
      assert.equal(calls[0].input.limit, 6);
      if (mutation) {
        assert.equal(result.ok, false); assert.equal(result.error.code, 'revision_conflict');
        runs.push({ calls });
      } else {
        const recalled = ok(result);
        const evidence = verifiedEvidence(recalled, query => core.get(query), plan, namespace);
        const packed = packMixedAnswer({ question: source.question, units: evidence.units, countTokens: mechanicalCounter });
        const packedIds = packed.selectedIndices.map(index => recalled.memories[index].memory.id);
        const required = memoryIds.slice(0, 3), packedRequired = required.filter(id => packedIds.includes(id));
        const componentOrder = [required[0], ...calls[0].input.candidates
          .map(card => card.memory.id).filter(id => required.includes(id) && id !== required[0])];
        const expectedIds = treatment ? [...componentOrder, ...(fullSeeds ? memoryIds.slice(3, 6) : [])] : seedIds;
        assert.deepEqual(packedIds, expectedIds); assert.equal(packed.omittedIndices.length, 0);
        for (const item of recalled.memories) assert.deepEqual(item.receipts,
          ok(core.get({ namespace, memoryId: item.memory.id, receiptLimit: 100 })).receipts
            .map(receipt => ({ id: receipt.id, role: receipt.role, excerpt: receipt.excerpt })));
        for (const id of packedRequired) {
          const provenance = evidence.provenance.find(item => item.memoryId === id);
          assert(provenance && provenance.coordinates.some(coord => coord.originalSessionIndex === 0
            && coord.originalTurnIndex === memoryIds.indexOf(id)));
        }
        const actualSources = JSON.parse(packed.request.messages[1].content).evidence;
        assert.deepEqual(actualSources, packed.selectedIndices.map(index => evidence.units[index]));
        if (treatment && fullSeeds) {
          const raw = { refs: seedIds.map(memoryId => ({ namespaceIndex: 0, memoryId, revision: 1 })) };
          assert.deepEqual(assembleSourceLinkedEvidence(calls[0].input, raw).diagnostics.displacedSeeds.map(item => item.memoryId), memoryIds.slice(6, 8));
        }
        runs.push({ calls, packedRequired: packedRequired.length, packedIds });
        assert.equal(packedRequired.length, treatment ? 3 : 1);
      }
      core.close(); core = null;
    }
    if (!mutation) {
      assert.equal(runs.at(-1).packedRequired, 3, 'Restoration requires all three chain sources in actual packed evidence');
      assert.deepEqual(runs[0].calls, runs[1].calls);
    }
    return runs;
  } finally {
    await workspace.cleanup();
    assert.equal(existsSync(workspace.path), false, 'Owned synthetic workspace removed even when restoration fails');
  }
}

test('E5 real-core >6-candidate chain restores actual packed sources with identical original rank requests', sqlite,
  () => coreComparison({ redOnly: baselineOnly }));
test('E6 real-core twelve-candidate full-six-seed output restores the chain and explicitly displaces later seeds', sqlite,
  () => coreComparison({ fullSeeds: true }));
test('E7 seeded and added source correction/forget during ranking still invalidate both arms', sqlite, async () => {
  for (const target of ['seeded', 'added']) for (const action of ['correct', 'forget']) {
    await coreComparison({ mutation: { target, action } });
  }
});
test('E7 deliberate baseline restoration assertion is red and still closes resources/removes owned scratch', sqlite, async () => {
  await assert.rejects(() => coreComparison({ redOnly: true }), error => error.code === 'ERR_ASSERTION'
    && error.actual === 1 && error.expected === 3);
});

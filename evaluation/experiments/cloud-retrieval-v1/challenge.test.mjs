import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openMemoryCore } from '../../../core/contract.mjs';
import { prepareMixedSourceCase } from '../../longmemeval/mixed-source.mjs';
import { verifiedRoleEvidence } from '../../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../../longmemeval/mixed-answer.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

// Public development challenge, frozen in 258a8b8 before A exposure. The only
// input projection is sources/query/date. Evaluator constraints stay here.
const fixture = JSON.parse(readFileSync(new URL('./fixtures/source-only.json', import.meta.url), 'utf8'));
const fixtureHash = createHash('sha256').update(readFileSync(new URL('./fixtures/source-only.json', import.meta.url))).digest('hex');
const countTokens = text => Math.ceil(text.length / 4); // Mechanical, not a provider tokenizer.
const ref = card => ({ namespaceIndex: card.namespaceIndex, memoryId: card.memory.id, revision: card.memory.revision });
const refKey = value => JSON.stringify([value.namespaceIndex, value.memoryId, value.revision]);
const namespaceKey = value => JSON.stringify([value.ownerId, value.scope, value.projectId]);
const ok = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };
const typed = code => error => error.name === 'MemoryStoreError' && error.code === code;
const disabled = process.env.CAIRN_COMPLEMENTARY_NEGATIVE_CONTROL === '1';
const candidate = () => import('./candidate.mjs'); // Missing import is an actual failing test, never a skip.
const id = (kind, text) => `lme-${kind}-${createHash('sha256').update(text).digest('hex')}`;

function noOracle(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert(!/^(?:evaluatorOnly|requiredSourceIndices|answerConstraint|expected|gold|oracle)$/iu.test(key),
      `Evaluator key ${key} entered a model-visible request`);
    noOracle(child);
  }
}
function frozen(value) {
  if (!value || typeof value !== 'object') return;
  if (value instanceof AbortSignal) return; // Caller-owned opaque cancellation handle.
  assert(Object.isFrozen(value));
  Object.values(value).forEach(frozen);
}
function scriptedSeeds(input) {
  // Only actual query text and source receipts affect ranking. No fixture IDs,
  // evaluator anchors, content interpretations, or expected results are read.
  const words = input.query.toLowerCase().match(/[a-z]{4,}/gu) ?? [];
  const scored = input.candidates.map((card, index) => ({ card, index,
    score: words.filter(word => card.receipts.some(receipt => receipt.excerpt.toLowerCase().includes(word))).length }));
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return { refs: scored.length && scored[0].score > 0 ? [ref(scored[0].card)] : [] };
}
function sourceHistory(f) {
  const archived = Array.from({ length: fixture.historyDistractors }, (_, index) => ({ namespaceIndex: 0,
    role: index % 2 ? 'assistant' : 'user', text: `Archived drawer: unrelated pottery inventory note ${index}.` }));
  const visible = [...f.sources, ...fixture.adverseSources];
  // The existing core selects at most 12 refs per namespace per navigation
  // round. Keep frozen pool18: twelve project cards plus six personal cards.
  // All frozen target passages stay in namespace0; only generated noise spills.
  while (visible.length < fixture.rankPoolSize) visible.push({
    namespaceIndex: visible.filter(source => source.namespaceIndex === 0).length < 12 ? 0 : 1, role: 'user',
    text: `Review shelf: unrelated garden inventory note ${visible.length}. No applicable decision is recorded.` });
  return [...archived, ...visible];
}

async function coldSnapshot(t, f) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-complementary-challenge-' });
  let core;
  workspace.defer(() => { core?.close(); core = null; });
  const sources = sourceHistory(f), namespaces = [...new Set(sources.map(source => source.namespaceIndex))]
    .sort().map(index => ({ ownerId: 'synthetic-complementary', scope: index === 0 ? 'project' : 'personal',
      projectId: index === 0 ? id('case', `${f.name}-${index}`) : null }));
  const plans = namespaces.map((namespace, namespaceIndex) => {
    const caseId = id('case', `${f.name}-${namespaceIndex}`);
    // The source planner requires projectId=caseId. This deterministic surrogate
    // changes neither its source/origin map nor actual admission authority.
    return prepareMixedSourceCase({ namespace: { ...namespace, scope: 'project', projectId: caseId },
      history: { question_id: caseId, sessions: [{ session_index: 0,
        session_id: id('session', `${f.name}-${namespaceIndex}`), date: fixture.sourceDate,
        turns: sources.filter(source => source.namespaceIndex === namespaceIndex).map((source, index) => ({
          turn_id: id('turn', `${f.name}-${namespaceIndex}-${index}`), role: source.role, content: source.text })) }] },
      question: { question_id: caseId, text: f.query, date: fixture.questionDate } }, 'indexed-evidence-v1');
  });
  const path = join(workspace.path, 'snapshot.sqlite');
  const namespaceByMemory = new Map(); // Evaluator-only authoritative admission inventory.
  core = openMemoryCore({ path });
  for (const [namespaceIndex, plan] of plans.entries()) {
    for (const batch of plan.cairnPlan.batches) for (const window of batch.indexedWindows) {
      const admitted = ok(core.admit({ namespace: namespaces[namespaceIndex],
        // Trusted synthetic summaries copy source body text verbatim. They are
        // navigation labels only and never enter source-evidence rank/answers.
        memory: { content: window.content.slice(window.content.indexOf('source{') + 7, -2), kind: 'context' },
        receipts: [{ client: batch.captureInput.client, sessionId: batch.captureInput.sessionId,
          eventId: window.id, role: window.role, excerpt: window.content }] }));
      const admittedDetail = ok(core.get({ namespace: namespaces[namespaceIndex], memoryId: admitted.memory.id }));
      assert.equal(namespaceKey(admittedDetail.memory.namespace), namespaceKey(namespaces[namespaceIndex]));
      namespaceByMemory.set(admitted.memory.id, namespaceIndex);
    }
  }
  core.close(); core = null;
  assert.equal(plans.flatMap(plan => plan.cairnPlan.batches.flatMap(batch => batch.indexedWindows)).length,
    fixture.historyDistractors + fixture.rankPoolSize, 'All 72 trusted synthetic source windows admitted');
  let sequence = 0;
  return { workspace, sources, namespaces, plans, namespaceByMemory,
    async run(factory = model => model, options = {}) {
      const arm = join(workspace.path, `arm-${sequence++}.sqlite`);
      copyFileSync(path, arm);
      const selectCalls = [], rankCalls = [], counts = [], rawRanks = [];
      let wrappedRequest;
      const model = { contextWindow: 8192,
        countTokens(text) { counts.push(text); return countTokens(text); },
        select: async request => {
          noOracle(request.input); selectCalls.push(structuredClone(request.input));
          return { refs: options.emptySelect ? [] : request.input.maps.flatMap(map => map.items
            .filter(item => item.type === 'unfiled' && item.label.includes('Review shelf:'))
            .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) };
        },
        rank: async request => {
          noOracle(request.input);
          rankCalls.push({ system: request.system, input: structuredClone(request.input), maxOutputTokens: request.maxOutputTokens });
          assert.equal(request.maxOutputTokens, 1024);
          assert(request.signal instanceof AbortSignal);
          if (wrappedRequest) {
            assert.equal(request.system, wrappedRequest.system);
            assert.equal(request.signal, wrappedRequest.signal);
            assert.deepEqual(request.input, wrappedRequest.input);
            assert.notEqual(request.input, wrappedRequest.input);
            frozen(request);
          }
          const raw = options.emptyRank ? { refs: [] } : scriptedSeeds(request.input);
          if (options.multiSeed) {
            const extra = request.input.candidates.find(card => card.namespaceIndex === raw.refs[0].namespaceIndex
              && card.receipts.some(receipt => receipt.excerpt.includes('unrelated garden inventory note')));
            assert(extra); raw.refs.push(ref(extra));
          }
          if (options.mutation) {
            const compiled = options.assemble(request.input, raw);
            const addition = compiled.diagnostics.addedRefs[0];
            assert(addition, 'Mutation must target an actual would-be complementary addition');
            const namespace = namespaces[addition.namespaceIndex];
            if (options.mutation === 'forget') ok(core.forget({ namespace, memoryId: addition.memoryId, expectedRevision: addition.revision }));
            else ok(core.correct({ namespace, memoryId: addition.memoryId, expectedRevision: addition.revision,
              content: 'Corrected source.', kind: 'context', receipt: { client: 'synthetic', sessionId: 'mutation',
                eventId: 'mutation', role: 'user', excerpt: 'Corrected source.' } }));
          }
          rawRanks.push(structuredClone(raw));
          return raw;
        } };
      const treatment = factory(model);
      // Observe the actual core->wrapper request without altering any input.
      const observed = treatment === model ? treatment : { ...treatment, rank(request) {
        wrappedRequest = request; return treatment.rank(request);
      } };
      core = openMemoryCore({ path: arm, model: observed, sourceCandidatePolicy: 'bounded-keyset-v1' });
      try {
        const response = await core.recall({ readSet: namespaces, query: f.query,
          limit: options.limit ?? fixture.recallLimit, contextMode: 'source-evidence' });
        assert.equal(selectCalls.length, 1, JSON.stringify(response));
        assert.equal(rankCalls.length, options.emptySelect ? 0 : 1,
          JSON.stringify({ response, maps: selectCalls[0]?.maps.map(map => ({ namespaceIndex: map.namespaceIndex,
            count: map.items.length, first: map.items.slice(0, 4) })) }));
        if (!options.emptySelect) {
          const wire = rankCalls[0];
          assert.equal(wire.input.candidates.length, fixture.rankPoolSize);
          assert.equal(wire.input.candidates.filter(card => card.namespaceIndex === 0).length, 12);
          assert.equal(wire.input.candidates.filter(card => card.namespaceIndex === 1).length, 6);
          assert.equal(new Set(wire.input.candidates.map(card => refKey(ref(card)))).size, fixture.rankPoolSize);
          assert(countTokens(JSON.stringify(wire)) <= 6000, 'Frozen rank precondition fits unchanged budget');
          assert(counts.includes(JSON.stringify(wire)), 'Real rank request was counted');
          assert(!JSON.stringify(wire.input).includes('Archived drawer:'), '54 earlier distractors are outside the visible shelf');
          for (const card of wire.input.candidates) {
            assert.deepEqual(Object.keys(card.memory).sort(), ['currentness', 'id', 'revision']);
            assert.equal(card.memory.currentness, 'current');
            assert.equal(card.namespaceIndex, namespaceByMemory.get(card.memory.id));
          }
        }
        if (options.mutation) {
          assert.equal(response.ok, false); assert.equal(response.error.code, 'revision_conflict');
          return { response, rankCalls, rawRanks, selectCalls };
        }
        const recalled = ok(response), units = [], provenance = [];
        for (const [namespaceIndex, namespace] of namespaces.entries()) {
          const group = { ...recalled, memories: recalled.memories.filter(item =>
            namespaceByMemory.get(item.memory.id) === namespaceIndex) };
          const verified = verifiedRoleEvidence(group, request => core.get(request), plans[namespaceIndex], namespace);
          units.push(...verified.units); provenance.push(...verified.provenance);
        }
        // Verifier grouping is mapped back into recall order, preserving seeds.
        const unitByMemory = new Map(); let position = 0;
        for (const [namespaceIndex] of namespaces.entries()) for (const item of recalled.memories.filter(item =>
          namespaceByMemory.get(item.memory.id) === namespaceIndex)) unitByMemory.set(item.memory.id, units[position++]);
        const orderedUnits = recalled.memories.map(item => unitByMemory.get(item.memory.id));
        const packed = packMixedAnswer({ question: { text: f.query, date: fixture.questionDate },
          units: orderedUnits, countTokens });
        const delivered = JSON.parse(packed.request.messages[1].content).evidence;
        assert.deepEqual(delivered, orderedUnits); assert.deepEqual(packed.omittedIndices, []);
        assert.deepEqual(packed.request.messages.map(message => message.role), ['system', 'user']);
        noOracle(packed.request);
        const projected = delivered.flatMap(unit => {
          const data = JSON.parse(unit.text); assert.equal(data.format, 'source-role-evidence-v1'); return data.sources;
        });
        for (const item of recalled.memories) {
          const namespaceIndex = namespaceByMemory.get(item.memory.id);
          assert(Number.isInteger(namespaceIndex));
          const namespace = namespaces[namespaceIndex];
          const detail = ok(core.get({ namespace, memoryId: item.memory.id, receiptLimit: 100 }));
          assert.equal(namespaceKey(detail.memory.namespace), namespaceKey(namespace));
          assert.equal(detail.memory.revision, item.memory.revision); assert.equal(detail.memory.state, 'active');
          assert.equal(item.memory.currentness, 'current');
          assert.equal(item.interpretationStatus, 'omitted'); assert.equal(item.sourceSelectionCoverage, 'unassessed');
          assert.deepEqual(item.receipts, detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })));
          for (const receipt of detail.receipts) {
            const mapped = plans[namespaceIndex].cairnPlan.batches.flatMap(batch => batch.indexedWindows)
              .find(window => window.id === receipt.eventId && window.content === receipt.excerpt && window.role === receipt.role);
            assert(mapped, 'Authoritative source bytes/role/event map back to trusted synthetic source window');
            const originals = sources.filter(source => source.namespaceIndex === namespaceIndex);
            const originalIndex = originals.findIndex(source => receipt.excerpt.includes(source.text));
            assert(originalIndex >= 0);
            const actualOrigin = provenance.find(origin => origin.memoryId === item.memory.id && origin.receiptId === receipt.id);
            assert(actualOrigin);
            for (const coord of actualOrigin.coordinates) {
              assert.equal(coord.originalSessionIndex, 0); assert.equal(coord.originalTurnIndex, originalIndex);
              const expectedOrigin = plans[namespaceIndex].originMap.windows.find(origin =>
                origin.batchIndex === coord.batchIndex && origin.windowIndex === coord.windowIndex
                && origin.renderedTurnId === coord.renderedTurnId);
              assert(expectedOrigin);
              for (const key of ['classification', 'originalStartUtf16', 'originalEndUtf16'])
                assert.equal(coord[key], expectedOrigin[key], 'Exact actual source reconstruction coordinates');
              if (coord.originalStartUtf16 !== null) {
                assert(Number.isInteger(coord.originalStartUtf16) && coord.originalStartUtf16 >= 0);
                assert(Number.isInteger(coord.originalEndUtf16) && coord.originalEndUtf16 <= originals[originalIndex].text.length);
              }
            }
          }
        }
        return { response, recalled, rankCalls, rawRanks, selectCalls, counts, packed,
          units: orderedUnits, projected, provenance };
      } finally { core.close(); core = null; }
    } };
}

function assertRequired(f, run) {
  for (const index of f.evaluatorOnly.requiredSourceIndices) {
    const source = f.sources[index];
    assert(run.projected.some(delivered => delivered.recordedRole === source.role && delivered.text.includes(source.text)),
      `Required complementary source ${index} did not enter actual answer request (${f.name})`);
  }
}
function assertSeam(input, raw, compiled) {
  frozen(compiled);
  assert.deepEqual(Object.keys(compiled.output), ['refs']);
  assert(compiled.output.refs.length <= input.limit);
  const allowed = new Set(input.candidates.map(card => refKey(ref(card))));
  const actual = compiled.output.refs.map(refKey);
  assert.equal(new Set(actual).size, actual.length);
  for (const value of compiled.output.refs) {
    assert.deepEqual(Object.keys(value).sort(), ['memoryId', 'namespaceIndex', 'revision']);
    assert(allowed.has(refKey(value)));
    assert(raw.refs.some(seed => seed.namespaceIndex === value.namespaceIndex));
  }
  assert.deepEqual(compiled.output.refs.slice(0, raw.refs.length), raw.refs,
    'Every original seed remains a prefix in order before any additions');
  assert.equal(typeof compiled.diagnostics.strategy, 'string'); assert(compiled.diagnostics.strategy.trim());
  assert.equal(compiled.diagnostics.semanticCoverage, 'unassessed');
  assert.deepEqual(compiled.diagnostics.addedRefs, compiled.output.refs.filter(value =>
    !raw.refs.some(seed => refKey(seed) === refKey(value))));
}

test('precondition: fixed independent fixture digest and explicit bounded challenge geometry', () => {
  assert.equal(fixtureHash, 'b2e71a8d11f6301fed7a70a93381fdb28cac22e890a512b201b74601ca55bf6e');
  assert.equal(fixture.publicDevelopmentChallenge, true);
  assert.equal(fixture.cases.length, 5);
  for (const f of fixture.cases) {
    assert.equal(sourceHistory(f).length, 72);
    assert(f.evaluatorOnly.requiredSourceIndices.length <= fixture.recallLimit);
    assert(fixture.rankPoolSize > 6 && fixture.rankPoolSize <= 36);
    assert(f.query.length <= 4000);
  }
});
for (const f of fixture.cases) {
  test(`precondition / negative-control: ordinary source rank misses complementary answer evidence (${f.name})`, async t => {
    const snapshot = await coldSnapshot(t, f), run = await snapshot.run();
    assert.equal(run.rawRanks[0].refs.length, 1);
    assert.equal(run.projected.length, 1);
    assert(run.projected[0].text.includes(f.sources[0].text), 'Source-visible script selected the preregistered seed');
    assert.throws(() => assertRequired(f, run), /Required complementary source 1 did not enter actual answer request/u,
      'The actual treatment delivery assertion is red on ordinary rank');
    // Preregistered complements are attainable in the actual rank-visible pool,
    // independently of candidate diagnostics or behavior.
    for (const index of f.evaluatorOnly.requiredSourceIndices) assert(run.rankCalls[0].input.candidates
      .some(card => card.namespaceIndex === f.sources[index].namespaceIndex && card.receipts
        .some(receipt => receipt.role === f.sources[index].role && receipt.excerpt.includes(f.sources[index].text))));
    await snapshot.workspace.cleanup(); assert.equal(existsSync(snapshot.workspace.path), false);
  });
  test(`acceptance: actual cold recall delivers complementary role evidence (${f.name})`, async t => {
    const implementation = disabled ? null : await candidate();
    const snapshot = await coldSnapshot(t, f), ordinary = await snapshot.run();
    const treatment = await snapshot.run(implementation?.createComplementarySourceSetModel ?? (model => model));
    assert.deepEqual(treatment.rankCalls, ordinary.rankCalls, 'Unchanged rank wire inputs across cold arms');
    assertRequired(f, treatment);
    const input = treatment.rankCalls[0].input, raw = treatment.rawRanks[0];
    const compiled = implementation.assembleComplementarySourceSet(input, raw);
    assertSeam(input, raw, compiled);
    assert.deepEqual(treatment.recalled.memories.map(item => item.memory.id), compiled.output.refs.map(value => value.memoryId));
    assert(treatment.recalled.memories.every(item => snapshot.namespaceByMemory.get(item.memory.id) === 0),
      'Foreign namespace has no seed and must not enter authoritative answer evidence');
  });
}

test('precondition: empty rank and empty selector reach unchanged empty answer request', async t => {
  const snapshot = await coldSnapshot(t, fixture.cases[0]);
  for (const options of [{ emptyRank: true }, { emptySelect: true }]) {
    const run = await snapshot.run(undefined, options);
    assert.deepEqual(run.projected, []); assert.deepEqual(run.units, []);
    assert.deepEqual(JSON.parse(run.packed.request.messages[1].content).evidence, []);
  }
});

test('acceptance: empty evidence and no-spare-limit never add sources in actual core path', async t => {
  const implementation = await candidate(), snapshot = await coldSnapshot(t, fixture.cases[0]);
  for (const options of [{ emptyRank: true }, { emptySelect: true }, { limit: 1 }]) {
    const run = await snapshot.run(implementation.createComplementarySourceSetModel, options);
    assert.equal(run.projected.length, options.limit === 1 ? 1 : 0);
    if (options.limit === 1) assert.deepEqual(run.recalled.memories.map(item => item.memory.id),
      run.rawRanks[0].refs.map(value => value.memoryId));
  }
});

test('acceptance: two source-visible seeds remain the prefix before an attainable complementary addition', async t => {
  const implementation = await candidate(), f = fixture.cases[0], snapshot = await coldSnapshot(t, f);
  const ordinary = await snapshot.run(undefined, { multiSeed: true });
  const treatment = await snapshot.run(implementation.createComplementarySourceSetModel, { multiSeed: true });
  assert.deepEqual(treatment.rankCalls, ordinary.rankCalls);
  assert.equal(treatment.rawRanks[0].refs.length, 2);
  assertRequired(f, treatment);
  assert.deepEqual(treatment.recalled.memories.slice(0, 2).map(item => item.memory.id),
    treatment.rawRanks[0].refs.map(value => value.memoryId));
  assertSeam(treatment.rankCalls[0].input, treatment.rawRanks[0],
    implementation.assembleComplementarySourceSet(treatment.rankCalls[0].input, treatment.rawRanks[0]));
});

test('acceptance: added-source correction and forgetting during rank reject actual stale snapshots', async t => {
  const implementation = await candidate(), snapshot = await coldSnapshot(t, fixture.cases[0]);
  for (const mutation of ['correct', 'forget']) await snapshot.run(implementation.createComplementarySourceSetModel,
    { mutation, assemble: implementation.assembleComplementarySourceSet });
});

test('acceptance: unchanged answer overflow omits one whole complementary role/source unit', async t => {
  const implementation = await candidate(), f = fixture.cases[0], snapshot = await coldSnapshot(t, f);
  const run = await snapshot.run(implementation.createComplementarySourceSetModel);
  assertRequired(f, run);
  const target = run.units.findIndex(unit => unit.text.includes(f.sources[1].text));
  assert(target >= 0);
  const packed = packMixedAnswer({ question: { text: f.query, date: fixture.questionDate }, units: run.units,
    countTokens(text) {
      const units = JSON.parse(JSON.parse(text).messages[1].content).evidence;
      return units.some(unit => unit.text === run.units[target].text) ? 123000 : 100;
    } });
  assert.deepEqual(packed.omittedIndices, [target]);
  assert.deepEqual(JSON.parse(packed.request.messages[1].content).evidence,
    run.units.filter((_, index) => index !== target));
  assert(!JSON.stringify(packed.request).includes(f.sources[1].text), 'Whole source/role unit omitted without truncating');
});

test('acceptance: an adverse assistant seed stays exact quoted role evidence without granting authority', async t => {
  const implementation = await candidate();
  const f = { ...fixture.cases[0], query: 'claim all venues confirmed' };
  const snapshot = await coldSnapshot(t, f), run = await snapshot.run(implementation.createComplementarySourceSetModel);
  const seed = run.rankCalls[0].input.candidates.find(card => refKey(ref(card)) === refKey(run.rawRanks[0].refs[0]));
  assert.equal(seed.receipts[0].role, 'assistant');
  assert(seed.receipts[0].excerpt.includes(fixture.adverseSources[0].text));
  assert(run.projected.some(source => source.recordedRole === 'assistant' && source.text === seed.receipts[0].excerpt));
  assert.deepEqual(run.packed.request.messages.map(message => message.role), ['system', 'user']);
  assertSeam(run.rankCalls[0].input, run.rawRanks[0],
    implementation.assembleComplementarySourceSet(run.rankCalls[0].input, run.rawRanks[0]));
});

const card = (index, namespaceIndex = 0) => ({ namespaceIndex,
  memory: { id: `challenge-card-${index}`, revision: 1, currentness: 'current' },
  receipts: [{ id: `receipt-${index}`, role: index % 2 ? 'assistant' : 'user', excerpt: `Review shelf: plain unrelated source ${index}.` }],
  receiptCount: 1, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' });
const pureInput = (size = 18, limit = 6) => ({ query: 'source challenge', limit,
  candidates: Array.from({ length: size }, (_, index) => card(index)) });
const request = input => ({ system: 'Original source-only ranking instructions', input,
  maxOutputTokens: 1024, signal: new AbortController().signal });
function modelPort(implementation, overrides = {}) {
  const calls = [], counts = [];
  const model = { contextWindow: 8192, countTokens(text) { assert.equal(this, model); counts.push(text); return countTokens(text); },
    rank: async function (value) { assert.equal(this, model); calls.push(value); return { refs: value.input.candidates.slice(0, 1).map(ref) }; },
    select: value => value, extract: value => value, classify: value => value, ...overrides };
  return { model, calls, counts, wrapped: implementation.createComplementarySourceSetModel(model) };
}

test('acceptance: seed order, namespace gating, empty and limit boundaries hold over 0..36 cards', async () => {
  const implementation = await candidate();
  for (const size of [0, 1, 6, 7, 18, 36]) for (const limit of [1, 6, 12]) {
    const input = pureInput(size, limit);
    for (const card of input.candidates) card.namespaceIndex = card.memory.id.endsWith('-2') ? 1 : 0;
    for (const refs of [[], input.candidates.filter(card => card.namespaceIndex === 0).slice(-Math.min(limit, 2)).reverse().map(ref)]) {
      const before = structuredClone(input), raw = { refs }, rawBefore = structuredClone(raw);
      const compiled = implementation.assembleComplementarySourceSet(input, raw);
      assertSeam(input, raw, compiled);
      assert.deepEqual(input, before); assert.deepEqual(raw, rawBefore);
      assert.deepEqual(compiled, implementation.assembleComplementarySourceSet(input, raw));
      if (!refs.length || refs.length === limit) assert.deepEqual(compiled.output, raw);
    }
  }
});

test('acceptance: frozen explicit complementary sources remain attainable across candidate-order rotations', async () => {
  const implementation = await candidate(), f = fixture.cases[0];
  const input = pureInput();
  for (const [index, source] of f.sources.entries()) input.candidates[index].receipts[0] = {
    id: `source-${index}`, role: source.role, excerpt: source.text };
  const seed = ref(input.candidates[0]), target = ref(input.candidates[1]);
  for (const shift of [0, 1, 7, 17]) {
    const rotated = { ...input, candidates: [...input.candidates.slice(shift), ...input.candidates.slice(0, shift)] };
    const compiled = implementation.assembleComplementarySourceSet(rotated, { refs: [seed] });
    assertSeam(rotated, { refs: [seed] }, compiled);
    assert(compiled.output.refs.some(value => refKey(value) === refKey(target)),
      'A frozen explicit pair remains practically reachable after candidate-order rotation');
  }
});

test('acceptance: one frozen detached unchanged rank call and original ports survive caller mutation', async () => {
  const implementation = await candidate();
  let ready, finish; const started = new Promise(resolve => { ready = resolve; });
  const input = pureInput(), before = structuredClone(input), value = request(input);
  const f = modelPort(implementation, { rank: function (actual) {
    assert.equal(this, f.model); f.calls.push(actual); ready(); return new Promise(resolve => { finish = resolve; });
  } });
  f.model.rank = () => assert.fail('Factory must retain bound original rank');
  f.model.countTokens = () => assert.fail('Factory must retain original token counter');
  const pending = f.wrapped.rank(value); await started;
  input.candidates[0].receipts[0].excerpt = 'Caller mutation'; input.candidates[1].memory.id = 'changed';
  const actual = f.calls[0]; assert.equal(f.calls.length, 1);
  frozen(actual); assert.notEqual(actual.input, input); assert.deepEqual(actual.input, before);
  assert.equal(actual.signal, value.signal); assert.equal(actual.system, value.system); assert.equal(actual.maxOutputTokens, 1024);
  for (const port of ['select', 'extract', 'classify', 'contextWindow']) assert.equal(f.wrapped[port], f.model[port]);
  finish({ refs: [ref(before.candidates[0])] });
  const output = await pending;
  assert.deepEqual(output, implementation.assembleComplementarySourceSet(before, { refs: [ref(before.candidates[0])] }).output);
  assert(f.counts.includes(JSON.stringify({ system: value.system, input: before, maxOutputTokens: 1024 })));
});

test('acceptance: descriptor-safe malformed, stale, duplicate and foreign refs remain typed failures', async () => {
  const implementation = await candidate(), input = pureInput(); let hooks = 0;
  const accessor = { refs: [ref(input.candidates[0])] };
  Object.defineProperty(accessor.refs[0], 'memoryId', { enumerable: true, get() { hooks++; return 'wrong'; } });
  for (const raw of [null, {}, { refs: null }, { refs: Array(1) }, { refs: [ref(input.candidates[0]), ref(input.candidates[0])] },
    { refs: [{ ...ref(input.candidates[0]), revision: 2 }] }, { refs: [{ ...ref(input.candidates[0]), namespaceIndex: 9 }] },
    { refs: [{ ...ref(input.candidates[0]), memoryId: 'foreign' }] }, { refs: [ref(input.candidates[0])], extra: true }, accessor]) {
    assert.throws(() => implementation.assembleComplementarySourceSet(input, raw), typed('invalid_model_output'));
    let calls = 0; const f = modelPort(implementation, { rank: async () => { calls++; return raw; } });
    await assert.rejects(() => f.wrapped.rank(request(input)), typed('invalid_model_output')); assert.equal(calls, 1);
  }
  for (const change of [value => { value.limit = 13; }, value => { value.limit = 0; },
    value => { value.query = '\ud800'; }, value => { value.query = 'x'.repeat(4001); },
    value => { value.candidates = Array(1); }, value => { value.candidates = Array.from({ length: 37 }, (_, index) => card(index)); },
    value => { value.candidates[1] = value.candidates[0]; }, value => { value.candidates[0].receipts[0].role = 'system'; },
    value => { value.candidates[0].receipts[0].excerpt = 'x'.repeat(801); },
    value => { value.candidates[0].receipts = Array.from({ length: 101 }, (_, index) => ({ id: `receipt-${index}`, role: 'user', excerpt: 'Source.' })); },
    value => { value.candidates[0].extra = 'x'.repeat(3 * 1024 * 1024); },
    value => Object.defineProperty(value.candidates[0].receipts[0], 'excerpt', { enumerable: true, get() { hooks++; return 'Wrong'; } })]) {
    const invalid = pureInput(); change(invalid);
    assert.throws(() => implementation.assembleComplementarySourceSet(invalid, { refs: [] }), typed('invalid_input'));
    const f = modelPort(implementation);
    await assert.rejects(() => f.wrapped.rank(request(invalid)), typed('invalid_input')); assert.equal(f.calls.length, 0);
  }
  assert.equal(hooks, 0);
});

test('acceptance: factory and request shells reject accessors and preserve configured-port failures', async () => {
  const implementation = await candidate(); let hooks = 0;
  const model = { contextWindow: 8192, countTokens: () => 1 };
  Object.defineProperty(model, 'rank', { get() { hooks++; return () => ({ refs: [] }); } });
  assert.throws(() => implementation.createComplementarySourceSetModel(model), typed('invalid_input'));
  for (const [overrides, code] of [[{ rank: null }, 'model_not_configured'], [{ countTokens: null }, 'token_count_unavailable'],
    [{ contextWindow: 8191 }, 'context_budget_exceeded']]) assert.throws(() => modelPort(implementation, overrides), typed(code));
  for (const change of [value => { value.maxOutputTokens = 1025; }, value => { value.system = 'x'.repeat(24001); },
    value => { value.signal = {}; }, value => Object.defineProperty(value, 'input', { enumerable: true,
      get() { hooks++; return pureInput(); } })]) {
    const f = modelPort(implementation), value = request(pureInput()); change(value);
    await assert.rejects(() => f.wrapped.rank(value), typed('invalid_input')); assert.equal(f.calls.length, 0);
  }
  assert.equal(hooks, 0);
});

test('acceptance: inclusive budgets and output-counter mutation preserve typed errors and call counts', async () => {
  const implementation = await candidate(), input = pureInput();
  for (const [counter, code, expectedCalls] of [[() => 6001, 'context_budget_exceeded', 0],
    [() => NaN, 'token_count_unavailable', 0], [() => -1, 'token_count_unavailable', 0],
    [() => 1.5, 'token_count_unavailable', 0], [() => { throw Error('Counter unavailable'); }, 'token_count_unavailable', 0],
    [text => JSON.parse(text).system ? 1 : 1025, 'invalid_model_output', 1]]) {
    let calls = 0; const f = modelPort(implementation, { countTokens: counter,
      rank: async () => { calls++; return { refs: [ref(input.candidates[0])] }; } });
    await assert.rejects(() => f.wrapped.rank(request(input)), typed(code)); assert.equal(calls, expectedCalls);
  }
  let compiledCounts = 0;
  const compiledOverflow = modelPort(implementation, { countTokens(text) {
    return JSON.parse(text).refs && ++compiledCounts === 2 ? 1025 : 1;
  } });
  await assert.rejects(() => compiledOverflow.wrapped.rank(request(input)), typed('invalid_model_output'));
  assert.equal(compiledOverflow.calls.length, 1);
  for (const stage of [1, 2]) {
    let outputCounts = 0;
    const raw = { refs: [ref(input.candidates[0])] };
    const f = modelPort(implementation, { rank: async () => raw, countTokens(text) {
      if (JSON.parse(text).refs && ++outputCounts === stage) raw.refs[0].memoryId = 'foreign'; return 1;
    } });
    await assert.rejects(() => f.wrapped.rank(request(input)), typed('invalid_model_output'));
  }
  const inclusive = modelPort(implementation, { countTokens: text => JSON.parse(text).system ? 6000 : 1024 });
  assertSeam(input, { refs: [ref(input.candidates[0])] },
    implementation.assembleComplementarySourceSet(input, { refs: [ref(input.candidates[0])] }));
  await inclusive.wrapped.rank(request(input)); assert.equal(inclusive.calls.length, 1);
  assert.throws(() => modelPort(implementation, { contextWindow: 8191 }), typed('context_budget_exceeded'));
});

test('acceptance: cancellation before rank and during input/rank/raw/compiled counts cannot return evidence', async () => {
  const implementation = await candidate();
  for (const stage of ['before', 'input', 'rank', 'raw', 'compiled']) {
    const controller = new AbortController(); let calls = 0, outputCounts = 0;
    if (stage === 'before') controller.abort();
    const f = modelPort(implementation, { countTokens(text) {
      const data = JSON.parse(text);
      if (stage === 'input' && data.system) controller.abort();
      if (data.refs && ++outputCounts === (stage === 'raw' ? 1 : stage === 'compiled' ? 2 : -1)) controller.abort();
      return 1;
    }, rank: async value => { calls++; if (stage === 'rank') controller.abort(); return { refs: value.input.candidates.slice(0, 1).map(ref) }; } });
    await assert.rejects(() => f.wrapped.rank({ ...request(pureInput()), signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(calls, stage === 'before' || stage === 'input' ? 0 : 1);
  }
});

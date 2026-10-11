import assert from 'node:assert/strict';
import test from 'node:test';
import { BUNDLE_RANK_INSTRUCTION, prepareBundleRankRequest, compileBundlePlan,
  createBundleRankModel, consumeBundlePlan } from '../source-bundle-rank.mjs';

const counter = text => Math.ceil(text.length / 4);
const card = (index, text = `Exact source ${index}.`, role = 'user') => ({ namespaceIndex: 0,
  memory: { id: `card-${index}`, revision: 1, currentness: 'current' },
  receipts: [{ id: `receipt-${index}`, role, excerpt: text }], receiptCount: 1,
  interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' });
const input = (cards = [card(0), card(1)], limit = 6) => ({ query: 'Which scoped result applies?', limit, candidates: cards });
const request = (value = input(), signal = new AbortController().signal) => ({ system: 'Original core instruction',
  input: value, maxOutputTokens: 1024, signal });
const plan = (indices = [0, 1]) => ({ bundles: [{ sourceIndices: indices, terminalSourceIndex: indices.at(-1) }] });
const errorCode = expected => error => error.code === expected;
function model(patch = {}) { return { contextWindow: 8192, countTokens: counter,
  rank() { throw new Error('Ordinary rank must not run'); }, ...patch }; }
const wrapped = (planRank, onPlan = () => {}, base = model()) => createBundleRankModel(base, { planRank, onPlan });

test('QB1 detached exact catalog and counted fixed instruction/schema retain submitted roles and distinct equal-text provenance', () => {
  const value = input([card(0, 'Same text.', 'assistant'), card(1, 'Same text.')]), measured = [];
  const p = prepareBundleRankRequest(request(value), text => { measured.push(text); return counter(text); });
  assert.equal(p.request.system, BUNDLE_RANK_INSTRUCTION); assert.equal(p.request.maxOutputTokens, 1024);
  assert.deepEqual(measured, [JSON.stringify(p.request)]); assert(p.request.outputSchema.properties.bundles);
  assert.deepEqual(p.request.input.catalog.map(x => [x.sourceIndex, x.receiptId, x.recordedRole, x.excerpt]),
    [[0, 'receipt-0', 'assistant', 'Same text.'], [1, 'receipt-1', 'user', 'Same text.']]);
  value.query = 'Mutated caller'; value.candidates[0].receipts[0].excerpt = 'Mutated caller';
  assert.equal(p.originalInput.query, 'Which scoped result applies?'); assert.equal(p.request.input.catalog[0].excerpt, 'Same text.');
  assert(Object.isFrozen(p.request.input.catalog[0]));
});

test('QB2 stable first occurrence, one/two/three-card chains, six bundles and empty plan compile without automatic inference', () => {
  const p = prepareBundleRankRequest(request(input(Array.from({ length: 8 }, (_, i) => card(i)))), counter);
  assert.deepEqual(compileBundlePlan(p, plan([2, 0, 1])).refs.map(x => x.memoryId), ['card-2', 'card-0', 'card-1']);
  assert.deepEqual(compileBundlePlan(p, { bundles: [] }).refs, []);
  const bundles = [2, 0, 1, 5, 4, 3].map(i => ({ sourceIndices: [i], terminalSourceIndex: i }));
  assert.deepEqual(compileBundlePlan(p, { bundles }).refs.map(x => x.memoryId), bundles.map(x => `card-${x.terminalSourceIndex}`));
  assert.equal(compileBundlePlan(p, { bundles: [plan([0, 1]).bundles[0], plan([1, 2]).bundles[0]] }).refs.length, 3);
  assert.equal(compileBundlePlan(p, plan([7])).refs.length, 1, 'No name matching or unrelated source expansion');
});

test('QB1/QB2 reject duplicate/foreign indices, terminal outside, mixed namespace and excess cards/receipts/indices/shape', () => {
  const p = prepareBundleRankRequest(request(input(Array.from({ length: 8 }, (_, i) => card(i)))), counter);
  const invalid = [plan([0, 0]), plan([-1]), plan([1.5]), plan([99]), plan([0, 1, 2, 3]),
    { bundles: [{ sourceIndices: [0], terminalSourceIndex: 1 }] },
    { bundles: Array.from({ length: 7 }, (_, i) => ({ sourceIndices: [i], terminalSourceIndex: i })) },
    { bundles: [plan([0, 1, 2]).bundles[0], plan([3, 4, 5]).bundles[0], plan([6]).bundles[0]] },
    { bundles: [], extra: true }, { bundles: [{ ...plan([0]).bundles[0], extra: true }] },
    plan([0, 1, 2, 3, 4, 5, 6]), plan([-0]), plan(['0']), null];
  for (const value of invalid) assert.throws(() => compileBundlePlan(p, value), errorCode('invalid_model_output'));
  const inputs = [input([card(0), card(0)]), input(Array.from({ length: 37 }, (_, i) => card(i))), input([card(0)], 7)];
  const mixed = input(); mixed.candidates[1].namespaceIndex = 1; inputs.push(mixed);
  const duplicate = input(); duplicate.candidates[1].receipts[0].id = 'receipt-0'; inputs.push(duplicate);
  const tooLong = input([card(0, 'x'.repeat(801))]); inputs.push(tooLong);
  const tooMany = input([card(0)]); tooMany.candidates[0].receipts = Array.from({ length: 101 }, (_, i) => ({ id: `r-${i}`, role: 'user', excerpt: 'x' }));
  tooMany.candidates[0].receiptCount = 101; inputs.push(tooMany);
  const invented = input(); invented.candidates[0].memory.summary = 'Generated interpretation'; inputs.push(invented);
  for (const value of inputs) assert.throws(() => prepareBundleRankRequest(request(value), counter));
});

test('QB3 preserves non-rank port receivers, actual prepared identity, one planner call and immutable onPlan before refs', async () => {
  let calls = 0, sidecar, measured = []; const base = model({ marker: 'receiver',
    countTokens(text) { assert.equal(this.marker, 'receiver'); measured.push(text); return counter(text); },
    select() { assert.equal(this, base); return 'selection'; }, extract() { assert.equal(this, base); return 'extraction'; } });
  const m = wrapped(actual => { calls++; assert.equal(actual.system, BUNDLE_RANK_INSTRUCTION);
    assert(Object.isFrozen(actual.input.catalog)); assert(actual.signal instanceof AbortSignal); return plan(); },
  value => { sidecar = value; assert.throws(() => consumeBundlePlan(value), errorCode('invalid_bundle_sidecar')); }, base);
  assert.equal(m.select(), 'selection'); assert.equal(m.extract(), 'extraction');
  const result = await m.rank(request()); assert.equal(calls, 1); assert.deepEqual(result.refs, sidecar.refs);
  assert(measured.includes(JSON.stringify(sidecar.request))); assert(Object.isFrozen(sidecar.proposal.bundles[0].sourceIndices));
  assert.equal(consumeBundlePlan(sidecar), sidecar);
  assert.throws(() => consumeBundlePlan(sidecar), errorCode('invalid_bundle_sidecar'));
  assert.throws(() => consumeBundlePlan(structuredClone(sidecar)), errorCode('invalid_bundle_sidecar'));
  await assert.rejects(m.rank(request()), errorCode('bundle_invocation_conflict'));
});

test('QB7 descriptor/prototype/toJSON hazards reject without invoking accessors', async () => {
  let getters = 0; const getter = { get query() { getters++; throw new Error('Accessor'); }, limit: 6, candidates: [] };
  const hazards = [getter, { ...input(), toJSON() { getters++; return input(); } }, Object.create({ query: 'Inherited' }),
    input([Object.assign(Object.create({ inherited: true }), card(0))])];
  for (const value of hazards) assert.throws(() => prepareBundleRankRequest(request(value), counter));
  const sparse = input(); delete sparse.candidates[0]; assert.throws(() => prepareBundleRankRequest(request(sparse), counter));
  const output = { get bundles() { getters++; return []; } };
  await assert.rejects(wrapped(() => output).rank(request()), errorCode('invalid_model_output'));
  const forged = { get request() { getters++; throw new Error('Prepared accessor'); } };
  assert.throws(() => compileBundlePlan(forged, plan()), errorCode('invalid_input'));
  assert.throws(() => compileBundlePlan(structuredClone(prepareBundleRankRequest(request(), counter)), plan()), errorCode('invalid_input'));
  assert.equal(getters, 0);
});

test('QB7 request/output budgets, mutation, cancellation, provider/callback failure never retry or fall back', async () => {
  let calls = 0;
  await assert.rejects(wrapped(() => { calls++; return plan(); }, () => {}, model({ countTokens: () => 6001 })).rank(request()), errorCode('context_budget_exceeded'));
  assert.equal(calls, 0);
  const outputCounter = text => text.startsWith('{"bundles"') ? 1025 : 1;
  await assert.rejects(wrapped(() => { calls++; return plan(); }, () => {}, model({ countTokens: outputCounter })).rank(request()), errorCode('invalid_model_output'));
  const raw = plan(); let doomed;
  await assert.rejects(wrapped(() => raw, sidecar => { doomed = sidecar; raw.bundles[0].sourceIndices.reverse(); }).rank(request()), errorCode('invalid_model_output'));
  assert.throws(() => consumeBundlePlan(doomed), errorCode('invalid_bundle_sidecar'));
  const huge = { bundles: [], junk: 'x'.repeat(40001) };
  // Extra-property rejection only; the valid-shape 1025-token proposal above
  // is the isolated oversized-output control, not this shape-invalid object.
  await assert.rejects(wrapped(() => huge).rank(request()), errorCode('invalid_model_output'));
  const controller = new AbortController(); controller.abort();
  await assert.rejects(wrapped(() => { calls++; return plan(); }).rank(request(input(), controller.signal)), { name: 'AbortError' });
  const during = new AbortController();
  await assert.rejects(wrapped(() => { during.abort(); return plan(); }).rank(request(input(), during.signal)), { name: 'AbortError' });
  const provider = new Error('Synthetic provider failure'); let failures = 0;
  await assert.rejects(wrapped(() => { failures++; throw provider; }).rank(request()), error => error === provider);
  assert.equal(failures, 1);
  const callback = new Error('Synthetic observer failure');
  await assert.rejects(wrapped(() => plan(), () => { throw callback; }).rank(request()), error => error === callback);
});

test('QB7 simultaneous and reentrant use reject while independent wrappers remain isolated', async () => {
  let release, entered; const reached = new Promise(resolve => { entered = resolve; });
  const m = wrapped(() => { entered(); return new Promise(resolve => { release = () => resolve(plan()); }); });
  const first = m.rank(request()); await reached;
  await assert.rejects(m.rank(request()), errorCode('bundle_invocation_conflict')); release(); await first;
  let nested; const recursive = wrapped(() => plan(), () => { nested = recursive.rank(request()); });
  await recursive.rank(request()); await assert.rejects(nested, errorCode('bundle_invocation_conflict'));
  const results = await Promise.all([wrapped(() => plan([0])).rank(request()), wrapped(() => plan([1])).rank(request())]);
  assert.deepEqual(results.map(x => x.refs[0].memoryId), ['card-0', 'card-1']);
});

const [major, minor] = process.versions.node.split('.').map(Number);
test('QB3 actual local tokenizer measures the complete schema-bound representation',
  { skip: major < 22 || major === 22 && minor < 16 ? 'Pinned tokenizer integration gate on Node >=22.16' : false }, async t => {
    let countOpenAITokens;
    try { ({ countOpenAITokens } = await import('../../../adapters/openai/index.mjs')); }
    catch (error) {
      if (process.env.CAIRN_BUNDLE_TOKENIZER_REQUIRED === '1' || error.code !== 'ERR_MODULE_NOT_FOUND'
        || !error.message.includes("Cannot find package 'tiktoken'")) throw error;
      t.skip('Optional tiktoken not installed in dependency-free generic CI'); return;
    }
    const p = prepareBundleRankRequest(request(), countOpenAITokens);
    assert(countOpenAITokens(JSON.stringify(p.request)) <= 6000);
    assert(countOpenAITokens(JSON.stringify(p.request)) > countOpenAITokens(JSON.stringify(p.request.input)));
    assert.equal(Object.hasOwn(p.request.outputSchema.properties.bundles.items.properties.sourceIndices, 'uniqueItems'), false);
  });

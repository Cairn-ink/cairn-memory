import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { metrics, bootstrap, decide } from '../../evaluation/context-read-p2e/statistics.mjs';
import { PROTOCOL, sealRegistration, verifyRegistration, requireHostedRegistration } from '../../evaluation/context-read-p2e/registration.mjs';
import { hash, json, loadFixtures, deriveLabels, validateFixtures, cells, ROOT } from '../../evaluation/context-read-p2e/fixtures.mjs';
import { inventory, safetyFixtures } from '../../evaluation/context-read-p2e/inventory.mjs';
import { money, usd, charge, estimateCost, transmissionGuard } from '../../evaluation/context-read-p2e/cost.mjs';
import { validateProviderSelection, hostedEmbedder, fakeEmbedder } from '../../evaluation/context-read-p2e/providers.mjs';
import { SAFETY_CELLS, pendingSafety, checkSafety } from '../../evaluation/context-read-p2e/safety.mjs';
import { analyze } from '../../evaluation/context-read-p2e/analysis.mjs';
import { main, parseArgs } from '../../evaluation/context-read-p2e/runner.mjs';
import { tokenizeT1 } from '../../core/context-read-tokenize.mjs';

test('binary typed-identity metrics: independently calculated known answers and cutoffs', () => {
  const answer = metrics(['noise-1','a','noise-2','b'], ['a','b','c']);
  assert.equal(answer.recall5, 2 / 3); assert.equal(answer.recall12, 2 / 3);
  assert.ok(Math.abs(answer.ndcg12 - 0.49818925746641285) < 1e-15);
  const rank = Array.from({ length: 13 }, (_, i) => `d${i + 1}`);
  assert.deepEqual(metrics(rank, ['d5','d12','d13']), { recall5: 1/3, recall12: 2/3,
    ndcg12: (1 / Math.log2(6) + 1 / Math.log2(13)) / (1 + 1 / Math.log2(3) + .5) });
  assert.equal(metrics(['a','b'], ['a','b']).ndcg12, 1);
  assert.deepEqual(metrics([], ['a']), { recall5: 0, recall12: 0, ndcg12: 0 });
  assert.deepEqual(metrics(['a'], []), { recall5: null, recall12: null, ndcg12: null });
  assert.throws(() => metrics(['a','a'], ['a']), /invalid/);
  assert.throws(() => metrics(['a'], ['a','a']), /invalid/);
});
test('paired bootstrap is reproducible, seeded, retains draws and preserves pairing', () => {
  const pairs = [[0,1],[1,0],[1,1],[0,0]];
  const a = bootstrap(pairs, { seed: 'independent-fixture', resamples: 10000 });
  assert.deepEqual(a, bootstrap(pairs, { seed: 'independent-fixture', resamples: 10000 }));
  assert.notDeepEqual(a.draws, bootstrap(pairs, { seed: 'other', resamples: 10000 }).draws);
  assert.equal(a.delta, 0); assert.equal(a.draws.length, 10000);
  assert.deepEqual(a.ci, [-.75,.75]);
  const tied = bootstrap([[0,0],[1,1],[.25,.25]], { seed: 'paired', resamples: 10000 });
  assert.equal(tied.uncertainty, 0); assert.ok(tied.draws.every(d => d === 0));
  assert.throws(() => bootstrap([], { seed: 'empty' }), /invalid/);
});
const passedSafety = () => Object.fromEntries(SAFETY_CELLS.map(id => [id, { status: 'passed', violations: 0 }]));
const decisionInput = () => ({ macroRecallDelta: .02, macroNdcgDelta: 0,
  strata: Object.fromEntries(['cross-zh-en','cross-en-zh','cross-language','paraphrase','exact-identifier', 'identifier-path'].map(id => [id,
    { delta: id.includes('identifier') ? 0 : .05, uncertainty: .01 }])), safety: passedSafety(), provider: 'hosted', externalGates: { 'E.8': 'passed', 'E.9': 'passed' } });
test('conjunctive decision boundaries use unrounded values and strict identifier rule', () => {
  assert.equal(decide(decisionInput()).quality, 'passed');
  for (const field of ['macroRecallDelta', 'macroNdcgDelta']) {
    const input = decisionInput(); input[field] = field === 'macroRecallDelta' ? .02 - Number.EPSILON : -Number.EPSILON;
    assert.equal(decide(input).quality, 'failed');
  }
  for (const id of ['cross-zh-en','cross-en-zh','cross-language','paraphrase']) {
    const input = decisionInput(); input.strata[id].delta = .05 - Number.EPSILON;
    assert.equal(decide(input).quality, 'failed');
  }
  for (const width of [0, .01, .03]) {
    const input = decisionInput(); input.strata.baseline = { delta: -Math.max(width, .01), uncertainty: width };
    assert.equal(decide(input).quality, 'passed');
    input.strata.baseline.delta -= Number.EPSILON; assert.equal(decide(input).quality, 'failed');
  }
  for (const id of ['exact-identifier','identifier-path','identifier-sha/v23-current']) {
    const input = decisionInput(); input.strata[id] = { delta: -Number.MIN_VALUE, uncertainty: 1 };
    assert.ok(decide(input).failures.includes(`${id}:exact_regression`));
  }
  const bad = decisionInput(); bad.macroNdcgDelta = null; assert.equal(decide(bad).quality, 'failed');
  const fake = decisionInput(); fake.provider = 'fake'; assert.equal(decide(fake).quality, 'fake_correctness_only');
  assert.equal(decide(fake).enablement, 'pending');
  const pending = decisionInput(); pending.externalGates = {}; assert.equal(decide(pending).enablement, 'pending');
});
test('every safety cell is mandatory; a single violation defeats recall gains', () => {
  const input = decisionInput(); delete input.safety[SAFETY_CELLS[0]];
  assert.equal(decide(input).quality, 'failed');
  for (const id of SAFETY_CELLS) {
    const input = decisionInput(); input.safety[id].violations = 1;
    assert.equal(decide(input).quality, 'failed');
  }
  const observations = { 'semantic-false/candidates': { lexical: { ok: true, elapsedMs: 1, refs: ['a'] }, explicitFalse: { ok: true, elapsedMs: 3, refs: ['a'] }, semanticCalls: 0 } };
  assert.equal(checkSafety(observations)['semantic-false/candidates'].status, 'passed');
  observations['semantic-false/candidates'].explicitFalse.trace = { semantic: {} };
  assert.equal(checkSafety(observations)['semantic-false/candidates'].status, 'failed');
  assert.deepEqual(checkSafety({}), pendingSafety());
  const id = SAFETY_CELLS[0];
  const o = { forbidden: ['safety-target@1'], canonicalSnapshot: 'after-mutation', mutationAcknowledged: true, qualifiedHistoryControl: 'history-eligible@1',
    returns: ['candidates','assembly','evidence','private-metadata'].map(surface => ({ surface, identities: [], scopeCanaries: [], envelope: { ok: true } })) };
  assert.equal(checkSafety({ [id]: o })[id].status, 'incomplete');
  o.returns[0].identities.push('safety-target@1');
  assert.notEqual(checkSafety({ [id]: o })[id].status, 'passed');
  o.forbidden = ['convenient-substitute@1']; assert.equal(checkSafety({ [id]: o })[id].status, 'incomplete');
  const purgeId = 'owner-purge/all-catalogs';
  const purge = { completed: true, ownerId: 'synthetic-owner', catalogBefore: ['current','history'], catalogAfter: ['current','history'],
    rowsBefore: [{ ownerId: 'synthetic-owner' }], rowsAfter: [], otherOwnerBefore: [{ ownerId: 'other', vectorHash: 'canary' }],
    otherOwnerAfter: [{ ownerId: 'other', vectorHash: 'canary' }], independentInventory: true, noPendingWriters: true,
    inventoryCoverage: ['all-identities','both-intents','all-types','staging','obsolete'], lexicalBefore: { ok: true }, lexicalAfter: { ok: true } };
  purge.lexicalAfterInspection = { envelope: purge.lexicalAfter, identities: [], scopeCanaries: [] };
  assert.equal(checkSafety({ [purgeId]: purge })[purgeId].status, 'passed');
  purge.rowsAfter.push({ ownerId: 'synthetic-owner' });
  assert.equal(checkSafety({ [purgeId]: purge })[purgeId].status, 'failed');
  purge.rowsAfter = []; purge.otherOwnerAfter = [];
  assert.equal(checkSafety({ [purgeId]: purge })[purgeId].status, 'failed');
  purge.catalogAfter = ['current']; assert.equal(checkSafety({ [purgeId]: purge })[purgeId].status, 'incomplete');
});
test('registration sealing, byte mismatch, threshold mutation and missing bindings refuse', () => {
  const registered = JSON.parse(readFileSync(new URL('../../evaluation/context-read-p2e/registration.json', import.meta.url)));
  const files = registered.files;
  const sealed = sealRegistration(registered);
  assert.equal(verifyRegistration(sealed).seal.digest, sealed.seal.digest);
  assert.throws(() => verifyRegistration({ ...sealed, seal: null }, () => 'fixture'), /not_sealed/);
  assert.throws(() => verifyRegistration(sealed, () => 'changed'), /input_mismatch/);
  assert.throws(() => verifyRegistration({ ...sealed, engineCommit: 'changed' }, () => 'fixture'), /not_sealed/);
  const altered = structuredClone(PROTOCOL); altered.decision.macroRecallGain = .019;
  assert.throws(() => sealRegistration({ protocol: altered, files }), /invalid_registration/);
  assert.throws(() => requireHostedRegistration(sealed), /unresolved/);
  assert.equal(verifyRegistration(registered).seal.digest.length, 64);
});

const loaded = loadFixtures();
const tokens = JSON.parse(readFileSync(new URL('tokens.json', ROOT)));
test('frozen recipe, T1 oracle, independent gold derivation and complete stratum minima', () => {
  assert.deepEqual(validateFixtures(loaded.fixture, loaded.labels), { documents: 19000, queries: 43701, cells: 48 });
  assert.equal(json(deriveLabels(loaded.fixture)), json(loaded.labels));
  const inv = inventory(loaded.fixture);
  assert.equal(inv.primaryCount, 48);
  for (const stratum of inv.strata) { assert.ok(stratum.positive.length >= 50); assert.ok(stratum.negative.length >= 10); }
  assert.equal(inv.strata.find(s => s.id === 'cross-zh-en').positive.length, 2400);
  assert.equal(inv.strata.find(s => s.id === 'cross-en-zh').positive.length, 2400);
  assert.equal(inv.strata.find(s => s.id === 'paraphrase').positive.length, 4800);
  for (const world of [6672,18616]) assert.equal(loaded.fixture.documents.filter(d => d.type === 'memory' && d.minWorld <= world).length, world);
  for (const q of loaded.fixture.queries) assert.ok(Object.hasOwn(tokens.counts, hash(q.text)));
  for (const d of loaded.fixture.documents) assert.ok(Object.hasOwn(tokens.counts, hash(d.text)));
  for (const d of safetyFixtures().canaries) assert.ok(Object.hasOwn(tokens.counts, hash(d.text)));
  assert.ok(Object.hasOwn(tokens.counts, hash(safetyFixtures().query)));
  assert.deepEqual(tokenizeT1('中'), ['中']); assert.deepEqual(tokenizeT1('中文'), ['中文']);
  assert.equal(tokenizeT1(loaded.fixture.documents.find(d => d.fact === 'han-control').text).includes('中'), false);
});
test('cost arithmetic: exact decimal USD, ceil reservations, known hand-counted schedule and cap equality', () => {
  assert.equal(usd(money('1.000000000001')), '1.000000000001');
  assert.equal(charge(1, '0.000000000001'), 1n);
  for (const value of ['-1','1e-2',' 1','01','0.0000000000001']) assert.throws(() => money(value), /invalid_usd/);
  // One document and one zh query, both one ASCII byte: known 1 token each,
  // 17 reservation tokens each. Twelve refreshes + twelve query transmissions.
  const fixture = { documents: [{ text: 'a', type: 'memory', minWorld: 6672, intents: ['current','history'] }], queries: [{ text: 'b', language: 'zh' }] };
  const table = { counter: 'known-test-counter', counts: { [hash('a')]: 1, [hash('b')]: 1 } };
  // There are 12 distinct schema/world/intent refresh projections, not 6.
  const cost = estimateCost(fixture, table, '1', '1');
  assert.equal(cost.schedule.refresh.inputs, 12); assert.equal(cost.schedule.query.inputs, 12);
  assert.equal(cost.schedule.expectedUsd, '0.000024'); assert.equal(cost.schedule.reservationUsd, '0.000408');
  assert.doesNotThrow(() => estimateCost(fixture, table, '1', '0.000408'));
  assert.throws(() => estimateCost(fixture, table, '1', '0.000407999999'), /max_usd/);
  assert.throws(() => estimateCost(fixture, { counts: {} }, '1'), /unregistered/);
  const stateDirectory = mkdtempSync(join(tmpdir(), 'p2e-cap-'));
  try {
    const guard = transmissionGuard({ tokenTable: table, rate: '1', maxUsd: '0.000034', maxRequests: 2,
      stateDirectory, authorization: { id: 'cost-test', fromUtcMs: 0, untilUtcMs: 1000 }, now: () => 500 });
    assert.equal(guard(['a'], 'one').reservedUsd, '0.000017'); assert.equal(guard(['b'], 'two').reservedUsd, '0.000034');
    assert.throws(() => guard(['a'], 'three'), /run_cap/);
    assert.throws(() => guard(['unregistered'], 'four'), /unregistered/);
  } finally { rmSync(stateDirectory, { recursive: true, force: true }); }
});
test('hosted flag, key, test context, price, and cap are explicit gates; fake ignores environment', async () => {
  assert.throws(() => validateProviderSelection({ requestHosted: true }, {}), /explicit_provider/);
  assert.throws(() => validateProviderSelection({ provider: 'hosted' }, {}), /key_required/);
  // A marker is not a credential; no real adapter is imported by this test.
  assert.throws(() => validateProviderSelection({ provider: 'hosted' }, { OPENAI_API_KEY: 'synthetic-test-marker' }), /forbidden_in_tests/);
  await assert.rejects(hostedEmbedder({}, {}, tokens), /explicit_provider/);
  assert.equal(validateProviderSelection({}, { OPENAI_API_KEY: 'synthetic-test-marker' }), 'fake');
  const fake = fakeEmbedder(), first = await fake.embed(['synthetic fixture']);
  assert.deepEqual(first, await fake.embed(['synthetic fixture']));
  assert.equal(first[0].length, 1536); assert.equal(first[0].reduce((s, n) => s + n*n, 0), 1);
  assert.throws(() => parseArgs(['--api-key','forbidden']), /invalid_cli/);
});
test('analysis refuses missing observations, keeps every attempted pair and every safety cell', () => {
  const report = analyze({ ...loaded, inventory: inventory(loaded.fixture), observations: [], resamples: 10 });
  assert.equal(report.status, 'incomplete'); assert.equal(report.decision.quality, 'failed');
  assert.equal(report.problems.filter(p => p.code === 'missing_pair').length, 524412);
  assert.equal(Object.keys(report.safety).length, SAFETY_CELLS.length);
});
test('analysis macro weights primary strata equally, independent of their query counts', () => {
  const fixture = { documents: [{ id: 'relevant', type: 'memory', minWorld: 6672, intents: ['current','history'] }],
    queries: ['one','two','three'].map((id, i) => ({ id, language: i === 2 ? 'zh' : 'en', negative: false, control: false })) };
  const en = '6672-v18-current-en', zh = '6672-v18-current-zh';
  const labels = [{ cell: en, queries: ['one','two'].map(id => ({ id, relevant: ['relevant'] })) }, { cell: zh, queries: [{ id: 'three', relevant: ['relevant'] }] }];
  const arm = hit => ({ ok: true, ranking: hit ? ['relevant'] : [], coverage: 'complete', evidenceVerified: true });
  const observations = ['one','two','three'].map((query, i) => ({ query, cell: i === 2 ? zh : en,
    A: { ...arm(i !== 1), effective: 'lexical' }, B: { ...arm(true), effective: 'hybrid', semanticCoverage: 'complete', queryEmbeddingAttempts: 1, preset: 'rrf-k10', degradedReason: null, providerIdentityVerified: true } }));
  const inv = { strata: [{ id: `primary/${en}`, cell: en, kind: 'primary', positive: ['one','two'], negative: [] }, { id: `primary/${zh}`, cell: zh, kind: 'primary', positive: ['three'], negative: [] }] };
  const result = analyze({ fixture, labels, inventory: inv, observations, resamples: 20 });
  assert.equal(result.macro.recall12.A, .75); assert.equal(result.macro.recall12.B, 1);
  assert.equal(result.macro.recall12.delta, .25); assert.equal(result.macro.ndcg12.delta, .25);
  assert.equal(result.perQuery.length, 3); assert.equal(result.observations.length, 3);
});
test('runner uses actual public product capabilities and returns blocked_dependency without a provider', async () => {
  const report = await main(['--provider','fake'], {});
  assert.equal(report.status, 'blocked_dependency'); assert.equal(report.probe.capabilities.execution, 'worker');
  // P2e exports the API; the unchanged sealed run still has no host binding.
  assert.equal(report.probe.reason, 'sealed_public_engine_host_binding_required');
  assert.ok(report.probe.capabilities.unsupported.includes('semantic'));
  assert.equal(report.probe.capabilities.semanticExtension, undefined);
  assert.equal(report.observations.length, 0); assert.equal(report.decision.enablement, 'pending');
  assert.ok(Object.values(report.safety).every(s => s.status === 'not_run'));
  const missingKey = await main(['--provider','hosted','--price-usd-per-million','1','--max-usd','1'], {});
  assert.equal(missingKey.status, 'refused'); assert.equal(missingKey.error, 'hosted_key_required');
  const tooSmall = await main(['--estimate','--price-usd-per-million','1','--max-usd','0'], {});
  assert.equal(tooSmall.status, 'refused'); assert.equal(tooSmall.error, 'max_usd_exceeded_before_transmission');
});
import './p2e-offline.mjs';

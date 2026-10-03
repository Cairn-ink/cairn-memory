import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy, MODEL_ID } from '../../live/session.mjs';
import { mem0WireProfile } from '../../experiment-budget/mem0-wire.mjs';
import { mixedSourcePolicy, suppliedHistoryPolicy } from '../mixed-source.mjs';
import { OFFICIAL_JUDGE_MODEL, OFFICIAL_QUESTION_TYPES, OFFICIAL_UPSTREAM_COMMIT } from '../official-scoring.mjs';
import * as data from '../mixed-protocol-data.mjs';
import { sourceHistoryFamily, sourceProtocolDocuments, sourceProtocolIdentity } from '../mixed-source-policy.mjs';
import { hash } from '../mixed-validation.mjs';

const legacy = JSON.parse(readFileSync(new URL('../testing/mixed-protocol-legacy.json', import.meta.url)));
const orderedEqual = (actual, expected) => assert.equal(JSON.stringify(actual), JSON.stringify(expected));
const boundaries = () => [
  [data.MIXED_SOURCE_POLICY, mixedSourcePolicy()],
  [data.SUPPLIED_HISTORY_POLICY, suppliedHistoryPolicy()],
  [data.MEM0_WIRE_PROFILE, mem0WireProfile()],
  [data.BENCHMARK_STAGE_POLICY, benchmarkStagePolicy()],
  [data.EXPERIMENT_POLICY, experimentPolicy()],
  [data.OFFICIAL_PROTOCOL, { judgeModel: OFFICIAL_JUDGE_MODEL,
    upstreamCommit: OFFICIAL_UPSTREAM_COMMIT, questionTypes: OFFICIAL_QUESTION_TYPES }],
];
function assertFrozen(value) {
  if (value === null || typeof value !== 'object') return;
  assert.equal(Object.isFrozen(value), true);
  Object.values(value).forEach(assertFrozen);
}

test('SJ4 complete ordered five-factory snapshots and constants remain exact', () => {
  for (const [snapshot, factory] of boundaries()) {
    orderedEqual(snapshot, factory); assertFrozen(snapshot);
  }
  assert.equal(data.MODEL_ID, MODEL_ID);
  for (const policy of [data.MIXED_SOURCE_POLICY, data.SUPPLIED_HISTORY_POLICY]) {
    const { digest, ...body } = policy;
    assert.equal(digest, hash(body.hashDomains.policy, body));
  }
});

test('SJ4 ordered drift comparator rejects independent value, object-key and category/array mutations', () => {
  for (const [snapshot, factory] of boundaries()) {
    const value = structuredClone(snapshot), key = Object.keys(value)[0];
    value[key] = 'INDEPENDENT_MUTATION';
    assert.throws(() => orderedEqual(value, factory));
    const reordered = Object.fromEntries(Object.entries(snapshot).reverse());
    assert.throws(() => orderedEqual(reordered, factory));
  }
  for (const [snapshot, factory, keys] of [
    [data.MIXED_SOURCE_POLICY, mixedSourcePolicy(), ['rendering', 'roles']],
    [data.SUPPLIED_HISTORY_POLICY, suppliedHistoryPolicy(), ['originClasses']],
    [data.OFFICIAL_PROTOCOL, boundaries().at(-1)[1], ['questionTypes']],
  ]) {
    const value = structuredClone(snapshot);
    keys.reduce((current, key) => current[key], value).reverse();
    assert.throws(() => orderedEqual(value, factory));
  }
});

for (const supplied of [false, true]) {
  for (const row of legacy.rows) {
    test(`SJ4 ordered identity ${supplied ? 'supplied' : 'legacy'} ${row.profile} ${row.options.nativeConfigurationSha256.slice(0, 8)}`, () => {
      const family = sourceHistoryFamily(supplied ? 'supplied-history-v1' : undefined);
      const context = JSON.parse(row.contextJson), scorer = JSON.parse(row.scorerJson);
      if (supplied) {
        context.sourcePolicyDigest = data.SUPPLIED_HISTORY_POLICY.digest;
        context.version = row.profile === 'qualified' ? 'supplied-history-mixed-context-v1'
          : 'supplied-history-mixed-indexed-evidence-context-v1';
        context.sourceHistoryPolicy = 'supplied-history-v1';
        context.preparationVersion = row.profile === 'qualified'
          ? 'cairn-lme-supplied-history-mixed-preparation-v1'
          : 'cairn-lme-supplied-history-mixed-indexed-evidence-preparation-v1';
        context.generationVersion = 'cairn-lme-supplied-history-mixed-generation-v1';
        scorer.version = 'supplied-history-mixed-scorer-v1';
        scorer.generationVersion = 'cairn-lme-supplied-history-mixed-generation-v1';
        scorer.scoringVersion = 'cairn-lme-supplied-history-mixed-scoring-v1';
      }
      const documents = sourceProtocolDocuments(family, row.options);
      orderedEqual(documents.context, context); orderedEqual(documents.scorer, scorer);
      const expected = supplied ? {
        sourceProtocolSha256: data.SUPPLIED_HISTORY_POLICY.digest,
        contextProtocolSha256: hash('cairn.lme.supplied-history-mixed.context.v1', context),
        scorerProtocolSha256: hash('cairn.lme.supplied-history-mixed.scorer.v1', scorer),
      } : JSON.parse(row.identityJson);
      orderedEqual(sourceProtocolIdentity(family, row.options), expected);
      assert.equal(Object.hasOwn(documents.context, 'comparisonProfile'), row.profile !== 'qualified');
    });
  }
}

test('SJ4 family descriptors are immutable singleton capabilities, not arbitrary descriptors', () => {
  const legacyFamily = sourceHistoryFamily(), supplied = sourceHistoryFamily('supplied-history-v1');
  assert.equal(sourceHistoryFamily(), legacyFamily);
  assert.equal(sourceHistoryFamily('supplied-history-v1'), supplied);
  assert.notEqual(legacyFamily, supplied);
  assertFrozen(legacyFamily); assertFrozen(supplied);
  assert.throws(() => sourceProtocolIdentity({ ...legacyFamily }, legacy.rows[0].options),
    { code: 'invalid_mixed_report' });
  assert.throws(() => sourceHistoryFamily(null), { code: 'invalid_mixed_preparation' });
});

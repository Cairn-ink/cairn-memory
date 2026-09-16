import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { assessSyntheticRationaleCorrection, runRationaleCorrectionCase } from
  '../../evaluation/architecture/rationale-correction-runner.mjs';
import { boundedText } from '../validation.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../evaluation/architecture/rationale-correction-fixture.json', import.meta.url)));
const rubric = JSON.parse(readFileSync(new URL('../../evaluation/architecture/rationale-correction-rubric.json', import.meta.url)));
const namespace = { ownerId: 'synthetic-rationale-correction', scope: 'personal', projectId: null };
const scenario = id => fixture.cases.find(item => item.id === id);
const oracle = id => rubric.cases.find(item => item.id === id);
function fresh(t) {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-correction-case-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'synthetic.sqlite');
}
function outputFor(events, edges) {
  const indices = new Map(events.map((event, index) => [event.id, index]));
  return { edges: edges.map(edge => ({ from: indices.get(edge.from), to: indices.get(edge.to),
    relation: edge.relation, fromReceipt: 0, toReceipt: 0 })) };
}
const run = (t, id, relate) => runRationaleCorrectionCase({ path: fresh(t), namespace,
  scenario: scenario(id), seedEdges: oracle(id).seedEdges, relate });

test('RC1/RC2 frozen cases separate dated source arrival from rubric and include one Traditional Chinese history', () => {
  assert.equal(fixture.version, 1); assert.equal(rubric.fixtureId, fixture.id);
  assert.equal(fixture.cases.length, 3); assert.deepEqual(fixture.cases.map(item => item.id), rubric.cases.map(item => item.id));
  assert.ok(fixture.cases.some(item => item.events.some(event => /[\u3400-\u9fff]/u.test(event.text))));
  for (const item of fixture.cases) {
    assert.ok(item.events.length <= 6);
    assert.deepEqual(item.events.map(event => event.arrivalIndex), item.events.map((_, index) => index));
    assert.ok(item.events.every(event => event.text.includes(event.eventDate.slice(0, 4))));
    assert.ok(!Object.hasOwn(item, 'seedEdges'));
    assert.ok(!Object.hasOwn(item, 'expectedEdges'));
  }
  const mixed = scenario('mixed-distinct-premises').events;
  assert.equal(mixed.at(-1).id, 'encryptionPremise');
  assert.equal(mixed.at(-1).eventDate, '2031-06-01');
  assert.equal(mixed.at(-2).eventDate, '2031-06-04');
  assert.ok(mixed.at(-1).text.includes('imported on June 5'));
});

for (const item of fixture.cases) {
  test(`RC2-RC5 selective scripted judgment keeps correct graph for ${item.id}`, async t => {
    const seen = [];
    const report = await run(t, item.id, request => {
      seen.push(structuredClone(request.input));
      return outputFor(item.events, oracle(item.id).expectedEdges);
    });
    assert.equal(report.reviewCalls, 1); assert.equal(seen.length, 1);
    assert.deepEqual(seen[0], { memories: item.events.map((event, index) => ({ index,
      receipts: [{ index: 0, role: event.role, excerpt: boundedText(event.text, 800) }] })) });
    for (const forbidden of [item.id, namespace.ownerId, 'seedEdges', 'expectedEdges', 'arrivalIndex']) {
      assert.equal(JSON.stringify(seen[0]).includes(forbidden), false);
    }
    assert.equal(report.seed.ok, true); assert.equal(report.review.ok, true);
    assert.equal(report.review.value.writeMode, 'replace-reviewed');
    assert.equal(report.coldMatches, true);
    assert.deepEqual(report.before.records, report.after.records);
    assert.deepEqual(report.cold, report.after);
    const scored = assessSyntheticRationaleCorrection(report, oracle(item.id));
    assert.equal(scored.structuralSuccess, true);
    assert.equal(scored.syntheticFixturePass, true);
    assert.equal(scored.independentSourceReviewRequired, true);
    assert.equal(scored.interpretationStatus, 'unassessed');
    assert.equal(report.after.defaultGraphs[item.events.findIndex(event => event.id === 'decision')].value.status,
      oracle(item.id).expectedDecisionStatus);
  });
}

for (const item of fixture.cases) {
  test(`RC5 clearing every proposal is mechanically valid but fails rubric for ${item.id}`, async t => {
    const report = await run(t, item.id, () => ({ edges: [] }));
    const scored = assessSyntheticRationaleCorrection(report, oracle(item.id));
    assert.equal(scored.structuralSuccess, true);
    assert.equal(scored.syntheticFixturePass, false);
    assert.equal(report.review.value.removed, oracle(item.id).seedEdges.length);
    assert.deepEqual(report.before.records, report.after.records);
    assert.equal(report.coldMatches, true);
  });
}

for (const id of ['retracted-offline-report', 'mixed-distinct-premises']) {
  test(`RC5 preserving the scripted mistaken challenge fails rubric for ${id}`, async t => {
    const item = scenario(id);
    const report = await run(t, id, () => outputFor(item.events, oracle(id).seedEdges));
    const scored = assessSyntheticRationaleCorrection(report, oracle(id));
    assert.equal(scored.structuralSuccess, true);
    assert.equal(scored.syntheticFixturePass, false);
    assert.equal(report.review.value.inserted, 0);
    assert.equal(report.review.value.removed, 0);
    assert.equal(report.coldMatches, true);
  });
}

for (const failure of ['throw', 'malformed']) {
  test(`RC3/RC5 ${failure} relation output retains a failed record and original graph`, async t => {
    const id = 'mixed-distinct-premises';
    const report = await run(t, id, () => {
      if (failure === 'throw') throw new Error('synthetic provider body');
      return { edges: [{ from: 99, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] };
    });
    assert.equal(report.reviewCalls, 1);
    assert.equal(report.review.ok, false);
    assert.equal(report.review.error.code, failure === 'throw' ? 'rationale_failed' : 'invalid_model_output');
    assert.deepEqual(report.after, report.before);
    assert.equal(report.coldMatches, true);
    const scored = assessSyntheticRationaleCorrection(report, oracle(id));
    assert.equal(scored.structuralSuccess, false);
    assert.equal(scored.syntheticFixturePass, false);
  });
}

test('RC3 existing database refuses before any model call or data mutation', async t => {
  const path = fresh(t); writeFileSync(path, 'unrelated-data'); let calls = 0;
  await assert.rejects(runRationaleCorrectionCase({ path, namespace, scenario: scenario('retracted-offline-report'),
    seedEdges: oracle('retracted-offline-report').seedEdges, relate: () => { calls++; return { edges: [] }; } }),
  /invalid_rationale_correction_configuration/);
  assert.equal(calls, 0); assert.equal(readFileSync(path, 'utf8'), 'unrelated-data');
});

test('RC3 symlink parent and occupied SQLite sidecar refuse without writes or model work', async t => {
  const path = fresh(t); const directory = dirname(path);
  const real = join(directory, 'real'); const alias = join(directory, 'alias');
  mkdirSync(real); symlinkSync(real, alias);
  let calls = 0;
  const options = { namespace, scenario: scenario('retracted-offline-report'),
    seedEdges: oracle('retracted-offline-report').seedEdges,
    relate: () => { calls++; return { edges: [] }; } };
  await assert.rejects(runRationaleCorrectionCase({ ...options, path: join(alias, 'synthetic.sqlite') }),
    /invalid_rationale_correction_configuration/);
  assert.equal(calls, 0);
  const sidecar = `${path}-wal`; writeFileSync(sidecar, 'existing-sidecar');
  await assert.rejects(runRationaleCorrectionCase({ ...options, path }),
    /invalid_rationale_correction_configuration/);
  assert.equal(readFileSync(sidecar, 'utf8'), 'existing-sidecar'); assert.equal(calls, 0);
});

test('RC3 caller mutation during review cannot change frozen case/ref mapping', async t => {
  const item = structuredClone(scenario('retracted-offline-report'));
  const seedEdges = structuredClone(oracle(item.id).seedEdges);
  const expected = outputFor(item.events, oracle(item.id).expectedEdges);
  const report = await runRationaleCorrectionCase({ path: fresh(t), namespace, scenario: item, seedEdges,
    relate: () => { item.events[0].id = 'mutated'; seedEdges.length = 0; return expected; } });
  assert.equal(report.eventIds[0], 'decision');
  assert.equal(report.seed.value.proposed, 2);
  assert.equal(assessSyntheticRationaleCorrection(report, oracle(report.caseId)).syntheticFixturePass, true);
});

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = relative => readFileSync(new URL(relative, import.meta.url));
const result = JSON.parse(read('../../../docs/evidence/rationale-disposition-results.json'));
const fixture = JSON.parse(read('../rationale-disposition-fixture.json'));
const digest = value => createHash('sha256').update(value).digest('hex');
const tuple = edge => [edge.from, edge.to, edge.relation, edge.fromReceipt, edge.toReceipt].join(':');

test('RE1–2 public results bind frozen inputs and contain every local old edge and raw output', () => {
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.pins.sourceCommit, '35f2c56f0df725b8959e7b088cbd8c247f6c3c8a');
  for (const [key, file] of Object.entries({
    fixtureSha256: '../rationale-disposition-fixture.json',
    rubricSha256: '../../../docs/rationale-disposition-rubric.md',
    controlPromptSha256: '../prompts/rationale-disposition-control.md',
    candidatePromptSha256: '../../../core/prompts/review-rationale-dispositions-v2.md',
  })) assert.equal(result.pins[key], digest(read(file)), key);
  assert.match(result.pins.installedArtifactSha256, /^[a-f0-9]{64}$/u);
  assert.equal(result.pins.retainedPrivateReportSha256,
    'b24012df3033438bec2f77468c9b77de3b9ab51f6ae0171f1dc3400070b6927f');

  assert.deepEqual(result.cases.map(item => item.id), fixture.cases.map(item => item.id));
  for (const [index, item] of result.cases.entries()) {
    const source = fixture.cases[index];
    assert.equal(item.oldEdges.length, source.oldEdges.length);
    assert.deepEqual(item.oldEdges.map(tuple).sort(), source.oldEdges.map(tuple).sort());
    assert.deepEqual(item.oldEdges.map(edge => edge.index), item.oldEdges.map((_, i) => i));
    assert.equal(item.expectedOldActions.length, item.oldEdges.length);
    for (const action of item.expectedOldActions) assert.ok(['keep', 'withdraw', 'unknown'].includes(action));
    for (const arm of ['control', 'candidate']) {
      const evidence = item.arms[arm];
      assert.equal(evidence.completed, true);
      assert.equal(evidence.coldMatches, true);
      assert.equal(evidence.sourcesUnchanged, true);
      const output = JSON.parse(evidence.rawModelOutputText);
      if (arm === 'control') {
        assert.deepEqual(Object.keys(output), ['edges']);
        for (const edge of output.edges) {
          for (const endpoint of ['from', 'to']) {
            assert.ok(Number.isInteger(edge[endpoint]) && edge[endpoint] >= 0 &&
              edge[endpoint] < source.events.length);
          }
        }
      } else {
        assert.deepEqual(Object.keys(output), ['dispositions', 'additions']);
        assert.deepEqual(output.dispositions.map(entry => entry.edge).sort((a, b) => a - b),
          item.oldEdges.map(edge => edge.index));
      }
    }
  }
});

test('RE3–5 accounting and human-review labels do not imply semantic promotion', () => {
  assert.deepEqual(result.accounting, {
    httpRequests: 24,
    reservedMicroUsd: 120000,
    knownUsageEstimateMicroUsd: 5847,
    unknownCostRequests: 12,
    unsettledReservations: 0,
  });
  assert.equal(result.gates.completedArms, 12);
  assert.equal(result.gates.coldMatches, 12);
  assert.equal(result.gates.sourcesUnchanged, 12);
  assert.deepEqual(result.gates.historicalSupportsRetained,
    { control: 6, candidate: 6, obligations: 6 });
  assert.deepEqual(result.gates.falseWithdrawals, { control: 0, candidate: 0 });
  assert.deepEqual(result.gates.genuineChallengeCoverage,
    { control: 2, candidate: 1, obligations: 5 });
  assert.equal(result.cases.filter(item => item.review.challenge !== null).length, 5);
  assert.equal(result.cases.filter(item => item.review.controlCovered).length, 2);
  assert.equal(result.cases.filter(item => item.review.candidateCovered).length, 1);
  assert.equal(result.gates.controlPromotion, 'fail');
  assert.equal(result.gates.candidatePromotion, 'fail');
  const publicText = read('../../../docs/evidence/rationale-disposition-results.json').toString();
  assert.doesNotMatch(publicText, /\/tmp\/|\/home\/|api[_-]?key|request[_-]?id|ledgerRunId|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/iu);
});

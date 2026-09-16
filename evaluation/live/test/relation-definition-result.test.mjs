import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { scoreRelationDefinition } from '../relation-definition-score.mjs';

const ROOT = new URL('../../../', import.meta.url);
const ARTIFACT = 'evaluations/results/relation-definition-lite-v1.json';
const ARTIFACT_SHA256 = '45b9f167d0417aec4a10bc16aac6ff674ceffb90fec9a3d68345479c4552a0a3';
const SOURCE_COMMIT = 'bc17cf10561c3e9efc4a47be3d04be44463bc020';
const MODEL = 'gpt-4.1-mini-2025-04-14';
const sourceFiles = {
  fixtureSha256: 'evaluation/live/relation-definition-fixture.json',
  rubricSha256: 'evaluation/live/relation-definition-rubric.json',
  guideSha256: 'docs/relation-definition-lite-guide.md',
  operatorSha256: 'evaluation/live/relation-definition-lite.mjs',
  scorerSha256: 'evaluation/live/relation-definition-score.mjs',
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const file = name => readFileSync(new URL(name, ROOT));
const exactKeys = (value, keys) => assert.deepEqual(Object.keys(value).sort(), [...keys].sort());

test('RD public projection is the frozen, source-pinned, bounded twenty-slot result', () => {
  const bytes = file(ARTIFACT);
  assert.equal(digest(bytes), ARTIFACT_SHA256);
  const result = JSON.parse(bytes);
  exactKeys(result, ['version', 'id', 'diagnosticOnly', 'sourceCommit', 'requestedModel',
    ...Object.keys(sourceFiles), 'privateReportSha256', 'status', 'limits', 'budget',
    'cleanup', 'arms', 'latency', 'slots']);
  assert.equal(result.version, 1); assert.equal(result.id, 'relation-definition-lite-v1');
  assert.equal(result.diagnosticOnly, true); assert.equal(result.sourceCommit, SOURCE_COMMIT);
  assert.equal(result.requestedModel, MODEL); assert.equal(result.status, 'completed');
  assert.match(result.privateReportSha256, /^[0-9a-f]{64}$/u);
  for (const [field, source] of Object.entries(sourceFiles)) assert.equal(result[field], digest(file(source)));
  const fixture = JSON.parse(file(sourceFiles.fixtureSha256));
  const rubric = JSON.parse(file(sourceFiles.rubricSha256));
  assert.equal(fixture.cases.length, 10); assert.equal(rubric.cases.length, 10);

  exactKeys(result.limits, ['requests', 'microUsd', 'reservationMicroUsd', 'expectedRequests', 'slots']);
  assert.deepEqual(result.limits, { requests: 64, microUsd: 320000,
    reservationMicroUsd: 5000, expectedRequests: 40, slots: 20 });
  exactKeys(result.budget, ['requests', 'reservedMicroUsd', 'knownUsageMicroUsd',
    'unknownCostRequests', 'unsettledAfter']);
  assert.deepEqual(result.budget, { requests: 40, reservedMicroUsd: 200000,
    knownUsageMicroUsd: 6691, unknownCostRequests: 20, unsettledAfter: 0 });
  exactKeys(result.cleanup, ['drain', 'sessionClose', 'ledgerClose']);
  assert.deepEqual(result.cleanup, { drain: 'completed', sessionClose: 'completed', ledgerClose: 'completed' });

  assert.equal(result.slots.length, 20);
  const schedule = fixture.cases.flatMap((item, index) => (index % 2
    ? ['guide', 'baseline'] : ['baseline', 'guide']).map(arm => `${item.id}:${arm}`));
  assert.deepEqual(result.slots.map(slot => `${slot.caseId}:${slot.arm}`), schedule);
  assert.equal(new Set(schedule).size, 20);
  for (const slot of result.slots) {
    exactKeys(slot, ['caseId', 'arm', 'status', 'returnedModel', 'edges', 'durationMs']);
    assert.equal(slot.status, 'completed'); assert.equal(slot.returnedModel, MODEL);
    assert.ok(Number.isSafeInteger(slot.durationMs) && slot.durationMs >= 0);
    assert.ok(Array.isArray(slot.edges) && slot.edges.length <= 10);
    const source = fixture.cases.find(item => item.id === slot.caseId);
    for (const edge of slot.edges) {
      assert.ok(Array.isArray(edge) && edge.length === 5);
      const [from, to, relation, fromReceipt, toReceipt] = edge;
      assert.ok(['supports-decision', 'challenges-premise'].includes(relation));
      assert.ok(Number.isSafeInteger(from) && from >= 0 && from < source.memories.length);
      assert.ok(Number.isSafeInteger(to) && to >= 0 && to < source.memories.length);
      assert.ok(Number.isSafeInteger(fromReceipt) && fromReceipt >= 0
        && fromReceipt < source.memories[from].receipts.length);
      assert.ok(Number.isSafeInteger(toReceipt) && toReceipt >= 0
        && toReceipt < source.memories[to].receipts.length);
    }
    assert.equal(new Set(slot.edges.map(JSON.stringify)).size, slot.edges.length);
  }

  exactKeys(result.arms, ['baseline', 'guide']);
  const scored = scoreRelationDefinition({ id: result.id, slots: result.slots.map(slot => ({
    caseId: slot.caseId, arm: slot.arm, status: slot.status,
    proposal: { edges: slot.edges.map(([from, to, relation, fromReceipt, toReceipt]) =>
      ({ from, to, relation, fromReceipt, toReceipt })) },
  })) }, rubric);
  assert.deepEqual(result.arms, scored.arms);
  for (const arm of Object.values(result.arms)) {
    exactKeys(arm, ['slots', 'scored', 'failedOrMalformed', 'notRun', 'failed', 'malformed',
      'required', 'requiredScored', 'proposed', 'omitted', 'unsupported', 'complete']);
    assert.equal(arm.slots, 10); assert.equal(arm.scored, 10);
    assert.equal(arm.failedOrMalformed, 0); assert.equal(arm.notRun, 0);
    assert.equal(arm.failed, 0); assert.equal(arm.malformed, 0);
  }
  exactKeys(result.latency, ['baseline', 'guide']);
  for (const [arm, timing] of Object.entries(result.latency)) {
    exactKeys(timing, ['totalMs', 'medianMs', 'minMs', 'maxMs']);
    const durations = result.slots.filter(slot => slot.arm === arm).map(slot => slot.durationMs).sort((a, b) => a - b);
    assert.equal(timing.totalMs, durations.reduce((sum, value) => sum + value, 0));
    assert.equal(timing.minMs, durations[0]); assert.equal(timing.maxMs, durations.at(-1));
    assert.equal(timing.medianMs, Math.round((durations[4] + durations[5]) / 2));
  }

  // The fixed public shape cannot carry prompt, source excerpts, provider bodies,
  // credentials, local paths, ledger configuration or private evidence.
  const encoded = JSON.stringify(result);
  assert.doesNotMatch(encoded, /Bearer\s|apiKey|requestBody|responseBody|responseText|providerResponse|\/home\/|\/tmp\/|\\Users\\/iu);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import test from 'node:test';

test('frozen candidate result keeps six-case denominator and separates storage from semantic evidence', () => {
  const read = name => readFileSync(new URL(name, import.meta.url));
  const report = JSON.parse(read('../../../evaluations/results/candidate-qualification-pilot-v1.json'));
  const fixture = read('../candidate-qualification-fixture.json');
  assert.equal(createHash('sha256').update(fixture).digest('hex'), report.fixtureSha256);
  assert.deepEqual(report.cases.map(item => item.id), JSON.parse(fixture).cases.map(item => item.id));
  assert.equal(report.scheduledCases, 6);
  assert.equal(report.cases.filter(item => item.status === 'completed').length, 5);
  assert.equal(report.generalAccuracyClaim, false);
  assert.equal(report.cases.reduce((sum, item) => sum + item.storedRecords, 0), 6);
  assert.equal(report.cases.reduce((sum, item) => sum + item.httpRequests, 0), 34);
  assert.equal(report.accounting.reservedMicroUsd, 34 * 5000);
  assert.equal(report.accounting.knownUsageMicroUsd, 8166);
  assert.equal(report.accounting.additionalUnknownCostRequests, 17);
  assert.equal(report.accounting.unsettled, 0);
  const failed = report.cases.find(item => item.id === 'temporary_exception');
  assert.equal(failed.status, 'failed');
  assert.equal(failed.coldReplayVerified, false);
  assert.match(failed.finding, /no repair, admission or successful lifecycle/);
  assert.match(report.cases.at(-1).finding, /lacks the assistant antecedent/);
  assert.ok(report.limitations.some(text => text.includes('not five semantic passes')));
});

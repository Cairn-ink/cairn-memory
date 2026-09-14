import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { exportSourceLoopEvidence } from '../source-loop-evidence.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const fixtureBytes = readFileSync(new URL('../source-loop-fixture.json', import.meta.url));
const fixture = JSON.parse(fixtureBytes);
function sample() {
  return { version: 1, id: fixture.id, offline: false, pins: { fixture: hash(fixtureBytes) },
    sourceHead: 'synthetic', provenance: { artifactSha256: 'synthetic' }, result: { cases: fixture.cases.map(c => ({
      id: c.id, status: 'failed', captures: [], controls: [], recall: null })) }, traces: [] };
}
test('SLE1 frozen case identity/order and offline boundary; missing controls remain not-run not successes', () => {
  assert.equal(hash(fixtureBytes), 'c35cbaf8c72c6eb3294a5b82117897a6cea8a6fb534a6625bf6915eaadb04ca2');
  const result = exportSourceLoopEvidence(sample());
  assert.equal(result.cases.length, 4);
  assert.ok(result.cases.every(c => c.status === 'failed' && c.controls.length === 3 && c.controls.every(a => a.status === 'not_run')));
  for (const patch of [{ offline: true }, { id: 'wrong' }, { pins: { fixture: 'wrong' } }]) {
    assert.throws(() => exportSourceLoopEvidence({ ...sample(), ...patch }));
  }
  const raw = sample(); raw.result.cases.reverse(); assert.throws(() => exportSourceLoopEvidence(raw));
});
test('SLE2 preserves missing versus malformed versus empty raw output and rejects sensitive retained data', () => {
  const raw = sample(); raw.privatePath = '/tmp/private'; raw.provenance.packageRoot = '/home/private';
  assert.ok(!JSON.stringify(exportSourceLoopEvidence(raw)).includes('private'));
  const trace = { sequence: 1, kind: 'basis', route: '/responses', responseAvailable: false,
    requestBody: { model: 'gpt-5.6-sol', text: { format: { name: 'cairn_reviewBasis' } },
      input: [{ content: [{ text: '{"memories":[]}' }] }] },
    providerResponse: { output: [{ content: [{ text: 'malformed' }] }] } };
  raw.traces = [trace]; assert.equal(exportSourceLoopEvidence(raw).traces[0].outputText, null);
  trace.responseAvailable = true; assert.equal(exportSourceLoopEvidence(raw).traces[0].outputText, 'malformed');
  trace.providerResponse.output[0].content[0].text = '{"units":[],"links":[]}';
  assert.equal(exportSourceLoopEvidence(raw).traces[0].outputText, '{"units":[],"links":[]}');
  trace.providerResponse.output[0].content[0].text = '/tmp/private';
  assert.throws(() => exportSourceLoopEvidence(raw), /sensitive_source_loop_evidence/);
});
const bytes = readFileSync(new URL('../../../evaluations/results/source-loop-controls-v1.json', import.meta.url));
const published = JSON.parse(bytes);
test('SLE3 fixed installed evidence keeps eight captures, all source coverage, 12 controls and exact anchors', () => {
  assert.equal(hash(bytes), '2b21990d671a14cca678001f9deb9b6c3528c3e44a1d06d500d1777aeff304bf');
  assert.equal(published.cases.flatMap(c => c.captures).length, 8);
  const controls = published.cases.flatMap(c => c.controls);
  assert.equal(controls.length, 12); assert.equal(controls.filter(c => c.status === 'unassessed').length, 11);
  assert.equal(controls.filter(c => c.status === 'basis-failed').length, 1);
  for (const item of published.cases) {
    assert.ok(item.coldMatchesWarm && item.readOnlyChecks);
    assert.deepEqual(item.capturedCoverage.missing, []); assert.deepEqual(item.recalledCoverage.missing, []);
    for (const window of item.captures) {
      assert.ok(window.capture.ok && window.coldMatchesWarm); assert.deepEqual(window.warm, window.cold);
      assert.equal(window.capture.value.classification.status, 'applied');
      assert.deepEqual(window.capture.value.retainedSourceWindow.truncatedMessageIndices, []);
    }
    for (const control of item.controls) {
      assert.deepEqual(control.coverage.missing, []);
      if (!control.basis.ok) continue;
      assert.equal(control.basis.value.status, 'unassessed');
      for (const unit of control.basis.value.units) {
        const receipt = control.basis.value.sources.find(s => s.memory.id === unit.memoryId).receipts.find(r => r.id === unit.receiptId);
        assert.equal(receipt.excerpt.slice(unit.anchor.start, unit.anchor.end), unit.anchor.text);
      }
    }
  }
  assert.equal(published.budgetAfter.requestCount - published.budgetBefore.requestCount, 88);
  assert.equal(published.budgetAfter.reservedMicroUsd - published.budgetBefore.reservedMicroUsd, 1664000);
  assert.equal(published.budgetAfter.knownUsageMicroUsd - published.budgetBefore.knownUsageMicroUsd, 105669);
  assert.equal(published.budgetAfter.unknownCostRequests - published.budgetBefore.unknownCostRequests, 44);
  assert.equal(published.budgetAfter.unsettled, 0);
});
test('SLE4 complete source coverage does not conceal missing new support or rejected interpretation', () => {
  const pickup = published.cases.find(c => c.id === 'pickup-hours');
  for (const control of pickup.controls) {
    const value = control.basis.value;
    const next = value.units.find(u => u.role === 'decision' && u.anchor.text.includes('15:00'));
    assert.ok(next); assert.ok(!value.links.some(l => l.to === next.index && l.relation === 'supports-decision'));
    assert.ok(value.units.some(u => u.anchor.text.startsWith('Starting next week')));
  }
  const reading = published.cases.find(c => c.id === 'temporary-reading');
  assert.equal(reading.controls[1].basis.error.code, 'invalid_model_output');
  assert.equal(reading.controls[0].basis.value.links.length, 1);
  assert.equal(reading.controls[2].basis.value.links.length, 2);
  assert.ok(published.traces.every(t => !JSON.stringify(t.input).includes('requiredSourceIds')));
});

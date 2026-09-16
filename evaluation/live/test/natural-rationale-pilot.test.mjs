import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { authorizeRationaleExtension, createExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../session.mjs';
import { getNaturalRationalePilotPins, runNaturalRationalePilot } from '../natural-rationale-pilot.mjs';

const KEY = 'synthetic-provider-key';
function setup(mode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'cairn-natural-rationale-offline-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50_000_000, requestCap: 5000 };
  createExperimentBudget(ledger).close();
  createExperimentRequestGuard({ ledger, policy: experimentPolicy(), fetchImpl: () => assert.fail('setup HTTP') }).close();
  const rationaleExtension = authorizeRationaleExtension({ ledger, policy: experimentPolicy(), authorizationId: 'synthetic-natural-dev' });
  const directory = join(root, 'evidence'); mkdirSync(directory, { mode: 0o700 });
  const mock = rationaleModel();
  mock.select = ({ input }) => ({ refs: input.maps.flatMap(map => map.items.map(item => ({ namespaceIndex: map.namespaceIndex,
    ...(item.type === 'unfiled' ? item.ref : { memoryId: item.ref.childId, revision: item.ref.childRevision }) }))) });
  let calls = 0, malformedOnce = false;
  const fetchImpl = async (url, requestOptions) => {
    calls++;
    if (mode === 'transport') throw new Error(KEY);
    if (mode === 'guard-invalid-json') return new Response('not-json', {
      status: 200, headers: { 'content-type': 'application/json' },
    });
    if (mode === 'tamper-capability') {
      const file = join(ledger.directory, 'experiment-rationale-extension.json');
      writeFileSync(file, `${readFileSync(file, 'utf8')} `);
    }
    const body = JSON.parse(requestOptions.body);
    assert.equal(new Headers(requestOptions.headers).get('authorization'), `Bearer ${KEY}`);
    assert.equal(body.model, 'gpt-4.1-mini-2025-04-14');
    assert.equal(JSON.stringify(body).includes('decision-evolution-rubric'), false);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    const method = body.text.format.name.slice(6);
    const input = JSON.parse(body.input[0].content[0].text);
    let output = await mock[method]({ input });
    if (method === 'qualifyCandidates') output.qualifications = Object.fromEntries(
      output.qualifications.map(item => [`item_${item.itemIndex}`, item]));
    if (mode === 'malformed' && calls === 2) output = { items: 'invalid' };
    if (mode === 'echo' && calls === 2) output = { items: KEY };
    if (!malformedOnce && mode === 'bad-relate' && method === 'relate') {
      output = { edges: 'invalid' }; malformedOnce = true;
    }
    if (!malformedOnce && mode === 'bad-classify' && method === 'classify') {
      output = { items: 'invalid' }; malformedOnce = true;
    }
    if (!malformedOnce && mode === 'bad-select' && method === 'select') {
      output = { refs: 'invalid' }; malformedOnce = true;
    }
    return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  };
  return { root, directory, ledger, calls: () => calls, options: { ledger, rationaleExtension,
    apiKey: KEY, fetchImpl, privateDirectory: directory, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
    pins: getNaturalRationalePilotPins() } };
}

test('NP1–3 actual core runs only four frozen dev cases through guarded fake HTTP', { timeout: 180000 }, async () => {
  const fixture = setup();
  const report = await runNaturalRationalePilot(fixture.options);
  assert.equal(report.status, 'completed', JSON.stringify(report));
  assert.deepEqual(report.cases.map(item => item.caseId), [
    'dev-vendor-transition-en', 'dev-tentative-zh', 'dev-premise-failure-en', 'dev-other-actor-zh']);
  assert.deepEqual(report.cases.map(item => item.result.sourceCount), [4, 2, 2, 2]);
  assert.equal(report.cases.flatMap(item => item.result.questions).length, 4);
  assert.ok(report.cases.every(item => item.result.captures.every(capture => capture.naturalRationale)));
  assert.ok(report.cases.every(item => item.result.questions[0].arms['rationale-evidence']
    .relationshipGeneration === 'automatic-source-bound-v1'));
  assert.equal(report.budgetAfter.requestCount, fixture.calls());
  assert.equal(report.budgetAfter.reservedMicroUsd, fixture.calls() * 5000);
  assert.equal(report.budgetAfter.unsettled, 0);
  assert.ok(fixture.calls() <= 384);
  assert.deepEqual(report.limits, { requests: 384, microUsd: 1_920_000, reservationMicroUsd: 5000 });
  assert.ok(report.pins['evaluation/decision-evolution/natural-rationale-trace.mjs']);
  assert.ok(report.pins['core/prompts/relate-rationale.md']);
  assert.ok(readdirSync(fixture.ledger.directory).includes('natural-rationale-dev-v1-intent.json'));
  assert.deepEqual(report.cleanup, { drain: 'completed', sessionClose: 'completed', ledgerClose: 'completed' });
  assert.deepEqual(JSON.parse(readFileSync(join(fixture.directory, 'final-report.json'))).cleanup, report.cleanup);
});

test('NP3 malformed provider output remains a failed capture without repair', { timeout: 180000 }, async () => {
  const fixture = setup('malformed');
  const report = await runNaturalRationalePilot(fixture.options);
  assert.equal(report.status, 'completed_with_failures');
  assert.equal(report.cases[0].result.captures[0].status, 'failed');
  assert.equal(report.cases.length, 4);
  assert.equal(report.budgetAfter.requestCount, fixture.calls());
});

test('NP3 malformed relate is retained as rationale failure, not a successful link', { timeout: 180000 }, async () => {
  const fixture = setup('bad-relate');
  const report = await runNaturalRationalePilot(fixture.options);
  assert.equal(report.status, 'completed_with_failures');
  assert.ok(report.cases.some(item => item.substageCounts?.rationaleFailures > 0));
  assert.ok(report.cases.flatMap(item => item.result?.captures ?? []).some(capture =>
    capture.naturalRationale?.captureRationale?.status === 'failed'));
  assert.equal(report.budgetAfter.requestCount, fixture.calls());
});

test('NP3 malformed classify retains admission but marks classification failed', { timeout: 180000 }, async () => {
  const fixture = setup('bad-classify');
  const report = await runNaturalRationalePilot(fixture.options);
  assert.equal(report.status, 'completed_with_failures');
  assert.ok(report.cases.some(item => item.substageCounts?.classificationFailures > 0));
  assert.ok(report.cases.flatMap(item => item.result?.captures ?? []).some(capture =>
    capture.admission?.memories?.length > 0 && capture.classification?.status === 'failed'));
});

test('NP3 malformed recall select marks read failure without semantic repair', { timeout: 180000 }, async () => {
  const fixture = setup('bad-select');
  const report = await runNaturalRationalePilot(fixture.options);
  assert.equal(report.status, 'completed_with_failures', JSON.stringify({ status: report.status,
    error: report.error, attempt: report.attempt, cases: report.cases.map(item => ({ caseId: item.caseId,
      status: item.status, error: item.error, substageCounts: item.substageCounts })) }));
  assert.ok(report.cases.some(item => item.substageCounts?.readFailures > 0));
  assert.ok(report.cases.flatMap(item => item.result?.questions ?? []).some(question =>
    Object.values(question.arms).some(arm => arm.status === 'failed')));
});

test('NP3 transport failure permanently halts and retains unknown reservation', { timeout: 30000 }, async () => {
  const fixture = setup('transport');
  const report = await runNaturalRationalePilot(fixture.options);
  assert.equal(report.status, 'halted');
  assert.equal(fixture.calls(), 1);
  assert.equal(report.cases.filter(item => item.status === 'not_run').length, 3);
  assert.equal(report.budgetAfter.reservedMicroUsd, 5000);
  assert.equal(report.budgetAfter.unknownCostRequests, 1);
  assert.equal(report.budgetAfter.unsettled, 0);
  assert.equal(JSON.stringify(report).includes(KEY), false);
  assert.deepEqual(report.cleanup, { drain: 'completed', sessionClose: 'completed', ledgerClose: 'completed' });
  assert.deepEqual(JSON.parse(readFileSync(join(fixture.directory, 'http-1-failure.json'))), {
    stage: 'guarded-transport', responseAvailable: false, responseStatus: null, costStatus: 'unknown',
  });
  assert.equal(readdirSync(fixture.directory).filter(name => name.startsWith('http-')).length, 2);
});

test('NP3 malformed guarded response writes a sanitized unknown-cost failure marker once', { timeout: 30000 }, async () => {
  const fixture = setup('guard-invalid-json');
  const report = await runNaturalRationalePilot(fixture.options);
  assert.equal(report.status, 'halted');
  assert.equal(fixture.calls(), 1);
  assert.equal(report.budgetAfter.unknownCostRequests, 1);
  assert.equal(report.budgetAfter.unsettled, 0);
  assert.deepEqual(JSON.parse(readFileSync(join(fixture.directory, 'http-1-failure.json'))), {
    stage: 'guarded-transport', responseAvailable: false, responseStatus: null, costStatus: 'unknown',
  });
  assert.deepEqual(JSON.parse(readFileSync(join(fixture.directory, 'final-report.json'))).cleanup,
    { drain: 'completed', sessionClose: 'completed', ledgerClose: 'completed' });
});

test('NP2 old intent and changed pins prevent another HTTP call', { timeout: 180000 }, async () => {
  const fixture = setup();
  const first = await runNaturalRationalePilot(fixture.options);
  assert.equal(first.status, 'completed');
  const before = fixture.calls();
  const next = join(fixture.root, 'second-evidence'); mkdirSync(next, { mode: 0o700 });
  const second = await runNaturalRationalePilot({ ...fixture.options, privateDirectory: next,
    expectedCheckpoint: { requestCount: first.budgetAfter.requestCount,
      reservedMicroUsd: first.budgetAfter.reservedMicroUsd } });
  assert.equal(second.status, 'halted');
  assert.equal(fixture.calls(), before);
  const changed = setup();
  await assert.rejects(runNaturalRationalePilot({ ...changed.options,
    pins: { ...changed.options.pins, 'core/capture.mjs': '0'.repeat(64) } }), /pin_mismatch/);
  assert.equal(changed.calls(), 0);
  assert.deepEqual(readdirSync(changed.directory), []);
});

test('NP2 mismatched checkpoint fails before transport', async () => {
  const fixture = setup();
  const report = await runNaturalRationalePilot({ ...fixture.options,
    expectedCheckpoint: { requestCount: 1, reservedMicroUsd: 5000 } });
  assert.equal(report.status, 'halted');
  assert.equal(fixture.calls(), 0);
  assert.equal(readdirSync(fixture.ledger.directory).includes('natural-rationale-dev-v1-intent.json'), false);
  assert.deepEqual(report.cleanup, { drain: 'not-opened', sessionClose: 'not-opened', ledgerClose: 'completed' });
});

test('NP2 capability mutation during fake HTTP halts before a second request', { timeout: 30000 }, async () => {
  const fixture = setup('tamper-capability');
  const report = await runNaturalRationalePilot(fixture.options);
  assert.equal(report.status, 'halted');
  assert.equal(fixture.calls(), 1);
  assert.equal(report.budgetAfter.requestCount, 1);
  assert.equal(report.budgetAfter.reservedMicroUsd, 5000);
});

test('NP3 provider echo of the injected key is redacted in all evidence', { timeout: 180000 }, async () => {
  const fixture = setup('echo');
  const report = await runNaturalRationalePilot(fixture.options);
  assert.equal(JSON.stringify(report).includes(KEY), false);
  for (const file of readdirSync(fixture.directory)) {
    assert.equal(readFileSync(join(fixture.directory, file), 'utf8').includes(KEY), false, file);
  }
});

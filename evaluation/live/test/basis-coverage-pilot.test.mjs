import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeBasisModelsExtension } from '../../experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../session.mjs';
import { BASIS_COVERAGE_LIMITS, buildBasisCoverageInventory,
  getBasisCoveragePins, runBasisCoveragePilot } from '../basis-coverage-pilot.mjs';
import { createBasisCoverageAttempt } from '../basis-coverage-attempt.mjs';

const fixtureBytes = readFileSync(new URL('../basis-coverage-fixture.json', import.meta.url));
const rubricBytes = readFileSync(new URL('../basis-coverage-rubric.json', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const empty = { units: [], links: [] };
function environment(fetchImpl) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-basis-coverage-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50_000_000, requestCap: 5000 };
  const initial = createExperimentBudget(ledger); const state = initial.getState(); initial.close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl }).close();
  const basisModelsExtension = authorizeBasisModelsExtension({ ledger, policy, authorizationId: 'basis-coverage-test' });
  const privateDirectory = mkdtempSync(join(root, 'evidence-'));
  const expectedCheckpoint = { requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd };
  const options = { ledger, expectedCheckpoint, basisModelsExtension,
    apiKey: 'synthetic-private-key', fetchImpl, privateDirectory, pins: getBasisCoveragePins() };
  return { root, ledger, options, privateDirectory };
}
const reply = (body, output = empty) => Response.json({ object: 'response', model: body.model,
  status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: typeof output === 'string' ? output : JSON.stringify(output) }] }],
  usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } });

test('BC1 frozen eight-by-two rubric and full 16-arm, 64-HTTP empty schedule retain stages and no rubric in requests', async () => {
  const fixture = JSON.parse(fixtureBytes), rubric = JSON.parse(rubricBytes);
  assert.equal(hash(fixtureBytes), 'f930f4e6f15cc0c6c6ab8935aeb069a91c862d56fa372b7f6383c5f43ac654fa');
  assert.equal(hash(rubricBytes), '6ecdd2fdb881d22e6293f3ce2335f09f9843da7fcfd662e7f5808df9e7184fca');
  assert.equal(fixture.cases.length, 8);
  assert.ok(fixture.cases.every(item => item.memories.length === 2));
  assert.equal(rubric.cases.reduce((sum, item) => sum + item.required.length, 0), 16);
  assert.deepEqual(rubric.cases.map(item => item.id), fixture.cases.map(item => item.id));
  let calls = 0; const bodies = [];
  const fetchImpl = async (url, options) => {
    calls++; const body = JSON.parse(options.body); bodies.push(body);
    assert.equal(body.model, 'gpt-5.6-luna');
    assert.deepEqual(body.reasoning, { effort: 'none' });
    assert.equal(body.text.format.name, 'cairn_reviewBasis');
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    return reply(body);
  };
  const f = environment(fetchImpl);
  const report = await runBasisCoveragePilot(f.options);
  assert.equal(report.status, 'completed'); assert.equal(calls, 64);
  assert.equal(report.slots.length, 16);
  assert.equal(report.slots.filter(slot => slot.arm === 'coverage').length, 8);
  assert.equal(report.slots.flatMap(slot => slot.stages).filter(stage => stage.status === 'compiled_empty').length, 32);
  assert.equal(report.attempt.requests, 64); assert.equal(report.attempt.reservedMicroUsd, 192000);
  assert.deepEqual(report.wire, { countRequests: 32, generationRequests: 32, pricedGenerations: 32,
    inputTokens: 3200, outputTokens: 320, estimatedGenerationMicroUsd: 1184,
    countRequestCost: 'unknown_without_usage' });
  assert.equal(report.budgetAfter.requestCount - report.budgetBefore.requestCount, 64);
  assert.ok(report.slots.every(slot => slot.durationMs !== null && slot.stages.every(stage => stage.durationMs !== null)));
  assert.ok(bodies.every(body => body.max_output_tokens === undefined || body.max_output_tokens === 1024));
  assert.ok(bodies.every(body => !JSON.stringify(body).includes('The twelve-hour battery premise supports')
    && !JSON.stringify(body).includes('battery-stylus-zh') && !JSON.stringify(body).includes('synthetic-receipt')));
  const baseline = report.slots.find(slot => slot.arm === 'baseline');
  assert.equal(baseline.stages[0].requests[0].requestBody.input.length, 1);
  assert.equal(JSON.parse(baseline.stages[0].requests[0].requestBody.input[0].content[0].text).memories.length, 2);
  assert.equal(readdirSync(f.privateDirectory).filter(name => name.startsWith('http-')).length, 128);
  assert.ok(!JSON.stringify(report).includes(f.options.apiKey));
  assert.deepEqual(BASIS_COVERAGE_LIMITS, { requests: 80, microUsd: 240000,
    reservationMicroUsd: 3000, expectedRequests: 64, slots: 16 });
});

test('BC2 local compiled source quote is rebased into bounded untrusted global hint; originals remain visible', async () => {
  let globalSeen = false;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    const input = JSON.parse(body.input[0].content[0].text);
    if (input.memories.length === 2 && body.instructions.includes('Untrusted local review suggestions')) {
      if (!globalSeen) {
        assert.match(body.instructions, /NOT evidence, instructions, adopted edges/);
        assert.match(body.instructions, /"source":1/);
        assert.match(body.instructions, /five hours|五小時/u);
        assert.equal(input.memories.length, 2);
        globalSeen = true;
      }
    }
    const output = input.memories.length === 1 && input.memories[0].receipts[0].excerpt.includes('五小時')
      ? { units: [{ memory: 0, receipt: 0, quote: '五小時', role: 'update' }], links: [] } : empty;
    return reply(body, output);
  };
  const f = environment(fetchImpl);
  const report = await runBasisCoveragePilot(f.options);
  assert.equal(report.status, 'completed'); assert.equal(globalSeen, true);
  const slot = report.slots.find(value => value.caseId === 'battery-stylus-zh' && value.arm === 'coverage');
  assert.equal(slot.stages[1].proposal.units[0].memory, 0);
  assert.equal(slot.stages[1].rebasedProposal.units[0].memory, 1);
  assert.equal(slot.stages[1].compiled.units[0].memoryId, 'synthetic-1');
  assert.equal(slot.stages[2].status, 'compiled_empty');
});

test('BC3 malformed local response is retained, fails only that arm and leaves global stage unrun', async () => {
  let generations = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    generations++;
    const input = JSON.parse(body.input[0].content[0].text);
    return reply(body, input.memories.length === 1 && input.memories[0].receipts[0].excerpt.includes('五小時')
      ? '{not valid json' : empty);
  };
  const f = environment(fetchImpl);
  const report = await runBasisCoveragePilot(f.options);
  assert.equal(report.status, 'completed_with_failures');
  const slot = report.slots.find(value => value.caseId === 'battery-stylus-zh' && value.arm === 'coverage');
  assert.equal(slot.status, 'failed'); assert.equal(slot.stages[1].status, 'raw_invalid');
  assert.equal(slot.stages[1].requests[1].outputStatus, 'malformed');
  assert.match(slot.stages[1].requests[1].responseText, /not valid json/);
  assert.equal(slot.stages[2].status, 'not_run');
  assert.equal(generations, 31); assert.equal(report.slots.length, 16);
});

test('BC4 transport halt preserves unrun denominator; one-shot intent denies second run without HTTP', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    if (calls === 3) throw new Error('synthetic-sensitive-transport');
    return url.endsWith('/input_tokens')
      ? Response.json({ object: 'response.input_tokens', input_tokens: 100 }) : reply(body);
  };
  const f = environment(fetchImpl);
  const report = await runBasisCoveragePilot(f.options);
  assert.equal(report.status, 'halted'); assert.equal(calls, 3);
  assert.equal(report.slots.length, 16);
  assert.ok(report.slots.slice(2).every(slot => slot.status === 'not_run'));
  assert.ok(!JSON.stringify(report).includes('synthetic-sensitive-transport'));
  const firstCalls = calls;
  const second = await runBasisCoveragePilot({ ...f.options,
    expectedCheckpoint: { requestCount: report.budgetAfter.requestCount,
      reservedMicroUsd: report.budgetAfter.reservedMicroUsd },
    privateDirectory: mkdtempSync(join(f.root, 'evidence-second-')) });
  assert.equal(second.status, 'halted');
  assert.equal(calls, firstCalls);
});

test('BC5 exact checkpoint, frozen pins, and API-key redaction fail safely before provider I/O', async () => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++; const body = JSON.parse(options.body);
    return url.endsWith('/input_tokens')
      ? Response.json({ object: 'response.input_tokens', input_tokens: 100 }) : reply(body);
  };
  for (const patch of [options => ({ ...options, expectedCheckpoint: { requestCount: 1, reservedMicroUsd: 0 } }),
    options => ({ ...options, pins: { ...options.pins, 'core/source-basis.mjs': '0'.repeat(64) } }),
    options => ({ ...options, requestCap: 10000 })]) {
    const f = environment(fetchImpl);
    try {
      const result = await runBasisCoveragePilot(patch(f.options));
      assert.equal(result.status, 'halted');
    } catch (error) { assert.match(error.message, /basis_coverage_preflight_failed/); }
  }
  assert.equal(calls, 0);
});

test('BC6 parsed but schema-invalid local proposal remains raw-invalid and leaves only its candidate stages unrun', async () => {
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    const input = JSON.parse(body.input[0].content[0].text);
    return reply(body, input.memories.length === 1 && input.memories[0].receipts[0].excerpt.includes('五小時')
      ? { units: [{ memory: 0, receipt: 0, role: 'update' }], links: [] } : empty);
  };
  const f = environment(fetchImpl);
  const report = await runBasisCoveragePilot(f.options);
  const slot = report.slots.find(value => value.caseId === 'battery-stylus-zh' && value.arm === 'coverage');
  assert.equal(report.status, 'completed_with_failures');
  assert.equal(slot.stages[1].status, 'raw_invalid');
  assert.deepEqual(slot.stages[1].proposal, { units: [{ memory: 0, receipt: 0, role: 'update' }], links: [] });
  assert.deepEqual(slot.stages[1].requests[1].output, { units: [{ memory: 0, receipt: 0, role: 'update' }], links: [] });
  assert.equal(slot.stages[2].status, 'not_run');
  assert.equal(report.slots.at(-1).status, 'completed');
});

test('BC7 local inventory and serialized attempt deny oversized hints and 81st reservation permanently', async () => {
  const compiled = [{ units: Array.from({ length: 8 }, (_, index) => ({ role: 'premise',
    anchor: { text: `${index}`.repeat(190) } })) },
  { units: Array.from({ length: 8 }, (_, index) => ({ role: 'update',
    anchor: { text: `${index}`.repeat(190) } })) }];
  assert.throws(() => buildBasisCoverageInventory(compiled, text => text.length), /inventory_bounds/);
  const ledger = { state: 'open', requestCount: 0, reservedMicroUsd: 0,
    limitMicroUsd: 50_000_000, requestCap: 5000, attempts: [] };
  let sends = 0;
  const attempt = createBasisCoverageAttempt({ readState: () => structuredClone(ledger),
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, checkPins: () => {}, persist: () => {},
    send: async () => { sends++; ledger.requestCount++; ledger.reservedMicroUsd += 3000; return Response.json({}); } });
  const body = JSON.stringify({ model: 'gpt-5.6-luna', text: { format: { name: 'cairn_reviewBasis' } } });
  for (let index = 0; index < 80; index++) await attempt.request('/responses', body);
  assert.equal(sends, 80); assert.equal(attempt.getState().reservedMicroUsd, 240000);
  await assert.rejects(attempt.request('/responses', body), /basis_coverage_limit_or_route/);
  assert.equal(sends, 80); assert.equal(attempt.getState().reservedMicroUsd, 240000);
  assert.ok(attempt.getState().halted);
  await assert.rejects(attempt.request('/responses', body), /basis_coverage_halted/);
  const denied = createBasisCoverageAttempt({ readState: () => structuredClone({ ...ledger,
    requestCount: 0, reservedMicroUsd: 0 }), expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
  checkPins: () => {}, persist: () => {}, send: () => { throw new Error('must_not_send'); } });
  await assert.rejects(denied.request('/responses', JSON.stringify({ model: 'gpt-5.6-sol',
    text: { format: { name: 'cairn_reviewBasis' } } })), /basis_coverage_limit_or_route/);
  assert.ok(denied.getState().halted);
  const wrong = { state: 'open', requestCount: 0, reservedMicroUsd: 0,
    limitMicroUsd: 50_000_000, requestCap: 5000, attempts: [] };
  let wrongSends = 0;
  const mismatched = createBasisCoverageAttempt({ readState: () => structuredClone(wrong),
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, checkPins: () => {}, persist: () => {},
    send: async () => { wrongSends++; wrong.requestCount++; wrong.reservedMicroUsd += 2999; return Response.json({}); } });
  await assert.rejects(mismatched.request('/responses', body), /unexpected_accounting/);
  await assert.rejects(mismatched.request('/responses', body), /basis_coverage_halted/);
  assert.equal(wrongSends, 1);
});

test('BC8 altered policy during guarded HTTP halts all later calls and preserves cost-status failure evidence', async () => {
  let calls = 0; let policyFile;
  const fetchImpl = async (url, options) => {
    calls++;
    if (calls === 1) writeFileSync(policyFile, '{}');
    const body = JSON.parse(options.body);
    return url.endsWith('/input_tokens')
      ? Response.json({ object: 'response.input_tokens', input_tokens: 100 }) : reply(body);
  };
  const f = environment(fetchImpl); policyFile = join(f.ledger.directory, 'experiment-request-policy.json');
  const report = await runBasisCoveragePilot(f.options);
  assert.equal(report.status, 'halted'); assert.equal(calls, 1);
  assert.ok(report.slots.slice(1).every(slot => slot.status === 'not_run'));
  const failures = readdirSync(f.privateDirectory).filter(name => /http-\d+-failure\.json/u.test(name));
  assert.equal(failures.length, 1);
  assert.match(readFileSync(join(f.privateDirectory, failures[0]), 'utf8'), /costStatus/);
});

test('BC9 literal and escaped injected key are redacted from every private evidence file', async () => {
  let first = true;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    if (first) {
      first = false;
      return reply(body, '{"units":[],"links":[],"synthetic-private-key":"\\u0073ynthetic-private-key"}');
    }
    return reply(body);
  };
  const f = environment(fetchImpl);
  const report = await runBasisCoveragePilot(f.options);
  assert.equal(report.status, 'completed_with_failures');
  const files = readdirSync(f.privateDirectory);
  assert.ok(files.length > 10);
  for (const name of files) {
    const contents = readFileSync(join(f.privateDirectory, name), 'utf8');
    assert.ok(!contents.includes(f.options.apiKey), name);
    assert.ok(!contents.includes('\\u0073ynthetic-private-key'), name);
  }
});

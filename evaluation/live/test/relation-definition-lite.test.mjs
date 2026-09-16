import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeRationaleExtension } from '../../experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../session.mjs';
import { createRationaleLiveSession } from '../qualification-session.mjs';
import { getRelationDefinitionPins, runRelationDefinitionLite, RELATION_DEFINITION_LIMITS } from '../relation-definition-lite.mjs';
import { scoreRelationDefinition } from '../relation-definition-score.mjs';

const fixture = JSON.parse(readFileSync(new URL('../relation-definition-fixture.json', import.meta.url)));
const rubric = JSON.parse(readFileSync(new URL('../relation-definition-rubric.json', import.meta.url)));
function setup(mode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'cairn-relation-definition-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50_000_000, requestCap: 1000 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('setup HTTP') }).close();
  const rationaleExtension = authorizeRationaleExtension({ ledger, policy, authorizationId: 'rationale-pilot-v1' });
  const privateDirectory = join(root, 'evidence'); mkdirSync(privateDirectory, { mode: 0o700 });
  const calls = []; let generation = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    const input = JSON.parse(body.input[0].content[0].text);
    calls.push({ url, body, input });
    if (mode === 'persistence' && calls.length === 1) writeFileSync(join(privateDirectory, 'request-2-reserved.json'), '{}');
    if (mode === 'capability-drift' && calls.length === 1)
      writeFileSync(join(ledger.directory, 'experiment-rationale-extension.json'), '{}');
    if (mode === 'policy-drift' && calls.length === 1)
      writeFileSync(join(ledger.directory, 'experiment-request-policy.json'), '{}');
    if (mode === 'accounting-drift' && calls.length === 1) {
      const competing = createRationaleLiveSession({ ledger, rationaleExtension,
        apiKey: 'synthetic-injected-key', fetchImpl: () => Response.json({ object: 'response.input_tokens', input_tokens: 100 }) });
      try { await competing.request('/responses/input_tokens', options.body); }
      finally { competing.close(); }
    }
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-injected-key');
    if (mode === 'transport' && calls.length === 3) throw new Error('synthetic-injected-key transport secret');
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    generation++;
    const output = mode === 'malformed' && generation === 1 ? '{broken'
      : mode === 'echo' && generation === 1
        ? '{"edges":[],"synthetic\\u002dinjected-key":"synthetic\\u002dinjected-key"}' : '{"edges":[]}';
    return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: output }] }],
    usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    ...(mode === 'echo' && generation === 1 ? { 'synthetic-injected-key': 'synthetic-injected-key' } : {}) });
  };
  return { root, calls, options: { ledger, rationaleExtension, apiKey: 'synthetic-injected-key', fetchImpl,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, privateDirectory, pins: getRelationDefinitionPins() } };
}

test('RD fixture/rubric freeze and source-only boundary', () => {
  assert.equal(fixture.cases.length, 10); assert.equal(rubric.cases.length, 10);
  for (const item of fixture.cases) {
    assert.deepEqual(Object.keys(item).sort(), ['id', 'memories']);
    assert.equal(JSON.stringify(item).includes('required'), false);
    assert.equal(JSON.stringify(item).includes('rubric'), false);
    assert.ok(rubric.cases.some(rule => rule.id === item.id));
  }
  assert.equal(RELATION_DEFINITION_LIMITS.requests, 64);
  assert.equal(RELATION_DEFINITION_LIMITS.microUsd, 320000);
});

test('RD preflight rejects missing options, pins, checkpoint and budget without HTTP or evidence', async () => {
  const f = setup();
  for (const bad of [{ ...f.options, pins: {} }, { ...f.options, apiKey: '' },
    { ...f.options, expectedCheckpoint: { requestCount: 1, reservedMicroUsd: 5000 } },
    { ...f.options, extra: true }]) await assert.rejects(runRelationDefinitionLite(bad));
  assert.equal(f.calls.length, 0); assert.deepEqual(readdirSync(f.options.privateDirectory), []);
  const low = setup(); low.options.ledger.requestCap = 30;
  await assert.rejects(runRelationDefinitionLite(low.options)); assert.equal(low.calls.length, 0);
});

test('RD twenty slots use same source/schema/model/tokens, deterministic order, private one-shot evidence and no store', async () => {
  const f = setup(); const report = await runRelationDefinitionLite(f.options);
  assert.equal(report.status, 'completed', JSON.stringify(report));
  assert.equal(report.slots.length, 20); assert.equal(f.calls.length, 40);
  assert.deepEqual(report.slots.slice(0, 4).map(slot => slot.arm), ['baseline', 'guide', 'guide', 'baseline']);
  for (let i = 0; i < 20; i++) {
    const item = report.slots[i], count = f.calls[i * 2], generation = f.calls[i * 2 + 1];
    assert.equal(item.caseId, fixture.cases[Math.floor(i / 2)].id);
    assert.deepEqual(count.input, { memories: fixture.cases[Math.floor(i / 2)].memories });
    assert.deepEqual(generation.input, count.input);
    assert.equal(count.body.model, 'gpt-4.1-mini-2025-04-14');
    assert.equal(generation.body.max_output_tokens, 1024);
    assert.deepEqual(generation.body.text.format, count.body.text.format);
    const guide = readFileSync(new URL('../../../docs/relation-definition-lite-guide.md', import.meta.url), 'utf8');
    const baseline = readFileSync(new URL('../../../core/prompts/relate-rationale.md', import.meta.url), 'utf8');
    assert.equal(count.body.instructions, item.arm === 'guide' ? `${baseline}\n\n${guide}` : baseline);
    assert.equal(generation.body.instructions, count.body.instructions);
    assert.equal(count.body.instructions.includes('requiredAny'), false);
    assert.equal(JSON.stringify(count.body).includes('quiet-pump-en'), false);
    assert.deepEqual(item.proposal, { edges: [] }); assert.equal(item.status, 'completed');
  }
  const names = readdirSync(f.options.privateDirectory);
  assert.ok(names.includes('final-report.json')); assert.ok(names.includes('http-1-raw-response.json'));
  assert.equal(names.some(name => name.endsWith('.sqlite')), false);
  assert.equal(report.budgetAfter.requestCount, 40); assert.equal(report.budgetAfter.reservedMicroUsd, 200000);
  assert.equal(report.budgetAfter.unsettled, 0); assert.equal(report.attempt.requests, 40);
  assert.equal(JSON.stringify(report).includes('synthetic-injected-key'), false);
  assert.equal(readFileSync(join(f.options.privateDirectory, 'http-1-request.json'), 'utf8').includes('synthetic-injected-key'), false);
  const intent = join(f.options.ledger.directory, 'relation-definition-lite-v1-intent.json');
  const bytes = readFileSync(intent); const next = join(f.root, 'next'); mkdirSync(next, { mode: 0o700 });
  const repeat = await runRelationDefinitionLite({ ...f.options, privateDirectory: next,
    expectedCheckpoint: { requestCount: 40, reservedMicroUsd: 200000 } });
  assert.equal(repeat.status, 'halted'); assert.equal(f.calls.length, 40); assert.deepEqual(readFileSync(intent), bytes);
});

test('RD malformed output remains distinct from empty and later fixed slot proceeds once', async () => {
  const f = setup('malformed'); const report = await runRelationDefinitionLite(f.options);
  assert.equal(report.status, 'completed_with_failures'); assert.equal(f.calls.length, 40);
  assert.equal(report.slots[0].status, 'malformed'); assert.deepEqual(report.slots[0].rawOutput, { malformedJson: true });
  assert.equal(report.slots[0].proposal, null); assert.equal(report.slots[1].status, 'completed');
  assert.match(readFileSync(join(f.options.privateDirectory, 'http-2-raw-response.json'), 'utf8'), /\{broken/u);
});

test('RD transport failure halts later slots, preserves unknown reservation and redacts key', async () => {
  const f = setup('transport'); const report = await runRelationDefinitionLite(f.options);
  assert.equal(report.status, 'halted'); assert.equal(f.calls.length, 3);
  assert.equal(report.slots[0].status, 'completed'); assert.equal(report.slots[1].status, 'failed');
  assert.equal(report.slots.filter(slot => slot.status === 'not_run').length, 18);
  assert.equal(report.budgetAfter.reservedMicroUsd, 15000); assert.ok(report.budgetAfter.unknownCostRequests >= 1);
  assert.equal(report.budgetAfter.unsettled, 0);
  assert.equal(JSON.stringify(report).includes('synthetic-injected-key'), false);
  assert.equal(JSON.parse(readFileSync(join(f.options.privateDirectory, 'http-3-failure.json'))).costStatus, 'unknown');
});

test('RD response echo redacts literal and unicode-escaped injected key in every evidence file', async () => {
  const f = setup('echo'); const report = await runRelationDefinitionLite(f.options);
  assert.equal(report.status, 'completed_with_failures'); assert.equal(report.slots[0].status, 'malformed');
  assert.equal(f.calls.length, 40);
  for (const name of readdirSync(f.options.privateDirectory)) {
    const data = readFileSync(join(f.options.privateDirectory, name), 'utf8');
    assert.equal(data.includes('synthetic-injected-key'), false, name);
    assert.equal(data.includes('synthetic\\u002dinjected-key'), false, name);
  }
  assert.equal(JSON.stringify(report).includes('synthetic-injected-key'), false);
});

test('RD evidence persistence collision permanently halts before the next HTTP send', async () => {
  const f = setup('persistence'); const report = await runRelationDefinitionLite(f.options);
  assert.equal(report.status, 'halted'); assert.equal(f.calls.length, 1);
  assert.equal(report.slots[0].status, 'failed');
  assert.equal(report.slots.filter(slot => slot.status === 'not_run').length, 19);
  assert.ok(report.attempt.halted);
});

test('RD immutable capability, policy and accounting drift halt without a second operator HTTP send', async () => {
  for (const mode of ['capability-drift', 'policy-drift', 'accounting-drift']) {
    const f = setup(mode); const report = await runRelationDefinitionLite(f.options);
    assert.equal(report.status, 'halted', mode); assert.equal(f.calls.length, 1, mode);
    assert.equal(report.slots.filter(slot => slot.status === 'not_run').length, 19, mode);
    assert.ok(report.attempt.halted, mode);
  }
});

test('RD scorer preserves all denominators, malformed and allowed alternative support', () => {
  const slots = fixture.cases.flatMap(item => ['baseline', 'guide'].map(arm => ({ caseId: item.id, arm,
    status: 'completed', proposal: { edges: [] } })));
  slots.find(slot => slot.caseId === 'reaffirmation-zh' && slot.arm === 'guide').proposal.edges = [
    { from: 0, to: 1, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }];
  slots[0].status = 'malformed'; slots[0].proposal = null;
  const result = scoreRelationDefinition({ id: 'relation-definition-lite-v1', slots }, rubric);
  assert.equal(result.arms.baseline.slots, 10); assert.equal(result.arms.baseline.scored, 9);
  assert.equal(result.arms.baseline.failedOrMalformed, 1);
  assert.equal(result.arms.baseline.requiredScored < result.arms.baseline.required, true);
  const reaffirmed = result.slots.find(slot => slot.caseId === 'reaffirmation-zh' && slot.arm === 'guide');
  assert.equal(reaffirmed.complete, true); assert.equal(reaffirmed.omitted, 0); assert.equal(reaffirmed.unsupported, 0);
  assert.throws(() => scoreRelationDefinition({ id: 'relation-definition-lite-v1',
    slots: [...slots.slice(0, 19), slots[0]] }, rubric));
});

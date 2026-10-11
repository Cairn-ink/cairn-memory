import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { createComplementarySourceTransport, createAlgorithmDevelopmentTransport, freezeObservation, algorithmLimits } from '../transport.mjs';
import { runComplementarySourceComparison, runAlgorithmDevelopmentComparison, prepareAlgorithmDevelopmentCase } from '../runner.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { complementaryArms, complementaryLimits, complementaryOrders } from '../complementary-profile.mjs';
import { assembleComplementarySourceSet } from '../../experiments/cloud-retrieval-v1/candidate.mjs';
import { assembleSourceLinkedEvidence } from '../../architecture/source-linked-evidence-model.mjs';

const key = 'synthetic-complementary-secret';
const model = 'gpt-4.1-mini-2025-04-14';
const sources = ['Billing contact handles PO-63.', 'Mural purchase order PO-63 refers to AC-17.',
  'Signed agreement AC-17 names Mina.', 'Unrelated inventory entry one.', 'Unrelated inventory entry two.'];
const cases = freezeObservation(Array.from({ length: 24 }, (_, index) => ({ id: `D${String(index + 1).padStart(2, '0')}`,
  family: 'synthetic-complementary-caller', question: { text: 'mural billing', date: '2026-10-10' },
  sessions: [0, 1].map(session => ({ id: `session-${session}`, eventTime: '2026-10-09T12:00:00Z',
    messages: sources.slice(session * 3, session * 3 + 3).map((content, turn) => ({ role: turn % 2 ? 'assistant' : 'user', content })) })) })));
const ref = item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision });
const response = output => Response.json({ object: 'response', model, status: 'completed', error: null,
  incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }], usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
function provider(intercept = () => null) {
  return async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    const failure = intercept(url, options); if (failure) return failure;
    const body = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    if (url.endsWith('/chat/completions')) return Response.json({ object: 'chat.completion', model,
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic answer.' } }],
      usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 } });
    const input = JSON.parse(body.input[0].content[0].text), method = body.text.format.name;
    if (method === 'cairn_extract') return response({ items: input.messages.map(message => ({ content: message.content.slice(0, 600),
      kind: 'context', confidence: 0.8, sourceIndices: [message.index] })) });
    if (method === 'cairn_classify') return response({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) });
    if (method === 'cairn_select') return response({ refs: input.maps.flatMap(map => map.items.filter(item =>
      item.type === 'unfiled' && item.label.includes('Billing')).map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))).slice(0, input.maxRefs) });
    return response({ refs: input.candidates.filter(item => item.receipts.some(receipt => receipt.excerpt.includes('Billing contact'))).slice(0, 1).map(ref) });
  };
}
function fixture(t, fetchImpl = provider(), factory = createComplementarySourceTransport) {
  const workspace = createTestWorkspace(t, { prefix: 'complementary-caller-' });
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400_000_000, requestCap: 100_000 };
  createExperimentBudget(configuration).close();
  const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: old.historySha256 });
  const state = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  const options = { configuration, checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, historySha256: state.historySha256, apiKey: key, fetchImpl };
  const transport = factory(options); workspace.defer(() => transport.close());
  const outputDirectory = join(workspace.path, 'output'); mkdirSync(outputDirectory);
  return { configuration, options, transport, outputDirectory };
}

test('Q1/Q2/Q6 actual cold core: 24 captures, 72 answers, balanced arms and independently compiled authoritative role packing', async t => {
  const f = fixture(t), durable = [];
  const report = await runComplementarySourceComparison({ cases, transport: f.transport, outputDirectory: f.outputDirectory,
    onCase: row => { durable.push(row); } });
  assert.equal(report.fatal, null); assert.equal(durable.length, 24);
  assert.equal(report.records.filter(row => row.method === 'answer').length, 72);
  assert.equal(report.observations.filter(row => row.capture.status === 'completed').length, 24);
  for (const name of complementaryArms) for (let position = 0; position < 3; position++)
    assert.equal(report.observations.filter(row => row.order[position] === name).length, 8);
  for (const row of report.observations) {
    assert.deepEqual(row.order, complementaryOrders[(row.ordinal - 1) % 6]);
    assert.equal(row.capture.modelCalls.filter(call => call.method === 'extract').length, 2);
    for (const name of complementaryArms) {
      const arm = row.arms[name]; assert.equal(arm.status, 'completed', JSON.stringify(arm));
      assert.equal(arm.stateBefore, row.capture.stateSha256); assert.equal(arm.stateAfter, row.capture.stateSha256);
      assert.equal(arm.modelCalls.filter(call => call.method === 'rank').length, 1);
      assert.equal(arm.records.length, 5, 'no added provider call from either compiler');
      const raw = arm.modelCalls.find(call => call.method === 'rank'), trace = arm.effectiveRanks[0];
      const compiled = name === 'complementary' ? assembleComplementarySourceSet(raw.input, raw.output)
        : name === 'linked' ? assembleSourceLinkedEvidence(raw.input, raw.output) : { output: raw.output, diagnostics: null };
      assert.deepEqual(trace.output, compiled.output); assert.deepEqual(trace.diagnostics, compiled.diagnostics);
      assert.deepEqual(JSON.parse(arm.records.find(record => record.method === 'answer').requestBody), arm.packed.request);
      const units = JSON.parse(arm.packed.request.messages[1].content).evidence.map(unit => JSON.parse(unit.text));
      assert.deepEqual(units, arm.recalled.memories.map(item => ({ format: 'source-role-evidence-v1',
        sources: item.receipts.map(receipt => ({ recordedRole: receipt.role, text: receipt.excerpt })) })));
    }
    assert.equal(row.arms.baseline.recalled.memories.length, 1);
    assert.equal(row.arms.linked.recalled.memories.length, 3);
    assert.equal(row.arms.complementary.recalled.memories.length, 5, 'frozen new compiler, not old linked fallback');
  }
  assert.equal(Object.isFrozen(report.observations[0].arms.complementary), true);
  assert.equal(JSON.stringify(report).includes(key), false);
});

test('Q3 fixed 1992 arithmetic and independent 16/8 quotas; old 1968 profile cannot take new arm', async t => {
  assert.equal(complementaryLimits.httpRequests, 24 * (2 * (16 + 3 * 8) + 3));
  assert.equal(complementaryLimits.httpRequests * 5000, 9_960_000);
  assert.equal(algorithmLimits.httpRequests, 1968);
  const f = fixture(t);
  f.transport.beginCase({ id: 'D01', ordinal: 1 });
  const extract = { system: readFileSync(new URL('../../../core/prompts/extract-source-windows.md', import.meta.url), 'utf8'),
    input: { messages: [] }, maxOutputTokens: 1024, signal: new AbortController().signal };
  for (let i = 0; i < 16; i++) await f.transport.model.extract(extract);
  await assert.rejects(f.transport.model.extract(extract), { code: 'algorithm_phase_call_cap' });
  const select = { system: readFileSync(new URL('../../../core/prompts/recall-select.md', import.meta.url), 'utf8'),
    input: { maps: [], maxRefs: 24, query: 'control' }, maxOutputTokens: 1024, signal: new AbortController().signal };
  for (const name of complementaryArms) {
    f.transport.beginArm(name);
    for (let i = 0; i < 8; i++) await f.transport.model.select(select);
    await assert.rejects(f.transport.model.select(select), error => ['algorithm_phase_call_cap', 'algorithm_case_call_cap'].includes(error.code));
  }
  assert.equal(f.transport.records().length, 80);
  f.transport.endCase(); f.transport.close();
  assert.throws(() => f.transport.beginCase({ id: 'D02', ordinal: 2 }), { code: 'algorithm_closed' });
  const old = fixture(t, provider(), createAlgorithmDevelopmentTransport);
  old.transport.beginCase({ id: 'D01', ordinal: 1 });
  assert.throws(() => old.transport.beginArm('complementary'), { code: 'algorithm_lifecycle' });
  await assert.rejects(runAlgorithmDevelopmentComparison({ treatment: 'source-diverse-complementary-v1' }), { code: 'invalid_algorithm_treatment' });
});

test('Q4 fatal auth retains all 24/72 unrun slots; an ordinary answer failure has no retry', async t => {
  const fatal = fixture(t, provider(() => Response.json({ error: 'synthetic auth' }, { status: 401 })));
  const report = await runComplementarySourceComparison({ cases, transport: fatal.transport, outputDirectory: fatal.outputDirectory });
  assert.equal(report.fatal, 'algorithm_auth_transport_failure');
  assert.equal(report.observations.flatMap(row => Object.values(row.arms)).filter(arm => arm.status === 'unresolved').length, 72);
  let answers = 0;
  const ordinary = fixture(t, provider(url => url.endsWith('/chat/completions') && ++answers === 1
    ? Response.json({ error: 'synthetic failure' }, { status: 503 }) : null));
  const failed = await runComplementarySourceComparison({ cases, transport: ordinary.transport, outputDirectory: ordinary.outputDirectory });
  assert.equal(failed.fatal, null); assert.equal(answers, 72);
  assert.equal(failed.observations[0].arms.baseline.status, 'unresolved');
  assert.equal(failed.observations[0].arms.baseline.failureStage, 'answer');
  assert.equal(failed.observations[0].arms.linked.status, 'completed');
});

test('Q4/Q7 mutation during complementary rank invalidates actual cold store and keeps denominator', async t => {
  let f, current, name, changed = false;
  const fake = provider((url, options) => {
    const body = JSON.parse(options.body);
    if (!url.endsWith('/responses') || body.text.format.name !== 'cairn_rank' || name !== 'complementary' || changed) return null;
    changed = true;
    const input = JSON.parse(body.input[0].content[0].text), target = input.candidates[0];
    const { namespace } = prepareAlgorithmDevelopmentCase(cases[current.ordinal - 1]);
    const core = openMemoryCore({ path: join(f.outputDirectory, `${String(current.ordinal).padStart(2, '0')}-${current.id}`, 'memory.sqlite') });
    try { assert.equal(core.forget({ namespace, memoryId: target.memory.id, expectedRevision: target.memory.revision }).ok, true); }
    finally { core.close(); }
    return null;
  });
  f = fixture(t, fake);
  const transport = { ...f.transport, beginCase(value) { current = value; f.transport.beginCase(value); },
    beginArm(value) { name = value; f.transport.beginArm(value); } };
  const report = await runComplementarySourceComparison({ cases, transport, outputDirectory: f.outputDirectory });
  assert.equal(changed, true); assert.equal(report.fatal, 'captured_state_changed');
  assert.equal(report.observations[0].arms.complementary.status, 'unresolved');
  assert.equal(report.observations[0].arms.complementary.packed, null);
  assert.equal(report.observations.length, 24);
  assert.equal(report.observations.at(-1).arms.complementary.failure, 'captured_state_changed');
});

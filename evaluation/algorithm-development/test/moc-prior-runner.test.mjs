import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { countOpenAITokens } from '../../../adapters/openai/index.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { createMocNaturalTransport } from '../transport.mjs';
import { runMocNaturalComparison } from '../moc-prior-runner.mjs';
import { loadMocNaturalInputs, mocNaturalOrders, mocNaturalLimits } from '../moc-prior-profile.mjs';

export const naturalTestSecret = 'synthetic-natural-secret';
const model = 'gpt-4.1-mini-2025-04-14';
export const naturalResponse = output => Response.json({ object: 'response', model, status: 'completed', error: null,
  incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
export function naturalFakeProvider({ intercept = () => null, empty = false, observe = () => {}, pressure = false } = {}) {
  let extracts = 0;
  return async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${naturalTestSecret}`);
    const body = JSON.parse(options.body); observe(url, body);
    const failure = await intercept(url, options, body); if (failure) return failure;
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    if (url.endsWith('/chat/completions')) return Response.json({ object: 'chat.completion', model,
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic first answer.' } }],
      usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 } });
    const input = JSON.parse(body.input[0].content[0].text), method = body.text.format.name;
    if (method === 'cairn_extract') {
      extracts++;
      const users = input.messages.filter(message => message.role === 'user');
      const ordinary = users.map(message => ({ content: message.content.slice(0, 600), kind: 'context', confidence: 0.8, sourceIndices: [message.index] }));
      // Test-only synthetic interpretations stress the 95-card bound; production has no such logic.
      const items = pressure ? Array.from({ length: 5 }, (_, index) => ({
        content: users[0].content.includes('I finished the October 6 move:') && index === 0 ? 'Roaming bench location.'
          : `${'🧭'.repeat(20)} As of October 10 where do we keep the mobile puncture bench I call Stitch? ${'🧭'.repeat(20)} ${extracts}-${index}`,
        kind: 'context', confidence: 0.8, sourceIndices: [users[0].content.includes('I finished the October 6 move:') && index > 0
          ? users.at(-1).index : users[0].index] })) : ordinary;
      if (pressure) assert.ok(countOpenAITokens(JSON.stringify({ items })) <= 1024, 'Synthetic extraction must satisfy the actual unchanged output-token limit');
      return naturalResponse({ items: empty ? [] : items });
    }
    if (method === 'cairn_classify') return naturalResponse({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
      ...(memory.content === 'Roaming bench location.' ? { newL1: { title: 'mobile puncture bench called Stitch', parentL2Ids: [] } } : {}) })) });
    if (method === 'cairn_select') return naturalResponse({ refs: input.maps.flatMap(map => map.items.flatMap(item => {
      const ref = item.type === 'unfiled' ? item.ref : item.type === 'ref' && item.ref.childType === 'memory'
        ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
      return ref && (!pressure || item.type === 'ref') ? [{ namespaceIndex: map.namespaceIndex, ...ref }] : [];
    }).slice(0, 12)).slice(0, input.maxRefs) });
    return naturalResponse({ refs: input.candidates.slice(0, input.limit).map(item =>
      ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) });
  };
}
export function naturalTestLedger(directory) {
  const configuration = { directory, runId: randomUUID(), limitMicroUsd: 400_000_000, requestCap: 100_000 };
  createExperimentBudget(configuration).close();
  const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: old.historySha256 });
  return configuration;
}
export function naturalFixture(t, options = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'natural-moc-fixture-' });
  const configuration = naturalTestLedger(join(workspace.path, 'ledger'));
  const state = inspectEmbeddingExperimentBudgetSnapshot(configuration), calls = [];
  const fake = options.fetchImpl ?? naturalFakeProvider(options);
  const transport = createMocNaturalTransport({ configuration, checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, historySha256: state.historySha256,
    apiKey: naturalTestSecret, fetchImpl: async (url, request) => { calls.push({ url, body: request.body }); return fake(url, request); },
    ...(options.onRecord ? { onRecord: options.onRecord } : {}) });
  workspace.defer(() => transport.close());
  const outputDirectory = join(workspace.path, 'output'); mkdirSync(outputDirectory, { mode: 0o700 });
  return { workspace, configuration, transport, calls, outputDirectory };
}
// Other focused files reuse only these fake-provider/owned-ledger helpers.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  test('NR1–5 real natural capture and independent cold ordinary arms, actual first requests and common resources', async t => {
    const cases = await loadMocNaturalInputs(), f = naturalFixture(t);
    const report = await runMocNaturalComparison({ cases, ...f });
    assert.equal(report.fatal, null, JSON.stringify(report.observations.map(row => row.capture.failure)));
    assert.equal(report.observations.length, 4); assert.equal(report.outcomesDenominator, 8);
    for (const [index, row] of report.observations.entries()) {
      assert.deepEqual(row.order, mocNaturalOrders[index % 2]);
      assert.equal(row.capture.status, 'completed'); assert.equal(row.capture.inputs.length, 19);
      assert.equal(row.capture.outcomes.length, 19); assert.equal(row.capture.modelCalls.length, 38);
      assert.equal(row.capture.admissions, 38); assert.equal(row.capture.receipts.length, 38);
      for (const name of row.order) {
        const arm = row.arms[name]; assert.equal(arm.status, 'completed', JSON.stringify({ id: row.id, name, failure: arm.failure }));
        assert.ok(arm.modelCalls.length <= 3); assert.equal(arm.modelCalls.filter(call => call.method === 'rank').length, 1);
        assert.equal(arm.stateBefore, row.capture.stateAfter); assert.equal(arm.stateAfterReopen, arm.stateBefore); assert.equal(arm.stateAfter, arm.stateBefore);
        assert.deepEqual(JSON.parse(arm.records.find(record => record.method === 'answer').requestBody), arm.packed.request);
        assert.deepEqual(f.calls.find(call => call.body === JSON.stringify(arm.packed.request)).body, JSON.stringify(arm.packed.request));
        assert.ok(arm.verifiedReads.length > 0);
        assert.ok(arm.modelCalls.every(call => call.output && !call.failure));
      }
      assert.deepEqual(row.arms.baseline.recallInput, row.arms.prior.recallInput);
      assert.ok(row.arms.baseline.records.some(record => record.method === 'select'));
      assert.ok(row.arms.prior.records.some(record => record.method === 'select'));
    }
    assert.equal(report.records.length, f.calls.length);
    assert.equal(report.records.filter(record => record.method === 'answer').length, 8);
    assert.ok(report.records.length <= 360); assert.equal(report.resources.reservedMicroUsd, f.calls.length * 5000);
    assert.equal(report.resources.capture.logicalCalls, 152); assert.equal(report.resources.capture.httpRequests, 304);
    assert.equal(JSON.stringify(report).includes(naturalTestSecret), false);
    assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.configuration).requestCount, f.calls.length);
  });
  test('NR2 valid empty extraction retains zero actual admissions and still executes eight first-answer slots', async t => {
    const f = naturalFixture(t, { empty: true });
    const report = await runMocNaturalComparison({ cases: await loadMocNaturalInputs(), ...f });
    assert.equal(report.fatal, null);
    assert.ok(report.observations.every(row => row.capture.status === 'completed' && row.capture.admissions === 0
      && row.capture.modelCalls.length === 19 && row.capture.receipts.length === 0));
    assert.equal(report.records.filter(record => record.method === 'answer').length, 8);
  });
  test('NR5 ordinary settled first-arm failure continues the independent arm and next frozen case without retry', async t => {
    let failed = false;
    const f = naturalFixture(t, { intercept(url, options, body) {
      if (!failed && url.endsWith('/responses') && body.text.format.name === 'cairn_select') { failed = true; return Response.json({ error: {} }, { status: 503 }); }
      return null;
    } });
    const report = await runMocNaturalComparison({ cases: await loadMocNaturalInputs(), ...f });
    assert.equal(report.fatal, null); assert.equal(report.observations[0].arms.baseline.status, 'unresolved');
    assert.equal(report.observations[0].arms.prior.status, 'completed');
    assert.equal(report.observations[1].arms.baseline.status, 'completed');
    assert.equal(report.observations[0].arms.baseline.modelCalls.length, 1);
    assert.equal(report.observations[0].arms.baseline.records.length, 2);
    assert.equal(report.records.filter(record => record.method === 'answer').length, 7);
  });
  test('NR2 failed classification retains admitted receipts/placement evidence and both unresolved slots', async t => {
    let failed = false;
    const f = naturalFixture(t, { intercept(url, options, body) {
      if (!failed && url.endsWith('/responses') && body.text.format.name === 'cairn_classify') { failed = true; return Response.json({ error: {} }, { status: 503 }); }
      return null;
    } });
    const report = await runMocNaturalComparison({ cases: await loadMocNaturalInputs(), ...f });
    assert.equal(report.fatal, null); const row = report.observations[0];
    assert.equal(row.capture.status, 'unresolved'); assert.equal(row.capture.inputs.length, 1);
    assert.equal(row.capture.admissions, 2); assert.equal(row.capture.receipts.length, 2);
    assert.ok(row.capture.receipts.every(detail => detail.receipts.length > 0 && detail.memory.filing));
    assert.ok(Object.values(row.arms).every(arm => arm.status === 'unresolved' && arm.failureStage === 'capture'));
    assert.equal(report.observations[1].capture.status, 'completed');
  });
  test('NR5 authentication and persistence callbacks stop all later dispatch and preserve four/eight unrun slots', async t => {
    for (const kind of ['auth', 'persist']) {
      const f = naturalFixture(t, kind === 'auth' ? { fetchImpl: async () => Response.json({ error: {} }, { status: 401 }) }
        : { onRecord() { const error = new Error(naturalTestSecret); error.code = naturalTestSecret; throw error; } });
      const report = await runMocNaturalComparison({ cases: await loadMocNaturalInputs(), ...f });
      assert.equal(report.fatal, kind === 'auth' ? 'algorithm_auth_transport_failure' : 'algorithm_persistence_failure');
      assert.equal(f.calls.length, kind === 'auth' ? 1 : 0); assert.equal(report.observations.length, 4);
      assert.ok(report.observations.every(row => Object.values(row.arms).every(arm => arm.status === 'unresolved')));
      assert.equal(JSON.stringify(report).includes(naturalTestSecret), false);
    }
  });
  test('NR3 mutation after actual answer is detected, retained and prevents the other arm/new case', async t => {
    let f, mutated = false;
    f = naturalFixture(t, { intercept(url) {
      if (!mutated && url.endsWith('/chat/completions')) {
        mutated = true; const db = new DatabaseSync(join(f.outputDirectory, '01-P01/memory.sqlite'));
        try { db.prepare("UPDATE store_metadata SET cursor_secret = 'synthetic-tampering' WHERE singleton=1").run(); } finally { db.close(); }
      }
      return null;
    } });
    const report = await runMocNaturalComparison({ cases: await loadMocNaturalInputs(), ...f });
    assert.equal(report.fatal, 'natural_state_changed'); assert.equal(report.observations[0].arms.baseline.status, 'unresolved');
    assert.equal(report.observations[0].arms.prior.modelCalls.length, 0);
    assert.equal(report.observations[1].capture.modelCalls.length, 0);
    assert.equal(report.records.filter(record => record.method === 'answer').length, 1);
  });
  test('NR6 owned output creation failure is global before any HTTP and before later case creation', async t => {
    const f = naturalFixture(t); mkdirSync(join(f.outputDirectory, '01-P01'));
    const report = await runMocNaturalComparison({ cases: await loadMocNaturalInputs(), ...f });
    assert.equal(report.fatal, 'natural_persistence_failure'); assert.equal(f.calls.length, 0);
    assert.ok(report.observations.every(row => row.capture.modelCalls.length === 0));
  });
  test('NR5 fixed request arithmetic and independent extract/select/rank quotas reject dispatch observably', async t => {
    assert.equal(mocNaturalLimits.httpRequests, 4 * (2 * (38 + 3 + 3) + 2));
    assert.equal(mocNaturalLimits.reservedMicroUsd, mocNaturalLimits.httpRequests * 5000);
    const f = naturalFixture(t, { empty: true }); f.transport.beginCase({ id: 'P01', ordinal: 1 });
    const request = { system: readFileSync(new URL('../../../core/prompts/extract-source-windows.md', import.meta.url), 'utf8'),
      input: { inputMode: 'indexed-windows-v1', messages: [{ index: 0, messageIndex: 0, role: 'user', content: 'Synthetic source.' }] },
      maxOutputTokens: 1024, signal: new AbortController().signal };
    for (let i = 0; i < 19; i++) await f.transport.model.extract(request);
    const before = f.calls.length;
    await assert.rejects(f.transport.model.extract(request), error => error.code === 'algorithm_phase_call_cap'); assert.equal(f.calls.length, before);
    f.transport.beginArm('baseline');
    const select = { ...request, system: readFileSync(new URL('../../../core/prompts/recall-select.md', import.meta.url), 'utf8'), input: { query: 'Synthetic', maps: [{ namespaceIndex: 0, items: [], exhausted: true }], maxRefs: 24 } };
    await f.transport.model.select(select); await f.transport.model.select(select);
    const selectsBefore = f.calls.length;
    await assert.rejects(f.transport.model.select(select), error => error.code === 'algorithm_phase_call_cap'); assert.equal(f.calls.length, selectsBefore);
    const rank = { ...request, system: readFileSync(new URL('../../../core/prompts/recall-rank-source-evidence.md', import.meta.url), 'utf8'), input: { query: 'Synthetic', limit: 6, candidates: [] } };
    await f.transport.model.rank(rank);
    await assert.rejects(f.transport.model.rank(rank), error => error.code === 'algorithm_phase_call_cap');
    f.transport.beginArm('prior'); await f.transport.model.select(select);
    assert.ok(f.calls.length > selectsBefore); f.transport.endCase();
  });
}

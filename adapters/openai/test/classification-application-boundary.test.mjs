import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createMixedModelDiagnosticObserver, summarizeMixedIngestionStop } from
  '../../../evaluation/longmemeval/mixed-ingestion-diagnostics.mjs';
import { ingestIndexedEvidenceLongMemEvalCase, projectIngestionFailure } from
  '../../../evaluation/longmemeval/ingestion.mjs';
import { createOpenAIModel } from '../index.mjs';

const namespace = { ownerId: 'classification-boundary-test', scope: 'project', projectId: 'synthetic' };
const source = 'Use an isolated SQLite database for this synthetic test.';
const captureInput = (eventId, content = source) => ({ namespace, client: 'synthetic-boundary',
  sessionId: 'session', eventId, messages: [{ id: `source-${eventId}`, role: 'user', content }] });
const ok = (result) => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

function fixture(t, classifyOutput, { beforeCapture = () => {}, wrapModel = model => model } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-classification-boundary-' });
  const calls = [];
  const timings = [];
  const diagnostics = [];
  const observer = createMixedModelDiagnosticObserver();
  const adapter = createOpenAIModel({ apiKey: 'synthetic-offline-key',
    onPhaseTiming: event => timings.push(event), onDiagnostic: event => {
      observer.onDiagnostic(event);
      diagnostics.push(event);
    },
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url: String(url), body });
      if (String(url).endsWith('/input_tokens')) {
        return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      }
      const method = body.text.format.name;
      const input = JSON.parse(body.input[0].content[0].text);
      if (method === 'cairn_extract') assert.equal(input.inputMode, 'indexed-windows-v1');
      const output = method === 'cairn_extract'
        ? { items: [{ content: input.messages[0].content, kind: 'fact',
          confidence: 0.9, sourceIndices: [0] }] }
        : classifyOutput(input, body);
      assert.ok(['cairn_extract', 'cairn_classify'].includes(method));
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
    } });
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, model: wrapModel(adapter),
    captureSourcePolicy: 'indexed-evidence-v1' });
  workspace.defer(() => core.close());
  beforeCapture(path, workspace);
  return { core, calls, timings, diagnostics, observer };
}

function assertCompletedAdapter(calls, timings, diagnostics) {
  assert.deepEqual(calls.map(call => call.url.split('/').at(-1)),
    ['input_tokens', 'responses', 'input_tokens', 'responses']);
  assert.ok(timings.some(event => event.stage === 'classify' &&
    event.phase === 'output_validation' && event.outcome === 'completed'));
  assert.equal(diagnostics.some(event => event.layer === 'adapter'), false);
}

test('synthetic adapter-valid classification can fail core validation after durable capture admission', async (t) => {
  const f = fixture(t, input => ({ items: input.memories.map(memory => ({ memoryId: memory.id,
    parentIds: [], newL1: { title: 'x'.repeat(121), parentL2Ids: [] } })) }));
  const result = ok(await f.core.capture(captureInput('long-title')));
  assert.equal(result.admission.memories.length, 1);
  assert.deepEqual(result.classification, { status: 'failed',
    error: { code: 'invalid_model_output', retryable: false } });
  assertCompletedAdapter(f.calls, f.timings, f.diagnostics);
  assert.deepEqual(f.diagnostics.filter(event => event.stage === 'classify'), [{ version: 1,
    stage: 'classify', layer: 'core_validation', reason: 'invalid_classification' }]);
  const admitted = result.admission.memories[0];
  const detail = ok(f.core.get({ namespace, memoryId: admitted.id }));
  assert.equal(detail.memory.filing.status, 'unfiled');
  assert.deepEqual(detail.receipts.map(receipt => receipt.excerpt), [source]);
  assert.equal(ok(f.core.inspectAdmission({ namespace, client: 'synthetic-boundary',
    eventId: 'long-title', includeInitialClassification: true })).initialClassification.status, 'failed');
  const callCount = f.calls.length;
  assert.equal(ok(await f.core.capture(captureInput('long-title'))).duplicate, true);
  assert.equal(f.calls.length, callCount);
});

test('synthetic valid control applies; a placement write abort remains a typed storage failure', async (t) => {
  const output = input => ({ items: input.memories.map(memory => ({ memoryId: memory.id,
    parentIds: [], newL1: { title: 'Synthetic storage topic', parentL2Ids: [] } })) });
  const valid = fixture(t, output);
  const applied = ok(await valid.core.capture(captureInput('valid')));
  assert.equal(applied.classification.status, 'applied');
  assertCompletedAdapter(valid.calls, valid.timings, valid.diagnostics);
  assert.equal(ok(valid.core.get({ namespace, memoryId: applied.admission.memories[0].id }))
    .memory.filing.status, 'filed');

  const aborted = fixture(t, output, { beforeCapture: (path, workspace) => {
    const db = new DatabaseSync(path);
    workspace.defer(() => db.close());
    db.exec(`CREATE TRIGGER synthetic_placement_abort BEFORE INSERT ON mocs
      BEGIN SELECT RAISE(ABORT, 'synthetic_placement_abort'); END`);
  } });
  const partial = ok(await aborted.core.capture(captureInput('write-abort')));
  assert.equal(partial.admission.memories.length, 1);
  assert.deepEqual(partial.classification, { status: 'failed',
    error: { code: 'storage_error', retryable: false } });
  assertCompletedAdapter(aborted.calls, aborted.timings, aborted.diagnostics);
  assert.equal(ok(aborted.core.get({ namespace, memoryId: partial.admission.memories[0].id }))
    .memory.filing.status, 'unfiled');
  assert.equal(ok(aborted.core.inspectAdmission({ namespace, client: 'synthetic-boundary',
    eventId: 'write-abort', includeInitialClassification: true })).initialClassification.status, 'failed');
});

test('a synthetic untyped bridge rejection after adapter completion yields classification_failed', async (t) => {
  const f = fixture(t, input => ({ items: input.memories.map(memory => ({
    memoryId: memory.id, parentIds: [], newL1: { title: 'Valid synthetic topic', parentL2Ids: [] },
  })) }), { wrapModel: adapter => ({ ...adapter, classify: async request => {
    await adapter.classify(request);
    throw new Error('synthetic post-adapter bridge rejection');
  } }) });
  const result = ok(await f.core.capture(captureInput('bridge-rejection')));
  assert.equal(result.admission.memories.length, 1);
  assert.deepEqual(result.classification, { status: 'failed',
    error: { code: 'classification_failed', retryable: false } });
  assertCompletedAdapter(f.calls, f.timings, f.diagnostics);
  assert.deepEqual(f.diagnostics.filter(event => event.stage === 'classify'), [{ version: 1,
    stage: 'classify', layer: 'core_call', reason: 'provider_failure' }]);
  assert.deepEqual(f.observer.snapshot(), { events: f.diagnostics,
    retainedEventCount: 1, omittedEventCount: 0 });
  const detail = ok(f.core.get({ namespace, memoryId: result.admission.memories[0].id }));
  assert.equal(detail.memory.filing.status, 'unfiled');
  assert.deepEqual(detail.receipts.map(receipt => receipt.excerpt), [source]);
  assert.equal(ok(f.core.inspectAdmission({ namespace, client: 'synthetic-boundary',
    eventId: 'bridge-rejection', includeInitialClassification: true })).initialClassification.status, 'failed');
});

test('a duplicate new topic is rejected at apply without filing the second admitted memory', async (t) => {
  const f = fixture(t, input => ({ items: input.memories.map(memory => ({
    memoryId: memory.id, parentIds: [], newL1: { title: 'Repeated synthetic topic', parentL2Ids: [] },
  })) }));
  assert.equal(ok(await f.core.capture(captureInput('first-topic'))).classification.status, 'applied');
  const second = ok(await f.core.capture(captureInput('second-topic',
    'Use a separate SQLite database for the second synthetic test.')));
  assert.equal(second.admission.memories.length, 1);
  assert.deepEqual(second.classification, { status: 'failed',
    error: { code: 'moc_title_conflict', retryable: false } });
  assert.equal(ok(f.core.get({ namespace, memoryId: second.admission.memories[0].id }))
    .memory.filing.status, 'unfiled');
  assert.equal(f.timings.filter(event => event.stage === 'classify' &&
    event.phase === 'output_validation' && event.outcome === 'completed').length, 2);
  assert.equal(f.diagnostics.filter(event => event.layer === 'adapter').length, 0);
});

test('an unknown classification wire alias fails inside adapter output validation', async (t) => {
  const f = fixture(t, () => ({ items: [{ memoryId: 'm999', parentIds: [] }] }));
  const result = ok(await f.core.capture(captureInput('unknown-alias')));
  assert.equal(result.admission.memories.length, 1);
  assert.deepEqual(result.classification, { status: 'failed',
    error: { code: 'invalid_model_output', retryable: false } });
  assert.ok(f.timings.some(event => event.stage === 'classify' &&
    event.phase === 'output_validation' && event.outcome === 'failed'));
  assert.deepEqual(f.diagnostics.filter(event => event.stage === 'classify'), [
    { version: 1, stage: 'classify', layer: 'adapter', reason: 'output_shape' },
    { version: 1, stage: 'classify', layer: 'core_call', reason: 'adapter_output_invalid' },
  ]);
});

test('canonical indexed ingestion preserves a real duplicate-topic error without model diagnostics', async (t) => {
  const history = { question_id: `lme-case-${'a'.repeat(64)}`, sessions: [{ session_index: 0,
    session_id: `lme-session-${'b'.repeat(64)}`, date: '2024/01/01 (Mon) 09:00',
    turns: Array.from({ length: 49 }, (_, index) => ({
      turn_id: `lme-turn-${index.toString(16).padStart(64, '0')}`, role: 'user',
      content: `Synthetic source fact ${index}.`,
    })),
  }] };
  const f = fixture(t, input => ({ items: input.memories.map(memory => ({ memoryId: memory.id,
    parentIds: [], newL1: { title: 'Repeated ingestion topic', parentL2Ids: [] },
  })) }));
  const raw = [];
  const ingested = await ingestIndexedEvidenceLongMemEvalCase({ history, namespace,
    capture: async input => {
      const result = await f.core.capture(input);
      raw.push(result);
      return result;
    } });
  assert.deepEqual(ingested.outcomes.map(outcome => outcome.status), ['completed', 'partial', 'not_run']);
  assert.equal(raw[0].value.classification.status, 'applied');
  assert.deepEqual(raw[1].value.classification, { status: 'failed',
    error: { code: 'moc_title_conflict', retryable: false } });
  assert.equal(raw[1].value.admission.memories.length, 1);
  assert.deepEqual(ingested.outcomes[1].result.classification, { status: 'failed',
    error: { code: 'moc_title_conflict', retryable: false } });
  assert.deepEqual(projectIngestionFailure(ingested.outcomes[1]), {
    errorStage: 'classification', error: { code: 'moc_title_conflict', retryable: false },
  });
  assert.deepEqual(summarizeMixedIngestionStop(ingested, ingested.plan).firstStop, {
    batchIndex: 1, status: 'partial', errorStage: 'classification',
    errorCode: 'moc_title_conflict', retryable: false,
  });
  assert.deepEqual(f.observer.snapshot(), { events: [], retainedEventCount: 0, omittedEventCount: 0 });
  assert.equal(f.timings.filter(event => event.stage === 'classify' &&
    event.phase === 'output_validation' && event.outcome === 'completed').length, 2);
  const classificationBodies = f.calls.filter(call => call.url.endsWith('/responses')
    && call.body.text.format.name === 'cairn_classify').map(call => call.body);
  assert.equal(classificationBodies.length, 2);
  const secondInput = JSON.parse(classificationBodies[1].input[0].content[0].text);
  assert.ok(secondInput.map.some(item => item.type === 'moc'
    && item.moc.title === 'Repeated ingestion topic'));
  const detail = ok(f.core.get({ namespace, memoryId: raw[1].value.admission.memories[0].id }));
  assert.equal(detail.memory.filing.status, 'unfiled');
  assert.equal(detail.receipts.length, 1);
  assert.equal(ok(f.core.inspectAdmission({ namespace, client: ingested.plan.batches[1].captureInput.client,
    eventId: ingested.plan.batches[1].captureInput.eventId,
    includeInitialClassification: true })).initialClassification.status, 'failed');

  const control = fixture(t, input => {
    const existing = input.map.find(item => item.type === 'moc' && item.moc.level === 'L1');
    return { items: input.memories.map(memory => ({ memoryId: memory.id,
      parentIds: existing ? [existing.moc.id] : [],
      ...(existing ? {} : { newL1: { title: 'Reusable ingestion topic', parentL2Ids: [] } }),
    })) };
  });
  const successful = await ingestIndexedEvidenceLongMemEvalCase({ history, namespace,
    capture: input => control.core.capture(input) });
  assert.deepEqual(successful.outcomes.map(outcome => outcome.status),
    ['completed', 'completed', 'completed']);
  assert.deepEqual(control.observer.snapshot(), { events: [], retainedEventCount: 0,
    omittedEventCount: 0 });
  assert.equal(control.timings.filter(event => event.stage === 'classify' &&
    event.phase === 'output_validation' && event.outcome === 'completed').length, 3);

  const privateCode = 'synthetic_private_exception_detail';
  const untrusted = await ingestIndexedEvidenceLongMemEvalCase({ history, namespace,
    capture: () => ({ ok: true, value: { duplicate: false,
      admission: { memories: [{ id: '10000000-0000-4000-8000-000000000001', revision: 1 }],
        suppressedCount: 0, indexRevision: 1 },
      classification: { status: 'failed', error: { code: privateCode, retryable: true } },
      sourceWindowCatalog: successful.plan.batches[0].sourceWindowCatalog,
      qualificationStatus: 'not-requested',
    } }),
  });
  assert.deepEqual(untrusted.outcomes.map(outcome => outcome.status), ['partial', 'not_run', 'not_run']);
  assert.deepEqual(untrusted.outcomes[0].result.classification.error,
    { code: 'classification_failed', retryable: false });
  assert.deepEqual(projectIngestionFailure(untrusted.outcomes[0]), {
    errorStage: 'classification', error: { code: 'classification_failed', retryable: false },
  });
  assert.equal(JSON.stringify(untrusted.outcomes).includes(privateCode), false);
});

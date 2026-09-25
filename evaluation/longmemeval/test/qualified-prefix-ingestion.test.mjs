import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { captureSnapshot, retainedSourceView } from '../../../core/capture-input.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { ingestIndexedWindowLongMemEvalCase, ingestLongMemEvalCase,
  ingestQualifiedPrefixLongMemEvalCase, planIndexedWindowLongMemEvalCase,
  planLongMemEvalCase, planQualifiedPrefixLongMemEvalCase,
  QUALIFIED_PREFIX_INGESTION_PLAN_SCHEMA_VERSION } from '../ingestion.mjs';
import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../prepare.mjs';

const sourceId = 'qualified-prefix-golden';
const questionId = opaqueQuestionId(sourceId);
const namespace = { ownerId: 'qualified-prefix-tests', scope: 'project', projectId: questionId };
const source = (contents = ['x'.repeat(800) + 'Tail Friday.', '  Å  ']) => ({ question_id: questionId,
  sessions: [{ session_index: 0, session_id: opaqueSessionId(sourceId, 0), date: 'Tuesday',
    turns: contents.map((content, index) => ({ turn_id: stableTurnIdV2(sourceId, 0, index),
      role: index % 2 ? 'assistant' : 'user', content })) }] });
const plan = (history = source()) => planQualifiedPrefixLongMemEvalCase({ history, namespace });
const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const coverage = input => retainedSourceView(captureSnapshot(input, 'source-bound-v2')).retainedSourceWindow;
const success = (input, inner = { duplicate: false,
  admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
  classification: { status: 'skipped', reason: 'empty' } }) => ({ ok: true,
  value: { ...inner, retainedSourceWindow: coverage(input) } });
const ingest = (history, capture) => ingestQualifiedPrefixLongMemEvalCase({ history, namespace, capture });

test('Q1/Q2 fixed-base complete legacy and indexed plan hashes, shared identity, actual v3 digest', () => {
  const history = source();
  const legacy = planLongMemEvalCase({ history, namespace });
  const indexed = planIndexedWindowLongMemEvalCase({ history, namespace });
  const qualified = plan(history);
  assert.equal(sha(legacy), 'f5af56cf2a719b373428ad52ad9c2b95c9e3397d031bdd9939e363f292b3841e');
  assert.equal(sha(indexed), '07569388926df67d2ad5df01dcd8a1aeeb78412a66e01dfcf2ce82eafba4babb');
  assert.equal(qualified.schemaVersion, QUALIFIED_PREFIX_INGESTION_PLAN_SCHEMA_VERSION);
  assert.equal(qualified.captureQualification, 'source-bound-v2');
  assert.equal(qualified.captureSourcePolicy, 'retained-prefix-v1');
  assert.equal(qualified.executable, true);
  assert.deepEqual(qualified.batches.map(batch => batch.captureInput), legacy.batches.map(batch => batch.captureInput));
  assert.deepEqual(qualified.batches.map(batch => batch.sourceMap), legacy.batches.map(batch => batch.sourceMap));
  assert.deepEqual(indexed.batches.map(batch => batch.sourceMap), legacy.batches.map(batch => batch.sourceMap));
  const batch = qualified.batches[0];
  const snapshot = captureSnapshot(batch.captureInput, 'source-bound-v2');
  const retained = retainedSourceView(snapshot);
  assert.equal(batch.normalizedCapture.payloadDigest, snapshot.payloadDigest);
  assert.notEqual(batch.normalizedCapture.payloadDigest, legacy.batches[0].normalizedCapture.payloadDigest);
  assert.notEqual(batch.normalizedCapture.payloadDigest, indexed.batches[0].normalizedCapture.payloadDigest);
  assert.deepEqual(batch.normalizedCapture.messages, snapshot.messages);
  assert.deepEqual(batch.retainedMessages, retained.messages);
  assert.deepEqual(batch.retainedSourceWindow, retained.retainedSourceWindow);
  assert.deepEqual(batch.retainedSourceWindow, { maxUnitsPerMessage: 800, truncatedMessageIndices: [0] });
  assert.equal(batch.retainedMessages[0].content, 'x'.repeat(800));
  assert.equal(batch.normalizedCapture.messages[0].content, 'x'.repeat(800) + 'Tail Friday.');
  assert.equal(batch.sourceMap[0].sourceDate, 'Tuesday');
  assert.equal(batch.sourceMap[1].role, 'assistant');
  assert.equal(Object.isFrozen(qualified), true);
});

test('Q2 tail binds full digest while first-800 view and deterministic identities stay fixed', () => {
  const first = plan(source(['x'.repeat(800) + 'TAIL_A', 'Assistant says Å.']));
  const second = plan(source(['x'.repeat(800) + 'TAIL_B', 'Assistant says Å.']));
  assert.deepEqual(first.batches[0].captureInput.messages.map(({ id }) => id),
    second.batches[0].captureInput.messages.map(({ id }) => id));
  assert.equal(first.batches[0].captureInput.eventId, second.batches[0].captureInput.eventId);
  assert.notEqual(first.batches[0].normalizedCapture.payloadDigest, second.batches[0].normalizedCapture.payloadDigest);
  assert.deepEqual(first.batches[0].retainedMessages, second.batches[0].retainedMessages);
  assert.deepEqual(first.batches[0].retainedSourceWindow, second.batches[0].retainedSourceWindow);
});

test('Q2 canonical NFKC, redaction, whitespace and surrogate boundary use real retained view', () => {
  const secret = 'sk-' + 'a'.repeat(48);
  for (const raw of [
    ' Ａ '.repeat(450) + 'TAIL_PRIVATE',
    `Private ${secret} ` + 'x'.repeat(900) + 'TAIL_PRIVATE',
    'x'.repeat(799) + '🚋TAIL_PRIVATE',
  ]) {
    const qualified = plan(source([raw]));
    const batch = qualified.batches[0];
    const retained = retainedSourceView(captureSnapshot(batch.captureInput, 'source-bound-v2'));
    assert.deepEqual(batch.retainedMessages, retained.messages);
    assert.deepEqual(batch.retainedSourceWindow, retained.retainedSourceWindow);
    assert.equal(batch.retainedMessages[0].content.isWellFormed(), true);
    assert.ok(!JSON.stringify(batch.retainedMessages).includes(secret));
    assert.ok(!JSON.stringify(batch.retainedMessages).includes('TAIL_PRIVATE'));
  }
  const boundary = plan(source(['x'.repeat(799) + '🚋TAIL_PRIVATE']));
  assert.equal(boundary.batches[0].retainedMessages[0].content, 'x'.repeat(799));
  assert.equal(boundary.batches[0].normalizedCapture.messages[0].content.includes('🚋TAIL_PRIVATE'), true);
});

test('Q3 every success form requires exact detached metadata; closed failures carry none', async () => {
  const history = source();
  const forms = [
    [{ processing: true }, 'unknown'],
    [{ duplicate: true, memoryIds: [], suppressedCount: 0 }, 'duplicate'],
    [{ duplicate: false, admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
      classification: { status: 'skipped', reason: 'empty' } }, 'completed'],
    [{ duplicate: false, admission: { memories: [{ id: 'memory', revision: 1 }],
      suppressedCount: 0, indexRevision: 1 }, classification: { status: 'applied',
      memoryRevisions: [{ memoryId: 'memory', revision: 1 }], indexRevision: 2 } }, 'completed'],
    [{ duplicate: false, admission: { memories: [{ id: 'memory', revision: 1 }],
      suppressedCount: 0, indexRevision: 1 }, classification: { status: 'failed',
      error: { code: 'customer_private', retryable: true } } }, 'partial'],
  ];
  for (const [inner, status] of forms) {
    const result = await ingest(history, input => success(input, inner));
    const outcome = result.outcomes[0];
    assert.equal(outcome.status, status);
    assert.deepEqual(outcome.retainedSourceWindow, result.plan.batches[0].retainedSourceWindow);
    if (outcome.result) assert.deepEqual(outcome.result.retainedSourceWindow,
      result.plan.batches[0].retainedSourceWindow);
    if (status === 'partial') assert.equal(outcome.result.classification.error.code, 'classification_failed');
  }
  const failed = await ingest(history, () => ({ ok: false,
    error: { code: 'invalid_input', retryable: false } }));
  assert.equal(failed.outcomes[0].status, 'failed');
  assert.equal(Object.hasOwn(failed.outcomes[0], 'retainedSourceWindow'), false);
  const malformedFailure = await ingest(history, input => ({ ok: false,
    error: { code: 'invalid_input', retryable: false }, retainedSourceWindow: coverage(input) }));
  assert.equal(malformedFailure.outcomes[0].error.code, 'malformed_capture_response');
  const threw = await ingest(history, () => { throw new Error('private'); });
  assert.equal(threw.outcomes[0].error.code, 'capture_threw');
});

test('Q3 wrong/missing/extra/sparse/reordered metadata and mixed policies reject before status', async () => {
  const history = source(['x'.repeat(800) + 'TAIL', 'y'.repeat(800) + 'TAIL']);
  const mutations = [
    value => { delete value.retainedSourceWindow; },
    value => { value.retainedSourceWindow.maxUnitsPerMessage = 799; },
    value => { value.retainedSourceWindow.truncatedMessageIndices = [1, 0]; },
    value => { value.retainedSourceWindow.truncatedMessageIndices = [0]; },
    value => { value.retainedSourceWindow.truncatedMessageIndices = [0, 1, 2]; },
    value => { value.retainedSourceWindow.truncatedMessageIndices = [0, '1']; },
    value => { value.retainedSourceWindow.truncatedMessageIndices = [0, ,]; },
    value => { value.retainedSourceWindow.truncatedMessageIndices.extra = true; },
    value => { value.retainedSourceWindow.extra = true; },
    value => { value.sourceWindowCatalog = { version: 1 }; },
    value => { value.extra = true; },
  ];
  for (const mutate of mutations) {
    const result = await ingest(history, input => {
      const response = structuredClone(success(input));
      mutate(response.value);
      return response;
    });
    assert.equal(result.outcomes[0].status, 'unknown');
    assert.equal(result.outcomes[0].error.code, 'malformed_capture_response');
  }
  for (const inner of [{ processing: true }, { duplicate: true, memoryIds: [], suppressedCount: 0 }]) {
    const result = await ingest(history, () => ({ ok: true, value: inner }));
    assert.equal(result.outcomes[0].error.code, 'malformed_capture_response');
  }
  const actualQualified = await ingest(history, input => success(input));
  assert.equal(actualQualified.outcomes[0].status, 'completed');
  const legacy = await ingestLongMemEvalCase({ history, namespace, capture: input => success(input) });
  assert.equal(legacy.outcomes[0].error.code, 'malformed_capture_response');
  const indexed = await ingestIndexedWindowLongMemEvalCase({ history, namespace, capture: input => success(input) });
  assert.equal(indexed.outcomes[0].error.code, 'malformed_capture_response');
  const noMetadata = await ingest(history, () => ({ ok: true, value: {
    duplicate: false, admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'skipped', reason: 'empty' } } }));
  assert.equal(noMetadata.outcomes[0].error.code, 'malformed_capture_response');
  const indexedMetadata = await ingest(history, input => ({ ok: true, value: {
    duplicate: false, admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'skipped', reason: 'empty' },
    sourceWindowCatalog: { version: 1, maxUnitsPerWindow: 800, messageCount: input.messages.length,
      windowCount: 4, semanticCoverage: 'unassessed' } } }));
  assert.equal(indexedMetadata.outcomes[0].error.code, 'malformed_capture_response');
});

test('Q2/Q3 unrepresentable qualified preflight blocks whole case and early partial leaves later not_run', async () => {
  const invalid = source(['x'.repeat(800) + '\ud800']);
  const blocked = plan(invalid);
  assert.equal(blocked.executable, false);
  assert.deepEqual(blocked.blockers.map(item => item.code), ['qualified_prefix_preflight_failed']);
  assert.equal(blocked.batches[0].normalizedCapture.payloadDigest, null);
  let callbacks = 0;
  const stopped = await ingest(invalid, () => { callbacks++; throw new Error('must not run'); });
  assert.equal(callbacks, 0);
  assert.equal(stopped.outcomes[0].status, 'not_run');

  const many = source(Array.from({ length: 26 }, (_, index) => `Turn ${index}.`));
  const planned = plan(many);
  assert.equal(planned.batches.length, 2);
  const partial = await ingest(many, input => { callbacks++; return success(input, { duplicate: false,
    admission: { memories: [], suppressedCount: 0, indexRevision: 1 },
    classification: { status: 'failed', error: { code: 'classification_failed', retryable: false } } }); });
  assert.equal(callbacks, 1);
  assert.deepEqual(partial.outcomes.map(item => item.status), ['partial', 'not_run']);
  assert.equal(partial.plan.summary.plannedBatchCount, 2);
  assert.equal(partial.plan.summary.plannedMessageCount, 26);
  const failed = await ingest(many, () => ({ ok: false,
    error: { code: 'invalid_input', retryable: false } }));
  assert.deepEqual(failed.outcomes.map(item => item.status), ['failed', 'not_run']);
});

test('Q3 callback and caller snapshots survive mutation across await and never retry', async () => {
  const history = source(Array.from({ length: 26 }, (_, index) => `Original turn ${index}.`));
  const original = plan(history);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const seen = [];
  const callback = async input => { seen.push(structuredClone(input));
    if (seen.length === 1) await gate;
    return success(input); };
  let replacementCalls = 0;
  const options = { history, namespace, capture: callback };
  const running = ingestQualifiedPrefixLongMemEvalCase(options);
  await new Promise(resolve => setImmediate(resolve));
  history.sessions[0].turns[25].content = 'MUTATED';
  options.capture = () => { replacementCalls++; throw new Error('replacement callback'); };
  release();
  const result = await running;
  assert.equal(replacementCalls, 0);
  assert.deepEqual(seen.map(input => input.messages),
    original.batches.map(batch => batch.captureInput.messages));
  assert.deepEqual(result.outcomes.map(item => item.status), ['completed', 'completed']);
  assert.deepEqual(result.outcomes[1].retainedSourceWindow,
    original.batches[1].retainedSourceWindow);
});

const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const qualify = ({ input }) => ({ qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
  ...Object.fromEntries(fields.map(field => [field, {
    value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
    evidenceIndices: field === 'value' ? [item.candidates[0].candidateIndex] : [],
  }])) })) });
const model = (extract, classify = ({ input }) => ({ items: input.memories.map(memory => ({
  memoryId: memory.id, parentIds: [], newL1: { title: 'Synthetic', parentL2Ids: [] },
})) })) => ({ contextWindow: 8192, countTokens: () => 1,
  extract, qualifyCandidates: qualify, classify });

test('Q4 actual v2 core completes canonical mixed-role prefix, replays duplicate, and empty capture', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-qualified-prefix-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'memory.sqlite');
  const raw = 'x'.repeat(800) + 'TAIL_PRIVATE';
  const history = source([raw, 'Assistant says Å.']);
  const calls = [];
  const core = openMemoryCore({ path, captureQualification: 'source-bound-v2',
    model: model(({ input }) => { calls.push(structuredClone(input));
      return { items: [{ content: 'synthetic memory', kind: 'context', confidence: 0.9,
        sourceIndices: [0, 1] }] }; }) });
  t.after(() => core.close());
  const first = await ingest(history, input => core.capture(input));
  assert.equal(first.outcomes[0].status, 'completed');
  assert.equal(first.outcomes[0].result.classification.status, 'applied');
  assert.equal(first.outcomes[0].retainedSourceWindow.maxUnitsPerMessage, 800);
  assert.deepEqual(first.outcomes[0].retainedSourceWindow.truncatedMessageIndices, [0]);
  assert.deepEqual(calls[0].messages.map(message => [message.role, message.content]),
    [['user', 'x'.repeat(800)], ['assistant', 'Assistant says Å.']]);
  const memoryId = first.outcomes[0].result.admission.memories[0].id;
  const detail = core.get({ namespace, memoryId, receiptLimit: 100 });
  assert.equal(detail.ok, true);
  assert.equal(detail.value.receipts.length, 2);
  const byRole = new Map(detail.value.receipts.map(receipt => [receipt.role, receipt]));
  assert.equal(byRole.get('user').excerpt, 'x'.repeat(800));
  assert.equal(byRole.get('assistant').excerpt, 'Assistant says Å.');
  assert.equal(byRole.get('user').eventId, first.plan.batches[0].captureInput.messages[0].id);
  assert.equal(byRole.get('assistant').eventId, first.plan.batches[0].captureInput.messages[1].id);
  assert.ok(!JSON.stringify(detail.value).includes('TAIL_PRIVATE'));
  const again = await ingest(history, input => core.capture(input));
  assert.equal(again.outcomes[0].status, 'duplicate');
  assert.deepEqual(again.outcomes[0].retainedSourceWindow, first.outcomes[0].retainedSourceWindow);
  assert.equal(calls.length, 1);

  const emptyCore = openMemoryCore({ path: join(root, 'empty.sqlite'),
    captureQualification: 'source-bound-v2', model: model(() => ({ items: [] })) });
  t.after(() => emptyCore.close());
  const empty = await ingest(history, input => emptyCore.capture(input));
  assert.equal(empty.outcomes[0].status, 'completed');
  assert.equal(empty.outcomes[0].result.classification.reason, 'empty');
  assert.deepEqual(empty.outcomes[0].result.admission.memories, []);
});

test('Q4 actual v2 partial and default-core metadata omission fail closed', async t => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-qualified-partial-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const history = source();
  const extraction = () => ({ items: [{ content: 'synthetic memory', kind: 'context',
    confidence: 0.9, sourceIndices: [0] }] });
  const partialCore = openMemoryCore({ path: join(root, 'partial.sqlite'),
    captureQualification: 'source-bound-v2', model: model(extraction, null) });
  t.after(() => partialCore.close());
  const partial = await ingest(history, input => partialCore.capture(input));
  assert.equal(partial.outcomes[0].status, 'partial');
  assert.equal(partial.outcomes[0].result.classification.error.code, 'model_not_configured');
  assert.deepEqual(partial.outcomes[0].retainedSourceWindow,
    partial.plan.batches[0].retainedSourceWindow);

  const defaultCore = openMemoryCore({ path: join(root, 'default.sqlite'), model: model(extraction) });
  t.after(() => defaultCore.close());
  const unqualified = await ingest(history, input => defaultCore.capture(input));
  assert.equal(unqualified.outcomes[0].status, 'unknown');
  assert.equal(unqualified.outcomes[0].error.code, 'malformed_capture_response');
});

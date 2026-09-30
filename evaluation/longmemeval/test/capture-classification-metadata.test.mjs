import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import {
  ingestIndexedEvidenceLongMemEvalCase,
  ingestIndexedWindowLongMemEvalCase,
  ingestLongMemEvalCase,
  ingestQualifiedPrefixLongMemEvalCase,
  planIndexedEvidenceLongMemEvalCase,
  planIndexedWindowLongMemEvalCase,
  planLongMemEvalCase,
  planQualifiedPrefixLongMemEvalCase,
} from '../ingestion.mjs';

const namespace = { ownerId: 'classification-metadata-tests', scope: 'personal', projectId: null };
const content = `Synthetic source-backed preference: ${'x'.repeat(550)}`;
const history = {
  question_id: `lme-case-${'a'.repeat(64)}`,
  sessions: [{ session_index: 0, session_id: 'synthetic-session', date: 'synthetic date',
    turns: [{ turn_id: `lme-turn-${'b'.repeat(64)}`, role: 'user', content }] }],
};
const ok = response => {
  assert.equal(response.ok, true, JSON.stringify(response));
  return response.value;
};

function fixture(t, { topicCount = 25, classificationFails = false } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-classification-metadata-' });
  t.after(async () => {
    await workspace.cleanup();
    assert.equal(existsSync(workspace.path), false, 'the fixture leaves no owned scratch after teardown');
    t.diagnostic('owned fixture cleanup verified');
  });
  const calls = [];
  const model = {
    contextWindow: 8192,
    // A deterministic conservative synthetic counter; no provider tokenizer or calls.
    countTokens: text => [...text].length,
    async extract({ input }) {
      calls.push({ stage: 'extract', input: structuredClone(input) });
      return { items: [{ content, kind: 'preference', confidence: 0.8, sourceIndices: [0] }] };
    },
    async classify({ input }) {
      calls.push({ stage: 'classify', input: structuredClone(input) });
      if (classificationFails) throw new Error('synthetic_classification_failure');
      const parent = input.map.find(item => item.moc.level === 'L1');
      return { items: input.memories.map(memory => ({ memoryId: memory.id,
        parentIds: parent ? [parent.moc.id] : [] })) };
    },
  };
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model });
  workspace.defer(() => core.close());
  for (let first = 0; first < topicCount; first += 5) {
    const memories = Array.from({ length: Math.min(5, topicCount - first) }, (_, offset) => {
      const index = first + offset;
      return ok(core.admit({ namespace, memory: { content: `Synthetic topic seed ${index}`, kind: 'fact' },
        receipts: [{ client: 'synthetic-seeder', sessionId: 'synthetic-seeds', eventId: `seed-${index}`,
          role: 'user', excerpt: `Synthetic topic seed ${index}` }] })).memory;
    });
    ok(core.applyPlacement({ namespace,
      proposal: { items: memories.map((memory, offset) => ({ memoryId: memory.id, parentIds: [],
        newL1: { title: `Synthetic topic ${String(first + offset).padStart(2, '0')}`, parentL2Ids: [] } })) },
      expectedMemoryRevisions: memories.map(memory => ({ memoryId: memory.id, revision: memory.revision })),
      expectedIndexRevision: ok(core.map({ namespace, purpose: 'classification' })).indexRevision }));
  }
  return { core, calls, workspace };
}

test('D1 actual capture classification truncation remains completed at the public ingestion entrypoint', async t => {
  const f = fixture(t);
  const captures = [];
  const observed = await ingestLongMemEvalCase({ history, namespace, capture: async input => {
    const response = await f.core.capture(input);
    captures.push(structuredClone(response));
    return response;
  } });
  assert.equal(observed.plan.executable, true);
  assert.equal(observed.plan.batches.length, 1);
  assert.equal(captures.length, 1);
  const response = captures[0];
  const produced = ok(response);
  assert.equal(produced.duplicate, false);
  assert.equal(produced.classification.status, 'applied');
  assert.equal(produced.admission.memories.length, 1);
  assert.equal(produced.admission.suppressedCount, 0);
  const metadata = produced.classification.classificationTruncated;
  assert.ok(metadata, `fixture must naturally emit truncation; ingestion status was ${observed.outcomes[0].status}`);
  assert.deepEqual(metadata, { memoriesShortened: 1, catalogItemsOmitted: 0 });
  assert.equal(Object.getPrototypeOf(metadata), Object.prototype);
  assert.deepEqual(Reflect.ownKeys(metadata).sort(), ['catalogItemsOmitted', 'memoriesShortened']);
  for (const key of Reflect.ownKeys(metadata)) {
    const descriptor = Object.getOwnPropertyDescriptor(metadata, key);
    assert.ok(Object.hasOwn(descriptor, 'value'));
    assert.ok(Number.isSafeInteger(descriptor.value) && descriptor.value >= 0);
  }
  // H2: change only representation to plain JSON while keeping every value.
  const plainResponse = JSON.parse(JSON.stringify(response));
  assert.deepEqual(plainResponse, response);
  const jsonControl = await ingestLongMemEvalCase({ history, namespace, capture: async () => plainResponse });
  assert.equal(jsonControl.outcomes[0].status, observed.outcomes[0].status);
  const detail = ok(f.core.get({ namespace, memoryId: produced.admission.memories[0].id }));
  assert.equal(detail.memory.content, content, 'classification packing does not shorten stored memory');
  assert.equal(detail.receipts.length, 1);
  assert.equal(detail.receipts[0].excerpt, content, 'the complete submitted source is retained');
  assert.equal(detail.receipts[0].eventId, observed.plan.batches[0].captureInput.messages[0].id);
  assert.equal(detail.receipts[0].sessionId, observed.plan.batches[0].captureInput.sessionId);
  assert.deepEqual(f.calls.map(call => call.stage), ['extract', 'classify']);
  assert.equal(f.calls[1].input.memories[0].contentShortened, true);

  // Replay the same successful public envelope, removing this optional field only.
  // This is a response-admission control, not a second capture or duplicate repair.
  const withoutMetadata = structuredClone(response);
  delete withoutMetadata.value.classification.classificationTruncated;
  const control = await ingestLongMemEvalCase({ history, namespace,
    capture: async () => structuredClone(withoutMetadata) });
  assert.deepEqual(control.plan, observed.plan);
  assert.equal(control.outcomes[0].status, 'completed');
  assert.deepEqual(control.outcomes[0].result, withoutMetadata.value);
  t.diagnostic(JSON.stringify({ metadata, producerStatus: produced.classification.status,
    observed: observed.outcomes[0], controlStatus: control.outcomes[0].status,
    plainJsonStatus: jsonControl.outcomes[0].status }));
  assert.equal(observed.outcomes[0].status, 'completed',
    'a successful real producer response must remain completed when it reports classification truncation');
  assert.deepEqual(observed.outcomes[0].result, produced, 'retain the supported metadata in the observed result');
});

test('D1/D2 removing one synthetic topic removes naturally emitted truncation and completes', async t => {
  const f = fixture(t, { topicCount: 24 });
  let captureResponse;
  const observed = await ingestLongMemEvalCase({ history, namespace, capture: async input => {
    captureResponse = await f.core.capture(input);
    return captureResponse;
  } });
  const produced = ok(captureResponse);
  assert.equal(produced.classification.status, 'applied');
  assert.equal(Object.hasOwn(produced.classification, 'classificationTruncated'), false);
  assert.equal(observed.outcomes[0].status, 'completed');
  assert.deepEqual(observed.outcomes[0].result, produced);
  assert.equal(f.calls[1].input.memories[0].content, content);
  assert.equal(Object.hasOwn(f.calls[1].input.memories[0], 'contentShortened'), false);
});

test('D1 original 30-topic reproduction retains real memory and catalog truncation diagnostics', async t => {
  const f = fixture(t, { topicCount: 30 });
  let captureResponse;
  const observed = await ingestLongMemEvalCase({ history, namespace, capture: async input => {
    captureResponse = await f.core.capture(input);
    return captureResponse;
  } });
  const produced = ok(captureResponse);
  assert.equal(produced.classification.status, 'applied');
  assert.deepEqual(produced.classification.classificationTruncated,
    { memoriesShortened: 1, catalogItemsOmitted: 2 });
  assert.equal(observed.outcomes[0].status, 'completed');
  assert.deepEqual(observed.outcomes[0].result, produced);
  const detail = ok(f.core.get({ namespace, memoryId: produced.admission.memories[0].id }));
  assert.equal(detail.memory.content, content);
  assert.equal(detail.receipts[0].excerpt, content);
  assert.equal(f.calls[1].input.mapExhausted, false);
});

test('D2 genuine actual classification failure retains admission and remains partial', async t => {
  const f = fixture(t, { topicCount: 0, classificationFails: true });
  let captureResponse;
  const observed = await ingestLongMemEvalCase({ history, namespace, capture: async input => {
    captureResponse = await f.core.capture(input);
    return captureResponse;
  } });
  const produced = ok(captureResponse);
  assert.deepEqual(produced.classification,
    { status: 'failed', error: { code: 'classification_failed', retryable: false } });
  assert.equal(produced.admission.memories.length, 1);
  assert.equal(observed.outcomes[0].status, 'partial');
  assert.deepEqual(observed.outcomes[0].result, produced);
  assert.equal(ok(f.core.get({ namespace, memoryId: produced.admission.memories[0].id })).memory.content, content);
});

test('D2 synthetic history is one executable source-mapped batch without truncating its receipt', () => {
  const plan = planLongMemEvalCase({ history, namespace });
  assert.equal(plan.executable, true);
  assert.equal(plan.batches.length, 1);
  assert.equal(plan.batches[0].sourceMap.length, 1);
  assert.equal(plan.batches[0].sourceMap[0].rawContent, content);
  assert.equal(plan.batches[0].normalizedCapture.messages[0].content, content);
  assert.ok(content.length <= 600 && content.length <= 800);
});

// These mapped public-envelope controls isolate response admission. The D1
// fixture above, rather than these scripted envelopes, proves producer behavior.
const modes = [
  { name: 'legacy', ingest: ingestLongMemEvalCase, plan: planLongMemEvalCase },
  { name: 'indexed', ingest: ingestIndexedWindowLongMemEvalCase, plan: planIndexedWindowLongMemEvalCase,
    field: 'sourceWindowCatalog' },
  { name: 'evidence', ingest: ingestIndexedEvidenceLongMemEvalCase, plan: planIndexedEvidenceLongMemEvalCase,
    field: 'sourceWindowCatalog', evidence: true },
  { name: 'prefix', ingest: ingestQualifiedPrefixLongMemEvalCase, plan: planQualifiedPrefixLongMemEvalCase,
    field: 'retainedSourceWindow' },
];
const applied = () => ({ status: 'applied', memoryRevisions: [{ memoryId: 'synthetic-memory', revision: 2 }],
  indexRevision: 2 });
const responseFor = (mode, batch, classification = applied()) => ({ ok: true, value: {
  duplicate: false,
  admission: { memories: [{ id: 'synthetic-memory', revision: 1 }], suppressedCount: 0, indexRevision: 1 },
  classification,
  ...(mode.field ? { [mode.field]: structuredClone(batch[mode.field]) } : {}),
  ...(mode.evidence ? { qualificationStatus: 'not-requested' } : {}),
} });
const twoBatchHistory = () => ({ ...history, sessions: [{ ...history.sessions[0],
  turns: Array.from({ length: 25 }, (_, index) => ({
    turn_id: `lme-turn-${index.toString(16).padStart(64, '0')}`,
    role: index % 2 ? 'assistant' : 'user', content: `Synthetic source turn ${index}`,
  })) }] });
const malformed = outcome => {
  assert.equal(outcome.status, 'unknown');
  assert.deepEqual(outcome.error, { code: 'malformed_capture_response', retryable: false });
};

for (const mode of modes) {
  test(`D3/D5 ${mode.name}: absent and exact supported counts complete and retain their metadata`, async () => {
    const plan = mode.plan({ history, namespace });
    const valid = [undefined, { memoriesShortened: 1, catalogItemsOmitted: 0 },
      { memoriesShortened: 0, catalogItemsOmitted: 1 },
      { memoriesShortened: 2, catalogItemsOmitted: 3 },
      { memoriesShortened: Number.MAX_SAFE_INTEGER, catalogItemsOmitted: 0 },
      Object.assign(Object.create(null), { memoriesShortened: 1, catalogItemsOmitted: 0 })];
    for (const metadata of valid) {
      const classification = applied();
      if (metadata !== undefined) classification.classificationTruncated = metadata;
      const response = responseFor(mode, plan.batches[0], classification);
      const observed = await mode.ingest({ history, namespace, capture: async () => response });
      assert.equal(observed.outcomes[0].status, 'completed');
      assert.deepEqual(observed.outcomes[0].result, structuredClone(response.value));
      if (mode.field) assert.deepEqual(observed.outcomes[0][mode.field], plan.batches[0][mode.field]);
      if (mode.evidence) assert.equal(observed.outcomes[0].qualificationStatus, 'not-requested');
      if (metadata) {
        assert.equal(Object.isFrozen(observed.outcomes[0].result.classification.classificationTruncated), true);
      }
    }
  });

  test(`D3/D5 ${mode.name}: malformed, extra, symbol and accessor diagnostics stay unknown without reads`, async () => {
    const plan = mode.plan({ history, namespace });
    const ordinary = () => ({ memoriesShortened: 1, catalogItemsOmitted: 0 });
    let getterReads = 0;
    const badMetadata = [undefined, null, true, 1, [], {},
      { memoriesShortened: 1 }, { catalogItemsOmitted: 1 },
      { memoriesShortened: 0, catalogItemsOmitted: 0 },
      { ...ordinary(), extra: true },
      Object.assign(Object.create({ extra: true }), ordinary()),
      Object.assign(ordinary(), { [Symbol('extra')]: true }),
      Object.defineProperty(ordinary(), 'extra', { value: true }),
      Object.defineProperty(ordinary(), 'memoriesShortened', { enumerable: true,
        get() { getterReads++; return 1; } }),
      Object.defineProperty(ordinary(), 'catalogItemsOmitted', { enumerable: true,
        get() { getterReads++; return 0; } }),
      Object.defineProperty(ordinary(), 'memoriesShortened', { value: 1, enumerable: false }),
    ];
    for (const key of ['memoriesShortened', 'catalogItemsOmitted']) {
      for (const value of [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1,
        '1', null, true, 1n, {}, []]) badMetadata.push({ ...ordinary(), [key]: value });
    }
    for (const metadata of badMetadata) {
      const classification = { ...applied(), classificationTruncated: metadata };
      const observed = await mode.ingest({ history, namespace,
        capture: async () => responseFor(mode, plan.batches[0], classification) });
      malformed(observed.outcomes[0]);
    }
    const invalidClassifications = [
      { ...applied(), classificationTruncated: ordinary(), extra: true },
      Object.assign({ ...applied(), classificationTruncated: ordinary() }, { [Symbol('extra')]: true }),
      Object.defineProperty(applied(), 'classificationTruncated', { enumerable: true,
        get() { getterReads++; return ordinary(); } }),
      Object.defineProperty(applied(), 'classificationTruncated', { value: ordinary() }),
      Object.defineProperty({ ...applied(), classificationTruncated: ordinary() }, 'status',
        { enumerable: true, get() { getterReads++; return 'applied'; } }),
      { status: 'skipped', reason: 'empty', classificationTruncated: ordinary() },
      { status: 'failed', error: { code: 'classification_failed', retryable: false },
        classificationTruncated: ordinary() },
    ];
    for (const classification of invalidClassifications) {
      const observed = await mode.ingest({ history, namespace,
        capture: async () => responseFor(mode, plan.batches[0], classification) });
      malformed(observed.outcomes[0]);
    }
    assert.equal(getterReads, 0, 'validation rejects getters without invoking them');
  });

  test(`D4/D5 ${mode.name}: only completed and duplicate outcomes continue to the next planned batch`, async () => {
    const source = twoBatchHistory();
    const plan = mode.plan({ history: source, namespace });
    assert.equal(plan.executable, true);
    assert.equal(plan.batches.length, 2);
    const forms = [
      { status: 'completed', make: batch => responseFor(mode, batch,
        { ...applied(), classificationTruncated: { memoriesShortened: 1, catalogItemsOmitted: 0 } }) },
      { status: 'completed', make: batch => responseFor(mode, batch, applied()) },
      { status: 'completed', make: batch => responseFor(mode, batch, { status: 'skipped', reason: 'empty' }) },
      { status: 'duplicate', make: batch => {
        const response = responseFor(mode, batch);
        delete response.value.admission;
        delete response.value.classification;
        Object.assign(response.value, { duplicate: true, memoryIds: ['synthetic-memory'], suppressedCount: 0 });
        return response;
      } },
      { status: 'partial', make: batch => responseFor(mode, batch,
        { status: 'failed', error: { code: 'classification_failed', retryable: false } }) },
      { status: 'unknown', error: 'capture_processing', make: batch => {
        const response = responseFor(mode, batch);
        delete response.value.duplicate;
        delete response.value.admission;
        delete response.value.classification;
        response.value.processing = true;
        return response;
      } },
      { status: 'unknown', error: 'malformed_capture_response', make: batch => responseFor(mode, batch,
        { ...applied(), classificationTruncated: { memoriesShortened: -1, catalogItemsOmitted: 0 } }) },
      { status: 'unknown', error: 'malformed_capture_response', make: batch => {
        const response = responseFor(mode, batch);
        response.value.admission.memories[0].revision = 0;
        return response;
      } },
      { status: 'failed', error: 'extraction_failed', make: () => ({ ok: false,
        error: { code: 'extraction_failed', retryable: false } }) },
      { status: 'unknown', error: 'capture_threw', make: () => { throw new Error('synthetic capture throw'); } },
    ];
    for (const form of forms) {
      let calls = 0;
      let firstResponse;
      const observed = await mode.ingest({ history: source, namespace, capture: async input => {
        const index = calls++;
        assert.deepEqual(input, plan.batches[index].captureInput);
        if (index > 0) return responseFor(mode, plan.batches[index]);
        firstResponse = form.make(plan.batches[0]);
        return firstResponse;
      } });
      const continues = ['completed', 'duplicate'].includes(form.status);
      assert.deepEqual(observed.outcomes.map(outcome => outcome.status),
        [form.status, continues ? 'completed' : 'not_run']);
      assert.equal(calls, continues ? 2 : 1);
      if (form.error) assert.equal(observed.outcomes[0].error.code, form.error);
      if (['partial', 'completed', 'duplicate'].includes(form.status)) {
        assert.deepEqual(observed.outcomes[0].result, firstResponse.value);
      }
    }
    const blocked = structuredClone(source);
    blocked.sessions[0].turns[0].content = '';
    let calls = 0;
    const observed = await mode.ingest({ history: blocked, namespace, capture: async () => {
      calls++; throw new Error('must not capture blocked source');
    } });
    assert.equal(observed.plan.executable, false);
    assert.equal(calls, 0);
    assert.ok(observed.outcomes.every(outcome => outcome.status === 'not_run'));
  });

  test(`D5/H3 ${mode.name}: independent source/catalog/qualification and admission mismatches still deny`, async () => {
    const source = twoBatchHistory();
    const plan = mode.plan({ history: source, namespace });
    const mutations = [
      value => { value.admission.indexRevision = 0; },
      value => { value.admission.extra = true; },
      value => { value.admission.memories[0].id = ''; },
      value => { value.extra = true; },
      value => { value.qualificationTruncated = { itemsShortened: 1, itemsUnqualified: 0, reason: 'context_budget' }; },
    ];
    if (!mode.field) {
      mutations.push(value => { value.retainedSourceWindow = { maxUnitsPerMessage: 800, truncatedMessageIndices: [] }; });
    } else {
      mutations.push(value => { delete value[mode.field]; },
        value => { value[mode.field].extra = true; });
      if (mode.field === 'sourceWindowCatalog') {
        mutations.push(value => { value.sourceWindowCatalog.version = 2; },
          value => { value.sourceWindowCatalog.maxUnitsPerWindow = 799; },
          value => { value.sourceWindowCatalog.messageCount++; },
          value => { value.sourceWindowCatalog.windowCount++; },
          value => { value.sourceWindowCatalog.semanticCoverage = 'assessed'; });
      } else {
        mutations.push(value => { value.retainedSourceWindow.maxUnitsPerMessage = 799; },
          value => { value.retainedSourceWindow.truncatedMessageIndices = [0]; });
      }
      if (mode.evidence) {
        mutations.push(value => { delete value.qualificationStatus; },
          value => { value.qualificationStatus = 'qualified'; });
      } else mutations.push(value => { value.qualificationStatus = 'not-requested'; });
    }
    for (const mutate of mutations) {
      let calls = 0;
      const observed = await mode.ingest({ history: source, namespace, capture: async () => {
        calls++;
        const response = responseFor(mode, plan.batches[0],
          { ...applied(), classificationTruncated: { memoriesShortened: 1, catalogItemsOmitted: 0 } });
        mutate(response.value);
        return response;
      } });
      malformed(observed.outcomes[0]);
      assert.equal(observed.outcomes[1].status, 'not_run');
      assert.equal(calls, 1);
    }
  });
}

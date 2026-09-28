import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsSqlite = major > 22 || (major === 22 && minor >= 16);
const namespace = { ownerId: 'synthetic-window-coverage', scope: 'personal', projectId: null };
const first = `first ${'a'.repeat(794)}`;
const second = `second ${'b'.repeat(793)}`;

async function fresh(t, { messages = [{ id: 'source', role: 'user', content: 'Synthetic source' }],
  extract = request => ({ items: [{ content: 'Synthetic memory', kind: 'context',
    confidence: 1, sourceIndices: [request.input.messages.length - 1] }] }),
  classify = request => ({ items: request.input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
  eventId = 'event', observe = true } = {}) {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const { createIndexedSourceWindowObserver } = await import('../source-window-coverage.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-source-window-fixture-' });
  const path = join(workspace.path, 'memory.sqlite');
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract(request) { calls.push({ method: 'extract', input: structuredClone(request.input) }); return extract(request); },
    classify(request) { calls.push({ method: 'classify', input: structuredClone(request.input) }); return classify(request); },
  };
  const input = { namespace, client: 'synthetic', sessionId: 'one', eventId, messages };
  let core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1' });
  workspace.defer(() => core?.close());
  const observer = observe ? createIndexedSourceWindowObserver() : null;
  const response = observe ? await observer.capture(core, input) : await core.capture(input);
  core.close();
  core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1' });
  const reads = () => ({ inspectAdmission: query => core.inspectAdmission(query), get: query => core.get(query) });
  return { observer, response, input, calls, reads, path, model,
    defer: callback => workspace.defer(callback), get core() { return core; } };
}

test('W1: a completed indexed capture reports the offered window missing from cold receipts',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-source-window-coverage-' });
  const path = join(workspace.path, 'memory.sqlite');
  const calls = [];
  const model = {
    contextWindow: 8192,
    countTokens: () => 1,
    extract(request) {
      calls.push('extract');
      assert.equal(request.input.inputMode, 'indexed-windows-v1');
      assert.deepEqual(request.input.messages.map(row => row.content), [first, second]);
      return { items: [{ content: 'Synthetic first-window memory', kind: 'context',
        confidence: 1, sourceIndices: [0] }] };
    },
    classify(request) {
      calls.push('classify');
      return { items: request.input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    },
  };
  const input = { namespace, client: 'synthetic', sessionId: 'one', eventId: 'one',
    messages: [{ id: 'source', role: 'user', content: first + second }] };
  // The candidate wrapper must bind the offered view to its actual public capture call.
  const module = await import('../source-window-coverage.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND' &&
        error.message.includes('/evaluation/architecture/source-window-coverage.mjs')) return {};
    throw error;
  });
  const observer = module.createIndexedSourceWindowObserver?.();
  let core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1' });
  workspace.defer(() => core?.close());
  const response = observer ? await observer.capture(core, input) : await core.capture(input);
  assert.equal(response.ok, true);
  assert.equal(response.value.admission.memories.length, 1);
  assert.equal(response.value.sourceWindowCatalog.windowCount, 2);
  assert.deepEqual(calls, ['extract', 'classify']);
  const memoryId = response.value.admission.memories[0].id;
  core.close();
  core = openMemoryCore({ path, model, captureSourcePolicy: 'indexed-evidence-v1' });
  const detail = core.get({ namespace, memoryId });
  assert.equal(detail.ok, true);
  assert.deepEqual(detail.value.receipts.map(row => row.excerpt), [first]);
  const report = observer?.finish({ inspectAdmission: query => core.inspectAdmission(query),
    get: query => core.get(query) });
  assert.equal(report?.scope, 'capture-members-only/current-read');
  assert.equal(report?.status, 'observed');
  assert.equal(report?.coverage, 'partial');
  assert.equal(report?.selection, 'unavailable');
  assert.equal(report?.uniqueOfferedCount, 2);
  assert.equal(report?.uniqueRetainedCount, 1);
  assert.equal(report?.uniqueUnmatchedCount, 1);
  assert.deepEqual(report?.windows, [
    { ordinal: 1, retention: 'retained' },
    { ordinal: 2, retention: 'unmatched' },
  ]);
});

test('W2: repeated source text keeps distinct identities and identical windows stay ambiguous',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const distinct = await fresh(t, { messages: [
    { id: 'source-a', role: 'user', content: 'Same synthetic text' },
    { id: 'source-b', role: 'user', content: 'Same synthetic text' },
  ], extract: () => ({ items: [{ content: 'Synthetic memory', kind: 'context',
    confidence: 1, sourceIndices: [0] }] }) });
  const report = distinct.observer.finish(distinct.reads());
  assert.equal(report.coverage, 'partial');
  assert.equal(report.uniqueOfferedCount, 2);
  assert.deepEqual(report.windows.map(row => row.retention), ['retained', 'unmatched']);

  const repeated = await fresh(t, { messages: [{ id: 'same-source', role: 'user',
    content: 'x'.repeat(1600) }], extract: () => ({ items: [{ content: 'Synthetic memory',
    kind: 'context', confidence: 1, sourceIndices: [0] }] }) });
  const ambiguous = repeated.observer.finish(repeated.reads());
  assert.equal(ambiguous.coverage, 'ambiguous');
  assert.equal(ambiguous.offeredCount, 2);
  assert.equal(ambiguous.uniqueOfferedCount, 1);
  assert.equal(ambiguous.uniqueRetainedCount, 0);
  assert.equal(ambiguous.uniqueAmbiguousCount, 1);
  assert.deepEqual(ambiguous.windows.map(row => row.retention), ['ambiguous', 'ambiguous']);
});

test('W2/W6: Unicode boundary, empty, failed and post-admission classification states are explicit',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const unicode = await fresh(t, { messages: [{ id: 'unicode', role: 'assistant',
    content: `${'a'.repeat(799)}🚋tail` }] });
  assert.deepEqual(unicode.calls[0].input.messages.map(row => row.content),
    ['a'.repeat(799), '🚋tail']);
  const unicodeReport = unicode.observer.finish(unicode.reads());
  assert.deepEqual(unicodeReport.windows.map(row => row.retention), ['unmatched', 'retained']);

  const empty = await fresh(t, { extract: () => ({ items: [] }) });
  const emptyReport = empty.observer.finish(empty.reads());
  assert.equal(emptyReport.status, 'observed');
  assert.equal(emptyReport.coverage, 'none');
  assert.equal(emptyReport.uniqueUnmatchedCount, 1);

  const failed = await fresh(t, { extract: () => ({ items: [{ malformed: true }] }) });
  assert.equal(failed.response.ok, false);
  const failedReport = failed.observer.finish(failed.reads());
  assert.equal(failedReport.status, 'failed');
  assert.equal(failedReport.coverage, 'unavailable');
  assert.equal(failedReport.uniqueUnmatchedCount, null);

  const unfiled = await fresh(t, { classify: () => { throw new Error('synthetic failure'); } });
  assert.equal(unfiled.response.value.classification.status, 'failed');
  const unfiledReport = unfiled.observer.finish(unfiled.reads());
  assert.equal(unfiledReport.status, 'observed');
  assert.equal(unfiledReport.reason, 'classification_failed');
  assert.equal(unfiledReport.coverage, 'complete');
});

test('W4/W5: duplicate, correction, forgetting and suppression never claim current retention from stale capture',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { createIndexedSourceWindowObserver } = await import('../source-window-coverage.mjs');
  const corrected = await fresh(t);
  const original = corrected.response.value.admission.memories[0];
  const replacement = corrected.core.correct({ namespace, memoryId: original.id,
    expectedRevision: corrected.response.value.classification.memoryRevisions[0].revision,
    content: 'Synthetic correction', kind: 'context', receipt: { client: 'manual',
      sessionId: 'manual', eventId: 'correction', role: 'user', excerpt: 'Synthetic correction' } });
  assert.equal(replacement.ok, true);
  const stale = corrected.observer.finish(corrected.reads());
  assert.equal(stale.coverage, 'unavailable');
  assert.equal(stale.reason, 'stale');

  const duplicate = createIndexedSourceWindowObserver();
  const replay = await duplicate.capture(corrected.core, corrected.input);
  assert.equal(replay.ok, true);
  assert.equal(replay.value.duplicate, true);
  assert.equal(duplicate.finish(corrected.reads()).status, 'duplicate');

  const forgotten = await fresh(t, { eventId: 'forget-event' });
  const member = forgotten.response.value.admission.memories[0];
  const revision = forgotten.response.value.classification.memoryRevisions[0].revision;
  assert.equal(forgotten.core.forget({ namespace, memoryId: member.id,
    expectedRevision: revision }).ok, true);
  assert.equal(forgotten.observer.finish(forgotten.reads()).reason, 'stale');
  const suppressed = createIndexedSourceWindowObserver();
  const next = { ...forgotten.input, eventId: 'suppressed-event' };
  const suppressedResponse = await suppressed.capture(forgotten.core, next);
  assert.equal(suppressedResponse.value.admission.suppressedCount, 1);
  const suppressedReport = suppressed.finish(forgotten.reads());
  assert.equal(suppressedReport.status, 'suppressed');
  assert.equal(suppressedReport.coverage, 'unavailable');
  assert.equal(suppressedReport.uniqueRetainedCount, null);
});

test('W3/W4: wrapper forwards exact result and thrown error; hostile metadata and reads fail closed',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { createIndexedSourceWindowObserver } = await import('../source-window-coverage.mjs');
  const input = { namespace, client: 'synthetic', sessionId: 'one', eventId: 'one',
    messages: [{ id: 'source', role: 'user', content: 'Synthetic source' }] };
  const result = { ok: false, error: { code: 'synthetic_failure' } };
  const forwarding = createIndexedSourceWindowObserver();
  assert.strictEqual(await forwarding.capture({ capture: async () => result }, input), result);
  assert.equal(forwarding.finish({}).status, 'failed');
  const thrown = new Error('private failure text');
  const throwing = createIndexedSourceWindowObserver();
  await assert.rejects(throwing.capture({ capture: async () => { throw thrown; } }, input),
    error => error === thrown);
  assert.equal(throwing.finish({}).reason, 'capture_failed');

  let getterReads = 0;
  const accessorInput = { ...input };
  Object.defineProperty(accessorInput, 'messages', { get() { getterReads++; throw new Error('private'); } });
  const hostile = createIndexedSourceWindowObserver();
  await hostile.capture({ capture: async () => result }, accessorInput);
  assert.equal(getterReads, 0);
  assert.equal(hostile.finish({}).reason, 'invalid_input');

  const poison = { toJSON() { getterReads++; throw new Error('private'); } };
  const hostileNamespace = createIndexedSourceWindowObserver();
  assert.strictEqual(await hostileNamespace.capture({ capture: async () => result },
    { ...input, namespace: { ...namespace, ownerId: poison } }), result);
  assert.equal(hostileNamespace.finish({}).reason, 'invalid_input');
  assert.equal(getterReads, 0);

  const accessorResponse = { ok: true };
  Object.defineProperty(accessorResponse, 'value', { get() { getterReads++; throw new Error('private'); } });
  const malformed = createIndexedSourceWindowObserver();
  assert.strictEqual(await malformed.capture({ capture: async () => accessorResponse }, input), accessorResponse);
  assert.equal(malformed.finish({}).reason, 'invalid_capture');
  assert.equal(getterReads, 0);

  const freshCapture = await fresh(t);
  const unavailable = freshCapture.observer.finish({
    inspectAdmission: () => { throw Object.defineProperty({}, 'message', {
      get() { getterReads++; throw new Error('private'); },
    }); },
    get: query => freshCapture.core.get(query),
  });
  assert.equal(unavailable.reason, 'read_unavailable');
  assert.equal(getterReads, 0);
  assert.equal(freshCapture.observer.finish(freshCapture.reads()).coverage, 'unavailable');

  const proxyError = new Proxy({}, { getPrototypeOf() { getterReads++; throw new Error('private'); } });
  const guarded = await fresh(t);
  const guardedReport = guarded.observer.finish({
    inspectAdmission() { throw proxyError; },
    get: query => guarded.core.get(query),
  });
  assert.equal(guardedReport.reason, 'read_unavailable');
  assert.equal(getterReads, 0);
});

test('W3: observation changes no capture/model calls or source outcome',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const messages = [{ id: 'source', role: 'user', content: first + second }];
  const baseline = await fresh(t, { messages, observe: false });
  const observed = await fresh(t, { messages });
  const project = fixture => ({
    calls: fixture.calls.map(call => call.method),
    extractInput: fixture.calls.find(call => call.method === 'extract').input,
    classifyMemories: fixture.calls.find(call => call.method === 'classify').input.memories
      .map(memory => ({ content: memory.content, kind: memory.kind })),
    admissionCount: fixture.response.value.admission.memories.length,
    classification: fixture.response.value.classification.status,
    catalog: fixture.response.value.sourceWindowCatalog,
    receipts: fixture.core.get({ namespace, memoryId: fixture.response.value.admission.memories[0].id })
      .value.receipts.map(receipt => [receipt.client, receipt.sessionId, receipt.eventId,
        receipt.role, receipt.excerpt]),
  });
  assert.deepEqual(project(observed), project(baseline));
  assert.equal(observed.observer.finish(observed.reads()).coverage, 'partial');
});

test('W4/W6: incomplete, changing and foreign cold reads fail closed; duplicate receipts count once',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const duplicateReceipts = await fresh(t);
  const normal = duplicateReceipts.reads();
  const repeated = duplicateReceipts.observer.finish({
    inspectAdmission: normal.inspectAdmission,
    get(query) {
      const result = normal.get(query);
      return { ...result, value: { ...result.value,
        memory: { ...result.value.memory, receiptCount: 2 },
        receipts: [...result.value.receipts, ...result.value.receipts] } };
    },
  });
  assert.equal(repeated.uniqueRetainedCount, 1);

  const incomplete = await fresh(t);
  const cold = incomplete.reads();
  const incompleteReport = incomplete.observer.finish({
    inspectAdmission: cold.inspectAdmission,
    get(query) { const result = cold.get(query);
      return { ...result, value: { ...result.value, exhausted: false } }; },
  });
  assert.equal(incompleteReport.reason, 'incomplete');
  assert.equal(incompleteReport.uniqueRetainedCount, null);

  const changed = await fresh(t);
  const changing = changed.reads();
  let reads = 0;
  const changedReport = changed.observer.finish({
    inspectAdmission(query) {
      reads++;
      if (reads === 2) {
        const member = changed.response.value.admission.memories[0];
        const revision = changed.response.value.classification.memoryRevisions[0].revision;
        assert.equal(changed.core.correct({ namespace, memoryId: member.id,
          expectedRevision: revision, content: 'Changed during observation', kind: 'context',
          receipt: { client: 'manual', sessionId: 'manual', eventId: 'changed', role: 'user',
            excerpt: 'Changed during observation' } }).ok, true);
      }
      return changing.inspectAdmission(query);
    },
    get: changing.get,
  });
  assert.equal(reads, 2);
  assert.equal(changedReport.reason, 'stale');

  const foreign = await fresh(t);
  const foreignReads = foreign.reads();
  const unavailable = foreign.observer.finish({
    inspectAdmission: query => foreignReads.inspectAdmission({ ...query,
      namespace: { ownerId: 'foreign', scope: 'personal', projectId: null } }),
    get: foreignReads.get,
  });
  assert.equal(unavailable.coverage, 'unavailable');

  const wrongIdentity = await fresh(t);
  const sameRevision = wrongIdentity.reads();
  const identityReport = wrongIdentity.observer.finish({
    inspectAdmission: sameRevision.inspectAdmission,
    get(query) {
      const result = sameRevision.get(query);
      return { ...result, value: { ...result.value, memory: { ...result.value.memory,
        id: 'foreign-memory', namespace: { ownerId: 'foreign', scope: 'personal', projectId: null } } } };
    },
  });
  assert.equal(identityReport.reason, 'stale');

  const accessorRead = await fresh(t);
  let getterReads = 0;
  const accessorReads = accessorRead.reads();
  const readReport = accessorRead.observer.finish({
    inspectAdmission: accessorReads.inspectAdmission,
    get(query) {
      const result = accessorReads.get(query);
      const value = { ...result.value };
      Object.defineProperty(value, 'receipts', { get() { getterReads++; throw new Error('private'); } });
      return { ...result, value };
    },
  });
  assert.equal(readReport.reason, 'read_unavailable');
  assert.equal(getterReads, 0);
});

test('W4/W6: report stays source-free and below 16 KiB with many split windows',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const messages = Array.from({ length: 24 }, (_, index) => ({ id: `source-${index}`,
    role: index % 2 ? 'assistant' : 'user',
    content: `S${String(index).padStart(2, '0')} ${'x'.repeat(797)}` }));
  const large = await fresh(t, { messages, extract: () => ({ items: [] }) });
  assert.equal(large.response.value.sourceWindowCatalog.windowCount, 48);
  const report = large.observer.finish(large.reads());
  assert.equal(report.status, 'observed');
  assert.equal(report.coverage, 'none');
  assert.equal(report.windows.length, 48);
  const printed = JSON.stringify(report);
  assert.ok(Buffer.byteLength(printed, 'utf8') <= 16 * 1024);
  for (const forbidden of ['S0 ', 'Synthetic', 'source-', 'memory.sqlite', 'private failure',
    'synthetic-window-coverage', '/tmp/']) assert.equal(printed.includes(forbidden), false);
});

test('W4/W5: processing and late completion remain assigned to the original one-shot observer',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const { createIndexedSourceWindowObserver } = await import('../source-window-coverage.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'cairn-source-window-processing-' });
  let release, started;
  const seen = new Promise(resolve => { started = resolve; });
  const model = { contextWindow: 8192, countTokens: () => 1,
    extract() { started(); return new Promise(resolve => { release = () => resolve({ items: [] }); }); },
  };
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'), model,
    captureSourcePolicy: 'indexed-evidence-v1' });
  workspace.defer(() => core.close());
  const input = { namespace, client: 'synthetic', sessionId: 'one', eventId: 'processing',
    messages: [{ id: 'source', role: 'user', content: 'Synthetic processing' }] };
  const original = createIndexedSourceWindowObserver();
  const pending = original.capture(core, input);
  await seen;
  const second = createIndexedSourceWindowObserver();
  const processing = await second.capture(core, input);
  assert.equal(processing.value.processing, true);
  assert.equal(second.finish({}).status, 'processing');
  release();
  assert.equal((await pending).ok, true);
  const reads = { inspectAdmission: query => core.inspectAdmission(query), get: query => core.get(query) };
  assert.equal(original.finish(reads).coverage, 'none');
  assert.equal(second.finish(reads).coverage, 'unavailable');
});

test('W4: mixed filed dedup and new admission uses the post-classification revision subset',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const { createIndexedSourceWindowObserver } = await import('../source-window-coverage.mjs');
  const extracted = request => ({ items: request.input.messages.map((message, index) => ({
    content: message.content.includes('Existing') ? 'Existing synthetic memory' : 'New synthetic memory',
    kind: 'context', confidence: 1, sourceIndices: [index],
  })) });
  let classificationCalls = 0;
  const classify = request => {
    classificationCalls++;
    return { items: request.input.memories.map(memory => ({ memoryId: memory.id,
      parentIds: [], ...(classificationCalls === 1
        ? { newL1: { title: 'Synthetic subject', parentL2Ids: [] } } : {}),
    })) };
  };
  const firstCapture = await fresh(t, { messages: [{ id: 'original', role: 'user',
    content: 'Existing synthetic source' }], extract: extracted, classify });
  const firstId = firstCapture.response.value.admission.memories[0].id;
  assert.equal(firstCapture.core.get({ namespace, memoryId: firstId }).value.memory.filing.status, 'filed');
  const observer = createIndexedSourceWindowObserver();
  const input = { ...firstCapture.input, eventId: 'mixed', messages: [
    { id: 'original', role: 'user', content: 'Existing synthetic source' },
    { id: 'new', role: 'assistant', content: 'New synthetic source' },
  ] };
  const response = await observer.capture(firstCapture.core, input);
  assert.equal(response.ok, true);
  assert.equal(response.value.admission.memories.length, 2);
  assert.equal(response.value.classification.status, 'applied');
  assert.equal(response.value.classification.memoryRevisions.length, 1);
  const cold = openMemoryCore({ path: firstCapture.path, model: firstCapture.model,
    captureSourcePolicy: 'indexed-evidence-v1' });
  firstCapture.defer(() => cold.close());
  const report = observer.finish({ inspectAdmission: query => cold.inspectAdmission(query),
    get: query => cold.get(query) });
  assert.equal(report.status, 'observed');
  assert.equal(report.coverage, 'complete');
  assert.equal(report.uniqueRetainedCount, 2);
});

test('W4: mutated public response, input and read query cannot rebind the observed capture',
  { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' }, async t => {
  const row = await fresh(t);
  const original = row.response.value.admission.memories[0];
  row.input.messages[0].content = 'Caller mutation after capture';
  row.response.value.admission.memories[0] = { id: 'forged', revision: 999 };
  row.response.value.classification.memoryRevisions[0] = { memoryId: 'forged', revision: 999 };
  const reads = row.reads();
  const report = row.observer.finish({
    inspectAdmission(query) { query.namespace.ownerId = 'forged'; return reads.inspectAdmission({
      ...query, namespace }); },
    get(query) { query.namespace.ownerId = 'forged'; return reads.get({ ...query, namespace }); },
  });
  assert.equal(report.coverage, 'complete');
  assert.equal(report.uniqueRetainedCount, 1);
  assert.equal(row.core.get({ namespace, memoryId: original.id }).ok, true);
});

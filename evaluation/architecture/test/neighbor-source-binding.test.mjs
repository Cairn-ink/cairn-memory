import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { captureSnapshot } from '../../../core/capture-input.mjs';
import { extractedWindowItems, sourceWindowCatalog } from '../../../core/source-windows.mjs';
import { createNeighborSourceBinding, resolveNeighborSourceBinding } from '../neighbor-source-binding.mjs';

const namespace = { ownerId: 'ordinary-synthetic-neighbor', scope: 'personal', projectId: null };
const policy = { captureSourcePolicy: 'indexed-evidence-v1' };
const supportsSqlite = Number(process.versions.node.split('.')[0]) >= 22 &&
  (Number(process.versions.node.split('.')[0]) > 22 || Number(process.versions.node.split('.')[1]) >= 16);
const sqlite = { skip: !supportsSqlite && 'node:sqlite requires Node >=22.16' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const input = (texts, extra = {}) => ({ namespace, client: 'offline-synthetic', sessionId: 'dialogue',
  eventId: 'batch', messages: texts.map((content, index) => ({ id: `message-${index}`,
    role: index % 2 ? 'assistant' : 'user', content })), ...extra });
const item = (sourceIndices, content = 'Synthetic recorded statement') => ({
  content, kind: 'context', confidence: 0.8, sourceIndices });
const defaultCounter = text => Math.ceil(text.length / 8);
const bindingFor = (request, options = {}) => createNeighborSourceBinding(request, {
  countTokens: defaultCounter, ...options });
const trusted = request => {
  const snapshot = captureSnapshot(request, undefined, policy.captureSourcePolicy);
  return { snapshot, catalog: sourceWindowCatalog(snapshot) };
};
const assertItemCounts = (report, original, request) => {
  const catalog = trusted(request).catalog;
  const size = index => catalog.entries[index] ? Buffer.byteLength(catalog.entries[index].content, 'utf8') : 0;
  const expected = original.items.map((entry, itemIndex) => {
    const attempts = report.diagnostics.filter(row => row.itemIndex === itemIndex);
    const attached = attempts.filter(row => row.reason === 'attached');
    const skipped = attempts.filter(row => row.reason !== 'attached');
    return { itemIndex, selected: entry.sourceIndices.length,
      selectedBytes: entry.sourceIndices.reduce((sum, index) => sum + size(index), 0),
      added: attached.length, addedBytes: attached.reduce((sum, row) => sum + size(row.predecessorIndex), 0),
      skipped: skipped.length, skippedBytes: skipped.reduce((sum, row) => sum + size(row.predecessorIndex), 0) };
  });
  assert.deepEqual(report.itemCounts, expected);
  const sums = Object.fromEntries(Object.keys(report.counts).map(key => [key,
    report.itemCounts.reduce((sum, row) => sum + row[key], 0)]));
  assert.deepEqual(sums, report.counts);
};
const expand = (request, output, options) => {
  const binding = bindingFor(request, options);
  const transformed = binding.transform({ input: structuredClone(trusted(request).catalog.input) }, output);
  assertItemCounts(binding.summary(), output, request);
  return { binding, output: transformed };
};

test('N1/N2/N3 preserve original order/values; traverse original indices canonically once', () => {
  const request = input(['zero', 'one', 'two', 'three', 'four']);
  const original = { items: [item([4, 1])] }, saved = structuredClone(original);
  const { output, binding } = expand(request, original);
  assert.deepEqual(output.items[0].sourceIndices, [4, 1, 0, 3]);
  assert.deepEqual(original, saved);
  assert.deepEqual({ ...output.items[0], sourceIndices: [4, 1] }, original.items[0]);
  assert.deepEqual(binding.summary().diagnostics.map(row => [row.selectedIndex, row.predecessorIndex, row.reason]),
    [[1, 0, 'attached'], [4, 3, 'attached']]);
  assert.deepEqual(binding.summary().counts, { selected: 2, selectedBytes: 7,
    added: 2, addedBytes: 9, skipped: 0, skippedBytes: 0 });
  const { snapshot, catalog } = trusted(request);
  assert.deepEqual(extractedWindowItems(output, snapshot, catalog)[0].receipts.slice(0, 2),
    extractedWindowItems(original, snapshot, catalog)[0].receipts);
  assert.equal(output.items[0].sourceIndices.includes(2), false); // No recursion from added index 3.
});

test('N3/N6 no predecessor, preselected and exact duplicate neighbor identities, four-slot cap', () => {
  const request = input(Array.from({ length: 8 }, (_, index) => `ordinary ${index}`));
  const first = expand(request, { items: [item([1, 0])] });
  assert.deepEqual(first.output.items[0].sourceIndices, [1, 0]);
  assert.deepEqual(first.binding.summary().diagnostics.map(row => row.reason), ['no-predecessor', 'already-retained']);
  const capped = expand(request, { items: [item([7, 1, 5, 3])] });
  assert.deepEqual(capped.output.items[0].sourceIndices, [7, 1, 5, 3]);
  assert.ok(capped.binding.summary().diagnostics.every(row => row.reason === 'receipt-cap'));
  const repeated = input(['a'.repeat(800) + 'b'.repeat(800) + 'a'.repeat(800) + 'c'.repeat(800)]);
  const exact = expand(repeated, { items: [item([1, 3])] });
  assert.deepEqual(exact.output.items[0].sourceIndices, [1, 3, 0]);
  assert.deepEqual(exact.binding.summary().diagnostics.map(row => row.reason), ['attached', 'already-retained']);
  const identical = expand(input(['a'.repeat(1600)]), { items: [item([1])] });
  assert.deepEqual(identical.output.items[0].sourceIndices, [1]);
  assert.equal(identical.binding.summary().diagnostics[0].reason, 'already-retained');
});

test('N1/N6 original invalid entire batch never salvaged; empty stays empty; caps unchanged', () => {
  const request = input(['zero', 'one', 'two', 'three', 'four', 'five']);
  const invalid = [{ items: [item([1]), item([99])] }, { items: [item([1, 1])] },
    { items: [item([0, 1, 2, 3, 4])] }, { items: Array.from({ length: 6 }, () => item([1])) },
    { items: [item([1], '\ud800')] }, { items: [item([1]), { ...item([1]), confidence: 2 }] },
    { items: [item([1]), { ...item([1]), extra: true }] }, null];
  for (const original of invalid) {
    const binding = bindingFor(request);
    assert.throws(() => binding.transform({ input: trusted(request).catalog.input }, original), { code: 'invalid_model_output' });
    assert.equal(binding.summary(), null);
  }
  assert.throws(() => expand(input(['a'.repeat(1600)]), { items: [item([0, 1])] }), { code: 'invalid_model_output' });
  const empty = expand(request, { items: [] });
  assert.deepEqual(empty.output, { items: [] }); assert.equal(empty.binding.summary().counts.added, 0);
  assert.equal(expand(request, { items: Array.from({ length: 5 }, () => item([1])) }).output.items.length, 5);
  for (const bad of [input(['x'.repeat(4001)]), input(Array(25).fill('source')),
    input(Array(6).fill('x'.repeat(4000))), input(['\ud800'])]) {
    assert.throws(() => bindingFor(bad), { code: 'invalid_input' });
  }
});

test('N1/N2/N6 real canonical non-BMP spans, redaction, detached input and deterministic resources', () => {
  const secret = 'sk-' + 'a'.repeat(48);
  const request = input(['x'.repeat(799) + '🚋TAIL', `Private ${secret} ordinary`]);
  const canonical = trusted(request), binding = bindingFor(request);
  request.messages[0].content = 'caller mutation';
  const output = binding.transform({ input: structuredClone(canonical.catalog.input) }, { items: [item([1])] });
  assert.deepEqual(output.items[0].sourceIndices, [1, 0]);
  assert.equal(canonical.catalog.entries[0].end, 799);
  assert.equal(canonical.catalog.entries[1].start, 799);
  assert.equal(canonical.catalog.entries[1].content, '🚋TAIL');
  assert.ok(canonical.catalog.entries.every(row => row.content.isWellFormed() && row.content.length <= 800));
  assert.equal(canonical.catalog.entries[2].content, 'Private [REDACTED] ordinary');
  assert.ok(!JSON.stringify(canonical).includes(secret));
  const mismatch = bindingFor(input(['source', 'reply']));
  assert.throws(() => mismatch.transform({ input: trusted(input(['different', 'reply'])).catalog.input },
    { items: [item([1])] }), /source_catalog_mismatch/);
  const resources = input(['🚋context', 'selected', 'unrelated', 'last']);
  const bounded = expand(resources, { items: [item([1, 3])] }, { maxAddedBytes: Buffer.byteLength('🚋context') });
  assert.deepEqual(bounded.output.items[0].sourceIndices, [1, 3, 0]);
  assert.deepEqual(bounded.binding.summary().diagnostics.map(row => row.reason), ['attached', 'resource-cap']);
  const exhausted = expand(resources, { items: [item([1])] }, { maxAddedBytes: 0 });
  assert.deepEqual(exhausted.output.items[0].sourceIndices, [1]);
  assert.equal(exhausted.binding.summary().diagnostics[0].reason, 'resource-cap');
});

test('N1 one first output is consumed even on validation, catalog or counter failure', () => {
  const request = input(['ordinary user', 'ordinary assistant']);
  const wire = { input: trusted(request).catalog.input }, valid = { items: [item([1])] };
  assert.throws(() => createNeighborSourceBinding(request), { code: 'token_count_unavailable' });
  for (const failure of [
    { wire, output: { items: [item([99])] }, error: { code: 'invalid_model_output' } },
    { wire: { input: {} }, output: valid, error: /source_catalog_mismatch/ },
    { wire, output: valid, countTokens: () => 1025, error: { code: 'invalid_model_output' } },
    { wire, output: valid, countTokens: () => Promise.resolve(1), error: { code: 'token_count_unavailable' } },
  ]) {
    const binding = bindingFor(request, failure.countTokens ? { countTokens: failure.countTokens } : {});
    assert.throws(() => binding.transform(failure.wire, failure.output), failure.error);
    assert.equal(binding.summary(), null);
    assert.throws(() => binding.transform(wire, valid), /extraction_already_transformed/);
  }
});

test('N1 counter closures cannot mutate caller-owned original output during original or candidate counting', () => {
  const request = input(['ordinary user', 'ordinary assistant']);
  const wire = { input: trusted(request).catalog.input };
  for (const mutateOn of [1, 2]) {
    const original = { items: [item([1])] };
    let counts = 0;
    const binding = bindingFor(request, { countTokens(text) {
      assert.equal(typeof text, 'string');
      if (++counts === mutateOn) original.items[0].content = 'Counter mutation';
      return Math.ceil(text.length / 8);
    } });
    assert.throws(() => binding.transform(wire, original), { code: 'invalid_model_output' });
    assert.equal(binding.summary(), null);
    assert.throws(() => binding.transform(wire, { items: [item([1])] }), /extraction_already_transformed/);
  }
});

async function fixture(t, { request, output, enabled = true, maxAddedBytes, classifyFails = false,
  countTokens = defaultCounter } = {}) {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'neighbor-source-binding-' });
  const path = join(workspace.path, 'synthetic.sqlite');
  const modelCalls = [], coreCalls = {};
  const model = { contextWindow: 8192, countTokens,
    extract(wire) { modelCalls.push('extract'); return binding.transform(wire, structuredClone(output)); },
    classify({ input: wire }) { modelCalls.push('classify');
      if (classifyFails) throw new Error('synthetic classification failure');
      return { items: wire.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }; } };
  const binding = createNeighborSourceBinding(request, { enabled, maxAddedBytes, countTokens: model.countTokens });
  for (const method of ['qualify', 'qualifyCandidates', 'reconcile', 'relate', 'reviewBasis', 'select', 'rank']) {
    Object.defineProperty(model, method, { get() { assert.fail(`Unexpected model access: ${method}`); } });
  }
  const cores = [];
  const open = options => {
    const raw = openMemoryCore({ path, ...policy,
      model: { contextWindow: 8192, countTokens: () => 1 }, ...options }); cores.push(raw);
    return Object.fromEntries(Object.entries(raw).map(([key, value]) => [key,
      typeof value === 'function' ? (...args) => {
        coreCalls[key] = (coreCalls[key] ?? 0) + 1; return value(...args);
      } : value]));
  };
  workspace.defer(() => { for (const core of cores) core.close(); });
  const core = open({ model });
  return { core, binding, model, modelCalls, coreCalls, open, path };
}
const detail = (core, id, ns = namespace) => ok(core.get({ namespace: ns, memoryId: id, receiptLimit: 100 }));
const excerpts = rows => rows.map(row => [row.role, row.excerpt]).sort();

test('N4/N5/N6 enabled versus disabled real normal capture, classification and cold source bytes', sqlite, async t => {
  const texts = ['I need a tool that works on the train; this is still a consideration.',
    'I recommend the green notebook. This recommendation has not been adopted.'];
  const request = input(texts), original = { items: [item([1], 'Assistant recommended the green notebook.')] };
  const observations = [];
  for (const enabled of [false, true]) {
    const f = await fixture(t, { request, output: original, enabled });
    const result = await f.core.capture(request), captured = ok(result);
    assert.equal(captured.classification.status, 'applied');
    assert.deepEqual(f.modelCalls, ['extract', 'classify']);
    const id = captured.admission.memories[0].id, saved = detail(f.core, id);
    assert.equal(saved.memory.content, original.items[0].content);
    assert.equal(saved.qualification, undefined); assert.deepEqual(saved.conflicts, []);
    const { sidecar, expectedDigest } = f.binding.bind(f.core, result);
    assertItemCounts(sidecar, original, request);
    assert.ok(!JSON.stringify(sidecar).includes(texts[0]));
    assert.ok(!JSON.stringify(sidecar).includes(texts[1]));
    f.core.close();
    const cold = f.open({}); // Local token counter only; no generation methods.
    const resolved = resolveNeighborSourceBinding(cold, namespace, JSON.parse(JSON.stringify(sidecar)), expectedDigest);
    assert.deepEqual(resolved.rejected, []);
    assert.deepEqual(resolved.resolved.map(row => row.provenanceRole), enabled
      ? ['extractor-selected', 'dialogue-context'] : ['extractor-selected']);
    assert.deepEqual(excerpts(resolved.resolved.map(row => row.receipt)), enabled
      ? [['assistant', texts[1]], ['user', texts[0]]] : [['assistant', texts[1]]]);
    const fetched = ok(cold.fetch({ namespace, contextMode: 'source-evidence',
      refs: [{ memoryId: id, revision: saved.memory.revision }] }));
    assert.equal(Object.hasOwn(fetched.items[0].memory, 'content'), false);
    assert.equal(fetched.items[0].receiptCount, enabled ? 2 : 1);
    assert.equal(detail(cold, id).memory.content, saved.memory.content);
    observations.push({ enabled, counts: sidecar.counts, itemCounts: sidecar.itemCounts, modelCalls: f.modelCalls,
      coreCalls: { ...f.coreCalls }, canonicalReceipts: sidecar.memories[0].receiptCount,
      coldSourcesPresent: resolved.resolved.length });
  }
  assert.deepEqual(observations.map(row => row.counts.added), [0, 1]);
  t.diagnostic(JSON.stringify({ synthetic: true, semanticQuality: 'not-measured', observations }));
  assert.deepEqual(original.items[0].sourceIndices, [1]);
});

test('N4/N7 authoritative cold scope, mismatches, correction, forget and replay never resurrect', sqlite, async t => {
  const secret = 'sk-' + 'b'.repeat(48);
  const request = input([`Private ${secret} context`, 'Assistant suggestion only.']);
  const f = await fixture(t, { request, output: { items: [item([1])] } });
  const first = await f.core.capture(request); const captured = ok(first);
  const id = captured.admission.memories[0].id;
  const { sidecar, expectedDigest } = f.binding.bind(f.core, first);
  f.core.close(); const cold = f.open({});
  const sources = resolveNeighborSourceBinding(cold, namespace, sidecar, expectedDigest);
  assert.deepEqual(sources.rejected, []);
  assert.equal(resolveNeighborSourceBinding(cold, namespace, sidecar).resolved.length, 0);
  const relabeled = structuredClone(sidecar);
  relabeled.entries.find(row => row.provenanceRole === 'dialogue-context').provenanceRole = 'extractor-selected';
  assert.deepEqual(resolveNeighborSourceBinding(cold, namespace, relabeled, expectedDigest).resolved, []);
  relabeled.expectedDigest = expectedDigest; // An embedded pin cannot become authority.
  assert.deepEqual(resolveNeighborSourceBinding(cold, namespace, relabeled).resolved, []);
  assert.ok(sources.resolved.some(row => row.receipt.excerpt === 'Private [REDACTED] context'));
  assert.ok(!JSON.stringify(sources).includes(secret));
  const foreign = { ...namespace, ownerId: 'other-synthetic-owner' };
  assert.equal(resolveNeighborSourceBinding(cold, foreign, sidecar, expectedDigest).resolved.length, 0);
  const project = { ...namespace, scope: 'project', projectId: 'other-project' };
  for (const alteredNamespace of [foreign, project]) {
    const altered = { ...structuredClone(sidecar), namespace: alteredNamespace };
    assert.equal(resolveNeighborSourceBinding(cold, alteredNamespace, altered, expectedDigest).resolved.length, 0);
  }
  for (const patch of [{ eventId: 'missing-batch' }, { client: 'wrong-client' }, { sessionId: 'wrong-session' },
    { payloadDigest: 'c'.repeat(64) }]) {
    const altered = structuredClone(sidecar); Object.assign(altered.capture, patch);
    assert.equal(resolveNeighborSourceBinding(cold, namespace, altered, expectedDigest).resolved.length, 0);
  }
  for (const patch of [{ revision: sidecar.entries[0].revision + 1 }, { receiptId: 'missing' },
    { memoryId: 'missing' }, { receiptIdentityDigest: 'wrong' }, { receiptContentDigest: 'wrong' },
    { memoryContentDigest: 'wrong' }, { provenanceRole: 'supports-memory' },
    { provenanceRole: 'dialogue-context' }, { windowIndex: 44 }, { itemIndex: 3 }, { start: 1 }, { end: 2 }]) {
    const altered = structuredClone(sidecar); altered.entries = [{ ...altered.entries[0], ...patch }];
    altered.entries[0].excerpt = 'sidecar text must never publish';
    const resolution = resolveNeighborSourceBinding(cold, namespace, altered, expectedDigest);
    assert.deepEqual(resolution.resolved, []); assert.equal(resolution.rejected.length, 1);
    assert.ok(!JSON.stringify(resolution).includes('sidecar text'));
  }
  const callsBeforeReplay = [...f.modelCalls];
  assert.equal(ok(await cold.capture(request)).duplicate, true);
  assert.deepEqual(f.modelCalls, callsBeforeReplay);
  const before = detail(cold, id);
  const correction = ok(cold.correct({ namespace, memoryId: id, expectedRevision: before.memory.revision,
    content: 'Corrected synthetic statement', kind: 'context', receipt: { client: 'manual', sessionId: 'manual',
      eventId: 'correction', role: 'user', excerpt: 'Corrected synthetic statement' } }));
  assert.equal(resolveNeighborSourceBinding(cold, namespace, sidecar, expectedDigest).resolved.length, 0);
  assert.equal(ok(await cold.capture(request)).duplicate, true);
  assert.equal(detail(cold, id).memory.content, 'Corrected synthetic statement');
  ok(cold.forget({ namespace, memoryId: id, expectedRevision: correction.memory.revision }));
  assert.equal(ok(await cold.capture(request)).duplicate, true);
  assert.equal(resolveNeighborSourceBinding(cold, namespace, sidecar, expectedDigest).resolved.length, 0);
  assert.equal(cold.get({ namespace, memoryId: id }).error.code, 'memory_not_found');
  assert.deepEqual(f.modelCalls, callsBeforeReplay);
  const reopened = f.open({});
  assert.equal(resolveNeighborSourceBinding(reopened, namespace, sidecar, expectedDigest).resolved.length, 0);
});

test('N4/N6 deduplicated canonical memory accumulates more than four; unrelated context has no semantic edge', sqlite, async t => {
  const request = input(['Unrelated weather observation.', 'Assistant recommends amber without adoption.',
    'Unrelated timetable observation.', 'Assistant recommends indigo without adoption.',
    'Unrelated lunch observation.', 'Assistant recommends ivory without adoption.']);
  const original = { items: [item([1]), item([3]), item([5])] };
  const f = await fixture(t, { request, output: original });
  const result = await f.core.capture(request), captured = ok(result);
  assert.equal(captured.admission.memories.length, 1);
  const { sidecar, expectedDigest } = f.binding.bind(f.core, result);
  assertItemCounts(sidecar, original, request);
  assert.equal(sidecar.memories[0].receiptCount, 6);
  assert.deepEqual(sidecar.entries.map(row => row.itemIndex), [0, 0, 1, 1, 2, 2]);
  f.core.close(); const cold = f.open({});
  const resolved = resolveNeighborSourceBinding(cold, namespace, sidecar, expectedDigest);
  assert.equal(resolved.resolved.length, 6); assert.deepEqual(resolved.rejected, []);
  const saved = detail(cold, captured.admission.memories[0].id);
  assert.deepEqual(saved.conflicts, []); assert.equal(saved.supersession, undefined);
  assert.equal(saved.memory.receiptCount, 6);
  assert.deepEqual(Object.keys(resolved.resolved[0]).sort(),
    ['itemIndex', 'memoryId', 'provenanceRole', 'receipt', 'revision', 'windowIndex']);
  t.diagnostic(JSON.stringify({ canonicalMemories: 1, aggregateReceipts: 6,
    counts: sidecar.counts, itemCounts: sidecar.itemCounts, coldSourcesPresent: resolved.resolved.length }));
});

test('N1/N5/N6 normal core rejects invalid originals atomically; empty output makes no classifier call', sqlite, async t => {
  for (const output of [{ items: [item([1]), item([99])] }, { items: [] }]) {
    const request = input(['ordinary user', 'ordinary assistant']);
    const f = await fixture(t, { request, output });
    const result = await f.core.capture(request);
    if (output.items.length) {
      assert.equal(result.ok, false); assert.equal(result.error.code, 'invalid_model_output');
      assert.equal(ok(f.core.list({ namespace })).memories.length, 0);
      assert.equal(f.binding.summary(), null);
    } else {
      assert.deepEqual(ok(result).admission.memories, []);
      assert.deepEqual(f.binding.bind(f.core, result).sidecar.entries, []);
    }
    assert.deepEqual(f.modelCalls, ['extract']);
  }
});

test('N3/N5/N6 normal binder preserves capped, preselected, exhausted and long non-BMP controls cold', sqlite, async t => {
  const rows = [
    { request: input(['first source']), indices: [0], expected: [0], reasons: ['no-predecessor'] },
    { request: input(['user source', 'assistant source']), indices: [1, 0], expected: [1, 0],
      reasons: ['no-predecessor', 'already-retained'] },
    { request: input(Array.from({ length: 8 }, (_, i) => `source ${i}`)), indices: [7, 1, 5, 3],
      expected: [7, 1, 5, 3], reasons: Array(4).fill('receipt-cap') },
    { request: input(['user source', 'assistant source']), indices: [1], expected: [1],
      maxAddedBytes: 0, reasons: ['resource-cap'] },
    { request: input(['x'.repeat(799) + '🚋TAIL']), indices: [1], expected: [1, 0], reasons: ['attached'] },
  ];
  for (const row of rows) {
    const f = await fixture(t, { request: row.request, output: { items: [item(row.indices)] },
      maxAddedBytes: row.maxAddedBytes });
    const result = await f.core.capture(row.request);
    assert.equal(ok(result).classification.status, 'applied');
    const { sidecar, expectedDigest } = f.binding.bind(f.core, result);
    assert.deepEqual(sidecar.diagnostics.map(diagnostic => diagnostic.reason), row.reasons);
    assert.deepEqual(sidecar.entries.map(entry => entry.windowIndex), row.expected);
    f.core.close(); const cold = f.open({});
    const resolved = resolveNeighborSourceBinding(cold, namespace, sidecar, expectedDigest);
    assert.deepEqual(resolved.rejected, []);
    const catalog = trusted(row.request).catalog;
    assert.deepEqual(resolved.resolved.map(entry => entry.receipt.excerpt),
      row.expected.map(index => catalog.entries[index].content));
    assert.deepEqual(f.modelCalls, ['extract', 'classify']);
  }
});

test('N5/N7 explicit first-attempt classification failure is preserved, never silently repaired', sqlite, async t => {
  const request = input(['ordinary context', 'ordinary assistant']);
  const f = await fixture(t, { request, output: { items: [item([1])] }, classifyFails: true });
  const result = ok(await f.core.capture(request));
  assert.equal(result.classification.status, 'failed');
  assert.deepEqual(f.modelCalls, ['extract', 'classify']);
  assert.equal(detail(f.core, result.admission.memories[0].id).memory.receiptCount, 2);
  assert.equal(ok(await f.core.capture(request)).duplicate, true);
  assert.deepEqual(f.modelCalls, ['extract', 'classify']);
});

test('N4 bind rejects forged empty/subset results and revision/kind races without dropping provenance', sqlite, async t => {
  const request = input(['first user', 'first reply', 'second user', 'second reply']);
  const f = await fixture(t, { request, output: { items: [item([1], 'First canonical statement'),
    item([3], 'Second canonical statement')] } });
  const result = await f.core.capture(request); const captured = ok(result);
  assert.equal(captured.admission.memories.length, 2);
  for (const memories of [[], captured.admission.memories.slice(0, 1)]) {
    const forged = structuredClone(result); forged.value.admission.memories = memories;
    assert.throws(() => f.binding.bind(f.core, forged), /capture-membership-mismatch/);
  }
  const forgedSuppression = structuredClone(result); forgedSuppression.value.admission.suppressedCount = 2;
  assert.throws(() => f.binding.bind(f.core, forgedSuppression), /capture-membership-mismatch/);
  let changed = false;
  const racing = { ...f.core, get(args) {
    if (!changed) {
      changed = true;
      const saved = detail(f.core, captured.admission.memories[0].id);
      ok(f.core.correct({ namespace, memoryId: saved.memory.id, expectedRevision: saved.memory.revision,
        content: saved.memory.content, kind: 'preference', receipt: { client: 'manual', sessionId: 'manual',
          eventId: 'kind-correction', role: 'user', excerpt: 'A synthetic kind correction' } }));
    }
    return f.core.get(args);
  } };
  assert.throws(() => f.binding.bind(racing, result), /capture-revision-mismatch/);
  assert.throws(() => f.binding.bind(f.core, result), /capture-membership-mismatch/);
});

test('N4/N7 only authoritative suppressed-item accounting permits omitted provenance', sqlite, async t => {
  const request = input(['first user', 'first reply', 'second user', 'second reply']);
  const output = { items: [item([1], 'Forget this canonical statement'), item([3], 'Keep this canonical statement')] };
  const f = await fixture(t, { request, output });
  const first = ok(await f.core.capture(request));
  const forgotten = detail(f.core, first.admission.memories[0].id);
  ok(f.core.forget({ namespace, memoryId: forgotten.memory.id, expectedRevision: forgotten.memory.revision }));
  const nextRequest = { ...request, eventId: 'new-batch-with-suppression' };
  const binding = createNeighborSourceBinding(nextRequest, { countTokens: f.model.countTokens });
  const writer = f.open({ model: { ...f.model, extract(wire) {
    f.modelCalls.push('extract'); return binding.transform(wire, output);
  } } });
  const next = await writer.capture(nextRequest);
  assert.equal(ok(next).admission.suppressedCount, 1);
  assert.equal(next.value.admission.memories.length, 1);
  const { sidecar, expectedDigest } = binding.bind(writer, next);
  assert.deepEqual(sidecar.entries.map(row => row.itemIndex), [1, 1]);
  writer.close(); const cold = f.open({});
  const resolved = resolveNeighborSourceBinding(cold, namespace, JSON.parse(JSON.stringify(sidecar)), expectedDigest);
  assert.deepEqual(resolved.rejected, []); assert.equal(resolved.resolved.length, 2);
  assert.equal(cold.get({ namespace, memoryId: forgotten.memory.id }).error.code, 'memory_not_found');
});

test('N1/N3/N5 real nonconstant 1024-token output boundary skips optional index; original 1025 still fails', sqlite, async t => {
  const countTokens = text => {
    assert.equal(typeof text, 'string'); // Counter receives immutable serialized text only.
    const parsed = JSON.parse(text || '{}');
    return parsed.items?.[0]?.sourceIndices
      ? 1023 + parsed.items.reduce((sum, row) => sum + row.sourceIndices.length, 0)
      : Math.ceil(text.length / 8);
  };
  const request = input(['Ordinary prior user consideration.', 'Ordinary assistant recommendation.']);
  const output = { items: [item([1])] };
  assert.equal(countTokens(JSON.stringify(output)), 1024);
  assert.equal(countTokens(JSON.stringify({ items: [item([1, 0])] })), 1025);
  for (const enabled of [false, true]) {
    const f = await fixture(t, { request, output, enabled, countTokens });
    assert.equal(f.model.countTokens, countTokens);
    const result = await f.core.capture(request);
    assert.equal(ok(result).classification.status, 'applied');
    const { sidecar, expectedDigest } = f.binding.bind(f.core, result);
    assert.deepEqual(sidecar.entries.map(row => row.windowIndex), [1]);
    assert.equal(sidecar.counts.added, 0);
    assert.equal(sidecar.diagnostics[0].reason, enabled ? 'output-cap' : 'disabled');
    f.core.close(); const cold = f.open({});
    const resolved = resolveNeighborSourceBinding(cold, namespace, sidecar, expectedDigest);
    assert.deepEqual(resolved.rejected, []);
    assert.deepEqual(resolved.resolved.map(row => row.receipt.excerpt), [request.messages[1].content]);
    assert.deepEqual(f.modelCalls, ['extract', 'classify']);
  }
  const invalid = await fixture(t, { request, output: { items: [item([1, 0])] }, countTokens });
  const rejected = await invalid.core.capture(request);
  assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'invalid_model_output');
  assert.equal(ok(invalid.core.list({ namespace })).memories.length, 0);
  assert.deepEqual(invalid.modelCalls, ['extract']); assert.equal(invalid.binding.summary(), null);
});

test('N1/N3/N5 real 40000-character raw output boundary preserves anchors; original overflow is not normalized away', sqlite, async t => {
  const request = input(['Ordinary prior context.', 'Ordinary selected reply.']);
  const output = { items: [0, 1, 2].map(index => item([1], `Statement ${index}` + ' '.repeat(12_500))) };
  output.items[2].content += ' '.repeat(40_000 - JSON.stringify(output).length);
  assert.equal(JSON.stringify(output).length, 40_000);
  const countTokens = text => Math.ceil(text.length / 100);
  for (const enabled of [false, true]) {
    const f = await fixture(t, { request, output, enabled, countTokens });
    const result = await f.core.capture(request);
    assert.equal(ok(result).classification.status, 'applied');
    const { sidecar } = f.binding.bind(f.core, result);
    assert.deepEqual(sidecar.entries.map(row => row.windowIndex), [1, 1, 1]);
    assert.equal(sidecar.counts.added, 0);
    assert.ok(sidecar.diagnostics.every(row => row.reason === (enabled ? 'output-cap' : 'disabled')));
    assert.deepEqual(f.modelCalls, ['extract', 'classify']);
  }
  const over = structuredClone(output); over.items[0].content += ' ';
  assert.equal(JSON.stringify(over).length, 40_001);
  const invalid = await fixture(t, { request, output: over, countTokens });
  const rejected = await invalid.core.capture(request);
  assert.equal(rejected.ok, false); assert.equal(rejected.error.code, 'invalid_model_output');
  assert.equal(ok(invalid.core.list({ namespace })).memories.length, 0);
  assert.deepEqual(invalid.modelCalls, ['extract']);
});

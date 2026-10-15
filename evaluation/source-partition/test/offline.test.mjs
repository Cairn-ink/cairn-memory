import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../core/contract.mjs';
import { captureSnapshot } from '../../../core/capture-input.mjs';
import { extractionRequest } from '../../../core/capture.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { prepareSourcePartition, verifySourcePartition, SOURCE_PARTITION_POLICY } from '../offline.mjs';
import { messages21, sourceInput, sixFacts, boundaryStatements } from '../fixtures.mjs';

function fixture(t, countTokens = () => 1) {
  const workspace = createTestWorkspace(t, { prefix: 'synthetic-source-partition-' });
  let modelCalls = 0;
  const forbidden = () => { modelCalls++; assert.fail('Planning must not dispatch a model'); };
  const core = openMemoryCore({ path: join(workspace.path, 'memory.sqlite'),
    captureSourcePolicy: SOURCE_PARTITION_POLICY,
    model: { contextWindow: 8192, countTokens, extract: forbidden, classify: forbidden } });
  workspace.defer(() => core.close());
  return { core, countTokens, calls: () => modelCalls };
}
const clone = value => structuredClone(value);
const reject = (fn, code) => assert.throws(fn, error => error.code === code);

test('SP planning binds 21 actual windows as 20+1 without losing repeated coordinates', t => {
  const f = fixture(t), input = sourceInput(messages21()), original = clone(input);
  const plan = prepareSourcePartition({ ...f, input });
  assert.deepEqual(input, original);
  assert.deepEqual(plan.input, original);
  assert.deepEqual(plan.originalBatches.map(part => part.windowCount), [21]);
  assert.deepEqual(plan.partitions.map(part => part.windowCount), [20, 1]);
  assert.deepEqual(plan.partitions.flatMap(part => part.messages), original.sources[0].messages);
  assert.deepEqual(plan.partitions.flatMap(part => part.origins), plan.origins);
  assert.equal(new Set(plan.partitions.map(part => part.eventId)).size, 2);
  assert.equal(plan.origins[0].excerpt, plan.origins[20].excerpt);
  assert.notEqual(plan.origins[0].messageId, plan.origins[20].messageId);
  assert.equal(plan.partitions[1].origins[0].originalMessageIndex, 20);
  for (const part of plan.partitions) {
    const request = extractionRequest(captureSnapshot(part, undefined, SOURCE_PARTITION_POLICY),
      { captureSourcePolicy: SOURCE_PARTITION_POLICY });
    const originalOffset = part.origins[0].originalMessageIndex;
    for (const entry of request.catalog.entries) {
      const bound = part.origins[entry.index]; // Local window index is array position, not origin position.
      assert.equal(bound.originalMessageIndex, originalOffset + entry.messageIndex);
      assert.deepEqual([bound.messageId, bound.role, bound.startUtf16, bound.endUtf16, bound.excerpt],
        [entry.id, entry.role, entry.start, entry.end, entry.content]);
    }
  }
  assert.equal(plan.semanticCoverage, 'unassessed');
  assert.ok(Object.isFrozen(plan.input.sources[0].messages[0]));
  assert.ok(Object.isFrozen(plan.partitions[1].origins[0]));
  assert.deepEqual(verifySourcePartition({ ...f, input, plan }), plan);
  assert.equal(f.calls(), 0);
});

test('SP uses actual UTF16-safe windows, not message count or ceil(length/800)', t => {
  const f = fixture(t), ascii = 'a'.repeat(4000), astral = 'a'.repeat(799) + '🧭' + 'a'.repeat(3199);
  assert.equal(astral.length, 4000);
  const plan = prepareSourcePartition({ ...f, input: sourceInput([
    { id: 'synthetic-ascii', role: 'user', content: ascii },
    { id: 'synthetic-astral', role: 'assistant', content: astral },
  ]) });
  assert.deepEqual(plan.origins.filter(origin => origin.messageId === 'synthetic-ascii').length, 5);
  const windows = plan.origins.filter(origin => origin.messageId === 'synthetic-astral');
  assert.equal(windows.length, 6);
  assert.equal(windows[0].endUtf16, 799);
  assert.equal(windows[1].startUtf16, 799);
  assert.equal(windows.map(window => window.excerpt).join(''), astral);
  assert.ok(windows.every(window => window.excerpt.isWellFormed()));
  reject(() => prepareSourcePartition({ ...f, input: sourceInput([
    { id: 'synthetic-too-long', role: 'user', content: 'a'.repeat(4001) },
  ]) }), 'invalid_input');
  assert.equal(f.calls(), 0);
});

test('SP preserves original session/batch/date boundaries and deterministic events', t => {
  const f = fixture(t), input = sourceInput(messages21().slice(0, 19));
  const second = sourceInput(messages21().slice(19), {
    baseEventId: 'synthetic-original-second', sessionId: 'synthetic-session-second',
    batchId: 'synthetic-batch-second', date: '2026-10-04',
  });
  input.sources.push(second.sources[0]);
  const plan = prepareSourcePartition({ ...f, input });
  assert.deepEqual(plan.partitions.map(part => [part.groupIndex, part.windowCount]), [[0, 19], [1, 2]]);
  assert.deepEqual(plan.partitions[1].origins.map(origin => origin.originalMessageIndex), [0, 1]);
  assert.equal(plan.partitions[1].origins[0].sessionId, 'synthetic-session-second');
  assert.equal(plan.partitions[1].origins[0].date, '2026-10-04'); // Sidecar, not a core date field.
  assert.deepEqual(prepareSourcePartition({ ...f, input }), plan);
  assert.equal(f.calls(), 0);
});

test('SP separates extraction token fit from window fit and rejects an unfit singleton', t => {
  const f = fixture(t, text => text.length);
  const input = sourceInput(['a', 'b'].map((letter, index) => ({
    id: 'synthetic-large-' + index, role: 'user', content: letter.repeat(4000),
  })));
  const plan = prepareSourcePartition({ ...f, input });
  assert.equal(plan.originalBatches[0].windowCount, 10);
  assert.equal(plan.originalBatches[0].extractionFits, false);
  assert.ok(plan.originalBatches[0].extractionTokens > 6000);
  assert.deepEqual(plan.partitions.map(part => part.windowCount), [5, 5]);
  assert.ok(plan.partitions.every(part => part.extractionTokens <= 6000));
  const heavy = fixture(t, text => text.length * 2);
  reject(() => prepareSourcePartition({ ...heavy, input: sourceInput(input.sources[0].messages.slice(0, 1)) }),
    'diagnostic_message_unfit');
  reject(() => prepareSourcePartition({ ...f, countTokens: () => 1, input }), 'diagnostic_counter_mismatch');
  assert.equal(f.calls() + heavy.calls(), 0);
});

test('SP rejects malformed descriptors and compensated sparse arrays without invoking getters', t => {
  const f = fixture(t);
  let getters = 0;
  const accessor = sourceInput(messages21());
  Object.defineProperty(accessor.sources[0].messages[0], 'content', { enumerable: true,
    get() { getters++; return 'secret'; } });
  reject(() => prepareSourcePartition({ ...f, input: accessor }), 'diagnostic_input_invalid');
  const sparse = sourceInput(messages21());
  delete sparse.sources[0].messages[1];
  sparse.sources[0].messages.extra = sparse.sources[0].messages[0];
  reject(() => prepareSourcePartition({ ...f, input: sparse }), 'diagnostic_input_invalid');
  const extra = sourceInput(messages21()); extra.sources[0].messages[0].unexpected = true;
  reject(() => prepareSourcePartition({ ...f, input: extra }), 'diagnostic_input_invalid');
  const changed = sourceInput(messages21()); changed.sources[0].messages[0].content = '  changed whitespace  ';
  reject(() => prepareSourcePartition({ ...f, input: changed }), 'diagnostic_source_not_canonical');
  assert.equal(getters, 0);
  assert.equal(f.calls(), 0);
});

test('SP verification rejects source and plan tampering before any dispatch', t => {
  const f = fixture(t), input = sourceInput(messages21()), plan = prepareSourcePartition({ ...f, input });
  const edits = [
    value => { value.sources[0].messages[0].id = 'synthetic-changed-id'; },
    value => { value.sources[0].messages[0].content = 'SYNTHETIC changed text.'; },
    value => { value.sources[0].messages[0].role = 'assistant'; },
    value => { value.sources[0].date = '2026-10-05'; },
    value => { value.sources[0].messages.reverse(); },
    value => { value.sources[0].messages.pop(); },
  ];
  for (const edit of edits) {
    const changed = clone(input); edit(changed);
    reject(() => verifySourcePartition({ ...f, input: changed, plan }), 'diagnostic_plan_invalid');
  }
  const duplicate = clone(input); duplicate.sources[0].messages[1].id = duplicate.sources[0].messages[0].id;
  reject(() => verifySourcePartition({ ...f, input: duplicate, plan }), 'invalid_input');
  for (const edit of [
    value => { value.partitions[0].origins[0].originalMessageIndex = -0; },
    value => { value.partitions[1].origins[0].originalMessageIndex = 0; },
    value => { value.partitions[1].origins[0].startUtf16 = 1; },
    value => { value.partitions[1].eventId = value.partitions[0].eventId; },
    value => { value.partitions[1].windowCount = 20; },
    value => { value.origins.pop(); },
  ]) {
    const changed = clone(plan); edit(changed);
    reject(() => verifySourcePartition({ ...f, input, plan: changed }),
      Object.is(changed.partitions[0].origins[0].originalMessageIndex, -0)
        ? 'diagnostic_input_invalid' : 'diagnostic_plan_invalid');
  }
  assert.equal(f.calls(), 0);
});

test('SP supported group cardinality roundtrips; expanded plans retain the input traversal bound', t => {
  const f = fixture(t), input = sourceInput(messages21());
  input.sources = Array.from({ length: 64 }, (_, group) => sourceInput(
    Array.from({ length: 24 }, (_, index) => ({ id: 'synthetic-max-' + group + '-' + index,
      role: index % 2 ? 'assistant' : 'user', content: 'SYNTHETIC maximum group cardinality.' })),
    { baseEventId: 'synthetic-max-event-' + group, sessionId: 'synthetic-max-session-' + group,
      batchId: 'synthetic-max-batch-' + group }).sources[0]);
  const plan = prepareSourcePartition({ ...f, input });
  assert.equal(plan.input.sources.length, 64);
  assert.equal(plan.origins.length, 64 * 24);
  assert.deepEqual(verifySourcePartition({ ...f, input, plan }), plan);
  const expanded = sourceInput(messages21());
  expanded.sources[0].date = 'x'.repeat(3 * 1024 * 1024);
  // Input traversal fits; duplicate sidecars in generated origins do not. The
  // publisher must refuse BEFORE serializing the large full origin union.
  const stringify = JSON.stringify;
  let originSerializations = 0;
  JSON.stringify = function(value, ...args) {
    if (Array.isArray(value) && value.some(item => item && typeof item === 'object'
      && Object.hasOwn(item, 'date') && Object.hasOwn(item, 'groupIndex')
      && Object.hasOwn(item, 'originalMessageIndex'))) {
      originSerializations++;
      throw new Error('origin_serialization_before_bound');
    }
    // Actual core snapshot/planner/digest arrays do not contain origin records.
    return Reflect.apply(stringify, JSON, [value, ...args]);
  };
  try {
    reject(() => prepareSourcePartition({ ...f, input: expanded }), 'diagnostic_input_invalid');
    assert.equal(originSerializations, 0);
  } finally { JSON.stringify = stringify; }
  const sameId = sourceInput(messages21().slice(0, 1));
  sameId.sources.push(sourceInput(messages21().slice(0, 1), {
    baseEventId: 'synthetic-other-event', sessionId: 'synthetic-other-session',
    batchId: 'synthetic-other-batch',
  }).sources[0]);
  reject(() => prepareSourcePartition({ ...f, input: sameId }), 'diagnostic_input_invalid');
  assert.equal(f.calls(), 0);
});

test('SP authoritative planning is detached before an await; semantics remain unassessed', async t => {
  const f = fixture(t), input = sourceInput(messages21()), plan = prepareSourcePartition({ ...f, input });
  const submitted = verifySourcePartition({ ...f, input, plan });
  await Promise.resolve();
  input.sources[0].messages[0].content = 'SYNTHETIC caller changed bytes.';
  input.sources[0].date = 'changed sidecar';
  assert.equal(submitted.input.sources[0].messages[0].content, plan.input.sources[0].messages[0].content);
  assert.equal(submitted.input.sources[0].date, '2026-10-03');
  const dense = prepareSourcePartition({ ...f, input: sourceInput([
    { id: 'synthetic-dense', role: 'user', content: sixFacts.join(' ') },
  ]) });
  assert.equal(dense.origins.length, 1);
  assert.equal(dense.semanticCoverage, 'unassessed'); // Six facts / five cards capture is deferred, not established here.
  const boundary = prepareSourcePartition({ ...f, input: sourceInput(boundaryStatements.map((content, index) =>
    ({ id: 'synthetic-boundary-' + index, role: index ? 'assistant' : 'user', content }))) });
  assert.deepEqual(boundary.input.sources[0].messages.map(message => message.content), [...boundaryStatements]);
  assert.equal(f.calls(), 0);
});

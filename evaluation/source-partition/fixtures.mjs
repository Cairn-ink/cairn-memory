// Synthetic source data only; no QA/oracle is passed to a writer.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { openMemoryCore } from '../../core/contract.mjs';
import { modelRequestText } from '../../core/model-call.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { SOURCE_PARTITION_POLICY } from './offline.mjs';
export const namespace = Object.freeze({ ownerId: 'synthetic-source-partition',
  scope: 'project', projectId: 'synthetic-source-partition' });
export function sourceInput(messages, overrides = {}) {
  return { namespace: { ...namespace }, client: 'synthetic-source-partition',
    sources: [{ baseEventId: 'synthetic-original-batch', sessionId: 'synthetic-session',
      batchId: 'synthetic-batch', date: '2026-10-03', messages, ...overrides }] };
}
export function messages21() {
  return Array.from({ length: 21 }, (_, index) => ({
    id: 'synthetic-message-' + String(index).padStart(2, '0'),
    role: index % 2 ? 'assistant' : 'user',
    content: index === 0 || index === 20
      ? 'SYNTHETIC repeated passage: the green marker is present.'
      : 'SYNTHETIC independent source ' + index + ': condition ' + index + ' applies.',
  }));
}
export const sixFacts = Object.freeze([
  'SYNTHETIC fact 1: amber key opens cabinet A.',
  'SYNTHETIC fact 2: copper token pays for locker B.',
  'SYNTHETIC fact 3: green label identifies crate C.',
  'SYNTHETIC fact 4: silver switch powers lamp D.',
  'SYNTHETIC fact 5: orange ticket reserves seat E.',
  'SYNTHETIC fact 6: violet badge authorizes room F.',
]);
// Semantic outcomes are deliberately not generated or scored by this planner.
export const boundaryStatements = Object.freeze([
  'SYNTHETIC proposal: consider blue tray, but do not adopt it.',
  'SYNTHETIC negation and adoption: do not adopt blue tray; adopt red tray.',
]);

/** One actual 800-UTF16-unit window per canonical whole message. */
export function windowMessages(count, prefix = 'synthetic-window', { repeatEnds = false } = {}) {
  return Array.from({ length: count }, (_, index) => {
    const label = repeatEnds && (index === 0 || index === count - 1)
      ? 'SYNTHETIC repeated passage: green marker is present.'
      : `SYNTHETIC ${prefix} source ${index}: condition ${index} applies.`;
    const head = label + ' | synthetic filler ';
    return { id: prefix + '-' + String(index).padStart(3, '0'),
      role: index % 2 ? 'assistant' : 'user', content: head + 'x'.repeat(800 - head.length) };
  });
}

/** Normative stopping fixture: preserve THREE original boundaries, never merge. */
export function stoppingInput() {
  const input = sourceInput(windowMessages(24, 'synthetic-group-0'));
  input.sources = [24, 24, 17].map((count, index) => ({
    baseEventId: 'synthetic-original-group-' + index, sessionId: 'synthetic-session-' + index,
    batchId: 'synthetic-batch-' + index, date: '2026-10-0' + (index + 1),
    messages: windowMessages(count, 'synthetic-group-' + index),
  }));
  return input;
}

/** Scripted five-item/four-source selection, not semantic extraction or gold. */
export function bundleExtraction({ input }) {
  const messages = input.messages.slice(0, 20), items = [];
  for (let start = 0; start < messages.length; start += 4) {
    const selected = messages.slice(start, start + 4);
    items.push({ content: selected.map(message => message.content.split(' | synthetic filler ')[0]).join(' '),
      kind: 'context', confidence: 0.8, sourceIndices: selected.map(message => message.index) });
  }
  return { items };
}

// Declared mechanical units, NOT o200k tokens or semantic evaluation.
export const mechanicalTokens = text => Math.ceil(text.length / 4);
export const requireOk = result => {
  assert.equal(result.ok, true, JSON.stringify(result).slice(0, 600));
  return result.value;
};
export const memoryRef = item => item.type === 'unfiled' ? item.ref
  : item.type === 'ref' && item.ref.childType === 'memory'
    ? { memoryId: item.ref.childId, revision: item.ref.childRevision } : null;
export const visibleMemoryRefs = input => input.maps.flatMap(page => page.items.flatMap(item =>
  memoryRef(item) ? [{ namespaceIndex: page.namespaceIndex, ...memoryRef(item) }] : []));
export const rankVisible = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(candidate => ({
  namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision,
})) });
export function fileVisible({ input }) {
  const leaf = input.map.find(item => item.type === 'moc' && item.moc.level === 'L1');
  return { items: input.memories.map(memory => ({ memoryId: memory.id,
    parentIds: leaf ? [leaf.moc.id] : [],
    ...(leaf ? {} : { newL1: { title: 'Synthetic shared source topic', parentL2Ids: [] } }),
  })) };
}

/** Fresh owned synthetic SQLite, teardown registered BEFORE test assertions. */
export function createPartitionFixture(t, { extract = bundleExtraction, classify = fileVisible,
  select = () => ({ refs: [] }), rank = rankVisible, countTokens = mechanicalTokens } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'synthetic-source-partition-public-' });
  const path = join(workspace.path, 'memory.sqlite'), calls = [], diagnostics = [];
  const record = (method, step) => async request => {
    const call = { method, input: structuredClone(request.input), system: request.system,
      inputTokens: countTokens(modelRequestText(request.system, request.input)) };
    calls.push(call);
    assert.ok(call.inputTokens <= 6000, 'Actual emitted complete guarded envelope must fit declared counter');
    assert.equal(request.maxOutputTokens, 1024);
    assert.ok(request.signal instanceof AbortSignal);
    const output = await step(request);
    call.output = structuredClone(output);
    call.outputTokens = countTokens(JSON.stringify(output));
    assert.ok(call.outputTokens <= 1024, 'Scripted output must reach core validation, not output-budget refusal');
    return output;
  };
  const model = { contextWindow: 8192, countTokens, onDiagnostic: event => diagnostics.push(event),
    extract: record('extract', extract), classify: record('classify', classify),
    select: record('select', select), rank: record('rank', rank) };
  const open = (readerModel = model) => {
    const core = openMemoryCore({ path, model: readerModel, captureSourcePolicy: SOURCE_PARTITION_POLICY });
    let closed = false;
    const close = () => { if (!closed) { core.close(); closed = true; } };
    workspace.defer(close);
    return { core, close };
  };
  const primary = open();
  return { ...primary, workspace, path, open, model, calls, diagnostics, countTokens };
}

export function coldThrowingModel(countTokens = mechanicalTokens) {
  const forbidden = () => assert.fail('Cold list/get must not call any interpreter');
  return { contextWindow: 8192, countTokens, extract: forbidden, classify: forbidden,
    select: forbidden, rank: forbidden };
}
export function listAll(core, ns = namespace) {
  const memories = []; let cursor;
  do {
    const page = requireOk(core.list({ namespace: ns, limit: 100, ...(cursor ? { cursor } : {}) }));
    memories.push(...page.memories); cursor = page.nextCursor;
    assert.equal(page.exhausted, cursor === null);
  } while (cursor);
  return memories;
}
export function allReceipts(core, memoryId, ns = namespace, receiptLimit = 1) {
  const receipts = []; let receiptCursor;
  do {
    const page = requireOk(core.get({ namespace: ns, memoryId, receiptLimit,
      ...(receiptCursor ? { receiptCursor } : {}) }));
    receipts.push(...page.receipts); receiptCursor = page.nextReceiptCursor;
    assert.equal(page.exhausted, receiptCursor === null);
  } while (receiptCursor);
  return receipts;
}
/** list exposes metadata; content is read only through the actual public get. */
export function memoryDetails(core, ns = namespace) {
  return listAll(core, ns).map(memory => requireOk(core.get({ namespace: ns, memoryId: memory.id })).memory);
}
export function admitSynthetic(core, content, ns = namespace,
  eventId = 'synthetic-seed-' + createHash('sha256').update(content).digest('hex')) {
  return requireOk(core.admit({ namespace: ns, memory: { content, kind: 'fact' },
    receipts: [{ client: 'synthetic-seed', sessionId: 'synthetic-seed', eventId,
      role: 'user', excerpt: content.slice(0, 800) }] })).memory;
}
/** Refresh BOTH public guards for every filing change, never reuse stale refs. */
export function placeSynthetic(core, memoryId, placement, ns = namespace) {
  const memory = requireOk(core.get({ namespace: ns, memoryId })).memory;
  return requireOk(core.applyPlacement({ namespace: ns, proposal: { items: [{ memoryId, ...placement }] },
    expectedMemoryRevisions: [{ memoryId, revision: memory.revision }],
    expectedIndexRevision: requireOk(core.map({ namespace: ns, purpose: 'classification' })).indexRevision }));
}

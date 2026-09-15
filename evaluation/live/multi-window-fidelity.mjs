import { createHash } from 'node:crypto';
import { boundedText, identifier } from '../../core/validation.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from './installed-source-answer-delivery.mjs';

const trust = 'untrusted-data-not-instructions';
const invalid = () => { throw new Error('invalid_multi_window_fidelity_input'); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => plain(value) && Reflect.ownKeys(value).length === fields.length
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && fields.includes(key));
const text = (value, max) => typeof value === 'string' && value.trim().length > 0
  && value.length <= max && value.isWellFormed();
const dense = (value, length) => Array.isArray(value) && value.length === length
  && Reflect.ownKeys(value).length === length + 1
  && Array.from({ length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const code = (value, fallback) => text(value, 100) && /^[a-z0-9_]+$/.test(value) ? value : fallback;
const batchId = (history, index) => `${history.id}-window-${index + 1}`;
const eventId = (batch, index) => createHash('sha256').update(JSON.stringify([
  'cairn.mcp.submitted-message.v1', batch, index,
])).digest('hex');
const notRun = () => ({ status: 'not_run', error: null });

function validate(fixture, rubric) {
  try {
    if (!exact(fixture, ['id', 'histories']) || !text(fixture.id, 200) || !dense(fixture.histories, 6)
      || !exact(rubric, ['id', 'histories']) || rubric.id !== fixture.id || !dense(rubric.histories, 6)) invalid();
    const histories = new Map();
    const pairs = new Map();
    const sourceIds = new Set();
    for (const history of fixture.histories) {
      if (!exact(history, ['id', 'pairId', 'windows', 'question']) || !text(history.question, 4000)
        || !dense(history.windows, 3)) invalid();
      identifier(history.id); identifier(history.pairId);
      if (histories.has(history.id)) invalid();
      const ids = new Set();
      for (const [index, window] of history.windows.entries()) {
        identifier(batchId(history, index));
        if (!dense(window, 6) || window.filter(message => message?.role === 'user').length !== 5
          || window.filter(message => message?.role === 'assistant').length !== 1) invalid();
        for (const message of window) {
          if (!exact(message, ['id', 'role', 'content']) || !text(message.content, 800)
            || boundedText(message.content, 800) !== message.content) invalid();
          identifier(message.id);
          if (ids.has(message.id) || sourceIds.has(message.id)) invalid();
          ids.add(message.id);
          sourceIds.add(message.id);
        }
      }
      histories.set(history.id, history);
      const pair = pairs.get(history.pairId) ?? [];
      pair.push(history); pairs.set(history.pairId, pair);
    }
    if (pairs.size !== 3) invalid();
    const changedSources = new Map();
    for (const pair of pairs.values()) {
      if (pair.length !== 2 || pair[0].question !== pair[1].question) invalid();
      const first = pair[0].windows.flat();
      const second = pair[1].windows.flat();
      const differences = first.flatMap((message, index) => {
        if (message.role !== second[index].role) invalid();
        return message.content === second[index].content ? [] : [index];
      });
      if (differences.length !== 1 || first[differences[0]].role !== 'user') invalid();
      pair.forEach(history => changedSources.set(history.id, history.windows.flat()[differences[0]].id));
    }
    const labels = new Map();
    for (const label of rubric.histories) {
      if (!exact(label, ['id', 'requiredSourceIds', 'irrelevantSourceIds', 'qualifierSourceId', 'qualifierQuote',
        'expectedCommitment', 'actor', 'reason', 'temporalLimit']) || !histories.has(label.id) || labels.has(label.id)
        || ['qualifierQuote', 'expectedCommitment', 'actor', 'reason', 'temporalLimit'].some(field => !text(label[field], 800))
        || !['provisional', 'committed'].includes(label.expectedCommitment)) invalid();
      const sources = histories.get(label.id).windows.flat();
      for (const field of ['requiredSourceIds', 'irrelevantSourceIds']) {
        if (!Array.isArray(label[field]) || label[field].length > 18 || !dense(label[field], label[field].length)
          || label[field].some(id => !sources.some(source => source.id === id))) invalid();
      }
      const all = [...label.requiredSourceIds, ...label.irrelevantSourceIds];
      if (new Set(all).size !== all.length || !label.requiredSourceIds.includes(label.qualifierSourceId)
        || label.qualifierSourceId !== changedSources.get(label.id)) invalid();
      const source = sources.find(source => source.id === label.qualifierSourceId);
      if (!source.content.includes(label.qualifierQuote)
        || sources.reduce((count, source) => count + source.content.split(label.qualifierQuote).length - 1, 0) !== 1) invalid();
      labels.set(label.id, structuredClone(label));
    }
    for (const pair of pairs.values()) {
      if (new Set(pair.map(history => labels.get(history.id).expectedCommitment)).size !== 2) invalid();
    }
    return { fixture: structuredClone(fixture), labels };
  } catch { invalid(); }
}

function coverage(sources, label) {
  const ids = new Set(sources.map(source => source.id));
  return { requiredSourceIds: [...label.requiredSourceIds],
    presentSourceIds: label.requiredSourceIds.filter(id => ids.has(id)),
    missingSourceIds: label.requiredSourceIds.filter(id => !ids.has(id)),
    irrelevantPresentSourceIds: label.irrelevantSourceIds.filter(id => ids.has(id)),
    qualifierPresent: sources.some(source => source.id === label.qualifierSourceId && source.content.includes(label.qualifierQuote)),
    semanticStatus: 'unassessed' };
}

async function call(client, name, args) {
  try {
    const response = await client.callTool({ name, arguments: structuredClone(args) });
    if (!plain(response) || !dense(response.content, 1) || response.content[0]?.type !== 'text'
      || typeof response.content[0].text !== 'string' || Buffer.byteLength(response.content[0].text, 'utf8') > 262144) throw new Error();
    const envelope = JSON.parse(response.content[0].text);
    if (envelope?.evidenceTrust !== trust || typeof envelope.ok !== 'boolean'
      || Boolean(response.isError) !== !envelope.ok) throw new Error();
    if (!envelope.ok) {
      // A rejected snapshot must not smuggle partial evidence in an error envelope.
      if (!exact(envelope, ['ok', 'error', 'evidenceTrust']) || !exact(envelope.error, ['code', 'retryable'])
        || typeof envelope.error.retryable !== 'boolean') throw new Error();
      return { status: 'failed', error: { code: code(envelope.error.code, 'tool_failed') } };
    }
    return { status: 'completed', value: envelope.value, error: null };
  } catch { return { status: 'failed', error: { code: 'invalid_tool_result' } }; }
}

function sourceBindings(history, windowIndex) {
  const byEvent = new Map();
  history.windows.slice(0, windowIndex + 1).forEach((window, index) => window.forEach((source, position) => {
    byEvent.set(eventId(batchId(history, index), position), source);
  }));
  return byEvent;
}

function canonicalSource(receipt, byEvent) {
  const source = byEvent.get(receipt.eventId);
  if (!source || receipt.role !== source.role || receipt.excerpt !== source.content) throw new Error();
  return { ...source };
}

async function admittedSnapshot(client, byEvent) {
  const result = { status: 'failed', records: [], sources: [], activeCount: null, error: { code: 'invalid_admitted_snapshot' } };
  const memories = [];
  const ids = new Set();
  const cursors = new Set();
  const receiptIds = new Set();
  let cursor;
  try {
    for (let page = 0; ; page++) {
      if (page >= 3 || (cursor && cursors.has(cursor))) throw new Error();
      if (cursor) cursors.add(cursor);
      const observed = await call(client, 'inspect_memory', { limit: 50, ...(cursor ? { cursor } : {}) });
      if (observed.status !== 'completed') return { ...result, error: observed.error };
      const body = observed.value;
      if (!Array.isArray(body?.memories) || body.memories.length > 50) throw new Error();
      for (const memory of body.memories) {
        identifier(memory.id);
        if (ids.has(memory.id) || !Number.isSafeInteger(memory.revision) || memory.revision < 1
          || !['active', 'historical'].includes(memory.state)) throw new Error();
        ids.add(memory.id); memories.push(memory);
        if (memories.length > 128) throw new Error();
      }
      cursor = body.nextCursor;
      if ((cursor != null && !text(cursor, 8192)) || body.exhausted !== !cursor) throw new Error();
      if (!cursor) break;
    }
    for (const memory of memories) {
      const receipts = [];
      const used = new Set();
      let receiptCursor;
      let first;
      for (let page = 0; ; page++) {
        if (page >= 2 || (receiptCursor && used.has(receiptCursor))) throw new Error();
        if (receiptCursor) used.add(receiptCursor);
        const observed = await call(client, 'inspect_memory', { memoryId: memory.id, receiptLimit: 50,
          ...(receiptCursor ? { receiptCursor } : {}) });
        if (observed.status !== 'completed') return { ...result, error: observed.error };
        const body = observed.value;
        if (body?.memory?.id !== memory.id || body.memory.revision !== memory.revision || body.memory.state !== memory.state
          || !Array.isArray(body.receipts) || body.receipts.length > 50 || (first && !same(first, body.memory))) throw new Error();
        first ??= body.memory;
        for (const receipt of body.receipts) {
          identifier(receipt.id);
          if (receiptIds.has(receipt.id) || receipt.client !== 'cairn-local-mcp' || receipt.sessionId !== 'submitted-capture') throw new Error();
          receiptIds.add(receipt.id);
          canonicalSource(receipt, byEvent);
          receipts.push({ id: receipt.id, eventId: receipt.eventId, role: receipt.role, excerpt: receipt.excerpt });
        }
        receiptCursor = body.nextReceiptCursor;
        if ((receiptCursor != null && !text(receiptCursor, 8192)) || body.exhausted !== !receiptCursor) throw new Error();
        if (!receiptCursor) break;
      }
      if (first.receiptCount !== receipts.length || receipts.length < 1) throw new Error();
      result.records.push({ memory: { id: memory.id, revision: memory.revision, state: memory.state }, receipts });
    }
    result.sources = result.records.flatMap(record => record.receipts.map(receipt => canonicalSource(receipt, byEvent)));
    result.activeCount = result.records.filter(record => record.memory.state === 'active').length;
    return { ...result, status: 'completed', error: null };
  } catch { return result; }
}

function stageSnapshot(value, history, windowIndex, byEvent) {
  const evidence = value?.evidence;
  if (!exact(evidence, ['state', 'createdAt', 'expiresAt', 'view', 'evidenceTrust']) || evidence.evidenceTrust !== trust
    || !['pending', 'failed', 'admitted', 'discarded', 'expired', 'forgotten'].includes(evidence.state)
    || !text(evidence.createdAt, 40) || !text(evidence.expiresAt, 40)) throw new Error();
  const sources = [];
  if (evidence.view !== null) {
    if (!exact(evidence.view, ['messages', 'retainedSourceWindow']) || !dense(evidence.view.messages, 6)
      || !same(evidence.view.retainedSourceWindow, { maxUnitsPerMessage: 800, truncatedMessageIndices: [] })) throw new Error();
    for (const [index, source] of evidence.view.messages.entries()) {
      if (!exact(source, ['id', 'role', 'content']) || source.id !== eventId(batchId(history, windowIndex), index)) throw new Error();
      sources.push(canonicalSource({ eventId: source.id, role: source.role, excerpt: source.content }, byEvent));
    }
  }
  return { evidence: structuredClone(evidence), sources };
}

function projectionSources(value, admitted, byEvent, snapshot = false) {
  if (!Array.isArray(value?.memories) || value.memories.length > (snapshot ? 12 : 6)
    || value.coverage !== (snapshot ? 'complete-current-admitted' : 'complete')) throw new Error();
  if (snapshot && (value.semanticCoverage !== 'unassessed' || value.evidenceTrust !== trust)) throw new Error();
  const seen = new Set();
  const sources = new Map();
  const active = admitted.records.filter(record => record.memory.state === 'active');
  for (const item of value.memories) {
    if (!exact(item, ['memory', 'receipts', 'receiptCount', 'interpretationStatus', 'sourceSelectionCoverage',
      ...(snapshot ? ['namespaceIndex'] : [])]) || !exact(item.memory, ['id', 'revision', 'currentness'])
      || (snapshot && item.namespaceIndex !== 0) || item.memory.currentness !== 'current'
      || item.interpretationStatus !== 'omitted' || item.sourceSelectionCoverage !== 'unassessed'
      || !Array.isArray(item.receipts) || item.receipts.length > 100 || item.receiptCount !== item.receipts.length
      || seen.has(item.memory.id)) throw new Error();
    seen.add(item.memory.id);
    const record = active.find(record => record.memory.id === item.memory.id);
    if (!record || record.memory.revision !== item.memory.revision || record.receipts.length !== item.receipts.length) throw new Error();
    const receiptIds = new Set();
    for (const receipt of item.receipts) {
      if (!exact(receipt, ['id', 'role', 'excerpt']) || receiptIds.has(receipt.id)) throw new Error();
      receiptIds.add(receipt.id);
      const stored = record.receipts.find(stored => stored.id === receipt.id);
      if (!stored || stored.role !== receipt.role || stored.excerpt !== receipt.excerpt) throw new Error();
      const source = canonicalSource(stored, byEvent);
      sources.set(source.id, source);
    }
  }
  if (snapshot && seen.size !== active.length) throw new Error();
  return [...sources.values()];
}

function classificationSummary(value) {
  if (value?.status === 'applied') return { status: 'applied', error: null };
  if (value?.status === 'skipped' && ['empty', 'already_filed'].includes(value.reason)) {
    return { status: 'skipped', reason: value.reason, error: null };
  }
  if (value?.status === 'failed') return { status: 'failed', error: { code: code(value.error?.code, 'classification_failed') } };
  return null;
}

/** Evaluation-only orchestration. Clients bind each history's namespace; callbacks own execution. */
export async function runMultiWindowFidelity({ fixture, rubric, openClient, answer }) {
  if (typeof openClient !== 'function' || typeof answer !== 'function') invalid();
  const checked = validate(fixture, rubric);
  const report = { version: 1, kind: 'multi-window-fidelity-diagnostic', id: checked.fixture.id,
    status: 'observed', semanticStatus: 'unassessed', histories: [] };
  for (const [historyIndex, history] of checked.fixture.histories.entries()) {
    const label = checked.labels.get(history.id);
    const output = { id: history.id, pairId: history.pairId, status: 'observed',
      captures: history.windows.map((_, windowIndex) => ({ windowIndex, batchId: batchId(history, windowIndex), status: 'not_run',
        capture: { ...notRun(), classification: null }, staged: { ...notRun(), evidence: null, coverage: null },
        admitted: { ...notRun(), records: [], coverage: null, activeCount: null } })),
      activeAdmittedCount: null, beyondSnapshotCap: null,
      snapshot: { ...notRun(), coverage: null, boundary: 'not_observed' },
      recall: { ...notRun(), sources: [], coverage: null },
      answerOrder: historyIndex % 2 === 0 ? ['retrieved', 'canonical-control'] : ['canonical-control', 'retrieved'],
      answers: ['retrieved', 'canonical-control'].map(sourceKind => ({ sourceKind, constructedControl: sourceKind === 'canonical-control',
        ...notRun(), answer: null, semanticStatus: 'unassessed' })), errors: [] };
    report.histories.push(output);
    const note = (operation, errorCode, windowIndex) => {
      output.errors.push({ operation, code: errorCode, ...(windowIndex === undefined ? {} : { windowIndex }) });
      output.status = 'observed-with-failures';
    };
    let client;
    const close = async (phase, windowIndex) => {
      if (!client) return true;
      const current = client; client = null;
      try { await current.close(); return true; }
      catch { note(`close_${phase}`, 'client_close_failed', windowIndex); return false; }
    };
    let halted = false;
    let finalAdmitted;
    for (const capture of output.captures) {
      if (halted) continue;
      const index = capture.windowIndex;
      const byEvent = sourceBindings(history, index);
      try {
        client = await openClient({ historyId: history.id, windowIndex: index, phase: 'capture' });
        const observed = await call(client, 'capture_memory', { batchId: capture.batchId,
          messages: history.windows[index].map(({ role, content }) => ({ role, content })) });
        capture.capture = { status: observed.status, error: observed.error, classification: null };
        if (observed.status === 'completed') {
          const classification = classificationSummary(observed.value?.classification);
          if (observed.value?.duplicate !== false || !Array.isArray(observed.value.admission?.memories)
            || observed.value.admission.memories.length > 5 || !classification
            || !same(observed.value.retainedSourceWindow, { maxUnitsPerMessage: 800, truncatedMessageIndices: [] })) {
            capture.capture = { status: 'failed', error: { code: 'invalid_capture_result' }, classification: null };
          } else {
            capture.capture.classification = classification;
            if (classification.status === 'failed') note('classification', classification.error.code, index);
          }
        }
        if (capture.capture.status === 'failed') note('capture', capture.capture.error.code, index);
      } catch {
        capture.capture = { status: 'failed', error: { code: 'client_open_failed' }, classification: null };
        note('capture', 'client_open_failed', index);
      } finally { if (!await close('capture', index)) halted = true; }
      if (!halted) {
        try {
          client = await openClient({ historyId: history.id, windowIndex: index, phase: 'cold' });
          const observed = await call(client, 'inspect_capture_evidence', { batchId: capture.batchId });
          try {
            if (observed.status !== 'completed') throw new Error();
            const staged = stageSnapshot(observed.value, history, index, byEvent);
            capture.staged = { status: 'completed', error: null, evidence: staged.evidence, coverage: coverage(staged.sources, label) };
          } catch {
            capture.staged.status = 'failed'; capture.staged.error = observed.error ?? { code: 'invalid_staged_snapshot' };
            note('staged', capture.staged.error.code, index); halted = true;
          }
          const admitted = await admittedSnapshot(client, byEvent);
          capture.admitted = { status: admitted.status, error: admitted.error, records: admitted.records,
            activeCount: admitted.activeCount, coverage: admitted.status === 'completed' ? coverage(admitted.sources, label) : null };
          if (admitted.status !== 'completed') { note('admitted', admitted.error.code, index); halted = true; }
          else finalAdmitted = admitted;
        } catch { note('cold', 'client_open_failed', index); halted = true; }
        finally { if (!await close('cold', index)) halted = true; }
      }
      if (capture.capture.status !== 'completed') halted = true;
      capture.status = halted ? 'failed' : 'completed';
    }
    if (!halted && finalAdmitted) {
      output.activeAdmittedCount = finalAdmitted.activeCount;
      output.beyondSnapshotCap = finalAdmitted.activeCount > 12;
    }
    if (!halted && finalAdmitted) {
      const byEvent = sourceBindings(history, 2);
      try {
        client = await openClient({ historyId: history.id, windowIndex: 2, phase: 'read' });
        const observed = await call(client, 'read_memory_sources', { limit: 12 });
        output.snapshot = { status: observed.status, error: observed.error, coverage: null, boundary: 'unexpected' };
        if (observed.status === 'failed' && output.beyondSnapshotCap && observed.error.code === 'context_item_too_large') {
          output.snapshot.boundary = 'expected_over_cap_rejection';
        } else if (observed.status === 'completed') {
          try {
            const sources = projectionSources(observed.value, finalAdmitted, byEvent, true);
            output.snapshot.coverage = coverage(sources, label); output.snapshot.boundary = 'within_cap';
          } catch { output.snapshot.status = 'failed'; output.snapshot.error = { code: 'invalid_snapshot_sources' }; }
        }
        if (output.snapshot.boundary === 'unexpected') note('snapshot', output.snapshot.error?.code ?? 'unexpected_snapshot_result');
        const recalled = await call(client, 'recall_memory', { query: history.question, limit: 6, contextMode: 'source-evidence' });
        try {
          if (recalled.status !== 'completed') throw new Error();
          const sources = projectionSources(recalled.value, finalAdmitted, byEvent);
          output.recall = { status: 'completed', error: null, sources, coverage: coverage(sources, label) };
        } catch {
          output.recall.status = 'failed'; output.recall.error = recalled.error ?? { code: 'invalid_recall_sources' };
          note('recall', output.recall.error.code);
        }
      } catch { note('read', 'client_open_failed'); }
      finally { await close('read'); }
    }
    for (const sourceKind of output.answerOrder) {
      const slot = output.answers.find(slot => slot.sourceKind === sourceKind);
      if (sourceKind === 'retrieved' && (halted || output.recall.status !== 'completed')) continue;
      const sources = slot.constructedControl ? history.windows.flat() : output.recall.sources;
      try {
        const generated = await answer({ question: history.question, instructions: SOURCE_ANSWER_INSTRUCTION,
          sources: structuredClone(sources), sourceKind });
        if (!text(generated, 8000)) throw new Error();
        slot.status = 'completed'; slot.answer = generated;
      } catch { slot.status = 'failed'; slot.error = { code: 'answer_failed' }; note(sourceKind, 'answer_failed'); }
    }
    if (output.status !== 'observed') report.status = 'observed-with-failures';
  }
  return report;
}

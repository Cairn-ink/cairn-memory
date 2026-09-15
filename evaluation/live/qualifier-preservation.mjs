import { createHash } from 'node:crypto';
import { boundedText, identifier } from '../../core/validation.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from './installed-source-answer-delivery.mjs';

const trust = 'untrusted-data-not-instructions';
const invalid = () => { throw new Error('invalid_qualifier_preservation_input'); };
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
const errorCode = (code, fallback) => text(code, 100) && /^[a-z0-9_]+$/.test(code) ? code : fallback;
const eventId = (batchId, index) => createHash('sha256').update(JSON.stringify([
  'cairn.mcp.submitted-message.v1', batchId, index,
])).digest('hex');

function validate(fixture, rubric) {
  try {
    if (!exact(fixture, ['id', 'histories']) || !text(fixture.id, 200) || !dense(fixture.histories, 12)
      || !exact(rubric, ['id', 'histories']) || rubric.id !== fixture.id || !dense(rubric.histories, 12)) invalid();
    const pairs = new Map();
    const histories = new Map();
    for (const history of fixture.histories) {
      if (!exact(history, ['id', 'pairId', 'messages', 'question']) || !text(history.question, 4000)
        || !dense(history.messages, 4)) invalid();
      identifier(history.id); identifier(history.pairId);
      if (histories.has(history.id)) invalid();
      const ids = new Set();
      for (const message of history.messages) {
        if (!exact(message, ['id', 'role', 'content']) || !['user', 'assistant'].includes(message.role)
          || !text(message.content, 800) || boundedText(message.content, 800) !== message.content) invalid();
        identifier(message.id);
        if (ids.has(message.id)) invalid();
        ids.add(message.id);
      }
      histories.set(history.id, history);
      const pair = pairs.get(history.pairId) ?? [];
      pair.push(history); pairs.set(history.pairId, pair);
    }
    if (pairs.size !== 6) invalid();
    const changedSources = new Map();
    for (const pair of pairs.values()) {
      if (pair.length !== 2 || pair[0].question !== pair[1].question) invalid();
      const differences = pair[0].messages.flatMap((message, index) => {
        const other = pair[1].messages[index];
        if (message.role !== other.role) invalid();
        return message.content === other.content ? [] : [index];
      });
      if (differences.length !== 1 || pair[0].messages[differences[0]].role !== 'user') invalid();
      for (const history of pair) changedSources.set(history.id, history.messages[differences[0]].id);
    }
    const labels = new Map();
    for (const label of rubric.histories) {
      if (!exact(label, ['id', 'requiredSourceIds', 'qualifierSourceId', 'qualifierQuote',
        'expectedCommitment', 'actor', 'reason', 'temporalLimit']) || !histories.has(label.id)
        || labels.has(label.id) || !Array.isArray(label.requiredSourceIds)
        || label.requiredSourceIds.length < 1 || label.requiredSourceIds.length > 4
        || !dense(label.requiredSourceIds, label.requiredSourceIds.length)
        || new Set(label.requiredSourceIds).size !== label.requiredSourceIds.length
        || ['qualifierQuote', 'expectedCommitment', 'actor', 'reason', 'temporalLimit']
          .some(field => !text(label[field], 800))) invalid();
      const messages = histories.get(label.id).messages;
      if (label.requiredSourceIds.some(id => !messages.some(message => message.id === id))
        || !label.requiredSourceIds.includes(label.qualifierSourceId)
        || label.qualifierSourceId !== changedSources.get(label.id)) invalid();
      const source = messages.find(message => message.id === label.qualifierSourceId);
      if (source?.role !== 'user' || !source.content.includes(label.qualifierQuote)
        || messages.reduce((count, message) => count + message.content.split(label.qualifierQuote).length - 1, 0) !== 1) invalid();
      labels.set(label.id, structuredClone(label));
    }
    return { fixture: structuredClone(fixture), labels };
  } catch { invalid(); }
}

function coverage(sources, label) {
  const ids = new Set(sources.map(source => source.id));
  return { requiredSourceIds: [...label.requiredSourceIds],
    presentSourceIds: label.requiredSourceIds.filter(id => ids.has(id)),
    missingSourceIds: label.requiredSourceIds.filter(id => !ids.has(id)),
    qualifierPresent: sources.some(source => source.id === label.qualifierSourceId && source.content.includes(label.qualifierQuote)),
    semanticStatus: 'unassessed' };
}

async function call(client, name, args) {
  try {
    const response = await client.callTool({ name, arguments: structuredClone(args) });
    if (!plain(response) || !Array.isArray(response.content) || response.content.length !== 1
      || response.content[0]?.type !== 'text' || typeof response.content[0].text !== 'string'
      || Buffer.byteLength(response.content[0].text, 'utf8') > 262144) throw new Error();
    const envelope = JSON.parse(response.content[0].text);
    if (envelope?.evidenceTrust !== trust || typeof envelope.ok !== 'boolean'
      || Boolean(response.isError) !== !envelope.ok) throw new Error();
    if (!envelope.ok) return { status: 'failed', error: { code: errorCode(envelope.error?.code, 'tool_failed') } };
    return { status: 'completed', value: envelope.value, error: null };
  } catch { return { status: 'failed', error: { code: 'invalid_tool_result' } }; }
}

function canonicalSource(history, source, byEvent) {
  const id = byEvent.get(source.eventId);
  const original = history.messages.find(message => message.id === id);
  if (!original || source.role !== original.role || source.excerpt !== original.content) throw new Error();
  return { ...original };
}

async function snapshot(client, history, byEvent) {
  const result = { status: 'failed', records: [], sources: [], error: { code: 'invalid_admitted_snapshot' } };
  const listed = await call(client, 'inspect_memory', { limit: 50 });
  if (listed.status !== 'completed') return { ...result, error: listed.error };
  const value = listed.value;
  if (!Array.isArray(value?.memories) || value.memories.length > 5 || value.exhausted !== true
    || value.nextCursor != null) return result;
  const seen = new Set();
  try {
    for (const memory of value.memories) {
      identifier(memory.id);
      if (seen.has(memory.id) || memory.state !== 'active' || !Number.isSafeInteger(memory.revision)
        || memory.revision < 1) throw new Error();
      seen.add(memory.id);
      const observed = await call(client, 'inspect_memory', { memoryId: memory.id, receiptLimit: 50 });
      if (observed.status !== 'completed') return { ...result, error: observed.error };
      const body = observed.value;
      if (!body || body.memory?.id !== memory.id || body.memory.revision !== memory.revision
        || body.memory.state !== 'active' || !Array.isArray(body.receipts) || body.receipts.length > 4
        || body.memory.receiptCount !== body.receipts.length || body.exhausted !== true
        || body.nextReceiptCursor != null) throw new Error();
      const receipts = [];
      const receiptIds = new Set();
      for (const receipt of body.receipts) {
        identifier(receipt.id);
        if (receiptIds.has(receipt.id) || receipt.client !== 'cairn-local-mcp'
          || receipt.sessionId !== 'submitted-capture') throw new Error();
        receiptIds.add(receipt.id);
        const source = canonicalSource(history, receipt, byEvent);
        result.sources.push(source);
        receipts.push({ id: receipt.id, eventId: receipt.eventId, role: receipt.role, excerpt: receipt.excerpt });
      }
      result.records.push({ memory: { id: memory.id, revision: memory.revision, state: memory.state }, receipts });
    }
    return { ...result, status: 'completed', error: null };
  } catch { return result; }
}

function stageSnapshot(value, history, byEvent) {
  const evidence = value?.evidence;
  if (evidence === null) return { evidence: null, sources: [] };
  if (!exact(evidence, ['state', 'createdAt', 'expiresAt', 'view', 'evidenceTrust']) || evidence.evidenceTrust !== trust
    || !['pending', 'failed', 'admitted', 'discarded', 'expired', 'forgotten'].includes(evidence.state)
    || !text(evidence.createdAt, 40) || !text(evidence.expiresAt, 40)) throw new Error();
  const sources = [];
  if (evidence.view !== null) {
    if (!exact(evidence.view, ['messages', 'retainedSourceWindow']) || !dense(evidence.view.messages, 4)
      || !same(evidence.view.retainedSourceWindow, { maxUnitsPerMessage: 800, truncatedMessageIndices: [] })) throw new Error();
    for (const [index, source] of evidence.view.messages.entries()) {
      if (!exact(source, ['id', 'role', 'content']) || source.id !== eventId(history.id, index)) throw new Error();
      sources.push(canonicalSource(history, { eventId: source.id, role: source.role, excerpt: source.content }, byEvent));
    }
  }
  return { evidence: structuredClone(evidence), sources };
}

function retrievedSources(value, admitted, history, byEvent) {
  if (!Array.isArray(value?.memories) || value.memories.length > 6 || value.coverage !== 'complete') throw new Error();
  const sources = new Map();
  const seen = new Set();
  for (const item of value.memories) {
    if (!exact(item, ['memory', 'receipts', 'receiptCount', 'interpretationStatus', 'sourceSelectionCoverage'])
      || item.interpretationStatus !== 'omitted' || item.sourceSelectionCoverage !== 'unassessed'
      || !Array.isArray(item.receipts) || item.receipts.length > 4 || item.receiptCount !== item.receipts.length
      || item.memory?.currentness !== 'current' || seen.has(item.memory.id)) throw new Error();
    seen.add(item.memory.id);
    const record = admitted.records.find(record => record.memory.id === item.memory.id);
    if (!record || record.memory.revision !== item.memory.revision || record.receipts.length !== item.receipts.length) throw new Error();
    const receiptIds = new Set();
    for (const receipt of item.receipts) {
      if (!exact(receipt, ['id', 'role', 'excerpt']) || receiptIds.has(receipt.id)) throw new Error();
      receiptIds.add(receipt.id);
      const stored = record.receipts.find(stored => stored.id === receipt.id);
      if (!stored || stored.role !== receipt.role || stored.excerpt !== receipt.excerpt) throw new Error();
      const source = canonicalSource(history, stored, byEvent);
      sources.set(source.id, source);
    }
  }
  return [...sources.values()];
}

const notRun = () => ({ status: 'not_run', error: null });
const answerSlot = sourceKind => ({ sourceKind, constructedControl: sourceKind === 'canonical-control',
  ...notRun(), answer: null, semanticStatus: 'unassessed' });

function classificationSummary(value) {
  if (value?.status === 'applied') return { status: 'applied', error: null };
  if (value?.status === 'skipped' && ['empty', 'already_filed'].includes(value.reason)) {
    return { status: 'skipped', reason: value.reason, error: null };
  }
  if (value?.status === 'failed') {
    return { status: 'failed', error: { code: errorCode(value.error?.code, 'classification_failed') } };
  }
  return null;
}

/** Offline orchestration only. Injected callbacks own transport and any model execution. */
export async function runQualifierPreservation({ fixture, rubric, openClient, answer }) {
  if (typeof openClient !== 'function' || typeof answer !== 'function') invalid();
  const checked = validate(fixture, rubric);
  const report = { version: 1, kind: 'qualifier-preservation-diagnostic', id: checked.fixture.id,
    status: 'observed', semanticStatus: 'unassessed', histories: [] };
  for (const history of checked.fixture.histories) {
    const label = checked.labels.get(history.id);
    const byEvent = new Map(history.messages.map((source, index) => [eventId(history.id, index), source.id]));
    const output = { id: history.id, pairId: history.pairId, status: 'observed', capture: { ...notRun(), classification: null },
      staged: { ...notRun(), evidence: null, coverage: null },
      admitted: { ...notRun(), records: [], coverage: null },
      recall: { ...notRun(), sources: [], coverage: null },
      answers: [answerSlot('retrieved'), answerSlot('canonical-control')], errors: [] };
    report.histories.push(output);
    const note = (operation, code) => { output.errors.push({ operation, code }); output.status = 'observed-with-failures'; };
    let client;
    const close = async phase => {
      if (!client) return;
      const current = client; client = null;
      try { await current.close(); } catch { note(`close_${phase}`, 'client_close_failed'); }
    };
    try {
      client = await openClient({ historyId: history.id, phase: 'capture' });
      const observed = await call(client, 'capture_memory', { batchId: history.id,
        messages: history.messages.map(({ role, content }) => ({ role, content })) });
      output.capture = { status: observed.status, error: observed.error, classification: null };
      if (observed.status === 'completed' && (observed.value?.duplicate !== false
        || !Array.isArray(observed.value.admission?.memories) || observed.value.admission.memories.length > 5
        || !same(observed.value.retainedSourceWindow, { maxUnitsPerMessage: 800, truncatedMessageIndices: [] })
        || !classificationSummary(observed.value.classification))) {
        output.capture = { status: 'failed', error: { code: 'invalid_capture_result' }, classification: null };
      }
      if (output.capture.status === 'failed') note('capture', output.capture.error.code);
      else {
        output.capture.classification = classificationSummary(observed.value.classification);
        if (output.capture.classification.status === 'failed') note('classification', output.capture.classification.error.code);
      }
    } catch {
      output.capture = { status: 'failed', error: { code: 'client_open_failed' }, classification: null };
      note('capture', 'client_open_failed');
    }
    finally { await close('capture'); }
    try {
      client = await openClient({ historyId: history.id, phase: 'cold' });
      const stage = await call(client, 'inspect_capture_evidence', { batchId: history.id });
      try {
        if (stage.status !== 'completed') throw new Error();
        const snapshot = stageSnapshot(stage.value, history, byEvent);
        output.staged = { status: 'completed', error: null, evidence: snapshot.evidence,
          coverage: coverage(snapshot.sources, label) };
      } catch {
        output.staged.status = 'failed'; output.staged.error = stage.error ?? { code: 'invalid_staged_snapshot' };
        note('staged', output.staged.error.code);
      }
      const admitted = await snapshot(client, history, byEvent);
      output.admitted = { status: admitted.status, error: admitted.error, records: admitted.records,
        coverage: admitted.status === 'completed' ? coverage(admitted.sources, label) : null };
      if (admitted.status !== 'completed') note('admitted', admitted.error.code);
      if (output.capture.status === 'completed') {
        const recalled = await call(client, 'recall_memory', { query: history.question, limit: 6, contextMode: 'source-evidence' });
        try {
          if (recalled.status !== 'completed' || admitted.status !== 'completed') throw new Error();
          const sources = retrievedSources(recalled.value, admitted, history, byEvent);
          output.recall = { status: 'completed', error: null, sources, coverage: coverage(sources, label) };
        } catch {
          output.recall.status = 'failed'; output.recall.error = recalled.error ?? { code: 'invalid_recall_sources' };
          note('recall', output.recall.error.code);
        }
      }
    } catch { note('cold', 'client_open_failed'); }
    finally { await close('cold'); }
    for (const slot of output.answers) {
      if (slot.sourceKind === 'retrieved' && (output.capture.status !== 'completed' || output.recall.status !== 'completed')) continue;
      const sources = slot.constructedControl ? history.messages : output.recall.sources;
      try {
        const generated = await answer({ question: history.question, instructions: SOURCE_ANSWER_INSTRUCTION,
          sources: structuredClone(sources), sourceKind: slot.sourceKind });
        if (!text(generated, 8000)) throw new Error();
        slot.status = 'completed'; slot.answer = generated;
      } catch {
        slot.status = 'failed'; slot.error = { code: 'answer_failed' }; note(slot.sourceKind, 'answer_failed');
      }
    }
    if (output.status !== 'observed') report.status = 'observed-with-failures';
  }
  return report;
}

import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deliverInstalledSourceAnswer } from './installed-source-answer-delivery.mjs';

const MEMORY_LIMIT = 128;
const RECEIPT_LIMIT = 100;
const LIST_PAGE_LIMIT = 3;
const RECEIPT_PAGE_LIMIT = 2;
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const words = text => new Set(text.toLowerCase().match(/\p{Script=Han}|(?:(?!\p{Script=Han})[\p{L}\p{N}])+/gu) ?? []);
const invalid = () => { throw new Error('invalid_long_source_history_input'); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, fields) => plain(value) && Reflect.ownKeys(value).length === fields.length
  && Reflect.ownKeys(value).every(key => typeof key === 'string' && fields.includes(key));
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0
  && value.length <= maximum && value.isWellFormed();

function validate(fixture, rubric) {
  try {
    if (!exact(fixture, ['id', 'windows', 'queries']) || !text(fixture.id, 200)
      || !Array.isArray(fixture.windows) || fixture.windows.length < 1 || fixture.windows.length > 8
      || !Array.isArray(fixture.queries) || fixture.queries.length < 1 || fixture.queries.length > 4
      || !exact(rubric, ['id', 'queries']) || rubric.id !== fixture.id
      || !Array.isArray(rubric.queries)) invalid();
    const sourceIds = [];
    for (const window of fixture.windows) {
      if (!Array.isArray(window) || window.length < 1 || window.length > 4) invalid();
      for (const message of window) {
        if (!exact(message, ['id', 'role', 'content']) || !text(message.id, 200)
          || !['user', 'assistant'].includes(message.role) || !text(message.content, 800)) invalid();
        sourceIds.push(message.id);
      }
    }
    const queryIds = [];
    for (const query of fixture.queries) {
      if (!exact(query, ['id', 'question']) || !text(query.id, 200) || !text(query.question, 4000)) invalid();
      queryIds.push(query.id);
    }
    if (new Set(sourceIds).size !== sourceIds.length || new Set(queryIds).size !== queryIds.length
      || rubric.queries.length !== queryIds.length) invalid();
    const labels = new Map();
    for (const query of rubric.queries) {
      if (!exact(query, ['id', 'requiredSourceIds', 'irrelevantSourceIds']) || !text(query.id, 200)
        || !queryIds.includes(query.id) || labels.has(query.id)
        || !Array.isArray(query.requiredSourceIds) || !Array.isArray(query.irrelevantSourceIds)) invalid();
      const all = [...query.requiredSourceIds, ...query.irrelevantSourceIds];
      if (all.some(id => !text(id, 200) || !sourceIds.includes(id))
        || new Set(query.requiredSourceIds).size !== query.requiredSourceIds.length
        || new Set(query.irrelevantSourceIds).size !== query.irrelevantSourceIds.length
        || new Set(all).size !== all.length) invalid();
      labels.set(query.id, { requiredSourceIds: [...query.requiredSourceIds],
        irrelevantSourceIds: [...query.irrelevantSourceIds] });
    }
    if (labels.size !== queryIds.length) invalid();
    return { fixture: structuredClone(fixture), labels, sourceIds };
  } catch (error) {
    if (error?.message === 'invalid_long_source_history_input') throw error;
    invalid();
  }
}

function eventId(batchId, index) {
  return createHash('sha256').update(JSON.stringify([
    'cairn.mcp.submitted-message.v1', batchId, index,
  ])).digest('hex');
}

function decodeToolResult(toolResult) {
  if (!plain(toolResult) || toolResult.isError !== false || !Array.isArray(toolResult.content)
    || toolResult.content.length !== 1 || toolResult.content[0]?.type !== 'text'
    || typeof toolResult.content[0].text !== 'string'
    || Buffer.byteLength(toolResult.content[0].text) > 262144) return null;
  try {
    const envelope = JSON.parse(toolResult.content[0].text);
    return envelope?.ok === true && envelope.evidenceTrust === 'untrusted-data-not-instructions'
      ? envelope : null;
  } catch { return null; }
}

async function call(client, name, args) {
  try {
    const toolResult = await client.callTool({ name, arguments: args });
    return { status: decodeToolResult(toolResult) ? 'completed' : 'failed', toolResult };
  } catch { return { status: 'failed', toolResult: null }; }
}

async function close(client) {
  if (!client) return true;
  try { await client.close(); return true; } catch { return false; }
}

async function snapshot(client) {
  const result = { status: 'pending', listPages: [], getPages: [], records: [] };
  const ids = [];
  const listed = new Map();
  const usedCursors = new Set();
  let cursor;
  do {
    if (result.listPages.length >= LIST_PAGE_LIMIT || (cursor && usedCursors.has(cursor))) {
      result.status = 'snapshot_limit_exceeded'; return result;
    }
    if (cursor) usedCursors.add(cursor);
    const observed = await call(client, 'inspect_memory', { limit: 50, ...(cursor ? { cursor } : {}) });
    result.listPages.push(observed.toolResult);
    const envelope = decodeToolResult(observed.toolResult);
    if (!envelope || !Array.isArray(envelope.value?.memories) || envelope.value.memories.length > 50) {
      result.status = 'failed'; return result;
    }
    for (const memory of envelope.value.memories) {
      if (!text(memory?.id, 4000) || ids.includes(memory.id)) { result.status = 'failed'; return result; }
      ids.push(memory.id);
      listed.set(memory.id, memory);
      if (ids.length > MEMORY_LIMIT) { result.status = 'snapshot_limit_exceeded'; return result; }
    }
    cursor = envelope.value.nextCursor;
    if (cursor !== null && cursor !== undefined && !text(cursor, 8192)) { result.status = 'failed'; return result; }
    if (envelope.value.exhausted !== !cursor) { result.status = 'failed'; return result; }
    if (ids.length === MEMORY_LIMIT && cursor) { result.status = 'snapshot_limit_exceeded'; return result; }
  } while (cursor);

  for (const memoryId of ids) {
    const entry = { memoryId, pages: [] };
    result.getPages.push(entry);
    const receipts = [];
    const usedReceiptCursors = new Set();
    let receiptCursor;
    let memory;
    do {
      if (entry.pages.length >= RECEIPT_PAGE_LIMIT
        || (receiptCursor && usedReceiptCursors.has(receiptCursor))) {
        result.status = 'snapshot_limit_exceeded'; return result;
      }
      if (receiptCursor) usedReceiptCursors.add(receiptCursor);
      const observed = await call(client, 'inspect_memory', { memoryId, receiptLimit: 50,
        ...(receiptCursor ? { receiptCursor } : {}) });
      entry.pages.push(observed.toolResult);
      const envelope = decodeToolResult(observed.toolResult);
      const body = envelope?.value;
      if (!body || !plain(body.memory) || body.memory.id !== memoryId || !Array.isArray(body.receipts)
        || body.receipts.length > 50
        || (memory && !same(memory, body.memory))) { result.status = 'failed'; return result; }
      memory ??= structuredClone(body.memory);
      for (const receipt of body.receipts) {
        if (!plain(receipt) || !text(receipt.id, 4000) || !text(receipt.eventId, 4000)
          || !['user', 'assistant'].includes(receipt.role) || typeof receipt.excerpt !== 'string'
          || !receipt.excerpt.isWellFormed() || receipts.some(item => item.id === receipt.id)) {
          result.status = 'failed'; return result;
        }
        receipts.push(structuredClone(receipt));
        if (receipts.length > RECEIPT_LIMIT) { result.status = 'snapshot_limit_exceeded'; return result; }
      }
      receiptCursor = body.nextReceiptCursor;
      if (receiptCursor !== null && receiptCursor !== undefined && !text(receiptCursor, 8192)) {
        result.status = 'failed'; return result;
      }
      if (body.exhausted !== !receiptCursor) { result.status = 'failed'; return result; }
    } while (receiptCursor);
    if (!Number.isSafeInteger(memory.receiptCount) || memory.receiptCount !== receipts.length
      || !['active', 'historical'].includes(memory.state)
      || listed.get(memoryId)?.revision !== memory.revision
      || listed.get(memoryId)?.state !== memory.state) { result.status = 'failed'; return result; }
    result.records.push({ memory, receipts });
  }
  result.status = 'completed';
  return result;
}

function sourceDto(record) {
  return { memory: { id: record.memory.id, revision: record.memory.revision,
    currentness: record.memory.state === 'active' ? 'current' : 'historical' },
  receipts: record.receipts.map(receipt => ({ id: receipt.id, role: receipt.role, excerpt: receipt.excerpt })),
  receiptCount: record.receipts.length, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' };
}

function sourceIdsFor(items, receiptSources) {
  const found = new Set();
  for (const item of items ?? []) for (const receipt of item?.receipts ?? []) {
    const sourceId = receiptSources.get(receipt.id);
    if (sourceId) found.add(sourceId);
  }
  return found;
}

function score(items, labels, receiptSources) {
  const found = sourceIdsFor(items, receiptSources);
  return { required: labels.requiredSourceIds.length,
    present: labels.requiredSourceIds.filter(id => found.has(id)),
    missing: labels.requiredSourceIds.filter(id => !found.has(id)),
    irrelevantPresent: labels.irrelevantSourceIds.filter(id => found.has(id)),
    semanticStatus: 'unassessed' };
}

function lexical(records, query) {
  const wanted = words(query);
  return records.filter(record => record.memory.state === 'active').map((record, index) => ({ record, index,
    score: [...words(record.receipts.map(receipt => receipt.excerpt).join(' '))]
      .filter(word => wanted.has(word)).length }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .slice(0, 6).map(item => sourceDto(item.record));
}

function syntheticRecall(memories) {
  const envelope = { ok: true, evidenceTrust: 'untrusted-data-not-instructions',
    value: { memories, namespaces: [], coverage: 'complete' } };
  return { isError: false, content: [{ type: 'text', text: JSON.stringify(envelope) }] };
}

function pendingQueries(fixture) {
  return fixture.queries.map(query => ({ id: query.id, question: query.question, status: 'not_run',
    answerOrder: [], arms: [
      { name: 'moc', constructedControl: false, status: 'not_run', recall: null, coverage: null, answer: null },
      { name: 'lexical', constructedControl: true, status: 'not_run', recall: null, coverage: null, answer: null },
    ] }));
}

/** Evaluation-only orchestration. The caller owns the MCP runtime, provider guard and budget. */
export async function runLongSourceHistory({ openClient, complete, fixture, rubric }) {
  if (typeof openClient !== 'function' || typeof complete !== 'function') invalid();
  const checked = validate(fixture, rubric);
  const databasePath = join(mkdtempSync(join(tmpdir(), 'cairn-long-source-history-')), 'memory.sqlite');
  const bindingEntries = [];
  checked.fixture.windows.forEach((window, windowIndex) => window.forEach((message, messageIndex) => {
    bindingEntries.push([message.id, eventId(`long-source-window-${windowIndex}`, messageIndex)]);
  }));
  const sourceBindings = Object.fromEntries(bindingEntries);
  const report = { version: 1, kind: 'long-source-history-diagnostic', id: checked.fixture.id,
    status: 'pending', sourceBindings, captures: [], captureCoverage: null,
    queries: pendingQueries(checked.fixture) };
  let halted = false;
  let finalSnapshot = null;
  for (const [index, window] of checked.fixture.windows.entries()) {
    const record = { index, batchId: `long-source-window-${index}`, sourceIds: window.map(item => item.id),
      status: halted ? 'not_run' : 'pending', capture: null, warm: null, cold: null, coldMatchesWarm: false };
    report.captures.push(record);
    if (halted) continue;
    let client;
    try {
      client = await openClient({ databasePath });
      const captured = await call(client, 'capture_memory', { batchId: record.batchId,
        messages: window.map(({ role, content }) => ({ role, content })) });
      record.capture = captured.toolResult;
      record.warm = await snapshot(client);
      const warmClosed = await close(client); client = null;
      const captureEnvelope = decodeToolResult(record.capture);
      client = await openClient({ databasePath });
      record.cold = await snapshot(client);
      const coldClosed = await close(client); client = null;
      record.coldMatchesWarm = record.warm.status === 'completed' && record.cold.status === 'completed'
        && same(record.warm.records, record.cold.records);
      record.status = captureEnvelope && record.warm.status === 'completed' && record.cold.status === 'completed'
        && record.coldMatchesWarm && warmClosed && coldClosed ? 'completed' : 'failed';
      if (record.status === 'completed') finalSnapshot = record.cold;
      else halted = true;
    } catch {
      record.status = 'failed'; halted = true;
      if (client) await close(client); client = null;
    }
  }

  const sourceByEvent = new Map(bindingEntries.map(([sourceId, hash]) => [hash, sourceId]));
  const receiptSources = new Map();
  for (const record of finalSnapshot?.records ?? []) for (const receipt of record.receipts) {
    const sourceId = sourceByEvent.get(receipt.eventId);
    if (sourceId) receiptSources.set(receipt.id, sourceId);
  }
  const captured = new Set(receiptSources.values());
  report.captureCoverage = { required: checked.sourceIds.length,
    present: checked.sourceIds.filter(id => captured.has(id)), missing: checked.sourceIds.filter(id => !captured.has(id)),
    snapshotBasis: finalSnapshot ? { windowIndex: report.captures.findLastIndex(item => item.cold === finalSnapshot),
      status: halted ? 'last-completed-before-failure' : 'final-completed-window' } : null,
    semanticStatus: 'unassessed' };

  if (!halted && finalSnapshot?.status === 'completed') {
    for (const [queryIndex, query] of checked.fixture.queries.entries()) {
      const output = report.queries[queryIndex];
      const labels = checked.labels.get(query.id);
      const byName = new Map(output.arms.map(arm => [arm.name, arm]));
      let client;
      try {
        client = await openClient({ databasePath });
        const observed = await call(client, 'recall_memory', { query: query.question, limit: 6,
          contextMode: 'source-evidence' });
        byName.get('moc').recall = observed.toolResult;
        const envelope = decodeToolResult(observed.toolResult);
        const validMemories = Array.isArray(envelope?.value?.memories);
        const memories = validMemories ? envelope.value.memories : [];
        byName.get('moc').coverage = validMemories ? score(memories, labels, receiptSources) : null;
        byName.get('moc').status = envelope && validMemories
          && ['complete', 'budget_exhausted'].includes(envelope.value?.coverage)
          ? 'observed' : 'recall_failed';
      } catch { byName.get('moc').status = 'recall_failed'; }
      finally { if (client) await close(client); }

      const lexicalMemories = lexical(finalSnapshot.records, query.question);
      const lexicalResult = syntheticRecall(lexicalMemories);
      Object.assign(byName.get('lexical'), { status: 'observed', recall: lexicalResult,
        coverage: score(lexicalMemories, labels, receiptSources) });
      output.answerOrder = queryIndex % 2 === 0 ? ['moc', 'lexical'] : ['lexical', 'moc'];
      for (const name of output.answerOrder) {
        const arm = byName.get(name);
        const envelope = decodeToolResult(arm.recall);
        if (arm.status === 'recall_failed' || !envelope) {
          arm.answer = { status: 'answer_not_run_recall_failed', answer: null, completionCalls: 0 };
        }
        else if (envelope.value.coverage !== 'complete') {
          arm.answer = { status: 'answer_not_run_partial_coverage', answer: null, completionCalls: 0 };
        } else arm.answer = await deliverInstalledSourceAnswer({ question: query.question,
          toolResult: arm.recall, complete });
      }
      output.status = output.arms.every(arm => arm.status === 'observed') ? 'observed' : 'observed-with-failures';
    }
  }
  report.status = !halted && report.queries.every(query => query.status === 'observed')
    ? 'observed' : 'observed-with-failures';
  return report;
}

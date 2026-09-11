import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { openMemoryCore } from '../core/contract.mjs';
import { historyCases, historyVersion } from './history-cases.mjs';
import { historyReceiptBindingsValid } from './history-runner.mjs';

export const ORDERED_HISTORY_VERSION = 'conversation-history-ordered-v1';
export const ORDERED_HISTORY_MAPPING = Object.freeze({
  kind: 'trusted-fixture-window-order', client: 'conversation-history-audit',
  streamId: 'conversation-history-v1-<history.id>', sequence: 'windowIndex+1',
});
const rawVersion = 'conversation-history-ordered-raw-v1';
const rawKind = 'synthetic-source-ordered-history';
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = code => { throw new Error(code); };
const unwrap = result => { if (!result?.ok) fail('history_operation_failed'); return result.value; };

function configuration(options) {
  let result;
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(options)) ||
        Reflect.ownKeys(options).some(key => !['model', 'directory', 'onProgress', 'readDiagnostics'].includes(key))) {
      fail('invalid_history_options');
    }
    const { model, directory, onProgress = () => {}, readDiagnostics = () => [] } = options;
    if (!model || !['object', 'function'].includes(typeof model) || Array.isArray(model) ||
        typeof directory !== 'string' || !directory || directory.includes('\0') ||
        typeof onProgress !== 'function' || typeof readDiagnostics !== 'function') fail('invalid_history_options');
    result = { model, directory, onProgress, readDiagnostics };
  } catch { fail('invalid_history_options'); }
  try {
    const { directory } = result;
    const stat = lstatSync(directory);
    if (path.resolve(directory) !== directory || !stat.isDirectory() || stat.isSymbolicLink() ||
        realpathSync(directory) !== directory ||
        (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700) || readdirSync(directory).length) {
      fail('unsafe_history_directory');
    }
  } catch { fail('unsafe_history_directory'); }
  return result;
}

function snapshot(core, namespace, records) {
  let cursor;
  do {
    const listed = unwrap(core.list({ namespace, limit: 50, ...(cursor ? { cursor } : {}) }));
    for (const memory of listed.memories) {
      const detail = unwrap(core.get({ namespace, memoryId: memory.id, receiptLimit: 50 }));
      const record = { memory: detail.memory, receipts: [...detail.receipts],
        ...(detail.supersession ? { supersession: detail.supersession } : {}) };
      // Retain the portion observed even if a later receipt page fails.
      records.push(record);
      let receiptCursor = detail.nextReceiptCursor;
      while (receiptCursor) {
        const next = unwrap(core.get({ namespace, memoryId: memory.id, receiptLimit: 50, receiptCursor }));
        record.receipts.push(...next.receipts);
        receiptCursor = next.nextReceiptCursor;
      }
    }
    cursor = listed.nextCursor;
  } while (cursor);
}

function captureCompleted(capture) {
  if (!capture?.ok || capture.value?.duplicate !== false ||
      !['applied', 'skipped'].includes(capture.value.classification?.status)) return false;
  if (capture.value.classification.status === 'skipped' &&
      !['empty', 'already_filed'].includes(capture.value.classification.reason)) return false;
  const reconciliation = capture.value.reconciliation;
  return reconciliation && Object.keys(reconciliation).sort().join(',') === 'reason,retiredCount,status' &&
    reconciliation.reason === null && Number.isInteger(reconciliation.retiredCount) &&
    ((reconciliation.status === 'applied' && reconciliation.retiredCount >= 1 && reconciliation.retiredCount <= 5) ||
      (reconciliation.status === 'complete_no_change' && reconciliation.retiredCount === 0));
}

/** Mechanical, detached compatibility view; it makes no semantic acceptance decision. */
export function projectOrderedHistoryAudit(evidence) {
  let projected;
  try { projected = structuredClone(evidence); } catch { fail('invalid_ordered_history_evidence'); }
  if (projected?.version !== rawVersion || projected.kind !== rawKind || !Array.isArray(projected.cases)) {
    fail('invalid_ordered_history_evidence');
  }
  projected.version = historyVersion;
  projected.kind = 'synthetic-multi-turn-history';
  for (const history of projected.cases) {
    if (!Array.isArray(history?.windows)) continue;
    for (const window of history.windows) {
      if (!window || typeof window !== 'object') continue;
      delete window.causal;
      for (const name of ['records', 'reopenedRecords']) {
        if (!Array.isArray(window[name])) continue;
        window[name] = window[name].filter(record => record?.memory?.state !== 'historical');
        for (const record of window[name]) {
          if (record && typeof record === 'object') delete record.supersession;
        }
      }
    }
  }
  return projected;
}

/** Fixed synthetic source order over the public core, with no evaluator/model defaults. */
export async function runOrderedHistoryAudit(options) {
  const { model, directory, onProgress, readDiagnostics } = configuration(options);
  const cases = structuredClone(historyCases);
  const evidence = { version: rawVersion, kind: rawKind, cases: [], status: 'completed' };
  let infrastructureFailed = false;
  const infrastructureFailure = (record, code) => {
    record.status = 'failed';
    record.error ??= { code };
    record.errors ??= [];
    if (!record.errors.some(error => error.code === code)) record.errors.push({ code });
    infrastructureFailed = true;
    evidence.status = 'failed';
  };
  const close = (core, record) => {
    try { if (core) unwrap(core.close()); }
    catch { infrastructureFailure(record, 'history_close_failed'); }
  };
  const observe = async (record, progress) => {
    try {
      const diagnostics = structuredClone(await readDiagnostics());
      if (!Array.isArray(diagnostics)) fail('invalid_diagnostics');
      record.diagnostics = diagnostics;
    } catch { infrastructureFailure(record, 'history_diagnostics_failed'); }
    if (infrastructureFailed) return;
    try { await onProgress({ ...progress, status: record.status }); }
    catch { infrastructureFailure(record, 'history_progress_failed'); }
  };
  for (const history of cases) {
    const namespace = { ownerId: `synthetic-${history.id}`, scope: 'project', projectId: 'synthetic-history' };
    const database = path.join(directory, `${history.id}.sqlite`);
    const result = { id: history.id, namespace, windows: [], recalls: [], status: 'completed' };
    evidence.cases.push(result);
    let halted = infrastructureFailed;
    if (halted) result.status = 'not_run';
    for (const [index, messages] of history.windows.entries()) {
      const causal = { streamId: `conversation-history-v1-${history.id}`, sequence: index + 1 };
      const window = { index, messages: structuredClone(messages), causal, status: 'not_run' };
      result.windows.push(window);
      if (halted) {
        window.reason = infrastructureFailed ? 'audit_infrastructure_failed' : 'prior_window_failed';
        continue;
      }
      let core;
      try {
        core = openMemoryCore({ path: database, model });
        window.capture = await core.capture({ namespace, client: ORDERED_HISTORY_MAPPING.client,
          sessionId: `${history.id}-window-${index}`, eventId: `${history.id}-event-${index}`, messages, causal });
        window.records = [];
        snapshot(core, namespace, window.records);
        window.receiptBindingsValid = historyReceiptBindingsValid(window.records, history.windows.slice(0, index + 1), history.id);
        close(core, window);
        core = null;
        if (!infrastructureFailed) {
          core = openMemoryCore({ path: database });
          window.reopenedRecords = [];
          snapshot(core, namespace, window.reopenedRecords);
          window.reopenPersisted = same(window.records, window.reopenedRecords);
          window.status = captureCompleted(window.capture) && window.receiptBindingsValid && window.reopenPersisted
            ? 'completed' : 'failed';
        }
      } catch {
        window.status = 'failed';
        window.error ??= { code: 'history_window_failed' };
      } finally { close(core, window); }
      await observe(window, { historyId: history.id, windowIndex: index });
      if (window.status !== 'completed') { halted = true; result.status = 'failed'; evidence.status = 'failed'; }
    }
    for (const query of history.queries) {
      const recall = { ...query, status: 'not_run' };
      result.recalls.push(recall);
      if (halted) {
        recall.reason = infrastructureFailed ? 'audit_infrastructure_failed' : 'prior_window_failed';
        continue;
      }
      let core;
      try {
        core = openMemoryCore({ path: database, model });
        recall.result = await core.recall({ readSet: [namespace], query: query.query, limit: 12 });
        recall.status = recall.result.ok && recall.result.value.coverage === 'complete' ? 'completed' : 'failed';
      } catch { recall.status = 'failed'; recall.error = { code: 'history_recall_failed' }; }
      finally { close(core, recall); }
      await observe(recall, { historyId: history.id, queryId: query.id });
      if (recall.status !== 'completed') { result.status = 'failed'; evidence.status = 'failed'; }
      if (infrastructureFailed) halted = true;
    }
  }
  return { version: ORDERED_HISTORY_VERSION, sourceVersion: historyVersion,
    ordering: { ...ORDERED_HISTORY_MAPPING }, evidence, v1Projection: projectOrderedHistoryAudit(evidence) };
}

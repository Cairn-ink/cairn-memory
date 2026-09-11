import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { openMemoryCore } from '../core/contract.mjs';
import { historyCases, historyVersion } from './history-cases.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unwrap = (result) => { if (!result?.ok) throw new Error('history_operation_failed'); return result.value; };
const sourceClient = 'conversation-history-audit';

function snapshot(core, namespace) {
  const records = [];
  let cursor;
  do {
    const listed = unwrap(core.list({ namespace, limit: 50, ...(cursor ? { cursor } : {}) }));
    for (const memory of listed.memories) {
      const detail = unwrap(core.get({ namespace, memoryId: memory.id, receiptLimit: 50 }));
      const receipts = [...detail.receipts];
      let receiptCursor = detail.nextReceiptCursor;
      while (receiptCursor) {
        const next = unwrap(core.get({ namespace, memoryId: memory.id, receiptLimit: 50, receiptCursor }));
        receipts.push(...next.receipts); receiptCursor = next.nextReceiptCursor;
      }
      records.push({ memory: detail.memory, receipts });
    }
    cursor = listed.nextCursor;
  } while (cursor);
  return records;
}

export function historyReceiptBindingsValid(records, windows, historyId) {
  return Array.isArray(records) && records.every((record) => record?.memory && Array.isArray(record.receipts)
    && record.receipts.length > 0 && record.receipts.every((receipt) => receipt.client === sourceClient
      && windows.some((messages, index) => receipt.sessionId === `${historyId}-window-${index}`
        && messages.some((message) => receipt.eventId === message.id && receipt.role === message.role
          && receipt.excerpt === message.content))));
}

export async function runHistoryAudit({ model, directory, cases = historyCases,
  onProgress = () => {}, readDiagnostics = () => [] } = {}) {
  if (!same(cases, historyCases) || !model || typeof onProgress !== 'function'
    || typeof readDiagnostics !== 'function') throw new Error('invalid_history_options');
  cases = structuredClone(cases);
  const root = path.resolve(directory);
  const stat = lstatSync(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(root) !== root
    || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700)
    || readdirSync(root).length) throw new Error('unsafe_history_directory');
  const report = { version: historyVersion, kind: 'synthetic-multi-turn-history', cases: [], status: 'completed' };
  let infrastructureFailed = false;
  const infrastructureFailure = (record, code) => {
    record.status = 'failed';
    record.error ??= { code };
    record.errors ??= [];
    if (!record.errors.some((error) => error.code === code)) record.errors.push({ code });
    infrastructureFailed = true; report.status = 'failed';
  };
  const close = (core, record) => {
    try { if (core) core.close(); }
    catch { infrastructureFailure(record, 'history_close_failed'); }
  };
  const observe = async (record, progress) => {
    try {
      const diagnostics = structuredClone(await readDiagnostics());
      if (!Array.isArray(diagnostics)) throw new Error('invalid_diagnostics');
      record.diagnostics = diagnostics;
    } catch { infrastructureFailure(record, 'history_diagnostics_failed'); }
    if (infrastructureFailed) return;
    try { await onProgress({ ...progress, status: record.status }); }
    catch { infrastructureFailure(record, 'history_progress_failed'); }
  };
  for (const history of cases) {
    const namespace = { ownerId: `synthetic-${history.id}`, scope: 'project', projectId: 'synthetic-history' };
    const database = path.join(root, `${history.id}.sqlite`);
    const result = { id: history.id, namespace, windows: [], recalls: [], status: 'completed' };
    report.cases.push(result);
    let halted = infrastructureFailed;
    if (halted) result.status = 'not_run';
    for (const [index, messages] of history.windows.entries()) {
      const window = { index, messages: structuredClone(messages), status: 'not_run' };
      result.windows.push(window);
      if (halted) { window.reason = infrastructureFailed ? 'audit_infrastructure_failed' : 'prior_window_failed'; continue; }
      let core;
      try {
        core = openMemoryCore({ path: database, model });
        window.capture = await core.capture({ namespace, client: sourceClient,
          sessionId: `${history.id}-window-${index}`, eventId: `${history.id}-event-${index}`, messages });
        window.records = snapshot(core, namespace);
        window.receiptBindingsValid = historyReceiptBindingsValid(window.records, history.windows.slice(0, index + 1), history.id);
        close(core, window); core = null;
        if (!infrastructureFailed) {
          core = openMemoryCore({ path: database });
          window.reopenedRecords = snapshot(core, namespace);
          window.reopenPersisted = same(window.records, window.reopenedRecords);
          window.status = window.capture.ok && window.capture.value.classification?.status !== 'failed'
            && window.receiptBindingsValid && window.reopenPersisted ? 'completed' : 'failed';
        }
      } catch {
        window.status = 'failed'; window.error = { code: 'history_window_failed' };
      } finally { close(core, window); }
      await observe(window, { historyId: history.id, windowIndex: index });
      if (window.status !== 'completed') { halted = true; result.status = 'failed'; report.status = 'failed'; }
    }
    for (const query of history.queries) {
      const recall = { ...query, status: 'not_run' };
      result.recalls.push(recall);
      if (halted) { recall.reason = infrastructureFailed ? 'audit_infrastructure_failed' : 'prior_window_failed'; continue; }
      let core;
      try {
        core = openMemoryCore({ path: database, model });
        recall.result = await core.recall({ readSet: [namespace], query: query.query, limit: 12 });
        recall.status = recall.result.ok ? 'completed' : 'failed';
      } catch { recall.status = 'failed'; recall.error = { code: 'history_recall_failed' }; }
      finally { close(core, recall); }
      await observe(recall, { historyId: history.id, queryId: query.id });
      if (recall.status !== 'completed') { result.status = 'failed'; report.status = 'failed'; }
      if (infrastructureFailed) halted = true;
    }
  }
  return report;
}

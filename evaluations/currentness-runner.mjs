import path from 'node:path';
import { openMemoryCore } from '../core/contract.mjs';
import { currentnessCases, currentnessVersion } from './currentness-cases.mjs';
import { captureAuditConfiguration, captureAuditSnapshot, captureAuditCompleted } from './capture-audit-support.mjs';

export const CURRENTNESS_REPORT_VERSION = 'currentness-evidence-v1';
export const CURRENTNESS_ORDERING = Object.freeze({
  kind: 'trusted-fixture-window-order', client: 'currentness-audit',
  streamId: 'currentness-v1-<case.id>-<namespaceKey>', sequence: 'namespaceWindowIndex+1',
});
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const fail = code => { throw new Error(code); };
const unwrap = result => { if (!result?.ok) fail('currentness_operation_failed'); return result.value; };

function snapshots(core, namespaces, observed) {
  for (const { key, namespace } of namespaces) {
    const snapshot = { key, namespace: structuredClone(namespace), records: [] };
    observed.push(snapshot);
    captureAuditSnapshot(core, namespace, snapshot.records, unwrap);
  }
}

function receiptBindingsValid(observed, source, throughIndex) {
  return observed.every(snapshot => snapshot.records.every(record =>
    same(record.memory.namespace, snapshot.namespace) && Array.isArray(record.receipts)
    && record.receipts.length > 0 && new Set(record.receipts.map(receipt => receipt.id)).size === record.receipts.length
    && record.receipts.every(receipt => typeof receipt.id === 'string' && receipt.id.length > 0
      && receipt.client === CURRENTNESS_ORDERING.client
      && source.windows.slice(0, throughIndex + 1).some((window, index) =>
        window.namespaceKey === snapshot.key && receipt.sessionId === `${source.id}-window-${index}`
        && window.messages.some(message => receipt.eventId === message.id
          && receipt.role === message.role && receipt.excerpt === message.content)))));
}

/** Actual-core observations over fixed source order, without semantic expectations. */
export async function runCurrentnessAudit(options) {
  const { model, directory, onProgress, readDiagnostics } = captureAuditConfiguration(options, {
    invalidOptions: 'invalid_currentness_options', unsafeDirectory: 'unsafe_currentness_directory',
  });
  const report = { version: CURRENTNESS_REPORT_VERSION, sourceVersion: currentnessVersion,
    ordering: { ...CURRENTNESS_ORDERING }, status: 'completed', cases: [] };
  let infrastructureFailed = false;
  const failure = (record, code, infrastructure = false) => {
    record.status = 'failed';
    record.error ??= { code };
    record.errors ??= [];
    if (!record.errors.some(error => error.code === code)) record.errors.push({ code });
    report.status = 'failed';
    if (infrastructure) infrastructureFailed = true;
  };
  const close = (core, record) => {
    try { if (core) unwrap(core.close()); }
    catch { failure(record, 'currentness_close_failed', true); }
  };
  const observe = async (record, identity) => {
    try {
      const diagnostics = structuredClone(await readDiagnostics());
      if (!Array.isArray(diagnostics)) fail('invalid_diagnostics');
      record.diagnostics = diagnostics;
    } catch { failure(record, 'currentness_diagnostics_failed', true); }
    if (infrastructureFailed) return;
    try { await onProgress({ ...identity, status: record.status }); }
    catch { failure(record, 'currentness_progress_failed', true); }
  };
  const skip = record => {
    record.reason = infrastructureFailed ? 'audit_infrastructure_failed' : 'prior_operation_failed';
  };
  for (const source of structuredClone(currentnessCases)) {
    const keys = [...new Set(source.windows.map(window => window.namespaceKey))].sort();
    const namespaces = keys.map(key => ({ key, namespace: { ownerId: `synthetic-${source.id}`,
      scope: 'project', projectId: `synthetic-currentness-${key}` } }));
    const namespaceFor = key => namespaces.find(item => item.key === key).namespace;
    const database = path.join(directory, `${source.id}.sqlite`);
    const result = { id: source.id, namespaces, status: infrastructureFailed ? 'not_run' : 'completed',
      windows: [], recalls: [] };
    report.cases.push(result);
    let halted = infrastructureFailed;
    const sequences = new Map();
    for (const [index, fixture] of source.windows.entries()) {
      const { namespaceKey, messages } = fixture;
      const sequence = (sequences.get(namespaceKey) ?? 0) + 1;
      sequences.set(namespaceKey, sequence);
      const causal = { streamId: `currentness-v1-${source.id}-${namespaceKey}`, sequence };
      const window = { index, namespaceKey, messages: structuredClone(messages), causal, status: 'not_run' };
      result.windows.push(window);
      if (halted) { skip(window); continue; }
      let core;
      try {
        core = openMemoryCore({ path: database, model });
        window.capture = await core.capture({ namespace: namespaceFor(namespaceKey),
          client: CURRENTNESS_ORDERING.client, sessionId: `${source.id}-window-${index}`,
          eventId: `${source.id}-event-${index}`, messages, causal });
        if (!captureAuditCompleted(window.capture)) failure(window, 'currentness_capture_failed');
        window.snapshots = [];
        snapshots(core, namespaces, window.snapshots);
        window.receiptBindingsValid = receiptBindingsValid(window.snapshots, source, index);
        if (!window.receiptBindingsValid) failure(window, 'currentness_source_mismatch');
        close(core, window);
        core = null;
        if (!infrastructureFailed) {
          core = openMemoryCore({ path: database });
          window.reopenedSnapshots = [];
          snapshots(core, namespaces, window.reopenedSnapshots);
          window.reopenPersisted = same(window.snapshots, window.reopenedSnapshots);
          if (!window.reopenPersisted) failure(window, 'currentness_reopen_mismatch');
          if (window.status !== 'failed') window.status = 'completed';
        }
      } catch { failure(window, 'currentness_window_failed'); }
      finally { close(core, window); }
      await observe(window, { caseId: source.id, windowIndex: index });
      if (window.status !== 'completed') { halted = true; result.status = 'failed'; }
    }
    for (const query of source.queries) {
      const recall = { ...query, status: 'not_run' };
      result.recalls.push(recall);
      if (halted) { skip(recall); continue; }
      let core;
      try {
        core = openMemoryCore({ path: database, model });
        recall.result = await core.recall({ readSet: [namespaceFor(query.namespaceKey)], query: query.query, limit: 12 });
        if (recall.result?.ok === true && recall.result.value.coverage === 'complete') recall.status = 'completed';
        else failure(recall, 'currentness_recall_failed');
      } catch { failure(recall, 'currentness_recall_failed'); }
      finally { close(core, recall); }
      await observe(recall, { caseId: source.id, queryId: query.id });
      if (recall.status !== 'completed') { halted = true; result.status = 'failed'; }
    }
  }
  return report;
}

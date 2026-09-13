import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';

const fail = code => { throw new Error(code); };

/** Validate host options without reading credentials or selecting a model. */
export function captureAuditConfiguration(options, { invalidOptions, unsafeDirectory }) {
  let selected;
  try {
    if (!options || typeof options !== 'object' || Array.isArray(options)
      || ![Object.prototype, null].includes(Object.getPrototypeOf(options))
      || Reflect.ownKeys(options).some(key => !['model', 'directory', 'onProgress', 'readDiagnostics'].includes(key))) {
      fail(invalidOptions);
    }
    const { model, directory, onProgress = () => {}, readDiagnostics = () => [] } = options;
    if (!model || !['object', 'function'].includes(typeof model) || Array.isArray(model)
      || typeof directory !== 'string' || !directory || directory.includes('\0')
      || typeof onProgress !== 'function' || typeof readDiagnostics !== 'function') fail(invalidOptions);
    selected = { model, directory, onProgress, readDiagnostics };
  } catch { fail(invalidOptions); }
  try {
    const { directory } = selected;
    const stat = lstatSync(directory);
    if (path.resolve(directory) !== directory || !stat.isDirectory() || stat.isSymbolicLink()
      || realpathSync(directory) !== directory
      || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700)
      || readdirSync(directory).length) fail(unsafeDirectory);
  } catch { fail(unsafeDirectory); }
  return selected;
}

/** Append raw records incrementally, retaining observations if later paging fails. */
export function captureAuditSnapshot(core, namespace, records, unwrap) {
  let cursor;
  do {
    const listed = unwrap(core.list({ namespace, limit: 50, ...(cursor ? { cursor } : {}) }));
    for (const memory of listed.memories) {
      const detail = unwrap(core.get({ namespace, memoryId: memory.id, receiptLimit: 50 }));
      const record = { memory: detail.memory, receipts: [...detail.receipts],
        ...(detail.supersession ? { supersession: detail.supersession } : {}) };
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

/** Mechanical completion only; empty extraction is not semantic acceptance. */
export function captureAuditCompleted(capture) {
  if (capture?.ok !== true || capture.value?.duplicate !== false) return false;
  const classification = capture.value.classification;
  if (classification?.status !== 'applied' && !(classification?.status === 'skipped'
    && ['empty', 'already_filed'].includes(classification.reason))) return false;
  const reconciliation = capture.value.reconciliation;
  return reconciliation && Object.keys(reconciliation).sort().join(',') === 'reason,retiredCount,status'
    && reconciliation.reason === null && Number.isInteger(reconciliation.retiredCount)
    && ((reconciliation.status === 'applied' && reconciliation.retiredCount >= 1 && reconciliation.retiredCount <= 5)
      || (reconciliation.status === 'complete_no_change' && reconciliation.retiredCount === 0));
}

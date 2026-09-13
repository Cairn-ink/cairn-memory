import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { captureAuditCompleted, captureAuditSnapshot } from '../../evaluations/capture-audit-support.mjs';
import { boundedText } from '../../core/validation.mjs';

export const QUALIFIED_COMPARISON_VERSION = 'qualified-reconciliation-comparison-v1';
export const QUALIFIED_COMPARISON_CANDIDATES = Object.freeze({
  baseline: '08b566fc6949f65148460e23919e49fcfb188fef',
  qualified: 'cb5d31d32a62532d36663613cbb3451956259d6d',
});
const fail = code => { throw new Error(code); };
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const unwrap = result => { if (result?.ok !== true) fail('comparison_operation_failed'); return result.value; };
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value))
  && Reflect.ownKeys(value).length === fields.length
  && Reflect.ownKeys(value).every(key => fields.includes(key));
const dense = (value, minimum, maximum) => Array.isArray(value) && value.length >= minimum
  && value.length <= maximum && Reflect.ownKeys(value).length === value.length + 1
  && Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean);
const text = (value, maximum) => typeof value === 'string' && value.trim().length > 0
  && value.length <= maximum && !value.includes('\0');

function configuration(options) {
  let selected;
  try {
    if (!exact(options, ['sources', 'directory', 'candidates', 'answer', 'persist', 'shouldHalt'])
      || !exact(options.candidates, ['baseline', 'qualified'])
      || ['baseline', 'qualified'].some(arm => typeof options.candidates[arm] !== 'function')
      || ['answer', 'persist', 'shouldHalt'].some(key => typeof options[key] !== 'function')) fail('invalid_comparison_options');
    const { sources } = options;
    if (!exact(sources, ['version', 'cases']) || sources.version !== 'qualified-reconciliation-holdout-v1'
      || !dense(sources.cases, 8, 8)) fail('invalid_comparison_options');
    for (const [index, source] of sources.cases.entries()) {
      if (!exact(source, ['id', 'language', 'windows', 'query']) || source.id !== `Q${String(index + 1).padStart(2, '0')}`
        || !['en', 'zh'].includes(source.language) || !text(source.query, 4000)
        || !dense(source.windows, 2, 2)) fail('invalid_comparison_options');
      for (const window of source.windows) {
        if (!exact(window, ['messages']) || !dense(window.messages, 1, 24)) fail('invalid_comparison_options');
        for (const message of window.messages) {
          if (!exact(message, ['id', 'role', 'content']) || !text(message.id, 200)
            || message.id.trim() !== message.id || /[\x00-\x1f\x7f]/u.test(message.id)
            || !['user', 'assistant'].includes(message.role) || !text(message.content, 4000)) fail('invalid_comparison_options');
        }
        if (new Set(window.messages.map(message => message.id)).size !== window.messages.length
          || window.messages.reduce((sum, message) => sum + message.content.length, 0) > 20000) fail('invalid_comparison_options');
      }
    }
    if (sources.cases.filter(source => source.language === 'en').length !== 4) fail('invalid_comparison_options');
    selected = { ...options, sources: structuredClone(sources), candidates: { ...options.candidates } };
  } catch { fail('invalid_comparison_options'); }
  try {
    const { directory } = selected;
    if (!text(directory, 4096) || path.resolve(directory) !== directory) fail('unsafe_comparison_directory');
    const stat = lstatSync(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(directory) !== directory
      || (process.platform !== 'win32' && (stat.mode & 0o777) !== 0o700)
      || readdirSync(directory).length) fail('unsafe_comparison_directory');
  } catch { fail('unsafe_comparison_directory'); }
  return selected;
}

function bindingsValid(records, namespace, windows, sessionId) {
  return records.every(record => same(record.memory.namespace, namespace) && record.receipts.length > 0
    && record.receipts.every(receipt => receipt.client === 'qualified-comparison'
      && receipt.sessionId === sessionId && windows.some(window => window.messages.some(message =>
        receipt.eventId === message.id && receipt.role === message.role
        // Source normalization is unchanged in both pinned candidate trees.
        && receipt.excerpt === boundedText(message.content, 800, true)))));
}

/** Pinned factories and durable transport/persistence authority belong to the operator. */
export async function runQualifiedComparison(options) {
  const { sources, directory, candidates, answer, persist, shouldHalt } = configuration(options);
  const report = { version: QUALIFIED_COMPARISON_VERSION, sourceVersion: sources.version,
    candidates: { ...QUALIFIED_COMPARISON_CANDIDATES }, status: 'incomplete', arms: [] };
  for (const [index, source] of sources.cases.entries()) {
    for (const arm of index % 2 === 0 ? ['baseline', 'qualified'] : ['qualified', 'baseline']) {
      const namespace = { ownerId: 'synthetic-qualified-comparison', scope: 'project', projectId: `${source.id}-${arm}` };
      report.arms.push({ caseId: source.id, language: source.language, arm, namespace, status: 'not_run',
        windows: source.windows.map((window, windowIndex) => ({ index: windowIndex,
          messages: structuredClone(window.messages), causal: { streamId: `${source.id}-${arm}`, sequence: windowIndex + 1 }, status: 'not_run' })),
        recall: { query: source.query, status: 'not_run' }, answer: { status: 'not_run' } });
    }
  }
  let halted = false;
  let persistenceFailed = false;
  let sequence = 0;
  const failure = (record, code, global = false) => {
    record.status = 'incomplete';
    record.errors ??= [];
    if (!record.errors.some(error => error.code === code)) record.errors.push({ code });
    if (global) { halted = true; report.status = 'halted'; }
  };
  const checkpoint = async stage => {
    if (persistenceFailed) return false;
    try { await persist({ sequence: sequence++, stage, report: structuredClone(report) }); return true; }
    catch { persistenceFailed = true; failure(report, 'comparison_persistence_failed', true); return false; }
  };
  const allowed = async () => {
    if (halted) return false;
    try {
      const stop = await shouldHalt();
      if (typeof stop !== 'boolean') fail('invalid_halt_check');
      if (stop) failure(report, 'comparison_operator_halted', true);
    } catch { failure(report, 'comparison_halt_check_failed', true); }
    return !halted;
  };
  const close = async (core, record) => {
    if (!core) return;
    try { unwrap(await core.close()); }
    catch { failure(record, 'comparison_close_failed', true); }
  };
  const open = async (entry, database, withModel) => {
    try { return await candidates[entry.arm]({ path: database, withModel, caseId: entry.caseId, arm: entry.arm }); }
    catch { failure(report, 'comparison_factory_failed', true); fail('comparison_factory_failed'); }
  };
  if (!await checkpoint('initial')) return report;
  for (const entry of report.arms) {
    if (!await allowed()) break;
    const database = path.join(directory, `${entry.caseId}-${entry.arm}.sqlite`);
    const sessionId = `${entry.caseId}-${entry.arm}`;
    entry.status = 'incomplete';
    let armComplete = true;
    for (const window of entry.windows) {
      if (!await allowed()) { armComplete = false; break; }
      const stage = `${entry.caseId}/${entry.arm}/window-${window.index}`;
      if (!await checkpoint(`${stage}/before`) || !await allowed()) { armComplete = false; break; }
      const started = performance.now();
      let core;
      try {
        window.status = 'incomplete';
        core = await open(entry, database, true);
        window.capture = await core.capture({ namespace: entry.namespace, client: 'qualified-comparison', sessionId,
          eventId: `${sessionId}-${window.index}`, messages: structuredClone(window.messages), causal: window.causal });
        window.records = [];
        captureAuditSnapshot(core, entry.namespace, window.records, unwrap);
        window.sourceBindingsValid = bindingsValid(window.records, entry.namespace, entry.windows.slice(0, window.index + 1), sessionId);
        if (!window.sourceBindingsValid) failure(window, 'comparison_source_bindings_failed', true);
        await close(core, window); core = null;
        if (!halted) {
          core = await open(entry, database, false);
          window.reopenedRecords = [];
          captureAuditSnapshot(core, entry.namespace, window.reopenedRecords, unwrap);
          window.reopenPersisted = same(window.records, window.reopenedRecords);
          if (!window.reopenPersisted) failure(window, 'comparison_snapshot_mismatch', true);
          if (captureAuditCompleted(window.capture) && window.sourceBindingsValid && window.reopenPersisted) window.status = 'completed';
          else failure(window, 'comparison_capture_incomplete');
        }
      } catch { failure(window, 'comparison_window_failed', true); }
      finally { await close(core, window); window.durationMs = performance.now() - started; }
      await allowed();
      await checkpoint(`${stage}/after`);
      if (window.status !== 'completed' || halted) { armComplete = false; break; }
    }
    if (armComplete && await allowed()) {
      const stage = `${entry.caseId}/${entry.arm}/recall`;
      if (await checkpoint(`${stage}/before`) && await allowed()) {
        let core;
        const started = performance.now();
        try {
          entry.recall.status = 'incomplete';
          core = await open(entry, database, true);
          entry.recall.result = await core.recall({ readSet: [entry.namespace], query: entry.recall.query, limit: 12 });
          const recalled = entry.recall.result;
          if (recalled?.ok === true && recalled.value.coverage === 'complete') entry.recall.status = 'completed';
          else failure(entry.recall, 'comparison_recall_incomplete');
        } catch { failure(entry.recall, 'comparison_recall_failed'); }
        finally { await close(core, entry.recall); entry.recall.durationMs = performance.now() - started; }
        await allowed();
        await checkpoint(`${stage}/after`);
      }
      armComplete = entry.recall.status === 'completed' && !halted;
    } else armComplete = false;
    if (armComplete && await allowed()) {
      const stage = `${entry.caseId}/${entry.arm}/answer`;
      if (await checkpoint(`${stage}/before`) && await allowed()) {
        const started = performance.now();
        try {
          entry.answer.status = 'incomplete';
          entry.answer.result = await answer({ query: entry.recall.query, evidence: structuredClone(entry.recall.result.value) });
          if (!text(entry.answer.result?.text, 40000)) fail('invalid_answer');
          entry.answer.status = 'completed';
        } catch { failure(entry.answer, 'comparison_answer_failed', true); }
        finally { entry.answer.durationMs = performance.now() - started; }
        await allowed();
        await checkpoint(`${stage}/after`);
      }
      armComplete = entry.answer.status === 'completed' && !halted;
    } else armComplete = false;
    entry.status = armComplete ? 'completed' : 'incomplete';
    if (!await checkpoint(`${entry.caseId}/${entry.arm}/after`)) break;
  }
  report.status = halted ? 'halted' : report.arms.every(entry => entry.status === 'completed') ? 'completed' : 'incomplete';
  await checkpoint('final');
  return report;
}

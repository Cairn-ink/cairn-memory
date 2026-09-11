import { historyCases } from './history-cases.mjs';
import { historyRubric } from './history-rubric.mjs';
import { scoreHistoryAudit } from './history-score.mjs';
import {
  ORDERED_HISTORY_MAPPING,
  ORDERED_HISTORY_VERSION,
  projectOrderedHistoryAudit,
} from './ordered-history-runner.mjs';

export const orderedHistoryReviewVersion = 'conversation-history-ordered-review-v1';

const RAW_VERSION = 'conversation-history-ordered-raw-v1';
const RAW_KIND = 'synthetic-source-ordered-history';
const SOURCE_CLIENT = 'conversation-history-audit';
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const key = (...parts) => JSON.stringify(parts);
const exact = (value, fields) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && same(Object.keys(value).sort(), [...fields].sort());
const validMemory = (record) => typeof record?.memory?.id === 'string'
  && record.memory.id.length > 0 && Number.isSafeInteger(record.memory.revision)
  && record.memory.revision > 0 && typeof record.memory.content === 'string'
  && record.memory.content.length > 0 && ['active', 'historical'].includes(record.memory.state);
const classified = (classification) => classification?.status === 'applied'
  || (classification?.status === 'skipped'
    && ['empty', 'already_filed'].includes(classification.reason));
const expectedNamespace = history => ({ ownerId: `synthetic-${history.id}`,
  scope: 'project', projectId: 'synthetic-history' });

function receiptBound(receipt, history, throughWindow) {
  if (typeof receipt?.id !== 'string' || !receipt.id.length || receipt.client !== SOURCE_CLIENT) return false;
  return history.windows.slice(0, throughWindow + 1).some((messages, index) =>
    receipt.sessionId === `${history.id}-window-${index}`
    && messages.some(message => receipt.eventId === message.id && receipt.role === message.role
      && receipt.excerpt === message.content));
}

function validRecord(record, namespace, history, throughWindow) {
  if (!validMemory(record) || !same(record.memory.namespace, namespace)
    || !Array.isArray(record.receipts) || record.receipts.length === 0) return false;
  const ids = new Set();
  for (const receipt of record.receipts) {
    if (!receiptBound(receipt, history, throughWindow) || ids.has(receipt.id)) return false;
    ids.add(receipt.id);
  }
  return true;
}

function reconciliation(value) {
  if (!exact(value, ['status', 'reason', 'retiredCount']) || value.reason !== null
    || !Number.isSafeInteger(value.retiredCount) || value.retiredCount < 0
    || value.retiredCount > 5) return null;
  if (value.status === 'applied' && value.retiredCount > 0) return value;
  if (value.status === 'complete_no_change' && value.retiredCount === 0) return value;
  return null;
}

export function scoreOrderedHistoryAudit(report, options = {}) {
  const errors = [];
  const metrics = {
    histories: historyCases.length,
    windows: historyCases.reduce((total, history) => total + history.windows.length, 0),
    requiredFacts: historyRubric.reduce((total, rubric) => total + rubric.required.length, 0),
    queries: historyCases.reduce((total, history) => total + history.queries.length, 0),
    historicalAssertions: 0,
    justifiedHistoricalAssertions: 0,
    retirements: 0,
  };
  const reject = code => { if (!errors.includes(code)) errors.push(code); };
  let v1Review;
  let historyReview;
  try {
    if (!exact(options, ['v1Review', 'historyReview'])) reject('invalid_review_options');
    else {
      const selected = { v1Review: options.v1Review, historyReview: options.historyReview };
      v1Review = selected.v1Review;
      historyReview = selected.historyReview;
    }
  } catch { reject('invalid_review_options'); }
  const historical = new Map();
  const retirements = new Set();

  try {
    if (!exact(report, ['version', 'sourceVersion', 'ordering', 'evidence', 'v1Projection'])
      || report.version !== ORDERED_HISTORY_VERSION
      || report.sourceVersion !== 'conversation-history-v1'
      || !same(report.ordering, ORDERED_HISTORY_MAPPING)) reject('invalid_ordered_report');

    const evidence = report?.evidence;
    if (!exact(evidence, ['version', 'kind', 'cases', 'status'])
      || evidence.version !== RAW_VERSION || evidence.kind !== RAW_KIND
      || evidence.status !== 'completed' || !Array.isArray(evidence.cases)
      || evidence.cases.length !== historyCases.length) reject('incomplete_raw_evidence');

    for (const [caseIndex, history] of historyCases.entries()) {
      const actual = evidence?.cases?.[caseIndex];
      const namespace = expectedNamespace(history);
      if (!exact(actual, ['id', 'namespace', 'windows', 'recalls', 'status'])
        || actual.id !== history.id || actual.status !== 'completed'
        || !same(actual.namespace, namespace) || !Array.isArray(actual.windows)
        || actual.windows.length !== history.windows.length || !Array.isArray(actual.recalls)
        || actual.recalls.length !== history.queries.length) reject('incomplete_raw_history');

      let previous = new Map();
      const admitted = new Map();
      const firstHistoricalWindow = new Map();
      for (const [windowIndex, messages] of history.windows.entries()) {
        const window = actual?.windows?.[windowIndex];
        const causal = { streamId: `conversation-history-v1-${history.id}`, sequence: windowIndex + 1 };
        const requiredWindowFields = ['index', 'messages', 'causal', 'status', 'capture', 'records',
          'receiptBindingsValid', 'reopenedRecords', 'reopenPersisted', 'diagnostics'];
        if (!exact(window, requiredWindowFields) || window.index !== windowIndex
          || window.status !== 'completed' || !same(window.messages, messages)
          || !same(window.causal, causal) || window.capture?.ok !== true
          || window.capture?.value?.duplicate !== false
          || !classified(window.capture?.value?.classification)
          || !Array.isArray(window.capture?.value?.admission?.memories)
          || !Array.isArray(window.records) || !Array.isArray(window.reopenedRecords)
          || !same(window.records, window.reopenedRecords) || window.reopenPersisted !== true
          || window.receiptBindingsValid !== true || !Array.isArray(window.diagnostics)) {
          reject('invalid_raw_window');
        }

        const outcome = reconciliation(window?.capture?.value?.reconciliation);
        if (!outcome) reject('invalid_reconciliation_outcome');
        const current = new Map();
        const newlyHistorical = [];
        for (const record of Array.isArray(window?.records) ? window.records : []) {
          if (!validRecord(record, namespace, history, windowIndex)) {
            reject('invalid_raw_record');
            continue;
          }
          const memoryId = record.memory.id;
          if (current.has(memoryId)) { reject('duplicate_raw_record'); continue; }
          current.set(memoryId, record);
          const prior = previous.get(memoryId);
          if (prior) {
            if (prior.memory.content !== record.memory.content
              || prior.receipts.some(oldReceipt =>
                !record.receipts.some(newReceipt => same(oldReceipt, newReceipt)))) {
              reject('mutated_raw_history');
            }
            if (prior.memory.state === 'active' && record.memory.state === 'historical') {
              if (record.memory.revision !== prior.memory.revision + 1) reject('invalid_history_revision');
              newlyHistorical.push(record);
              firstHistoricalWindow.set(memoryId, windowIndex);
            } else if (prior.memory.state === 'active' && record.memory.state === 'active') {
              if (record.memory.revision < prior.memory.revision) reject('invalid_history_revision');
            } else if (record.memory.state !== 'historical'
              || record.memory.revision !== prior.memory.revision) reject('invalid_history_revision');
          } else if (record.memory.state === 'historical') {
            reject('missing_predecessor_evidence');
            firstHistoricalWindow.set(memoryId, windowIndex);
          }

          if (record.memory.state === 'historical') {
            const identity = key(history.id, memoryId, record.memory.revision);
            historical.set(identity, record);
          } else if (Object.hasOwn(record, 'supersession')) reject('active_supersession');
        }
        for (const memoryId of previous.keys()) {
          if (!current.has(memoryId)) reject('missing_prior_memory');
        }

        for (const item of window?.capture?.value?.admission?.memories ?? []) {
          if (typeof item?.id !== 'string' || !item.id.length
            || !Number.isSafeInteger(item.revision) || item.revision < 1
            || !current.has(item.id) || current.get(item.id).memory.revision < item.revision) {
            reject('missing_admitted_memory');
            continue;
          }
          admitted.set(item.id, current.get(item.id).memory.content);
        }
        for (const [memoryId, content] of admitted) {
          if (!current.has(memoryId) || current.get(memoryId).memory.content !== content) {
            reject('missing_admitted_memory');
          }
        }

        if (outcome && outcome.retiredCount !== newlyHistorical.length) {
          reject('retirement_count_mismatch');
        }
        for (const record of current.values()) {
          if (record.memory.state !== 'historical') continue;
          const isNew = newlyHistorical.some(newRecord => newRecord.memory.id === record.memory.id);
          const relation = record.supersession;
          const successor = current.get(relation?.replacement?.memoryId);
          const selected = relation?.receiptIds;
          const retirementWindow = firstHistoricalWindow.get(record.memory.id);
          const firstWindowUserEvidence = Array.isArray(selected) && selected.some(receiptId =>
            successor?.receipts?.some(receipt => receipt.id === receiptId && receipt.role === 'user'
              && receipt.sessionId === `${history.id}-window-${retirementWindow}`));
          if (!exact(relation, ['previousRevision', 'replacement', 'receiptIds', 'evidenceAvailable'])
            || relation.previousRevision !== record.memory.revision - 1
            || !exact(relation.replacement,
              ['memoryId', 'revision', 'currentRevision', 'state'])
            || relation.replacement.memoryId === record.memory.id || !successor
            || !same(successor.memory.namespace, namespace)
            || !Number.isSafeInteger(relation.replacement.revision)
            || relation.replacement.revision < 1
            || relation.replacement.revision > relation.replacement.currentRevision
            || (isNew && relation.replacement.revision !== successor.memory.revision)
            || relation.replacement.currentRevision !== successor.memory.revision
            || relation.replacement.state !== successor.memory.state
            || !Array.isArray(selected) || selected.length < 1 || selected.length > 4
            || new Set(selected).size !== selected.length || relation.evidenceAvailable !== true
            || selected.some(receiptId => typeof receiptId !== 'string'
              || !successor.receipts.some(receipt => receipt.id === receiptId))
            || !firstWindowUserEvidence) reject('invalid_history_transition');
          else if (isNew) {
            retirements.add(key(history.id, record.memory.id, record.memory.revision));
          }
        }
        previous = current;
      }

      for (const [queryIndex, fixture] of history.queries.entries()) {
        const recall = actual?.recalls?.[queryIndex];
        if (recall?.id !== fixture.id || recall.query !== fixture.query) reject('invalid_raw_recall_sequence');
      }

      if (history.id === 'H2-across-window-update') {
        const finalWindow = actual?.windows?.at(-1);
        const finalOutcome = reconciliation(finalWindow?.capture?.value?.reconciliation);
        const priorIds = new Set((actual?.windows?.at(-2)?.records ?? [])
          .filter(record => record?.memory?.state === 'active').map(record => record.memory.id));
        const transitioned = (finalWindow?.records ?? []).some(record => priorIds.has(record?.memory?.id)
          && record.memory.state === 'historical'
          && retirements.has(key(history.id, record.memory.id, record.memory.revision)));
        if (finalOutcome?.status !== 'applied' || finalOutcome.retiredCount < 1 || !transitioned) {
          reject('missing_h2_transition');
        }
      }
    }

    let projected;
    try { projected = projectOrderedHistoryAudit(report.evidence); }
    catch { reject('invalid_projection'); }
    if (!projected || !same(report.v1Projection, projected)) reject('invalid_projection');
  } catch { reject('malformed_raw_evidence'); }

  metrics.historicalAssertions = historical.size;
  metrics.retirements = retirements.size;

  let v1Score;
  try { v1Score = scoreHistoryAudit(report?.v1Projection, v1Review); }
  catch { v1Score = { status: 'failed', errors: ['malformed_evidence'], metrics: {} }; }
  if (v1Score?.status !== 'passed') reject('v1_score_failed');

  try {
    if (!exact(historyReview, ['version', 'reviewerType', 'assertions'])
      || historyReview.version !== orderedHistoryReviewVersion
      || historyReview.reviewerType !== 'agent' || !Array.isArray(historyReview.assertions)) {
      reject('invalid_history_review');
    } else {
      const labels = new Map();
      for (const label of historyReview.assertions) {
        if (!exact(label,
          ['historyId', 'memoryId', 'revision', 'supported', 'retirementJustified'])
          || typeof label.historyId !== 'string' || typeof label.memoryId !== 'string'
          || !Number.isSafeInteger(label.revision) || label.revision < 1
          || typeof label.supported !== 'boolean'
          || typeof label.retirementJustified !== 'boolean') {
          reject('invalid_history_review');
          continue;
        }
        const identity = key(label.historyId, label.memoryId, label.revision);
        if (!historical.has(identity) || labels.has(identity)) {
          reject('invalid_history_review');
          continue;
        }
        labels.set(identity, label);
      }
      if (labels.size !== historical.size) reject('invalid_history_review');
      for (const label of labels.values()) {
        if (!label.supported) reject('unsupported_historical_assertion');
        if (!label.retirementJustified) reject('unjustified_retirement');
        if (label.supported && label.retirementJustified) metrics.justifiedHistoricalAssertions += 1;
      }
    }
  } catch { reject('invalid_history_review'); }

  return { status: errors.length ? 'failed' : 'passed', errors, v1Score, metrics };
}

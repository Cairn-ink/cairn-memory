import { historyCases, historyVersion } from './history-cases.mjs';
import { historyRubric } from './history-rubric.mjs';
import { historyReceiptBindingsValid } from './history-runner.mjs';

export const historyReviewVersion = 'conversation-history-review-v1';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const key = (...parts) => JSON.stringify(parts);
const assertionKey = (historyId, memory) => key(historyId, memory?.id, memory?.revision);
const labelKey = (label) => key(label.historyId, label.memoryId, label.revision);
const exact = (value, keys) => value !== null && typeof value === 'object' && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...keys].sort());
const validMemory = (record) => typeof record?.memory?.id === 'string' && record.memory.id.length > 0
  && Number.isSafeInteger(record.memory.revision) && record.memory.revision > 0
  && typeof record.memory.content === 'string' && record.memory.content.length > 0;
const classified = (classification) => classification?.status === 'applied'
  || (classification?.status === 'skipped' && ['empty', 'already_filed'].includes(classification.reason));

export function scoreHistoryAudit(report, review) {
  const errors = [];
  const metrics = { assertions: 0, supported: 0, finalAssertions: 0, stale: 0,
    requiredFacts: historyRubric.reduce((total, rubric) => total + rubric.required.length, 0),
    retained: 0, recalled: 0, relevant: 0,
    queries: historyCases.reduce((total, history) => total + history.queries.length, 0), answered: 0 };
  const reject = (code) => { if (!errors.includes(code)) errors.push(code); };
  const assertions = new Map();
  const final = new Map();
  const returned = new Map();
  const queries = new Map();
  const required = new Map();
  // Fixed denominators survive even an absent or malformed execution report.
  historyCases.forEach((history, caseIndex) => {
    history.queries.forEach((query, index) => queries.set(key(history.id, query.id), report?.cases?.[caseIndex]?.recalls?.[index]));
    historyRubric.find((rubric) => rubric.id === history.id).required.forEach((_, index) => required.set(key(history.id, index), history.id));
  });
  try {
    if (report?.version !== historyVersion || report.kind !== 'synthetic-multi-turn-history'
      || report.status !== 'completed' || !Array.isArray(report.cases)
      || report.cases.length !== historyCases.length) reject('incomplete_report');
    for (const [caseIndex, history] of historyCases.entries()) {
      const actual = report?.cases?.[caseIndex];
      if (actual?.id !== history.id || actual.status !== 'completed'
        || !same(actual.namespace, { ownerId: `synthetic-${history.id}`, scope: 'project', projectId: 'synthetic-history' })
        || !Array.isArray(actual.windows) || actual.windows.length !== history.windows.length
        || !Array.isArray(actual.recalls) || actual.recalls.length !== history.queries.length) {
        reject('incomplete_history');
      }
      for (const [index, messages] of history.windows.entries()) {
        const window = actual?.windows?.[index];
        if (window?.index !== index || window.status !== 'completed' || !same(window.messages, messages)
          || window.capture?.ok !== true || !classified(window.capture.value?.classification)
          || !Array.isArray(window.capture.value?.admission?.memories)
          || !window.capture.value.admission.memories.every((admitted) =>
            window.records?.some((record) => record.memory?.id === admitted.id
              && record.memory.revision >= admitted.revision))
          || !Array.isArray(window.records) || !Array.isArray(window.diagnostics)
          || !same(window.records, window.reopenedRecords) || window.reopenPersisted !== true
          || window.receiptBindingsValid !== true
          || !historyReceiptBindingsValid(window.records, history.windows.slice(0, index + 1), history.id)) {
          reject('invalid_window_evidence');
        }
        const seen = new Set();
        for (const record of Array.isArray(window?.records) ? window.records : []) {
          if (!validMemory(record) || !same(record.memory.namespace, actual?.namespace)
            || record.memory.state !== 'active') { reject('invalid_assertion'); continue; }
          const identity = assertionKey(history.id, record.memory);
          if (seen.has(identity)) reject('duplicate_assertion');
          seen.add(identity);
          const previous = assertions.get(identity);
          if (previous && !same(previous.memory, record.memory)) reject('conflicting_assertion_identity');
          assertions.set(identity, record);
        }
      }
      const latestRecords = (Array.isArray(actual?.windows) ? actual.windows : [])
        .filter((window) => Array.isArray(window?.records)).at(-1)?.records ?? [];
      for (const record of latestRecords) if (validMemory(record)) final.set(assertionKey(history.id, record.memory), record);
      for (const [index, fixture] of history.queries.entries()) {
        const query = actual?.recalls?.[index];
        const identity = key(history.id, fixture.id);
        queries.set(identity, query);
        const response = query?.result;
        if (query?.id !== fixture.id || query.query !== fixture.query || query.status !== 'completed'
          || response?.ok !== true || response.value?.coverage !== 'complete'
          || !Array.isArray(response.value?.memories) || !Array.isArray(response.value?.namespaces)
          || response.value.namespaces.length !== 1
          || !response.value.namespaces.every((ns) => same(ns.namespace, actual?.namespace)
            && ns.mapExhausted === true && ns.fetchExhausted === true)
          || !Array.isArray(query.diagnostics)) reject('incomplete_recall');
        const seen = new Set();
        for (const record of response?.value?.memories ?? []) {
          const sourceIdentity = assertionKey(history.id, record.memory);
          const recalledIdentity = key(history.id, fixture.id, record.memory?.id, record.memory?.revision);
          if (!validMemory(record) || !final.has(sourceIdentity)
            || !same(final.get(sourceIdentity)?.memory, record.memory)
            || !historyReceiptBindingsValid([record], history.windows, history.id)
            || !record.receipts?.every((receipt) => final.get(sourceIdentity)?.receipts?.some((stored) => same(stored, receipt)))) {
            reject('unbound_recalled_assertion');
          }
          if (seen.has(recalledIdentity)) reject('duplicate_recalled_assertion');
          seen.add(recalledIdentity); returned.set(recalledIdentity, { sourceIdentity });
        }
      }
    }
    metrics.assertions = assertions.size; metrics.finalAssertions = final.size;
    metrics.recalled = returned.size;
    if (!exact(review, ['version', 'reviewerType', 'assertions', 'currentness', 'retention', 'relevance', 'answers'])
      || review.version !== historyReviewVersion || review.reviewerType !== 'agent') {
      reject('invalid_review'); return { status: 'failed', errors, metrics };
    }
    const validateLabels = (labels, expected, fields, identity, validate, code) => {
      const result = new Map();
      if (!Array.isArray(labels)) { reject(code); return result; }
      for (const label of labels) {
        if (!exact(label, fields) || !validate(label)) { reject(code); continue; }
        const id = identity(label);
        if (!expected.has(id) || result.has(id)) { reject(code); continue; }
        result.set(id, label);
      }
      if (result.size !== expected.size) reject(code);
      return result;
    };
    const identityFields = ['historyId', 'memoryId', 'revision'];
    const support = validateLabels(review.assertions, assertions, [...identityFields, 'supported'], labelKey,
      (label) => typeof label.supported === 'boolean', 'invalid_source_labels');
    const currentness = validateLabels(review.currentness, final, [...identityFields, 'status'], labelKey,
      (label) => ['current', 'historical', 'stale'].includes(label.status), 'invalid_currentness_labels');
    const retention = validateLabels(review.retention, required,
      ['historyId', 'requiredIndex', 'retained', 'evidence'], (label) => key(label.historyId, label.requiredIndex),
      (label) => typeof label.retained === 'boolean' && Array.isArray(label.evidence), 'invalid_retention_labels');
    const relevance = validateLabels(review.relevance, returned, [...identityFields, 'queryId', 'relevant'],
      (label) => key(label.historyId, label.queryId, label.memoryId, label.revision),
      (label) => typeof label.relevant === 'boolean', 'invalid_relevance_labels');
    const answers = validateLabels(review.answers, queries, ['historyId', 'queryId', 'answered'],
      (label) => key(label.historyId, label.queryId), (label) => typeof label.answered === 'boolean', 'invalid_answer_labels');
    for (const label of support.values()) {
      if (label.supported) metrics.supported += 1; else reject('unsupported_assertion');
    }
    for (const label of currentness.values()) {
      if (label.status === 'stale') { metrics.stale += 1; reject('stale_current_assertion'); }
    }
    for (const label of retention.values()) {
      const seen = new Set();
      let bound = true;
      for (const evidence of label.evidence) {
        if (!exact(evidence, ['memoryId', 'revision'])) { bound = false; continue; }
        const identity = key(label.historyId, evidence.memoryId, evidence.revision);
        if (seen.has(identity) || !final.has(identity) || support.get(identity)?.supported !== true
          || currentness.get(identity)?.status !== 'current') bound = false;
        seen.add(identity);
      }
      if (!bound || (label.retained && !seen.size) || (!label.retained && seen.size)) reject('unbound_retention_evidence');
      if (label.retained && bound && seen.size) metrics.retained += 1; else reject('required_fact_missing');
    }
    for (const [identity, label] of relevance) {
      if (label.relevant && support.get(returned.get(identity).sourceIdentity)?.supported === true
        && currentness.get(returned.get(identity).sourceIdentity)?.status !== 'stale') metrics.relevant += 1;
      else reject('irrelevant_or_stale_recall');
    }
    for (const [identity, label] of answers) {
      if (label.answered && queries.get(identity)?.result?.value?.memories?.length > 0) metrics.answered += 1;
      else reject('required_answer_missing');
    }
  } catch { reject('malformed_evidence'); }
  metrics.assertions = assertions.size; metrics.finalAssertions = final.size; metrics.recalled = returned.size;
  return { status: errors.length ? 'failed' : 'passed', errors, metrics };
}

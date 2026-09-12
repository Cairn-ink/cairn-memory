import { createHash } from 'node:crypto';
import { currentnessCases, currentnessVersion } from './currentness-cases.mjs';
import { currentnessRubric } from './currentness-rubric.mjs';
import { CURRENTNESS_ORDERING, CURRENTNESS_REPORT_VERSION } from './currentness-runner.mjs';

export const currentnessReviewVersion = 'currentness-review-v1';

const SOURCE_CLIENT = 'currentness-audit';
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const key = (...parts) => JSON.stringify(parts);
const exact = (value, fields) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Reflect.ownKeys(value);
  return keys.every(entry => typeof entry === 'string')
    && same(keys.sort(), [...fields].sort());
};
const nonemptyString = value => typeof value === 'string' && value.length > 0;
const positiveRevision = value => Number.isSafeInteger(value) && value > 0;
const propositionIndex = value => Number.isSafeInteger(value) && value >= 0;
const namespaceKeys = fixture => [...new Set([
  ...fixture.windows.map(window => window.namespaceKey),
  ...fixture.queries.map(query => query.namespaceKey),
])].sort();
const namespace = (fixture, namespaceKey) => ({ ownerId: `synthetic-${fixture.id}`,
  scope: 'project', projectId: `synthetic-currentness-${namespaceKey}` });
const validMemory = record => typeof record?.memory?.id === 'string'
  && record.memory.id.length > 0 && Number.isSafeInteger(record.memory.revision)
  && record.memory.revision > 0 && typeof record.memory.content === 'string'
  && record.memory.content.length > 0 && ['active', 'historical'].includes(record.memory.state);
const classified = classification => classification?.status === 'applied'
  || (classification?.status === 'skipped'
    && ['empty', 'already_filed'].includes(classification.reason));

export function currentnessReportDigest(report) {
  return createHash('sha256').update(JSON.stringify(report), 'utf8').digest('hex');
}

function reconciliation(value) {
  if (!exact(value, ['status', 'reason', 'retiredCount']) || value.reason !== null
    || !Number.isSafeInteger(value.retiredCount) || value.retiredCount < 0
    || value.retiredCount > 5) return null;
  if (value.status === 'applied' && value.retiredCount > 0) return value;
  if (value.status === 'complete_no_change' && value.retiredCount === 0) return value;
  return null;
}

function receiptBound(receipt, fixture, namespaceKey, throughWindow) {
  if (typeof receipt?.id !== 'string' || !receipt.id.length
    || receipt.client !== SOURCE_CLIENT) return false;
  return fixture.windows.slice(0, throughWindow + 1).some((window, index) =>
    window.namespaceKey === namespaceKey
    && receipt.sessionId === `${fixture.id}-window-${index}`
    && window.messages.some(message => receipt.eventId === message.id
      && receipt.role === message.role && receipt.excerpt === message.content));
}

function validRecord(record, expectedNamespace, fixture, namespaceKey, throughWindow) {
  if (!validMemory(record) || !same(record.memory.namespace, expectedNamespace)
    || !Array.isArray(record.receipts) || record.receipts.length === 0) return false;
  const ids = new Set();
  for (const receipt of record.receipts) {
    if (!receiptBound(receipt, fixture, namespaceKey, throughWindow) || ids.has(receipt.id)) return false;
    ids.add(receipt.id);
  }
  return true;
}

function validRawRecord(record, expectedNamespace, fixture, namespaceKey, throughWindow) {
  const fields = Object.hasOwn(record ?? {}, 'supersession')
    ? ['memory', 'receipts', 'supersession'] : ['memory', 'receipts'];
  return exact(record, fields)
    && validRecord(record, expectedNamespace, fixture, namespaceKey, throughWindow);
}

export function scoreCurrentnessAudit(report, options = {}) {
  const errors = [];
  const metrics = {
    cases: currentnessCases.length,
    windows: currentnessCases.reduce((total, fixture) => total + fixture.windows.length, 0),
    queries: currentnessCases.reduce((total, fixture) => total + fixture.queries.length, 0),
    requiredFacts: currentnessRubric.reduce((total, rubric) => total + rubric.required.length, 0),
    forbiddenFacts: currentnessRubric.reduce((total, rubric) => total + rubric.forbidden.length, 0),
    assertions: 0,
    historicalAssertions: 0,
    retirements: 0,
    supportedAssertions: 0,
    validCurrentnessAssertions: 0,
    justifiedRetirements: 0,
    requiredMet: 0,
    forbiddenAbsent: 0,
    answeredQueries: 0,
    recalledMemories: 0,
    relevantMemories: 0,
  };
  const reject = code => { if (!errors.includes(code)) errors.push(code); };
  let review;
  try {
    if (!exact(options, ['review'])) reject('invalid_review_options');
    else review = options.review;
  } catch { reject('invalid_review_options'); }

  const assertions = new Map();
  const historical = new Set();
  const retirements = new Set();
  const finalRecords = new Map();
  const recalled = new Map();
  const queryResults = new Map();

  try {
    if (!exact(report, ['version', 'sourceVersion', 'ordering', 'status', 'cases'])
      || report.version !== CURRENTNESS_REPORT_VERSION
      || report.sourceVersion !== currentnessVersion
      || !same(report.ordering, CURRENTNESS_ORDERING) || report.status !== 'completed'
      || !Array.isArray(report.cases) || report.cases.length !== currentnessCases.length) {
      reject('invalid_currentness_report');
    }

    for (const [caseIndex, fixture] of currentnessCases.entries()) {
      const actual = report?.cases?.[caseIndex];
      const keys = namespaceKeys(fixture);
      const expectedNamespaces = keys.map(namespaceKey =>
        ({ key: namespaceKey, namespace: namespace(fixture, namespaceKey) }));
      if (!exact(actual, ['id', 'namespaces', 'status', 'windows', 'recalls'])
        || actual.id !== fixture.id || !same(actual.namespaces, expectedNamespaces)
        || actual.status !== 'completed' || !Array.isArray(actual.windows)
        || actual.windows.length !== fixture.windows.length || !Array.isArray(actual.recalls)
        || actual.recalls.length !== fixture.queries.length) reject('invalid_currentness_case');

      const previous = new Map(keys.map(namespaceKey => [namespaceKey, new Map()]));
      const admitted = new Map(keys.map(namespaceKey => [namespaceKey, new Map()]));
      const firstHistoricalWindow = new Map();
      const retirementAdmissions = new Map();
      const localSequences = new Map(keys.map(namespaceKey => [namespaceKey, 0]));

      for (const [windowIndex, sourceWindow] of fixture.windows.entries()) {
        const window = actual?.windows?.[windowIndex];
        const sequence = localSequences.get(sourceWindow.namespaceKey) + 1;
        localSequences.set(sourceWindow.namespaceKey, sequence);
        const causal = { streamId: `currentness-v1-${fixture.id}-${sourceWindow.namespaceKey}`, sequence };
        const fields = ['index', 'namespaceKey', 'messages', 'causal', 'status', 'capture',
          'snapshots', 'reopenedSnapshots', 'receiptBindingsValid', 'reopenPersisted', 'diagnostics'];
        if (!exact(window, fields) || window.index !== windowIndex
          || window.namespaceKey !== sourceWindow.namespaceKey
          || !same(window.messages, sourceWindow.messages) || !same(window.causal, causal)
          || window.status !== 'completed' || window.capture?.ok !== true
          || window.capture?.value?.duplicate !== false
          || !classified(window.capture?.value?.classification)
          || !Array.isArray(window.capture?.value?.admission?.memories)
          || !Array.isArray(window.snapshots) || !Array.isArray(window.reopenedSnapshots)
          || window.snapshots.length !== keys.length || window.reopenedSnapshots.length !== keys.length
          || !same(window.snapshots, window.reopenedSnapshots)
          || window.receiptBindingsValid !== true || window.reopenPersisted !== true
          || !Array.isArray(window.diagnostics)) reject('invalid_currentness_window');

        const outcome = reconciliation(window?.capture?.value?.reconciliation);
        if (!outcome) reject('invalid_reconciliation_outcome');
        const snapshots = new Map();
        for (const [namespaceIndex, namespaceKey] of keys.entries()) {
          const expectedNamespace = namespace(fixture, namespaceKey);
          const snapshot = window?.snapshots?.[namespaceIndex];
          const reopened = window?.reopenedSnapshots?.[namespaceIndex];
          if (!exact(snapshot, ['key', 'namespace', 'records'])
            || snapshot.key !== namespaceKey || !same(snapshot.namespace, expectedNamespace)
            || !Array.isArray(snapshot.records) || !same(snapshot, reopened)) {
            reject('invalid_namespace_snapshot');
          }
          const records = new Map();
          for (const record of Array.isArray(snapshot?.records) ? snapshot.records : []) {
            if (!validRawRecord(record, expectedNamespace, fixture, namespaceKey, windowIndex)) {
              reject('invalid_currentness_record');
              continue;
            }
            const memoryId = record.memory.id;
            if (records.has(memoryId)) { reject('duplicate_currentness_record'); continue; }
            records.set(memoryId, record);
            const identity = key(fixture.id, namespaceKey, memoryId, record.memory.revision);
            assertions.set(identity, { caseId: fixture.id, namespaceKey, record });
            if (record.memory.state === 'historical') historical.add(identity);
            else if (Object.hasOwn(record, 'supersession')) reject('active_supersession');
          }
          snapshots.set(namespaceKey, records);
        }

        const targetRecords = snapshots.get(sourceWindow.namespaceKey) ?? new Map();
        const windowAdmissions = new Map();
        for (const item of window?.capture?.value?.admission?.memories ?? []) {
          if (!exact(item, ['id', 'revision']) || typeof item.id !== 'string' || !item.id.length
            || !Number.isSafeInteger(item.revision) || item.revision < 1
            || !targetRecords.has(item.id) || targetRecords.get(item.id).memory.revision < item.revision
            || windowAdmissions.has(item.id)) {
            reject('invalid_admission_binding');
            continue;
          }
          windowAdmissions.set(item.id, item);
          admitted.get(sourceWindow.namespaceKey).set(item.id, targetRecords.get(item.id).memory.content);
        }

        let newlyHistoricalCount = 0;
        for (const namespaceKey of keys) {
          const priorRecords = previous.get(namespaceKey);
          const currentRecords = snapshots.get(namespaceKey) ?? new Map();
          if (namespaceKey !== sourceWindow.namespaceKey
            && !same([...priorRecords.values()], [...currentRecords.values()])) {
            reject('non_target_namespace_changed');
          }
          for (const memoryId of priorRecords.keys()) {
            if (!currentRecords.has(memoryId)) reject('missing_prior_memory');
          }
          for (const [memoryId, record] of currentRecords) {
            const prior = priorRecords.get(memoryId);
            if (!prior) {
              if (namespaceKey !== sourceWindow.namespaceKey || !windowAdmissions.has(memoryId)) {
                reject('unbound_new_memory');
              }
              if (record.memory.state === 'historical') reject('missing_predecessor_evidence');
              continue;
            }
            if (prior.memory.content !== record.memory.content
              || prior.receipts.some(oldReceipt =>
                !record.receipts.some(newReceipt => same(oldReceipt, newReceipt)))) {
              reject('mutated_currentness_history');
            }
            if (prior.memory.state === 'active' && record.memory.state === 'historical') {
              if (namespaceKey !== sourceWindow.namespaceKey
                || record.memory.revision !== prior.memory.revision + 1) {
                reject('invalid_history_revision');
              }
              newlyHistoricalCount += 1;
              const historyKey = key(namespaceKey, memoryId);
              firstHistoricalWindow.set(historyKey, windowIndex);
            } else if (prior.memory.state === 'active' && record.memory.state === 'active') {
              if (record.memory.revision < prior.memory.revision) reject('invalid_active_revision');
            } else if (record.memory.state !== 'historical'
              || record.memory.revision !== prior.memory.revision) reject('historical_resurrection');
          }
          for (const [memoryId, content] of admitted.get(namespaceKey)) {
            if (!currentRecords.has(memoryId) || currentRecords.get(memoryId).memory.content !== content) {
              reject('missing_admitted_memory');
            }
          }
        }

        if (outcome && outcome.retiredCount !== newlyHistoricalCount) reject('retirement_count_mismatch');
        const positiveWindow = ['C1-explicit-update', 'C4-subject-and-property'].includes(fixture.id)
          && windowIndex === fixture.windows.length - 1;
        if (positiveWindow) {
          if (outcome?.status !== 'applied' || newlyHistoricalCount < 1) reject('missing_required_retirement');
        } else if (outcome?.status !== 'complete_no_change' || newlyHistoricalCount !== 0) {
          reject('unexpected_retirement');
        }

        for (const namespaceKey of keys) {
          const records = snapshots.get(namespaceKey) ?? new Map();
          for (const record of records.values()) {
            if (record.memory.state !== 'historical') continue;
            const historyKey = key(namespaceKey, record.memory.id);
            const retirementWindow = firstHistoricalWindow.get(historyKey);
            const isNew = retirementWindow === windowIndex;
            const relation = record.supersession;
            const successor = records.get(relation?.replacement?.memoryId);
            if (isNew) retirementAdmissions.set(historyKey,
              windowAdmissions.get(relation?.replacement?.memoryId));
            const boundAdmission = retirementAdmissions.get(historyKey);
            const receiptIds = relation?.receiptIds;
            const hasRetirementUserSource = Array.isArray(receiptIds)
              && receiptIds.some(receiptId => successor?.receipts?.some(receipt =>
                receipt.id === receiptId && receipt.role === 'user'
                && receipt.sessionId === `${fixture.id}-window-${retirementWindow}`));
            if (!exact(relation, ['previousRevision', 'replacement', 'receiptIds', 'evidenceAvailable'])
              || relation.previousRevision !== record.memory.revision - 1
              || !exact(relation.replacement, ['memoryId', 'revision', 'currentRevision', 'state'])
              || relation.replacement.memoryId === record.memory.id || !successor
              || !boundAdmission || relation.replacement.revision !== boundAdmission.revision
              || !Number.isSafeInteger(relation.replacement.revision)
              || relation.replacement.revision < 1
              || relation.replacement.revision > relation.replacement.currentRevision
              || relation.replacement.currentRevision !== successor.memory.revision
              || relation.replacement.state !== successor.memory.state
              || !Array.isArray(receiptIds) || receiptIds.length < 1 || receiptIds.length > 4
              || new Set(receiptIds).size !== receiptIds.length || relation.evidenceAvailable !== true
              || receiptIds.some(receiptId => typeof receiptId !== 'string'
                || !successor.receipts.some(receipt => receipt.id === receiptId))
              || !hasRetirementUserSource) reject('invalid_history_transition');
            else if (isNew) retirements.add(key(fixture.id, namespaceKey,
              record.memory.id, record.memory.revision));
          }
          previous.set(namespaceKey, records);
        }
      }

      for (const namespaceKey of keys) {
        for (const record of previous.get(namespaceKey).values()) {
          finalRecords.set(key(fixture.id, namespaceKey, record.memory.id, record.memory.revision),
            { caseId: fixture.id, namespaceKey, record });
        }
      }

      for (const [queryIndex, sourceQuery] of fixture.queries.entries()) {
        const recall = actual?.recalls?.[queryIndex];
        const identity = key(fixture.id, sourceQuery.id);
        queryResults.set(identity, recall);
        const response = recall?.result;
        const expectedNamespace = namespace(fixture, sourceQuery.namespaceKey);
        if (!exact(recall, ['id', 'namespaceKey', 'query', 'status', 'result', 'diagnostics'])
          || recall.id !== sourceQuery.id || recall.namespaceKey !== sourceQuery.namespaceKey
          || recall.query !== sourceQuery.query || recall.status !== 'completed'
          || response?.ok !== true || response.value?.coverage !== 'complete'
          || !Array.isArray(response.value?.memories) || !Array.isArray(response.value?.namespaces)
          || response.value.namespaces.length !== 1
          || !response.value.namespaces.every(entry => same(entry.namespace, expectedNamespace)
            && entry.mapExhausted === true && entry.fetchExhausted === true)
          || !Array.isArray(recall.diagnostics)) reject('invalid_currentness_recall');
        const seen = new Set();
        for (const record of response?.value?.memories ?? []) {
          const finalIdentity = key(fixture.id, sourceQuery.namespaceKey,
            record?.memory?.id, record?.memory?.revision);
          const recallIdentity = key(fixture.id, sourceQuery.id,
            record?.memory?.id, record?.memory?.revision);
          const stored = finalRecords.get(finalIdentity)?.record;
          if (!validRecord(record, expectedNamespace, fixture,
            sourceQuery.namespaceKey, fixture.windows.length - 1)
            || record.memory.state !== 'active' || !stored || stored.memory.state !== 'active'
            || !same(record.memory, stored.memory)
            || record.receipts.some(receipt =>
              !stored.receipts.some(storedReceipt => same(receipt, storedReceipt)))) {
            reject('unbound_recalled_memory');
          }
          if (seen.has(recallIdentity)) reject('duplicate_recalled_memory');
          seen.add(recallIdentity);
          recalled.set(recallIdentity, { finalIdentity, record });
        }
      }
    }
  } catch { reject('malformed_currentness_evidence'); }

  metrics.assertions = assertions.size;
  metrics.historicalAssertions = historical.size;
  metrics.retirements = retirements.size;
  metrics.recalledMemories = recalled.size;

  let expectedDigest;
  try { expectedDigest = currentnessReportDigest(report); }
  catch { reject('invalid_report_digest'); }

  try {
    if (!exact(review, ['version', 'reviewerType', 'reportDigest', 'assertions', 'required',
      'forbidden', 'queries']) || review.version !== currentnessReviewVersion
      || review.reviewerType !== 'agent' || review.reportDigest !== expectedDigest
      || !Array.isArray(review.assertions) || !Array.isArray(review.required)
      || !Array.isArray(review.forbidden) || !Array.isArray(review.queries)) {
      reject('invalid_currentness_review');
    } else {
      const assertionLabels = new Map();
      for (const label of review.assertions) {
        const scalarIdentity = nonemptyString(label?.caseId) && nonemptyString(label?.namespaceKey)
          && nonemptyString(label?.memoryId) && positiveRevision(label?.revision);
        const identity = scalarIdentity
          ? key(label.caseId, label.namespaceKey, label.memoryId, label.revision) : null;
        const observed = assertions.get(identity)?.record;
        const validRetirement = observed?.memory?.state === 'historical'
          ? typeof label?.retirementJustified === 'boolean' : label?.retirementJustified === null;
        if (!exact(label, ['caseId', 'namespaceKey', 'memoryId', 'revision', 'supported',
          'currentnessValid', 'retirementJustified']) || !scalarIdentity || !observed
          || assertionLabels.has(identity)
          || typeof label.supported !== 'boolean' || typeof label.currentnessValid !== 'boolean'
          || !validRetirement) {
          reject('invalid_assertion_labels');
          continue;
        }
        assertionLabels.set(identity, label);
      }
      if (assertionLabels.size !== assertions.size) reject('invalid_assertion_labels');
      for (const [identity, label] of assertionLabels) {
        if (label.supported) metrics.supportedAssertions += 1;
        else reject('unsupported_assertion');
        if (label.currentnessValid) metrics.validCurrentnessAssertions += 1;
        else reject('invalid_currentness_assertion');
        if (historical.has(identity)) {
          if (label.retirementJustified) metrics.justifiedRetirements += 1;
          else reject('unjustified_retirement');
        }
      }

      const requiredExpected = new Map();
      const forbiddenExpected = new Map();
      for (const rubric of currentnessRubric) {
        rubric.required.forEach((proposition, index) =>
          requiredExpected.set(key(rubric.id, index), proposition));
        rubric.forbidden.forEach((_, index) => forbiddenExpected.set(key(rubric.id, index), true));
      }
      const requiredLabels = new Map();
      for (const label of review.required) {
        const scalarIdentity = nonemptyString(label?.caseId)
          && propositionIndex(label?.requiredIndex);
        const identity = scalarIdentity ? key(label.caseId, label.requiredIndex) : null;
        const proposition = requiredExpected.get(identity);
        if (!exact(label, ['caseId', 'requiredIndex', 'met', 'evidence']) || !scalarIdentity
          || !proposition
          || requiredLabels.has(identity) || typeof label.met !== 'boolean'
          || !Array.isArray(label.evidence)) {
          reject('invalid_required_labels');
          continue;
        }
        let bound = true;
        const references = new Set();
        for (const reference of label.evidence) {
          if (!exact(reference, ['namespaceKey', 'memoryId', 'revision'])
            || !nonemptyString(reference.namespaceKey) || !nonemptyString(reference.memoryId)
            || !positiveRevision(reference.revision)) { bound = false; continue; }
          const referenceIdentity = key(label.caseId, reference.namespaceKey,
            reference.memoryId, reference.revision);
          const final = finalRecords.get(referenceIdentity);
          if (references.has(referenceIdentity) || !final
            || assertionLabels.get(referenceIdentity)?.supported !== true
            || assertionLabels.get(referenceIdentity)?.currentnessValid !== true
            || (proposition.kind === 'memory'
              && (reference.namespaceKey !== proposition.namespaceKey
                || final.record.memory.state !== proposition.state))) bound = false;
          references.add(referenceIdentity);
        }
        if (!bound || (proposition.kind === 'memory' && references.size === 0)) {
          reject('unbound_required_evidence');
        }
        if (label.met) metrics.requiredMet += 1;
        else reject('required_fact_missing');
        requiredLabels.set(identity, label);
      }
      if (requiredLabels.size !== requiredExpected.size) reject('invalid_required_labels');

      const forbiddenLabels = new Map();
      for (const label of review.forbidden) {
        const scalarIdentity = nonemptyString(label?.caseId)
          && propositionIndex(label?.forbiddenIndex);
        const identity = scalarIdentity ? key(label.caseId, label.forbiddenIndex) : null;
        if (!exact(label, ['caseId', 'forbiddenIndex', 'absent'])
          || !scalarIdentity || !forbiddenExpected.has(identity) || forbiddenLabels.has(identity)
          || typeof label.absent !== 'boolean') {
          reject('invalid_forbidden_labels');
          continue;
        }
        if (label.absent) metrics.forbiddenAbsent += 1;
        else reject('forbidden_fact_present');
        forbiddenLabels.set(identity, label);
      }
      if (forbiddenLabels.size !== forbiddenExpected.size) reject('invalid_forbidden_labels');

      const queryLabels = new Map();
      for (const label of review.queries) {
        const scalarIdentity = nonemptyString(label?.caseId) && nonemptyString(label?.queryId);
        const identity = scalarIdentity ? key(label.caseId, label.queryId) : null;
        const result = queryResults.get(identity);
        if (!exact(label, ['caseId', 'queryId', 'answered', 'relevance']) || !result
          || !scalarIdentity || queryLabels.has(identity) || typeof label.answered !== 'boolean'
          || !Array.isArray(label.relevance)) {
          reject('invalid_query_labels');
          continue;
        }
        const expected = new Map();
        for (const record of result?.result?.value?.memories ?? []) {
          expected.set(key(record?.memory?.id, record?.memory?.revision), record);
        }
        const relevance = new Map();
        for (const entry of label.relevance) {
          const scalarIdentity = nonemptyString(entry?.memoryId)
            && positiveRevision(entry?.revision);
          const entryIdentity = scalarIdentity ? key(entry.memoryId, entry.revision) : null;
          if (!exact(entry, ['memoryId', 'revision', 'relevant'])
            || !scalarIdentity || !expected.has(entryIdentity) || relevance.has(entryIdentity)
            || typeof entry.relevant !== 'boolean') {
            reject('invalid_relevance_labels');
            continue;
          }
          if (entry.relevant) metrics.relevantMemories += 1;
          else reject('irrelevant_recalled_memory');
          relevance.set(entryIdentity, entry);
        }
        if (relevance.size !== expected.size) reject('invalid_relevance_labels');
        if (label.answered && expected.size > 0) metrics.answeredQueries += 1;
        else reject('required_answer_missing');
        queryLabels.set(identity, label);
      }
      if (queryLabels.size !== queryResults.size
        || queryResults.size !== metrics.queries) reject('invalid_query_labels');
    }
  } catch { reject('malformed_currentness_review'); }

  return { status: errors.length ? 'failed' : 'passed', errors, metrics };
}

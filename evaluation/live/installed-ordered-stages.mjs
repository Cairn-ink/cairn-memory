import { ORDERED_CAPTURE_LOOP_FIXTURE } from './installed-ordered-fixture.mjs';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const value = envelope => envelope?.ok === true ? envelope.value : null;
const missing = envelope => envelope?.ok === false && envelope.error?.code === 'memory_not_found';
const stale = envelope => envelope?.ok === false && envelope.error?.code === 'revision_conflict';
const exact = (candidate, fields) => {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) return false;
  const keys = Reflect.ownKeys(candidate);
  return keys.every(key => typeof key === 'string')
    && same(keys.sort(), [...fields].sort());
};
const validId = id => typeof id === 'string' && id.length > 0;
const validRevision = revision => Number.isSafeInteger(revision) && revision > 0;
const validMemory = memory => validId(memory?.id) && validRevision(memory.revision)
  && typeof memory.content === 'string' && memory.content.length > 0
  && ['active', 'historical'].includes(memory.state) && memory.namespace
  && typeof memory.namespace === 'object';
const validReceipt = receipt => validId(receipt?.id) && validId(receipt.client)
  && validId(receipt.sessionId) && validId(receipt.eventId)
  && ['user', 'assistant'].includes(receipt.role) && typeof receipt.excerpt === 'string';

function rawRecord(record) {
  const fields = Object.hasOwn(record ?? {}, 'supersession')
    ? ['memory', 'receipts', 'supersession'] : ['memory', 'receipts'];
  return exact(record, fields) && validMemory(record.memory) && Array.isArray(record.receipts)
    && record.receipts.length > 0 && record.receipts.every(validReceipt)
    && new Set(record.receipts.map(receipt => receipt.id)).size === record.receipts.length;
}

function memoryMetadataMatches(metadata, memory) {
  return validId(metadata?.id) && metadata.id === memory.id
    && metadata.revision === memory.revision && same(metadata.namespace, memory.namespace)
    && metadata.state === memory.state;
}

function inspectSnapshot(snapshot) {
  const result = { valid: false, records: new Map() };
  if (!exact(snapshot, ['listPages', 'getPages', 'records'])
    || !Array.isArray(snapshot.listPages) || snapshot.listPages.length < 1
    || !Array.isArray(snapshot.getPages) || !Array.isArray(snapshot.records)) return result;
  const listed = [];
  for (const page of snapshot.listPages) {
    const body = value(page);
    if (!body || !Array.isArray(body.memories)) return result;
    listed.push(...body.memories);
  }
  const lastList = value(snapshot.listPages.at(-1));
  if (lastList?.exhausted !== true || lastList.nextCursor !== null) return result;
  const listedIds = new Set();
  for (const metadata of listed) {
    if (!validId(metadata?.id) || listedIds.has(metadata.id)) return result;
    listedIds.add(metadata.id);
  }
  for (const record of snapshot.records) {
    if (!rawRecord(record) || result.records.has(record.memory.id)) return result;
    result.records.set(record.memory.id, record);
  }
  if (listedIds.size !== result.records.size
    || listed.some(metadata => !memoryMetadataMatches(metadata,
      result.records.get(metadata.id)?.memory))) return result;
  const inspected = new Set();
  for (const entry of snapshot.getPages) {
    if (!exact(entry, ['memoryId', 'pages']) || !validId(entry.memoryId)
      || inspected.has(entry.memoryId) || !result.records.has(entry.memoryId)
      || !Array.isArray(entry.pages) || entry.pages.length < 1) return result;
    const record = result.records.get(entry.memoryId);
    const receipts = [];
    for (const page of entry.pages) {
      const body = value(page);
      if (!body || !same(body.memory, record.memory) || !Array.isArray(body.receipts)
        || body.receipts.some(receipt => !validReceipt(receipt))) return result;
      if (Object.hasOwn(record, 'supersession')
        ? !same(body.supersession, record.supersession)
        : Object.hasOwn(body, 'supersession')) return result;
      receipts.push(...body.receipts);
    }
    const last = value(entry.pages.at(-1));
    if (last?.exhausted !== true || last.nextReceiptCursor !== null
      || !same(receipts, record.receipts)) return result;
    inspected.add(entry.memoryId);
  }
  result.valid = inspected.size === result.records.size;
  return result;
}

function inspectPages(first, pages) {
  const result = { valid: false, record: null };
  if (!Array.isArray(pages) || pages.length < 1 || !same(first, pages[0])) return result;
  const receipts = [];
  let memory;
  let supersession;
  let hasSupersession = false;
  for (const page of pages) {
    const body = value(page);
    if (!body || !validMemory(body.memory) || !Array.isArray(body.receipts)
      || body.receipts.some(receipt => !validReceipt(receipt))) return result;
    if (!memory) memory = body.memory;
    else if (!same(memory, body.memory)) return result;
    const present = Object.hasOwn(body, 'supersession');
    if (pages.indexOf(page) === 0) { hasSupersession = present; supersession = body.supersession; }
    else if (present !== hasSupersession || (present && !same(body.supersession, supersession))) return result;
    receipts.push(...body.receipts);
  }
  const last = value(pages.at(-1));
  if (last?.exhausted !== true || last.nextReceiptCursor !== null
    || new Set(receipts.map(receipt => receipt.id)).size !== receipts.length) return result;
  result.record = { memory, receipts, ...(hasSupersession ? { supersession } : {}) };
  result.valid = rawRecord(result.record);
  return result;
}

function completeRecall(envelope, namespace) {
  const body = value(envelope);
  return body?.coverage === 'complete' && Array.isArray(body.memories)
    && Array.isArray(body.namespaces) && body.namespaces.length === 1
    && body.namespaces.every(entry => same(entry.namespace, namespace)
      && entry.mapExhausted === true && entry.fetchExhausted === true);
}

function sourceReceipt(record, source) {
  const message = source.messages[0];
  return record?.receipts?.some(receipt => receipt.client === ORDERED_CAPTURE_LOOP_FIXTURE.client
    && receipt.sessionId === source.sessionId && receipt.eventId === message.id
    && receipt.role === message.role && receipt.excerpt === message.content);
}

function stableMemory(actual, baseline) {
  return actual?.id === baseline?.id && actual?.revision === baseline?.revision
    && same(actual?.namespace, baseline?.namespace) && actual?.content === baseline?.content
    && actual?.kind === baseline?.kind && actual?.origin === baseline?.origin
    && actual?.confidence === baseline?.confidence && actual?.state === baseline?.state;
}

function stableRecord(actual, baseline) {
  return rawRecord(actual) && rawRecord(baseline)
    && stableMemory(actual.memory, baseline.memory) && same(actual.receipts, baseline.receipts);
}

function recallRecordMatches(actual, baseline) {
  return validMemory(actual?.memory) && Array.isArray(actual.receipts)
    && actual.receipts.length > 0 && actual.receipts.every(validReceipt)
    && new Set(actual.receipts.map(receipt => receipt.id)).size === actual.receipts.length
    && stableMemory(actual.memory, baseline.memory) && same(actual.receipts, baseline.receipts);
}

function completeCapture(capture) {
  const body = value(capture);
  const classification = body?.classification;
  const classified = classification?.status === 'applied'
    || (classification?.status === 'skipped'
      && ['empty', 'already_filed'].includes(classification.reason));
  const reconciliation = body?.reconciliation;
  const reconciled = exact(reconciliation, ['status', 'reason', 'retiredCount'])
    && reconciliation.reason === null && Number.isSafeInteger(reconciliation.retiredCount)
    && reconciliation.retiredCount >= 0 && reconciliation.retiredCount <= 5
    && ((reconciliation.status === 'applied' && reconciliation.retiredCount > 0)
      || (reconciliation.status === 'complete_no_change' && reconciliation.retiredCount === 0));
  return body?.duplicate === false && classified && reconciled
    && Array.isArray(body.admission?.memories);
}

function admitted(capture) {
  const refs = value(capture)?.admission?.memories;
  const result = new Map();
  if (!Array.isArray(refs)) return null;
  for (const ref of refs) {
    if (!exact(ref, ['id', 'revision']) || !validId(ref.id) || !validRevision(ref.revision)
      || result.has(ref.id)) return null;
    result.set(ref.id, ref);
  }
  return result;
}

function relationValid(predecessor, successor, admission, source, unavailable = false) {
  const relation = predecessor?.supersession;
  if (!rawRecord(predecessor) || predecessor.memory.state !== 'historical'
    || !rawRecord(successor) || successor.memory.state !== 'active'
    || predecessor.memory.id === successor.memory.id
    || !same(predecessor.memory.namespace, successor.memory.namespace)
    || !exact(relation, ['previousRevision', 'replacement', 'receiptIds', 'evidenceAvailable'])
    || relation.previousRevision !== predecessor.memory.revision - 1
    || !exact(relation.replacement, ['memoryId', 'revision', 'currentRevision', 'state'])
    || relation.replacement.memoryId !== successor.memory.id
    || relation.replacement.revision !== admission?.revision
    || relation.replacement.revision > relation.replacement.currentRevision
    || relation.replacement.currentRevision !== successor.memory.revision
    || relation.replacement.state !== successor.memory.state) return false;
  if (unavailable) return same(relation.receiptIds, []) && relation.evidenceAvailable === false;
  return Array.isArray(relation.receiptIds) && relation.receiptIds.length >= 1
    && relation.receiptIds.length <= 4
    && new Set(relation.receiptIds).size === relation.receiptIds.length
    && relation.evidenceAvailable === true
    && relation.receiptIds.every(id => successor.receipts.some(receipt => receipt.id === id))
    && relation.receiptIds.some(id => successor.receipts.some(receipt =>
      receipt.id === id && receipt.role === 'user' && receipt.sessionId === source.sessionId
      && receipt.eventId === source.messages[0].id && receipt.excerpt === source.messages[0].content));
}

function correctedRelation(predecessor, successor, admission) {
  const relation = predecessor?.supersession;
  return rawRecord(predecessor) && rawRecord(successor)
    && exact(relation, ['previousRevision', 'replacement', 'receiptIds', 'evidenceAvailable'])
    && relation.previousRevision === predecessor.memory.revision - 1
    && exact(relation.replacement, ['memoryId', 'revision', 'currentRevision', 'state'])
    && relation.replacement.memoryId === successor.memory.id
    && relation.replacement.revision === admission?.revision
    && relation.replacement.revision <= relation.replacement.currentRevision
    && relation.replacement.currentRevision === successor.memory.revision
    && relation.replacement.state === successor.memory.state
    && same(relation.receiptIds, []) && relation.evidenceAvailable === false;
}

function forgottenRelation(predecessor, baseline) {
  return stableRecord(predecessor, baseline)
    && same(predecessor.supersession, { previousRevision: baseline.supersession.previousRevision,
      replacement: null, receiptIds: [], evidenceAvailable: false });
}

function snapshotPreserves(snapshot, state, { successor } = {}) {
  if (!snapshot.valid) return false;
  const predecessor = snapshot.records.get(state.predecessorId);
  if (!stableRecord(predecessor, state.predecessor)) return false;
  if (successor) {
    const actual = snapshot.records.get(state.successorId);
    if (!stableRecord(actual, successor)) return false;
  }
  for (const baseline of state.extraRecords ?? []) {
    if (!stableRecord(snapshot.records.get(baseline.memory.id), baseline)) return false;
  }
  const expected = 1 + (successor ? 1 : 0) + (state.extraRecords?.length ?? 0);
  return snapshot.records.size === expected;
}

function consumerRecord(record, state, expectedSuccessor, snapshotSuccessor = expectedSuccessor) {
  const current = inspectPages(record?.current, record?.currentPages);
  const history = inspectPages(record?.history, record?.historyPages);
  const snapshot = inspectSnapshot(record?.snapshot);
  const memories = completeRecall(record?.recall, state.namespace)
    ? value(record.recall).memories : [];
  const selected = memories.length === 1 ? memories[0] : null;
  return {
    valid: validId(record?.consumerSessionId) && current.valid && history.valid && snapshot.valid
      && selected && recallRecordMatches(selected, current.record)
      && stableRecord(current.record, expectedSuccessor)
      && stableRecord(history.record, state.predecessor)
      && !memories.some(item => item?.memory?.id === state.predecessorId)
      && snapshotPreserves(snapshot, state, { successor: snapshotSuccessor }),
    current: current.record, history: history.record, snapshot,
  };
}

function sessionsFresh(record, state, extras = []) {
  const sessions = [record?.consumerSessionId, ...extras];
  return sessions.every(validId) && new Set(sessions).size === sessions.length
    && sessions.every(session => !(state.consumerSessions ?? []).includes(session));
}

function inspectIsolation(isolation, state) {
  const list = isolation?.listPages;
  const first = value(list?.[0]);
  const last = value(list?.at(-1));
  const after = inspectPages(isolation?.after, isolation?.afterPages);
  const history = inspectPages(isolation?.historyAfter, isolation?.historyAfterPages);
  const snapshot = inspectSnapshot(isolation?.snapshotAfter);
  return validId(isolation?.consumerSessionId) && isolation.namespace
    && Array.isArray(list) && list.length >= 1
    && list.every(page => Array.isArray(value(page)?.memories)
      && value(page).memories.length === 0)
    && first?.memories?.length === 0 && last?.exhausted === true && last.nextCursor === null
    && missing(isolation.get) && missing(isolation.correct)
    && value(isolation.forget)?.forgotten === false
    && isolation.correctArguments?.memoryId === state.successorId
    && isolation.correctArguments?.expectedRevision === state.successor.memory.revision
    && isolation.forgetArguments?.memoryId === state.successorId
    && isolation.forgetArguments?.expectedRevision === state.successor.memory.revision
    && after.valid && stableRecord(after.record, state.successor)
    && history.valid && stableRecord(history.record, state.predecessor)
    && relationValid(history.record, after.record, state.successorAdmission,
      ORDERED_CAPTURE_LOOP_FIXTURE.windows[1])
    && snapshotPreserves(snapshot, state, { successor: state.successor });
}

function stageA(record, next) {
  if (!Array.isArray(record?.windows) || record.windows.length !== 2) return false;
  const observed = [];
  for (const [index, source] of ORDERED_CAPTURE_LOOP_FIXTURE.windows.entries()) {
    const window = record.windows[index];
    if (!exact(window, ['source', 'capture', 'snapshot', 'reopenedSnapshot'])
      || !same(window.source, source) || !completeCapture(window.capture)
      || !same(window.snapshot, window.reopenedSnapshot)) return false;
    const snapshot = inspectSnapshot(window.snapshot);
    if (!snapshot.valid) return false;
    observed.push({ window, snapshot, admissions: admitted(window.capture) });
    if (!observed[index].admissions) return false;
  }
  const first = observed[0];
  if (first.admissions.size !== 1 || first.snapshot.records.size !== 1
    || value(first.window.capture).reconciliation.status !== 'complete_no_change') return false;
  const firstAdmission = [...first.admissions.values()][0];
  const original = first.snapshot.records.get(firstAdmission.id);
  if (!original || original.memory.state !== 'active'
    || firstAdmission.revision > original.memory.revision
    || !original.receipts.every(receipt => sourceReceipt({ receipts: [receipt] },
      ORDERED_CAPTURE_LOOP_FIXTURE.windows[0]))) return false;

  const second = observed[1];
  const predecessor = second.snapshot.records.get(original.memory.id);
  const newlyHistorical = [...second.snapshot.records.values()].filter(item =>
    item.memory.state === 'historical' && first.snapshot.records.get(item.memory.id)?.memory.state === 'active');
  const relation = predecessor?.supersession;
  const successor = second.snapshot.records.get(relation?.replacement?.memoryId);
  const successorAdmission = second.admissions.get(successor?.memory?.id);
  if (!predecessor || predecessor.memory.revision !== original.memory.revision + 1
    || predecessor.memory.content !== original.memory.content
    || !same(predecessor.memory.namespace, original.memory.namespace)
    || predecessor.memory.kind !== original.memory.kind
    || predecessor.memory.origin !== original.memory.origin
    || predecessor.memory.confidence !== original.memory.confidence
    || !same(predecessor.receipts, original.receipts)
    || value(second.window.capture).reconciliation.status !== 'applied'
    || value(second.window.capture).reconciliation.retiredCount !== newlyHistorical.length
    || newlyHistorical.length < 1 || !successorAdmission
    || !relationValid(predecessor, successor, successorAdmission,
      ORDERED_CAPTURE_LOOP_FIXTURE.windows[1])) return false;
  for (const [id, before] of first.snapshot.records) {
    const after = second.snapshot.records.get(id);
    if (!after || before.memory.content !== after.memory.content
      || before.receipts.some(receipt => !after.receipts.some(candidate => same(receipt, candidate)))) return false;
  }
  for (const after of second.snapshot.records.values()) {
    if (!same(after.memory.namespace, original.memory.namespace)) return false;
    if (!first.snapshot.records.has(after.memory.id) && !second.admissions.has(after.memory.id)) return false;
    if (after.memory.state === 'historical' && after.memory.id !== original.memory.id) return false;
    if (!after.receipts.every(receipt => ORDERED_CAPTURE_LOOP_FIXTURE.windows.some(source =>
      sourceReceipt({ receipts: [receipt] }, source)))) return false;
  }
  for (const admission of second.admissions.values()) {
    const admittedRecord = second.snapshot.records.get(admission.id);
    if (!admittedRecord || admission.revision > admittedRecord.memory.revision
      || !admittedRecord.receipts.every(receipt => sourceReceipt({ receipts: [receipt] },
        ORDERED_CAPTURE_LOOP_FIXTURE.windows[1]))) return false;
  }
  next.namespace = successor.memory.namespace;
  next.predecessorId = predecessor.memory.id;
  next.successorId = successor.memory.id;
  next.predecessor = predecessor;
  next.successor = successor;
  next.successorAdmission = successorAdmission;
  next.extraRecords = [...second.snapshot.records.values()].filter(item =>
    ![next.predecessorId, next.successorId].includes(item.memory.id));
  next.consumerSessions = [];
  return true;
}

function stageB(record, state, next) {
  const base = consumerRecord(record, state, state.successor);
  const snapshotHistory = base.snapshot.records.get(state.predecessorId);
  const snapshotSuccessor = base.snapshot.records.get(state.successorId);
  const isolation = inspectIsolation(record?.isolation, state);
  const projectIsolation = inspectIsolation(record?.projectIsolation, state);
  const sessionIds = [record?.isolation?.consumerSessionId,
    record?.projectIsolation?.consumerSessionId];
  if (!base.valid || !relationValid(base.history, base.current, state.successorAdmission,
    ORDERED_CAPTURE_LOOP_FIXTURE.windows[1])
    || !relationValid(snapshotHistory, snapshotSuccessor, state.successorAdmission,
      ORDERED_CAPTURE_LOOP_FIXTURE.windows[1])
    || !isolation || !projectIsolation || !sessionsFresh(record, state, sessionIds)
    || same(record.isolation.namespace, state.namespace)
    || same(record.projectIsolation.namespace, state.namespace)
    || record.isolation.namespace.ownerId === state.namespace.ownerId
    || record.isolation.namespace.projectId !== state.namespace.projectId
    || record.projectIsolation.namespace.ownerId !== state.namespace.ownerId
    || record.projectIsolation.namespace.projectId === state.namespace.projectId) return false;
  next.consumerSessions = [...state.consumerSessions, record.consumerSessionId, ...sessionIds];
  return true;
}

function stageC(record, state, next) {
  const after = inspectPages(record?.after, record?.afterPages);
  const base = consumerRecord(record, state, state.successor, after.record);
  const changed = value(record?.mutation)?.memory;
  const history = base.history;
  const snapshot = base.snapshot;
  if (!base.valid || !sessionsFresh(record, state)
    || record.mutationArguments?.memoryId !== state.successorId
    || record.mutationArguments?.expectedRevision !== base.current.memory.revision
    || record.mutationArguments?.content !== ORDERED_CAPTURE_LOOP_FIXTURE.correction
    || !changed || changed.id !== state.successorId
    || changed.revision !== base.current.memory.revision + 1
    || changed.content !== ORDERED_CAPTURE_LOOP_FIXTURE.correction
    || !stale(record.stale) || record.staleArguments?.memoryId !== state.successorId
    || record.staleArguments?.expectedRevision !== base.current.memory.revision
    || !after.valid || !same(after.record.memory, changed)
    || after.record.memory.origin !== 'explicit' || after.record.memory.confidence !== 1
    || after.record.receipts.length !== 1
    || after.record.receipts.some(receipt => state.successor.receipts.some(old => old.id === receipt.id))
    || !after.record.receipts.some(receipt => receipt.client === 'cairn-local-mcp'
      && receipt.sessionId === 'explicit-tool' && receipt.role === 'user'
      && receipt.excerpt === ORDERED_CAPTURE_LOOP_FIXTURE.correction)
    || !correctedRelation(history, after.record, state.successorAdmission)
    || !snapshotPreserves(snapshot, state, { successor: after.record })
    || !correctedRelation(snapshot.records.get(state.predecessorId),
      snapshot.records.get(state.successorId), state.successorAdmission)) return false;
  next.successor = after.record;
  next.predecessor = history;
  next.consumerSessions = [...state.consumerSessions, record.consumerSessionId];
  return true;
}

function stageD(record, state, next) {
  const base = consumerRecord(record, state, state.successor);
  if (!base.valid || !sessionsFresh(record, state)
    || !correctedRelation(base.history, base.current, state.successorAdmission)
    || !correctedRelation(base.snapshot.records.get(state.predecessorId),
      base.snapshot.records.get(state.successorId), state.successorAdmission)) return false;
  next.consumerSessions = [...state.consumerSessions, record.consumerSessionId];
  return true;
}

function stageE(record, state, next) {
  const current = inspectPages(record?.current, record?.currentPages);
  const afterStale = inspectPages(record?.afterStale, record?.afterStalePages);
  const history = inspectPages(record?.history, record?.historyPages);
  const snapshot = inspectSnapshot(record?.snapshot);
  const memories = completeRecall(record?.recall, state.namespace) ? value(record.recall).memories : [];
  const recalled = memories.length === 1 ? memories[0] : null;
  if (!sessionsFresh(record, state) || !current.valid || !afterStale.valid || !history.valid
    || !recalled || !recallRecordMatches(recalled, current.record)
    || !stableRecord(current.record, state.successor)
    || record.staleArguments?.memoryId !== state.successorId
    || record.staleArguments?.expectedRevision !== state.successor.memory.revision - 1
    || !stale(record.stale) || !stableRecord(afterStale.record, state.successor)
    || record.mutationArguments?.memoryId !== state.successorId
    || record.mutationArguments?.expectedRevision !== afterStale.record.memory.revision
    || value(record.mutation)?.forgotten !== true || !missing(record.after)
    || !forgottenRelation(history.record, state.predecessor)
    || !forgottenRelation(snapshot.records.get(state.predecessorId), state.predecessor)
    || !snapshotPreserves(snapshot, state)
    || snapshot.records.has(state.successorId)) return false;
  next.predecessor = history.record;
  next.consumerSessions = [...state.consumerSessions, record.consumerSessionId];
  next.successorForgotten = true;
  return true;
}

function stageF(record, state, next) {
  const history = inspectPages(record?.history, record?.historyPages);
  const snapshot = inspectSnapshot(record?.snapshot);
  if (!sessionsFresh(record, state) || !completeRecall(record?.recall, state.namespace)
    || value(record.recall).memories.length !== 0 || !missing(record.after)
    || !state.successorForgotten || !history.valid
    || !forgottenRelation(history.record, state.predecessor)
    || !forgottenRelation(snapshot.records.get(state.predecessorId), state.predecessor)
    || !snapshotPreserves(snapshot, state) || snapshot.records.has(state.successorId)) return false;
  next.consumerSessions = [...state.consumerSessions, record.consumerSessionId];
  return true;
}

// Mechanical observations never establish source entailment or currentness semantics.
export function inspectOrderedCaptureLoopStage(stage, record, state = {}) {
  let passed = false;
  try {
    const next = { ...state };
    if (stage === 'A') passed = stageA(record, next);
    else if (stage === 'B') passed = stageB(record, state, next);
    else if (stage === 'C') passed = stageC(record, state, next);
    else if (stage === 'D') passed = stageD(record, state, next);
    else if (stage === 'E') passed = stageE(record, state, next);
    else if (stage === 'F') passed = stageF(record, state, next);
    if (passed) Object.assign(state, next);
  } catch { passed = false; }
  return { stage, passedAutomated: Boolean(passed), semanticReviewRequired: true };
}

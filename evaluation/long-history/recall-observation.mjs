import { types } from 'node:util';

const MAX_RECEIPTS = 100;
const MAX_MAP_ITEMS = 100;
const MAX_CANDIDATES = 36;
const MAX_ANSWER_BYTES = 64 * 1024;
const MAX_REPORT_BYTES = 32 * 1024;
const absent = Symbol('absent');

function own(value, key) {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) throw new Error('shape');
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('shape');
  return descriptor.value;
}

function optional(value, key) {
  if (value === null || typeof value !== 'object' || types.isProxy(value)) throw new Error('shape');
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor) return absent;
  if (!Object.hasOwn(descriptor, 'value')) throw new Error('shape');
  return descriptor.value;
}

function rows(value, maximum) {
  if (types.isProxy(value) || !Array.isArray(value)) throw new Error('shape');
  const length = own(value, 'length');
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) throw new Error('shape');
  return Array.from({ length }, (_, index) => own(value, String(index)));
}

function sameNamespace(left, right) {
  return own(left, 'ownerId') === right.ownerId && own(left, 'scope') === right.scope &&
    own(left, 'projectId') === right.projectId;
}

const sameSource = (row, source) => own(row, 'client') === source.client &&
  own(row, 'sessionId') === source.sessionId && own(row, 'eventId') === source.eventId &&
  own(row, 'role') === source.role && own(row, 'excerpt') === source.excerpt;
const sameProjectedSource = (row, source) => own(row, 'id') === source.receiptId &&
  own(row, 'role') === source.role && own(row, 'excerpt') === source.excerpt;
const yesNo = value => value ? 'yes' : 'no';
const boundedString = (value, maximum) => typeof value === 'string' && value.length > 0 &&
  value.length <= maximum && value.isWellFormed();

function sourceRead(result, probe, prior = null) {
  try {
    if (own(result, 'ok') !== true) return { status: 'unavailable', reason: 'read_failed' };
    const value = own(result, 'value');
    const memory = own(value, 'memory');
    const revision = own(memory, 'revision');
    const receiptCount = own(memory, 'receiptCount');
    if (own(memory, 'id') !== probe.memoryId || !sameNamespace(own(memory, 'namespace'), probe.namespace)
      || own(memory, 'state') !== 'active' || !Number.isSafeInteger(revision) || revision < 1
      || !Number.isSafeInteger(receiptCount) || receiptCount < 0 || receiptCount > MAX_RECEIPTS
      || own(value, 'exhausted') !== true || optional(value, 'nextReceiptCursor') !== null) {
      return { status: 'unavailable', reason: 'read_shape' };
    }
    const receipts = rows(own(value, 'receipts'), MAX_RECEIPTS);
    if (receipts.length !== receiptCount) return { status: 'unavailable', reason: 'read_incomplete' };
    let text = false, binding = false, receiptId = null;
    for (const receipt of receipts) {
      if (own(receipt, 'excerpt') === probe.excerpt) text = true;
      if (sameSource(receipt, probe)) {
        if (binding) return { status: 'unavailable', reason: 'ambiguous_source' };
        receiptId = own(receipt, 'id');
        if (!boundedString(receiptId, 200)) return { status: 'unavailable', reason: 'read_shape' };
        binding = true;
      }
    }
    if (prior && (revision !== prior.revision || receiptId !== prior.receiptId || !binding)) {
      return { status: 'stale' };
    }
    return { status: 'observed', revision, receiptId, text, binding };
  } catch { return { status: 'unavailable', reason: 'read_shape' }; }
}

function targetRef(row, probe, revision) {
  return own(row, 'namespaceIndex') === 0 && own(row, 'memoryId') === probe.memoryId &&
    own(row, 'revision') === revision;
}

function visibleRef(item, namespaceIndex) {
  const type = own(item, 'type');
  const ref = own(item, 'ref');
  if (type === 'unfiled') return { namespaceIndex,
    memoryId: own(ref, 'memoryId'), revision: own(ref, 'revision') };
  if (type === 'ref' && own(ref, 'childType') === 'memory') return { namespaceIndex,
    memoryId: own(ref, 'childId'), revision: own(ref, 'childRevision') };
  return null;
}

function projectSelectInput(request, probe, revision) {
  const input = own(request, 'input');
  const maps = rows(own(input, 'maps'), 2);
  let itemCount = 0, visible = false, routingText = false, candidateText = false;
  let targetRefType = 'unavailable';
  for (const map of maps) {
    const namespaceIndex = own(map, 'namespaceIndex');
    const items = rows(own(map, 'items'), MAX_MAP_ITEMS);
    itemCount += items.length;
    if (itemCount > 200) throw new Error('shape');
    for (const item of items) {
      const ref = visibleRef(item, namespaceIndex);
      if (!ref || !targetRef(ref, probe, revision)) continue;
      visible = true;
      targetRefType = own(item, 'type');
      const label = own(item, 'label');
      if (typeof label !== 'string' || label.length > 4000) throw new Error('shape');
      routingText ||= label.includes(probe.routingCue);
      candidateText ||= label.includes(probe.excerpt);
    }
  }
  return { visible: yesNo(visible), routingText: yesNo(routingText),
    candidateText: yesNo(candidateText), targetRefType, visibleItemCount: itemCount };
}

function projectSelectOutput(output, probe, revision) {
  const refs = rows(own(output, 'refs'), 24);
  let proposal = false, wrongRevision = false;
  for (const ref of refs) {
    const memoryId = own(ref, 'memoryId');
    const namespaceIndex = own(ref, 'namespaceIndex');
    if (memoryId !== probe.memoryId || namespaceIndex !== 0) continue;
    if (targetRef(ref, probe, revision)) proposal = true;
    else wrongRevision = true;
  }
  return { proposal: yesNo(proposal), wrongRevision: yesNo(wrongRevision),
    returnedRefCount: refs.length };
}

function projectRankInput(request, probe, source) {
  const input = own(request, 'input');
  const candidates = rows(own(input, 'candidates'), MAX_CANDIDATES);
  let ref = false, text = false, binding = false;
  for (const candidate of candidates) {
    const memory = own(candidate, 'memory');
    if (own(candidate, 'namespaceIndex') !== 0 || own(memory, 'id') !== probe.memoryId ||
      own(memory, 'revision') !== source.revision) continue;
    ref = true;
    const receipts = rows(own(candidate, 'receipts'), MAX_RECEIPTS);
    for (const receipt of receipts) {
      if (own(receipt, 'excerpt') === probe.excerpt) text = true;
      if (source.receiptId && sameProjectedSource(receipt, { receiptId: source.receiptId,
        role: probe.role, excerpt: probe.excerpt })) binding = true;
    }
  }
  return { inputRef: yesNo(ref), inputText: yesNo(text), inputSourceBinding: yesNo(binding),
    inputCandidateCount: candidates.length };
}

function projectRankOutput(output, probe, source) {
  const refs = rows(own(output, 'refs'), 12);
  let proposal = false;
  for (const item of refs) if (targetRef(item, probe, source.revision)) proposal = true;
  return { proposal: yesNo(proposal), returnedRefCount: refs.length };
}

function projectFinal(response, probe, source) {
  try {
    if (own(response, 'ok') !== true) {
      const error = own(response, 'error');
      return { status: own(error, 'code') === 'revision_conflict' ? 'stale' : 'failed',
        ref: 'unavailable', text: 'unavailable', sourceBinding: 'unavailable', strategy: 'unavailable' };
    }
    const value = own(response, 'value');
    const namespaces = rows(own(value, 'namespaces'), 1);
    if (namespaces.length !== 1 || !sameNamespace(own(namespaces[0], 'namespace'), probe.namespace)) {
      throw new Error('shape');
    }
    const memories = rows(own(value, 'memories'), 12);
    const selection = optional(value, 'selection');
    const strategy = selection === absent ? 'default' : own(selection, 'strategy');
    if (!['default', 'complete-map', 'model-selected'].includes(strategy)) throw new Error('shape');
    let ref = false, text = false, binding = false;
    for (const item of memories) {
      const memory = own(item, 'memory');
      if (own(memory, 'id') !== probe.memoryId || own(memory, 'revision') !== source.revision) continue;
      ref = true;
      for (const receipt of rows(own(item, 'receipts'), MAX_RECEIPTS)) {
        if (own(receipt, 'excerpt') === probe.excerpt) text = true;
        if (source.receiptId && sameProjectedSource(receipt, { receiptId: source.receiptId,
          role: probe.role, excerpt: probe.excerpt })) binding = true;
      }
    }
    return { status: 'completed', ref: yesNo(ref), text: yesNo(text),
      sourceBinding: yesNo(binding), strategy };
  } catch { return { status: 'unavailable', ref: 'unavailable', text: 'unavailable',
    sourceBinding: 'unavailable', strategy: 'unavailable' }; }
}

function projectPack(packed, excerpt) {
  if (packed === null) return { status: 'not-run', textPresent: 'not-run', sourceBinding: 'unavailable' };
  try {
    const request = own(packed, 'request');
    const messages = rows(own(request, 'messages'), 2);
    if (messages.length !== 2) throw new Error('shape');
    const content = own(messages[1], 'content');
    if (typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > MAX_ANSWER_BYTES) throw new Error('shape');
    const evidence = own(JSON.parse(content), 'evidence');
    if (!Array.isArray(evidence) || evidence.length > 6) throw new Error('shape');
    return { status: 'completed', textPresent: yesNo(evidence.some(item =>
      item !== null && typeof item === 'object' && !types.isProxy(item) &&
      typeof own(item, 'text') === 'string' && own(item, 'text').includes(excerpt))),
    sourceBinding: 'unavailable' };
  } catch { return { status: 'unavailable', textPresent: 'unavailable', sourceBinding: 'unavailable' }; }
}

function firstGap(report) {
  const { source, selection, rank, final, answer } = report;
  if (source.status !== 'observed') return 'unavailable';
  if (source.retainedText === 'no') return 'retained-text';
  if (source.currentSourceBinding === 'no') return 'source-binding';
  if (selection.referenceVisible === 'no') return 'reference-visible';
  if (!['yes', 'bypassed'].includes(selection.referenceVisible)) return 'unavailable';
  if (selection.accepted === 'no') return 'selected';
  if (selection.accepted !== 'yes') return 'unavailable';
  if (rank.inputRef === 'no') return 'rank-input-ref';
  if (rank.inputRef !== 'yes') return 'unavailable';
  if (rank.inputText === 'no') return 'rank-input-text';
  if (rank.inputText !== 'yes') return 'unavailable';
  if (rank.inputSourceBinding === 'no') return 'rank-input-source-binding';
  if (rank.inputSourceBinding !== 'yes') return 'unavailable';
  if (rank.accepted === 'no') return 'ranked';
  if (rank.accepted !== 'yes') return 'unavailable';
  if (final.ref === 'no') return 'final-ref';
  if (final.ref !== 'yes') return 'unavailable';
  if (final.text === 'no') return 'final-text';
  if (final.text !== 'yes') return 'unavailable';
  if (final.sourceBinding === 'no') return 'final-source-binding';
  if (final.sourceBinding !== 'yes') return 'unavailable';
  if (answer.textPresent === 'no') return 'answer-context-present';
  if (answer.textPresent !== 'yes') return 'unavailable';
  return null;
}

const unavailableReport = reason => ({ version: 1, scope: 'one-current-source/one-recall',
  status: 'unavailable', reason, firstObservedGap: 'unavailable' });

/** One source, one actual recall and pack; IDs/text remain transient. */
export function createRetainedRecallTrace(options) {
  let probe = null, initial = { status: 'unavailable' }, select = [], rank = null;
  let selectCalls = 0, rankCalls = 0, overflowed = false, invalidSettlement = false, closed = false;
  try {
    const sourceProbe = own(options, 'sourceProbe');
    const before = own(options, 'before');
    const readSet = rows(own(options, 'readSet'), 1);
    const namespace = own(sourceProbe, 'namespace');
    probe = { namespace: { ownerId: own(namespace, 'ownerId'), scope: own(namespace, 'scope'),
      projectId: own(namespace, 'projectId') }, memoryId: own(sourceProbe, 'memoryId'),
    client: own(sourceProbe, 'client'), sessionId: own(sourceProbe, 'sessionId'),
    eventId: own(sourceProbe, 'eventId'), role: own(sourceProbe, 'role'),
    excerpt: own(sourceProbe, 'excerpt'), routingCue: own(sourceProbe, 'routingCue') };
    if (readSet.length !== 1 || !sameNamespace(readSet[0], probe.namespace) ||
        !boundedString(probe.namespace.ownerId, 200) ||
        !['personal', 'project'].includes(probe.namespace.scope) ||
        !(probe.namespace.projectId === null || boundedString(probe.namespace.projectId, 200)) ||
        !boundedString(probe.memoryId, 200) || !boundedString(probe.client, 200) ||
        !boundedString(probe.sessionId, 200) || !boundedString(probe.eventId, 200) ||
        !['user', 'assistant'].includes(probe.role) || !boundedString(probe.excerpt, 800) ||
        !boundedString(probe.routingCue, 200)) throw new Error('shape');
    initial = sourceRead(before, probe);
    if (initial.status !== 'observed' || !initial.binding) throw new Error('shape');
  } catch { probe = null; if (initial.status === 'observed') initial = { status: 'unavailable',
    reason: 'source_binding_missing' }; }
  const beginSelect = (request) => {
    if (closed) return () => {};
    if (selectCalls === 2) { overflowed = true; return () => {}; }
    selectCalls++;
    const index = select.push(null) - 1;
    let entry = null, settled = false;
    try { if (probe && initial.status === 'observed') {
      entry = projectSelectInput(request, probe, initial.revision);
    } } catch { /* Malformed observation does not affect the model call. */ }
    return output => {
      if (closed) return;
      if (settled) { invalidSettlement = true; select[index] = null; return; }
      settled = true;
      try { if (entry) select[index] = { ...entry,
        ...projectSelectOutput(output, probe, initial.revision) }; }
      catch { select[index] = null; }
      entry = null;
    };
  };
  const beginRank = (request) => {
    if (closed) return () => {};
    if (rankCalls === 1) { overflowed = true; return () => {}; }
    rankCalls++;
    let entry = null, settled = false;
    try { if (probe && initial.status === 'observed') entry = projectRankInput(request, probe, initial); }
    catch { /* Malformed observation does not affect the model call. */ }
    return output => {
      if (closed) return;
      if (settled) { invalidSettlement = true; rank = null; return; }
      settled = true;
      try { if (entry) rank = { ...entry, ...projectRankOutput(output, probe, initial) }; }
      catch { rank = null; }
      entry = null;
    };
  };
  const recordSelect = (request, output) => { beginSelect(request)(output); };
  const recordRank = (request, output) => { beginRank(request)(output); };
  const finish = (options) => {
    if (closed) return unavailableReport('already_finished');
    closed = true;
    try {
      const recall = own(options, 'recall');
      const packed = own(options, 'packed');
      const after = own(options, 'after');
      if (!probe || initial.status !== 'observed' || overflowed || invalidSettlement) {
        return unavailableReport(overflowed ? 'truncated'
          : invalidSettlement ? 'observation_failed' : initial.reason ?? 'source_unavailable');
      }
      const later = sourceRead(after, probe, initial);
      if (later.status !== 'observed') return unavailableReport(later.reason ?? later.status);
      const final = projectFinal(recall, probe, initial);
      const answer = projectPack(packed, probe.excerpt);
      const selection = { strategy: final.strategy,
        referenceVisible: select.length && select.every(Boolean)
          ? yesNo(select.some(row => row.visible === 'yes')) : 'unavailable',
        routingTextVisible: select.length && select.every(Boolean)
          ? yesNo(select.some(row => row.routingText === 'yes')) : 'unavailable',
        candidateTextVisible: select.length && select.every(Boolean)
          ? yesNo(select.some(row => row.candidateText === 'yes')) : 'unavailable',
        targetRefType: select.find(row => row?.visible === 'yes')?.targetRefType ?? 'unavailable',
        proposal: select.length && select.every(Boolean)
          ? yesNo(select.some(row => row.proposal === 'yes')) : selectCalls ? 'unavailable' : 'not-run',
        wrongRevisionProposal: select.length && select.every(Boolean)
          ? yesNo(select.some(row => row.wrongRevision === 'yes')) : selectCalls ? 'unavailable' : 'not-run',
        accepted: 'unavailable' };
      const ranked = { inputRef: rank?.inputRef ?? (rankCalls ? 'unavailable' : 'not-run'),
        inputText: rank?.inputText ?? (rankCalls ? 'unavailable' : 'not-run'),
        inputSourceBinding: rank?.inputSourceBinding ?? (rankCalls ? 'unavailable' : 'not-run'),
        proposal: rank?.proposal ?? (rankCalls ? 'unavailable' : 'not-run'),
        accepted: 'unavailable' };
      if (final.strategy === 'complete-map' && selectCalls === 0 && ranked.inputRef === 'yes') {
        selection.referenceVisible = 'bypassed';
        selection.accepted = 'yes';
      } else if (ranked.inputRef === 'yes') selection.accepted = 'yes';
      else if (final.status === 'completed' && selection.referenceVisible === 'yes' &&
        selectCalls > 0 && select.every(Boolean) &&
        (rankCalls === 0 || ranked.inputRef === 'no')) {
        selection.accepted = 'no';
      }
      // The core can count tokens after this callback returns, and its counter
      // may mutate the original output before validation. Only the actual
      // successful final read proves target rank acceptance.
      if (final.status === 'completed' && final.ref === 'yes') ranked.accepted = 'yes';
      else if (final.status === 'completed' && final.ref === 'no' &&
        ranked.proposal === 'no') ranked.accepted = 'no';
      const report = { version: 1, scope: 'one-current-source/one-recall',
        status: 'observed', source: { status: 'observed', retainedText: yesNo(initial.text),
          currentSourceBinding: yesNo(initial.binding), currentRevision: 'current' },
        counts: { selectCalls, rankCalls, recallCalls: 1, packCalls: packed === null ? 0 : 1,
          selectVisibleItems: select.every(Boolean) ? select.reduce((sum, row) =>
            sum + row.visibleItemCount, 0) : null,
          rankCandidates: rank?.inputCandidateCount ?? null, overflowed: false },
        selection, rank: ranked, final, answer, firstObservedGap: 'unavailable' };
      report.firstObservedGap = firstGap(report);
      if (Buffer.byteLength(JSON.stringify(report), 'utf8') > MAX_REPORT_BYTES) {
        return unavailableReport('report_limit');
      }
      return report;
    } catch { return unavailableReport('observation_failed'); }
    finally { probe = null; select = []; rank = null; }
  };
  return Object.freeze({ beginSelect, beginRank, recordSelect, recordRank, finish });
}

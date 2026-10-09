// Private verifier shared by the production runner and focused denial tests.
// The `get` port is always the actual core.get in production; this is not an
// alternate public runner/core factory or a provenance authority.
import { INGESTION_CLIENT } from './ingestion.mjs';
import { canonical, fail, safeInteger } from './mixed-validation.mjs';

function verifiedSources(recall, get, plan, namespace, project) {
  if (!recall || !Array.isArray(recall.memories) || recall.memories.length > 6
    || recall.memories.length !== Object.keys(recall.memories).length) fail('invalid_recall_provenance');
  const sourceByEvent = new Map(plan.cairnPlan.batches.flatMap(batch => batch.sourceMap.map(source =>
    [source.messageId, { source, batch, windows: batch.indexedWindows.filter(window =>
      window.id === source.messageId && window.messageIndex === source.messageIndex
      && window.role === source.role) }])));
  const originById = new Map(plan.originMap.turns.map(item => [item.renderedTurnId, item]));
  const originWindow = new Map(plan.originMap.windows.map(item =>
    [`${item.batchIndex}:${item.windowIndex}:${item.renderedTurnId}`, item]));
  const units = [], provenance = [], usedMemoryIds = new Set(), usedReceiptIds = new Set();
  let receiptTotal = 0;
  for (const item of recall.memories) {
    const memory = item?.memory;
    if (!memory || usedMemoryIds.has(memory.id) || memory.currentness !== 'current'
      || !safeInteger(memory.revision, 1) || item.interpretationStatus !== 'omitted'
      || item.sourceSelectionCoverage !== 'unassessed' || !Array.isArray(item.receipts)
      || !safeInteger(item.receiptCount, 1) || item.receiptCount !== item.receipts.length) {
      fail('invalid_recall_provenance');
    }
    usedMemoryIds.add(memory.id);
    receiptTotal += item.receiptCount;
    if (receiptTotal > 384 || item.receiptCount > 100) fail('provenance_limit_exceeded');
    const fetched = get({ namespace, memoryId: memory.id, receiptLimit: 100 });
    const detail = fetched?.value;
    if (fetched?.ok !== true || detail?.exhausted !== true
      || detail.nextReceiptCursor !== null || detail.memory?.id !== memory.id
      || detail.memory.revision !== memory.revision || detail.memory.state !== 'active'
      || canonical(detail.memory.namespace) !== canonical(namespace)
      || detail.memory.receiptCount !== item.receiptCount
      || !Array.isArray(detail.receipts) || detail.receipts.length !== item.receiptCount) {
      fail('invalid_recall_provenance');
    }
    const authoritative = new Map(detail.receipts.map(receipt => [receipt.id, receipt]));
    if (authoritative.size !== item.receiptCount) fail('invalid_recall_provenance');
    const sources = [];
    for (const receipt of item.receipts) {
      const original = authoritative.get(receipt?.id);
      const mapped = sourceByEvent.get(original?.eventId);
      const origin = originById.get(mapped?.source.turnId);
      const matches = mapped?.windows.filter(window => window.content === original.excerpt) ?? [];
      if (!original || !mapped || !origin || usedReceiptIds.has(receipt.id)
        || original.client !== INGESTION_CLIENT
        || original.sessionId !== mapped.batch.captureInput.sessionId
        || original.role !== mapped.source.role || receipt.role !== original.role
        || receipt.excerpt !== original.excerpt || matches.length === 0
        || matches.length > 64) fail('invalid_recall_provenance');
      usedReceiptIds.add(receipt.id);
      sources.push({ recordedRole: original.role, text: original.excerpt });
      provenance.push({ memoryId: memory.id, receiptId: receipt.id,
        coordinates: matches.map(window => {
          const located = originWindow.get(`${mapped.batch.batchIndex}:${window.index}:${origin.renderedTurnId}`);
          if (!located) fail('invalid_recall_provenance');
          return { renderedTurnId: origin.renderedTurnId,
            originalSessionIndex: origin.originalSessionIndex,
            originalTurnIndex: origin.originalTurnIndex, batchIndex: mapped.batch.batchIndex,
            windowIndex: window.index, classification: located.classification,
            originalStartUtf16: located.originalStartUtf16,
            originalEndUtf16: located.originalEndUtf16 };
        }) });
    }
    if (sources.length !== authoritative.size) fail('invalid_recall_provenance');
    units.push({ text: project(sources) });
  }
  return { units, provenance };
}

export function verifiedEvidence(recall, get, plan, namespace) {
  return verifiedSources(recall, get, plan, namespace,
    sources => sources.map(source => source.text).join('\n'));
}

// Explicit evaluation projection only. Recorded roles describe submitted source
// receipts, not authenticated identity, claim subjects or execution permission.
// The unchanged answer packer quotes this JSON as evidence, never as messages.
export function verifiedRoleEvidence(recall, get, plan, namespace) {
  return verifiedSources(recall, get, plan, namespace, sources => {
    if (sources.some(source => !['user', 'assistant'].includes(source.recordedRole))) {
      fail('invalid_recall_provenance');
    }
    return JSON.stringify({ format: 'source-role-evidence-v1', sources });
  });
}

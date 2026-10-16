import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { captureSnapshot } from '../../core/capture-input.mjs';
import { extractedWindowItems, sourceWindowCatalog } from '../../core/source-windows.mjs';
import { countTokens as countedTokens } from '../../core/model-budget.mjs';
import { MODEL_OUTPUT_TOKENS } from '../../core/model-call.mjs';
import { fail, fingerprint } from '../../core/validation.mjs';

// Offline feasibility only. No default, host, stored schema or semantic edge.
const digest = value => createHash('sha256').update(value, 'utf8').digest('hex');
const identity = receipt => JSON.stringify([receipt.client, receipt.sessionId,
  receipt.eventId, receipt.role, receipt.excerpt]);
const bytes = content => Buffer.byteLength(content, 'utf8');
const unwrap = result => {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};
const receiptFor = (snapshot, window) => ({ client: snapshot.client,
  sessionId: snapshot.sessionId, eventId: window.id, role: window.role, excerpt: window.content });
const version = 'offline-neighbor-source-binding-v1';

/** One capture, one first extraction output; trusted source material never escapes. */
export function createNeighborSourceBinding(input, { enabled = true, maxAddedBytes, countTokens } = {}) {
  if (typeof enabled !== 'boolean' || (maxAddedBytes !== undefined &&
      (!Number.isSafeInteger(maxAddedBytes) || maxAddedBytes < 0)) || Object.hasOwn(input, 'causal')) {
    throw new TypeError('invalid_neighbor_options');
  }
  if (typeof countTokens !== 'function') fail('token_count_unavailable');
  // Caller binds this SAME synchronous deterministic function to model.countTokens.
  // The helper cannot inspect which model object the caller passes to core.
  const counter = { countTokens };
  const outputFits = text => text.length <= 40_000 && countedTokens(counter, text) <= MODEL_OUTPUT_TOKENS;
  const snapshot = captureSnapshot(structuredClone(input), undefined, 'indexed-evidence-v1');
  const catalog = sourceWindowCatalog(snapshot);
  let state;
  let consumed = false;
  return {
    transform(request, originalOutput) {
      if (consumed) throw new Error('extraction_already_transformed');
      consumed = true;
      if (!isDeepStrictEqual(request.input, catalog.input)) throw new Error('source_catalog_mismatch');
      // Validate the WHOLE original batch first. Never salvage malformed output.
      const originalItems = extractedWindowItems(originalOutput, snapshot, catalog);
      const output = structuredClone(originalOutput);
      const originalText = JSON.stringify(output);
      const fitsUnchangedOriginal = text => {
        const fits = outputFits(text);
        // The counter sees a string but can close over caller-owned model output.
        try {
          extractedWindowItems(originalOutput, snapshot, catalog);
          if (JSON.stringify(originalOutput) !== originalText) fail('invalid_model_output');
        } catch { fail('invalid_model_output'); }
        return fits;
      };
      if (!fitsUnchangedOriginal(originalText)) fail('invalid_model_output');
      const diagnostics = [], provenance = [], itemCounts = [];
      const counts = { selected: 0, selectedBytes: 0, added: 0, addedBytes: 0, skipped: 0, skippedBytes: 0 };
      for (const [itemIndex, item] of output.items.entries()) {
        const selected = [...item.sourceIndices];
        const retained = new Set(originalItems[itemIndex].receipts.map(identity));
        const roles = selected.map(windowIndex => ({ windowIndex, provenanceRole: 'extractor-selected' }));
        const itemCount = { itemIndex, selected: selected.length,
          selectedBytes: selected.reduce((sum, index) => sum + bytes(catalog.entries[index].content), 0),
          added: 0, addedBytes: 0, skipped: 0, skippedBytes: 0 };
        counts.selected += selected.length;
        counts.selectedBytes += itemCount.selectedBytes;
        for (const selectedIndex of [...selected].sort((a, b) => a - b)) {
          const predecessorIndex = selectedIndex - 1;
          const window = catalog.entries[predecessorIndex];
          const size = window ? bytes(window.content) : 0;
          let reason;
          if (!window) reason = 'no-predecessor';
          else if (retained.has(identity(receiptFor(snapshot, window)))) reason = 'already-retained';
          else if (!enabled) reason = 'disabled';
          else if (item.sourceIndices.length === 4) reason = 'receipt-cap';
          else if (maxAddedBytes !== undefined && counts.addedBytes + size > maxAddedBytes) reason = 'resource-cap';
          else {
            item.sourceIndices.push(predecessorIndex);
            if (!fitsUnchangedOriginal(JSON.stringify(output))) {
              item.sourceIndices.pop();
              reason = 'output-cap';
            } else {
              reason = 'attached';
              retained.add(identity(receiptFor(snapshot, window)));
              roles.push({ windowIndex: predecessorIndex, provenanceRole: 'dialogue-context' });
              counts.added++; counts.addedBytes += size;
              itemCount.added++; itemCount.addedBytes += size;
            }
          }
          if (reason !== 'attached') {
            counts.skipped++; counts.skippedBytes += size;
            itemCount.skipped++; itemCount.skippedBytes += size;
          }
          diagnostics.push({ itemIndex, selectedIndex, predecessorIndex, reason, bytes: size });
        }
        provenance.push(roles);
        itemCounts.push(itemCount);
      }
      const items = extractedWindowItems(output, snapshot, catalog);
      state = { items, provenance, report: { counts, itemCounts, diagnostics,
        sourceWindowCount: catalog.entries.length, resourceBoundBytes: maxAddedBytes ?? null } };
      return output;
    },
    summary() { return state ? structuredClone(state.report) : null; },
    bind(core, captureResult) {
      if (!state || !captureResult.ok || captureResult.value.duplicate !== false ||
          !captureResult.value.admission) throw new Error('capture_not_fresh');
      const admission = unwrap(core.inspectAdmission({ namespace: snapshot.namespace,
        client: snapshot.client, eventId: snapshot.eventId }));
      const result = captureResult.value;
      const revisions = new Map(result.admission.memories.map(({ id, revision }) => [id, revision]));
      for (const row of result.classification?.memoryRevisions ?? []) revisions.set(row.memoryId, row.revision);
      if (admission.status !== 'completed' || admission.suppressedCount !== result.admission.suppressedCount ||
          revisions.size !== result.admission.memories.length || admission.members.length !== revisions.size ||
          admission.members.some(member => member.status !== 'current' ||
            revisions.get(member.memoryId) !== member.revision)) {
        throw new Error('capture-membership-mismatch');
      }
      const details = captureResult.value.admission.memories.map(({ id }) => unwrap(core.get({
        namespace: snapshot.namespace, memoryId: id, receiptLimit: 100 })));
      if (details.some(detail => detail.memory.revision !== revisions.get(detail.memory.id))) {
        throw new Error('capture-revision-mismatch');
      }
      const entries = [];
      let unmatchedItems = 0;
      for (const [itemIndex, item] of state.items.entries()) {
        const matches = details.filter(detail => fingerprint(detail.memory.content) === fingerprint(item.content));
        if (matches.length === 0) { unmatchedItems++; continue; }
        if (matches.length !== 1) throw new Error('ambiguous_canonical_memory');
        const detail = matches[0];
        if (!detail.exhausted) throw new Error('incomplete_receipt_binding');
        for (const row of state.provenance[itemIndex]) {
          const window = catalog.entries[row.windowIndex], expected = receiptFor(snapshot, window);
          const receipts = detail.receipts.filter(receipt => identity(receipt) === identity(expected));
          if (receipts.length !== 1) throw new Error('missing_canonical_receipt');
          entries.push({ itemIndex, ...row, messageIndex: window.messageIndex,
            start: window.start, end: window.end, memoryId: detail.memory.id,
            revision: detail.memory.revision, memoryContentDigest: digest(detail.memory.content),
            memoryKind: detail.memory.kind,
            receiptId: receipts[0].id, receiptIdentityDigest: digest(identity(expected)),
            receiptContentDigest: digest(expected.excerpt) });
        }
      }
      if (unmatchedItems !== admission.suppressedCount) throw new Error('unexplained_missing_provenance');
      const sidecar = { version, namespace: structuredClone(snapshot.namespace), capture: {
        client: snapshot.client, sessionId: snapshot.sessionId, eventId: snapshot.eventId,
        payloadDigest: snapshot.payloadDigest }, entries,
      memories: details.map(({ memory }) => ({ memoryId: memory.id, revision: memory.revision,
        receiptCount: memory.receiptCount })), ...structuredClone(state.report) };
      // The operator must retain this pin independently of the serialized sidecar.
      return { sidecar, expectedDigest: digest(JSON.stringify(sidecar)) };
    },
  };
}

/** Sidecar is annotation only: return exact current authoritative core receipts. */
export function resolveNeighborSourceBinding(core, namespace, sidecar, expectedDigest) {
  const resolved = [], rejected = [];
  try {
    if (typeof expectedDigest !== 'string' || digest(JSON.stringify(sidecar)) !== expectedDigest) {
      throw new Error('sidecar-integrity-mismatch');
    }
  } catch { return { resolved, rejected: [{ reason: 'sidecar-integrity-mismatch' }] }; }
  if (!sidecar || sidecar.version !== version || !isDeepStrictEqual(namespace, sidecar.namespace) ||
      !Array.isArray(sidecar.entries) || sidecar.entries.length > 20) {
    return { resolved, rejected: [{ reason: 'sidecar-scope-mismatch' }] };
  }
  let admission;
  try {
    admission = unwrap(core.inspectAdmission({ namespace, client: sidecar.capture.client,
      eventId: sidecar.capture.eventId }));
    if (admission.status !== 'completed') throw new Error('capture-membership-mismatch');
  } catch { return { resolved, rejected: [{ reason: 'capture-membership-mismatch' }] }; }
  for (const [entryIndex, row] of sidecar.entries.entries()) {
    try {
      if (!['extractor-selected', 'dialogue-context'].includes(row.provenanceRole)) throw new Error('invalid-provenance');
      if (!admission.members.some(member => member.status === 'current' &&
          member.memoryId === row.memoryId && member.revision === row.revision)) throw new Error('capture-membership-mismatch');
      const detail = unwrap(core.get({ namespace, memoryId: row.memoryId, receiptLimit: 100 }));
      if (!detail.exhausted || detail.memory.revision !== row.revision ||
          detail.memory.kind !== row.memoryKind ||
          digest(detail.memory.content) !== row.memoryContentDigest) throw new Error('stale-memory-binding');
      const receipt = detail.receipts.find(receipt => receipt.id === row.receiptId);
      if (!receipt || digest(identity(receipt)) !== row.receiptIdentityDigest ||
          digest(receipt.excerpt) !== row.receiptContentDigest || receipt.client !== sidecar.capture.client ||
          receipt.sessionId !== sidecar.capture.sessionId) throw new Error('receipt-binding-mismatch');
      const fetched = unwrap(core.fetch({ namespace, contextMode: 'source-evidence',
        refs: [{ memoryId: row.memoryId, revision: row.revision }] }));
      const authoritative = fetched.items[0]?.receipts.find(source => source.id === row.receiptId);
      if (!authoritative || authoritative.role !== receipt.role || authoritative.excerpt !== receipt.excerpt ||
          digest(authoritative.excerpt) !== row.receiptContentDigest) throw new Error('source-evidence-mismatch');
      resolved.push({ itemIndex: row.itemIndex, windowIndex: row.windowIndex,
        provenanceRole: row.provenanceRole, memoryId: row.memoryId, revision: row.revision,
        receipt: { ...authoritative } });
    } catch (error) { rejected.push({ entryIndex, reason: error.message }); }
  }
  return { resolved, rejected };
}

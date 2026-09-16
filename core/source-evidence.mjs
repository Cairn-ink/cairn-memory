import { boundedText, identifier, revision, fail } from './validation.mjs';

export const isSourceContext = mode => ['source-evidence', 'rationale-evidence',
  'rationale-neighborhood-evidence'].includes(mode);
export const isRationaleContext = mode => ['rationale-evidence', 'rationale-neighborhood-evidence'].includes(mode);

// Called only inside the authoritative runtime transaction. Interpretation
// fields and source identity metadata never enter this closed usage projection.
export function sourceEvidence(memory, receipts, receiptCount, receiptKey) {
  if (receiptCount > 100 || receipts.length > 100) fail('context_item_too_large');
  try {
    identifier(memory.id); revision(memory.revision);
    if (!['current', 'historical'].includes(memory.currentness) ||
        !Number.isSafeInteger(receiptCount) || receiptCount < 1 || receipts.length !== receiptCount) fail('storage_error');
    const seen = new Set();
    const sources = receipts.map(receipt => {
      identifier(receipt.id);
      if (seen.has(receipt.id) || receipt.memory_id !== memory.id) fail('storage_error');
      seen.add(receipt.id);
      const source = { client: receipt.client, sessionId: receipt.session_id,
        eventId: receipt.event_id, role: receipt.role, excerpt: receipt.excerpt };
      for (const key of ['client', 'sessionId', 'eventId']) identifier(source[key]);
      if (!['user', 'assistant'].includes(source.role) || typeof source.excerpt !== 'string' ||
          !source.excerpt.isWellFormed() || boundedText(source.excerpt, 800) !== source.excerpt ||
          receipt.receipt_key !== receiptKey(source)) fail('storage_error');
      return { id: receipt.id, role: source.role, excerpt: source.excerpt };
    });
    return { memory: { id: memory.id, revision: memory.revision, currentness: memory.currentness },
      receipts: sources, receiptCount, interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' };
  } catch { fail('storage_error'); }
}

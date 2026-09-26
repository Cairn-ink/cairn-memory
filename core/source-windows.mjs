import { boundedText, fail } from './validation.mjs';
import { extractedItems } from './capture-input.mjs';

const MAX_WINDOW = 800;
const MAX_CATALOG = 64;

/** Build exact, non-overlapping canonical slices before a claim or model call. */
export function sourceWindowCatalog(snapshot) {
  const entries = [];
  for (const [messageIndex, message] of snapshot.messages.entries()) {
    const source = message.content;
    for (let start = 0; start < source.length;) {
      let end = start;
      for (const point of source.slice(start)) {
        if (end - start + point.length > MAX_WINDOW) break;
        end += point.length;
      }
      if (end === start) fail('invalid_input');
      let excerptStart = start, excerptEnd = end;
      while (source[excerptStart] === ' ' && excerptStart < excerptEnd) excerptStart++;
      while (source[excerptEnd - 1] === ' ' && excerptEnd > excerptStart) excerptEnd--;
      if (excerptStart === excerptEnd) fail('invalid_input');
      const excerpt = source.slice(excerptStart, excerptEnd);
      if (excerpt !== boundedText(excerpt, MAX_WINDOW, true)) fail('invalid_input');
      entries.push(Object.freeze({ index: entries.length, messageIndex, id: message.id,
        role: message.role, start: excerptStart, end: excerptEnd, content: excerpt }));
      if (entries.length > MAX_CATALOG) fail('invalid_input');
      start = end;
    }
  }
  return Object.freeze({ entries: Object.freeze(entries),
    messages: Object.freeze(entries.map(({ id, role, content }) => Object.freeze({ id, role, content }))),
    input: Object.freeze({ inputMode: 'indexed-windows-v1', messages: Object.freeze(entries.map(
      ({ index, messageIndex, role, content }) => Object.freeze({ index, messageIndex, role, content }))) }),
    coverage: Object.freeze({ sourceWindowCatalog: Object.freeze({ version: 1,
      maxUnitsPerWindow: MAX_WINDOW, messageCount: snapshot.messages.length,
      windowCount: entries.length, semanticCoverage: 'unassessed' }) }) });
}

/** Model indices are never authority for receipt identity or ordered chronology. */
export function extractedWindowItems(output, snapshot, catalog, onInvalid) {
  const diagnose = reason => { try { onInvalid?.(reason); } catch { /* Diagnostics cannot change validation. */ } };
  let detached;
  try { detached = structuredClone(output); }
  catch { diagnose('invalid_extraction_output_shape'); fail('invalid_model_output'); }
  const items = extractedItems(detached, snapshot, catalog.messages, onInvalid);
  try {
    for (const [position, item] of items.entries()) {
      const indices = detached.items[position].sourceIndices;
      const identities = item.receipts.map(receipt => JSON.stringify([
        receipt.client, receipt.sessionId, receipt.eventId, receipt.role, receipt.excerpt,
      ]));
      if (new Set(identities).size !== identities.length) {
        diagnose('invalid_extraction_source_duplicate'); fail('invalid_model_output');
      }
      if (snapshot.causal) item.sourceIndices = indices.map(index => catalog.entries[index].messageIndex);
    }
    return items;
  } catch { fail('invalid_model_output'); }
}

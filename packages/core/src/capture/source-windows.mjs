// Capture boundaries read accessor-backed fields once through a snapshot. The engine may reread them.
// Proxies, functions and symbol values are refused with the entry's invalid code. Some engine entries accept stable Proxies.
import { CoreError } from '../errors.mjs';
import { boundedText } from '../privacy/text.mjs';
import { countExtractionLimit, detachExtraction, extractDetachedItems, rejectExtraction } from './capture-input.mjs';
import { detach, fail } from './validate.mjs';

/** @import { Role } from '../ports/common.d.ts' */

const MAX_WINDOW = 800;
const MAX_CATALOG = 64;
const builtCatalogs = new WeakSet();

/** Build exact, non-overlapping canonical slices before a claim or model call.
 * @param {{messages: ReadonlyArray<{id: string, role: Role, content: string}>}} snapshot
 */
export function sourceWindowCatalog(snapshot) {
  const detached = detach(snapshot, 'invalid_input');
  try {
    const catalog = buildSourceWindowCatalog(detached);
    builtCatalogs.add(catalog);
    return catalog;
  } catch (error) {
    if (error instanceof CoreError) throw error;
    fail('invalid_input');
  }
}

/** @param {Parameters<typeof sourceWindowCatalog>[0]} snapshot */
function buildSourceWindowCatalog(snapshot) {
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

/** Model indices select windows in the trusted catalog. Ordered capture uses the original message indices.
 * @param {unknown} output
 * @param {Parameters<typeof extractDetachedItems>[1]} snapshot
 * @param {ReturnType<typeof sourceWindowCatalog>} catalog
 * @param {(reason: string) => void} [onInvalid]
 * @param {number} [limit]
 */
export function extractedWindowItems(output, snapshot, catalog, onInvalid, limit) {
  const trustedCatalog = builtCatalogs.has(catalog) ? catalog : undefined;
  const [detached, sourceSnapshot, copiedCatalog, suppliedLimit] = detachExtraction(
    /** @type {const} */ ([output, snapshot, trustedCatalog ? undefined : catalog, limit]), onInvalid);
  const sourceCatalog = trustedCatalog ?? /** @type {typeof catalog} */ (copiedCatalog);
  let messages, maximum;
  try {
    messages = sourceCatalog.messages;
    maximum = suppliedLimit === undefined ? countExtractionLimit(sourceCatalog.input.messages) : suppliedLimit;
  } catch { rejectExtraction('invalid_extraction_output_shape', onInvalid); }
  const items = extractDetachedItems(detached, sourceSnapshot, messages, onInvalid, undefined, maximum);
  try {
    const { items: selections } = /** @type {{items: Array<{sourceIndices: number[]}>}} */ (detached);
    for (const [position, item] of items.entries()) {
      const indices = selections[position].sourceIndices;
      const identities = item.receipts.map(receipt => JSON.stringify([
        receipt.client, receipt.sessionId, receipt.eventId, receipt.role, receipt.excerpt,
      ]));
      if (new Set(identities).size !== identities.length) {
        rejectExtraction('invalid_extraction_source_duplicate', onInvalid);
      }
      if (sourceSnapshot.causal) item.sourceIndices = indices.map(index => sourceCatalog.entries[index].messageIndex);
    }
    return items;
  } catch { fail('invalid_model_output'); }
}

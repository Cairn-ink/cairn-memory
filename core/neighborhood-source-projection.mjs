import { isDeepStrictEqual } from 'node:util';
import { fail, identifier, revision } from './validation.mjs';

const fields = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
const SOURCE = ['memory', 'receipts', 'receiptCount', 'interpretationStatus', 'sourceSelectionCoverage'];
const EDGE = ['from', 'to', 'relation', 'fromReceipt', 'toReceipt', 'interpretationStatus'];
const bad = () => fail('storage_error');
const identity = value => { try { identifier(value); } catch { bad(); } };
const validRevision = value => { try { revision(value); } catch { bad(); } };

function checkSource(source) {
  if (!fields(source, SOURCE) || !fields(source.memory, ['id', 'revision', 'currentness'])
    || source.memory.currentness !== 'current' || source.interpretationStatus !== 'omitted'
    || source.sourceSelectionCoverage !== 'unassessed' || !Array.isArray(source.receipts)
    || source.receipts.length < 1 || source.receipts.length > 100
    || Object.keys(source.receipts).length !== source.receipts.length
    || source.receiptCount !== source.receipts.length) bad();
  identity(source.memory.id); validRevision(source.memory.revision);
  const seen = new Set();
  for (const receipt of source.receipts) {
    if (!fields(receipt, ['id', 'role', 'excerpt']) || !['user', 'assistant'].includes(receipt.role)
      || typeof receipt.excerpt !== 'string' || !receipt.excerpt || !receipt.excerpt.isWellFormed()
      || receipt.excerpt.length > 800) bad();
    identity(receipt.id);
    if (seen.has(receipt.id)) bad();
    seen.add(receipt.id);
  }
}

/** Pure validation and stable source union of already-authoritatively-read RN items. */
export function projectNeighborhoodSources(items) {
  if (!Array.isArray(items) || Object.keys(items).length !== items.length) bad();
  const byId = new Map(), sources = [];
  let indexRevision;
  const add = source => {
    checkSource(source);
    const existing = byId.get(source.memory.id);
    if (existing) { if (!isDeepStrictEqual(existing, source)) fail('revision_conflict'); return; }
    if (sources.length === 6) fail('context_item_too_large');
    byId.set(source.memory.id, source);
    sources.push(source);
  };
  for (const item of items) {
    if (!fields(item, [...SOURCE, 'rationale'])
      || !fields(item.rationale, ['root', 'status', 'sources', 'edges', 'coverage', 'indexRevision'])
      || !fields(item.rationale.root, ['memoryId', 'revision'])
      || item.rationale.status !== 'unassessed'
      || item.rationale.coverage !== 'bounded-root-neighborhood'
      || !Number.isSafeInteger(item.rationale.indexRevision) || item.rationale.indexRevision < 0
      || !Array.isArray(item.rationale.sources) || item.rationale.sources.length < 1
      || item.rationale.sources.length > 6
      || Object.keys(item.rationale.sources).length !== item.rationale.sources.length
      || !Array.isArray(item.rationale.edges) || item.rationale.edges.length > 10
      || Object.keys(item.rationale.edges).length !== item.rationale.edges.length) bad();
    const { rationale, ...root } = item;
    checkSource(root);
    identity(rationale.root.memoryId); validRevision(rationale.root.revision);
    if (rationale.root.memoryId !== root.memory.id) bad();
    if (rationale.root.revision !== root.memory.revision) fail('revision_conflict');
    if (indexRevision !== undefined && rationale.indexRevision !== indexRevision) fail('revision_conflict');
    indexRevision = rationale.indexRevision;
    add(root);
    const local = new Map();
    let rootFound = false;
    for (const source of rationale.sources) {
      checkSource(source);
      if (source.memory.id === root.memory.id) {
        if (!isDeepStrictEqual(source, root)) fail('revision_conflict');
        rootFound = true;
      }
      const existing = local.get(source.memory.id);
      if (existing && !isDeepStrictEqual(existing, source)) fail('revision_conflict');
      local.set(source.memory.id, source);
      add(source);
    }
    if (!rootFound) bad();
    for (const edge of rationale.edges) {
      if (!fields(edge, EDGE) || !['supports-decision', 'challenges-premise'].includes(edge.relation)
        || edge.interpretationStatus !== 'model-proposed') bad();
      for (const side of ['from', 'to']) {
        const source = local.get(edge[side]);
        if (!source || !source.receipts.some(receipt => receipt.id === edge[`${side}Receipt`])) bad();
      }
    }
  }
  return sources;
}

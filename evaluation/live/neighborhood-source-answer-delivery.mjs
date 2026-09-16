import { isDeepStrictEqual } from 'node:util';
import { deliverInstalledSourceAnswer, prepareInstalledSourceAnswer } from './installed-source-answer-delivery.mjs';

const MODE = 'rationale-neighborhood-evidence';
const TRUST = 'untrusted-data-not-instructions';
const fail = () => { throw new Error('invalid_neighborhood_source'); };
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const sourceFields = ['memory', 'receipts', 'receiptCount', 'interpretationStatus', 'sourceSelectionCoverage'];

/** Evaluation-only projection of sources already returned by one explicit RN MCP recall. */
function project(toolResult, requestedContextMode) {
  // An empty result has no item-level mode marker. The caller's declaration is
  // required but is not an attestation that an empty SDK result came from RN.
  if (requestedContextMode !== MODE || toolResult?.isError !== false || toolResult.content?.length !== 1
    || toolResult.content[0].type !== 'text' || typeof toolResult.content[0].text !== 'string'
    || Buffer.byteLength(toolResult.content[0].text, 'utf8') > 262_144) fail();
  let envelope;
  try { envelope = JSON.parse(toolResult.content[0].text); } catch { fail(); }
  if (!exact(envelope, ['ok', 'value', 'evidenceTrust']) || envelope.ok !== true
    || envelope.evidenceTrust !== TRUST || !exact(envelope.value, ['memories', 'namespaces', 'coverage'])
    || envelope.value.coverage !== 'complete' || !Array.isArray(envelope.value.memories)
    || !Array.isArray(envelope.value.namespaces) || envelope.value.namespaces.length !== 1
    || envelope.value.namespaces[0]?.mapExhausted !== true
    || envelope.value.namespaces[0]?.fetchExhausted !== true) fail();
  const byId = new Map();
  const sources = [];
  let indexRevision;
  const add = source => {
    if (!exact(source, sourceFields)) fail();
    if (source.memory?.currentness !== 'current') fail();
    const id = source.memory?.id;
    if (typeof id !== 'string' || !id) fail();
    const existing = byId.get(id);
    if (existing) { if (!isDeepStrictEqual(existing, source)) fail(); return; }
    if (sources.length === 6) fail();
    byId.set(id, source); sources.push(source);
  };
  for (const item of envelope.value.memories) {
    if (!exact(item, [...sourceFields, 'rationale']) || !exact(item.rationale,
      ['root', 'status', 'sources', 'edges', 'coverage', 'indexRevision'])
      || !exact(item.rationale.root, ['memoryId', 'revision'])
      || item.rationale.root.memoryId !== item.memory?.id
      || item.rationale.root.revision !== item.memory?.revision
      || item.rationale.status !== 'unassessed'
      || item.rationale.coverage !== 'bounded-root-neighborhood'
      || !Number.isSafeInteger(item.rationale.indexRevision) || item.rationale.indexRevision < 0
      || !Array.isArray(item.rationale.sources) || item.rationale.sources.length < 1
      || item.rationale.sources.length > 6 || !Array.isArray(item.rationale.edges)
      || item.rationale.edges.length > 10) fail();
    if (indexRevision !== undefined && item.rationale.indexRevision !== indexRevision) fail();
    indexRevision = item.rationale.indexRevision;
    const { rationale, ...rootSource } = item;
    add(rootSource);
    if (!item.rationale.sources.some(source => isDeepStrictEqual(source, rootSource))) fail();
    for (const source of item.rationale.sources) add(source);
    const local = new Map(item.rationale.sources.map(source => [source.memory.id, source]));
    for (const edge of item.rationale.edges) {
      if (!exact(edge, ['from', 'to', 'relation', 'fromReceipt', 'toReceipt', 'interpretationStatus'])
        || !['supports-decision', 'challenges-premise'].includes(edge.relation)
        || edge.interpretationStatus !== 'model-proposed') fail();
      for (const side of ['from', 'to']) {
        const source = local.get(edge[side]);
        if (!source || !Array.isArray(source.receipts)
          || !source.receipts.some(receipt => receipt.id === edge[`${side}Receipt`])) fail();
      }
    }
  }
  // The existing consumer remains the sole validator of complete source DTOs,
  // its 24 kB answer body and the question. Nothing in rationale is forwarded.
  return { isError: false, content: [{ type: 'text', text: JSON.stringify({ ok: true,
    evidenceTrust: TRUST, value: { memories: sources, namespaces: [], coverage: 'complete' } }) }] };
}

export function prepareNeighborhoodSourceAnswer({ question, toolResult, requestedContextMode }) {
  return prepareInstalledSourceAnswer({ question, toolResult: project(toolResult, requestedContextMode) });
}

/** No transport is created here. An injected completion is called at most once. */
export async function deliverNeighborhoodSourceAnswer({ question, toolResult, requestedContextMode, complete }) {
  let projected;
  try { projected = project(toolResult, requestedContextMode); }
  catch { return { status: 'invalid-source', answer: null, completionCalls: 0 }; }
  return deliverInstalledSourceAnswer({ question, toolResult: projected, complete });
}

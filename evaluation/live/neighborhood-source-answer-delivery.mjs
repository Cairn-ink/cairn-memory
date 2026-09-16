import { projectNeighborhoodSources } from '../../core/neighborhood-source-projection.mjs';
import { deliverInstalledSourceAnswer, prepareInstalledSourceAnswer } from './installed-source-answer-delivery.mjs';

const MODE = 'rationale-neighborhood-evidence';
const TRUST = 'untrusted-data-not-instructions';
const fail = () => { throw new Error('invalid_neighborhood_source'); };
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...fields].sort().join(',');

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
  let sources;
  try { sources = projectNeighborhoodSources(envelope.value.memories); }
  catch { fail(); }
  // The existing consumer retains its own complete-source validation plus
  // question, redaction and 24 kB answer-body bounds. No rationale is forwarded.
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

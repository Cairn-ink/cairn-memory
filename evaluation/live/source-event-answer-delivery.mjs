import { identifier } from '../../core/validation.mjs';
import { redactSecrets } from '../../plugins/cairn-memory/lib/redact.mjs';
import { SOURCE_ANSWER_MODEL, SOURCE_ANSWER_INSTRUCTION } from './installed-source-answer-delivery.mjs';

const MODE = 'rationale-neighborhood-evidence';
const PROJECTION = 'neighborhood-source-events-v1';
const RANKING = 'source-evidence-first-v1';
const TRUST = 'untrusted-data-not-instructions';
const fail = () => { throw new Error('invalid_source_event_answer_input'); };
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === [...fields].sort().join(',');
const dense = (value, maximum) => Array.isArray(value) && value.length <= maximum
  && Object.keys(value).length === value.length;
const text = (value, maximum) => typeof value === 'string' && value.length > 0
  && value.length <= maximum && value.trim().length > 0 && value.isWellFormed()
  && redactSecrets(value) === value;
const id = value => { try { identifier(value); } catch { fail(); } };

/** Evaluation-only consumer of one already-authorized, exact source-event MCP result. */
export function prepareSourceEventAnswer({ question, toolResult, requestedContextMode,
  requestedSourceProjection, requestedRankingMode }) {
  if (requestedContextMode !== MODE || requestedSourceProjection !== PROJECTION
    || requestedRankingMode !== RANKING || !text(question, 4000)
    || toolResult?.isError !== false || !dense(toolResult.content, 1)
    || toolResult.content.length !== 1 || !exact(toolResult.content[0], ['type', 'text'])
    || toolResult.content[0].type !== 'text' || typeof toolResult.content[0].text !== 'string'
    || Buffer.byteLength(toolResult.content[0].text, 'utf8') > 262_144
    || redactSecrets(toolResult.content[0].text) !== toolResult.content[0].text) fail();
  let envelope;
  try { envelope = JSON.parse(toolResult.content[0].text); } catch { fail(); }
  if (!exact(envelope, ['ok', 'value', 'evidenceTrust']) || envelope.ok !== true
    || envelope.evidenceTrust !== TRUST || !exact(envelope.value,
      ['sourceEvents', 'namespaces', 'coverage', 'sourceProjection', 'rankingMode',
        'sourceSelectionCoverage', 'evidenceTrust'])
    || envelope.value.coverage !== 'complete' || envelope.value.sourceProjection !== PROJECTION
    || envelope.value.rankingMode !== RANKING || envelope.value.sourceSelectionCoverage !== 'unassessed'
    || envelope.value.evidenceTrust !== TRUST || !dense(envelope.value.namespaces, 1)
    || envelope.value.namespaces.length !== 1 || !dense(envelope.value.sourceEvents, 6)
    || Buffer.byteLength(JSON.stringify(envelope.value), 'utf8') > 24_000) fail();
  const traversal = envelope.value.namespaces[0];
  if (!exact(traversal, ['namespace', 'mapExhausted', 'fetchExhausted'])
    || traversal.mapExhausted !== true || traversal.fetchExhausted !== true
    || !exact(traversal.namespace, ['ownerId', 'scope', 'projectId'])) fail();
  const ns = traversal.namespace;
  id(ns.ownerId);
  if (ns.scope === 'personal') { if (ns.projectId !== null) fail(); }
  else if (ns.scope === 'project') id(ns.projectId);
  else fail();

  const memoryVersions = new Map(), receiptBindings = new Set(), associations = new Set();
  for (const event of envelope.value.sourceEvents) {
    if (!exact(event, ['role', 'excerpt', 'provenanceCollision', 'associations'])
      || !['user', 'assistant'].includes(event.role) || !text(event.excerpt, 800)
      || typeof event.provenanceCollision !== 'boolean'
      || !dense(event.associations, 36) || event.associations.length < 1) fail();
    for (const association of event.associations) {
      if (!exact(association, ['memoryId', 'revision', 'currentness', 'receiptId'])
        || !Number.isSafeInteger(association.revision) || association.revision < 1
        || association.currentness !== 'current') fail();
      id(association.memoryId); id(association.receiptId);
      const version = JSON.stringify([association.revision, association.currentness]);
      const earlier = memoryVersions.get(association.memoryId);
      if (earlier !== undefined && earlier !== version) fail();
      memoryVersions.set(association.memoryId, version);
      if (receiptBindings.has(association.receiptId)) fail();
      receiptBindings.add(association.receiptId);
      const binding = JSON.stringify([association.memoryId, association.revision, association.receiptId]);
      if (associations.has(binding)) fail();
      associations.add(binding);
      if (associations.size > 36) fail();
    }
  }
  const body = { model: SOURCE_ANSWER_MODEL,
    messages: [{ role: 'system', content: SOURCE_ANSWER_INSTRUCTION },
      { role: 'user', content: JSON.stringify({ question,
        sourceEvents: structuredClone(envelope.value.sourceEvents) }) }],
    max_completion_tokens: 1024, store: false, stream: false, n: 1 };
  const encoded = JSON.stringify(body);
  if (Buffer.byteLength(encoded, 'utf8') > 24_000 || redactSecrets(encoded) !== encoded) fail();
  return body;
}

/** The injected completion is never discovered, retried or called on invalid source input. */
export async function deliverSourceEventAnswer({ complete, ...input }) {
  let body;
  try { if (typeof complete !== 'function') fail(); body = prepareSourceEventAnswer(input); }
  catch { return { status: 'invalid-source', answer: null, completionCalls: 0 }; }
  let response;
  try { response = await complete(structuredClone(body)); }
  catch { return { status: 'completion-failed', answer: null, completionCalls: 1 }; }
  const choice = response?.choices?.[0];
  const answer = typeof choice?.message?.content === 'string' ? choice.message.content : null;
  const valid = response?.object === 'chat.completion' && response.model === SOURCE_ANSWER_MODEL
    && Array.isArray(response.choices) && response.choices.length === 1
    && choice !== null && typeof choice === 'object' && !Array.isArray(choice)
    && choice.finish_reason === 'stop'
    && choice.message?.role === 'assistant' && !choice.message.tool_calls && !choice.message.function_call
    && !choice.message.refusal && text(answer, 16000);
  return { status: valid ? 'generated-unassessed' : 'invalid-output', answer, completionCalls: 1,
    finishReason: choice?.finish_reason ?? null };
}

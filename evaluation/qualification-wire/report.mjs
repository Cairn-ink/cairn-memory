import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createQualificationCandidateSnapshot } from '../../core/qualification-candidates.mjs';
import { createQualificationTextCatalog, snapshotQualificationTextCatalog } from '../../core/qualification-text-catalog.mjs';
import { standardInlineQualificationPrompt } from '../../core/qualification-candidates-prompt.mjs';
import { countOpenAITokens, createOpenAIModel } from '../../adapters/openai/index.mjs';
import { DEFAULT_MODEL } from '../../adapters/openai/profiles.mjs';
import { measureCandidateRequest } from './direct-candidates.mjs';

const KINDS = Object.freeze(['short', 'ascii200', 'ascii800', 'unicode800']);
function seededAscii(itemIndex, receiptIndex, length) {
  let text = '';
  for (let counter = 0; text.length < length; counter++) {
    text += createHash('sha256').update(`direct-wire-${itemIndex}-${receiptIndex}-${counter}`).digest('hex');
  }
  return text.slice(0, length);
}
function fixtureReceipts(kind, itemIndex) {
  if (kind === 'short') return [`Synthetic user source ${itemIndex} with a distinct label.`];
  return Array.from({ length: 4 }, (_, receiptIndex) => kind === 'unicode800'
    ? `${seededAscii(itemIndex, receiptIndex, 199)}🚋${seededAscii(itemIndex + 71, receiptIndex, 599)}`
    : seededAscii(itemIndex, receiptIndex, kind === 'ascii200' ? 200 : 800));
}

export function syntheticSnapshot(kind, itemCount) {
  if (!KINDS.includes(kind) || ![1, 5].includes(itemCount)) throw new Error('invalid_experiment_fixture');
  return createQualificationCandidateSnapshot(Array.from({ length: itemCount }, (_, itemIndex) => ({
    content: `Synthetic claim ${itemIndex}`, kind: 'fact', confidence: 0.8,
    receipts: fixtureReceipts(kind, itemIndex).map((excerpt, receiptIndex) => ({ client: 'synthetic',
      sessionId: `session-${itemIndex}`, eventId: `event-${itemIndex}-${receiptIndex}`, role: 'user', excerpt })),
  })));
}

function singleton(input, index) {
  const item = input.items[index];
  return { items: [{ ...item, itemIndex: 0 }] };
}

function selected(input, wire) {
  const inline = measureCandidateRequest(input, wire);
  if (inline.logicalTokens <= 6000 && inline.countBodyTokens <= 6000) {
    return { mode: 'inline', measured: inline };
  }
  const catalog = createQualificationTextCatalog(input).catalog;
  const measured = measureCandidateRequest(catalog, wire);
  return measured.logicalTokens <= 6000 && measured.countBodyTokens <= 6000
    ? { mode: 'catalog', measured } : null;
}

function schedule(input, wire) {
  const full = selected(input, wire);
  if (full) return { mode: full.mode === 'catalog' ? 'whole-catalog' : 'whole-inline', groups: [full] };
  const groups = input.items.map((_, index) => selected(singleton(input, index), wire));
  return groups.every(Boolean) ? { mode: 'singleton-preflight', groups } : { mode: 'refusal', groups: [] };
}

function summary(value) {
  const { countBody, generationBody, ...numbers } = value;
  return numbers;
}

export function syntheticOutputWire(input, wire, maximal = false) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let state = 7727;
  const maximalLabel = length => Array.from({ length }, () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return alphabet[state % alphabet.length];
  }).join('');
  const entries = Object.fromEntries(input.items.map(item => {
    const id = item.candidates[0].candidateIndex;
    const label = field => maximal ? maximalLabel(['scope', 'applies'].includes(field) ? 120 : 160) : null;
    const fields = Object.fromEntries(['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment']
      .map(field => [field, { value: ['attribution', 'commitment'].includes(field)
        ? maximal ? field === 'attribution' ? 'reported' : 'considered' : 'unknown' : label(field),
      [wire === 'baseline' ? 'evidenceSlots' : 'evidenceIndices']:
        maximal || field === 'value' ? [wire === 'baseline' ? 0 : id] : [] }]));
    return [`item_${item.itemIndex}`, { itemIndex: item.itemIndex,
      ...(wire === 'baseline' ? { pool: [id] } : {}), ...fields }];
  }));
  return { wireVersion: wire === 'baseline' ? 'evidence-pool-v1' : 'direct-candidates-v1', qualifications: entries };
}

function outputTokens(input, wire) {
  const compact = countOpenAITokens(JSON.stringify(syntheticOutputWire(input, wire)));
  const maximalLabels = countOpenAITokens(JSON.stringify(syntheticOutputWire(input, wire, true)));
  return { compact, maximalLabels, compactWithinLimit: compact <= 1024,
    maximalLabelsWithinLimit: maximalLabels <= 1024 };
}

function envelope(model, input) {
  const expanded = Object.hasOwn(input, 'inputMode') ? snapshotQualificationTextCatalog(input).expanded : input;
  return { object: 'response', model, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(syntheticOutputWire(expanded, 'baseline')) }] }],
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } };
}

export async function verifyActualBaseline(input, expected) {
  const bodies = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-only', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: async (url, options) => {
      bodies.push(options.body);
      return Response.json(url.endsWith('/input_tokens')
        ? { object: 'response.input_tokens', input_tokens: 120 }
        : envelope(JSON.parse(options.body).model, input));
    } });
  await model.qualifyCandidates({ system: standardInlineQualificationPrompt, input,
    maxOutputTokens: 1024, signal: new AbortController().signal });
  if (bodies.length !== 2 || bodies[0] !== expected.countBody || bodies[1] !== expected.generationBody) {
    throw new Error('baseline_serializer_mismatch');
  }
  return bodies.length;
}

async function actualWholeRefusal(input) {
  let calls = 0;
  const model = createOpenAIModel({ apiKey: 'synthetic-only', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: async () => { calls++; throw new Error('unexpected_fake_http_dispatch'); } });
  let rejected = false;
  try { await model.qualifyCandidates({ system: standardInlineQualificationPrompt, input,
    maxOutputTokens: 1024, signal: new AbortController().signal }); }
  catch (error) { rejected = error?.code === 'context_budget_exceeded'; }
  if (!rejected || calls !== 0) throw new Error('baseline_refusal_mismatch');
  return calls;
}

export async function buildDirectCandidateReport() {
  const fixtures = [];
  for (const kind of KINDS) for (const itemCount of [1, 5]) {
    const snapshot = syntheticSnapshot(kind, itemCount);
    const wholeInline = measureCandidateRequest(snapshot.input, 'baseline');
    const catalogInput = createQualificationTextCatalog(snapshot.input).catalog;
    const wholeCatalog = measureCandidateRequest(catalogInput, 'baseline');
    const directWholeInline = measureCandidateRequest(snapshot.input, 'direct');
    const directWholeCatalog = measureCandidateRequest(catalogInput, 'direct');
    const baseline = schedule(snapshot.input, 'baseline');
    const direct = schedule(snapshot.input, 'direct');
    let actualBaselineCalls = 0;
    let actualWholeRefusalCalls = 0;
    if (baseline.mode === 'singleton-preflight' || baseline.mode === 'refusal') {
      actualWholeRefusalCalls += await actualWholeRefusal(snapshot.input);
      actualWholeRefusalCalls += await actualWholeRefusal(catalogInput);
    }
    for (let index = 0; index < baseline.groups.length; index++) {
      const source = baseline.mode === 'singleton-preflight' ? singleton(snapshot.input, index) : snapshot.input;
      const input = baseline.groups[index].mode === 'catalog'
        ? createQualificationTextCatalog(source).catalog : source;
      actualBaselineCalls += await verifyActualBaseline(input, baseline.groups[index].measured);
    }
    const schemaOnly = measureCandidateRequest(snapshot.input, 'schema-only');
    fixtures.push({ kind, itemCount, candidateCounts: snapshot.candidates.map(group => group.length),
      baseline: { mode: baseline.mode, qualifierPairs: baseline.groups.length || null,
        actualFakeHttpCalls: actualBaselineCalls, actualWholeRefusalCalls,
        wholeInline: { ...summary(wholeInline), evidence: baseline.mode === 'whole-inline'
          ? 'actual-fake-http' : 'modeled-only' },
        wholeCatalog: { ...summary(wholeCatalog), evidence: baseline.mode === 'whole-catalog'
          ? 'actual-fake-http' : 'modeled-only' },
        groupsEvidence: baseline.groups.length ? 'actual-fake-http' : 'none',
        groups: baseline.groups.map(group => summary(group.measured)),
        outputTokens: outputTokens(snapshot.input, 'baseline') },
      direct: { mode: direct.mode, qualifierPairs: direct.groups.length || null,
        modeledOnly: true, wholeInline: summary(directWholeInline),
        wholeCatalog: summary(directWholeCatalog), groups: direct.groups.map(group => summary(group.measured)),
        outputTokens: outputTokens(snapshot.input, 'direct') },
      schemaOnly: { promptSha256: schemaOnly.promptSha256, schemaSha256: schemaOnly.schemaSha256,
        promptTokens: schemaOnly.promptTokens, schemaTokens: schemaOnly.schemaTokens,
        countBodyTokens: schemaOnly.countBodyTokens } });
  }
  return { schemaVersion: 'direct-candidate-wire-experiment-v1', model: DEFAULT_MODEL,
    limits: { localTokens: 6000, countBodyTokens: 6000, providerCountTokens: 7024, outputTokens: 1024 },
    fixtures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { process.stdout.write(`${JSON.stringify(await buildDirectCandidateReport())}\n`); }
  catch (error) { process.stderr.write(`${error?.message === 'baseline_serializer_mismatch'
    ? error.message : 'direct_candidate_experiment_failed'}\n`); process.exitCode = 1; }
}

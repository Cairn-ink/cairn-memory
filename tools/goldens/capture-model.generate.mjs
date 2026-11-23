import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const engineDir = process.env.ENGINE_DIR;
if (!engineDir) {
  console.error('Usage: ENGINE_DIR=<engine checkout> node tools/goldens/capture-model.generate.mjs');
  process.exit(2);
}

const load = path => import(pathToFileURL(resolve(engineDir, path)));
const [{ callModel }, { qualifyExtractedItems }, { qualifyCandidateItems }, { MemoryStoreError }] = await Promise.all([
  load('core/model-call.mjs'),
  load('core/automatic-qualification.mjs'),
  load('core/qualification-candidates.mjs'),
  load('core/validation.mjs'),
]);

const extractRequest = { system: 'Extract synthetic facts.', input: { messages: [
  { index: 0, role: 'user', content: 'I make cedar tea.' },
] }, maxOutputTokens: 1024 };
const extractOutput = { items: [{ content: 'I make cedar tea.', kind: 'fact', confidence: 0.9, sourceIndices: [0] }] };
const slot = { subject: null, property: null, scope: null, applies: null };

function qualification(itemIndex, receiptIndex, text) {
  return { itemIndex, qualification: { version: 1, slot, value: null, attribution: 'unknown',
    commitment: 'unknown', anchors: [{ receiptIndex, start: 0, end: text.length, text, fields: ['value'] }] } };
}

function candidate(itemIndex, ids) {
  return { itemIndex, subject: { value: null, evidenceIndices: [] }, property: { value: null, evidenceIndices: [] },
    scope: { value: null, evidenceIndices: [] }, applies: { value: null, evidenceIndices: [] },
    value: { value: null, evidenceIndices: ids }, attribution: { value: 'unknown', evidenceIndices: [] },
    commitment: { value: 'unknown', evidenceIndices: [] } };
}

function item(index, excerpt, content = 'Synthetic item ' + index, copies = 1) {
  return { content, kind: 'fact', confidence: 0.8, proceduralProposal: true, receipts: Array.from({ length: copies },
    (_, sequence) => ({ client: 'synthetic', sessionId: 'source', eventId: String(index) + '-' + sequence,
      role: 'user', excerpt, occurredAt: null })) };
}

const short = [item(0, 'Cedar tea is good.')];
const long = 'x'.repeat(140) + '🙂' + 'y'.repeat(170);
const pair = [item(0, long), item(1, long)];
const six = Array.from({ length: 6 }, (_, i) => item(i, 'Cedar tea is good.'));
const duplicate = structuredClone(short);
duplicate[0].receipts.push(structuredClone(duplicate[0].receipts[0]));
const cases = [];

function runCall(name, script, expectedCode) {
  cases.push({ name, operation: 'call', method: 'extract', request: extractRequest, script, expectedCode });
}
function automatic(name, items, script, expectedCode) {
  cases.push({ name, operation: 'automatic', method: 'qualify', items, script, expectedCode });
}
function candidates(name, items, script, expectedCode) {
  cases.push({ name, operation: 'candidates', method: 'qualifyCandidates', items, script, expectedCode });
}

runCall('success at both token limits', { inputCount: 6000, outputCount: 1024 });
runCall('missing adapter', { provider: 'missing' }, 'model_not_configured');
runCall('context window below minimum', { contextWindow: 8191 }, 'context_budget_exceeded');
runCall('input exceeds 6000 tokens', { inputCount: 6001 }, 'context_budget_exceeded');
runCall('missing counter', { counter: 'missing' }, 'token_count_unavailable');
runCall('input counter throws', { counter: 'input throw' }, 'token_count_unavailable');
runCall('output counter throws', { counter: 'output throw' }, 'token_count_unavailable');
runCall('counter returns a negative count', { inputCount: -1 }, 'token_count_unavailable');
runCall('output exceeds 1024 tokens', { outputCount: 1025 }, 'invalid_model_output');
runCall('provider throws', { provider: 'throw' }, 'extraction_failed');
runCall('provider throws AbortError', { provider: 'abort' }, 'model_cancelled');
runCall('provider throws deadline code', { provider: 'model_timeout' }, 'model_timeout');
runCall('provider shape error', { provider: 'invalid_model_output' }, 'invalid_model_output');
runCall('provider budget error', { provider: 'context_budget_exceeded' }, 'context_budget_exceeded');
runCall('provider counter error', { provider: 'token_count_unavailable' }, 'token_count_unavailable');
runCall('provider cannot claim validation provenance', { provider: 'untrusted validation' }, 'extraction_failed');
runCall('unserializable output', { output: 'bigint' }, 'invalid_model_output');
runCall('missing serialized output', { output: 'undefined' }, 'invalid_model_output');
runCall('output exceeds 40000 UTF-16 units', { output: 'oversize' }, 'invalid_model_output');
runCall('already expired', { expireAt: 'entry' }, 'model_timeout');
runCall('deadline wins over a count failure', { counter: 'input throw', expireAt: 'input count' }, 'model_timeout');
runCall('expired while provider awaited', { expireAt: 'provider' }, 'model_timeout');
runCall('initial freshness refuses', { freshFailsAt: 1 }, 'capture_evidence_closed');
runCall('deferred freshness refuses', { freshFailsAt: 2 }, 'capture_evidence_closed');
runCall('durable dispatch refuses', { dispatchFails: true }, 'capture_evidence_closed');
runCall('output freshness refuses', { freshFailsAt: 3 }, 'capture_evidence_closed');
runCall('final freshness refuses', { freshFailsAt: 4 }, 'capture_evidence_closed');

automatic('one group', short, {});
automatic('split whole request into singletons', pair, { itemLimit: 1 });
automatic('shorten excerpt across a surrogate pair', pair, { textLimit: 141 });
automatic('item below the minimum fit stays unqualified', pair, { textLimit: 119 });
automatic('aggregate counters across five-item batches', [...six.slice(0, 5), ...pair.slice(1)],
  { itemLimit: 1, excluded: pair[1].content });
automatic('partial counters survive a second-batch failure', six,
  { provider: 'throw', failAtCall: 2 }, 'qualification_failed');
automatic('stage validation rejects distant anchors', short, { output: 'wrong anchor' }, 'invalid_model_output');
automatic('planner cannot count tokens', short, { counter: 'input throw' }, 'token_count_unavailable');
automatic('missing adapter reaches the guard', short, { provider: 'missing' }, 'model_not_configured');

candidates('fits accepts inline', short, { fit: 'true' });
candidates('absent fits uses the logical count', short, {});
candidates('fits refuses even the shortest request', short, { fit: 'false' });
candidates('throwing fits signals token count failure', short, { fit: 'throw' }, 'token_count_unavailable');
candidates('fits selects whole text catalog', pair, { fit: 'catalog' });
candidates('core count selects whole text catalog', pair, { textLimit: 400 });
candidates('core count applies even when fits accepts', pair, { itemLimit: 1, fit: 'true' });
candidates('adapter fit splits whole request into singletons', pair, { fit: 'singleton' });
candidates('adapter fit selects singleton text catalogs', pair, { fit: 'singleton catalog' });
candidates('shorten candidates across a surrogate pair', pair, { textLimit: 141 });
candidates('aggregate counters across five-item batches', [...six.slice(0, 5), ...pair.slice(1)],
  { itemLimit: 1, excluded: pair[1].content });
candidates('partial counters survive a second-batch failure', six,
  { provider: 'throw', failAtCall: 2 }, 'qualification_failed');
candidates('stage validation rejects uncited output', short, { output: 'no citations' }, 'invalid_model_output');
candidates('stage validation rejects noncanonical labels', short, { output: 'leading label' }, 'invalid_model_output');
candidates('stage validation rejects duplicate source anchors', duplicate, { output: 'duplicate anchors' },
  'invalid_model_output');
candidates('planner cannot count tokens', short, { counter: 'input throw' }, 'token_count_unavailable');
candidates('missing adapter reaches the guard', short, { provider: 'missing' }, 'model_not_configured');

function inputCount(envelope, script) {
  const { input } = envelope;
  const items = input.items ?? [];
  const passages = input.texts ?? items.flatMap(entry => entry.sources
    ? entry.sources.map(source => source.excerpt) : entry.candidates.map(candidate => candidate.text));
  if (items.length > (script.itemLimit ?? Infinity) || items.some(entry => entry.content === script.excluded) ||
      passages.reduce((sum, text) => sum + text.length, 0) > (script.textLimit ?? Infinity)) return 6001;
  return script.inputCount ?? 1;
}

function fitRequest(input, fit) {
  switch (fit) {
    case 'true': return true;
    case 'false': return false;
    case 'throw': throw new Error('synthetic');
    case 'catalog': return input.inputMode === 'text-catalog-v1';
    case 'singleton': return input.items.length === 1;
    case 'singleton catalog': return input.items.length === 1 && input.inputMode === 'text-catalog-v1';
    default: assert.fail('Unknown fit script');
  }
}

function valueFor(method, input, script) {
  if (script.output === 'bigint') return { value: 1n };
  if (script.output === 'undefined') return;
  if (script.output === 'oversize') return { value: '🙂'.repeat(20_001) };
  if (method === 'extract') return extractOutput;
  return { qualifications: input.items.map(entry => {
    if (method === 'qualify') {
      const source = entry.sources[0];
      return qualification(entry.itemIndex, source.receiptIndex,
        script.output === 'wrong anchor' ? 'absent' : source.excerpt.slice(0, 1));
    }
    const ids = script.output === 'no citations' ? [] : entry.candidates
      .slice(0, script.output === 'duplicate anchors' ? 2 : 1).map(value => value.candidateIndex);
    const result = candidate(entry.itemIndex, ids);
    if (script.output === 'leading label') result.subject = { value: ' leading', evidenceIndices: ids };
    return result;
  }) };
}

async function observe({ expectedCode, ...golden }) {
  const { operation, method, request, items, script, name } = golden;
  const requests = [], outputs = [], diagnostics = [], trace = [], sizing = [];
  let expired = script.expireAt === 'entry';
  let freshCalls = 0;
  const deadline = { expired: () => expired, remainingMs: () => 30_000,
    check() { if (expired) throw new MemoryStoreError('model_timeout'); } };
  const model = {
    contextWindow: script.contextWindow ?? 8192,
    onDiagnostic({ version, stage, layer, reason }) {
      assert.equal(version, 1);
      diagnostics.push({ stage, layer, reason });
    },
  };
  if (script.counter !== 'missing') model.countTokens = text => {
    const parsed = JSON.parse(text);
    const input = Object.hasOwn(parsed, 'system');
    trace.push(input ? 'input count' : 'output count');
    sizing.push(createHash('sha256').update(text).digest('hex'));
    if (input && script.expireAt === 'input count') expired = true;
    if (script.counter === (input ? 'input throw' : 'output throw')) throw new Error('synthetic');
    return input ? inputCount(parsed, script) : script.outputCount ?? 1;
  };
  if (script.fit) model.fitsQualificationRequest = ({ input }) => {
    trace.push('fits');
    return fitRequest(input, script.fit);
  };
  if (script.provider !== 'missing') model[method] = async ({ system, input, maxOutputTokens }) => {
    trace.push('call');
    requests.push({ system, input, maxOutputTokens });
    if (script.expireAt === 'provider') expired = true;
    if (script.provider && (!script.failAtCall || script.failAtCall === requests.length)) {
      switch (script.provider) {
        case 'throw': throw new Error('synthetic');
        case 'abort': throw new DOMException('synthetic', 'AbortError');
        case 'untrusted validation': throw { code: 'invalid_model_output' };
        default: throw new MemoryStoreError(script.provider);
      }
    }
    const value = valueFor(method, input, script);
    if (!['bigint', 'undefined', 'oversize'].includes(script.output)) outputs[requests.length - 1] = value;
    return value;
  };
  const report = {};
  const validateFresh = () => {
    trace.push('fresh');
    if (++freshCalls === script.freshFailsAt) throw new MemoryStoreError('capture_evidence_closed');
  };
  const beforeDispatch = () => {
    trace.push('before dispatch');
    if (script.dispatchFails) throw new MemoryStoreError('capture_evidence_closed');
  };
  let expected;
  try {
    let result;
    if (operation === 'call') result = await callModel(model, method, request.system, request.input,
      { failureCode: 'extraction_failed', deadline, validateFresh, beforeDispatch });
    else if (operation === 'automatic') result = await qualifyExtractedItems(model, items, deadline, report, validateFresh);
    else result = await qualifyCandidateItems(model, items, deadline, validateFresh, false, report);
    expected = { result };
  } catch (error) {
    assert.ok(error instanceof MemoryStoreError, name);
    expected = { errorCode: error.code };
  }
  assert.equal(expected.errorCode, expectedCode, name);
  return { ...golden, requests, outputs, callCount: requests.length, diagnostics, expected, report, trace, sizing };
}

const results = [];
for (const golden of cases) results.push(await observe(golden));
const serialized = JSON.stringify({ cases: results }, null, 2) + '\n';
assert.ok(Buffer.byteLength(serialized) < 1_000_000);
writeFileSync(new URL('../../packages/core/test/fixtures/capture/engine-model-goldens.json', import.meta.url), serialized);

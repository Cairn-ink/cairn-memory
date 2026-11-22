import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const engineDir = process.env.ENGINE_DIR;
if (!engineDir) {
  console.error('Usage: ENGINE_DIR=<engine checkout> node tools/goldens/capture-wire.generate.mjs');
  process.exit(2);
}
const load = path => import(pathToFileURL(resolve(engineDir, path)));
const [{ createOpenAIModel: createEngineModel }, { extractionOutputTokens, retainedSourceView },
  { sourceWindowCatalog }, { standardInlineQualificationPrompt }, { createQualificationTextCatalog }] =
  await Promise.all([
    load('adapters/openai/index.mjs'),
    load('core/capture-input.mjs'),
    load('core/source-windows.mjs'),
    load('core/qualification-candidates-prompt.mjs'),
    load('core/qualification-text-catalog.mjs'),
  ]);

const seed = 0xbb67ae85;
let state = seed;
const words = ['cedar', 'quiet', 'tea', 'stone', '步道', '白茶', '石頭', '小路'];
function word() {
  state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
  return words[state >>> 29];
}
const prompt = name => readFileSync(resolve(engineDir, 'core/prompts', name + '.md'), 'utf8');
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const cases = [];
const adapterOnlyCases = [];

function bodyFields(body) {
  return {
    instructions: body.instructions,
    input_text: body.input[0].content[0].text,
    text: { format: { name: body.text.format.name, schema: body.text.format.schema } },
  };
}

function responseEnvelope(model, output) {
  return {
    object: 'response', model, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 },
  };
}

const json = value => new Response(JSON.stringify(value));

async function observe({ name, method, mode, request, output, qualificationInputMode = 'inline',
  reasons = [], adapterFailure }) {
  let body;
  let tokenCount;
  const diagnostics = [];
  const model = createEngineModel({
    apiKey: 'synthetic-key', qualificationInputMode,
    onDiagnostic({ version, stage, layer, reason }) {
      assert.equal(version, 1);
      diagnostics.push({ stage, layer, reason });
    },
    async fetchImpl(_location, { body: serialized }) {
      const parsed = JSON.parse(serialized);
      if (!Object.hasOwn(parsed, 'max_output_tokens')) {
        assert.equal(tokenCount, undefined);
        const { instructions, input_text, text } = bodyFields(parsed);
        tokenCount = { happened: true, instructions, input_text, schema: text.format.schema };
        return adapterFailure?.count?.() ?? json({ object: 'response.input_tokens', input_tokens: 100 });
      }
      assert.equal(body, undefined);
      body = { ...bodyFields(parsed), max_output_tokens: parsed.max_output_tokens,
        store: parsed.store, stream: parsed.stream, truncation: parsed.truncation };
      const envelope = responseEnvelope(parsed.model, output);
      return adapterFailure?.respond?.(envelope) ?? json(envelope);
    },
  });
  let expected;
  try {
    const signal = adapterFailure?.signal ?? new AbortController().signal;
    expected = { result: await model[method]({ ...request, signal }) };
  } catch (error) {
    expected = { errorCode: error.code ?? error.name };
  }
  assert.deepEqual(diagnostics.map(event => event.reason), reasons, name);
  assert.equal(Object.hasOwn(expected, 'errorCode'), reasons.length > 0, name);
  if (!adapterFailure) {
    assert.ok(body && tokenCount, name);
    assert.equal(body.store, false, name);
    assert.equal(body.stream, false, name);
    assert.equal(body.truncation, 'disabled', name);
  }
  const golden = { name, method, mode, qualificationInputMode, request, body,
    tokenCount: tokenCount ?? { happened: false }, output, expected, diagnostics };
  (adapterFailure ? adapterOnlyCases : cases).push(golden);
}

function extraction(mode, count) {
  const messages = Array.from({ length: count }, (_, index) => ({
    id: `message-${index}`,
    role: index % (mode === 'retained' ? 3 : mode === 'indexed' ? 5 : 8) === 1 ? 'assistant' : 'user',
    content: `${word()} and ${word()} at the trail 石頭 ${index}.`,
  }));
  if (mode !== 'plain') messages[0].content += ' cedar 小路'.repeat(105);
  const system = prompt({
    plain: 'extract-memories', retained: 'extract-retained-sources', indexed: 'extract-source-windows',
  }[mode]);
  const input = mode === 'indexed' ? sourceWindowCatalog({ messages }).input :
    { messages: (mode === 'retained' ? retainedSourceView({ messages }).messages : messages)
      .map(({ role, content }, index) => ({ index, role, content })) };
  const output = { items: [{
    content: `Remember ${word()} 步道`, kind: 'fact', confidence: 0.75,
    sourceIndices: input.messages.length === 1 ? [0] : [0, input.messages.length - 1],
  }] };
  return { name: `${mode} ${count} messages`, method: 'extract', mode,
    request: { system, input, maxOutputTokens: extractionOutputTokens(input.messages) }, output };
}

let plainExtract;
for (const mode of ['plain', 'retained', 'indexed']) {
  for (const count of [1, 5, 24]) {
    const example = extraction(mode, count);
    if (mode === 'plain' && count === 1) plainExtract = example;
    await observe(example);
  }
}

function automaticQualification(count) {
  const items = Array.from({ length: count }, (_, itemIndex) => ({
    itemIndex, content: `Bring ${word()} 小路`, kind: 'decision',
    sources: Array.from({ length: (itemIndex % 4) + 1 }, (_, receiptIndex) => ({
      receiptIndex, role: 'user', excerpt: `Bring ${word()} 白茶`,
    })),
  }));
  const output = { qualifications: items.map(({ itemIndex, sources }) => {
    const source = sources.at(-1);
    return { itemIndex, qualification: {
      version: 1, slot: { subject: 'Hiker', property: null, scope: null, applies: '週末' },
      value: null, attribution: 'direct', commitment: 'unknown', anchors: [
        { receiptIndex: source.receiptIndex, start: 0, end: source.excerpt.length, text: source.excerpt, fields: ['subject'] },
      ],
    } };
  }) };
  return { name: `automatic ${count} items`, method: 'qualify', mode: 'automatic',
    request: { system: prompt('qualify-memories'), input: { items }, maxOutputTokens: 1024 }, output };
}
for (let count = 1; count <= 5; count++) await observe(automaticQualification(count));

function candidateQualification(mode, counts, custom = false) {
  const items = counts.map((count, position) => ({
    itemIndex: [9, 2, 15, 0, 6][position],
    content: `We will bring ${word()} 小路`, kind: 'decision',
    candidates: Array.from({ length: count }, (_, index) => ({
      candidateIndex: 3 + position * 100 + (count - index) * 2,
      role: index % 2 ? 'assistant' : 'user',
      text: index % 3 ? 'Bring 白茶' : `Consider ${word()}`,
    })),
  }));
  const qualifications = Object.fromEntries([...items].reverse().map(({ itemIndex, candidates }) => {
    const pool = candidates.slice(0, 4).reverse().map(candidate => candidate.candidateIndex);
    const last = pool.length - 1;
    const values = ['Hiker', '茶', null, null, '白茶', 'direct', 'adopted'];
    return [`item_${itemIndex}`, { itemIndex, pool, ...Object.fromEntries(fields.map((field, index) => [
      field, { value: values[index], evidenceSlots: index === 0 ? [last, 0, last] :
        values[index] === null ? [] : [0] },
    ])) }];
  }));
  const catalog = mode === 'catalog';
  const qualificationInputMode = mode === 'inline' ? 'inline' : 'adaptive-text-catalog-v1';
  const input = catalog ? createQualificationTextCatalog({ items }).catalog : { items };
  const system = custom ? 'Use source support for each trail decision. 根據來源判斷。' : standardInlineQualificationPrompt;
  return { name: `${mode} candidates ${counts.join('-')}`, method: 'qualifyCandidates', mode, qualificationInputMode,
    request: { system, input, maxOutputTokens: 1024 }, output: { wireVersion: 'evidence-pool-v1', qualifications } };
}

for (const mode of ['inline', 'catalog']) {
  for (const counts of [[1], [2, 3], [4, 5, 6], [7, 8, 9, 10], [16, 17, 18, 19, 20]]) {
    await observe(candidateQualification(mode, counts));
  }
  await observe(candidateQualification(mode, [11, 12, 13, 14, 15], true));

  const invalid = candidateQualification(mode, [2], true);
  for (const [name, reason, change] of [
    ['extra entry field', 'qualification_wire_shape', entry => { entry.extra = true; }],
    ['duplicate pool member', 'qualification_pool_mapping', entry => { entry.pool[1] = entry.pool[0]; }],
    ['slot outside pool', 'qualification_slot_mapping', entry => { entry.subject.evidenceSlots = [0, entry.pool.length]; }],
    ['value too long', 'qualification_value_shape', entry => { entry.value.value = '石'.repeat(161); }],
    ['known value without evidence', 'qualification_value_shape', entry => { entry.value.evidenceSlots = []; }],
  ]) {
    const output = structuredClone(invalid.output);
    change(output.qualifications.item_9);
    await observe({ ...invalid, name: `${mode} ${name}`, output, reasons: [reason] });
  }
}
await observe(candidateQualification('adaptive-inline', [2]));
for (const example of [plainExtract, automaticQualification(1), candidateQualification('inline', [1], true)]) {
  await observe({ ...example, name: `${example.mode} output is an array`, output: [], reasons: ['output_shape'] });
}

// These failures occur before the adapter supplies a parsed model output to core.
const responseFailures = [
  ['response_envelope', envelope => { envelope.status = 'failed'; }],
  ['response_usage', envelope => { envelope.usage.total_tokens = 0; }],
  ['response_message', envelope => { envelope.output[0].role = 'user'; }],
  ['response_content', envelope => { envelope.output[0].content[0].type = 'refusal'; }],
  ['output_json', envelope => { envelope.output[0].content[0].text = '{'; }],
  ['output_bounds', envelope => { envelope.output[0].content[0].text = ' x'.repeat(20001); }],
  ['output_truncated', envelope => {
    envelope.status = 'incomplete';
    envelope.incomplete_details = { reason: 'max_output_tokens' };
  }],
];
for (const [reason, change] of responseFailures) {
  await observe({ ...plainExtract, name: reason, reasons: [reason], adapterFailure: {
    respond(envelope) { change(envelope); return json(envelope); },
  } });
}

for (const [reason, reasons, count] of [
  ['response_body_bounds', ['response_body_bounds', 'transport_failure'], () => new Response('x'.repeat(65537))],
  ['response_json', ['response_json', 'transport_failure'], () => new Response('{')],
  ['transport_failure', ['transport_failure'], () => { throw new Error('synthetic transport failure'); }],
  ['token_count_response', ['token_count_response'], () => json({ object: 'response.input_tokens', input_tokens: -1 })],
  ['request_bounds', ['request_bounds'], () => json({ object: 'response.input_tokens', input_tokens: 7025 })],
]) {
  await observe({ ...plainExtract, name: reason, reasons, adapterFailure: { count } });
}

await observe({ ...plainExtract, name: 'request_invalid', reasons: ['request_invalid'],
  request: { ...plainExtract.request, maxOutputTokens: 0 }, adapterFailure: {} });
await observe({ ...plainExtract, name: 'model_cancelled', reasons: ['model_cancelled'],
  adapterFailure: { signal: AbortSignal.abort() } });

const fixture = new URL('../../packages/core/test/fixtures/capture/engine-wire-goldens.json', import.meta.url);
const section = rows => rows.map(row => '    ' + JSON.stringify(row)).join(',\n');
const contents = `{\n  "seed": ${seed},\n  "cases": [\n${section(cases)}\n  ],\n  "adapterOnlyCases": [\n${section(adapterOnlyCases)}\n  ]\n}\n`;
const bytes = Buffer.byteLength(contents);
assert.ok(bytes < 1_000_000, `Wire fixture is ${bytes} bytes and must stay below 1 MB`);
writeFileSync(fixture, contents);

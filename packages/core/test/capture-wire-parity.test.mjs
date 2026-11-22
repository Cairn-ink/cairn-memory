import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildModelRequest, decodeModelOutput } from '../src/capture/wire.mjs';
import { snapshotIndexedExtractInput, schemasFor, schemasForQualificationInput } from '../src/capture/wire-schemas.mjs';
import { CoreError } from '../src/errors.mjs';

const fixture = new URL('./fixtures/capture/engine-wire-goldens.json', import.meta.url);
const { cases, adapterOnlyCases } = JSON.parse(readFileSync(fixture, 'utf8'));

function build(golden) {
  const { system, input } = golden.request;
  return buildModelRequest(golden.method, { system, input }, { qualificationInputMode: golden.qualificationInputMode });
}

function assertWireFields({ instructions, input_text, schema }, built) {
  assert.equal(built.request.system, instructions);
  assert.equal(JSON.stringify(built.request.input), input_text);
  assert.deepEqual(built.request.schema, schema);
  assert.equal(JSON.stringify(built.request.schema), JSON.stringify(schema));
}

function assertRequest(golden, built) {
  const { method, body, tokenCount } = golden;
  const { instructions, input_text, max_output_tokens, text: { format } } = body;
  assert.equal(built.stage, method === 'extract' ? 'extract' : 'qualify');
  assertWireFields({ instructions, input_text, schema: format.schema }, built);
  assert.equal(built.request.maxOutputTokens, max_output_tokens);
  assert.equal(built.schemaName, format.name);
  assert.equal(built.sizingText, JSON.stringify({
    system: instructions, input: JSON.parse(input_text), maxOutputTokens: max_output_tokens,
  }));
  assert.deepEqual(tokenCount, { happened: true, instructions, input_text, schema: format.schema });
  assert.deepEqual([body.store, body.stream, body.truncation], [false, false, 'disabled']);
}

function assertInvalidOutput(run) {
  assert.throws(run, error => error instanceof CoreError && error.code === 'invalid_model_output');
}

assert.ok(cases.length > 0);
for (const golden of cases) {
  test(golden.method + ' / ' + golden.name, () => {
    const built = build(golden);
    assertRequest(golden, built);
    const diagnostics = [];
    const decode = () => decodeModelOutput(golden.method, built, golden.output,
      (stage, layer, reason) => diagnostics.push({ stage, layer, reason }));
    if (Object.hasOwn(golden.expected, 'errorCode')) {
      assert.equal(golden.expected.errorCode, 'invalid_model_output');
      assertInvalidOutput(decode);
    } else {
      assert.deepEqual(decode(), golden.expected.result);
    }
    assert.deepEqual(diagnostics, golden.diagnostics);
  });
}

for (const golden of adapterOnlyCases.filter(golden => golden.tokenCount.happened)) {
  test('request before adapter failure / ' + golden.name, () => {
    const built = build(golden);
    if (golden.body) assertRequest(golden, built);
    else assertWireFields(golden.tokenCount, built);
  });
}

test('decode rejects fields outside the extract and automatic qualification schemas', () => {
  for (const method of ['extract', 'qualify']) {
    const golden = cases.find(entry => entry.method === method && entry.expected.result);
    const output = structuredClone(golden.output);
    const items = method === 'extract' ? output.items : output.qualifications;
    items[0].extra = 'synthetic';
    const events = [];
    assertInvalidOutput(() => decodeModelOutput(method, build(golden), output, (...event) => events.push(event)));
    assert.deepEqual(events, [[method, 'adapter', 'output_shape']]);
  }
});

test('decode rejects invalid schema values and required fields', () => {
  const extract = cases.find(entry => entry.method === 'extract' && entry.expected.result);
  const qualify = cases.find(entry => entry.method === 'qualify' && entry.expected.result);
  for (const [golden, change] of [
    [extract, output => { output.items[0].sourceIndices = []; }],
    [extract, output => { output.items[0].confidence = 1.1; }],
    [extract, output => { delete output.items[0].kind; }],
    [qualify, output => { output.qualifications[0].qualification.slot.subject = ''; }],
    [qualify, output => { output.qualifications[0].qualification.value = true; }],
  ]) {
    const output = structuredClone(golden.output);
    change(output);
    assertInvalidOutput(() => decodeModelOutput(golden.method, build(golden), output));
  }
});

test('throwing and rejecting observers preserve the candidate decode failure', () => {
  const golden = cases.find(entry => entry.diagnostics.some(event => event.reason === 'qualification_value_shape'));
  for (const report of [
    () => { throw new Error('synthetic observer failure'); },
    async () => { throw new Error('synthetic asynchronous observer failure'); },
  ]) {
    assertInvalidOutput(() => decodeModelOutput(golden.method, build(golden), golden.output, report));
  }
});

test('candidate mode defaults to inline and rejects unsupported configurations', () => {
  const inline = cases.find(entry => entry.method === 'qualifyCandidates' && entry.mode === 'inline');
  const catalog = cases.find(entry => entry.method === 'qualifyCandidates' && entry.mode === 'catalog');
  assert.deepEqual(buildModelRequest(inline.method, inline.request), build(inline));
  assert.throws(() => buildModelRequest(catalog.method, catalog.request),
    { message: 'invalid_openai_request' });
  assert.throws(() => buildModelRequest(inline.method, inline.request, { qualificationInputMode: 'unknown' }),
    { message: 'invalid_openai_configuration' });
  const badCatalog = structuredClone(catalog.request);
  badCatalog.input.inputMode = 'unknown';
  assert.throws(() => buildModelRequest(catalog.method, badCatalog, { qualificationInputMode: catalog.qualificationInputMode }),
    { message: 'invalid_openai_request' });
  assert.throws(() => schemasForQualificationInput(badCatalog.input), { message: 'invalid_openai_request' });
});

test('indexed input checks data descriptors before JSON serialization and canonicalizes key order', () => {
  const golden = cases.find(entry => entry.mode === 'indexed');
  const { inputMode, messages } = golden.request.input;
  const reordered = { messages: messages.map(({ index, messageIndex, role, content }) =>
    ({ content, role, messageIndex, index })), inputMode };
  const request = { ...golden.request, input: reordered };
  assertRequest(golden, build({ ...golden, request }));

  let reads = 0;
  Object.defineProperty(reordered.messages[0], 'content', {
    get() { reads++; return 'synthetic accessor'; },
  });
  for (const run of [
    () => snapshotIndexedExtractInput(reordered),
    () => schemasFor('extract', reordered),
    () => buildModelRequest('extract', request),
  ]) {
    assert.throws(run, { message: 'invalid_openai_request' });
  }
  assert.equal(reads, 0);
});

test('built requests own their snapshots across all input modes', () => {
  for (const golden of cases.filter(entry => entry.expected.result)) {
    const request = structuredClone(golden.request);
    const built = build({ ...golden, request });
    const input = request.input;
    if (input.messages) input.messages[0].content = 'changed';
    else input.items[0].content = 'changed';
    assertRequest(golden, built);
    assert.deepEqual(decodeModelOutput(golden.method, built, golden.output), golden.expected.result);
  }
});

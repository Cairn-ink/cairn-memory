import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildModelRequest, decodeModelOutput } from '../src/capture/wire.mjs';
import { snapshotIndexedExtractInput, schemasFor, schemasForQualificationInput } from '../src/capture/wire-schemas.mjs';
import { CoreError } from '../src/errors.mjs';

const fixture = new URL('./fixtures/capture/engine-wire-goldens.json', import.meta.url);
const { cases, adapterOnlyCases } = JSON.parse(readFileSync(fixture, 'utf8'));

function build(golden, report) {
  return buildModelRequest(golden.method, golden.request, { qualificationInputMode: golden.qualificationInputMode, report });
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

function assertInvalidInput(run) {
  assert.throws(run, error => error instanceof CoreError && error.code === 'invalid_input');
}

assert.ok(cases.length > 0);
for (const golden of cases) {
  test(golden.method + ' / ' + golden.name, () => {
    const diagnostics = [];
    const report = (stage, layer, reason) => diagnostics.push({ stage, layer, reason });
    if (golden.expected.errorCode === 'request_invalid') {
      // adapters/openai/index.mjs:346-351 emits request_invalid before throwing a plain Error.
      // Core preserves the diagnostic and exposes CoreError('invalid_input').
      assertInvalidInput(() => build(golden, report));
      assert.deepEqual(diagnostics, golden.diagnostics);
      return;
    }
    const built = build(golden, report);
    assertRequest(golden, built);
    const decode = () => decodeModelOutput(golden.method, built, golden.output, report);
    if (Object.hasOwn(golden.expected, 'errorCode')) {
      assert.equal(golden.expected.errorCode, 'invalid_model_output');
      assertInvalidOutput(decode);
    } else {
      const decoded = decode();
      assert.deepEqual(decoded, golden.expected.result);
      if (golden.method !== 'qualifyCandidates') assert.equal(decoded, golden.output);
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

test('extract and automatic qualification decode require a plain object', () => {
  for (const method of ['extract', 'qualify']) {
    const golden = cases.find(entry => entry.method === method && entry.expected.result);
    const built = build(golden);
    for (const output of [null, 'synthetic', Object.create({})]) {
      const events = [];
      assertInvalidOutput(() => decodeModelOutput(method, built, output, (...event) => events.push(event)));
      assert.deepEqual(events, [[method, 'adapter', 'output_shape']]);
    }
  }
});

test('throwing and rejecting observers preserve request and candidate decode failures', () => {
  const requestFailure = cases.find(entry => entry.expected.errorCode === 'request_invalid');
  const decodeFailure = cases.find(entry => entry.diagnostics.some(event => event.reason === 'qualification_value_shape'));
  for (const report of [
    () => { throw new Error('synthetic observer failure'); },
    async () => { throw new Error('synthetic asynchronous observer failure'); },
  ]) {
    assertInvalidInput(() => build(requestFailure, report));
    assertInvalidOutput(() => decodeModelOutput(decodeFailure.method, build(decodeFailure), decodeFailure.output, report));
  }
});

test('candidate mode defaults to inline and rejects unsupported configurations', () => {
  const inline = cases.find(entry => entry.method === 'qualifyCandidates' && entry.mode === 'inline' &&
    entry.qualificationInputMode === 'inline' && entry.body && entry.expected.errorCode === undefined);
  const catalog = cases.find(entry => entry.method === 'qualifyCandidates' && entry.mode === 'catalog');
  assert.ok(inline && catalog);
  // Omitted options must behave as the engine adapter's default ('inline'), checked against the engine golden.
  assertRequest(inline, buildModelRequest(inline.method, inline.request));
  assertRequest(inline, buildModelRequest(inline.method, inline.request, {}));
  // The engine's default mode refuses named catalog input before dispatch (adapters/openai/index.mjs:247-248).
  assertInvalidInput(() => buildModelRequest(catalog.method, catalog.request));
  assertInvalidInput(() => buildModelRequest(catalog.method, catalog.request, {}));
  const events = [];
  const report = (...event) => events.push(event);
  assertInvalidInput(() => buildModelRequest(inline.method, inline.request, { qualificationInputMode: 'unknown', report }));
  assertInvalidInput(() => buildModelRequest(inline.method, inline.request, { report: null }));
  assert.deepEqual(events, []);
  assertInvalidInput(() => buildModelRequest(catalog.method, catalog.request, { report }));
  const badCatalog = structuredClone(catalog.request);
  badCatalog.input.inputMode = 'unknown';
  assertInvalidInput(() => buildModelRequest(catalog.method, badCatalog, { qualificationInputMode: catalog.qualificationInputMode, report }));
  assert.deepEqual(events, Array.from({ length: 2 }, () => ['qualifyCandidates', 'adapter', 'request_invalid']));
  assertInvalidInput(() => schemasForQualificationInput(badCatalog.input));
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
    assertInvalidInput(run);
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

import assert from 'node:assert/strict';
import test from 'node:test';
import { qualifyCandidateItems } from '../qualification-candidates.mjs';

const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const source = [{ content: 'Synthetic claim', kind: 'fact', confidence: 0.8, receipts: [
  { client: 'synthetic', sessionId: 'session', eventId: 'event', role: 'user', excerpt: 'x'.repeat(800) },
  { client: 'synthetic', sessionId: 'session', eventId: 'other', role: 'assistant', excerpt: 'y' },
] }];
const entry = () => ({ itemIndex: 0, ...Object.fromEntries(fields.map(field => [field, {
  value: field === 'attribution' || field === 'commitment' ? 'unknown' : null,
  evidenceIndices: field === 'value' ? [0] : [],
}])) });
const output = value => ({ qualifications: [value] });

async function run(value, onDiagnostic) {
  const events = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    qualifyCandidates: async () => value,
    onDiagnostic: event => { events.push(event); return onDiagnostic?.(event); } };
  let result;
  try { result = await qualifyCandidateItems(model, source); }
  catch (error) { result = error.code; }
  return { result, events };
}

test('E5 qualification diagnostics distinguish finite structural categories without source data', async () => {
  const cases = [
    ['qualification_citation_budget', value => {
      value.subject.evidenceIndices = [0, 1, 2, 3]; value.value.evidenceIndices = [4];
    }],
    ['qualification_citation_integrity', value => { value.value.evidenceIndices = [0, 0]; }],
    ['qualification_label_canonicality', value => {
      value.subject = { value: ' leading', evidenceIndices: [0] };
    }],
    ['qualification_binding', value => {
      value.attribution = { value: 'authorized', evidenceIndices: [0] };
    }],
  ];
  for (const [reason, mutate] of cases) {
    const value = entry(); mutate(value);
    const { result, events } = await run(output(value));
    assert.equal(result, 'invalid_model_output', reason);
    assert.deepEqual(events, [{ version: 1, stage: 'qualifyCandidates', layer: 'core_validation', reason }]);
    assert.equal(JSON.stringify(events).includes('Synthetic claim'), false);
  }
  const fallback = await run({ qualifications: [] });
  assert.equal(fallback.result, 'invalid_model_output');
  assert.deepEqual(fallback.events.map(event => event.reason), ['invalid_qualification']);
});

test('E3 an unselected pool is not evidence: all-unknown needs a field citation', async () => {
  const empty = entry(); empty.value.evidenceIndices = [];
  const failure = await run(output(empty));
  assert.equal(failure.result, 'invalid_model_output');
  assert.deepEqual(failure.events.map(event => event.reason), ['qualification_citation_integrity']);
  const citedUnknown = entry();
  const success = await run(output(citedUnknown));
  assert.equal(Array.isArray(success.result), true);
  assert.equal(success.result[0].qualification.anchors.length, 1);
  assert.deepEqual(success.result[0].qualification.anchors[0].fields, ['value']);
  assert.deepEqual(success.events, []);
});

test('E5 observer failure cannot alter qualification result or leak source data', async () => {
  const invalid = entry(); invalid.value.evidenceIndices = [];
  for (const callback of [() => { throw new Error('observer-secret'); },
    () => Promise.reject(new Error('observer-secret'))]) {
    const { result, events } = await run(output(invalid), callback);
    assert.equal(result, 'invalid_model_output');
    assert.deepEqual(events.map(event => event.reason), ['qualification_citation_integrity']);
  }
  const noObserver = { contextWindow: 8192, countTokens: () => 1,
    qualifyCandidates: async () => output(invalid) };
  await assert.rejects(qualifyCandidateItems(noObserver, source), { code: 'invalid_model_output' });
});

test('E5 observability preserves canonical label and downstream enum boundaries', async () => {
  const normalized = entry(); normalized.subject = { value: 'Ａ', evidenceIndices: [0] };
  const accepted = await run(output(normalized));
  assert.equal(accepted.result[0].qualification.slot.subject, 'A');
  assert.deepEqual(accepted.events, []);
  for (const value of ['\uFB03'.repeat(60), ' trailing', '[REDACTED]', 'bad\ud800']) {
    const invalid = entry(); invalid.subject = { value, evidenceIndices: [0] };
    const rejected = await run(output(invalid));
    assert.equal(rejected.result, 'invalid_model_output');
    assert.deepEqual(rejected.events.map(event => event.reason), ['qualification_label_canonicality']);
  }
  const invalidEnum = entry(); invalidEnum.commitment = { value: 'unspecified', evidenceIndices: [0] };
  const rejected = await run(output(invalidEnum));
  assert.equal(rejected.result, 'invalid_model_output');
  assert.deepEqual(rejected.events.map(event => event.reason), ['qualification_binding']);
});

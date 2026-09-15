import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSourceAnswerAccounting } from '../source-answer-accounting.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../../live/installed-source-answer-delivery.mjs';

const source = (id, content, role = 'user') => ({ id, role, content });
const input = () => ({ question: 'Which choice, why, and who approved it?', sources: [
  source('original', 'I chose paper because it was cheap.'),
  source('update', 'Paper is now expensive. I am tentatively keeping paper for June only.'),
  source('negation', 'I did not approve the purchase. No approver is recorded.'),
  source('suggestion', 'You could switch to cloth.', 'assistant'),
] });
const claim = (text = 'Tentatively retaining paper', sourceIds = ['update']) => ({ text, sourceIds });
const record = () => ({ choice: claim(), commitment: claim('Tentative'), scope: claim('June only'),
  reasons: [{ original: claim('Previously cheap', ['original']), later: [claim('Now expensive')], current: null }],
  unknown: ['Who approved the purchase'], answer: 'Tentatively keeping paper for June; the old price reason no longer holds. Approval is not established.' });
const prepare = (value = input(), countTokens = () => 1) => prepareSourceAnswerAccounting({ inputJson: JSON.stringify(value), countTokens });
const code = expected => error => error.code === expected && !String(error).includes('PRIVATE_SENTINEL');
const frozen = value => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } };

test('request and compiled result preserve every enclosing source and exact unassessed trust labels', () => {
  const counts = [], value = input(), request = prepare(value, text => { counts.push(text); return 1; });
  assert.deepEqual(Object.keys(request).sort(), ['compile', 'input', 'maxOutputTokens', 'system']);
  assert.ok(request.system.includes(SOURCE_ANSWER_INSTRUCTION)); assert.equal(request.maxOutputTokens, 1024);
  assert.deepEqual(request.input, value); frozen(request);
  assert.equal(counts[0], request.system + '\n' + JSON.stringify(value));
  const raw = JSON.stringify(record()), result = request.compile(raw);
  assert.equal(counts.at(-1), raw);
  assert.deepEqual(result, { record: record(), sources: value.sources, interpretationStatus: 'model-proposed',
    semanticStatus: 'unassessed', sourceSelectionCoverage: 'unassessed', executionAuthority: 'none' });
  frozen(result);
  assert.equal(result.sources[3].role, 'assistant');
  assert.equal(result.sources[2].content, 'I did not approve the purchase. No approver is recorded.');
});

test('empty sources and unresolved fields do not establish absence or authority', () => {
  const value = { choice: null, commitment: null, scope: null, reasons: [], unknown: ['No supplied basis'], answer: 'Not established.' };
  const result = prepare({ question: 'What is established?', sources: [] }).compile(JSON.stringify(value));
  assert.deepEqual(result.record, value); assert.deepEqual(result.sources, []);
  assert.equal(result.semanticStatus, 'unassessed'); assert.equal(result.executionAuthority, 'none');
  assert.throws(() => prepare({ question: 'What?', sources: [] }).compile(JSON.stringify(record())), code('invalid_model_output'));
});

test('valid citations intentionally do not certify stale reasons, stronger commitment, negation or approval', () => {
  for (const [text, ids] of [['Paper remains cheap', ['original']], ['The decision is firm', ['update']],
    ['I approved the purchase', ['negation']], ['The assistant authorized switching to cloth', ['suggestion']]]) {
    const value = record(); value.choice = claim(text, ids); value.answer = text;
    const result = prepare().compile(JSON.stringify(value));
    assert.equal(result.record.answer, text);
    assert.equal(result.interpretationStatus, 'model-proposed'); assert.equal(result.semanticStatus, 'unassessed');
    assert.equal(result.sourceSelectionCoverage, 'unassessed'); assert.equal(result.executionAuthority, 'none');
    assert.deepEqual(result.sources, input().sources);
  }
  const contradictory = record(); contradictory.answer = 'I chose wood permanently.';
  assert.equal(prepare().compile(JSON.stringify(contradictory)).semanticStatus, 'unassessed');
});

test('Unicode and meaningful whitespace are preserved, never normalized or clipped', () => {
  const value = { question: '  為什麼？😀  ', sources: [source('unicode', '  我沒有同意，仍屬暫定。😀\n完整否定句。  ')] };
  const result = prepare(value).compile(JSON.stringify({ choice: claim('仍屬暫定。😀', ['unicode']), commitment: null, scope: null,
    reasons: [], unknown: [], answer: '  尚未同意。😀  ' }));
  assert.deepEqual(result.sources, value.sources); assert.equal(result.record.answer, '  尚未同意。😀  ');
  for (const content of ['\ud800', ' ', 'x'.repeat(801)]) assert.throws(() => prepare({ ...value, sources: [source('bad', content)] }), code('invalid_input'));
});

test('JSON-only input rejects malformed structures and secrets without executing caller hooks', () => {
  let hooks = 0;
  for (const inputJson of [undefined, null, {}, { toJSON() { hooks++; return input(); } }, '{', '[]', 'null']) {
    assert.throws(() => prepareSourceAnswerAccounting({ inputJson, countTokens: () => 1 }), code('invalid_input'));
  }
  assert.equal(hooks, 0);
  const mutations = [v => { delete v.question; }, v => { v.extra = true; }, v => { v.question = ''; },
    v => { v.question = '\ud800'; }, v => { v.question = 'x'.repeat(4001); }, v => { v.sources = null; },
    v => { v.sources[0].role = 'system'; }, v => { v.sources[0].id = ' bad'; },
    v => { v.sources[1].id = v.sources[0].id; }, v => { v.sources[0].extra = true; },
    v => { v.sources[0].content = 'Bearer sk-proj-' + 'a'.repeat(64); }];
  for (const mutate of mutations) { const value = input(); mutate(value); assert.throws(() => prepare(value), code('invalid_input')); }
});

test('output shape, aliases, arrays and text bounds fail closed without repair', () => {
  const mutations = [v => { delete v.choice; }, v => { v.extra = true; }, v => { v.choice.extra = true; },
    v => { v.choice.sourceIds = []; }, v => { v.choice.sourceIds = ['foreign']; },
    v => { v.choice.sourceIds = ['update', 'update']; }, v => { v.choice.text = ''; },
    v => { v.choice.text = 'x'.repeat(401); }, v => { v.choice.text = '\ud800'; },
    v => { v.reasons[0].original = null; }, v => { v.reasons[0].later = Array(5).fill(claim()); },
    v => { v.reasons = Array(9).fill(v.reasons[0]); }, v => { v.unknown = ['same', 'same']; },
    v => { v.unknown = Array.from({ length: 7 }, (_, i) => `Unknown ${i}`); },
    v => { v.unknown = [' ']; }, v => { v.answer = ''; }, v => { v.answer = 'x'.repeat(4001); },
    v => { v.answer = 'Bearer sk-proj-' + 'a'.repeat(64); }];
  const { compile } = prepare();
  for (const mutate of mutations) { const value = record(); mutate(value); assert.throws(() => compile(JSON.stringify(value)), code('invalid_model_output')); }
  let hooks = 0;
  for (const raw of [undefined, null, record(), { toJSON() { hooks++; return record(); } }, '{', '[]', 'null']) assert.throws(() => compile(raw), code('invalid_model_output'));
  assert.equal(hooks, 0);
  const other = prepare({ question: 'Other?', sources: [source('other', 'Different namespace-bound alias')] });
  assert.throws(() => other.compile(JSON.stringify(record())), code('invalid_model_output'));
});

test('exact UTF8 and local-token ceilings apply independently to full input and raw output', () => {
  const value = { question: 'x'.repeat(3000), sources: Array.from({ length: 24 }, (_, i) => source(`s${i}`, 'x'.repeat(800))) };
  assert.doesNotThrow(() => prepare(value));
  assert.doesNotThrow(() => prepare({ question: 'x'.repeat(4000), sources: [] }));
  assert.throws(() => prepare({ ...value, sources: [...value.sources, source('extra', 'x')] }), code('invalid_input'));
  const small = JSON.stringify(input()), padding = 24000 - Buffer.byteLength(small);
  assert.doesNotThrow(() => prepareSourceAnswerAccounting({ inputJson: small + ' '.repeat(padding), countTokens: () => 6000 }));
  assert.throws(() => prepareSourceAnswerAccounting({ inputJson: small + ' '.repeat(padding + 1), countTokens: () => 1 }), code('invalid_input'));
  const { compile } = prepare(input(), text => text.startsWith(SOURCE_ANSWER_INSTRUCTION) ? 6000 : 1024);
  const raw = JSON.stringify(record()), outputPadding = 16000 - Buffer.byteLength(raw);
  assert.doesNotThrow(() => compile(raw + ' '.repeat(outputPadding)));
  assert.throws(() => compile(raw + ' '.repeat(outputPadding + 1)), code('invalid_model_output'));
  assert.throws(() => prepare(input(), () => 6001), code('invalid_input'));
  assert.throws(() => prepare(input(), text => text.startsWith(SOURCE_ANSWER_INSTRUCTION) ? 1 : 1025).compile(raw), code('invalid_model_output'));
  const chinese = input(); chinese.sources = Array.from({ length: 12 }, (_, i) => source(`s${i}`, '界'.repeat(800)));
  assert.throws(() => prepare(chinese), code('invalid_input'));
});

test('counter failures are content-free at each boundary and cannot mutate frozen authority', () => {
  for (const countTokens of [() => NaN, () => -1, () => 0.5, () => Infinity, () => Number.MAX_SAFE_INTEGER + 1,
    () => '1', async () => 1, () => { throw new Error('PRIVATE_SENTINEL'); }]) {
    assert.throws(() => prepare(input(), countTokens), code('invalid_input'));
    let calls = 0;
    const request = prepare(input(), text => ++calls === 1 ? 1 : countTokens(text));
    assert.throws(() => request.compile(JSON.stringify(record())), code('invalid_model_output'));
  }
  const value = input(), original = structuredClone(value); let prepared;
  prepared = prepare(value, () => {
    value.sources[0].content = 'Changed external object';
    if (prepared) assert.throws(() => { prepared.input.sources[0].content = 'Changed frozen input'; });
    return 1;
  });
  assert.deepEqual(prepared.input, original);
  const first = prepared.compile(JSON.stringify(record()));
  assert.throws(() => { first.record.answer = 'Changed'; });
  assert.deepEqual(prepared.compile(JSON.stringify(record())), first);
});

test('claim and collection maxima are inclusive while a fifth alias and extra fields reject', () => {
  const value = input(); value.sources.push(source('fifth', 'Additional enclosing source'));
  const { compile } = prepare(value);
  const full = record();
  full.choice = claim('x'.repeat(400), ['original', 'update', 'negation', 'suggestion']);
  full.reasons = Array.from({ length: 8 }, () => ({ original: claim(), later: Array.from({ length: 4 }, () => claim()), current: null }));
  full.unknown = Array.from({ length: 6 }, (_, i) => `${i}${'x'.repeat(399)}`);
  full.answer = 'x'.repeat(4000);
  assert.deepEqual(compile(JSON.stringify(full)).record, full);
  full.choice.sourceIds.push('fifth');
  assert.throws(() => compile(JSON.stringify(full)), code('invalid_model_output'));
  let getters = 0;
  const options = { countTokens: () => 1 };
  Object.defineProperty(options, 'inputJson', { enumerable: true, get() { getters++; return JSON.stringify(value); } });
  assert.throws(() => prepareSourceAnswerAccounting(options), code('invalid_input'));
  assert.equal(getters, 0);
  assert.throws(() => prepareSourceAnswerAccounting({ inputJson: JSON.stringify(value), countTokens: () => 1, extra: true }), code('invalid_input'));
});

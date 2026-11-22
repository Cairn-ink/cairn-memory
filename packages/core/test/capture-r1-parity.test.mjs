import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createCaptureDeadline } from '../src/capture/deadline.mjs';
import * as catalog from '../src/capture/qualification-text-catalog.mjs';
import * as sizing from '../src/capture/request-size.mjs';
import { CoreError } from '../src/errors.mjs';

const url = new URL('./fixtures/capture/engine-goldens.json', import.meta.url);
const { families } = JSON.parse(readFileSync(url, 'utf8'));

function modelFor({ contextWindow, counter, name, value }) {
  if (name === 'missing') return {};
  return {
    contextWindow,
    countTokens(text) {
      assert.equal(this.contextWindow, contextWindow);
      if (counter === 'quarterLength') return Math.ceil(text.length / 4);
      if (name === 'throws') throw new Error('synthetic counter failure');
      if (name === 'nan') return NaN;
      if (name === 'infinity') return Infinity;
      if (name === 'negativeZero') return -0;
      return value;
    },
  };
}

const modelOperations = {
  MODEL_INPUT_TOKENS: () => sizing.MODEL_INPUT_TOKENS,
  MODEL_OUTPUT_TOKENS: () => sizing.MODEL_OUTPUT_TOKENS,
  TEXT_FLOOR: () => sizing.TEXT_FLOOR,
  modelRequestText: sizing.modelRequestText,
  requestFits: (model, stage, system, { repeat, units }) =>
    sizing.requestFits(modelFor(model), stage)(system, { text: repeat.repeat(units) }),
  prefixUnits: sizing.prefixUnits,
  fittingCap: (longest, maximum) => sizing.fittingCap(longest, (cap) => cap <= maximum),
  countTokens: (counter, text) => sizing.countTokens(modelFor(counter), text),
};

function assertValue(actual, expected, path = 'result') {
  if (expected === null || typeof expected !== 'object') {
    assert.ok(Object.is(actual, expected), path + ': ' + JSON.stringify({ actual, expected }));
    return;
  }
  assert.ok(actual && typeof actual === 'object', path);
  assert.equal(Array.isArray(actual), Array.isArray(expected), path);
  assert.deepEqual(Reflect.ownKeys(actual), Reflect.ownKeys(expected), path);
  for (const key of Object.keys(expected)) assertValue(actual[key], expected[key], path + '.' + key);
}

for (const [family, operations] of [
  ['modelSizing', modelOperations], ['qualificationTextCatalog', catalog],
]) {
  assert.ok(families[family].length > 0, family);
  for (const { operation, name, args, expected } of families[family]) {
    test(operation + ' / ' + name, () => {
      const run = () => operations[operation](...args);
      assert.equal(typeof operations[operation], 'function', operation);
      if (Object.hasOwn(expected, 'errorCode')) {
        assert.throws(run, (error) => Object.is(error?.code ?? null, expected.errorCode));
      } else {
        const value = expected.returned === 'negative-zero' ? -0 : expected.value;
        assertValue(run(), value);
      }
    });
  }
}

test('qualification catalogs detach and freeze the catalog and its expansion', () => {
  const { args } = families.qualificationTextCatalog.find(({ name }) => name === 'shared text across items');
  const input = structuredClone(args[0]);
  const result = catalog.snapshotQualificationTextCatalog(input);
  input.texts[0] = 'changed';
  assert.equal(result.catalog.texts[0], args[0].texts[0]);
  assert.equal(result.expanded.items[0].candidates[0].text, args[0].texts[0]);
  const checkFrozen = (value) => {
    if (value && typeof value === 'object') {
      assert.ok(Object.isFrozen(value));
      Object.values(value).forEach(checkFrozen);
    }
  };
  checkFrozen(result);
});

test('countTokens calls the optional authority check only after a valid count', () => {
  const sentinel = new CoreError('ineligible');
  const afterReturn = () => { throw sentinel; };
  assert.throws(() => sizing.countTokens({ countTokens: () => 0 }, 'note', afterReturn), (error) => error === sentinel);
  assert.throws(() => sizing.countTokens({ countTokens: () => -1 }, 'note', afterReturn), { code: 'token_count_unavailable' });
});

test('sizing diagnostics contain only stage, layer and reason and cannot replace errors', () => {
  for (const [reason, contextWindow, start, count, expectedCalls] of [
    ['context_budget_exceeded', 8191, 0, () => 1, 0],
    ['model_timeout', 8192, 10, () => 1, 0],
    ['model_timeout', 8192, 0, (clock) => { clock.time = 10; return 1; }, 1],
    ['token_count_unavailable', 8192, 0, () => { throw new Error('synthetic failure text'); }, 1],
  ]) {
    const diagnostics = [];
    const report = (...event) => { diagnostics.push(event); throw new Error('synthetic report failure'); };
    const clock = { time: 0, monotonicMs() { return this.time; } };
    const deadline = createCaptureDeadline(10, clock);
    clock.time = start;
    let calls = 0;
    const model = { contextWindow, countTokens() { calls++; return count(clock); } };
    assert.throws(() => sizing.requestFits(model, 'extract', deadline, report)('Private rules', { text: 'Private note' }),
      { name: 'CoreError', code: reason });
    assert.equal(calls, expectedCalls);
    assert.deepEqual(diagnostics, [['extract', 'core_call', reason]]);
  }
});

test('requestFits passes the exact serialized envelope to the model counter', () => {
  const { args, expected } = families.modelSizing.find(({ name }) => name === 'keys, unicode and escaped text');
  const seen = [];
  const model = { contextWindow: 8192, countTokens(text) { seen.push(text); return 1; } };
  assert.equal(sizing.requestFits(model, 'extract')(...args), true);
  assert.deepEqual(seen, [expected.value]);
});

test('sizing diagnostics suppress a stage outside the model port', () => {
  const diagnostics = [];
  const model = { contextWindow: 8192, countTokens: () => -1 };
  const fits = sizing.requestFits(model, 'private text', undefined, (...event) => diagnostics.push(event));
  assert.throws(() => fits('Rules', {}), { code: 'token_count_unavailable' });
  assert.deepEqual(diagnostics, []);
});

test('a rejected diagnostic promise leaves the sizing failure intact', () => {
  const model = { contextWindow: 8192, countTokens: () => -1 };
  const report = async () => { throw new Error('synthetic asynchronous report failure'); };
  assert.throws(() => sizing.requestFits(model, 'extract', undefined, report)('Rules', {}), { code: 'token_count_unavailable' });
});

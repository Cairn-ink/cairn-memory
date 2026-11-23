import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as capture from '../src/capture/capture-input.mjs';
import * as claims from '../src/capture/claim-qualification-input.mjs';
import * as candidates from '../src/capture/qualification-candidates.mjs';
import * as windows from '../src/capture/source-windows.mjs';
import { CoreError } from '../src/errors.mjs';

const fixture = new URL('./fixtures/capture/engine-goldens.json', import.meta.url);
const { families } = JSON.parse(readFileSync(fixture, 'utf8'));

async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

const modules = { captureInput: capture, sourceWindows: windows,
  claimQualificationInput: claims, qualificationCandidates: candidates };
const replayed = Object.keys(modules).flatMap(family => families[family]);
assert.equal(replayed.length, 183);
assert.equal(replayed.filter(golden => golden.secret).length, 11);

function replay(operations, operation, args, onInvalid) {
  if (operation === 'captureSnapshot') return capture.captureSnapshot(...args, sha256Hex);
  if (operation === 'extractedItems') {
    const [output, snapshot, { retainedMessages, sourceReceipts, limit }] = args;
    return capture.extractedItems(output, snapshot, retainedMessages, onInvalid, sourceReceipts, limit);
  }
  if (operation === 'extractedWindowItems') return windows.extractedWindowItems(...args, onInvalid);
  return operations[operation](...args);
}

function expectedValue(expected) {
  switch (expected.returned) {
    case 'undefined': return undefined;
    case 'negative-zero': return -0;
    case undefined:
      assert.ok(Object.hasOwn(expected, 'value'));
      return expected.value;
    default: assert.fail('Unknown golden return marker');
  }
}

for (const [family, operations] of Object.entries(modules)) {
  for (const { operation, name, args, expected, reasons } of families[family]) {
    test(operation + ' / ' + name, async () => {
      assert.equal(typeof operations[operation], 'function');
      const observed = [];
      const run = async () => replay(operations, operation, args, reason => observed.push(reason));
      if (Object.hasOwn(expected, 'errorCode')) {
        await assert.rejects(run, error => error instanceof CoreError && error.code === expected.errorCode);
      } else {
        const actual = await run();
        const value = expectedValue(expected);
        if (typeof value === 'number') assert.ok(Object.is(actual, value));
        else assert.deepEqual(actual, value);
      }
      assert.deepEqual(observed, reasons ?? []);
    });
  }
}

test('throwing extraction observers preserve the failure code and reason', () => {
  const selections = [
    [capture, families.captureInput.find(golden => golden.name === 'invalid item shape')],
    [windows, families.sourceWindows.find(golden => golden.name === 'different windows with duplicate receipt identity')],
  ];
  for (const [operations, { operation, args, reasons }] of selections) {
    const observed = [];
    const onInvalid = reason => {
      observed.push(reason);
      throw new Error('synthetic observer failure');
    };
    assert.throws(() => replay(operations, operation, args, onInvalid),
      error => error instanceof CoreError && error.code === 'invalid_model_output');
    assert.deepEqual(observed, reasons);
  }
});

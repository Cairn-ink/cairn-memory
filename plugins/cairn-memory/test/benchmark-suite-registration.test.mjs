import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('v3 integration runs once in the adapter-equipped guard suite and stays out of pure ledger CI', () => {
  const { scripts } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  const v3 = 'evaluation/experiment-budget/test/budget-v3.test.mjs';
  const args = name => {
    assert.equal(typeof scripts[name], 'string');
    const tokens = scripts[name].trim().split(/\s+/u);
    assert.deepEqual(tokens.slice(0, 2), ['node', 'tools/testing/run.mjs']);
    return tokens.slice(2);
  };

  assert.equal(args('test:experiment-budget').includes(v3), false,
    'pure ledger CI must not import the adapter-dependent v3 integration test');
  assert.equal(args('test:experiment-request-guard').filter(value => value === v3).length, 1,
    'adapter-equipped guard CI must run every v3 integration assertion exactly once');
  assert.deepEqual(args('test:benchmark-budget-v3'), [v3],
    'the dedicated focused v3 command remains available');
});

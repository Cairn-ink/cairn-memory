import assert from 'node:assert/strict';
import test from 'node:test';
import { runWorker } from '../worker.mjs';
import { fixture, header, item } from './helpers.mjs';
import { conforms } from '../../client/hosted-contract.mjs';

test('Codex capture still sends exactly four window keys', async t => {
  const text = header() + Array.from({ length: 25 }, (_, n) => item(`Synthetic ${n}`, n)).join('');
  const f = await fixture(t, { text });
  assert.equal((await runWorker(f.binding, { guard: f.guard, transport: f.transport })).status, 'idle');
  assert.equal(f.calls.length, 2);
  for (const body of f.calls) {
    assert.deepEqual(Object.keys(body.window).sort(), ['id', 'initial', 'slice', 'slices']);
    assert.equal(conforms('capture-request', body), true);
  }
});

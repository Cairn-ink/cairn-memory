import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, header, item, session } from './helpers.mjs';
import { verifyHeader } from '../parser.mjs';
import { runWorker } from '../worker.mjs';

for (const field of ['forked_from_id', 'parent_thread_id', 'history_base']) {
  test(`fork/history pin: ${field} refuses parsing and dispatch, including falsey markers`, async t => {
    for (const value of ['synthetic-parent', '', false, 0, { ordinal: 1 }]) {
      const text = header({ [field]: value });
      assert.throws(() => verifyHeader(Buffer.from(text.trimEnd()), session), /unsupported_format/);
      const f = await fixture(t, { text: text + item('Copied history') });
      assert.equal((await runWorker(f.binding, { guard: f.guard, transport: f.transport })).status, 'unsupported_format');
      assert.equal(f.calls.length, 0);
    }
  });
}

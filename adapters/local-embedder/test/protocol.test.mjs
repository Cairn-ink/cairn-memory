import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { decoder, frame, INPUT_BYTES, OUTPUT_BYTES, stderrDrain } from '../protocol.mjs';
import { VERSION } from '../common.mjs';
test('L07 arbitrary splits and coalesced bounded frames preserve order', () => {
  const input = [{ v: VERSION, op: 'one' }, { v: VERSION, op: 'two' }], bytes = Buffer.concat(input.map(v => frame(v, INPUT_BYTES)));
  for (const width of [1, 2, 3, 4, 7, bytes.length]) {
    const received = [], failures = [], d = decoder(INPUT_BYTES, v => received.push(v), e => failures.push(e));
    for (let i = 0; i < bytes.length; i += width) d.push(bytes.subarray(i, i + width));
    d.end(); assert.deepEqual(received, input); assert.deepEqual(failures, []);
  }
});
test('L07 zero/oversized/truncated/duplicate-key/non-UTF8/JSON poison without publication', () => {
  for (const maximum of [INPUT_BYTES, OUTPUT_BYTES]) {
    const zero = Buffer.alloc(4), large = Buffer.alloc(4); large.writeUInt32BE(maximum + 1);
    for (const bytes of [zero, large, Buffer.from([0, 0, 0, 1, 0xff]), Buffer.from([0, 0, 0, 1, 123]), frame({ v: 1 }, maximum).subarray(0, 5), (() => { const p = Buffer.from('{"a":1,"a":2}'), h = Buffer.alloc(4); h.writeUInt32BE(p.length); return Buffer.concat([h, p]); })()]) {
      const values = [], errors = [], d = decoder(maximum, v => values.push(v), e => errors.push(e)); d.push(bytes); d.end();
      assert.deepEqual(values, []); assert.deepEqual(errors, ['protocol_error']);
    }
  }
});
test('L07 stderr flood is drained with only bounded private retention and a byte counter', () => {
  const stream = new PassThrough(), ring = stderrDrain(stream), bytes = Buffer.from('CANARY_SECRET'.repeat(10000));
  stream.write(bytes); assert.equal(ring.bytes, bytes.length); assert.equal(JSON.stringify(ring).includes('CANARY'), false); ring.clear(); stream.end();
});

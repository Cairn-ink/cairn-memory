import test from 'node:test';
import assert from 'node:assert/strict';
import { daemonStderrTail } from './fixtures/local-daemon-diagnostics.mjs';
test('candidate stderr diagnostics drop split secrets and bound tails to 2 KiB', () => {
  const tail = daemonStderrTail();
  for (const marker of ['sk-', 'ghp_', 'Bearer', 'token=', 'crn_pat_']) {
    tail.write(Buffer.from(marker.slice(0,2))); tail.write(Buffer.from(marker.slice(2) + 'synthetic_hidden\n'));
  }
  tail.write(Buffer.from('x'.repeat(5000) + 'sk-synthetic_hidden\n'));
  for (let i=0;i<300;i++) tail.write(Buffer.from('synthetic_candidate_diagnostic\n'));
  const text = tail.read(); assert.ok(Buffer.byteLength(text) <= 2048);
  assert.ok(text.includes('synthetic_candidate_diagnostic')); assert.ok(!text.includes('synthetic_hidden'));
});

test('stderr tail byte bound survives Unicode split across chunks', () => {
  const tail = daemonStderrTail(), bytes = Buffer.from('中文🙂 diagnostic line\n'.repeat(200));
  for (let i=0;i<bytes.length;i+=7) tail.write(bytes.subarray(i,i+7));
  const text = tail.read(); assert.ok(Buffer.byteLength(text) <= 2048); assert.ok(!text.includes('�'));
});

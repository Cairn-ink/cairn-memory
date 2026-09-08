import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { parsePeakRss, measurePeakRss } from '../../../evaluations/resources.mjs';

test('Linux current-executable high-water mark uses KiB, not inherited getrusage peak', () => {
  assert.equal(parsePeakRss('Name:\tnode\nVmHWM:\t 12345 kB\nVmRSS:\t 10000 kB\n'), 12345 * 1024);
  assert.equal(parsePeakRss('VmHWM: 524288 kB'), 512 * 1024 * 1024);
});
test('missing, malformed or unsafe peak measurements cannot pass as zero usage', () => {
  for (const value of ['', 'VmRSS: 10 kB', 'VmHWM: 0 kB', 'VmHWM: -1 kB',
    'VmHWM: Infinity kB', 'VmHWM: 100 MB', 'VmHWM: 999999999999999999999 kB']) {
    assert.throws(() => parsePeakRss(value));
  }
});
test('actual Linux measurement reports current executable high-water bytes', { skip: process.platform !== 'linux' }, () => {
  const before = parsePeakRss(readFileSync('/proc/self/status', 'utf8'));
  const measured = measurePeakRss();
  assert.ok(measured >= before);
  assert.ok(Number.isSafeInteger(measured) && measured > 0);
});

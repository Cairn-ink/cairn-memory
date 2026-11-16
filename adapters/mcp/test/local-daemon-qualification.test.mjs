import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { installDaemonSliceMonitor } from '../../../tools/testing/fixtures/daemon-event-loop-monitor.mjs';
test('qualification monitor measures a real synchronous slice and attributes its phase', async () => {
  const monitor = installDaemonSliceMonitor();
  try {
    await delay(20); monitor.phase('admission');
    const end = performance.now() + 80; while (performance.now() < end) {}
    await delay(30); const result = monitor.report();
    assert.ok(result.slice_max_ms >= 75); assert.ok(result.per_phase_ms.admission >= 75);
    assert.ok(result.longest_blocks.some(row => row.phase === 'admission' && row.block_ms >= 75));
    assert.equal(result.t_ms, Math.max(30000, 3 * result.slice_max_ms));
    assert.equal(result.t_ok, result.slice_max_ms <= 10000);
  } finally { monitor.close(); }
});
test('qualification and fault modules stay outside production imports and packaging', () => {
  const inventory = JSON.parse(readFileSync(new URL('../../../packaging/artifact-files.json', import.meta.url)));
  assert.ok(!inventory.some(name => name.startsWith('tools/testing/') || name.startsWith('adapters/mcp/test/')));
  for (const file of inventory.filter(name => name.endsWith('.mjs'))) {
    const source = readFileSync(new URL('../../../' + file, import.meta.url),'utf8');
    assert.doesNotMatch(source, /(?:daemon-event-loop-monitor|local-daemon-mid-write|daemon-qualification)\.mjs/);
  }
  const child = readFileSync(new URL('./fixtures/local-daemon-client.mjs', import.meta.url),'utf8');
  assert.ok(child.indexOf('monitor = installDaemonSliceMonitor()') < child.indexOf('await runCandidate('));
  assert.ok(child.indexOf('fault = installDaemonMidWrite(') < child.indexOf('await runCandidate('));
  const identity = readFileSync(new URL('../local-daemon-identity.mjs', import.meta.url),'utf8');
  assert.match(identity, /!\['--no-warnings', '--experimental-sqlite'\]\.includes\(arg\)/);
});

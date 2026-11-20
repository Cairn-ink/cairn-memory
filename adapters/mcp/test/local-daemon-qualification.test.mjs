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
  for (const event of ['monitor = installDaemonSliceMonitor()', 'fault = installDaemonMidWrite(']) {
    assert.ok(child.indexOf(event) >= 0, 'instrumentation must be present: ' + event);
    assert.ok(child.indexOf(event) < child.indexOf('await runCandidate('));
  }
  const identity = readFileSync(new URL('../local-daemon-identity.mjs', import.meta.url),'utf8');
  assert.match(identity, /!\['--no-warnings', '--experimental-sqlite'\]\.includes\(arg\)/);
});

import { classifyDaemonIdle } from '../../../tools/testing/fixtures/daemon-idle.mjs';
import { qualificationCommand } from '../../../tools/testing/fixtures/daemon-qualification.mjs';
const readyMemory = { ok: true, value: { coverage: { maintenance: { state: 'ready' }, byType: { memory: { indexed: 8, eligible: 8 } } } } };
test('qualification waits on rebuilding/missing indexes and preserves other failures', () => {
  for (const state of ['rebuilding', 'missing']) {
    const result = { ok: false, error: { code: 'index_unavailable', details: { coverage: { maintenance: { state } } } } };
    assert.equal(classifyDaemonIdle({ result }).idle, false);
  }
  for (const error of [{ code: 'storage_busy' }, { code: 'index_unavailable' }, { code: 'index_unavailable', details: { coverage: { maintenance: { state: 'ready' } } } }]) {
    assert.throws(() => classifyDaemonIdle({ result: { ok: false, error } }), /qualification_upkeep_failed/);
  }
});
test('qualification distinguishes complete Raw index from a partial read and retains deadline measurements', () => {
  assert.equal(classifyDaemonIdle({ result: readyMemory, rawIndex: { coverage: 'complete' }, rawReadCoverage: 'partial' }).idle, true);
  assert.equal(classifyDaemonIdle({ result: readyMemory, rawIndex: { coverage: 'partial' }, rawReadCoverage: 'included' }).idle, false);
  // When no complete-index surface exists, preserve the read criterion.
  assert.equal(classifyDaemonIdle({ result: readyMemory, rawReadCoverage: 'included' }).idle, true);
  const timedOut = classifyDaemonIdle({ result: readyMemory, rawReadCoverage: 'partial', deadlineReached: true });
  assert.deepEqual({ idle: timedOut.idle, report: timedOut.report, exitCode: timedOut.exitCode }, { idle: false, report: true, exitCode: 2 });
});
test('qualification failed child diagnostics redact paths, split markers and bound UTF-8 bytes', async () => {
  let stderr = '';
  const source = `process.stderr.write('/private/synthetic-store.sqlite failed\\n');
    process.stderr.write(('界'.repeat(200)+'\\n').repeat(9));
    process.stderr.write('split s'); setTimeout(() => {
    process.stderr.write('k-secret\\n');
    process.stderr.write('tail /private/again.sqlite\\n'); process.exitCode=7; }, 10);`;
  await assert.rejects(qualificationCommand(process.execPath, ['-e', source], text => { stderr += text; }), error => {
    assert.match(error.message, /^qualification_child_failed:.*"code":7/);
    assert.doesNotMatch(error.message, /stderr|private|secret|界/); return true;
  });
  assert.doesNotMatch(stderr, /\/private|sk-secret|split s|\ufffd/);
  assert.match(stderr, /<path>/); assert.ok(Buffer.byteLength(stderr) <= 2048);
});

import { qualificationStderr } from '../../../tools/testing/fixtures/qualification-stderr.mjs';
for (const suffix of ['Customer Project Titan.sqlite', 'quoted"name\'x.sqlite', 'tab\tname.sqlite', 'control\u0001\r\u001bname.sqlite', '多位元組 路徑.sqlite']) {
  for (const prefix of ['/private/', 'C:\\private\\']) test('qualification redacts absolute path through line end: ' + JSON.stringify(prefix + suffix), () => {
    const filter = qualificationStderr();
    const input = Buffer.from('failed ' + prefix + suffix + ' followed by private text\nnext safe line\n');
    // Byte-at-a-time also exercises UTF-8 and chunk boundaries.
    for (const byte of input) filter.write(Buffer.from([byte]));
    assert.equal(filter.read(), 'failed <path>\nnext safe line\n');
    assert.ok(Buffer.byteLength(filter.read()) <= 2048);
  });
}

test('qualification entrypoints print code-only failures without an uncaught path-bearing stack', async () => {
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  for (const name of ['daemon-event-loop-slice', 'daemon-attach-latency']) {
    const file = new URL('../../../tools/testing/' + name + '.qualification.mjs', import.meta.url);
    const child = spawnSync(process.execPath, [file.pathname, '--store', tmpdir() + '/nonexistent-synthetic.sqlite'], { env: { TMPDIR: tmpdir() }, encoding: 'utf8', timeout: 10000 });
    assert.equal(child.error, undefined); assert.equal(child.signal, null); assert.equal(child.status, 1);
    assert.doesNotMatch(child.stderr, /\/(?:home|tmp|private)\//);
    assert.match(child.stderr, /qualification_child_failed/);
  }
});

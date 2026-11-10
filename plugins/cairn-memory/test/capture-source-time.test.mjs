import assert from 'node:assert/strict';
import test from 'node:test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { harness, row } from './capture-window-harness.mjs';
import { transcriptWindow } from '../lib/transcript.mjs';
import { conforms, sourceTimestamp } from '../lib/hosted-contract.mjs';

const invalid = ['', 'not-a-date', '2026-11-10', '2026-11-10T00:00:00.123456789000000+00:00',
  '2026-11-10T00:00:00.1234567890Z', '2026-13-10T00:00:00Z'];
const valid = ['2026-11-10T00:00:00Z', '2026-11-10T00:00:00.123456789Z',
  '2026-11-10T00:00:00.123456+08:00', '2026-11-10T00:00:00-05:30'];

test('source times and capture-request conformance agree without changing messages or IDs', () => {
  assert.equal(invalid[3].length, 41);
  for (const time of [...invalid, ...valid]) {
    const message = transcriptWindow(row('u1', time), 'synthetic-session')[0];
    const { withheld, ...wire } = message;
    assert.equal(message.id, 'u1'); assert.equal(message.content, 'Synthetic u1');
    assert.equal(sourceTimestamp(time), valid.includes(time));
    assert.equal(Object.hasOwn(wire, 'occurred_at'), valid.includes(time));
    if (valid.includes(time)) assert.equal(wire.occurred_at, time);
    const body = { client: 'claude-code', event_id: 'synthetic-event', session_id: 'synthetic-session', messages: [wire] };
    assert.equal(conforms('capture-request', body), true);
    assert.equal(conforms('capture-request', { ...body, messages: [{ ...wire, occurred_at: time }] }), valid.includes(time));
  }
});

test('a malformed source time cannot freeze capture behind a strict receiver', async t => {
  const f = await harness(t, { observedAt: '2026-11-10T00:00:00.100Z', strictTimes: true });
  // Exact synthetic failure transcript, including its two LF terminators.
  const bytes = '{"type":"user","uuid":"u1","timestamp":"not-a-date","message":{"content":"Remember my new preference."}}\n' +
    '{"type":"assistant","uuid":"a1","timestamp":"2026-11-10T00:00:01.000Z","message":{"content":"I will remember it."}}\n';
  assert.equal(Buffer.byteLength(bytes), 221);
  await f.run('start-boundary'); // no transcript: boundary remains unknown
  await f.write(bytes); await f.run('recall'); await f.run('capture');
  assert.deepEqual(f.captures[0].messages.map(m => m.id), ['u1', 'a1']);
  assert.equal(Object.hasOwn(f.captures[0].messages[0], 'occurred_at'), false);
  assert.equal(f.captures[0].messages[1].occurred_at, '2026-11-10T00:00:01.000Z');
  for (const request of f.captures) assert.equal(conforms('capture-request', request), true);
  assert.equal((await f.state()).offset, Buffer.byteLength(bytes));
  assert.equal((await f.state()).pendingEnd, undefined);
  await f.run('capture'); assert.equal(f.captures.length, 1);
});

test('the shipped engine includes the transcript validator import graph', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'capture-time-engine-' });
  const run = promisify(execFile);
  const manifest = JSON.parse(await (await import('node:fs/promises')).readFile(
    new URL('../../../packages/setup/runtime/engine/manifest.json', import.meta.url), 'utf8'));
  const archive = new URL(`../../../packages/setup/runtime/engine/${manifest.package.name}-${manifest.package.version}.tgz`, import.meta.url);
  await run('tar', ['-xzf', archive.pathname, '-C', workspace.path]);
  const module = await import(pathToFileURL(join(workspace.path, 'package/plugins/cairn-memory/lib/transcript.mjs')));
  const [message] = module.transcriptWindow(row('message', 'not-a-date'), 'synthetic-session');
  assert.equal(message.id, 'message');
  assert.equal(Object.hasOwn(message, 'occurred_at'), false);
});

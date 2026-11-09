import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { fixture, header, item, timestamp } from './helpers.mjs';

// Private baseline/mutation copies can exercise this same contract suite.
const modules = process.env.CAIRN_CAPTURE_CODEX_MODULES ?
  pathToFileURL(process.env.CAIRN_CAPTURE_CODEX_MODULES + '/') : new URL('../', import.meta.url);
const { runWorker } = await import(new URL('worker.mjs', modules));
const { parseLine } = await import(new URL('parser.mjs', modules));

test('parser copies row time, falls back to completed milliseconds, and keeps wire-scoped IDs', () => {
  const row = JSON.parse(item('Synthetic time'));
  const context = { sessionId: row.payload.thread_id, wireSessionId: 'a'.repeat(64), epoch: 0, start: 10, end: 100 };
  const parse = (value, extra = {}) => parseLine(Buffer.from(JSON.stringify(value)), { ...context, ...extra });
  row.timestamp = '2020-01-02T03:04:05.123456+00:00';
  const original = parse(row);
  assert.equal(original.occurred_at, row.timestamp);
  delete row.timestamp; row.payload.completed_at_ms = 1577934245123;
  assert.equal(parse(row).occurred_at, '2020-01-02T03:04:05.123Z');
  delete row.payload.completed_at_ms;
  assert.equal(Object.hasOwn(parse(row), 'occurred_at'), false);
  assert.equal(parse(row).message.id, original.message.id);
  assert.notEqual(parse(row, { wireSessionId: 'b'.repeat(64) }).message.id, original.message.id);
});

test('worker sends numbered windows and per-attempt time without changing a frozen retry', async t => {
  const f = await fixture(t, { text: header() + Array.from({ length: 25 }, (_, n) => item(`Synthetic ${n}`, n)).join('') });
  f.fail('processing');
  const run = now => runWorker(f.binding, { guard: f.guard, transport: f.transport, now: () => now });
  assert.equal((await run(1800000000000)).status, 'processing');
  assert.equal(f.calls.length, 1);
  await appendFile(f.path, item('Later window', 99));
  f.clear(); assert.equal((await run(1800000001000)).status, 'idle');
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.calls.map(body => [body.window.slice, body.window.slices]), [[1, 2], [1, 2], [2, 2]]);
  assert.ok(f.calls.every(body => body.window.initial === false));
  assert.equal(new Set(f.calls.map(body => body.window.id)).size, 1);
  assert.deepEqual(f.calls[0].window, f.calls[1].window);
  assert.equal(f.calls[0].event_id, f.calls[1].event_id);
  assert.deepEqual(f.calls[0].messages, f.calls[1].messages);
  assert.ok(f.calls.flatMap(body => body.messages).every(message => message.occurred_at === timestamp));
  assert.equal(f.calls[0].sent_at, '2027-01-15T08:00:00.000Z');
  assert.equal(f.calls[1].sent_at, '2027-01-15T08:00:01.000Z');
  assert.ok(!JSON.stringify(f.calls).includes('Later window'));
  await run(1800000002000);
  assert.notEqual(f.calls.at(-1).window.id, f.calls[0].window.id);
});

test('worker bounds metadata windows above 64 sent slices without losing batches', async t => {
  // The byte-read ceiling permits this many short records in one frozen range.
  const f = await fixture(t, { text: header() + Array.from({ length: 1537 }, (_, n) => item('x', n)).join('') });
  assert.equal((await runWorker(f.binding, { guard: f.guard, transport: f.transport, now: () => 1800000000000 })).status, 'idle');
  assert.equal(f.calls.length, 65);
  assert.equal(f.calls.flatMap(body => body.messages).length, 1537);
  assert.equal(f.calls[63].window.slice, 64); assert.equal(f.calls[63].window.slices, 64);
  assert.equal(f.calls[64].window.slice, 1); assert.equal(f.calls[64].window.slices, 1);
  assert.notEqual(f.calls[0].window.id, f.calls[64].window.id);
});

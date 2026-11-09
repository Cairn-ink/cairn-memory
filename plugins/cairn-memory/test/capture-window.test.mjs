import assert from 'node:assert/strict';
import { appendFile } from 'node:fs/promises';
import test from 'node:test';
import { captureEventId, legacyTranscriptMessages } from '../lib/transcript.mjs';
import { harness, oldTime, row } from './capture-window-harness.mjs';

test('every sent slice retains initial and window identity across a refused first slice', async t => {
  const f = await harness(t, { fail: (_body, attempt) => attempt === 1 });
  // First and middle batches contain only withheld records. Their positions
  // still participate in the legacy event IDs but never in sent-slice numbering.
  const machine = n => row(`machine-${n}`, oldTime, { isMeta: true });
  const text = Array.from({ length: 24 }, (_, n) => machine(n)).join('') +
    Array.from({ length: 24 }, (_, n) => row(`first-${n}`)).join('') +
    Array.from({ length: 24 }, (_, n) => machine(n + 24)).join('') + row('last');
  await f.write(text); await f.run('capture');
  await appendFile(f.transcript, row('later-window'));
  // A late asynchronous start may add a boundary, but cannot reclassify the
  // already-frozen initial range or absorb its newly appended suffix.
  await f.run('start', { source: 'resume' });
  await f.run('capture');
  assert.equal(f.captures.length, 3);
  assert.ok(f.captures.every(body => body.window?.initial === true));
  const [refused, retried, last] = f.captures;
  assert.deepEqual(refused.window, retried.window);
  assert.equal(last.window.id, retried.window.id);
  assert.match(last.window.id, /^[a-f0-9]{64}$/);
  assert.deepEqual(f.captures.map(body => [body.window.slice, body.window.slices]), [[1, 2], [1, 2], [2, 2]]);
  assert.equal(refused.event_id, retried.event_id);
  const legacy = legacyTranscriptMessages(text, f.sessionId);
  assert.deepEqual(f.captures.map(body => body.event_id), [
    captureEventId(f.sessionId, legacy.slice(24, 48)), captureEventId(f.sessionId, legacy.slice(24, 48)),
    captureEventId(f.sessionId, legacy.slice(72, 96)),
  ]);
  assert.ok(f.captures.every(body => !body.messages.some(m => m.id === 'later-window')));
  await f.run('capture');
  assert.equal(f.captures.at(-1).window.initial, false);
  assert.notEqual(f.captures.at(-1).window.id, last.window.id);
});

test('message time is copied byte for byte and send time belongs to each attempt', async t => {
  const f = await harness(t, { fail: (_body, attempt) => attempt === 1 });
  await f.write(row('dated') + row('undated', null).replace(',"timestamp":null', '') + row('too-long', 'x'.repeat(41)));
  const before = Date.now(); await f.run('capture'); await f.run('capture'); const after = Date.now();
  assert.equal(f.captures.length, 2);
  for (const body of f.captures) {
    assert.equal(body.messages[0].occurred_at, oldTime);
    assert.equal(Object.hasOwn(body.messages[1], 'occurred_at'), false);
    assert.equal(Object.hasOwn(body.messages[2], 'occurred_at'), false);
    assert.ok(Date.parse(body.sent_at) >= before && Date.parse(body.sent_at) <= after);
  }
  assert.notEqual(f.captures[0].sent_at, f.captures[1].sent_at);
  assert.equal(f.captures[0].event_id, f.captures[1].event_id);
});

test('a new empty start has initial false and captures its entire first turn', async t => {
  const f = await harness(t); await f.write(''); await f.run('start');
  await appendFile(f.transcript, row('first-user') + row('first-answer', oldTime, { type: 'assistant' }));
  await f.run('capture');
  assert.deepEqual(f.captures[0].messages.map(m => m.id), ['first-user', 'first-answer']);
  assert.equal(f.captures[0].window.initial, false);
});

test('fallback is still initial on every sent slice and after a refused attempt', async t => {
  const f = await harness(t, { fail: (_body, attempt) => attempt === 1 });
  await f.write(row('copied')); await f.run('recall');
  await appendFile(f.transcript, Array.from({ length: 25 }, (_, n) => row(`new-${n}`, new Date().toISOString())).join(''));
  await f.run('capture'); await f.run('capture');
  assert.equal(f.captures.length, 3);
  assert.ok(f.captures.every(body => body.window.initial));
  assert.deepEqual(f.captures.map(body => body.window.slice), [1, 1, 2]);
  assert.equal(new Set(f.captures.map(body => body.window.id)).size, 1);
});

test('more than 64 sent batches are all sent in bounded metadata windows without changing event IDs', async t => {
  const f = await harness(t);
  const text = Array.from({ length: 24 * 64 + 1 }, (_, n) => row(`message-${n}`)).join('');
  await f.write(text); await f.run('capture');
  assert.equal(f.captures.length, 65);
  assert.equal(f.captures.flatMap(body => body.messages).length, 1537);
  const legacy = legacyTranscriptMessages(text, f.sessionId);
  assert.deepEqual(f.captures.map(body => body.event_id), Array.from({ length: 65 }, (_, n) =>
    captureEventId(f.sessionId, legacy.slice(n * 24, n * 24 + 24))));
  for (const body of f.captures.slice(0, 64)) {
    assert.equal(body.window.slices, 64); assert.equal(body.window.initial, true);
  }
  assert.equal(f.captures[63].window.slice, 64);
  assert.equal(f.captures[64].window.slice, 1); assert.equal(f.captures[64].window.slices, 1);
  assert.notEqual(f.captures[64].window.id, f.captures[0].window.id);
});

test('capture racing a recall fetch freezes initial before the late marker and retries unchanged', async t => {
  let announce, release;
  const entered = new Promise(resolve => announce = resolve);
  const held = new Promise(resolve => release = resolve);
  const f = await harness(t, { fail: (_body, attempt) => attempt === 1,
    holdRecall: () => { announce(); return held; } });
  t.after(() => release());
  await f.write(row('unmarked'));
  const recalling = f.run('recall'); await entered;
  try { await f.run('capture'); } finally { release(); }
  await recalling; await f.run('capture');
  assert.equal(f.captures.length, 2);
  assert.equal(f.captures[0].window.initial, true);
  assert.deepEqual(f.captures[0].window, f.captures[1].window);
});

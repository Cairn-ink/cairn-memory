import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { receiptEventTime, memoryInput } from '../validation.mjs';
import { captureSnapshot } from '../capture-input.mjs';
import { episodeSnapshot } from '../episode-input.mjs';
import { rawInstant } from '../raw-input.mjs';

const time = '2001-02-03T04:05:06.789Z';
const source = { id: 'message', role: 'user', content: 'Synthetic event source' };
const input = { namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null },
  client: 'synthetic', eventId: 'capture', sessionId: 'session', messages: [source] };
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('receipt event-time validation: exact UTC milliseconds, no lower bound and optional absence', () => {
  for (const value of [undefined, null]) assert.equal(receiptEventTime(value), null);
  for (const value of [time, '1970-01-01T00:00:00.000Z', '1901-02-03T04:05:06.789Z']) assert.equal(receiptEventTime(value), value);
  for (const value of ['2001-02-03T04:05:06Z', '2001-02-03T04:05:06.789+00:00',
'2001-02-30T04:05:06.789Z', '', 1, {},
    '2001-02-03T04:05:06.78Z', '2001-02-03T04:05:06.789z']) {
    assert.throws(() => receiptEventTime(value), { code: 'invalid_input' });
    assert.throws(() => captureSnapshot({ ...input, messages: [{ ...source, occurredAt: value }] }), { code: 'invalid_input' });
  }
  // Snapshot parsing has no clock; future validation belongs to admission.
  assert.equal(captureSnapshot({ ...input, messages: [{ ...source, occurredAt: '2099-01-01T00:00:00.000Z' }] })
    .messages[0].occurredAt, '2099-01-01T00:00:00.000Z');
});

test('capture digest without times is byte-identical for every existing digest mode', () => {
  for (const causal of [false, true]) for (const qualification of [undefined, 'source-bound-v2'])
    for (const policy of [undefined, 'indexed-windows-v1', 'indexed-evidence-v1']) {
      const request = { ...input, ...(causal ? { causal: { streamId: 'stream', sequence: 1 } } : {}) };
      const tag = policy === 'indexed-evidence-v1' ? 'cairn.capture.indexed-evidence.v1' :
        policy ? 'cairn.capture.indexed-windows.v1' : qualification ? 'cairn.capture.v3' : causal ? 'cairn.capture.v2' : 'cairn.capture.v1';
      const expected = digest([tag, ['synthetic', 'personal', null], 'synthetic', 'capture', 'session',
        [['message', 'user', source.content]], ...(causal ? [['stream', 1]] : []),
        ...(qualification ? [qualification] : []), ...(policy ? [policy, 'nonoverlap-800-v1'] : [])]);
      for (const occurredAt of [undefined, null]) assert.equal(captureSnapshot({ ...request,
        messages: [{ ...source, occurredAt }] }, qualification, policy).payloadDigest, expected);
    }
});

test('capture digest adds one per-message slot only when some message has a time', () => {
  const messages = [{ ...source, occurredAt: time }, { ...source, id: 'untimed' }];
  const snapshot = captureSnapshot({ ...input, messages });
  assert.equal(snapshot.payloadDigest, digest(['cairn.capture.v1', ['synthetic', 'personal', null],
    'synthetic', 'capture', 'session', [['message', 'user', source.content, time], ['untimed', 'user', source.content, null]]]));
  assert.notEqual(snapshot.payloadDigest, captureSnapshot(input).payloadDigest);
  assert.notEqual(snapshot.payloadDigest, captureSnapshot({ ...input,
    messages: [{ ...messages[0], occurredAt: '2001-02-03T04:05:06.790Z' }, messages[1]] }).payloadDigest);
});

test('legacy memory parser strips time into a side parameter; episode parsing retains its established rules', () => {
  const parsed = memoryInput({ content: source.content, receipt: { client: 'synthetic', sessionId: 'session',
    eventId: 'message', role: 'user', excerpt: source.content, occurredAt: time } });
  assert.deepEqual(Object.keys(parsed.receipt), ['client', 'sessionId', 'eventId', 'role', 'excerpt']);
  assert.deepEqual(parsed.receiptTimes, [time]);
  const episode = { ...input, episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
    messages: [{ ...source, occurredAt: time }, { ...source, id: 'untimed' }] };
  assert.deepEqual(episodeSnapshot(episode).messages.map(m => m.occurredAt), [time, null]);
  // Raw's established range and future rules are independent and unchanged.
  for (const occurredAt of ['1901-02-03T04:05:06.789Z', '2099-01-01T00:00:00.000Z']) {
    assert.equal(rawInstant(occurredAt), occurredAt);
    assert.equal(episodeSnapshot({ ...episode, messages: [{ ...source, occurredAt }] }).messages[0].occurredAt, occurredAt);
  }
});

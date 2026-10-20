import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openDatabase } from '../database.mjs';
import { fixture, ns, request, splitRaw, localPlainPort, completed, ok, count, usage } from '../testing/raw-capture-fixtures.mjs';

for (const kind of ['ordinary','staged','episode']) for (const client of ['claude-code','codex']) {
  test(`P2-01/02/03/07 real ${kind} ${client}: exact Raw, bounded first projection, replay and overlap`, async t => {
    const f = fixture(t, { kind });
    const text = '  Ａ 😀\n'.repeat(4400), parts = splitRaw(text);
    const first = request(parts[0], { client }, kind);
    const result = ok(await f.core.captureRaw(first));
    ok(result.interpretation);
    const calls = f.calls.length, initialUsage = usage(f.core);
    assert.equal(count(f.db, 'admission_claims'), 1);
    assert.equal(count(f.db, 'raw_capture_events'), 1);
    if (kind === 'episode') assert.equal(f.db.prepare('SELECT state,payload FROM staged_capture_evidence').get().state, 'released');
    const fresh = openDatabase(f.path); f.workspace.defer(() => fresh.close());
    assert.equal(count(fresh, 'raw_parts'), 1);
    assert.equal(f.calls.find(call => call.method === 'extract').input.messages[0].content.startsWith('A 😀'), true);
    assert.equal(f.db.prepare('SELECT session_id FROM receipts LIMIT 1').get().session_id.startsWith('s1:'), true);
    assert.deepEqual(ok(await f.core.captureRaw(first)).raw, result.raw);
    assert.equal(f.calls.length, calls);
    assert.deepEqual(usage(f.core), initialUsage);
    const overlap = completed(await f.core.captureRaw({ ...first, eventId: 'overlap' }));
    assert.equal(overlap.overlap, true);
    assert.equal(f.calls.length, calls);
    f.reopen();
    assert.equal(ok(await f.core.captureRaw(first)).raw.conversationId, result.raw.conversationId);
    for (const part of parts.slice(1)) {
      assert.equal(completed(await f.core.captureRaw(request(part, { client }, kind))).reason, 'continuation');
      assert.equal(f.calls.length, calls);
    }
    assert.equal(count(f.db, 'admission_claims'), 1);
    if (kind === 'episode') assert.equal(f.db.prepare('SELECT observed FROM session_episodes').get().observed, 1);
    let cursor, reconstructed = '';
    do {
      const page = ok(await f.core.getConversation({ namespace: ns, conversationId: result.raw.conversationId, limit: 2,
        ...(cursor ? { cursor } : {}) }));
      reconstructed += page.messages.flatMap(message => message.parts.map(part => part.text)).join('');
      cursor = page.nextCursor;
    } while (cursor);
    assert.equal(reconstructed, text);
    assert.equal(usage(f.core).savedBytes, Buffer.byteLength(text));
    assert.equal(usage(f.core).reservedBytes, 0);
  });
}

for (const kind of ['ordinary','staged','episode']) for (const target of ['raw_parts','admission_claims', ...(kind === 'episode' ? ['episode_events'] : [])]) {
  test(`P2-01 ${kind}: failure after ${target} rolls Raw and actual reservation back`, async t => {
    const f = fixture(t, { kind });
    f.db.exec(`CREATE TRIGGER synthetic_registration_failure AFTER INSERT ON ${target} BEGIN SELECT RAISE(ABORT,'synthetic private failure'); END;`);
    assert.equal((await f.core.captureRaw(request(splitRaw('Synthetic atomic evidence')[0], {}, kind))).ok, false);
    const fresh = openDatabase(f.path); f.workspace.defer(() => fresh.close());
    for (const table of ['raw_parts','raw_events','raw_messages','raw_capture_events','raw_owner_usage','admission_claims','episode_events','session_episodes']) {
      assert.equal(count(fresh, table), 0, table);
    }
    assert.equal(f.calls.length, 0);
  });
}

for (const kind of ['ordinary','staged','episode']) test(`P2-02 ${kind}: mixed continuation and new first only interprets fresh first`, async t => {
  const f = fixture(t, { kind });
  const parts = splitRaw('Synthetic long message '.repeat(200));
  completed(await f.core.captureRaw(request(parts[0], {}, kind)));
  const before = f.calls.length;
  const newMessage = splitRaw('Fresh second message', { id: 'second', ordinal: 2 })[0];
  completed(await f.core.captureRaw(request(parts[1], { eventId: 'mixed', messages: [parts[1], newMessage] }, kind)));
  const extract = f.calls.slice(before).find(call => call.method === 'extract');
  assert.deepEqual(extract.input.messages.map(message => message.content), ['Fresh second message']);
  assert.equal(count(f.db, 'admission_claims'), 2);
  if (kind === 'episode') assert.equal(f.db.prepare('SELECT observed FROM session_episodes').get().observed, 2);
});

for (const kind of ['ordinary','staged','episode']) for (const stage of ['extract','qualifyCandidates']) {
  if (kind === 'ordinary' && stage === 'qualifyCandidates') continue;
  test(`P2-03 ${kind}: saved Raw survives ${stage} failure`, async t => {
    const f = fixture(t, { kind, model: { [stage]: () => { throw Error('SYNTHETIC_PROVIDER_SECRET'); } } });
    const result = ok(await f.core.captureRaw(request(splitRaw('Synthetic failed interpretation')[0], {}, kind)));
    assert.equal(result.raw.parts[0].saved, true);
    assert.equal(result.interpretation.ok, false);
    assert.equal(count(f.db, 'memories'), 0);
    assert.ok(usage(f.core).savedBytes > 0);
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PROVIDER_SECRET'), false);
  });
}

for (const reason of ['tool_off','notice_required','raw_disabled','quota_reached']) test(`P2-07 ${reason}: skips sealing and still captures first-part Memory`, async t => {
  let seals = 0;
  const port = localPlainPort(); port.sealRaw = () => { seals++; throw Error('must not seal'); };
  const f = fixture(t, { port, ...(reason === 'quota_reached' ? { capBytes: 1 } : { policy: { generation: 'n', reason } }) });
  const result = ok(await f.core.captureRaw(request(splitRaw('Synthetic policy evidence')[0])));
  assert.equal(result.raw.parts[0].reason, reason);
  assert.equal(ok(result.interpretation).admission.memories.length, 1);
  assert.equal(seals, 0);
});

test('P2-07 crypto failure saves nothing and never starts interpretation', async t => {
  const port = localPlainPort(); port.sealRaw = () => { throw Error('SYNTHETIC_CRYPTO_SECRET'); };
  const f = fixture(t, { port });
  assert.deepEqual(await f.core.captureRaw(request(splitRaw('Synthetic crypto evidence')[0])),
    { ok: false, error: { code: 'raw_crypto_unavailable', retryable: false } });
  assert.equal(count(f.db, 'raw_events'), 0); assert.equal(count(f.db, 'admission_claims'), 0);
  assert.equal(f.calls.length, 0);
});

for (const kind of ['ordinary','episode']) test(`P2-02/07 ${kind}: live overlap records Raw but reports processing without model calls`, async t => {
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const wait = new Promise(resolve => { release = resolve; });
  const stage = kind === 'episode' ? 'interpretEpisode' : 'extract';
  const f = fixture(t, { kind, model: { [stage]: async value => { started(); await wait;
    return stage === 'extract' ? { items: [] } : { type: { value: 'work', anchors: [{ sourceIndex: 0,start: 0,end: 8 }] },
      language: 'en', gist: { value: 'Synthetic', anchors: [{ sourceIndex: 0,start: 0,end: 8 }] }, outcome: null,nextStep: null,disposition: null }; } } });
  const input = request(splitRaw('Synthetic pending evidence')[0], {}, kind);
  const first = f.core.captureRaw(input); await began;
  const before = f.calls.length;
  assert.equal(completed(await f.core.captureRaw({ ...input, eventId: 'overlap-live' })).processing, true);
  assert.equal(f.calls.length, before);
  release(); ok(await first);
  assert.equal(completed(await f.core.captureRaw({ ...input, eventId: 'overlap-live' })).overlap, true);
});

for (const kind of ['ordinary','episode']) test(`P2-02 ${kind}: whitespace-only first part is Raw-only and continuation never becomes model input`, async t => {
  const f = fixture(t, { kind }), parts = splitRaw(' '.repeat(4000) + 'Synthetic later substantive text');
  assert.equal(completed(await f.core.captureRaw(request(parts[0], {}, kind))).reason, 'no-eligible-first-part');
  assert.equal(completed(await f.core.captureRaw(request(parts[1], {}, kind))).reason, 'continuation');
  assert.equal(count(f.db, 'admission_claims'), 0); assert.equal(count(f.db, 'session_episodes'), 0);
  assert.equal(f.calls.length, 0); assert.equal(usage(f.core).reservedBytes, 0);
});

test('P2-08 public constructors and capture stay strict and Raw factory is not installed', async t => {
  const f = fixture(t);
  assert.throws(() => openMemoryCore({ path: f.path, rawCapture: true }), { code: 'invalid_input' });
  assert.equal((await f.core.capture(request(splitRaw('Synthetic public bound')[0]))).ok, false);
  const files = JSON.parse(readFileSync(new URL('../../packaging/artifact-files.json', import.meta.url), 'utf8'));
  assert.equal(files.includes('core/raw-capture.mjs'), false);
  assert.equal(files.includes('core/raw-capture-storage.mjs'), false);
});

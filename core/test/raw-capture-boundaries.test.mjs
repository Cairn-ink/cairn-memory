import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { openDatabase } from '../database.mjs';
import { openDatabase as oldOpen } from '../testing/raw-v24-database.mjs';
import { fixture, ns, request, splitRaw, localPlainPort, completed, ok, count, usage } from '../testing/raw-capture-fixtures.mjs';
import { rawFixture } from '../testing/raw-fixtures.mjs';
import { openMemoryCore } from '../contract.mjs';

test('P2-08 separate v25 opt-in migrates genuine v24, preserves option-off state and actual P1 opener refuses', async t => {
  const f = rawFixture(t);
  const before = await f.journal.register(request(splitRaw('Synthetic pre-P2 saved source')[0]));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 24);
  const db = openDatabase(f.path, { rawCapture: true }); t.after(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 25);
  assert.equal(count(db, 'raw_capture_events'), 0); assert.equal(count(db, 'raw_parts'), 1);
  assert.throws(() => oldOpen(f.path), { code: 'unsupported_database' });
  const ordinary = openMemoryCore({ path: f.path }); t.after(() => ordinary.close());
  const reader = openDatabase(f.path); t.after(() => reader.close());
  assert.equal(reader.prepare('PRAGMA user_version').get().user_version, 25);
  assert.equal(reader.prepare('SELECT id FROM raw_conversations').get().id, before.conversationId);
  assert.equal(count(reader, 'raw_parts'), 1);
});

test('P2-08 injected v25 migration failure rolls complete additive upgrade back', async t => {
  const f = rawFixture(t);
  await f.journal.register(request(splitRaw('Synthetic preserved v24')[0]));
  f.db.exec('CREATE TABLE raw_session_fences(synthetic INTEGER)');
  assert.throws(() => openDatabase(f.path, { rawCapture: true }));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 24);
  assert.equal(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_capture_events'").get(), undefined);
  assert.equal(count(f.db, 'raw_parts'), 1); assert.equal(count(f.db, 'raw_owner_usage'), 1);
});

test('P2-02/07 independent processes: lost acknowledgement, partial restart and suffix preserve ownership and charge once', async t => {
  const f = fixture(t, { model: { extract: () => ({ items: [] }) } });
  const parts = splitRaw('Synthetic process 😀 '.repeat(1500)), first = request(parts[0]);
  const registered = ok(await f.core.captureRaw(first)), before = usage(f.core);
  const child = value => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('../testing/raw-capture-process.mjs', import.meta.url)), f.path, JSON.stringify(value)],
      { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.status, 0, result.stderr); return JSON.parse(result.stdout);
  };
  const replay = child(first);
  assert.deepEqual(replay.calls, []); assert.deepEqual(replay.usage.value, before);
  assert.deepEqual(replay.result.value.raw, registered.raw);
  for (const part of parts.slice(1)) {
    const suffix = child(request(part));
    assert.deepEqual(suffix.calls, []);
    assert.equal(suffix.result.value.raw.conversationId, registered.raw.conversationId);
  }
  assert.equal(usage(f.core).savedBytes, Buffer.byteLength(parts.map(part => part.content).join('')));
  assert.equal(usage(f.core).reservedBytes, 0); assert.equal(count(f.db, 'admission_claims'), 1);
});

for (const kind of ['ordinary','episode']) test(`P2-07 ${kind}: changed event/part/profile refuses without source/error prose or new writes`, async t => {
  const f = fixture(t, { kind });
  const source = request(splitRaw('Synthetic immutable payload')[0], {}, kind);
  completed(await f.core.captureRaw(source));
  const before = usage(f.core), calls = f.calls.length;
  for (const patch of [
    { messages: [{ ...source.messages[0],content: 'Synthetic alternate payload' }] },
    { messages: [{ ...source.messages[0],role: 'assistant' }] },
    kind === 'episode' ? { episodeContext: { ...source.episodeContext,origin: 'precompact' } } : { causal: { streamId: 'changed',sequence: 1 } },
  ]) {
    const result = await f.core.captureRaw({ ...source, ...patch });
    assert.equal(result.ok, false); assert.equal(result.error.code, 'event_payload_conflict');
    assert.equal(JSON.stringify(result).includes('Synthetic'), false);
  }
  assert.deepEqual(usage(f.core), before); assert.equal(f.calls.length, calls);
  assert.equal(count(f.db, 'raw_events'), 1);
});

for (const kind of ['ordinary','episode']) test(`P2-02 ${kind}: empty/continuation context has the same strict validation and generation fences`, async t => {
  const f = fixture(t, { kind }), parts = splitRaw(' '.repeat(4000)+'Synthetic continuation');
  const source = request(parts[0], {}, kind);
  for (const context of kind === 'episode' ? [undefined, { ...source.episodeContext,extra: true },
    { ...source.episodeContext,generation: 'wrong' }, { ...source.episodeContext,origin: 'invalid' }]
    : [{ streamId: 's',sequence: 0 }, { streamId: 's',sequence: 1,extra: true }, { streamId: 's' }]) {
    const result = await f.core.captureRaw({ ...source, [kind === 'episode' ? 'episodeContext' : 'causal']: context });
    assert.equal(result.ok, false); assert.equal(count(f.db, 'raw_events'), 0);
  }
  completed(await f.core.captureRaw(source));
  const suffix = request(parts[1], {}, kind);
  const malformed = { ...suffix, [kind === 'episode' ? 'episodeContext' : 'causal']: kind === 'episode'
    ? { ...suffix.episodeContext, generation: 'wrong' } : { streamId: 's',sequence: 0 } };
  assert.equal((await f.core.captureRaw(malformed)).ok, false);
  assert.equal(count(f.db, 'raw_events'), 1); assert.equal(f.calls.length, 0);
  const overlap = completed(await f.core.captureRaw({ ...source,eventId: 'blank-overlap' }));
  assert.equal(overlap.status, 'not-run'); assert.equal(overlap.reason, 'no-eligible-first-part');
});

test('P2-07 failed/expired first interpretation overlap is incomplete, not a phantom active job', async t => {
  const f = fixture(t, { model: { extract: () => { throw Error('Synthetic failed model'); } } });
  const source = request(splitRaw('Synthetic failed owner')[0]);
  assert.equal(ok(await f.core.captureRaw(source)).interpretation.ok, false);
  const calls = f.calls.length;
  const result = completed(await f.core.captureRaw({ ...source,eventId: 'failed-overlap' }));
  assert.deepEqual(result, { status: 'incomplete',reason: 'interpretation-incomplete' });
  assert.equal(f.calls.length, calls); assert.equal(count(f.db, 'admission_claims'), 1);
});

test('P2-02/07 existing P1-only first part never invents interpretation or a pending job', async t => {
  const f = rawFixture(t), source = request(splitRaw('Synthetic P1 only source')[0]);
  await f.journal.register(source);
  const { openRawCaptureCore } = await import('../raw-capture.mjs');
  const core = openRawCaptureCore({ path: f.path }, { mode: 'raw-v1',port: localPlainPort(),
    readPolicy: () => ({ generation: 'notice-1',reason: null }) }); t.after(() => core.close());
  const result = completed(await core.captureRaw({ ...source,eventId: 'new-overlap' }));
  assert.equal(result.reason, 'no-eligible-first-part'); assert.equal(count(f.db, 'admission_claims'), 0);
});

for (const state of ['completed','live','mixed','same-event']) test(`P2-01/02 legacy episode ${state} collision refuses Raw backfill and rolls registration back`, async t => {
  let release, started;
  const began = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const f = fixture(t, { kind: 'episode', ...(state === 'live' ? { model: {
    extract: async () => { started(); await pending; return { items: [] }; },
  } } : {}) });
  const source = request(splitRaw('Synthetic legacy owned message')[0], {}, 'episode');
  const legacyInput = { ...source, eventId: state === 'same-event' ? source.eventId : 'legacy',
    messages: source.messages.map(({ id,role,content,occurredAt }) => ({ id,role,content,occurredAt })) };
  const legacy = f.core.capture(legacyInput);
  if (state === 'live') await began; else ok(await legacy);
  const claims = f.db.prepare('SELECT * FROM admission_claims').all(), events = f.db.prepare('SELECT * FROM episode_events').all();
  const calls = f.calls.length;
  try {
    const result = await f.core.captureRaw({ ...source, ...(state === 'mixed' ? { messages: [...source.messages,
      splitRaw('Synthetic fresh mixed member', { id: 'fresh',ordinal: 2 })[0]] } : {}) });
    assert.deepEqual(result, { ok: false,error: { code: 'event_payload_conflict',retryable: false } });
    const fresh = openDatabase(f.path); t.after(() => fresh.close());
    for (const table of ['raw_parts','raw_messages','raw_events','raw_capture_events','raw_owner_usage']) assert.equal(count(fresh, table), 0, table);
    assert.deepEqual(fresh.prepare('SELECT * FROM admission_claims').all(), claims);
    assert.deepEqual(fresh.prepare('SELECT * FROM episode_events').all(), events);
    assert.equal(f.calls.length, calls);
  } finally { if (state === 'live') { release(); ok(await legacy); } }
});

import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { fixture, ns, request, splitRaw, localPlainPort, completed, ok, count, usage } from '../testing/raw-capture-fixtures.mjs';

for (const kind of ['ordinary','episode']) for (const barrier of ['pause','project','client','session']) {
  test(`P2-04/05 ${kind}: ${barrier} during sealing wins before registration/model work`, async t => {
    let f;
    const namespace = barrier === 'project' ? { ...ns, scope: 'project', projectId: 'project-a' } : ns;
    const port = localPlainPort(), original = port.sealRaw;
    port.sealRaw = async value => {
      const probe = new DatabaseSync(f.path);
      try { probe.exec('BEGIN IMMEDIATE; COMMIT'); } finally { probe.close(); }
      if (barrier === 'pause') ok(f.core.setCapturePaused({ namespace, expectedGeneration: 'initial', paused: true }));
      if (barrier === 'project') ok(f.core.setProjectCapture({ namespace, expectedGeneration: 'initial', enabled: false }));
      if (barrier === 'client') ok(f.core.setRawCaptureControl({ ownerId: ns.ownerId, client: 'claude-code', expectedRevision: 0, enabled: false }));
      if (barrier === 'session') ok(f.core.fenceSession({ namespace, client: 'claude-code', sessionId: 'synthetic-session' }));
      return original(value);
    };
    f = fixture(t, { kind, port });
    const result = await f.core.captureRaw(request(splitRaw('Synthetic sealed race')[0], { namespace }, kind));
    assert.equal(result.ok, false);
    assert.equal(count(f.db, 'raw_events'), 0); assert.equal(count(f.db, 'admission_claims'), 0);
    assert.equal(f.calls.length, 0);
    assert.equal(JSON.stringify(result).includes('Synthetic sealed race'), false);
  });
}

for (const kind of ['ordinary','episode']) for (const barrier of ['pause','project','session', ...(kind === 'episode' ? ['episode-delete'] : [])]) {
  test(`P2-05 ${kind}: ${barrier} during model retains Raw and blocks stale Memory`, async t => {
    let f;
    const namespace = barrier === 'project' ? { ...ns, scope: 'project', projectId: 'project-a' } : ns;
    f = fixture(t, { kind, model: { extract: () => {
      if (barrier === 'pause') ok(f.core.setCapturePaused({ namespace, expectedGeneration: 'initial', paused: true }));
      if (barrier === 'project') ok(f.core.setProjectCapture({ namespace, expectedGeneration: 'initial', enabled: false }));
      if (barrier === 'session') ok(f.core.fenceSession({ namespace, client: 'claude-code', sessionId: 'synthetic-session' }));
      if (barrier === 'episode-delete') {
        const row = f.db.prepare('SELECT id,revision FROM session_episodes').get();
        ok(f.core.forgetEpisode({ namespace, episodeId: row.id, expectedRevision: row.revision }));
      }
      return { items: [{ content: 'Synthetic stale Memory',kind: 'context',confidence: 0.5,sourceIndices: [0] }] };
    } } });
    const result = ok(await f.core.captureRaw(request(splitRaw('Synthetic registered race')[0], { namespace }, kind)));
    assert.equal(result.raw.parts[0].saved, true);
    assert.equal(result.interpretation.ok, false);
    assert.equal(count(f.db, 'memories'), 0);
    assert.equal(count(f.db, 'raw_parts'), 1);
  });
}

test('P2-05 episode: pause during interpreter fences episode prose as well as Memory', async t => {
  let f;
  f = fixture(t, { kind: 'episode', model: { interpretEpisode: value => {
    ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: 'initial', paused: true }));
    return interpretation(value);
  } } });
  const result = ok(await f.core.captureRaw(request(splitRaw('Synthetic episode race')[0], {}, 'episode')));
  assert.equal(result.interpretation.ok, false);
  assert.equal(JSON.parse(f.db.prepare('SELECT record FROM session_episodes').get().record).gist, null);
  assert.equal(count(f.db, 'episode_sources'), 0); assert.equal(count(f.db, 'memories'), 0);
});

test('P2-05 actual episode deletion during seal refuses suffix/fresh event and persists after episode-off reopen', async t => {
  const f = fixture(t, { kind: 'episode' });
  const first = request(splitRaw('Synthetic first episode')[0], {}, 'episode');
  completed(await f.core.captureRaw(first));
  const row = f.db.prepare('SELECT id,revision FROM session_episodes').get();
  const port = localPlainPort();
  port.sealRaw = async ({ text }) => {
    ok(f.core.forgetEpisode({ namespace: ns, episodeId: row.id, expectedRevision: row.revision }));
    return { format: 'local-plain-v1', keyVersion: null, sealed: Buffer.from(text) };
  };
  const { openRawCaptureCore } = await import('../raw-capture.mjs');
  const second = openRawCaptureCore({ path: f.path, model: f.model }, { mode: 'raw-v1', port,
    readPolicy: () => ({ generation: 'notice', reason: null }) });
  t.after(() => second.close());
  const calls = f.calls.length;
  assert.equal((await second.captureRaw(request(splitRaw('Synthetic late message', { id: 'late', ordinal: 2 })[0]))).ok, false);
  assert.equal(count(f.db, 'raw_events'), 1); assert.equal(f.calls.length, calls);
  assert.equal((await second.captureRaw(first)).ok, false);
});

for (const kind of ['ordinary','episode']) for (const barrier of ['pause','project','client']) {
  test(`P2-04 ${kind}: ${barrier} closes only affected reservations; new message saves after resume`, async t => {
    const f = fixture(t, { kind });
    const namespace = barrier === 'project' ? { ...ns, scope: 'project', projectId: 'project-a' } : ns;
    const parts = splitRaw('Synthetic pending message '.repeat(200));
    completed(await f.core.captureRaw(request(parts[0], { namespace }, kind)));
    const otherParts = splitRaw('Other pending message '.repeat(250));
    completed(await f.core.captureRaw(request(otherParts[0], { client: 'codex', namespace: { ...ns, ownerId: 'other-owner' } }, kind)));
    const before = usage(f.core); assert.ok(before.reservedBytes > 0);
    let control;
    if (barrier === 'pause') {
      control = ok(f.core.setCapturePaused({ namespace, expectedGeneration: 'initial', paused: true }));
      control = ok(f.core.setCapturePaused({ namespace, expectedGeneration: control.generation, paused: false }));
    } else if (barrier === 'project') {
      control = ok(f.core.setProjectCapture({ namespace, expectedGeneration: 'initial', enabled: false }));
      control = ok(f.core.setProjectCapture({ namespace, expectedGeneration: control.generation, enabled: true }));
    } else {
      ok(f.core.setRawCaptureControl({ ownerId: ns.ownerId, client: 'claude-code', expectedRevision: 0, enabled: false }));
      ok(f.core.setRawCaptureControl({ ownerId: ns.ownerId, client: 'claude-code', expectedRevision: 1, enabled: true }));
    }
    assert.equal(usage(f.core).reservedBytes, 0);
    assert.equal(ok(f.core.getRawUsage({ ownerId: 'other-owner' })).reservedBytes, Buffer.byteLength(otherParts[1].content));
    const patch = { namespace, ...(kind === 'episode' && control ? { episodeContext: {
      clientLabel: 'Synthetic client', generation: control.generation, origin: 'ordinary' } } : {}) };
    const fresh = ok(await f.core.captureRaw(request(splitRaw('Fresh after barrier', { id: 'fresh', ordinal: 2 })[0], patch, kind)));
    assert.equal(fresh.raw.parts[0].saved, true);
    const late = ok(await f.core.captureRaw(request(parts[1], patch, kind)));
    assert.equal(late.raw.parts[0].saved, false);
    assert.equal(late.raw.parts[0].reason, barrier === 'client' ? 'tool_off' : 'capture_barrier');
  });
}

test('P2-07 Raw-off during registered extraction permits Memory completion', async t => {
  let f;
  f = fixture(t, { model: { extract: () => {
    ok(f.core.setRawCaptureControl({ ownerId: ns.ownerId, client: 'claude-code', expectedRevision: 0, enabled: false }));
    return { items: [{ content: 'Synthetic still eligible Memory', kind: 'context', confidence: 0.5, sourceIndices: [0] }] };
  } } });
  assert.equal(completed(await f.core.captureRaw(request(splitRaw('Synthetic Raw-off boundary')[0]))).admission.memories.length, 1);
});

test('P2-02/06 prepared caller/context mutation cannot swap frozen ordinary projection or order', async t => {
  let f, submitted;
  const port = localPlainPort(), original = port.sealRaw;
  port.sealRaw = value => {
    submitted.messages[0].content = 'Caller replacement';
    submitted.causal.streamId = 'caller-stream'; submitted.causal.sequence = 99;
    submitted.namespace.ownerId = 'caller-owner';
    return original(value);
  };
  f = fixture(t, { port });
  submitted = request(splitRaw('Original frozen text')[0], { namespace: { ...ns }, causal: { streamId: 'frozen-stream', sequence: 1 } });
  const result = completed(await f.core.captureRaw(submitted));
  assert.equal(result.admission.memories.length, 1);
  assert.equal(f.calls.find(call => call.method === 'extract').input.messages[0].content, 'Original frozen text');
  assert.equal(f.db.prepare('SELECT stream_id,sequence FROM capture_events').get().stream_id, 'frozen-stream');
  assert.equal(count(f.db, 'raw_capture_events'), 1);
});

test('P2-06 actual concurrent epoch change after registered ordered claim refuses stale admission', async t => {
  let f;
  f = fixture(t, { model: { extract: () => {
    ok(f.core.admit({ namespace: ns, memory: { content: 'Concurrent explicit Memory', kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 's', eventId: 'e', role: 'user', excerpt: 'Synthetic independent evidence' }] }));
    return { items: [{ content: 'Stale inferred Memory',kind: 'context',confidence: 0.5,sourceIndices: [0] }] };
  } } });
  const result = ok(await f.core.captureRaw(request(splitRaw('Synthetic ordered input')[0], { causal: { streamId: 'stream', sequence: 1 } })));
  assert.equal(result.interpretation.ok, false); assert.equal(result.interpretation.error.code, 'index_revision_conflict');
  assert.equal(count(f.db, 'memories'), 1); assert.equal(count(f.db, 'raw_parts'), 1);
});

test('P2-03 staging capacity bypass is restricted to new Raw path and never claims staged evidence', async t => {
  const f = fixture(t, { kind: 'staged', model: { extract: () => ({ items: [] }) } });
  const first = request(splitRaw('Synthetic staged seed')[0]);
  completed(await f.core.captureRaw(first));
  const row = f.db.prepare('SELECT * FROM staged_capture_evidence').get();
  const admission = f.db.prepare('SELECT * FROM admission_claims').get();
  for (let n = 0; n < 63; n++) {
    f.db.prepare(`INSERT INTO admission_claims(owner_id,scope,project_id,client,event_id,payload_digest,state,token,lease_expires_at)
      VALUES(?,?,?,?,?,?,'pending',?,?)`).run(row.owner_id,row.scope,row.project_id,row.client,`seed-${n}`,admission.payload_digest,`token-${n}`,Date.now()+125000);
    f.db.prepare(`INSERT INTO staged_capture_evidence(owner_id,scope,project_id,client,event_id,state,created_at,expires_at,payload,payload_bytes)
      VALUES(?,?,?,?,?,'pending',?,?,?,?)`).run(row.owner_id,row.scope,row.project_id,row.client,`seed-${n}`,row.created_at,row.expires_at,row.payload,row.payload_bytes);
  }
  assert.equal(f.db.prepare('SELECT count(*) n FROM staged_capture_evidence WHERE payload IS NOT NULL').get().n, 64);
  const legacy = await f.core.capture({ namespace: ns,client: 'claude-code',sessionId: 'legacy',eventId: 'legacy',
    messages: [{ id: 'legacy-message',role: 'user',content: 'Legacy capacity refusal' }] });
  assert.equal(legacy.error.code, 'capture_evidence_capacity');
  const second = ok(await f.core.captureRaw(request(splitRaw('Synthetic bypass evidence', { id: 'second',ordinal: 2 })[0])));
  ok(second.interpretation); assert.equal(second.raw.parts[0].saved, true);
  assert.equal(f.db.prepare("SELECT staging FROM raw_capture_events WHERE event_id=?").get('event-second-0').staging, 'not-staged');
  assert.equal(count(f.db, 'staged_capture_evidence'), 64);
  const saved = usage(f.core).savedBytes;
  f.db.prepare('UPDATE staged_capture_clocks SET watermark=?').run(Date.now()+25*60*60*1000);
  ok(f.core.inspectCaptureEvidence({ namespace: ns,client: 'claude-code',eventId: first.eventId }));
  assert.equal(usage(f.core).savedBytes, saved);
});

test('P2-06 expired episode staging advances epoch after Raw commit and before ordered proof', async t => {
  const f = fixture(t, { kind: 'episode' });
  completed(await f.core.captureRaw(request(splitRaw('Synthetic earlier episode source')[0], {}, 'episode')));
  completed(await f.core.captureRaw(request(splitRaw('Synthetic debounced episode source', { id: 'debounced',ordinal: 2 })[0], {}, 'episode')));
  assert.equal(f.db.prepare("SELECT state FROM staged_capture_evidence WHERE event_id='event-debounced-0'").get().state, 'admitted');
  f.db.prepare('UPDATE staged_capture_evidence SET expires_at=? WHERE payload IS NOT NULL').run(Date.now()-1);
  const before = f.db.prepare('SELECT epoch FROM namespace_epochs').get().epoch;
  const { openRawCaptureCore } = await import('../raw-capture.mjs');
  const other = openRawCaptureCore({ path: f.path, model: f.model }, { mode: 'raw-v1',port: localPlainPort(),
    readPolicy: () => ({ generation: 'notice-1',reason: null }) }); t.after(() => other.close());
  const result = completed(await other.captureRaw(request(splitRaw('Synthetic ordered next source', { id: 'next',ordinal: 3 })[0],
    { causal: { streamId: 'after-expiry',sequence: 1 } })));
  assert.equal(result.admission.memories.length, 1);
  assert.equal(f.db.prepare('SELECT epoch FROM namespace_epochs').get().epoch > before, true);
  assert.equal(f.db.prepare("SELECT state FROM staged_capture_evidence WHERE event_id='event-debounced-0'").get().state, 'expired');
});

test('P2-06 episode registration is visible before lazy interpretation of the previous session', async t => {
  let f, checkIncoming = false, checked = 0;
  f = fixture(t, { kind: 'episode', coreOptions: { sessionEpisodes: { mode: 'episode-v1',draftEveryBatches: 8 } },
    model: { interpretEpisode: value => {
      if (checkIncoming) {
        assert.equal(f.db.prepare("SELECT count(*) n FROM raw_capture_events WHERE event_id='incoming'").get().n, 1);
        assert.equal(f.db.prepare("SELECT state FROM admission_claims WHERE event_id='incoming'").get().state, 'reserved');
        checked++;
      }
      return interpretation(value);
    } } });
  completed(await f.core.captureRaw(request(splitRaw('Synthetic session A first')[0], {}, 'episode')));
  completed(await f.core.captureRaw(request(splitRaw('Synthetic session A second', { id: 'second',ordinal: 2 })[0], {}, 'episode')));
  checkIncoming = true;
  const result = completed(await f.core.captureRaw(request(splitRaw('Synthetic session B first')[0],
    { sessionId: 'session-b',eventId: 'incoming' }, 'episode')));
  assert.equal(result.lazyEpisode.status, 'interpreted'); assert.ok(checked >= 2);
  assert.equal(count(f.db, 'session_episodes'), 2);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { openDatabase } from '../database.mjs';
import { fixture, config, ns, request, splitRaw, localPlainPort, completed, ok, count, usage } from '../testing/raw-capture-fixtures.mjs';

const claim = (db, eventId) => db.prepare('SELECT * FROM admission_claims WHERE event_id=?').get(eventId);
const error = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
const processWinner = (f, input, outcome = 'fail', options = {}) => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('../testing/raw-capture-process.mjs', import.meta.url)),
    f.path, JSON.stringify(input), outcome, JSON.stringify(options)], { encoding: 'utf8',timeout: 15000 });
  assert.equal(child.status, 0, child.stderr);
  const winner = JSON.parse(child.stdout);
  ok(winner.result);
  return winner;
};

for (const client of ['claude-code','codex']) {
  for (const kind of ['ordinary','staged','episode']) for (const outcome of ['fail','complete']) {
    test(`P2-07 final observation ${kind} ${client}: ${outcome} winner during failing preflight retains recorded Raw`, async t => {
      let f, winner, beforeClaim, active = false;
      const input = request(splitRaw('Synthetic final preflight observation')[0], { client }, kind);
      f = fixture(t, { kind, model: { countTokens: () => {
        if (!active) {
          active = true; winner = processWinner(f, input, outcome, config(kind));
          beforeClaim = claim(f.db, input.eventId);
        }
        return 8192;
      } } });
      const result = ok(await f.core.captureRaw(input)), observed = ok(result.interpretation);
      assert.deepEqual(result.raw, winner.result.value.raw);
      if (outcome === 'fail') assert.equal(observed.status, 'incomplete');
      else assert.equal(observed.duplicate, true);
      assert.equal(f.calls.length, 0); assert.deepEqual(usage(f.core), winner.usage.value);
      const fresh = openDatabase(f.path); f.workspace.defer(() => fresh.close());
      assert.equal(count(fresh, 'raw_events'), 1); assert.equal(count(fresh, 'raw_capture_events'), 1);
      assert.equal(count(fresh, 'admission_claims'), 1); assert.equal(count(fresh, 'memories'), 0);
      assert.deepEqual(claim(fresh, input.eventId), beforeClaim);
    });
  }

  test(`P2-07 final observation ${client}: throwing preflight counter also observes a durable winner`, async t => {
    let f, winner, active = false;
    const input = request(splitRaw('Synthetic throwing counter observation')[0], { client });
    f = fixture(t, { model: { countTokens: () => {
      if (!active) { active = true; winner = processWinner(f, input); }
      throw Error('Synthetic tokenizer failure');
    } } });
    const result = ok(await f.core.captureRaw(input));
    assert.equal(ok(result.interpretation).status, 'incomplete');
    assert.deepEqual(result.raw, winner.result.value.raw);
    assert.equal(f.calls.length, 0); assert.deepEqual(usage(f.core), winner.usage.value);
  });

  for (const kind of ['ordinary','staged','episode']) test(`P2-07 final observation ${kind} ${client}: fresh failing preflight still writes nothing`, async t => {
    const f = fixture(t, { kind,model: { countTokens: () => 8192 } });
    error(await f.core.captureRaw(request(splitRaw('Synthetic fresh oversized refusal')[0], { client }, kind)), 'context_budget_exceeded');
    const fresh = openDatabase(f.path); f.workspace.defer(() => fresh.close());
    for (const table of ['raw_events','raw_capture_events','raw_parts','admission_claims','staged_capture_evidence','memories']) {
      assert.equal(count(fresh, table), 0, table);
    }
    assert.equal(f.calls.length, 0);
  });

  for (const barrier of ['source','profile','digest','pause','generation','session','project','different-event','orphan']) {
    test(`P2-07 final observation ${client}: failing preflight cannot bypass ${barrier}`, async t => {
      let f, winner, beforeClaim, active = false;
      const namespace = barrier === 'project' ? { ...ns,scope: 'project',projectId: 'synthetic-project' } : ns;
      const input = request(splitRaw('Synthetic guarded final observation')[0], { client,namespace });
      f = fixture(t, { model: { countTokens: () => {
        if (!active) {
          active = true;
          const changed = barrier === 'source' ? { ...input,messages: [{ ...input.messages[0],role: 'assistant' }] }
            : barrier === 'different-event' ? { ...input,eventId: 'different-winner' } : input;
          winner = processWinner(f, changed, 'fail', barrier === 'profile' ? config('staged') : {});
          if (barrier === 'digest') f.db.prepare('UPDATE admission_claims SET payload_digest=?').run('a'.repeat(64));
          if (['pause','generation'].includes(barrier)) {
            const control = ok(f.core.setCapturePaused({ namespace,expectedGeneration: 'initial',paused: true }));
            if (barrier === 'generation') ok(f.core.setCapturePaused({ namespace,expectedGeneration: control.generation,paused: false }));
          }
          if (barrier === 'project') ok(f.core.setProjectCapture({ namespace,expectedGeneration: 'initial',enabled: false }));
          if (barrier === 'session') ok(f.core.fenceSession({ namespace,client,sessionId: input.sessionId }));
          if (barrier === 'orphan') {
            // Normal FK enforcement forbids this state. Even a corrupt fixture
            // must not turn observational fallback into receipt repair.
            f.db.exec('PRAGMA foreign_keys=OFF; DELETE FROM raw_events; PRAGMA foreign_keys=ON;');
          }
          beforeClaim = claim(f.db, changed.eventId);
        }
        return 8192;
      } } });
      const result = await f.core.captureRaw(input);
      const code = ['source','profile','digest','orphan'].includes(barrier) ? 'event_payload_conflict'
        : ['pause','project'].includes(barrier) ? 'capture_disabled'
          : barrier === 'generation' ? 'capture_evidence_closed'
            : barrier === 'session' ? 'conversation_deleted' : 'context_budget_exceeded';
      error(result, code);
      assert.equal(f.calls.length, 0); assert.deepEqual(usage(f.core), winner.usage.value);
      const fresh = openDatabase(f.path); f.workspace.defer(() => fresh.close());
      assert.equal(count(fresh, 'raw_events'), barrier === 'orphan' ? 0 : 1); assert.equal(count(fresh, 'raw_capture_events'), 1);
      assert.equal(count(fresh, 'admission_claims'), 1); assert.equal(count(fresh, 'memories'), 0);
      assert.deepEqual(claim(fresh, beforeClaim.event_id), beforeClaim);
    });
  }

  test(`P2-07 R1 ${client}: cold exact completed replay preserves Raw after actual staging expiry`, async t => {
    let seals = 0;
    const port = localPlainPort(), seal = port.sealRaw;
    port.sealRaw = value => { seals++; return seal(value); };
    const f = fixture(t, { kind: 'staged', port, model: { extract: () => ({ items: [] }) } });
    const input = request(splitRaw('Synthetic completed replay')[0], { client });
    const original = ok(await f.core.captureRaw(input)); ok(original.interpretation);
    f.db.prepare('UPDATE staged_capture_evidence SET expires_at=?').run(Date.now()-1);
    assert.equal(ok(f.core.inspectCaptureEvidence({ namespace: ns,client,eventId: input.eventId })).evidence.state, 'expired');
    const calls = f.calls.length, beforeUsage = usage(f.core), beforeClaim = claim(f.db, input.eventId);
    f.reopen();
    const result = ok(await f.core.captureRaw(input)), replay = ok(result.interpretation);
    assert.deepEqual(result.raw, original.raw); assert.equal(replay.duplicate, true);
    assert.deepEqual(replay.memoryIds, []); assert.equal(replay.suppressedCount, 0);
    assert.equal(f.calls.length, calls); assert.equal(seals, 1);
    const fresh = openDatabase(f.path); f.workspace.defer(() => fresh.close());
    assert.deepEqual(claim(fresh, input.eventId), beforeClaim);
    assert.equal(fresh.prepare('SELECT state FROM staged_capture_evidence').get().state, 'expired');
    assert.deepEqual(usage(f.core), beforeUsage);
  });

  for (const kind of ['ordinary','staged','episode']) test(`P2-07 R1 ${kind} ${client}: failed exact replay observes incomplete without retry`, async t => {
    const f = fixture(t, { kind, model: { extract: () => { throw Error('SYNTHETIC_FAILED_EXTRACTOR'); } } });
    const input = request(splitRaw('Synthetic failed replay')[0], { client }, kind);
    const original = ok(await f.core.captureRaw(input)); assert.equal(original.interpretation.ok, false);
    const calls = f.calls.length, beforeUsage = usage(f.core), beforeClaim = claim(f.db, input.eventId);
    f.reopen();
    const result = ok(await f.core.captureRaw(input)), replay = ok(result.interpretation);
    assert.deepEqual(result.raw, original.raw);
    assert.equal(replay.status, 'incomplete'); assert.equal(replay.reason, 'interpretation-incomplete');
    assert.equal(f.calls.length, calls); assert.deepEqual(usage(f.core), beforeUsage);
    const fresh = openDatabase(f.path); f.workspace.defer(() => fresh.close());
    assert.deepEqual(claim(fresh, input.eventId), beforeClaim);
    assert.equal(count(fresh, 'memories'), 0);
  });

  for (const state of ['live','expired','staging-wall-expired','staging-clock-expired']) test(`P2-07 R1 staged ${client}: ${state} pending replay never reacquires ownership`, async t => {
    let release, started;
    const began = new Promise(resolve => { started = resolve; }), wait = new Promise(resolve => { release = resolve; });
    const f = fixture(t, { kind: 'staged', model: { extract: async () => { started(); await wait; return { items: [] }; } } });
    const input = request(splitRaw('Synthetic pending replay')[0], { client });
    const pending = f.core.captureRaw(input); await began;
    try {
      if (state === 'expired') f.db.prepare('UPDATE admission_claims SET lease_expires_at=?').run(Date.now()-1);
      if (state === 'staging-wall-expired') f.db.prepare('UPDATE staged_capture_evidence SET expires_at=?').run(Date.now()-1);
      if (state === 'staging-clock-expired') {
        const expires = f.db.prepare('SELECT expires_at FROM staged_capture_evidence').get().expires_at;
        f.db.prepare('UPDATE staged_capture_clocks SET watermark=?').run(expires+1);
      }
      const beforeClaim = claim(f.db, input.eventId), beforeUsage = usage(f.core), calls = f.calls.length;
      const beforeEvidence = f.db.prepare('SELECT * FROM staged_capture_evidence').all();
      const original = JSON.parse(f.db.prepare('SELECT result FROM raw_events WHERE event_id=?').get(input.eventId).result);
      const result = ok(await f.core.captureRaw(input)), replay = ok(result.interpretation);
      assert.deepEqual(result.raw, original);
      if (state === 'live') assert.equal(replay.processing, true);
      else assert.equal(replay.status, 'incomplete');
      const fresh = openDatabase(f.path); f.workspace.defer(() => fresh.close());
      assert.deepEqual(claim(fresh, input.eventId), beforeClaim);
      assert.deepEqual(fresh.prepare('SELECT * FROM staged_capture_evidence').all(), beforeEvidence);
      assert.deepEqual(usage(f.core), beforeUsage); assert.equal(f.calls.length, calls);
    } finally { release(); ok(await pending); }
  });

  test(`P2-07 R1 ${client}: exact replay preserves identity, profile, digest and closed authority fences`, async t => {
    const f = fixture(t, { kind: 'staged', model: { extract: () => ({ items: [] }) } });
    const input = request(splitRaw('Synthetic replay authority')[0], { client });
    completed(await f.core.captureRaw(input));
    const calls = f.calls.length, beforeUsage = usage(f.core);
    error(await f.core.captureRaw({ ...input,messages: [{ ...input.messages[0],role: 'assistant' }] }), 'event_payload_conflict');
    const digest = claim(f.db, input.eventId).payload_digest;
    f.db.prepare('UPDATE admission_claims SET payload_digest=?').run('a'.repeat(64));
    error(await f.core.captureRaw(input), 'event_payload_conflict');
    f.db.prepare('UPDATE admission_claims SET payload_digest=?').run(digest);
    let control = ok(f.core.setCapturePaused({ namespace: ns,expectedGeneration: 'initial',paused: true }));
    error(await f.core.captureRaw(input), 'capture_disabled');
    control = ok(f.core.setCapturePaused({ namespace: ns,expectedGeneration: control.generation,paused: false }));
    error(await f.core.captureRaw(input), 'capture_evidence_closed');
    assert.equal(f.calls.length, calls); assert.deepEqual(usage(f.core), beforeUsage);
  });

  test(`P2-07 R1 ${client}: durable session fence refuses recorded replay and fresh failed registration stays atomic`, async t => {
    const f = fixture(t, { kind: 'staged', model: { extract: () => ({ items: [] }) } });
    const input = request(splitRaw('Synthetic session replay')[0], { client });
    completed(await f.core.captureRaw(input));
    ok(f.core.fenceSession({ namespace: ns,client,sessionId: input.sessionId }));
    f.reopen(); error(await f.core.captureRaw(input), 'conversation_deleted');
    const beforeUsage = usage(f.core), calls = f.calls.length;
    f.db.exec("CREATE TRIGGER synthetic_replay_new_failure AFTER INSERT ON admission_claims BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
    assert.equal((await f.core.captureRaw(request(splitRaw('Synthetic fresh rollback')[0], { client,sessionId: 'fresh-session',eventId: 'fresh-failure' }))).ok, false);
    const fresh = openDatabase(f.path); f.workspace.defer(() => fresh.close());
    assert.equal(count(fresh, 'raw_capture_events'), 1); assert.equal(count(fresh, 'raw_events'), 1);
    assert.equal(count(fresh, 'raw_parts'), 1); assert.equal(count(fresh, 'admission_claims'), 1);
    assert.deepEqual(usage(f.core), beforeUsage); assert.equal(f.calls.length, calls);
  });

  test(`P2-07 R1 ${client}: ordered completed replay preserves durable reconciliation without model work`, async t => {
    const f = fixture(t, { model: { extract: () => ({ items: [] }) } });
    const input = request(splitRaw('Synthetic ordered replay')[0], { client,causal: { streamId: 'ordered-replay',sequence: 1 } });
    const original = ok(await f.core.captureRaw(input)), first = ok(original.interpretation), beforeUsage = usage(f.core), calls = f.calls.length;
    const beforeClaim = claim(f.db, input.eventId); f.reopen();
    const result = ok(await f.core.captureRaw(input)), replay = ok(result.interpretation);
    assert.deepEqual(replay.reconciliation, first.reconciliation); assert.equal(replay.duplicate, true);
    assert.deepEqual(result.raw, original.raw); assert.equal(f.calls.length, calls);
    assert.deepEqual(claim(f.db, input.eventId), beforeClaim); assert.deepEqual(usage(f.core), beforeUsage);
  });

  for (const kind of ['ordinary','staged','episode']) test(`P2-07 R1 ${kind} ${client}: winner during sealing turns the slower request into observation`, async t => {
    let release, entered;
    const held = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
    const port = localPlainPort(), seal = port.sealRaw; let seals = 0;
    port.sealRaw = async value => { if (++seals === 1) { entered(); await held; } return seal(value); };
    const f = fixture(t, { kind, port, model: { extract: () => { throw Error('Synthetic winner failure'); } } });
    const input = request(splitRaw('Synthetic concurrent replay')[0], { client }, kind), slower = f.core.captureRaw(input);
    await began;
    try {
      const winner = ok(await f.core.captureRaw(input)); assert.equal(winner.interpretation.ok, false);
      const beforeUsage = usage(f.core), beforeClaim = claim(f.db, input.eventId), calls = f.calls.length;
      release();
      const result = ok(await slower), replay = ok(result.interpretation);
      assert.deepEqual(result.raw, winner.raw); assert.equal(replay.status, 'incomplete');
      assert.equal(f.calls.length, calls); assert.deepEqual(usage(f.core), beforeUsage);
      assert.deepEqual(claim(f.db, input.eventId), beforeClaim); assert.equal(count(f.db, 'memories'), 0);
    } finally { release(); await slower; }
  });

  test(`P2-07 R1 ${client}: another process winning at the admission boundary stays observation-only`, async t => {
    let f, winner, active = false;
    const input = request(splitRaw('Synthetic process boundary replay')[0], { client });
    f = fixture(t, { model: { countTokens: () => {
      if (!active) {
        active = true;
        const child = spawnSync(process.execPath, [fileURLToPath(new URL('../testing/raw-capture-process.mjs', import.meta.url)), f.path, JSON.stringify(input), 'fail'],
          { encoding: 'utf8',timeout: 15000 });
        assert.equal(child.status, 0, child.stderr); winner = JSON.parse(child.stdout);
      }
      return 1;
    } } });
    const result = ok(await f.core.captureRaw(input)), replay = ok(result.interpretation);
    assert.equal(replay.status, 'incomplete'); assert.deepEqual(result.raw, winner.result.value.raw);
    assert.equal(f.calls.length, 0); assert.equal(count(f.db, 'admission_claims'), 1);
    assert.deepEqual(usage(f.core), winner.usage.value);
  });

  test(`P2-07 R1 ${client}: a different-event winner still refuses the stale sealed registration`, async t => {
    let release, entered;
    const held = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
    const port = localPlainPort(), seal = port.sealRaw; let seals = 0;
    port.sealRaw = async value => { if (++seals === 1) { entered(); await held; } return seal(value); };
    const f = fixture(t, { kind: 'staged',port,model: { extract: () => ({ items: [] }) } });
    const input = request(splitRaw('Synthetic different event race')[0], { client }), slower = f.core.captureRaw(input);
    await began;
    try {
      completed(await f.core.captureRaw({ ...input,eventId: 'different-winner' }));
      const calls = f.calls.length, beforeUsage = usage(f.core); release();
      error(await slower, 'revision_conflict');
      assert.equal(count(f.db, 'raw_events'), 1); assert.equal(count(f.db, 'admission_claims'), 1);
      assert.equal(f.calls.length, calls); assert.deepEqual(usage(f.core), beforeUsage);
    } finally { release(); await slower; }
  });

  test(`P2-07 R1 ${client}: winner during sealing is observed before model-budget preflight`, async t => {
    let release, entered, tooLarge = false;
    const held = new Promise(resolve => { release = resolve; }), began = new Promise(resolve => { entered = resolve; });
    const port = localPlainPort(), seal = port.sealRaw; let seals = 0;
    port.sealRaw = async value => { if (++seals === 1) { entered(); await held; } return seal(value); };
    const f = fixture(t, { port,model: { countTokens: () => tooLarge ? 8192 : 1,
      extract: () => { throw Error('Synthetic winner failure'); } } });
    const input = request(splitRaw('Synthetic preflight selection replay')[0], { client }), slower = f.core.captureRaw(input);
    await began;
    try {
      const winner = ok(await f.core.captureRaw(input)); assert.equal(winner.interpretation.ok, false);
      const calls = f.calls.length, beforeUsage = usage(f.core), beforeClaim = claim(f.db, input.eventId);
      tooLarge = true; release();
      const result = ok(await slower), replay = ok(result.interpretation);
      assert.deepEqual(result.raw, winner.raw); assert.equal(replay.status, 'incomplete');
      assert.equal(f.calls.length, calls); assert.deepEqual(usage(f.core), beforeUsage);
      assert.deepEqual(claim(f.db, input.eventId), beforeClaim);
    } finally { release(); await slower; }
  });
}

test('P2-07 R1 replay short-circuit cannot be injected by request or model fields', async t => {
  const f = fixture(t, { model: { extract: () => ({ items: [],rawReplay: { processing: true } }) } });
  const input = request(splitRaw('Synthetic injection boundary')[0]);
  error(await f.core.captureRaw({ ...input,rawReplay: { processing: true } }), 'invalid_input');
  assert.equal(count(f.db, 'raw_events'), 0);
  const result = ok(await f.core.captureRaw(input));
  error(result.interpretation, 'invalid_model_output');
  assert.equal(result.raw.parts[0].saved, true); assert.equal(count(f.db, 'memories'), 0);
});

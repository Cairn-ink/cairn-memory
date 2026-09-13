import assert from 'node:assert/strict';
import test from 'node:test';
import { createQualificationPilotAttempt, QUALIFICATION_PILOT_LIMITS } from '../qualification-pilot-attempt.mjs';

// Scripted accounting isolates the one-shot controller, not installed MCP or a
// real budget. Actual installed/session/ledger integration has a separate gate.
const body = (method = 'qualify') => JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14',
  text: { format: { name: `cairn_${method}` } } });
function fixture(overrides = {}) {
  const ledger = { state: 'open', requestCount: 62, reservedMicroUsd: 310000,
    limitMicroUsd: 50000000, requestCap: 10000, attempts: [] };
  const events = []; let sends = 0; let active = 0; let maxActive = 0;
  const config = { readState: () => structuredClone(ledger), checkPins: () => {},
    persist: async (name, value) => { events.push({ name, value: structuredClone(value) }); },
    send: async () => {
      sends++; active++; maxActive = Math.max(active, maxActive);
      assert.match(events.at(-1).name, /reserved/);
      await Promise.resolve(); ledger.requestCount++; ledger.reservedMicroUsd += 5000;
      ledger.attempts.push({ outcome: 'succeeded', actualMicroUsd: null }); active--;
      return Response.json({ synthetic: true });
    }, expectedCheckpoint: { requestCount: 62, reservedMicroUsd: 310000 }, ...overrides };
  const gate = createQualificationPilotAttempt(config);
  return { gate, ledger, events, config, sends: () => sends, maxActive: () => maxActive };
}

test('QP1 strict dependency/checkpoint input and preflight require settled open ledger and full declared headroom', () => {
  assert.deepEqual(QUALIFICATION_PILOT_LIMITS, { requests: 100, microUsd: 1000000, reservationMicroUsd: 5000 });
  assert.throws(() => createQualificationPilotAttempt());
  const f = fixture();
  for (const key of Object.keys(f.config)) { const bad = { ...f.config }; delete bad[key]; assert.throws(() => createQualificationPilotAttempt(bad)); }
  assert.throws(() => createQualificationPilotAttempt({ ...f.config, extra: true }));
  for (const expectedCheckpoint of [null, {}, { requestCount: 62, reservedMicroUsd: 310000, extra: true },
    { requestCount: 61, reservedMicroUsd: 310000 }, { requestCount: 62, reservedMicroUsd: 309999 }])
    assert.throws(() => createQualificationPilotAttempt({ ...f.config, expectedCheckpoint }));
  for (const patch of [{ state: 'closed' }, { requestCount: NaN }, { reservedMicroUsd: -1 },
    { attempts: [{ outcome: null }] }, { limitMicroUsd: 1309999 }, { requestCap: 161 },
    { limitMicroUsd: 50000001 }]) {
    assert.throws(() => createQualificationPilotAttempt({ ...f.config, readState: () => ({ ...f.ledger, ...patch }) }));
  }
  assert.equal(f.sends(), 0);
});

test('QP2 fixed 100 HTTP ceiling serializes requests and counts both routes without refunds', async () => {
  const f = fixture();
  await Promise.all(Array.from({ length: 100 }, (_, index) => f.gate.request(index % 2 ? '/responses' : '/responses/input_tokens',
    body(['extract', 'qualify', 'classify'][index % 3]))));
  assert.equal(f.sends(), 100); assert.equal(f.maxActive(), 1);
  assert.equal(f.gate.getState().requests, 100); assert.equal(f.gate.getState().reservedMicroUsd, 500000);
  assert.equal(f.ledger.requestCount, 162); assert.equal(f.ledger.reservedMicroUsd, 810000);
  await assert.rejects(f.gate.request('/responses', body()));
  await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.sends(), 100);
  assert.notEqual(f.gate.getState().halted, null);
});

test('QP3 body/mode allowlist rejects and latches before send; evidence never contains request payload', async () => {
  for (const [path, payload] of [['/chat/completions', body()], ['https://api.openai.com/v1/responses', body()],
    ['/responses', body('reconcile')], ['/responses', body('rank')], ['/responses', '{}'], ['/responses', 'bad-json'],
    ['/responses', JSON.stringify({ model: 'gpt-5.4-mini-2026-03-17', text: { format: { name: 'cairn_extract' } } })]]) {
    const f = fixture(); await assert.rejects(f.gate.request(path, payload));
    await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.sends(), 0);
  }
  const f = fixture(); const payload = JSON.parse(body()); payload.instructions = 'synthetic-private-input';
  await f.gate.request('/responses', JSON.stringify(payload));
  assert.ok(!JSON.stringify(f.events).includes('synthetic-private-input'));
});

test('QP5 pre-request accounting and pin changes stop permanently with no transport', async () => {
  for (const patch of [{ requestCount: 63 }, { reservedMicroUsd: 310001 }, { state: 'closed' }, { attempts: [{ outcome: null }] }]) {
    const f = fixture(); Object.assign(f.ledger, patch);
    await assert.rejects(f.gate.request('/responses', body())); await assert.rejects(f.gate.request('/responses', body()));
    assert.equal(f.sends(), 0);
  }
  const f = fixture({ checkPins: () => { throw new Error('synthetic-path-and-secret'); } });
  await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.sends(), 0);
  assert.ok(!JSON.stringify(f.events).includes('synthetic-path-and-secret'));
});

test('QP5 persistence callbacks cannot change checkpoint or pins between validation and sending', async () => {
  for (const mode of ['checkpoint', 'pin']) {
    let ledger; let changed = false; let sends = 0;
    const f = fixture({ checkPins: () => { if (mode === 'pin' && changed) throw new Error('changed'); },
      persist: async (name) => { if (/reserved/.test(name)) { changed = true; if (mode === 'checkpoint') ledger.requestCount++; } },
      send: async () => { sends++; return Response.json({}); } }); ledger = f.ledger;
    await assert.rejects(f.gate.request('/responses', body()));
    await assert.rejects(f.gate.request('/responses', body())); assert.equal(sends, 0);
  }
});

test('QP5 persistence failures before send or after settlement retain failure and prohibit all later I/O', async () => {
  for (const stage of ['reserved', 'settled']) {
    const f = fixture(); const captured = [];
    const gate = createQualificationPilotAttempt({ ...f.config, persist: async (name, value) => {
      if (name.includes(stage)) throw new Error('synthetic-private-filesystem-error');
      f.events.push({ name, value }); captured.push({ name, value });
    } });
    await assert.rejects(gate.request('/responses', body()));
    const sends = f.sends(); const reserved = gate.getState().reservedMicroUsd;
    await assert.rejects(gate.request('/responses', body())); assert.equal(f.sends(), sends);
    assert.equal(sends, stage === 'reserved' ? 0 : 1); assert.equal(gate.getState().reservedMicroUsd, reserved);
    assert.ok(!JSON.stringify(captured).includes('synthetic-private-filesystem-error'));
  }
});

test('QP5 transport/response/accounting failures halt queued requests and keep reserved attempt cost', async () => {
  for (const mode of ['throw', 'status', 'redirect', 'accounting']) {
    let ledger; let sends = 0;
    const f = fixture({ send: async () => {
      sends++;
      if (mode !== 'accounting') { ledger.requestCount++; ledger.reservedMicroUsd += 5000; }
      if (mode === 'throw') throw new Error('synthetic-credential');
      if (mode === 'status') return new Response('', { status: 500 });
      if (mode === 'redirect') return { ok: true, redirected: true, status: 200 };
      return Response.json({});
    } }); ledger = f.ledger;
    const results = await Promise.allSettled([f.gate.request('/responses', body()), f.gate.request('/responses', body())]);
    assert.ok(results.every((r) => r.status === 'rejected')); assert.equal(sends, 1);
    assert.equal(f.gate.getState().requests, 1); assert.equal(f.gate.getState().reservedMicroUsd, 5000);
    assert.ok(!JSON.stringify(f.events).includes('synthetic-credential'));
  }
});

test('QP5 late failed transport drains before freeze and queued requests never run afterward', async () => {
  let release; let entered; let sends = 0;
  const reached = new Promise((resolve) => { entered = resolve; });
  const f = fixture({ send: async () => { sends++; entered(); return new Promise((_, reject) => { release = reject; }); } });
  const first = f.gate.request('/responses', body()); const queued = f.gate.request('/responses', body());
  const results = Promise.allSettled([first, queued]); await reached;
  let drained = false; const drain = f.gate.drain().then(() => { drained = true; });
  await Promise.resolve(); assert.equal(drained, false);
  release(new Error('late-private-transport')); await results; await drain;
  assert.equal(sends, 1); assert.equal(drained, true); assert.notEqual(f.gate.getState().halted, null);
  await assert.rejects(f.gate.request('/responses', body())); assert.equal(sends, 1);
});

test('QP7 read/replay mode permits no provider requests and stop cannot resume', async () => {
  const f = fixture(); await f.gate.request('/responses', body()); await f.gate.drain();
  f.gate.beginReadOnly(); assert.equal(f.gate.getState().readOnly, true);
  await assert.rejects(f.gate.request('/responses', body()));
  assert.throws(() => f.gate.endReadOnly()); await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.sends(), 1);
  const stopped = fixture(); stopped.gate.stop(); assert.throws(() => stopped.gate.endReadOnly());
  await assert.rejects(stopped.gate.request('/responses', body())); assert.equal(stopped.sends(), 0);
});

test('QP5 signal accessor accounting mutation rejects; returned state and caller checkpoint cannot rewrite internal binding', async () => {
  const f = fixture(); const options = {};
  Object.defineProperty(options, 'signal', { get() { f.ledger.requestCount++; return new AbortController().signal; } });
  await assert.rejects(f.gate.request('/responses', body(), options)); assert.equal(f.sends(), 0);
  const g = fixture(); g.config.expectedCheckpoint.requestCount = 999;
  g.gate.getState().before.requestCount = 888;
  await g.gate.request('/responses', body()); assert.equal(g.sends(), 1);
  assert.equal(g.gate.getState().before.requestCount, 62);
});

test('QP5 settlement callbacks cannot conceal unexpected ledger activity before later requests', async () => {
  let ledger; let changed = false;
  const f = fixture({ persist: async (name, value) => {
    f.events.push({ name, value });
    if (name.includes('settled')) { changed = true; ledger.reservedMicroUsd++; }
  } }); ledger = f.ledger;
  await assert.rejects(f.gate.request('/responses', body())); assert.equal(changed, true);
  await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.sends(), 1);
});

test('QP5 throwing signal accessor latches attempt and cannot bypass later no-retry boundary', async () => {
  const f = fixture(); const options = {};
  Object.defineProperty(options, 'signal', { get() { throw new Error('synthetic-private-accessor'); } });
  await assert.rejects(Promise.resolve().then(() => f.gate.request('/responses', body(), options)));
  await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.sends(), 0);
  assert.ok(!JSON.stringify(f.events).includes('synthetic-private-accessor'));
});

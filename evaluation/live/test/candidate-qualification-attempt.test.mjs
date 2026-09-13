import assert from 'node:assert/strict';
import test from 'node:test';
import { createCandidateQualificationAttempt, createQualificationPilotAttempt,
  CANDIDATE_QUALIFICATION_LIMITS, QUALIFICATION_PILOT_LIMITS } from '../qualification-pilot-attempt.mjs';
const body = (method = 'qualifyCandidates') => JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14', text: { format: { name: `cairn_${method}` } } });
function fixture(overrides = {}, create = createCandidateQualificationAttempt) {
  const ledger = { state: 'open', requestCount: 5, reservedMicroUsd: 25000, limitMicroUsd: 50000000, requestCap: 1000, attempts: [] };
  const events = []; let sends = 0; let active = 0; let maxActive = 0;
  const config = { readState: () => structuredClone(ledger), expectedCheckpoint: { requestCount: 5, reservedMicroUsd: 25000 },
    checkPins: () => {}, persist: (name, value) => events.push({ name, value }), send: async () => {
      sends++; active++; maxActive = Math.max(active, maxActive); assert.match(events.at(-1).name, /reserved/);
      await Promise.resolve(); ledger.requestCount++; ledger.reservedMicroUsd += 5000; active--; return Response.json({});
    }, ...overrides };
  return { gate: create(config), config, ledger, events, sends: () => sends, maxActive: () => maxActive };
}
test('CA1 candidate controller exact36/$0.18 caps remain separate from old100/$1 factory', async () => {
  assert.deepEqual(CANDIDATE_QUALIFICATION_LIMITS, { requests: 36, microUsd: 180000, reservationMicroUsd: 5000 });
  assert.deepEqual(QUALIFICATION_PILOT_LIMITS, { requests: 100, microUsd: 1000000, reservationMicroUsd: 5000 });
  const f = fixture(); await Promise.all(Array.from({ length: 36 }, (_, i) => f.gate.request(i % 2 ? '/responses' : '/responses/input_tokens', body())));
  assert.equal(f.sends(), 36); assert.equal(f.maxActive(), 1); assert.equal(f.gate.getState().reservedMicroUsd, 180000);
  await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.sends(), 36);
  const legacy = fixture({}, createQualificationPilotAttempt); await assert.rejects(legacy.gate.request('/responses', body())); assert.equal(legacy.sends(), 0);
  const candidate = fixture(); await assert.rejects(candidate.gate.request('/responses', body('qualify'))); assert.equal(candidate.sends(), 0);
});
test('CA2 exact options and headroom cannot be altered through caller-supplied limits or stale checkpoints', () => {
  const f = fixture(); assert.throws(() => createCandidateQualificationAttempt({ ...f.config, limits: { requests: 100 } }));
  for (const patch of [{ requestCap: 40 }, { limitMicroUsd: 204999 }, { state: 'closed' }, { attempts: [{ outcome: null }] },
    { requestCount: 6 }]) assert.throws(() => createCandidateQualificationAttempt({ ...f.config, readState: () => ({ ...f.ledger, ...patch }) }));
  assert.throws(() => createCandidateQualificationAttempt({ ...f.config, expectedCheckpoint: { requestCount: 5, reservedMicroUsd: 25000, extra: true } }));
});
test('CA3 accessor pin and persistence tampering halt permanently before any send', async () => {
  for (const mode of ['accessor', 'pin', 'persistence', 'checkpoint']) {
    let ledger; const f = fixture({ checkPins: () => { if (mode === 'pin') throw new Error('synthetic-secret'); },
      persist: () => { if (mode === 'persistence') throw new Error('synthetic-secret'); if (mode === 'checkpoint') ledger.requestCount++; } }); ledger = f.ledger;
    const options = {}; if (mode === 'accessor') Object.defineProperty(options, 'signal', { get() { throw new Error('synthetic-secret'); } });
    await assert.rejects(f.gate.request('/responses', body(), options));
    await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.sends(), 0);
    assert.ok(!JSON.stringify(f.events).includes('synthetic-secret'));
  }
});
test('CA4 queued late failure drains and read-only/stop cannot resume model requests', async () => {
  let ready; let release; let sends = 0; const entered = new Promise((resolve) => { ready = resolve; });
  const f = fixture({ send: () => { sends++; ready(); return new Promise((_, reject) => { release = reject; }); } });
  const pending = Promise.allSettled([f.gate.request('/responses', body()), f.gate.request('/responses', body())]); await entered;
  release(new Error('synthetic-secret')); await pending; await f.gate.drain(); assert.equal(sends, 1);
  await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.gate.getState().reservedMicroUsd, 5000);
  const read = fixture(); read.gate.beginReadOnly(); await assert.rejects(read.gate.request('/responses', body()));
  assert.throws(() => read.gate.endReadOnly()); assert.equal(read.sends(), 0);
  const stop = fixture(); stop.gate.stop(); await assert.rejects(stop.gate.request('/responses', body())); assert.equal(stop.sends(), 0);
});

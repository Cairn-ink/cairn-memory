import assert from 'node:assert/strict';
import test from 'node:test';
import { createRationaleAttempt, RATIONALE_LIMITS, createCandidateQualificationAttempt,
  createQualificationPilotAttempt, createSourceSupportAttempt, CANDIDATE_QUALIFICATION_LIMITS, QUALIFICATION_PILOT_LIMITS } from '../qualification-pilot-attempt.mjs';
const body = (method = 'rank') => JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14', text: { format: { name: `cairn_${method}` } } });
function fixture(overrides = {}, factory = createRationaleAttempt) {
  const ledger = { state: 'open', requestCount: 5, reservedMicroUsd: 25000, limitMicroUsd: 50000000, requestCap: 1000, attempts: [] };
  const events = []; let sends = 0; let active = 0; let peak = 0;
  const config = { readState: () => structuredClone(ledger), expectedCheckpoint: { requestCount: 5, reservedMicroUsd: 25000 },
    checkPins: () => {}, persist: (name, value) => events.push({ name, value }), send: async () => {
      sends++; active++; peak = Math.max(active, peak); assert.match(events.at(-1).name, /reserved/);
      await Promise.resolve(); ledger.requestCount++; ledger.reservedMicroUsd += 5000; active--; return Response.json({});
    }, ...overrides };
  return { gate: factory(config), config, ledger, events, sends: () => sends, peak: () => peak };
}
test('RA1 closed 384/$1.92 ceiling serializes mixed count/generation requests before permanently rejecting 385', async () => {
  assert.deepEqual(RATIONALE_LIMITS, { requests: 384, microUsd: 1920000, reservationMicroUsd: 5000 });
  const f = fixture(); const methods = ['extract', 'qualifyCandidates', 'classify', 'select', 'rank', 'relate'];
  await Promise.all(Array.from({ length: 384 }, (_, i) => f.gate.request(i % 2 ? '/responses' : '/responses/input_tokens', body(methods[i % 6]))));
  assert.equal(f.sends(), 384); assert.equal(f.peak(), 1); assert.equal(f.gate.getState().reservedMicroUsd, 1920000);
  await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.sends(), 384); assert.ok(f.gate.getState().halted);
});
test('RA2 older factories retain caps and reject select/rank; new factory rejects unrelated methods/models', async () => {
  assert.deepEqual(CANDIDATE_QUALIFICATION_LIMITS, { requests: 36, microUsd: 180000, reservationMicroUsd: 5000 });
  assert.deepEqual(QUALIFICATION_PILOT_LIMITS, { requests: 100, microUsd: 1000000, reservationMicroUsd: 5000 });
  for (const factory of [createCandidateQualificationAttempt, createQualificationPilotAttempt]) for (const method of ['select', 'rank']) {
    const f = fixture({}, factory); await assert.rejects(f.gate.request('/responses', body(method))); assert.equal(f.sends(), 0);
  }
  const old = fixture({}, createSourceSupportAttempt); await assert.rejects(old.gate.request('/responses', body('relate'))); assert.equal(old.sends(), 0);
  for (const value of [body('qualify'), body('reconcile'), body('judge'), body().replace('gpt-4.1-mini-2025-04-14', 'other-model')]) {
    const f = fixture(); await assert.rejects(f.gate.request('/responses', value)); assert.equal(f.sends(), 0);
  }
});
test('RA3 exact options/checkpoint and conservative headroom cannot be widened by callers', () => {
  const f = fixture();
  for (const extra of [{ limits: { requests: 1000 } }, { methods: ['judge'] }]) assert.throws(() => createRationaleAttempt({ ...f.config, ...extra }));
  for (const patch of [{ requestCap: 100 }, { limitMicroUsd: 504999 }, { state: 'closed' }, { requestCount: 6 },
    { attempts: [{ outcome: null }] }]) assert.throws(() => createRationaleAttempt({ ...f.config, readState: () => ({ ...f.ledger, ...patch }) }));
  assert.throws(() => createRationaleAttempt({ ...f.config, expectedCheckpoint: { ...f.config.expectedCheckpoint, extra: true } }));
});
test('RA4 pin/persistence/accessor/accounting/unsettled failures halt permanently with no sends', async () => {
  for (const mode of ['pin', 'persistence', 'accessor', 'drift', 'unsettled']) {
    let ledger; const f = fixture({ checkPins: () => { if (mode === 'pin') throw new Error('synthetic-private'); }, persist: () => {
      if (mode === 'persistence') throw new Error('synthetic-private');
      if (mode === 'drift') ledger.requestCount++; if (mode === 'unsettled') ledger.attempts = [{ outcome: null }];
    } }); ledger = f.ledger;
    const options = {}; if (mode === 'accessor') Object.defineProperty(options, 'signal', { get() { throw new Error('synthetic-private'); } });
    await assert.rejects(f.gate.request('/responses', body(), options)); await assert.rejects(f.gate.request('/responses', body()));
    assert.equal(f.sends(), 0); assert.ok(f.gate.getState().halted); assert.ok(!JSON.stringify(f.gate.getState()).includes('synthetic-private'));
  }
});
test('RA5 failed late transport halts queued requests without refund, readonly violation never resumes', async () => {
  let ready; let release; let sends = 0; const entered = new Promise(resolve => { ready = resolve; });
  const f = fixture({ send: () => { sends++; ready(); return new Promise((_, reject) => { release = reject; }); } });
  const pending = Promise.allSettled([f.gate.request('/responses', body()), f.gate.request('/responses', body())]); await entered;
  release(new Error('synthetic-private')); await pending; await f.gate.drain(); assert.equal(sends, 1);
  assert.equal(f.gate.getState().reservedMicroUsd, 5000); await assert.rejects(f.gate.request('/responses', body()));
  const read = fixture(); read.gate.beginReadOnly(); await assert.rejects(read.gate.request('/responses', body()));
  assert.throws(() => read.gate.endReadOnly()); assert.equal(read.sends(), 0);
});

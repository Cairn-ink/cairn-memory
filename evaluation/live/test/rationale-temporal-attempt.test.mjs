import assert from 'node:assert/strict';
import test from 'node:test';
import { createTemporalComparisonAttempt, TEMPORAL_COMPARISON_LIMITS,
  createRationaleCorrectionAttempt } from '../qualification-pilot-attempt.mjs';

const model = 'gpt-4.1-mini-2025-04-14';
const body = (chosen = model, method = 'cairn_relate') => JSON.stringify({ model: chosen,
  text: { format: { name: method } } });

function fixture(changes = {}) {
  const state = { state: 'open', requestCount: 20, reservedMicroUsd: 100000,
    limitMicroUsd: 50_000_000, requestCap: 5000, attempts: [] };
  const events = []; let sends = 0, active = 0, peak = 0;
  const options = { expectedCheckpoint: { requestCount: 20, reservedMicroUsd: 100000 },
    readState: () => structuredClone(state), checkPins: () => {},
    persist: (name, value) => { events.push({ name, value }); },
    send: async () => { sends++; active++; peak = Math.max(peak, active);
      await Promise.resolve(); state.requestCount++; state.reservedMicroUsd += 5000;
      active--; return Response.json({}); }, ...changes };
  return { options, state, events, sends: () => sends, peak: () => peak,
    gate: createTemporalComparisonAttempt(options) };
}

test('TP1 independent 24-call/120000 cap is serialized and correction cap remains six', async () => {
  assert.deepEqual(TEMPORAL_COMPARISON_LIMITS,
    { requests: 24, microUsd: 120000, reservationMicroUsd: 5000 });
  const f = fixture();
  await Promise.all(Array.from({ length: 24 }, (_, index) => f.gate.request(
    index % 2 ? '/responses' : '/responses/input_tokens', body())));
  assert.equal(f.sends(), 24); assert.equal(f.peak(), 1);
  assert.equal(f.gate.getState().reservedMicroUsd, 120000);
  assert.equal(f.state.requestCount, 44); assert.equal(f.state.reservedMicroUsd, 220000);
  assert.equal(f.events.filter(item => item.name.endsWith('-reserved')).length, 24);
  await assert.rejects(f.gate.request('/responses', body()), /attempt_limit/u);
  assert.equal(f.sends(), 24);
  const old = fixture();
  const correction = createRationaleCorrectionAttempt(old.options);
  for (let index = 0; index < 6; index++) await correction.request('/responses', body());
  await assert.rejects(correction.request('/responses', body()), /attempt_limit/u);
});

test('TP1 wrong model, method, route and bad payload latch before dispatch', async () => {
  for (const [route, encoded] of [['/responses', body('gpt-5.6-luna')],
    ['/responses', body('gpt-4.1-mini')], ['/responses', body(model, 'cairn_extract')],
    ['/responses', body(model, 'cairn_reviewBasis')], ['/other', body()], ['/responses', '{broken']]) {
    const f = fixture();
    await assert.rejects(f.gate.request(route, encoded), /request_rejected/u);
    await assert.rejects(f.gate.request('/responses', body()), /request_rejected/u);
    assert.equal(f.sends(), 0);
  }
});

test('TP1 full settled headroom and exact checkpoint are mandatory', () => {
  const f = fixture();
  for (const patch of [{ requestCap: 43 }, { limitMicroUsd: 219999 }, { state: 'closed' },
    { requestCount: 21 }, { reservedMicroUsd: 100001 }, { attempts: [{ outcome: null }] }]) {
    assert.throws(() => createTemporalComparisonAttempt({ ...f.options,
      readState: () => ({ ...f.state, ...patch }) }), /insufficient_budget/u);
  }
});

test('TP1 pin, persistence, accounting and transport failure halt concurrent work', async () => {
  for (const mode of ['pin', 'persist', 'accounting', 'transport']) {
    let f; let sends = 0;
    f = fixture({ checkPins: () => { if (mode === 'pin') throw new Error('pin'); },
      persist: name => { if (mode === 'persist' && name.endsWith('-reserved')) throw new Error('disk'); },
      send: async () => { sends++; if (mode === 'transport') throw new Error('transport');
        f.state.requestCount++; f.state.reservedMicroUsd += mode === 'accounting' ? 1 : 5000;
        return Response.json({}); } });
    const result = await Promise.allSettled([f.gate.request('/responses/input_tokens', body()),
      f.gate.request('/responses', body())]);
    assert.ok(result.every(item => item.status === 'rejected'), mode);
    assert.equal(sends, ['pin', 'persist'].includes(mode) ? 0 : 1, mode);
    assert.ok(f.gate.getState().halted);
  }
});

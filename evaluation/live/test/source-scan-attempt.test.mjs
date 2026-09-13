import assert from 'node:assert/strict';
import test from 'node:test';
import { createSourceScanAttempt, SOURCE_SCAN_LIMITS } from '../qualification-pilot-attempt.mjs';
const body = (method = 'rank') => JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14', text: { format: { name: `cairn_${method}` } } });
function fixture(patch = {}) {
  const state = { state: 'open', requestCount: 1, reservedMicroUsd: 5000, limitMicroUsd: 50000000, requestCap: 5000, attempts: [] };
  let sends = 0;
  const options = { readState: () => structuredClone(state), expectedCheckpoint: { requestCount: 1, reservedMicroUsd: 5000 },
    checkPins: () => {}, persist: () => {}, send: async () => { sends++; state.requestCount++; state.reservedMicroUsd += 5000; return Response.json({}); }, ...patch };
  return { gate: createSourceScanAttempt(options), state, options, sends: () => sends };
}
test('SA1 sixty-four HTTP reservations are a fixed cap, including token count requests', async () => {
  assert.deepEqual(SOURCE_SCAN_LIMITS, { requests: 64, microUsd: 320000, reservationMicroUsd: 5000 });
  const f = fixture();
  for (let i = 0; i < 64; i++) await f.gate.request(i % 2 ? '/responses' : '/responses/input_tokens', body(i % 2 ? 'rank' : 'select'));
  await assert.rejects(f.gate.request('/responses', body())); assert.equal(f.sends(), 64);
  assert.equal(f.gate.getState().reservedMicroUsd, 320000);
});
test('SA2 no capture, rationale, qualification, host, model substitution or widened caller limits', async () => {
  for (const method of ['extract', 'classify', 'relate', 'qualifyCandidates', 'reconcile', 'judge']) {
    const f = fixture(); await assert.rejects(f.gate.request('/responses', body(method))); assert.equal(f.sends(), 0);
  }
  const f = fixture(); assert.throws(() => createSourceScanAttempt({ ...f.options, limits: { requests: 1000 } }));
  await assert.rejects(f.gate.request('/chat/completions', body())); assert.equal(f.sends(), 0);
  const other = fixture(); await assert.rejects(other.gate.request('/responses', body().replace('gpt-4.1-mini-2025-04-14', 'other')));
  assert.equal(other.sends(), 0);
});
test('SA3 stale checkpoint, inadequate budget, pin or transport failures stop without retry', async () => {
  const f = fixture();
  for (const patch of [{ requestCount: 2 }, { reservedMicroUsd: 0 }, { limitMicroUsd: 324999 }, { requestCap: 64 },
    { attempts: [{ outcome: null }] }]) assert.throws(() => createSourceScanAttempt({ ...f.options, readState: () => ({ ...f.state, ...patch }) }));
  let sends = 0;
  const pin = fixture({ checkPins: () => { throw new Error('synthetic-secret'); } });
  await assert.rejects(pin.gate.request('/responses', body())); assert.equal(pin.sends(), 0);
  const transport = fixture({ send: async () => { sends++; throw new Error('synthetic-secret'); } });
  await assert.rejects(transport.gate.request('/responses', body()));
  await assert.rejects(transport.gate.request('/responses', body())); assert.equal(sends, 1);
  assert.equal(transport.gate.getState().reservedMicroUsd, 5000);
  assert.equal(JSON.stringify(transport.gate.getState()).includes('synthetic-secret'), false);
});

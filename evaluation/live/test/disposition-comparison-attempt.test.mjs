import assert from 'node:assert/strict';
import test from 'node:test';
import { createDispositionComparisonAttempt, DISPOSITION_COMPARISON_LIMITS,
  createTemporalComparisonAttempt, createBasisComparisonAttempt } from '../qualification-pilot-attempt.mjs';

const body = (method = 'relate', model = 'gpt-4.1-mini-2025-04-14') =>
  JSON.stringify({ model, text: { format: { name: `cairn_${method}` } } });
function fixture(overrides = {}, factory = createDispositionComparisonAttempt) {
  const ledger = { state: 'open', requestCount: 7, reservedMicroUsd: 35_000,
    limitMicroUsd: 50_000_000, requestCap: 5000, attempts: [] };
  const events = [];
  let sends = 0, active = 0, peak = 0;
  const options = { expectedCheckpoint: { requestCount: 7, reservedMicroUsd: 35_000 },
    readState: () => structuredClone(ledger), checkPins: () => {},
    persist: (name, value) => { events.push({ name, value }); },
    send: async () => { sends++; active++; peak = Math.max(peak, active);
      assert.match(events.at(-1).name, /reserved/u);
      await Promise.resolve(); ledger.requestCount++; ledger.reservedMicroUsd += 5000;
      active--; return Response.json({}); }, ...overrides };
  return { gate: factory(options), options, ledger, events, sends: () => sends, peak: () => peak };
}

test('DP4 distinct fixed 24 HTTP / 120000 microUSD attempt cap is serialized and fail-latched', async () => {
  assert.deepEqual(DISPOSITION_COMPARISON_LIMITS,
    { requests: 24, microUsd: 120000, reservationMicroUsd: 5000 });
  const f = fixture();
  await Promise.all(Array.from({ length: 24 }, (_, index) => f.gate.request(
    index % 2 ? '/responses' : '/responses/input_tokens',
    body(index % 2 ? 'reviewRationaleDispositions' : 'relate'))));
  assert.equal(f.sends(), 24); assert.equal(f.peak(), 1);
  assert.equal(f.gate.getState().reservedMicroUsd, 120000);
  assert.equal(f.ledger.requestCount, 31); assert.equal(f.ledger.reservedMicroUsd, 155000);
  await assert.rejects(f.gate.request('/responses', body()), /attempt_limit/u);
  assert.equal(f.sends(), 24); assert.equal(f.gate.getState().halted, 'attempt_limit');
});

test('DP4 exact methods, baseline and full settled cumulative headroom required before send', async () => {
  const initial = fixture();
  for (const [method, model] of [['reviewBasis', 'gpt-4.1-mini-2025-04-14'],
    ['extract', 'gpt-4.1-mini-2025-04-14'], ['reviewRationaleDispositions', 'gpt-5.6-luna']]) {
    const f = fixture();
    await assert.rejects(f.gate.request('/responses', body(method, model)), /request_rejected/u);
    assert.equal(f.sends(), 0);
  }
  for (const patch of [{ requestCap: 30 }, { limitMicroUsd: 154999 }, { limitMicroUsd: 50_000_001 },
    { state: 'closed' }, { requestCount: 8 }, { attempts: [{ outcome: null }] }]) {
    assert.throws(() => createDispositionComparisonAttempt({ ...initial.options,
      readState: () => ({ ...initial.ledger, ...patch }) }), /insufficient_budget/u);
  }
  assert.throws(() => createDispositionComparisonAttempt({ ...initial.options,
    limits: { requests: 1000 } }), /invalid_attempt/u);
  const old = fixture({}, createTemporalComparisonAttempt);
  await assert.rejects(old.gate.request('/responses', body('reviewRationaleDispositions')));
  assert.equal(old.sends(), 0);
  const oldBasis = fixture({}, createBasisComparisonAttempt);
  await assert.rejects(oldBasis.gate.request('/responses', body('reviewRationaleDispositions')));
  assert.equal(oldBasis.sends(), 0);
});

test('DP4 pin, read-only, 429 and accounting interference stop queued work with no retry/refund', async () => {
  const pin = fixture({ checkPins: () => { throw new Error('synthetic-pin'); } });
  await assert.rejects(pin.gate.request('/responses', body()), /guard_pin_or_persistence_failed/u);
  assert.equal(pin.sends(), 0);
  const readOnly = fixture(); readOnly.gate.beginReadOnly();
  await assert.rejects(readOnly.gate.request('/responses', body()), /read_only_request/u);
  assert.equal(readOnly.sends(), 0);
  let sent = 0;
  const failed = fixture({ send: async () => { sent++; failed.ledger.requestCount++;
    failed.ledger.reservedMicroUsd += 5000;
    return new Response('synthetic rate limit', { status: 429 }); } });
  const results = await Promise.allSettled([failed.gate.request('/responses', body()),
    failed.gate.request('/responses/input_tokens', body('reviewRationaleDispositions'))]);
  assert.ok(results.every(item => item.status === 'rejected'));
  assert.equal(sent, 1); assert.equal(failed.ledger.reservedMicroUsd, 40_000);
  assert.equal(failed.gate.getState().requests, 1);
  assert.equal(failed.gate.getState().halted, 'transport_failed');
  let mismatched;
  const race = fixture({ send: async () => { mismatched.ledger.requestCount += 2;
    mismatched.ledger.reservedMicroUsd += 10_000; return Response.json({}); } });
  mismatched = race;
  await assert.rejects(race.gate.request('/responses', body()), /unexpected_accounting/u);
  assert.equal(race.gate.getState().halted, 'unexpected_accounting');
});

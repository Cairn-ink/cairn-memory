import assert from 'node:assert/strict';
import test from 'node:test';
import { createRationaleModelAttempt, createBasisComparisonAttempt, createRationaleAttempt, RATIONALE_MODEL_LIMITS } from '../qualification-pilot-attempt.mjs';
const rates = { 'gpt-4.1-mini-2025-04-14': 5000, 'gpt-5.6-luna': 3000, 'gpt-5.6-sol': 56000 };
const body = (model, method = 'relate') => JSON.stringify({ model, text: { format: { name: `cairn_${method}` } } });
function fixture(overrides = {}, factory = createRationaleModelAttempt) {
  const ledger = { state: 'open', requestCount: 5, reservedMicroUsd: 25000,
    limitMicroUsd: 50000000, requestCap: 5000, attempts: [] };
  let sends = 0, active = 0, peak = 0; const events = [];
  const config = { readState: () => structuredClone(ledger), expectedCheckpoint: { requestCount: 5, reservedMicroUsd: 25000 },
    checkPins: () => {}, persist: (name, value) => events.push({ name, value }),
    send: async (_, encoded) => {
      sends++; active++; peak = Math.max(peak, active); assert.match(events.at(-1).name, /reserved/);
      await Promise.resolve(); ledger.requestCount++; ledger.reservedMicroUsd += rates[JSON.parse(encoded).model];
      active--; return Response.json({});
    }, ...overrides };
  return { gate: factory(config), config, ledger, events, sends: () => sends, peak: () => peak };
}
for (const factory of [createRationaleModelAttempt, createBasisComparisonAttempt]) {
test(`${factory.name}: RMA1 balanced 96 HTTP reaches exact $2.048 cap serially and rejects attempt 97`, async () => {
  assert.deepEqual(RATIONALE_MODEL_LIMITS, { requests: 96, microUsd: 2048000 });
  const f = fixture({}, factory); const models = Object.keys(rates);
  await Promise.all(Array.from({ length: 96 }, (_, i) => f.gate.request(
    i % 2 ? '/responses' : '/responses/input_tokens', body(models[i % 3],
      factory === createBasisComparisonAttempt && i % 2 ? 'reviewBasis' : 'relate'))));
  assert.equal(f.sends(), 96); assert.equal(f.peak(), 1);
  assert.equal(f.gate.getState().reservedMicroUsd, 2048000);
  assert.equal(f.ledger.reservedMicroUsd, 2073000);
  await assert.rejects(f.gate.request('/responses', body(models[0])));
  assert.equal(f.sends(), 96); assert.ok(f.gate.getState().halted);
});
test(`${factory.name}: RMA2 expensive-model skew hits monetary cap before request cap; old factory still rejects alternatives`, async () => {
  const f = fixture({}, factory);
  for (let i = 0; i < 36; i++) await f.gate.request('/responses', body('gpt-5.6-sol'));
  await assert.rejects(f.gate.request('/responses', body('gpt-5.6-sol')));
  assert.equal(f.sends(), 36); assert.equal(f.gate.getState().reservedMicroUsd, 2016000);
  for (const model of ['gpt-5.6-luna', 'gpt-5.6-sol']) {
    const old = fixture({}, createRationaleAttempt);
    await assert.rejects(old.gate.request('/responses', body(model))); assert.equal(old.sends(), 0);
  }
  for (const encoded of [body('gpt-5.6'), body('gpt-5.6-sol', 'extract'), body('gpt-5.6-luna', 'rank')]) {
    const denied = fixture({}, factory); await assert.rejects(denied.gate.request('/responses', encoded)); assert.equal(denied.sends(), 0);
  }
});
test(`${factory.name}: RMA3 full headroom and immutable configuration required before an attempt`, () => {
  const f = fixture({}, factory);
  for (const patch of [{ requestCap: 100 }, { limitMicroUsd: 2072999 }, { state: 'closed' },
    { requestCount: 6 }, { attempts: [{ outcome: null }] }]) {
    assert.throws(() => factory({ ...f.config, readState: () => ({ ...f.ledger, ...patch }) }));
  }
  assert.throws(() => factory({ ...f.config, limits: { requests: 10000 } }));
});
test(`${factory.name}: RMA4 accounting mismatch and interrupted send halt all queued work without retry or refund`, async () => {
  for (const mode of ['transport', 'wrong-price']) {
    let ledger; let sends = 0;
    const f = fixture({ send: async () => {
      sends++; if (mode === 'transport') throw new Error('private-synthetic');
      ledger.requestCount++; ledger.reservedMicroUsd += 5000; return Response.json({});
    } }, factory); ledger = f.ledger;
    const result = await Promise.allSettled([f.gate.request('/responses', body('gpt-5.6-sol')),
      f.gate.request('/responses', body('gpt-5.6-luna'))]);
    assert.ok(result.every(item => item.status === 'rejected')); assert.equal(sends, 1);
    assert.equal(f.gate.getState().reservedMicroUsd, 56000); assert.ok(f.gate.getState().halted);
    assert.ok(!JSON.stringify(f.gate.getState()).includes('private-synthetic'));
  }
});
}
test('BMA5 new comparison denies read-only, failed pins/persistence; old model attempt denies basis', async () => {
  for (const overrides of [{ checkPins: () => { throw new Error('pin'); } },
    { persist: () => { throw new Error('disk'); } }]) {
    const f = fixture(overrides, createBasisComparisonAttempt);
    await assert.rejects(f.gate.request('/responses', body('gpt-5.6-sol', 'reviewBasis')));
    assert.equal(f.sends(), 0); assert.ok(f.gate.getState().halted);
  }
  const f = fixture({}, createBasisComparisonAttempt); f.gate.beginReadOnly();
  await assert.rejects(f.gate.request('/responses', body('gpt-5.6-sol', 'reviewBasis')));
  assert.equal(f.sends(), 0);
  for (const model of Object.keys(rates)) {
    const old = fixture();
    await assert.rejects(old.gate.request('/responses', body(model, 'reviewBasis')));
    assert.equal(old.sends(), 0);
  }
});

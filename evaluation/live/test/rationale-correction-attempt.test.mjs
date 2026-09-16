import assert from 'node:assert/strict';
import test from 'node:test';
import { createRationaleCorrectionAttempt, RATIONALE_CORRECTION_LIMITS } from '../qualification-pilot-attempt.mjs';

const model = 'gpt-4.1-mini-2025-04-14';
const body = (chosen = model, method = 'cairn_relate') => JSON.stringify({ model: chosen,
  text: { format: { name: method } } });

function fixture(overrides = {}) {
  const ledger = { state: 'open', requestCount: 10, reservedMicroUsd: 50000,
    limitMicroUsd: 50_000_000, requestCap: 5000, attempts: [] };
  const events = []; let sends = 0, active = 0, peak = 0;
  let pinsValid = true;
  const options = { readState: () => structuredClone(ledger),
    expectedCheckpoint: { requestCount: 10, reservedMicroUsd: 50000 },
    checkPins: () => { if (!pinsValid) throw new Error('pin changed'); },
    persist: (name, value) => { events.push({ name, value }); },
    send: async () => {
      sends++; active++; peak = Math.max(peak, active);
      assert.match(events.at(-1).name, /reserved$/);
      await Promise.resolve();
      ledger.requestCount++; ledger.reservedMicroUsd += 5000;
      active--; return Response.json({});
    }, ...overrides };
  return { gate: createRationaleCorrectionAttempt(options), options, ledger, events,
    sends: () => sends, peak: () => peak, breakPins: () => { pinsValid = false; } };
}

test('CP1 closed six-request baseline cap serializes concurrent sends and rejects seven', async () => {
  assert.deepEqual(RATIONALE_CORRECTION_LIMITS,
    { requests: 6, microUsd: 30000, reservationMicroUsd: 5000 });
  const f = fixture();
  await Promise.all(Array.from({ length: 6 }, (_, index) => f.gate.request(
    index % 2 ? '/responses' : '/responses/input_tokens', body())));
  assert.equal(f.sends(), 6); assert.equal(f.peak(), 1);
  assert.equal(f.gate.getState().requests, 6);
  assert.equal(f.gate.getState().reservedMicroUsd, 30000);
  assert.equal(f.ledger.requestCount, 16); assert.equal(f.ledger.reservedMicroUsd, 80000);
  assert.equal(f.events.filter(event => event.name.endsWith('-reserved')).length, 6);
  await assert.rejects(f.gate.request('/responses', body()), /attempt_limit/);
  assert.equal(f.sends(), 6); assert.equal(f.gate.getState().halted, 'attempt_limit');
});

test('CP1 rejects other models, methods and routes before any send and latches stop', async () => {
  for (const [path, encoded] of [['/responses', body('gpt-5.6-luna')],
    ['/responses', body('gpt-5.6-sol')], ['/responses', body('gpt-4.1-mini')],
    ['/responses', body(model, 'cairn_extract')], ['/responses', body(model, 'cairn_reviewBasis')],
    ['/other', body()], ['/responses', '{broken']]) {
    const f = fixture();
    await assert.rejects(f.gate.request(path, encoded), /request_rejected/);
    await assert.rejects(f.gate.request('/responses', body()), /request_rejected/);
    assert.equal(f.sends(), 0); assert.equal(f.gate.getState().reservedMicroUsd, 0);
  }
});

test('CP1 requires full fixed headroom and exact settled checkpoint at construction', () => {
  const f = fixture();
  for (const patch of [{ requestCap: 15 }, { limitMicroUsd: 79999 }, { state: 'closed' },
    { requestCount: 11 }, { reservedMicroUsd: 50001 }, { attempts: [{ outcome: null }] }]) {
    assert.throws(() => createRationaleCorrectionAttempt({ ...f.options,
      readState: () => ({ ...f.ledger, ...patch }) }), /insufficient_budget/);
  }
  assert.throws(() => createRationaleCorrectionAttempt({ ...f.options, limits: {} }), /invalid_attempt/);
});

test('CP1 pin, accounting, persistence and transport failures consume or block reservations without retry', async () => {
  for (const mode of ['pre-pin', 'post-pin', 'accounting', 'persist', 'transport']) {
    let f; let sends = 0;
    const overrides = {
      checkPins: () => { if (mode === 'pre-pin' || (mode === 'post-pin' && sends)) throw new Error('pin'); },
      persist: name => { if (mode === 'persist' && name.endsWith('-reserved')) throw new Error('disk'); },
      send: async () => {
        sends++;
        if (mode === 'transport') throw new Error('synthetic transport');
        f.ledger.requestCount++;
        f.ledger.reservedMicroUsd += mode === 'accounting' ? 1 : 5000;
        return Response.json({});
      },
    };
    f = fixture(overrides);
    const settled = await Promise.allSettled([f.gate.request('/responses', body()),
      f.gate.request('/responses', body())]);
    assert.ok(settled.every(item => item.status === 'rejected'), mode);
    assert.equal(sends, mode === 'pre-pin' || mode === 'persist' ? 0 : 1, mode);
    assert.ok(f.gate.getState().halted, mode);
    assert.equal(f.gate.getState().reservedMicroUsd, mode === 'pre-pin' ? 0 : 5000, mode);
    await assert.rejects(f.gate.request('/responses', body()));
    assert.equal(sends, mode === 'pre-pin' || mode === 'persist' ? 0 : 1, mode);
  }
});

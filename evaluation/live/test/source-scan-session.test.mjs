import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createSourceScanSession } from '../source-scan-session.mjs';
import { createLiveSession } from '../session.mjs';

test('SC1 narrow phase session rejects extra methods/routes before transport and older session caps stay closed', t => {
  const ledger = { directory: join(mkdtempSync(join(tmpdir(), 'cairn-scan-session-')), 'ledger'),
    runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 5000 };
  createExperimentBudget(ledger).close();
  let calls = 0;
  const options = { ledger, apiKey: 'synthetic-key', fetchImpl: () => { calls++; assert.fail('No HTTP'); } };
  assert.throws(() => createLiveSession(options));
  for (const patch of [{ apiKey: '' }, { ledger: { ...ledger, limitMicroUsd: 50000001 } },
    { ledger: { ...ledger, requestCap: 5001 } }, { fetchImpl: null }]) assert.throws(() => createSourceScanSession({ ...options, ...patch }));
  const session = createSourceScanSession(options); t.after(() => session.close());
  for (const name of ['cairn_extract', 'cairn_relate', 'cairn_qualifyCandidates', 'cairn_classify']) {
    assert.throws(() => session.request('/responses', JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14', text: { format: { name } } })));
  }
  assert.throws(() => session.request('/chat/completions', '{}'));
  assert.throws(() => session.request('/responses', '{'));
  assert.equal(calls, 0); assert.equal(session.getState().requestCount, 0);
});

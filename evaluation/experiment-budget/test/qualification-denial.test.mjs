import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DEFAULT_MODEL } from '../../../adapters/openai/profiles.mjs';
import { schemas, schemasFor } from '../../../adapters/openai/schemas.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import * as guards from '../request-guard.mjs';

// Fake transport and disposable synthetic ledger: no provider key or paid call.
test('AQ5 all existing paid guards deny qualify count and generation before transport or reservation', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-qualify-denial-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 100000, requestCap: 100 };
  createExperimentBudget(ledger).close();
  const price = { microUsdNumerator: 1, tokenDenominator: 1000 };
  const channel = (endpoint, patch = {}) => ({ endpoint, model: DEFAULT_MODEL, reservedMicroUsd: 20,
    maxRequestBytes: 131072, maxResponseBytes: 131072, timeoutMs: 5000,
    maxInputTokens: 7024, maxOutputTokens: 1024, inputTokenFraming: 1024,
    inputPrice: { ...price }, outputPrice: { ...price }, ...patch });
  const policy = { version: 1,
    hostCompletion: channel('https://api.openai.com/v1/chat/completions', { reservedMicroUsd: 12,
      maxInputTokens: 10000, inputTokenFraming: 128 }),
    cairnCount: channel('https://api.openai.com/v1/responses/input_tokens', { reservedMicroUsd: 5, maxOutputTokens: 0 }),
    cairnGeneration: channel('https://api.openai.com/v1/responses') };
  let sends = 0;
  const fetchImpl = async () => { sends++; assert.fail('qualification has no paid capability'); };
  guards.createExperimentRequestGuard({ ledger, policy, fetchImpl }).close();
  const extension = guards.authorizeExtractionModelExtension({ ledger, policy, authorizationId: 'synthetic-extraction' });
  const reconciliationExtension = guards.authorizeReconciliationExtension({ ledger, policy, extension,
    authorizationId: 'synthetic-reconcile' });
  assert.equal(Object.hasOwn(schemas, 'qualify'), false);
  const input = { items: [{ itemIndex: 0, content: 'Synthetic choice', kind: 'decision',
    sources: [{ receiptIndex: 0, role: 'user', excerpt: 'Synthetic choice' }] }] };
  for (const create of [
    () => guards.createExperimentRequestGuard({ ledger, policy, fetchImpl }),
    () => guards.createExtendedExperimentRequestGuard({ ledger, policy, extension, fetchImpl }),
    () => guards.createReconciliationExperimentRequestGuard({ ledger, policy, extension, reconciliationExtension, fetchImpl }),
  ]) {
    const guard = create();
    try {
      for (const generation of [false, true]) {
        const body = { model: DEFAULT_MODEL, instructions: 'Synthetic instructions.',
          input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
          truncation: 'disabled', text: { format: { name: 'cairn_qualify', type: 'json_schema', strict: true,
            schema: schemasFor('qualify', input) } },
          ...(generation ? { max_output_tokens: 1024, store: false, stream: false } : {}) };
        await assert.rejects(guard.cairnFetch(generation ? policy.cairnGeneration.endpoint : policy.cairnCount.endpoint,
          { method: 'POST', redirect: 'error', signal: new AbortController().signal,
            headers: { Authorization: 'Bearer synthetic-denied', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        (error) => error instanceof guards.ExperimentRequestGuardError && error.code === 'unsupported_request');
      }
    } finally { guard.close(); }
  }
  assert.equal(sends, 0);
  const handle = reopenExperimentBudget(ledger);
  try { assert.equal(handle.getState().requestCount, 0); assert.equal(handle.getState().reservedMicroUsd, 0); }
  finally { handle.close(); }
});

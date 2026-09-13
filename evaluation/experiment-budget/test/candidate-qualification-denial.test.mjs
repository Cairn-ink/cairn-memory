import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { schemas, schemasFor } from '../../../adapters/openai/schemas.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import { experimentPolicy, MODEL_ID } from '../../live/session.mjs';
import * as guards from '../request-guard.mjs';

test('C6 all four existing paid guards deny candidate qualification before reservation or transport', async () => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-candidate-denial-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 1000 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  const fetchImpl = () => assert.fail('No paid candidate capability');
  guards.createExperimentRequestGuard({ ledger, policy, fetchImpl }).close();
  const extension = guards.authorizeExtractionModelExtension({ ledger, policy, authorizationId: 'synthetic-extraction' });
  const reconciliationExtension = guards.authorizeReconciliationExtension({ ledger, policy, extension, authorizationId: 'synthetic-reconcile' });
  const qualificationExtension = guards.authorizeQualificationExtension({ ledger, policy, authorizationId: 'synthetic-qualification' });
  assert.equal(Object.hasOwn(schemas, 'qualifyCandidates'), false);
  const input = { items: [{ itemIndex: 0, content: 'Synthetic preference', kind: 'preference',
    candidates: [{ candidateIndex: 0, role: 'user', text: 'Synthetic preference' }] }] };
  const factories = [
    () => guards.createExperimentRequestGuard({ ledger, policy, fetchImpl }),
    () => guards.createExtendedExperimentRequestGuard({ ledger, policy, extension, fetchImpl }),
    () => guards.createReconciliationExperimentRequestGuard({ ledger, policy, extension, reconciliationExtension, fetchImpl }),
    () => guards.createQualificationExperimentRequestGuard({ ledger, policy, qualificationExtension, fetchImpl }),
  ];
  for (const create of factories) {
    const guard = create();
    try {
      for (const generation of [false, true]) {
        const body = { model: MODEL_ID, instructions: 'Synthetic source selection.',
          input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
          truncation: 'disabled', text: { format: { name: 'cairn_qualifyCandidates', type: 'json_schema', strict: true,
            schema: schemasFor('qualifyCandidates', input) } },
          ...(generation ? { max_output_tokens: 1024, store: false, stream: false } : {}) };
        await assert.rejects(guard.cairnFetch(generation ? policy.cairnGeneration.endpoint : policy.cairnCount.endpoint,
          { method: 'POST', redirect: 'error', signal: new AbortController().signal,
            headers: { Authorization: 'Bearer synthetic-denied', 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
        error => error instanceof guards.ExperimentRequestGuardError && error.code === 'unsupported_request');
      }
    } finally { guard.close(); }
  }
  const handle = reopenExperimentBudget(ledger);
  try { assert.equal(handle.getState().requestCount, 0); assert.equal(handle.getState().reservedMicroUsd, 0); }
  finally { handle.close(); }
});

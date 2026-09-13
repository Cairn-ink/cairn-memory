import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeRationaleModelsExtension } from '../../experiment-budget/request-guard.mjs';
import { createRationaleModelLiveSession } from '../qualification-session.mjs';
import { experimentPolicy } from '../session.mjs';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
test('RMS1 explicit parent session routes three real adapter profiles through existing durable grant only', async () => {
  const ledger = { directory: join(mkdtempSync(join(tmpdir(), 'cairn-model-session-')), 'ledger'),
    runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 5000 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy(); let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++; const body = JSON.parse(options.body);
    assert.equal(options.headers.get('authorization'), 'Bearer synthetic-parent-only');
    return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 100 } : {
      object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: '{"edges":[]}' }] }],
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    });
  };
  createExperimentRequestGuard({ ledger, policy, fetchImpl }).close();
  const rationaleModelsExtension = authorizeRationaleModelsExtension({ ledger, policy, authorizationId: 'synthetic' });
  const config = { ledger, rationaleModelsExtension, apiKey: 'synthetic-parent-only', fetchImpl };
  for (const patch of [{ rationaleModelsExtension: undefined }, { apiKey: '' }, { fetchImpl: undefined }, { extra: true }]) {
    assert.throws(() => createRationaleModelLiveSession({ ...config, ...patch }));
  }
  const session = createRationaleModelLiveSession(config);
  try {
    for (const rationaleModel of ['gpt-4.1-mini-2025-04-14', 'gpt-5.6-luna', 'gpt-5.6-sol']) {
      const model = createOpenAIModel({ apiKey: 'synthetic-consumer', rationaleModel,
        fetchImpl: (url, options) => session.request(url.endsWith('/input_tokens') ? '/responses/input_tokens'
          : '/responses', options.body, { signal: options.signal }) });
      await model.relate({ system: 'Synthetic.', input: { memories: [{ index: 0,
        receipts: [{ index: 0, role: 'user', excerpt: 'I have not decided.' }] }] },
      maxOutputTokens: 1024, signal: new AbortController().signal });
    }
    assert.equal(calls, 6); assert.equal(session.getState().reservedMicroUsd, 128000);
    for (const [route, body] of [['/chat/completions', {}], ['/responses', { model: 'other' }],
      ['/responses', { model: 'gpt-5.6-sol', text: { format: { name: 'cairn_extract' } } }]]) {
      await assert.rejects(session.request(route, body));
    }
    assert.equal(calls, 6);
  } finally { session.close(); }
});

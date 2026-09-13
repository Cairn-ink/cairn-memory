import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeCandidateQualificationExtension, authorizeQualificationExtension } from '../../experiment-budget/request-guard.mjs';
import { experimentPolicy, MODEL_ID } from '../session.mjs';
import { createSourceSupportLiveSession, createCandidateQualificationLiveSession, createQualificationLiveSession } from '../qualification-session.mjs';
import { schemasFor } from '../../../adapters/openai/schemas.mjs';

function body(method) {
  const input = method === 'qualifyCandidates' ? { items: [{ itemIndex: 0, content: 'Synthetic', kind: 'context',
    candidates: [{ candidateIndex: 0, role: 'user', text: 'Synthetic' }] }] } :
    method === 'extract' ? { messages: [{ index: 0, role: 'user', content: 'Synthetic' }] } :
      method === 'select' ? { maps: [], maxRefs: 1 } : { candidates: [], limit: 1 };
  return { model: MODEL_ID, instructions: 'Synthetic contract test.', truncation: 'disabled',
    input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(input) }] }],
    text: { format: { name: `cairn_${method}`, type: 'json_schema', strict: true, schema: schemasFor(method, input) } } };
}
function fixture(t, provision = true) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-source-support-session-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 1000 };
  createExperimentBudget(ledger).close(); const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No setup HTTP') }).close();
  const candidateQualificationExtension = provision ? authorizeCandidateQualificationExtension({ ledger, policy, authorizationId: 'synthetic' }) : undefined;
  let calls = 0; const options = { ledger, candidateQualificationExtension, apiKey: 'synthetic-parent-key', fetchImpl: async (url, request) => {
    calls++; assert.equal(new Headers(request.headers).get('authorization'), 'Bearer synthetic-parent-key');
    assert.ok(url.endsWith('/input_tokens')); return Response.json({ object: 'response.input_tokens', input_tokens: 10 });
  } };
  return { root, ledger, policy, options, calls: () => calls,
    open: (factory = createSourceSupportLiveSession, config = options) => { const s = factory(config); t.after(() => s.close()); return s; } };
}
test('SS6 source support session reuses immutable candidate capability while allowing capture and recall count routes', async t => {
  const f = fixture(t); const path = join(f.ledger.directory, 'experiment-candidate-qualification-extension.json'); const before = readFileSync(path);
  const session = f.open(); assert.deepEqual(Object.keys(session).sort(), ['close', 'getState', 'request']);
  for (const method of ['extract', 'qualifyCandidates', 'select', 'rank']) await session.request('/responses/input_tokens', body(method));
  assert.equal(f.calls(), 4); assert.equal(session.getState().reservedMicroUsd, 20000); assert.deepEqual(readFileSync(path), before);
});
test('SS7 old sessions deny recall despite new session existing; new session denies unrelated routes and methods without reservation', async t => {
  const f = fixture(t); const session = f.open(); const old = f.open(createCandidateQualificationLiveSession);
  const qualificationExtension = authorizeQualificationExtension({ ledger: f.ledger, policy: f.policy, authorizationId: 'synthetic-v1' });
  const v1 = f.open(createQualificationLiveSession, { ledger: f.ledger, qualificationExtension, apiKey: f.options.apiKey, fetchImpl: f.options.fetchImpl });
  for (const prior of [old, v1]) for (const method of ['select', 'rank']) await assert.rejects(prior.request('/responses/input_tokens', body(method)));
  for (const route of ['/chat/completions', '/responses/extra', 'https://other.test/responses']) await assert.rejects(session.request(route, body('rank')));
  for (const name of ['cairn_qualify', 'cairn_reconcile', 'judge']) { const value = body('rank'); value.text.format.name = name;
    await assert.rejects(session.request('/responses/input_tokens', value)); }
  await assert.rejects(session.request('/responses/input_tokens', { ...body('rank'), model: 'other-model' }));
  assert.equal(f.calls(), 0); assert.equal(session.getState().requestCount, 0);
});
test('SS8 missing/wrong capability and widened configuration never create a grant or discover credentials', t => {
  const f = fixture(t, false); const path = join(f.ledger.directory, 'experiment-candidate-qualification-extension.json');
  assert.throws(() => f.open()); assert.equal(existsSync(path), false);
  const wrong = authorizeQualificationExtension({ ledger: f.ledger, policy: f.policy, authorizationId: 'synthetic-v1' });
  assert.throws(() => f.open(createSourceSupportLiveSession, { ...f.options, candidateQualificationExtension: wrong }));
  for (const patch of [{ methods: ['judge'] }, { limits: { requests: 1000 } }, { apiKey: undefined }, { fetchImpl: undefined }])
    assert.throws(() => f.open(createSourceSupportLiveSession, { ...f.options, ...patch }));
  assert.equal(existsSync(path), false); assert.equal(f.calls(), 0);
});

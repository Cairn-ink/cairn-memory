import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { withWriteObserver } from '../../../integrations/client/private-state.mjs';
import { localLiveness } from '../../../integrations/client/pairing.mjs';
import { captureLocal } from '../capture.mjs';
import { guardedModel } from '../guarded-model.mjs';
import { configuration } from '../configuration.mjs';
import { fixture, ok } from './fixtures/workspace.mjs';

const reply = value => new Response(JSON.stringify(value));
for (const transition of ['revoke', 'aba', 'notice', 'raw-off']) test(`B3 ${transition} between durable dispatch intent and callback is rechecked`, async t => {
  const f = fixture(t, { namespace: { ownerId: 'synthetic-local', scope: 'project', projectId: 'synthetic-project' } });
  let changed = false, calls = 0;
  const outcome = await withWriteObserver(({ path, kind }) => {
    if (changed || kind !== 'write' || !path.endsWith('.json')) return;
    const state = JSON.parse(readFileSync(path, 'utf8'));
    if (!state.reservations?.some(reservation => reservation.started)) return;
    changed = true;
    const set = enabled => {
      const current = ok(f.core.getLocalCaptureControl({ namespace: f.namespace, client: f.client }));
      ok(f.core.setLocalCaptureControl({ namespace: f.namespace, client: f.client, targetId: current.targetId,
        expectedStoreId: current.storeId, expectedRevision: current.revision,
        automaticCaptureEnabled: enabled, rawNoticeVersion: transition === 'notice' ? null : current.rawNoticeVersion }));
    };
    if (transition === 'raw-off') ok(f.core.setRawCaptureControl({ ownerId: f.namespace.ownerId, client: f.client,
      enabled: false, expectedRevision: 0 }));
    else { set(transition === 'notice'); if (transition === 'aba') set(true); }
  }, () => captureLocal(configuration(f.config), f.request(), {
    signal: new AbortController().signal, env: { SYNTHETIC_LOCAL_KEY: 'synthetic' },
    fetchImpl: async (url, options) => {
      calls++;
      if (url.endsWith('/input_tokens')) return reply({ object: 'response.input_tokens', input_tokens: 1 });
      const payload = JSON.parse(options.body);
      return reply({ id: 'resp_synthetic', object: 'response', model: payload.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: '{"items":[]}', annotations: [] }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
    },
  }));
  assert.equal(changed, true);
  assert.equal(calls, ['revoke', 'aba'].includes(transition) ? 0 : 2);
  assert.equal(outcome.status, ['revoke', 'aba'].includes(transition) ? 503 : 200);
  assert.equal(f.ledger().used, 1); assert.deepEqual(f.ledger().reservations, []);
});

test('B3 pure planning never looks up a credential, initializes a ledger or dispatches', t => {
  const f = fixture(t); let lookups = 0;
  const model = guardedModel(configuration(f.config), { core: () => f.core, signal: new AbortController().signal,
    env: new Proxy({}, { get() { lookups++; throw Error('synthetic_key_lookup'); } }),
    fetchImpl: () => assert.fail('synthetic_network_forbidden') });
  assert.ok(model.model.countTokens('synthetic') > 0); assert.equal(lookups, 0); assert.equal(f.ledger(), null);
});

for (const damaged of ['corrupt', 'unknown-owner']) test(`B3 ${damaged} runtime accounting fails closed across fresh CLI processes`, async t => {
  const f = fixture(t); assert.equal(f.reply(await f.run(f.request())).status, 200);
  const directory = join(f.config.usage.root, 'usage'), path = join(directory, readdirSync(directory).find(name => name.endsWith('.json')));
  const state = f.ledger();
  if (damaged === 'corrupt') writeFileSync(path, '{"version":3}');
  else {
    state.reservations.push({ id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', pid: process.pid, boot: (await localLiveness()).boot,
      namespace: 'unknown', day: state.day, started: true, valid: true });
    // Same boot but a different PID namespace is explicitly uncertain, not dead.
    writeFileSync(path, JSON.stringify(state));
  }
  const before = readFileSync(path), calls = f.calls().length;
  const outcome = f.reply(await f.run(f.request('fresh', 'Synthetic new source.', 2)));
  assert.equal(outcome.status, 503); assert.equal(f.calls().length, calls);
  if (damaged === 'corrupt') assert.deepEqual(readFileSync(path), before);
  else { assert.equal(f.ledger().used, 1); assert.equal(f.ledger().reservations.length, 1); }
});

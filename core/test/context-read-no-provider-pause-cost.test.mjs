import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { coreFixture, query, refresh, ok } from '../testing/context-read-core-fixture.mjs';
import { openContextProductReader, openContextIndexMaintainer } from '../index.mjs';
import { setup, pumpRuntime, guard, ns } from './fixtures/semantic-turn-runtime.mjs';
import { observeStatements } from './fixtures/no-provider-statement-observer.mjs';

function meter(t) {
  const buffer = new SharedArrayBuffer(24), counts = new Int32Array(buffer);
  t.after(observeStatements(buffer));
  return { buffer, counts, async measure(label, work, {noSql = false} = {}) {
    for (const i of [1, 2, 3]) Atomics.store(counts, i, 0);
    Atomics.store(counts, 0, 1);
    let result;
    try { result = await work(); } finally { Atomics.store(counts, 0, 0); }
    assert.equal(counts[2], 0, label + ': no episode_controls reads');
    assert.equal(counts[3], 0, label + ': no pause data_version probes');
    if (noSql) assert.equal(counts[1], 0, label + ': rejected before SQLite');
    else assert.ok(counts[1] > 0, label + ': real SQLite statements observed');
    t.diagnostic(JSON.stringify({label, statements:counts[1], controlReads:counts[2], probes:counts[3]}));
    return result;
  } };
}

test('native reads and cold/repeat refresh add no pause SQL with no embedding provider', async t => {
  const m = meter(t), f = coreFixture(t); f.admit('apple');
  f.reopen({counter:{id:'synthetic', countTokens:() => 1}});
  assert.equal(Object.hasOwn(f.config, 'embedder'), false);
  await m.measure('native cold refresh', async () => ok(await f.call('refreshContextIndex', refresh())));
  await m.measure('native repeat refresh', async () => ok(await f.call('refreshContextIndex', refresh())));
  for (const method of ['findCandidates', 'contextRead']) {
    const result = await m.measure('native semantic ' + method, () => f.call(method,
      query({semantic:true, ...(method === 'contextRead' ? {budget:{maxTokens:4000,maxItems:12}} : {})})), {noSql:true});
    assert.equal(result.ok, false);
    assert.equal(result.error.code, 'invalid_input', 'native semantic requests require a configured embedder');
    const details = method === 'contextRead' ? result.error.details.candidates : result.error.details;
    assert.equal(details.channels.semantic.state, 'absent');
  }
  // Preserve the existing cold default-read cheapness invariant: 118 prepared
  // statements. The execution observer above also covers cached statements.
  const cheap = coreFixture(t);
  cheap.reopen({counter:{id:'synthetic', countTokens:() => 1}}); cheap.admit('apple');
  let preparations = 0;
  const prepare = DatabaseSync.prototype.prepare;
  const spy = t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    preparations++; return Reflect.apply(prepare, this, [sql]);
  });
  try {
    await m.measure('default no-embedder read', async () => ok(await cheap.call('contextRead',
      query({budget:{maxTokens:4000,maxItems:12}}))));
  } finally { spy.mock.restore(); }
  assert.equal(preparations, 118, 'cold default no-embedder read statement pin');
  t.diagnostic('NO_EMBEDDER_STATEMENTS ' + preparations);
});

test('real semantic pump, product query and refresh add no pause SQL with the provider removed', async t => {
  const m = meter(t), host = new URL('./fixtures/no-provider-pause-host.mjs', import.meta.url).href;
  const s = await setup(t, {coordinatorHost:host, coordinatorConfiguration:{pauseStatements:m.buffer}});
  assert.equal(m.counts[4], 1, 'semantic host has no contextEmbedding property');
  const configure = s.configure;
  s.configure = (...args) => {
    const configured = configure(...args);
    configured.options.host = {moduleUrl:host, configuration:{...configured.options.host.configuration, pauseStatements:m.buffer}};
    return configured;
  };
  const r = pumpRuntime(s, {native:true});
  assert.equal(Object.hasOwn(r.config, 'preQuantum'), false);
  const pump = r.renew(r.config);
  s.f.workspace.defer(() => guard(pump.close(), 'pump close'));
  for (let i = 0; i < 6; i++) {
    await m.measure('semantic pump turn ' + i, () => guard(r.step(), 'absent provider pump turn'));
    assert.equal(pump.getStatus().error, null);
  }
  assert.ok(r.spawned.some(c => c.outbound.some(message => message.method === 'refreshContextIndex')),
    'real reader Worker refresh executed in the scheduled pump');
  await guard(pump.close(), 'pump close');
  const service = s.configure(), maintainer = await openContextIndexMaintainer(service.options);
  s.f.workspace.defer(() => maintainer.close());
  const projection = {readSet:[ns], types:['memory'], intent:'current'};
  const result = await m.measure('product embedding refresh', async () => ok(await maintainer.refreshContextIndex(
    {...projection, mode:'embeddings', budget:{maxItems:1024,maxMs:5000,maxUsd:'0.50'}}, service.credential)));
  assert.equal(result.progress.embedded, 0);
  assert.equal(result.channels.semantic.state, 'absent');
  await maintainer.close();
  // A request binding permits queries; the pump's service binding does not.
  const request = s.configure(), binding = request.options.host.configuration.serviceBinding;
  const ids = {requestId:'synthetic-request', handleId:'synthetic-handle', credentialBindingId:binding.credentialBindingId, credentialExpiresUtcMs:null};
  request.options.requestControl = {...ids, requestMaxMs:5000};
  delete request.options.sidecarJournalMode;
  request.options.host.configuration.requestBinding = {...binding, ...ids, kind:'request'};
  delete request.options.host.configuration.requestBinding.serviceId;
  delete request.options.host.configuration.serviceBinding;
  request.options.host.configuration.requestReservation = new SharedArrayBuffer(4);
  request.options.semanticConfig = {...request.options.semanticConfig, queryEmbeddingMaxMs:3000, finalizeReserveMs:1000};
  const reader = await openContextProductReader(request.options);
  s.f.workspace.defer(() => reader.close());
  for (const method of ['findCandidates', 'contextRead']) {
    const value = await m.measure('product semantic ' + method, async () => ok(await reader[method](
      {...projection, query:'semantic', semantic:true, deadlineMs:5000,
        ...(method === 'contextRead' ? {budget:{maxTokens:4000,maxItems:12}} : {limit:12})}, request.credential)));
    assert.ok((method === 'contextRead' ? value.metered.items : value.items).length);
    assert.equal((method === 'contextRead' ? value.diagnostics.candidates.channels : value.channels).semantic.state, 'absent');
  }
  assert.ok(m.counts[5] > 0, 'reader Worker observers installed');
  assert.equal(new Int32Array(s.state)[4], 0, 'no fake provider entry, including setup');
});

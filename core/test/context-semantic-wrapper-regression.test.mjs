import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, pumpRuntime, guard } from './fixtures/semantic-turn-runtime.mjs';
import { admitMaintenance, refreshMaintenance } from '../context-product-admission.mjs';
import { maintenancePumpDiagnostic } from '../context-product-pump.mjs';

// A synthetic descriptor wrapper uses a host-private map and preserves lazy
// close identity. Only the two established dispatch bridges unwrap it.
function wrappedRuntime(s, seams = ['admit', 'work'], wrap = true) {
  const natives = new WeakMap(), bridges = [], dispatch = {};
  if (seams.includes('admit')) dispatch.admit = (h, ...args) => {
    bridges.push('admit'); return admitMaintenance(natives.get(h) ?? h, ...args);
  };
  if (seams.includes('work')) dispatch.work = (h, ...args) => {
    bridges.push('work'); return refreshMaintenance(natives.get(h) ?? h, ...args);
  };
  let publicCalls = 0, closeReads = 0;
  const runtime = pumpRuntime(s, { native: true, dispatch, ...(wrap ? { wrap(h) {
    const descriptors = Object.getOwnPropertyDescriptors(h);
    for (const method of ['getContextIndexStatus', 'refreshContextIndex']) descriptors[method] = {
      enumerable: true, value(...args) { publicCalls++; return h[method](...args); },
    };
    descriptors.close = { enumerable: true, get() { closeReads++; return h.close; } };
    const wrapped = Object.defineProperties({}, descriptors);
    natives.set(wrapped, h); return wrapped;
  } } : {}) });
  return Object.assign(runtime, { bridges, publicCalls: () => publicCalls, closeReads: () => closeReads });
}
function broker(r) {
  const tickets = [];
  r.config.preQuantum = { version: 1, maxWaitMs: 2000, createTurn(request) {
    const ticket = { request, releases: [] }; tickets.push(ticket);
    return { enter: () => 'admitted', release: (...args) => ticket.releases.push(args) };
  } };
  return tickets;
}

// Ported review reproduction, with the two trusted host bridges selected by
// the owner decision. Without a port the original public wrapper still runs.
for (const withPort of [false, true]) test('observed maintainer wrapper startup, preQuantum=' + withPort, async t => {
  const s = await setup(t), r = wrappedRuntime(s), tickets = withPort ? broker(r) : [];
  const p = r.renew(r.config);s.f.workspace.defer(() => guard(p.close(), 'wrapper close'));
  await guard(r.step(), 'wrapped startup');
  assert.equal(p.getStatus().error, null, 'trusted wrapper must dispatch its native reader');
  assert.equal(r.spawned.flatMap(w => w.outbound).filter(m => m.method === 'getContextIndexStatus').length, 1);
  if (withPort) { assert.deepEqual(tickets[0].releases, [['settled']]);assert.deepEqual(r.bridges, ['admit']);assert.equal(r.publicCalls(), 0); }
  else assert.equal(r.publicCalls(), 1);
});

test('two-bridge descriptor wrapper drives complete semantic status, lexical, embedding and validation turns', async t => {
  const s = await setup(t), r = wrappedRuntime(s), tickets = broker(r);
  r.config.quantum.maxItems = 2;
  const p = r.renew(r.config);s.f.workspace.defer(() => guard(p.close(), 'full wrapper close'));
  for (let i = 0; i < 12 && !tickets.some(x => x.request.kind === 'validation'); i++) {
    await guard(r.step(), 'wrapped semantic turn');assert.equal(p.getStatus().error, null);
  }
  assert.deepEqual([...new Set(tickets.map(x => x.request.kind))].sort(), ['embeddings', 'lexical', 'status', 'validation']);
  for (const ticket of tickets) assert.deepEqual(ticket.releases, [['settled']]);
  assert.ok(r.bridges.includes('admit'));assert.ok(r.bridges.includes('work'));assert.equal(r.publicCalls(), 0);
  const requests = r.spawned.flatMap(w => w.outbound).filter(m => ['getContextIndexStatus', 'refreshContextIndex'].includes(m.method));
  assert.ok(requests.every(m => m.semanticOutstanding instanceof SharedArrayBuffer && m.semanticOutstanding.byteLength === 8));
  assert.ok(requests.some(m => m.input.mode === 'embeddings'));
});

for (const seams of [[], ['admit'], ['work']]) test('semantic wrapper rejects first open with lexical identity failure, bridges=' + seams, async t => {
  const s = await setup(t), r = wrappedRuntime(s, seams), tickets = broker(r);
  const p = r.renew(r.config);s.f.workspace.defer(() => guard(p.close(), 'rejected wrapper close'));
  await guard(r.step(), 'rejected semantic wrapper');
  const status = p.getStatus(), diagnostic = maintenancePumpDiagnostic(status);
  assert.equal(status.error, 'invalid_input');assert.equal(status.state, 'failed');
  assert.equal(diagnostic.lastFailure.cause, 'maintainer_identity_unrecognized');
  assert.equal(diagnostic.lastFailure.stage, 'open');
  assert.equal(diagnostic.failureCounts.maintainer_identity_unrecognized, 1);
  assert.deepEqual(r.bridges, []);assert.equal(r.publicCalls(), 0);
  assert.equal(r.opened.length, 1);
  assert.equal(r.spawned.flatMap(w => w.outbound).filter(m => ['getContextIndexStatus', 'refreshContextIndex'].includes(m.method)).length, 0);
  assert.deepEqual(tickets[0].releases, [['settled']]);
  await guard(p.close(), 'identity failure disposal');assert.equal(r.closeReads(), 1);
  assert.equal(r.spawned[0].worker.threadId, -1);
});

for (const seams of [[], ['admit'], ['work']]) test('native semantic maintainer accepts default dispatch, bridges=' + seams, async t => {
  const s = await setup(t), r = wrappedRuntime(s, seams, false), tickets = broker(r);
  const p = r.renew(r.config);s.f.workspace.defer(() => guard(p.close(), 'native close'));
  for (let i = 0; i < 2; i++) { await guard(r.step(), 'native semantic turn');assert.equal(p.getStatus().error, null); }
  for (const ticket of tickets) assert.deepEqual(ticket.releases, [['settled']]);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { fixture, ns, ok, readTransaction } from '../testing/context-read-fixture.mjs';
import { configured, prebuild, descriptor } from '../testing/context-product-owner-fixture.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { productSidecar, PRODUCT_SIDECAR_SUFFIX } from '../context-product-sidecar.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { createMaintenancePumpRuntime } from '../context-product-pump.mjs';
import { createProductReaderRuntime } from '../context-product-reader.mjs';

// Fix A regressions plus retained architectural/host counterexamples.
// These functional tests do not establish the registered qualification gates.
const readSet = [ns], types = ['memory', 'card'];
const budget = { maxItems: 128, maxMs: 1000 };
const input = { readSet, types, intent: 'current', deadlineMs: 5000 };
function write(f, type = 'memory', operation = 'capture', row = {}) {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./fixtures/context-maintenance-writer.mjs', import.meta.url)),
    f.path, JSON.stringify({ namespace: ns, type, operation, ...row })], { encoding: 'utf8', env: {}, timeout: 15000 });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.signal, null);
  return JSON.parse(child.stdout);
}
function local(t, f, options = {}) {
  const facade = openContextProductFacade(f.path, {});
  const storage = productSidecar({ path: f.path, db: facade.port.db, identity: facade.port.identity,
    features: facade.port.features, writable: true, now: () => 0, ...options });
  t.after(() => { storage.close(); facade.close(); });
  const p = { ...input, ownerCoverage: descriptor(readSet) };
  const access = accessDigest({ ownerId: ns.ownerId, namespaces: { readSet } });
  return { storage, facade, p, access,
    observe(patch = {}) { return readTransaction(facade.port.db, () => storage.observe({ ...p, ...patch }, access)); },
    refresh(maxItems = 128, patch = {}) { return storage.refresh({ ...p, ...patch }, access, { ...budget, maxItems }); } };
}
function staged(f) {
  const d = new DatabaseSync(f.path + PRODUCT_SIDECAR_SUFFIX, { readOnly: true });
  try { return readTransaction(d, () => ({
    work: d.prepare('SELECT g.* FROM generations g JOIN work w ON w.generation=g.id').all(),
    documents: d.prepare('SELECT * FROM documents ORDER BY generation,doc').all(),
    publications: d.prepare('SELECT * FROM publications').all(),
  })); } finally { d.close(); }
}
function scheduler(open) {
  let now = 0, serial = 0;
  const timers = new Map();
  const renew = createMaintenancePumpRuntime({ now: () => now, observedAt: () => now, open,
    setTimer: (f, ms) => { const id = ++serial; timers.set(id, { f, at: now + ms }); return id; },
    clearTimer: id => timers.delete(id) });
  return { renew, timers, setTime: value => { now = value; }, async next() {
    assert.ok(timers.size, 'a scheduled quantum must exist');
    const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
    timers.delete(id); now = timer.at; await timer.f();
  } };
}
function pumpConfig(service) {
  return { supervisor: service.supervisor, id: randomUUID(), serviceCredential: service.token,
    window: { id: randomUUID(), endsAtMonoMs: 60000, usedItems: 0, usedMs: 0 },
    budgets: { maxItems: 1024, maxMs: 8000 }, quantum: budget, pollMs: 25, renewalMs: 10000,
    projections: [{ options: service.options, types }] };
}

function successfulResult(result, pump) {
  assert.equal(result?.ok, true, JSON.stringify({ pump: pump.getStatus(), raw: result }));
  return result.value;
}

test('Fix A3: failed refresh retains the raw error outside the pump catch', async t => {
  const f = fixture(t), service = configured(t, f.path, readSet, { service: true });
  const raw = { ok: false, error: { code: 'storage_error', message: 'forced raw failure' } }, results = [];
  const clock = scheduler(async () => ({ close: async () => {}, async refreshContextIndex() {
    results.push(raw); return raw;
  } })), pump = clock.renew(pumpConfig(service));
  t.after(() => pump.close());
  await clock.next();
  assert.deepEqual(results, [raw]);
  assert.throws(() => successfulResult(results[0], pump), error => {
    assert.match(error.message, /forced raw failure/);
    assert.match(error.message, /"state":"failed"/);
    assert.match(error.message, /"error":"storage_error"/);
    t.diagnostic(error.message.split('\n')[0]);
    return true;
  });
});

test('Fix A: in-batch fence race yields progress and preserves earlier committed documents', t => {
  const f = fixture(t, { cards: true }); f.admit('seed batch probe'); f.admit('second batch probe');
  let raced = false, items = 0, armed = false;
  const a = local(t, f, { rendezvous(point) {
    if (point === 'item') items++;
    if (point === 'transformed' && armed && items > 0 && !raced) { raced = true; write(f); }
  } });
  a.refresh(1); const before = staged(f); armed = true;
  assert.ok(a.refresh().transformed > 0);
  const s = staged(f);
  assert.equal(raced, true); assert.equal(s.work.length, 1);
  assert.ok(items > 0, 'race after a completed document, not an empty Card-state stream');
  assert.equal(s.work[0].checkpoint, before.work[0].checkpoint);
  assert.equal(s.work[0].phase, before.work[0].phase); assert.equal(s.work[0].last_key, before.work[0].last_key);
  assert.deepEqual(s.documents, before.documents); assert.equal(s.documents.length, 1); assert.equal(s.publications.length, 0);
  const observed = a.observe();
  assert.equal(observed.dto.lexical.state, 'stale'); assert.equal(observed.dto.lexical.reason, 'fence_changed');
  assert.equal(observed.dto.coverage.byType.memory.indexed, null);
  a.refresh(); assert.equal(a.observe().dto.lexical.state, 'ready');
});

test('Fix A: actual product Worker fence race returns rebuilding and the pump converges', async t => {
  const f = fixture(t, { cards: true }); f.admit('seed public pump');
  const service = configured(t, f.path, readSet, { service: true });
  await prebuild(service); f.admit('changed public pump');
  const open = createProductReaderRuntime({ maintenance: true, spawnWorker: data => new Worker(
    new URL('./fixtures/context-maintenance-race-worker.mjs', import.meta.url),
    { workerData: data, env: {}, execArgv: [], stdout: true, stderr: true }) });
  // Open outside the quantum, isolating the fence outcome from Worker startup.
  const handle = await open({ ...service.options, deadlineMs: 5000 });
  t.after(() => handle.close());
  const results = []; let first = true;
  const clock = scheduler(async options => {
    const h = first ? handle : await open(options); first = false;
    return { close: () => h.close(), async refreshContextIndex(...args) {
      const result = await h.refreshContextIndex(...args); results.push({ result, intent: args[0].intent }); return result;
    } };
  }), pump = clock.renew({ ...pumpConfig(service), renewalMs: 60000 });
  t.after(() => pump.close()); await clock.next();
  assert.equal(successfulResult(results[0]?.result, pump).status, 'rebuilding');
  assert.equal(pump.getStatus().state, 'active'); assert.equal(pump.getStatus().error, null);
  assert.equal(service.view[6], 1); assert.equal(clock.timers.size, 1);
  const reader = configured(t, f.path, readSet), h = await reader.open();
  assert.equal(ok(await h.getContextIndexStatus(input, reader.token)).lexical.reason, 'fence_changed');
  assert.equal((await h.findCandidates({ ...input, query: 'probe' }, reader.token)).error.code, 'index_unavailable');
  for (let i = 0; i < 8 && !results.slice(1).some(r => successfulResult(r.result, pump).status === 'complete' && r.intent === 'current'); i++) await clock.next();
  assert.ok(results.slice(1).some(r => successfulResult(r.result, pump).status === 'complete' && r.intent === 'current'));
  assert.equal(pump.getStatus().error, null);
  assert.equal(ok(await h.getContextIndexStatus(input, reader.token)).lexical.state, 'ready');
});

test('diagnosis: continuous independent commits abandon checkpoints; delta still scans the full corpus', t => {
  const f = fixture(t, { cards: true });
  for (let i = 0; i < 32; i++) f.admit('unchanged corpus probe ' + i);
  const a = local(t, f);
  a.refresh(); assert.equal(a.observe().dto.lexical.state, 'ready');
  const base = a.observe().publication.generation.id;
  let lastSequence = 0;
  for (let i = 0; i < 4; i++) {
    write(f); const m = a.refresh(1), s = staged(f), g = s.work[0];
    assert.equal(m.transformed, 1);
    // Four empty Card-state streams checkpoint before the Memory stream.
    assert.equal(g.checkpoint, 5);
    assert.ok(g.sequence > lastSequence); lastSequence = g.sequence;
    assert.equal(g.base_id, base, 'restarts from publication, not last checkpoint');
    assert.ok(s.documents.some(d => d.generation === g.storage_id));
    assert.equal(a.observe().dto.lexical.state, 'catching_up');
  }
  // One more write invalidates the last checkpoint. Exactly one new row since
  // the preceding quantum still requires reading every canonical metadata row.
  write(f); const m = a.refresh();
  assert.equal(m.transformed, 5); assert.equal(m.canonicalRows, 37);
  assert.ok(m.verifiedRows >= 37); assert.equal(a.observe().dto.lexical.state, 'ready');
  t.diagnostic('5 changes since publication: 37 canonical metadata rows, 5 transformations; abandoned work never becomes the base');
});

test('diagnosis: precommit writer leaves a valid captured certificate stale for fresh readers', t => {
  const f = fixture(t, { cards: true }); f.admit('publication race probe');
  let raced = false;
  const a = local(t, f, { rendezvous(point) {
    if (point === 'precommit' && !raced) { raced = true; write(f); }
  } });
  a.refresh(); const captured = a.observe();
  assert.equal(staged(f).publications.length, 1);
  assert.equal(captured.dto.lexical.state, 'stale'); assert.equal(captured.dto.coverage.byType.memory.indexed, null);
  a.refresh(); assert.equal(a.observe().dto.lexical.state, 'ready');
});

test('Fix A: native no-op usage is reconciled and paced maintenance catches same-window writes', async t => {
  const f = fixture(t, { cards: true }); f.admit('initial ready probe');
  const service = configured(t, f.path, readSet, { service: true }); await prebuild(service);
  const { openContextIndexMaintainer } = await import('../context-product-reader.mjs');
  let calls = 0; const completed = new Set();
  const clock = scheduler(async options => {
    const h = await openContextIndexMaintainer(options);
    return { close: () => h.close(), async refreshContextIndex(...args) {
      calls++; const result = await h.refreshContextIndex(...args), value = ok(result);
      if (calls <= 8) assert.equal(value.status, 'complete');
      else if (value.status === 'complete') completed.add(args[0].intent);
      return result;
    } };
  });
  const c = { ...pumpConfig(service), renewalMs: 60000 }, pump = clock.renew(c); t.after(() => pump.close());
  for (let i = 0; i < 8; i++) await clock.next();
  assert.equal(calls, 8); assert.equal(pump.getStatus().state, 'active');
  assert.equal(pump.getStatus().usedItems, 0); assert.equal(pump.getStatus().usedMs, 0);
  assert.equal(clock.timers.size, 1);
  const memory = write(f), reviewed = write(f, 'memory', 'review', memory);
  const card = write(f, 'card'), confirmed = write(f, 'card', 'review', card);
  for (let i = 0; i < 8 && completed.size < 2; i++) {
    await clock.next(); assert.equal(pump.getStatus().error, null);
  }
  assert.equal(completed.size, 2); assert.equal(pump.getStatus().windowId, c.window.id);
  const reader = configured(t, f.path, readSet), h = await reader.open();
  for (const intent of ['current', 'history']) {
    const candidates = ok(await h.findCandidates({ ...input, intent, query: 'Synthetic' }, reader.token));
    for (const target of [reviewed, confirmed]) assert.ok(candidates.items.some(i => i.ref.revision === target.revision &&
      i.ref[target.type === 'memory' ? 'memoryId' : 'cardId'] === target.id));
  }
  await h.close();
});

test('diagnosis: renewal lifetime expires before the registered next cron even with spare quota', async t => {
  const f = fixture(t, { cards: true }), service = configured(t, f.path, readSet, { service: true });
  let calls = 0;
  const clock = scheduler(async () => ({ close: async () => {}, refreshContextIndex: async () => { calls++; return { ok: true }; } }));
  const c = pumpConfig(service), pump = clock.renew(c); t.after(() => pump.close());
  // Let the first timer be delayed past expiry with the entire quota spare.
  const [id, timer] = [...clock.timers][0]; clock.timers.delete(id); clock.setTime(10000); await timer.f();
  assert.equal((await pump.completion).state, 'renewal_expired');
  assert.equal(calls, 0); assert.equal(clock.timers.size, 0);
});

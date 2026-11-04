import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { configured, prebuild } from '../testing/context-product-owner-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { nativeObserver } from '../context-product-telemetry.mjs';
import { writeFileSync, unlinkSync } from 'node:fs';

const p = { readSet: [ns], types: ['memory'], intent: 'current', deadlineMs: 5000 };
for (const base of [18, 23, 33]) for (const method of ['getContextIndexStatus', 'findCandidates', 'contextRead']) for (const refusal of [false, true])
test(`r5 final owner epoch ${refusal ? 'S2h refusal' : 'BUSY'} v${{18:34,23:38,33:48}[base]} ${method}: native classification and fresh retry`, async t => {
  const f = safetyFixture(t, base); await f.migrate();
  const core = openMemoryCore({ path: f.path }); t.after(() => core.close());
  const memories = ['needle protected', 'needle retained'].map((content, i) => ok(core.admit({ namespace: ns,
    memory: { content, kind: 'fact' }, receipts: [receipt('busy-' + i)] })).memory);
  await prebuild(configured(t, f.path, [ns], { service: true }), ['memory']);
  const c = configured(t, f.path, [ns]), control = new Int32Array(new SharedArrayBuffer(16));
  c.options.host.moduleUrl = new URL('./fixtures/content-safety-s2h-fix5-host.mjs', import.meta.url).href;
  Object.assign(c.options.host.configuration, { fix5Control: control.buffer, fix5FaultPath: f.workspace.path + '/fault.sqlite' });
  const h = await c.open();
  const input = { ...p, ...(method === 'getContextIndexStatus' ? {} : { query: 'needle' }),
    ...(method === 'contextRead' ? { budget: { maxItems: 8, maxTokens: 2000 } } : {}) };
  const call = () => h[method](input, c.token);
  const initial = ok(await call());
  const initialCandidates = method === 'contextRead' ? initial.diagnostics.candidates : initial;
  assert.equal(initialCandidates.coverage.byType.memory.eligible, 2, 'passing population before injection');
  Atomics.store(control, 0, refusal ? 2 : 1);
  assert.deepEqual(await call(), { ok: false, error: { code: refusal ? 'evidence_unavailable' : 'storage_busy', retryable: !refusal } });
  assert.equal(Atomics.load(control, 1), 1, 'fault reached an autocommit owner-epoch delivery SELECT in the real Worker');
  const db = f.connect(); t.after(() => db.close());
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'memory', key: memories[0].id,
    reason: 'user_forget', actionId: 'after-busy' }));
  Atomics.store(control, 2, 1);
  const result = ok(await call());
  assert.equal(Atomics.load(control, 3), 0, 'retry never dispatches committed suppressed text to the counter');
  assert.doesNotMatch(JSON.stringify(result), new RegExp(memories[0].id + '|needle protected'), 'retry rebuilds decisions and denied sets');
  const candidates = method === 'contextRead' ? result.diagnostics.candidates : result;
  assert.equal(candidates.coverage.byType.memory.eligible, base === 33 ? null : 1, 'retry rebuilds counts, retaining safe unknown coverage for Raw-capable v48');
  if (method === 'findCandidates') assert.equal(result.items.length, 1);
  if (method === 'contextRead') assert.equal(result.metered.items.length, 1);
  // A newly committed namespace refusal is never normalized into retryable BUSY.
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'namespace', matchMode: 'namespace',
    reason: 'privacy_erase', actionId: 'refuse-after-busy' }));
  Atomics.store(control, 2, 2);
  const denied = await call(); assert.equal(denied.ok, false); assert.equal(denied.error.retryable, false);
  assert.notEqual(denied.error.code, 'storage_busy');
  assert.equal(Atomics.load(control, 3), 0, 'namespace refusal dispatches no protected text'); await h.close();
});

for (const base of [18, 23, 33]) for (const kind of ['-wal', '-shm', 'unsafe-journal', 'guard-timeout'])
test(`r5 v${{18:34,23:38,33:48}[base]} ${kind}: S2h refusal stays non-retryable`, async t => {
  const f = safetyFixture(t, base); await f.migrate(); const core = openMemoryCore({ path: f.path }); t.after(() => core.close());
  const memory = ok(core.admit({ namespace: ns, memory: { content: 'protected refusal', kind: 'fact' }, receipts: [receipt(kind)] })).memory;
  const db = f.connect(); t.after(() => db.close());
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'namespace', matchMode: 'namespace',
    reason: 'privacy_erase', actionId: 'deny-' + kind }));
  const observer = nativeObserver(); if (kind === 'guard-timeout') observer.journalRemainingMs = () => 0;
  const facade = openContextProductFacade(f.path, { observer }); t.after(() => facade.close());
  const suffix = kind.startsWith('-') ? kind : '-journal', path = f.path + suffix;
  writeFileSync(path, 'synthetic companion', { mode: kind === 'unsafe-journal' ? 0o644 : 0o600 });
  try {
    const result = facade.fetchCandidateEvidence({ readSet: [ns], intent: 'current', refs: [{ type: 'memory', namespace: ns,
      memoryId: memory.id, revision: memory.revision }] }, {});
    assert.equal(result.ok, false); assert.equal(result.error.retryable, false); assert.notEqual(result.error.code, 'storage_busy');
  } finally { unlinkSync(path); }
});

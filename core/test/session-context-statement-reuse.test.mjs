import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { assembleSessionContext, contextInput } from '../session-context.mjs';
import { migrateContentSafety, migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { copySqliteFixture, quiescence } from '../testing/content-safety-s2h-fixture.mjs';
import { lineageHost } from '../testing/card-lineage-fixture.mjs';
import { model as episodeModel, input } from '../testing/episode-capture-helpers.mjs';
import { options } from '../testing/episode-helpers.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const ns = { ownerId: 'synthetic-statement', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const proofSQL = sql => sql.includes(' AS episode_read_proof');
const noClose = typeof StatementSync.prototype.close !== 'function' && typeof StatementSync.prototype[Symbol.dispose] !== 'function'
  ? 'This runtime has no statement close/dispose API (Node 22); get() resets statements instead.' : false;
const receipt = id => ({ client: 'synthetic', sessionId: 'synthetic-reuse', eventId: id, role: 'user', excerpt: 'Synthetic support ' + id });
function port() {
  return episodeModel({ countTokens: () => 1, extract: () => ({ items: [] }), interpretEpisode: request => {
    const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: request.input.sources[0].text.length }] });
    return { type: field('work'), language: 'mixed', gist: field('Synthetic activity'), outcome: null,
      nextStep: field('Synthetic next action'), disposition: null };
  } });
}
async function fixture(t, layout) {
  const ws = createTestWorkspace(t, { prefix: 'session-reuse-' }), path = join(ws.path, 'store.sqlite');
  const host = lineageHost(), model = port();
  model.countTokens = () => { model.onCount?.(); return 1; };
  const initial = openMemoryCore({ path, model, ...options,
    privateCards: { ...host.options, currentDependencies: { version: 'card-current-dependencies-v1' } },
    methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority: host.options.authority } });
  let memories;
  try {
    memories = ['instruction', 'fact'].map((kind, i) => ok(initial.admit({ namespace: ns,
      memory: { content: 'Synthetic body ' + i, kind }, receipts: [receipt(String(i))] })).memory);
    ok(await initial.capture(input(1, 'synthetic-reuse-episode', { namespace: ns })));
  } finally { initial.close(); }
  const db = new DatabaseSync(path);
  const storeId = db.prepare('SELECT store_id FROM store_metadata').get().store_id; db.close();
  const backupPath = join(ws.path, 'offline.sqlite'); copySqliteFixture(path, backupPath);
  await (layout === 53 ? migrateReceiptEventTime : migrateContentSafety)({ path, backupPath,
    expected: { storeId, base: 33 }, quiescence });
  const core = openMemoryCore({ path, model }); ws.defer(() => core.close());
  return { ws, path, core, model, memories };
}
function measure(call, { prepared, step } = {}) {
  const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec;
  const methods = new Map(['get', 'all', 'run', 'iterate'].map(key => [key, StatementSync.prototype[key]]));
  const trace = [], statements = [], inside = [], connections = new WeakMap();
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = prepare.call(this, sql); connections.set(statement, this);
    if (proofSQL(sql)) { statements.push(statement); inside.push(this.isTransaction); prepared?.(statement, this); }
    return statement;
  };
  DatabaseSync.prototype.exec = function(sql) { trace.push([sql, 'exec', []]); return exec.call(this, sql); };
  for (const [key, original] of methods) StatementSync.prototype[key] = function(...bindings) {
    trace.push([this.sourceSQL, key, bindings]);
    if (proofSQL(this.sourceSQL)) step?.(this, connections.get(this));
    return original.apply(this, bindings);
  };
  let result, error;
  try { result = call(); } catch (failure) { error = failure; }
  finally {
    DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec;
    for (const [key, original] of methods) StatementSync.prototype[key] = original;
  }
  return { result, error, statements, inside, trace: JSON.stringify(trace) };
}
for (const layout of [48, 53]) test(`layout ${layout}: one pre-BEGIN proof prepare, unchanged executions and byte-equal warm and cold in-tree assembly and public prepare coverage`, async t => {
  const f = await fixture(t, layout), runtime = createMemoryRuntime({ path: f.path }), counts = [];
  f.ws.defer(() => runtime.close());
  assert.equal(typeof runtime.suppressionFence, 'function');
  assert.equal(runtime.suppressionFence({ ...ns, projectId: '' }, true), true);
  // Keep the runtime's safety methods; drop only the operation-local memo.
  const unmemoized = { ...runtime, sessionContextSnapshot(ns, groups, expected) {
    return runtime.sessionContextSnapshot(ns, groups, expected);
  } };
  // Separate connections give both sides an equally cold receipt-coordinate cache.
  const coldOld = createMemoryRuntime({ path: f.path }), coldCurrent = createMemoryRuntime({ path: f.path });
  f.ws.defer(() => coldOld.close()); f.ws.defer(() => coldCurrent.close());
  const coldUnmemoized = { ...coldOld, sessionContextSnapshot(ns, groups, expected) {
    return coldOld.sessionContextSnapshot(ns, groups, expected);
  } };
  const coldArgs = { model: f.model, ns: { ...ns, projectId: '' }, config: contextInput({ namespace: ns }) };
  const oldCold = measure(() => ({ ok: true, value: assembleSessionContext({ ...coldArgs, runtime: coldUnmemoized }) }));
  const currentCold = measure(() => ({ ok: true, value: assembleSessionContext({ ...coldArgs, runtime: coldCurrent }) }));
  assert.equal(oldCold.error, undefined); assert.equal(currentCold.error, undefined);
  ok(oldCold.result); ok(currentCold.result);
  assert.equal(JSON.stringify(currentCold.result), JSON.stringify(oldCold.result), 'cold envelopes');
  assert.equal(currentCold.trace, oldCold.trace, 'cold: every SQL text, binding, method and execution order');
  assert.equal(oldCold.statements.length, 2, 'cold unmemoized proof prepare count');
  assert.equal(currentCold.statements.length, 1, 'cold memoized proof prepare count');
  assert.equal(currentCold.inside.filter(inside => !inside).length, 1, 'cold pre-BEGIN proof prepare count');
  assert.deepEqual(oldCold.inside, [true, true]); assert.deepEqual(currentCold.inside, [false]);
  counts.push({ state: 'ordinary', groups: 'default', warmth: 'cold', unmemoized: 2, memoized: 1 });
  for (const state of ['ordinary', 'correct', 'forget']) {
    if (state === 'correct') f.memories[0] = ok(f.core.correct({ namespace: ns, memoryId: f.memories[0].id,
      expectedRevision: f.memories[0].revision, content: 'Synthetic corrected body', kind: 'instruction', receipt: receipt('correct') })).memory;
    if (state === 'forget') ok(f.core.forget({ namespace: ns, memoryId: f.memories[1].id, expectedRevision: f.memories[1].revision }));
    for (const groups of [undefined, { nextSteps: true, procedural: false }]) {
      const args = { namespace: ns, ...(groups ? { groups } : {}) };
      // Warm again for every cell: corrections and forgets invalidate this cache.
      assembleSessionContext({ runtime, model: f.model, ns: { ...ns, projectId: '' }, config: contextInput(args) });
      const old = measure(() => ({ ok: true, value: assembleSessionContext({ runtime: unmemoized, model: f.model,
        ns: { ...ns, projectId: '' }, config: contextInput(args) }) })), current = measure(() => ({ ok: true, value: assembleSessionContext({ runtime,
        model: f.model, ns: { ...ns, projectId: '' }, config: contextInput(args) }) }));
      assert.equal(old.error, undefined); assert.equal(current.error, undefined);
      ok(old.result); ok(current.result);
      assert.equal(JSON.stringify(current.result), JSON.stringify(old.result), state);
      assert.equal(current.trace, old.trace, 'every SQL text, binding, method and execution order');
      assert.equal(old.statements.length, 2, 'unmemoized proof prepare count');
      assert.equal(current.statements.length, 1, 'memoized proof prepare count');
      assert.equal(current.inside.filter(inside => !inside).length, 1, 'pre-BEGIN proof prepare count');
      assert.deepEqual(old.inside, [true, true]); assert.deepEqual(current.inside, [false]);
      const publicCall = measure(() => f.core.sessionStartContext(args));
      assert.equal(publicCall.error, undefined); ok(publicCall.result);
      assert.equal(JSON.stringify(publicCall.result), JSON.stringify(current.result), 'public and direct assembly envelopes');
      assert.equal(publicCall.statements.length, 1, 'public proof prepare count');
      assert.deepEqual(publicCall.inside, [false]);
      counts.push({ state, groups: groups ? 'nextSteps' : 'default', unmemoized: 2, memoized: 1, public: 1 });
    }
  }
  t.diagnostic(JSON.stringify(counts));
});

for (const layout of [48, 53]) test(`layout ${layout}: call-local proof statements finalize after success and refusals`, { skip: noClose }, async t => {
  const f = await fixture(t, layout), seen = new Set();
  for (const mode of ['success', 'size', 'reread', 'success']) {
    let moved = false;
    f.model.onCount = () => {
      if (mode === 'reread' && !moved) { moved = true; ok(f.core.admit({ namespace: ns,
        memory: { content: 'Synthetic epoch movement', kind: 'fact' }, receipts: [receipt('movement')] })); }
    };
    const row = measure(() => f.core.sessionStartContext({ namespace: ns, ...(mode === 'size' ? { maxChars: 1 } : {}) }));
    assert.equal(row.error, undefined);
    if (mode === 'size') assert.equal(row.result.error.code, 'context_item_too_large');
    else if (mode === 'reread') assert.equal(row.result.error.code, 'index_revision_conflict');
    else ok(row.result);
    assert.equal(row.statements.length, 1);
    for (const statement of row.statements) {
      assert.equal(seen.has(statement), false); seen.add(statement);
      assert.throws(() => statement.get(), { code: 'ERR_INVALID_STATE', message: 'statement has been finalized' });
    }
  }
});

test('cleanup prefers close, falls back to dispose, drains all statements and preserves primary errors', async () => {
  for (const disposeOnly of [false, true]) for (const primary of [false, true]) {
    const closed = [], errors = [new Error('first close failure'), new Error('second close failure')], failure = new Error('primary failure');
    let retained;
    const runtime = { sessionContextSnapshot(ns, groups, expected, statements) {
      retained = statements;
      for (let i = 0; i < 2; i++) if (!statements.has(String(i))) statements.set(String(i), {
        ...(disposeOnly ? {} : { close() { closed.push(i); throw errors[i]; } }),
        [Symbol.dispose]() { closed.push(i); if (!disposeOnly) assert.fail('close has precedence'); throw errors[i]; },
      });
      if (primary) throw failure;
      return { indexRevision: 1, groups: { nextSteps: { identities: [], items: [] }, procedural: { identities: [], items: [] } } };
    } };
    assert.throws(() => assembleSessionContext({ runtime, model: { countTokens: () => 1 }, ns,
      config: contextInput({}) }), error => error === (primary ? failure : errors[0]));
    assert.deepEqual(closed, [0, 1]);
    assert.equal(retained.size, 0);
  }
});

for (const layout of [48, 53]) test(`layout ${layout}: a thrown proof execution error finalizes the precompiled statement`, { skip: noClose }, async t => {
  const f = await fixture(t, layout), runtime = createMemoryRuntime({ path: f.path }); f.ws.defer(() => runtime.close());
  const failure = new Error('synthetic step failure');
  const row = measure(() => assembleSessionContext({ runtime, model: port(), ns: { ...ns, projectId: '' }, config: contextInput({}) }), {
    step: () => { throw failure; },
  });
  assert.equal(row.error, failure); assert.equal(row.statements.length, 1);
  assert.throws(() => row.statements[0].get(), { code: 'ERR_INVALID_STATE', message: 'statement has been finalized' });
});

test('native memo cleanup preserves a thrown execution error and reports a close error after success', async t => {
  const f = await fixture(t, 53), runtime = createMemoryRuntime({ path: f.path }); f.ws.defer(() => runtime.close());
  for (const disposeOnly of [false, true]) for (const primary of [false, true]) {
    const failure = new Error('synthetic primary step failure'), closeFailure = new Error('synthetic close failure');
    let closed = 0;
    const row = measure(() => assembleSessionContext({ runtime, model: port(), ns: { ...ns, projectId: '' }, config: contextInput({}) }), {
      prepared: statement => {
        const nativeClose = statement.close ?? statement[Symbol.dispose];
        const close = function() { closed++; nativeClose?.call(this); throw closeFailure; };
        statement.close = disposeOnly ? undefined : close;
        statement[Symbol.dispose] = disposeOnly ? close : () => assert.fail('close takes precedence');
      },
      step: () => { if (primary) throw failure; },
    });
    assert.equal(row.error, primary ? failure : closeFailure);
    assert.equal(row.statements.length, 1); assert.equal(closed, 1);
  }
});

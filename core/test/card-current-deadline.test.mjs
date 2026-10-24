import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { createCardCurrentStorage } from '../card-current-storage.mjs';
import { readTransaction } from '../database.mjs';
import { fixture, host, ns, project, ok, query } from './card-current-fixture.mjs';

for (const stage of ['before-preparation', 'between-candidates', 'during-comparison']) test(`C17 optional dependency work stops at ${stage}`, async t => {
  let now = 0, armed = false, queued = false, dependencyReads = 0, bindingReads = 0, sourceReads = 0, completedFirst = false;
  t.mock.method(performance, 'now', () => {
    if (armed && stage === 'between-candidates' && sourceReads >= 2) {
      if (completedFirst) now = 6000;
      completedFirst = true;
    }
    return now;
  });
  const h = host({ counter: { id: 'synthetic-deadline', countTokens: () => 1 }, onCurrent(request) {
    if (armed && stage === 'before-preparation' && request.method === 'contextRead' && !queued) {
      queued = true; queueMicrotask(() => { now = 6000; });
    }
  } });
  const f = fixture(t, { h });
  for (let i = 0; i < 3; i++) f.card();
  assert.equal(ok(await f.call('findCandidates', query())).items.length, 3);
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    const statement = prepare.call(this, sql);
    return new Proxy(statement, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = value.apply(target, args);
        if (armed) {
          if (/FROM card_current_dependencies WHERE card_id=/.test(sql)) dependencyReads++;
          if (/FROM method_bindings WHERE/.test(sql)) {
            bindingReads++;
            if (stage === 'during-comparison' && bindingReads === 2) now = 6000;
          }
          if (/SELECT source_ref,position FROM card_bindings WHERE card_id=/.test(sql)) sourceReads++;
        }
        return result;
      };
    } });
  });
  armed = true;
  const result = ok(await f.call('contextRead', query()));
  assert.equal(result.diagnostics.candidates.count, 3);
  assert.equal(result.diagnostics.stops.deadline, true);
  assert.equal(result.metered.items.length, 0);
  assert.equal(dependencyReads, stage === 'before-preparation' ? 0 : 1);
  assert.equal(bindingReads, stage === 'before-preparation' ? 0 : 2);
  assert.equal(result.diagnostics.omitted.unavailable, stage === 'between-candidates' ? 2 : 3);
  assert.equal(result.diagnostics.omitted.bodies, stage === 'between-candidates' ? 1 : 0);
});

// Exercise every SQL boundary, including package identity, both lifecycle rows,
// text/mixed manifests and per-scope generation/event observations. Counting
// statement starts catches work hidden inside a single U2 resolution.
for (const scenario of ['current-text', 'changed-target', 'current-mixed']) test(`C17 every optional SQL boundary stops after expiry: ${scenario}`, async t => {
  let now = 0, active = false, cut = Infinity, started = [], afterExpiry = [], preparedAfterExpiry = [];
  t.mock.method(performance, 'now', () => now);
  const h = host(), f = fixture(t, { h, assets: h.assets });
  let packages;
  if (scenario === 'current-mixed') {
    const mixed = ok(f.call('importMethodVersion', { namespace: ns, actionId: 'mixed', title: 'Synthetic mixed method', manifestFormat: 'mixed-v1', files: [
      { kind: 'text', path: 'guide.txt', mediaType: 'text/plain', text: 'Synthetic guide' },
      { kind: 'binary', path: 'diagram.png', mediaType: 'image/png', bytes: new Uint8Array([137,80,78,71,13,10,26,10,0]) },
    ] }));
    ok(f.call('adoptMethodVersion', { bindingNamespace: ns, package: mixed.package, version: mixed.version,
      roleId: null, readSet: [ns], expectedRevision: null, actionId: 'adopt-mixed' }));
    packages = [mixed.package];
  }
  const ref = f.card({ ...(packages ? { packages } : {}), context: { readSet: [ns, project], roleId: 'finance' } });
  if (scenario === 'changed-target') f.change();
  const identity = f.db.prepare('SELECT store_id,cursor_secret FROM store_metadata').get();
  const card = f.db.prepare('SELECT id,revision,body_revision FROM private_cards WHERE id=?').get(ref.cardId);
  const makeStorage = () => createCardCurrentStorage({ db: f.db, identity: { storeId: identity.store_id, cursorSecret: identity.cursor_secret } });
  const original = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    if (active && now >= 5000) preparedAfterExpiry.push(sql);
    const statement = original.call(this, sql);
    return new Proxy(statement, { get(target, key) {
      const value = Reflect.get(target, key, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        if (active && ['get', 'all', 'iterate', 'run'].includes(key)) {
          if (now >= 5000) afterExpiry.push(sql);
          started.push(sql);
        }
        const result = value.apply(target, args);
        if (active && started.length === cut) now = 6000;
        return result;
      };
    } });
  });
  function compare(options) {
    const storage = makeStorage();
    return readTransaction(f.db, () => {
      active = true;
      try { return storage.compare(ns, card, [ns, project], options); }
      finally { active = false; }
    });
  }
  compare({ deadlineAt: 5000 });
  const complete = [...started];
  assert.ok(complete.filter(sql => /FROM method_bindings WHERE/.test(sql)).length >= 4);
  for (const table of ['method_packages', 'method_versions', 'method_files', 'method_manifest_formats', 'method_binding_generations', 'method_binding_events'])
    assert.ok(complete.some(sql => sql.includes('FROM ' + table)), table);
  if (scenario === 'current-mixed') assert.ok(complete.some(sql => sql.includes('FROM method_mixed_entries')));
  for (cut = 1; cut <= complete.length; cut++) {
    now = 0; started = []; afterExpiry = []; preparedAfterExpiry = [];
    assert.throws(() => compare({ deadlineAt: 5000 }), { code: 'evidence_unavailable' }, `expire after ${complete[cut - 1]}`);
    assert.deepEqual(started, complete.slice(0, cut));
    assert.deepEqual(afterExpiry, [], 'no SQL execution begins after optional expiry');
    assert.deepEqual(preparedAfterExpiry, [], 'no SQL preparation begins after optional expiry');
    // The identical seam without the optional deadline completes the reserved
    // final read after expiry, observing the actual declaration status.
    const boundary = cut; cut = Infinity; started = [];
    const required = compare();
    assert.equal(required.status, scenario === 'changed-target' ? 'needs-review' : 'current');
    assert.deepEqual(started, complete);
    cut = boundary;
  }
  console.log(JSON.stringify({ scenario, optionalSqlBoundaries: complete.length, postExpirySql: 0, finalValidationCompletesAfterExpiry: true }));
});

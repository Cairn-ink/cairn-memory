import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { DatabaseSync } from 'node:sqlite';
import { fixture, host, ns, ok, query } from './card-current-fixture.mjs';

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

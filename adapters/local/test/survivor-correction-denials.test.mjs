import test from 'node:test';
import assert from 'node:assert/strict';
import { transaction } from '../../../core/database.mjs';
import { writeContentSuppressionInside } from '../../../core/content-suppression-storage.mjs';
import { beginContentWriteSafety } from '../../../core/content-write-safety.mjs';
import { registerContentWriteGuard } from '../../../core/content-write-context.mjs';
import { layouts, label, paired, correction, rows, noEcho, sql } from './fixtures/survivor-correction.mjs';
import { checkpoint, bytes } from './fixtures/forget-episode-assertions.mjs';

const denials = ['own memory fact', 'own receipt fact', 'ancestry plus own memory fact',
  'ancestry plus own receipt fact', 'missing canonical row', 'canonical identity mismatch'];
for (const options of layouts.filter(o => o.layout >= 48)) for (const denial of denials)
  test('survivor correction refuses ' + denial + ' ' + label(options), { concurrency: false }, async t => {
    const f = await paired(t, options, denial.startsWith('own') ? null : 'forget');
    if (denial.includes('fact')) sql(f.path, db => transaction(db, () => writeContentSuppressionInside(db, {
      namespace: f.namespace, kind: denial.includes('receipt') ? 'receipt' : 'memory',
      key: denial.includes('receipt') ? f.receipt.id : f.survivor.id,
      reason: denial.startsWith('ancestry') ? 'user_forget' : 'privacy_erase', actionId: 'independent-own-fact' })));
    checkpoint(f); const before = rows(f), oldBytes = bytes(f);
    let restore = () => {}, intercepted = 0;
    if (denial.includes('canonical')) registerContentWriteGuard((db, context) => {
      const state = beginContentWriteSafety(db, context);
      if (context.method !== 'correct') return state;
      const prepare = db.prepare;
      restore = () => { db.prepare = prepare; };
      db.prepare = function (query) {
        const statement = Reflect.apply(prepare, this, [query]);
        // Simulate a canonical safety denial, without corrupting any stored row or bypassing a trigger.
        if (query.startsWith('SELECT id,revision,deleted,currentness,review_state') && query.includes('FROM memories WHERE')) {
          const get = statement.get;
          statement.get = function (...args) {
            intercepted++;
            const row = Reflect.apply(get, this, args);
            return denial.startsWith('missing') ? undefined : { ...row, revision: row.revision + 1 };
          };
        }
        return statement;
      };
      return state;
    });
    let result;
    try { result = await f.core.correct(correction(f)); }
    finally { restore(); registerContentWriteGuard(beginContentWriteSafety); }
    noEcho(result, f.needles);
    assert.deepEqual(result, { ok: false, error: { code: 'memory_suppressed', retryable: false } });
    if (denial.includes('canonical')) assert.equal(intercepted, 1, 'the canonical safety denial was exercised');
    assert.deepEqual(rows(f), before, 'no canonical, history, effect, audit, staged, epoch or fact row changes');
    assert.deepEqual(bytes(f), oldBytes, 'refusal leaves database and WAL byte-unchanged');
  });

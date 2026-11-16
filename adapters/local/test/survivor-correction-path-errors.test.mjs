import test from 'node:test';
import assert from 'node:assert/strict';
import { beginContentWriteSafety } from '../../../core/content-write-safety.mjs';
import { registerContentWriteGuard } from '../../../core/content-write-context.mjs';
import { layouts, label, paired, correction, rows, noEcho } from './fixtures/survivor-correction.mjs';
import { checkpoint, bytes } from './fixtures/forget-episode-assertions.mjs';

for (const options of layouts.filter(o => o.layout >= 48))
  for (const fault of ['unproven ancestry', 'SQLITE_BUSY', 'read_timeout', 'unsupported_database'])
    test('survivor deny branch preserves suppression on ' + fault + ' ' + label(options),
      { concurrency: false }, async t => {
        const f = await paired(t, options, 'forget');
        checkpoint(f); const before = rows(f), oldBytes = bytes(f);
        let restore = () => {}, intercepted = 0;
        registerContentWriteGuard((db, context) => {
          const state = beginContentWriteSafety(db, context);
          if (context.method !== 'correct') return state;
          const prepare = db.prepare; restore = () => { db.prepare = prepare; };
          db.prepare = function (query) {
            if (fault !== 'unproven ancestry' && query.startsWith('SELECT kind,match_mode FROM content_suppressions')) {
              intercepted++;
              throw Object.assign(new Error(fault), fault === 'SQLITE_BUSY' ? { code: 'ERR_SQLITE_ERROR', errcode: 5 } :
                fault === 'read_timeout' ? { code: fault, reason: 'deadline' } : { code: fault });
            }
            const statement = Reflect.apply(prepare, this, [query]);
            // The old fact decision denies on its real Raw span. The complete
            // deny-only traversal must also refuse an unproven ancestry row.
            if (fault === 'unproven ancestry' && query.includes('FROM raw_receipt_lineage l JOIN receipts r') &&
                query.endsWith(' ORDER BY epoch_hi,epoch_lo,fact_id')) {
              const iterate = statement.iterate;
              statement.iterate = function* (...args) {
                for (const row of Reflect.apply(iterate, this, args)) {
                  if (row.ancestry) { intercepted++; yield { ...row, ancestor_owner: 'synthetic-foreign-owner' }; }
                  else yield row;
                }
              };
            }
            return statement;
          };
          return state;
        });
        let result;
        try { result = await f.core.correct(correction(f)); }
        finally { restore(); registerContentWriteGuard(beginContentWriteSafety); }
        assert.ok(intercepted > 0, 'the deny-only fault was reached');
        noEcho(result, f.needles);
        assert.deepEqual(result, { ok: false, error: { code: 'memory_suppressed', retryable: false } });
        assert.deepEqual(rows(f), before);
        assert.deepEqual(bytes(f), oldBytes);
      });

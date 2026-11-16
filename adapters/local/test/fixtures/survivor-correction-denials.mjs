import assert from 'node:assert/strict';
import { transaction } from '../../../../core/database.mjs';
import { writeContentSuppressionInside } from '../../../../core/content-suppression-storage.mjs';
import { beginContentWriteSafety } from '../../../../core/content-write-safety.mjs';
import { registerContentWriteGuard } from '../../../../core/content-write-context.mjs';
import { paired, correction, rows, noEcho, sql } from './survivor-correction.mjs';
import { checkpoint, bytes } from './forget-episode-assertions.mjs';

export const denials = ['own memory fact', 'ancestry plus own memory fact',
  'missing canonical row', 'canonical identity mismatch'];
export const faults = ['unproven ancestry', 'SQLITE_BUSY', 'read_timeout', 'unsupported_database'];

export async function refuseWithDenial(t, options, denial) {
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
  if (denial.includes('canonical')) assert.ok(intercepted > 0, 'the canonical denial was exercised');
  assert.deepEqual(rows(f), before, 'no canonical, history, effect, audit, staged, epoch or fact row changes');
  assert.deepEqual(bytes(f), oldBytes, 'refusal leaves database and WAL byte-unchanged');
  return intercepted;
}

export async function refuseWithFault(t, options, fault) {
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
  noEcho(result, f.needles);
  assert.deepEqual(result, { ok: false, error: { code: 'memory_suppressed', retryable: false } });
  assert.deepEqual(rows(f), before);
  assert.deepEqual(bytes(f), oldBytes);
  return intercepted;
}

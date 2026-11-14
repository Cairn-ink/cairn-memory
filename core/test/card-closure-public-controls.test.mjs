import test from 'node:test';
import assert from 'node:assert/strict';
import { closureStoreKinds, storeLabel, purgeOperations, ordinaryOperations, supportedControl,
  prepareClosureControl } from '../testing/card-closure-controls.mjs';
import { ok } from '../testing/card-lineage-fixture.mjs';
import { beginContentWriteSafety } from '../content-write-safety.mjs';
import { registerContentWriteGuard } from '../content-write-context.mjs';
import { contentSafetyInventory } from '../content-safety-migration.mjs';

for (const kind of closureStoreKinds)
for (const operation of [...purgeOperations, ...ordinaryOperations])
for (const json of ordinaryOperations.includes(operation) ? [false, true] : [false]) {
  const erasure = operation.endsWith('erasure');
  const skip = supportedControl(kind, operation) ? false : erasure
    ? 'legacy layouts have no content-suppression erasure seam'
    : 'conversation deletion requires the Raw facade';
  test(`committed ${erasure ? 'internal' : 'public'} ${operation}, ${storeLabel(kind)}, payload ${json ? 'JSON' : 'plain'}`, { skip }, async t => {
    // Every negative follows its own committed control on the identical layout.
    const positive = await prepareClosureControl(t, kind, operation, json);
    let erasureGuards = 0;
    if (erasure) registerContentWriteGuard((db, context) => {
      erasureGuards++; return beginContentWriteSafety(db, context);
    });
    try {
      const result = await positive.invoke();
      if (erasure) {
        assert.equal(result.ok, true);
        positive.verify(result.value);
      } else positive.verify(ok(result));
    }
    finally { if (erasure) registerContentWriteGuard(beginContentWriteSafety); }
    // Trusted erasure transactions have no facade operation context.
    if (erasure) { assert.equal(erasureGuards, 0); return; }
    if (kind.family === 'legacy') return; // This layout has no write verifier.
    const negative = await prepareClosureControl(t, kind, operation, json);
    let injected = false, refused = false, rolledBack = false, restoreExec;
    registerContentWriteGuard((db, context) => {
      const guard = beginContentWriteSafety(db, context);
      if (!guard) return guard;
      const before = contentSafetyInventory(db);
      return { ...guard, validate(result) {
        const row = db.prepare('SELECT * FROM private_cards WHERE id=?').get(negative.card.id);
        if (!injected && row.revision !== negative.before.revision) {
          assert.equal(db.prepare("UPDATE card_applicability_reviews SET applicability='historical' WHERE card_id=?")
            .run(row.id).changes, 1);
          injected = true;
          const exec = db.exec;
          restoreExec = () => { db.exec = exec; };
          db.exec = function(sql) {
            const value = exec.call(this, sql);
            if (sql === 'ROLLBACK') {
              assert.equal(contentSafetyInventory(db), before, 'complete inventory after native rollback');
              rolledBack = true; restoreExec();
            }
            return value;
          };
        }
        try { guard.validate(result); }
        catch (error) { if (injected) { assert.equal(error.code, 'evidence_unavailable'); refused = true; } throw error; }
      } };
    });
    let result;
    try { result = await negative.invoke(); }
    finally { restoreExec?.(); registerContentWriteGuard(beginContentWriteSafety); }
    assert.equal(injected, true, 'native operation and injected row reach validation');
    // Maintenance catches a verifier exception and returns its native refusal.
    if (operation.startsWith('maintenance') || operation === 'rebuild supersession') {
      const value = ok(result); assert.equal(value.state, 'refused'); assert.equal(value.reason, 'consolidation_failed');
    } else {
      assert.equal(result.ok, false); assert.equal(result.error.code, 'evidence_unavailable');
    }
    assert.equal(refused, true); assert.equal(rolledBack, true);
  });
}

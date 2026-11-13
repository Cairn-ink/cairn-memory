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
  if (!supportedControl(kind, operation)) continue;
  test(`committed public ${operation}, ${storeLabel(kind)}, payload ${json ? 'JSON' : 'plain'}`, async t => {
    // Every negative follows its own committed control on the identical layout.
    const positive = await prepareClosureControl(t, kind, operation, json);
    positive.verify(ok(await positive.invoke()));
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

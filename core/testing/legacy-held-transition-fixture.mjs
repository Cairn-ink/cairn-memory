import assert from 'node:assert/strict';

// Synthetic fixture data for pending review rows left by the earlier engine.
// New captures use memory relations; confirmation/rejection must still resolve
// these existing rows through the current production guards.
export function seedLegacyHeldTransition(db,previousId,replacementId){
 const a=db.prepare('SELECT * FROM memories WHERE id=?').get(previousId),b=db.prepare('SELECT * FROM memories WHERE id=?').get(replacementId);
 assert.ok(a&&b);assert.deepEqual([a.owner_id,a.scope,a.project_id],[b.owner_id,b.scope,b.project_id]);
 if(b.review_state!=='awaiting')return false;
 const previousReceipts=db.prepare('SELECT id FROM receipts WHERE memory_id=? ORDER BY id').all(a.id).map(row=>row.id);
 const replacementReceipt=db.prepare('SELECT id FROM receipts WHERE memory_id=? ORDER BY rowid DESC LIMIT 1').get(b.id);
 assert.ok(previousReceipts.length&&replacementReceipt);
 return Boolean(db.prepare(`INSERT INTO confirmation_supersessions(previous_id,previous_revision,replacement_id,replacement_revision,
   receipt_ids,previous_fingerprint,previous_receipt_ids) VALUES(?,?,?,?,?,?,?)
   ON CONFLICT(previous_id,replacement_id) DO UPDATE SET previous_revision=excluded.previous_revision,
    replacement_revision=excluded.replacement_revision,receipt_ids=excluded.receipt_ids,
    previous_fingerprint=excluded.previous_fingerprint,previous_receipt_ids=excluded.previous_receipt_ids,status='pending',result=NULL
   WHERE confirmation_supersessions.status='dropped'`)
  .run(a.id,a.revision,b.id,b.revision,JSON.stringify([replacementReceipt.id]),a.fingerprint,JSON.stringify(previousReceipts)).changes);
}

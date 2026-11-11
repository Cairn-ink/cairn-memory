import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { semanticFixture, ns, control, reservations } from '../testing/context-semantic-pause-fixture.mjs';

async function stale(s,t) {
  const db=new DatabaseSync(s.f.path);t.after(()=>db.close());
  // Synthetic canonical edit invalidates the old vector proof through the
  // normal namespace fence. Rebuild lexical data before attempting vectors.
  db.prepare("UPDATE memories SET content=content||' changed',revision=revision+1 WHERE owner_id=?").run(ns.ownerId);
  db.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=?').run(ns.ownerId);
  await s.refresh('lexical');return db;
}
function published(s) {
  const db=new DatabaseSync(s.f.path+'.context-read-product-v1.1.sqlite',{readOnly:true});
  try{return ['semantic_vectors','vector_publications','vector_validation_records'].map(table=>db.prepare('SELECT * FROM '+table+' ORDER BY 1').all());}finally{db.close();}
}
for(const setting of [{paused:1},{enabled:0}])test(`product stale vector refresh refuses ${JSON.stringify(setting)} and resumes`,async t=>{
  const s=await semanticFixture(t),db=await stale(s,t);control(db,ns,setting);
  const reserved=reservations(s),publication=published(s),before=s.view[4],result=await s.refresh();assert.deepEqual(reservations(s),reserved,'paused refresh skips provider reservations');assert.deepEqual(published(s),publication,'pause preserves vectors and publications');assert.equal(s.view[4],before,'paused stale text never enters provider');assert.equal(result.progress.embedded,0);
  control(db,ns);const resumed=await s.refresh();assert.equal(resumed.status,'complete');assert.ok(s.view[4]>before);
});
test('product refresh pause inside beforeDispatch leaves vectors unrefreshed until resume',async t=>{
  const s=await semanticFixture(t),db=await stale(s,t),before=s.view[6];s.view[8]=1;
  const publication=published(s),result=await s.refresh();assert.deepEqual(published(s),publication,'pause preserves vectors and publications');assert.equal(s.view[6],before);assert.equal(result.progress.embedded,0);
  control(db,ns);assert.equal((await s.refresh()).status,'complete');assert.ok(s.view[6]>before);
});

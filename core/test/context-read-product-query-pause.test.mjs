import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { semanticFixture, ns, personal, control, reservations } from '../testing/context-semantic-pause-fixture.mjs';

for(const setting of [{paused:1},{enabled:0}])for(const mixed of [false,true])test(`product query refuses ${JSON.stringify(setting)}, mixed=${mixed}`,async t=>{
  const s=await semanticFixture(t,mixed?[ns,personal]:[ns]),db=new DatabaseSync(s.f.path);t.after(()=>db.close());control(db,mixed?personal:ns,setting);
  const reserved=reservations(s),before=s.view[4],result=await s.query();
  assert.deepEqual(reservations(s),reserved,'paused queries skip provider reservations');
  assert.equal(s.view[4],before,'paused read sets never enter the query provider');
  assert.ok(result.metered.items.some(i=>i.ref.id===s.memories[0].id),'lexical Memory remains available');
  assert.equal(result.diagnostics.candidates.trace.semantic.degradedReason,'namespace_paused');
  assert.equal(result.diagnostics.candidates.trace.effective,'lexical');
});
test('product query checks a pause inside provider beforeDispatch',async t=>{
  const s=await semanticFixture(t),before=s.view[6];s.view[8]=1;
  const result=await s.query();assert.equal(s.view[6],before);
  assert.ok(result.metered.items.some(i=>i.ref.id===s.memories[0].id));
  assert.equal(result.diagnostics.candidates.trace.semantic.degradedReason,'namespace_paused');
});

for(const mode of [2,3,4])test(`product query observes control writer mode ${mode} at beforeDispatch`,async t=>{
  const s=await semanticFixture(t),before=s.view[6];s.view[8]=mode;
  const result=await s.query();assert.equal(s.view[6],before,'no provider transmission');
  assert.ok(result.metered.items.some(i=>i.ref.id===s.memories[0].id));
});

for(const mode of [5,6,7,8])test(`product query control mode ${mode} during price estimation prevents provider entry`,async t=>{
  const s=await semanticFixture(t),before=s.view[4];s.view[8]=mode;
  const result=await s.query();assert.equal(s.view[4],before);
  assert.ok(result.metered.items.length);
});

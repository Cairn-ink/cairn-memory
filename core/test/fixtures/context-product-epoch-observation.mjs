// Real native Workers, one shared injected clock, and no wall-time success gate.
import { testClock } from '../../testing/context-product-test-clock.mjs';
import assert from 'node:assert/strict';
import { fixture } from '../../testing/context-read-fixture.mjs';
import { personal, configured } from '../../testing/context-product-owner-fixture.mjs';
import { openContextIndexMaintainer, maintenanceObservation } from '../../context-product-reader.mjs';
const cleanups=[],t={after(fn){cleanups.push(fn);}};
let h;
try {
  const f=fixture(t),service=configured(t,f.path,[personal],{service:true});
  h=await openContextIndexMaintainer({...service.options,deadlineMs:5000});
  const openedAt=testClock.now();
  await testClock.advance(25);
  const before=testClock.now();
  const result=await h.refreshContextIndex({readSet:[personal],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:128,maxMs:1000}},service.token);
  assert.equal(result.ok,true,JSON.stringify(result));
  const fresh=time=>assert.ok(time>=before&&time<=testClock.now(),'fresh_epoch_observation_after_open');
  assert.throws(()=>fresh(openedAt),{code:'ERR_ASSERTION'},'stale_opening_timestamp_is_rejected');
  fresh(maintenanceObservation(result));
  assert.deepEqual(Object.keys(result).sort(),['ok','value']);
  assert.deepEqual(Object.keys(result.value).sort(),['channels','coverage','progress','status']);
} finally {
  await h?.close();
  for(const close of cleanups.reverse())await close();
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile,writeFile,rename } from 'node:fs/promises';
import { fixture,header,item } from './helpers.mjs';
import { runWorker,prepareCapture } from '../worker.mjs';
import { setPaused } from '../../client/control-state.mjs';
import { childAttempt,receiverServer } from './process-harness.mjs';

test('exhaustive real process interruption at every durable write, same authorized retry',async t=>{
  const began=performance.now();let points=0;
  for(const operation of ['prepare','capture','pause-boundary','replacement','oversized']) {
    async function scenario(crashAt=0) {
      const text=header()+Array.from({length:50},(_,i)=>item(`Preference ${i}`,i)).join('');
      const f=await fixture(t,{text});
      const endpoint=await receiverServer(f);
      let byteEnd;
      const run=()=>runWorker(f.binding,{guard:f.guard,transport:f.transport,byteEnd});
      if(operation==='capture') await prepareCapture(f.binding);
      if(operation==='pause-boundary') {
        await run();await setPaused(f.root,true);await appendFile(f.path,item('Paused text',60));await setPaused(f.root,false);
      }
      if(operation==='replacement') {
        await run();await writeFile(f.path+'.new',header()+item('Replacement summary'));
        await rename(f.path+'.new',f.path);
      }
      if(operation==='oversized') {
        await run();await appendFile(f.path,'x'.repeat(1100000));
        byteEnd=(await f.cursor()).offset+1048576-262144-1024;
      }
      const child=await childAttempt(f,{crashAt,prepare:operation==='prepare',endpoint,byteEnd});
      if(child.exit===87) {
        // Real crash left process-owned locks/reservations; verified dead-PID retry reaps them.
        if(operation==='prepare') await prepareCapture(f.binding);else await run();
      }
      const state=await f.cursor();
      const usage=(await f.guard.status()).state;
      assert.ok(usage.used<=usage.cap);assert.ok(usage.reservations.length<=2);
      const semantic={...state,file:'opaque-file',generation:'opaque-generation'};
      const messages=[...f.receiver.values()].flatMap(body=>body.messages.map(m=>m.content)).sort();
      assert.equal(new Set(messages).size,messages.length);
      return {child,semantic,messages,used:usage.used};
    }
    const baseline=await scenario();
    for(let k=1;k<=baseline.child.writes.length;k++) {
      points++;const retried=await scenario(k);
      assert.deepEqual(retried.semantic,baseline.semantic,`${operation} write ${k}`);
      assert.deepEqual(retried.messages,baseline.messages,`${operation} admissions ${k}`);
      // Uncertain dispatched calls count on retry. No refund can equate billing
      // to an uninterrupted run; the oracle checks the conservative direction.
      assert.ok(retried.used>=baseline.used);
    }
    t.diagnostic(`${operation} interruption points=${baseline.child.writes.length}`);
  }
  t.diagnostic(`worker interruption points=${points} runtime_ms=${Math.round(performance.now()-began)}`);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { appendFile,writeFile,rename,readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fixture,header,item } from './helpers.mjs';
import { runWorker,prepareCapture } from '../worker.mjs';
import { setPaused } from '../../client/control-state.mjs';
import { createRuntimeGuard } from '../../client/runtime-usage.mjs';
import { HistoryOracle,seeded } from './history-oracle.mjs';

import { receiverServer,childAttempt } from './process-harness.mjs';

const seeds=[1,7,42,91,12345,65537,0xC0DE,0xCAFEBABE].map(x=>x>>>0);
const ops=['append','replace','truncate','malformed','pause','resume','crash','lost','concurrent'];
for(const seed of seeds) test(`seeded independent history oracle seed=${seed}, 64 operations`,async t=>{
  const began=performance.now(),f=await fixture(t),random=seeded(seed),oracle=new HistoryOracle(header());
  const endpoint=await receiverServer(f);
  const claude=createRuntimeGuard({root:f.root,targetId:f.binding.targetId,mode:'api-key',dailyCap:10000});
  const codex=createRuntimeGuard({root:f.root,targetId:f.binding.targetId,mode:'api-key',dailyCap:10000});
  let usageCalls=0;
  const originalCapture=f.transport.capture;
  f.transport.capture=async body=>{usageCalls++;return originalCapture(body);};
  const run=()=>runWorker(f.binding,{guard:f.guard,transport:f.transport});
  await run();oracle.hook();
  const visited=new Set();
  for(let step=0;step<64;step++) {
    const op=step<ops.length?ops[step]:ops[random()%ops.length];visited.add(op);
    if(op==='pause') {oracle.apply(op);await setPaused(f.root,true);}
    else if(op==='resume') {oracle.apply(op);await setPaused(f.root,false);}
    else if(op==='replace') {
      const bytes=header()+item(`Generated replacement ${seed}-${step}`);
      await writeFile(f.path+'.new',bytes);await rename(f.path+'.new',f.path);
      oracle.apply(op,{size:Buffer.byteLength(bytes)});
    } else if(op==='truncate') {await writeFile(f.path,header());oracle.apply(op,{size:Buffer.byteLength(header())});}
    else if(op==='concurrent') {
      // Independent usage model remembers grants/termination, never reads expected counters from production.
      const attempts=await Promise.allSettled([claude.reserve(),codex.reserve(),claude.reserve()]);
      for(const result of attempts.filter(x=>x.status==='rejected')) assert.match(result.reason.message,/state_busy/);
      const grants=attempts.filter(x=>x.status==='fulfilled').map(x=>x.value);
      const granted=grants.filter(x=>x.ok).length;
      assert.ok(granted<=2);
      usageCalls+=granted;
      assert.equal((await f.guard.status()).state.used,usageCalls);
      let starts=0;
      const dispatches=await Promise.all(grants.filter(x=>x.ok).map((grant,i)=>(i?codex:claude).dispatch(grant.id,()=>{
        starts++;return {operation:Promise.resolve({terminated:true})};
      })));
      assert.equal(starts,granted);
      assert.ok(dispatches.every(x=>x.ok));
      await Promise.all(dispatches.map(x=>x.dispatch.operation));
      for(const grant of grants.filter(x=>x.ok)) await f.guard.release(grant.id,{terminated:true});
      oracle.apply(op);
    } else {
      const text=`Human preference ${seed}-${step}`;
      const bytes=op==='malformed'?'{malformed}\n':item(text,step);
      await appendFile(f.path,bytes);oracle.apply(op,{bytes:Buffer.byteLength(bytes),text:op==='malformed'?null:text});
      if(op==='crash' && !oracle.paused && !oracle.barrier) {
        const child=await childAttempt(f,{crashAt:1+random()%7,endpoint});
        if(child.writes.some(x=>x.category==='usage' && x.kind==='write')) usageCalls++;
      }
      if(op==='lost' && !oracle.paused && !oracle.barrier) {f.fail('lost');await run();f.clear();}
    }
    await run();oracle.hook();
    // Replacement while paused is observed only after resume. Model epoch tracks that observation.
    const state=await f.cursor();
    if(oracle.paused) {
      const actual=[...f.receiver.values()].flatMap(x=>x.messages.map(m=>m.content));
      assert.deepEqual(actual.slice().sort(),oracle.expected.slice().sort());
    } else oracle.assert(assert,state,[...f.receiver.values()]);
    const usage=(await f.guard.status()).state;
    assert.equal(usage.used,usageCalls,'billing oracle derives counts from dispatch/write operation history');
    assert.ok(usage.used>=0 && usage.used<=usage.cap);assert.ok(usage.reservations.length<=2);
  }
  assert.equal(visited.size,ops.length);
  t.diagnostic(`seed=${seed} steps=64 runtime_ms=${Math.round(performance.now()-began)}`);
});

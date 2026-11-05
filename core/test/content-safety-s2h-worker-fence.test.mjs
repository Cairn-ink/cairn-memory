import '../testing/context-product-test-clock.mjs';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';
const complete=familyGate('native worker-fence',36);
const semanticSafetyLayouts=[{version:18,family:'safety'},...([18,23,33].map(version=>({version,family:'event-time'})))];
// Install the shared clock before product factories capture their timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { semanticHandle } from '../context-semantic-coordinator.mjs';
import { setupProductSemantic,ns } from '../testing/content-safety-s2h-product-semantic-probe.mjs';

// Fail-before: the base Worker ignores the private fence record and returns a
// successful snapshot. These exercise binding isolation through native IPC.
for(const layout of semanticSafetyLayouts)for(const journal of ['DELETE','WAL'])for(const field of ['ownerId','storeId','canonicalPath','readSet','operationId','suppressionEpoch'])test(`native content fence isolation ${layout.family} v${layout.version} ${journal} ${field}`,async t=>{
 const portState=new SharedArrayBuffer(64),state=new Int32Array(portState);
 const s=await setupProductSemantic(t,{...layout,safety:true,corpus:1,canonicalMode:journal,host:{portState}});
 const handle=semanticHandle(s.coordinator),port=handle.attach({ownerId:ns.ownerId,path:s.f.path,readSet:[ns],maintenance:false});
 t.after(()=>port.close());
 const operation={operationId:randomUUID(),operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)};
 const fence={ownerId:ns.ownerId,canonicalPath:s.f.path,storeId:s.f.storeId,readSet:[ns],suppressionEpoch:'0:0',operationId:operation.operationId};
 fence[field]=field==='readSet'?[{...ns,ownerId:'foreign-owner'}]:field==='suppressionEpoch'?null:field==='canonicalPath'?s.f.path+'.foreign':'foreign-binding';
 const reply=new Promise(resolve=>port.once('message',resolve));
 // A non-barrier mode counts any callback that an invalid fence admits.
 Atomics.store(state,0,20);
 port.postMessage({id:randomUUID(),method:'snapshot',input:{},operation,contentFence:fence});
 const result=await reply;
 assert.equal(result.ok,false,'mismatched private request fence refuses before snapshot');
 assert.equal(result.safetyFence,true,'isolation refusal survives native IPC');
 assert.equal(result.code,'evidence_unavailable','content-free isolation refusal');
 assert.equal(Atomics.load(state,8),0,'invalid fence admits no caller port');
 assert.doesNotMatch(JSON.stringify(result),/semantic probecommon synthetic evidence/,'control: no protected error text');
 port.close();await s.coordinator.close();await s.supervisor.close();
 if(layout.family==='event-time')complete(t.name);
});

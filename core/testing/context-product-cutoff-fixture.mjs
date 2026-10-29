import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import * as pump from '../context-product-pump.mjs';
import * as productReader from '../context-product-reader.mjs';
const { createProductReaderRuntime } = productReader;
import { createContextReadSupervisor, supervisorOwner } from '../context-read-supervisor.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
export const flush = async () => { for (let i=0;i<30;i++) await Promise.resolve(); };
let identity=100;
export function setup(t,{enabled=true,stalls=1,domains=1,termination,resources,openStall=false,usage=0,paths,refusal,late=false}={}) {
  let now=0,serial=0,attempt=0,stalled=false;
  const timers=new Map(),calls=[],opens=[],closes=[],pumps=[],workers=[];
  const supervisor=createContextReadSupervisor(),token={opaque:randomUUID()},identities=new Map();
  const clock=()=>BigInt(Math.floor(now*1e6));
  const setTimer=(fn,ms)=>{const id={serial:++serial,unref(){}};timers.set(id,{fn,at:now+ms});return id;};
  const clearTimer=id=>timers.delete(id);
  const readSet=[{ownerId:'synthetic-cutoff',scope:'personal',projectId:null}];
  const ownerCoverage={policy:'recent-projects-v1',selectionRevision:'fixture',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const serviceBinding={kind:'service',serviceId:'fixture',credentialBindingId:'fixture',credentialExpiresUtcMs:null,
    credentialDigest:credentialDigest(token),ownerId:readSet[0].ownerId,namespaces:{readSet,ownerCoverage},issuedAt:0};
  const projections=Array.from({length:domains},(_,i)=>({types:['memory'],options:{supervisor,
    path:paths?.[i]??'/synthetic-cutoff-'+randomUUID()+'.sqlite',version:'context-read-v1',profile:PRODUCT_PROFILE,readSet,ownerCoverage,
    sidecarJournalMode:'DELETE',host:{moduleUrl:'file:///synthetic-cutoff-host.mjs',configuration:{serviceBinding}}}}));
  const open=createProductReaderRuntime({maintenance:true,now:clock,utc:()=>1000,setTimer,clearTimer,spawnWorker(data){
    if(!identities.has(data.path))identities.set(data.path,++identity);
    const physical=identities.get(data.path),worker=new EventEmitter();opens.push(data);workers.push(worker);
    Object.assign(worker,{ref(){},unref(){},terminate(){closes.push(data);return termination?.()??Promise.resolve(1);},
      postMessage(message){
        if(message.kind==='identity-ack'){
          if(!openStall)queueMicrotask(()=>worker.emit('message',{operation:data.operation,fileIdentity:'100:'+physical,result:{ok:true,value:null}}));
        }else if(message.method==='close')queueMicrotask(()=>worker.emit('exit',0));
        else {
          calls.push(message);stalled=typeof stalls==='function'?stalls(++attempt):attempt++<stalls;
          if(resources)resources(new Int32Array(data.resources));
          if(!stalled)queueMicrotask(()=>worker.emit('message',{operation:message.operation,
            result:refusal?{ok:false,error:{code:refusal}}:{ok:true,value:{status:'complete',progress:{transformed:usage}}},observedAtMonoMs:now}));
        }
      }});
    queueMicrotask(()=>worker.emit('message',{kind:'identity',operation:data.operation,fileIdentity:'100:'+physical}));
    return worker;
  }});
  const renew=pump.createMaintenancePumpRuntime({now:()=>now,setTimer,clearTimer,open,...(enabled?{cutoffQualified:()=>true}:{})});
  let config={supervisor,id:randomUUID(),window:{id:'window',endsAtMonoMs:60000,usedItems:0,usedMs:0},
    budgets:{maxItems:100,maxMs:50000},quantum:{maxItems:1,maxMs:100},pollMs:1000,renewalMs:60000,
    serviceCredential:token,projections};
  const create=patch=>{config={...config,...patch};const p=renew(config);if(!pumps.includes(p))pumps.push(p);return p;};
  function fire(){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at||a[0].serial-b[0].serial)[0]??[];
    assert.ok(timer,'scheduled timer exists');timers.delete(id);now=Math.max(now,timer.at);return timer.fn();}
  async function due(time){now=time;while([...timers.values()].some(v=>v.at<=now)){fire();await flush();}}
  async function begin(){const operation=fire();await flush();return {operation};}
  async function step(){const {operation}=await begin();if(stalled||openStall)await due(now+100);await operation;await flush();}
  t.after(async()=>{for(const p of pumps)await p.close().catch(()=>{});await supervisor.close().catch(()=>{});});
  return {create,renew,open,config,supervisor,timers,calls,opens,closes,begin,step,due,fire,now:()=>now,set:n=>{now=n;},
    lateReply(){workers[0].emit('message',{operation:calls[0].operation,result:{ok:true,value:{status:'complete',progress:{transformed:0}}},observedAtMonoMs:now});},
    diagnostic:p=>productReader.maintenancePumpCutoffDiagnostic?.(p.getStatus())};
}

// A separate process proves that only usage floors cross the restart boundary.
if(process.argv[2]==='restart-probe'){
  const cleanup=[],input=JSON.parse(process.argv[3]),s=setup({after:f=>cleanup.push(f)},{paths:input.paths});
  try {const p=s.create({window:{...s.config.window,usedItems:input.items,usedMs:input.ms}});
    await s.step();process.stdout.write(JSON.stringify(p.getStatus()));
  } finally {for(const fn of cleanup)await fn();}
}

import { setupProductSemantic } from '../testing/content-safety-s2h-product-semantic-probe.mjs';
import { testClock } from '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { setTimeout as realDelay } from 'node:timers/promises';
import { semanticPump } from '../context-semantic-pump.mjs';
import { maintenanceDispatchControl, maintenanceControlState } from '../context-product-attribution.mjs';
import * as semanticSettlement from '../context-semantic-client.mjs';
const {semanticClient,semanticOutstandingStart}=semanticSettlement;
import { semanticHandle } from '../context-semantic-coordinator.mjs';
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { setup, pumpRuntime, guard, until, ns, ok, nativeClient } from './fixtures/semantic-turn-runtime.mjs';

const flush=async()=>{for(let i=0;i<80;i++)await Promise.resolve();};
function gate(){let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});return {promise,resolve,reject};}
function model(t,{port=true,maxWaitMs=2000}={}){
  let time=0,serial=0,pump,diagnostic;const timers=new Map(),events=[],tickets=[],proof=gate();
  const supervisor=createContextReadSupervisor(),credential={opaque:'synthetic'},coordinator={};
  const state=new SharedArrayBuffer(64);const handles=globalThis[Symbol.for('context-read-product-p2e-v1/handles')];
  const readSet=[{ownerId:'turn-owner',scope:'personal',projectId:null}],ownerCoverage={policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const serviceBinding={kind:'service',serviceId:'synthetic',credentialBindingId:'synthetic',credentialExpiresUtcMs:null,credentialDigest:credentialDigest(credential),ownerId:'turn-owner',namespaces:{readSet,ownerCoverage},issuedAt:0};
  const options={supervisor,path:'/synthetic-'+randomUUID()+'.sqlite',version:'context-read-v1',profile:PRODUCT_PROFILE,readSet,ownerCoverage,host:{moduleUrl:'file:///synthetic-host.mjs',configuration:{serviceBinding}}};
  const s={timers,events,tickets,proof,entry:()=> 'admitted',release:()=>{},operation:async()=>{},count:()=>{},time:()=>time,set:n=>{time=n;},diagnostic:()=>diagnostic};
  const h={closed:()=>false,ownerId:'turn-owner',selection:{},ownerState:state,targets:[],validatePumpCredential(){},
    pumpTurn({semanticOutstanding}){s.buffer=semanticOutstanding;return {proof:proof.promise,detach(){},validate(){throw Error('unexpected validation');}};},
    async pumpCall(method,input,duration,internal){events.push(method);if(internal){s.buffer=internal.semanticOutstanding;const v=semanticOutstandingStart(s.buffer);if(!s.count(method,v)){Atomics.sub(v,0,1);Atomics.notify(v,0);}}
      if(method==='firstCoverage')return {complete:true,pending:false,targetSetDigest:null};
      if(method==='pumpReserve')return {exhausted:true,id:'synthetic',windowId:'window',generation:0,usedItems:1,usedMs:100,usedUsd:'0'};
      if(method==='pumpFinish')return {windowId:'window',generation:0,usedItems:1,usedMs:100,usedUsd:'0'};
    }};handles.set(coordinator,h);
  const preQuantum={version:1,maxWaitMs,createTurn(request){const ticket={request,releases:[]};tickets.push(ticket);events.push('request');return {enter(input){ticket.control=input;return s.entry(ticket);},release(...args){ticket.releases.push(args);events.push('release');s.release(ticket,args);}};}};
  const config={supervisor,id:randomUUID(),window:{id:'window',endsAtMonoMs:60000,usedItems:0,usedMs:0,usedUsd:'0'},budgets:{maxItems:100,maxMs:60000,maxUsd:'0.5'},quantum:{maxItems:1,maxMs:100,maxUsd:'0.01'},pollMs:100,renewalMs:60000,projections:[{options,types:['memory']}],serviceCredential:credential,semanticServiceCredential:credential,semanticConfig:{version:'context-read-product-p2e-v1',coordinator},firstCoverageValidation:{maxTargets:1,maxMs:100},...(port?{preQuantum}:{})};
  const deps={now:()=>time,setTimer:(fn,ms)=>{const id=++serial;timers.set(id,{fn,at:time+ms});return id;},clearTimer:id=>timers.delete(id),snapshot:(_,d)=>{diagnostic=d;},observedAt:()=>time,
    open:async()=>{events.push('open');return {async refreshContextIndex(){events.push('refresh');await s.operation();return {ok:true,value:{progress:{transformed:1}}};},async close(){events.push('dispose');}};}};
  Object.assign(s,{config,preQuantum,h,create(){return pump=semanticPump(config,deps);},renew:()=>semanticPump(config,deps),async fire(){const [id,v]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];timers.delete(id);time=Math.max(time,v.at);return v.fn();},status:()=>pump.getStatus()});
  t.after(async()=>{proof.resolve();await pump?.close().catch(()=>{});await supervisor.close().catch(()=>{});handles.delete(coordinator);});return s;
}

test('route a holds release until control handler settlement and seals the turn',async t=>{
  const s=model(t);let view;s.count=(method,v)=>{if(method==='firstCoverage'){view=v;return true;}};s.create();const work=s.fire();await flush();
  assert.ok(view);assert.equal(s.tickets[0].releases.length,0);assert.equal(Atomics.load(view,1),1);
  Atomics.sub(view,0,1);Atomics.notify(view,0);await guard(work,'control settle');assert.deepEqual(s.tickets[0].releases,[['settled']]);
});
test('port is awaited before ordinal, calls, watchdog and reader work; deferral is private',async t=>{
  const s=model(t),queued=gate();s.entry=()=>queued.promise;s.create();const ordinal=maintenanceControlState(maintenanceDispatchControl()).ordinal,work=s.fire();await flush();
  assert.equal(maintenanceControlState(maintenanceDispatchControl()).ordinal,ordinal+1,'waiting consumes no dispatch ordinal');
  assert.deepEqual(s.events,['request']);assert.equal(s.timers.size,1);assert.equal(s.status().usedItems,0);assert.equal(s.diagnostic().turnPhase,'waiting');
  queued.resolve('defer');await guard(work,'defer');assert.deepEqual(s.tickets[0].releases,[['withdrawn']]);assert.equal(s.status().error,null);assert.equal(s.diagnostic().deferredTurns,1);
  assert.ok([...s.timers.values()][0].at>=s.time()+100);assert.deepEqual(Object.keys(s.status()).sort(),['error','id','maxItems','maxMs','maxUsd','state','usedItems','usedMs','usedUsd','windowId']);
});
for(const mode of ['close','supervisor','renewal','new-window','authority','window','wait_expired'])test('queued '+mode+' withdraws once and ignores late grant',async t=>{
  const s=model(t),queued=gate();if(mode==='authority')s.config.renewalMs=1000;if(mode==='window')s.config.window.endsAtMonoMs=1000;s.entry=()=>queued.promise;const p=s.create(),work=s.fire();await flush();let closing;
  if(mode==='close')closing=p.close();else if(mode==='supervisor')closing=s.config.supervisor.close();else if(mode==='renewal')s.renew();else if(mode==='new-window'){s.set(60000);s.config.window={...s.config.window,id:'next',endsAtMonoMs:120000};s.renew();}else{const [id,v]=[...s.timers][0];s.timers.delete(id);s.set(['authority','window'].includes(mode)?1000:v.at);v.fn();}
  await guard(work,'withdrawal');queued.resolve('admitted');await flush();await closing;
  assert.deepEqual(s.tickets[0].releases,[['withdrawn']]);assert.equal(s.events.includes('open'),false);assert.equal(s.status().error,null);assert.equal(s.diagnostic().lastFailure,null);
});
test('host throw fails closed without inspecting host error',async t=>{
  const s=model(t);s.entry=()=>{throw Error('synthetic');};s.create();await guard(s.fire(),'host throw');assert.equal(s.status().error,'authority_required');assert.deepEqual(s.tickets[0].releases,[['withdrawn']]);
});
test('late increment after release fails loudly, is never counted, and poisons successor',async t=>{
  const s=model(t),first=s.create();await guard(s.fire(),'turn');const v=new Int32Array(s.buffer);
  assert.deepEqual(s.tickets[0].releases,[['settled']]);
  const port=new EventEmitter();let posts=0;port.postMessage=()=>posts++;
  const client=semanticClient(port,{ownerState:new SharedArrayBuffer(64),writer:'0'},()=>({operationId:randomUUID(),operationCutoffMonoNs:String(process.hrtime.bigint()+1000000000n)}),{semanticOutstanding:()=>s.buffer});
  await assert.rejects(guard(client.call('embed'),'late embed refusal',1000),{code:'reader_failed'});assert.equal(posts,0);assert.equal(v[0],0);
  await until(()=>s.status().error!==null,'late violation observed');assert.equal(s.status().error,'reader_failed');assert.equal(s.diagnostic().turnPhase,'poisoned');assert.equal(s.tickets[0].releases.length,1);
  await first.close();s.config.id=randomUUID();delete s.config.preQuantum;s.create();await guard(s.fire(),'poisoned successor');assert.equal(s.status().error,'reader_failed');assert.equal(s.tickets.length,1);
});
for(const failed of [false,true])test('close with unsettled work keeps grant for host proof '+failed,async t=>{
  const s=model(t);let view;s.count=(method,v)=>{if(method==='firstCoverage'){view=v;return true;}};const p=s.create(),work=s.fire();await flush();
  const close=p.close();await guard(work,'stopped join');await guard(close,'pump close');assert.equal(s.tickets[0].releases.length,0);
  if(failed)s.proof.reject(Error('synthetic disposal failure'));else{Atomics.sub(view,0,1);Atomics.notify(view,0);s.proof.resolve();}await flush();
  assert.deepEqual(s.tickets[0].releases,failed?[]:[['settled']]);if(failed)assert.equal(s.status().error,'reader_failed');
});
test('failed post decrements synchronously and removes its pending timer',async()=>{
  const port=new EventEmitter(),outstanding=new SharedArrayBuffer(8);port.postMessage=()=>{assert.equal(new Int32Array(outstanding)[0],1,'count precedes post');throw Error('synthetic post failure');};
  const client=semanticClient(port,{ownerState:new SharedArrayBuffer(64),writer:'0'},()=>({operationCutoffMonoNs:String(process.hrtime.bigint()+1000000000n)}));
  await assert.rejects(client.call('snapshot',{},undefined,{semanticOutstanding:outstanding}),/synthetic post failure/);assert.equal(new Int32Array(outstanding)[0],0);
});
test('coordinator public call surface and signal-only allowlist exclude settlement metadata',()=>{
  const source=readFileSync(new URL('../context-semantic-coordinator.mjs',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('  function call(method'),source.indexOf('  const api=Object.freeze'));
  assert.match(fn,/ownData\(control,\['signal'\]\)/);assert.doesNotMatch(fn,/semanticOutstanding/);
  assert.match(source,/\['setOwnerSemantic','getOwnerSemanticStatus','validateOwnerSemanticCoverage','purgeOwnerVectors'\]/);
});

function broker(runtime){const tickets=[];runtime.config.preQuantum={version:1,maxWaitMs:2000,createTurn(request){const item={request,releases:[]};tickets.push(item);return {enter:()=> 'admitted',release:(...args)=>item.releases.push(args)};}};return tickets;}
test('native startup, lexical and embedding slots each use one turn; batches share their grant',async t=>{
  const s=await setup(t,{maxBatchDocuments:1}),r=pumpRuntime(s,{native:true});r.config.quantum.maxItems=2;const tickets=broker(r),p=r.renew(r.config);s.f.workspace.defer(()=>guard(p.close(),'pump close'));
  const batches=[];
  for(let i=0;i<6;i++){const before=new Int32Array(s.state)[4];await guard(r.step(),'native step');batches.push(new Int32Array(s.state)[4]-before);assert.equal(p.getStatus().error,null);assert.equal(tickets.length,i+1);assert.deepEqual(tickets[i].releases,[['settled']]);}
  t.diagnostic(JSON.stringify({kinds:tickets.map(x=>x.request.kind),batches}));
  assert.ok(batches.includes(2),'two provider batches in one selected turn share its one grant');
  for(const ticket of tickets)assert.equal(ticket.request.intent,ticket.request.kind==='lexical'?ticket.request.lane===1?'current':'history':null,'intent belongs only to lexical work');
  assert.ok(tickets.some(x=>x.request.kind==='status'));assert.ok(tickets.some(x=>x.request.kind==='lexical'));assert.ok(tickets.some(x=>x.request.kind==='embeddings'));
  const messages=r.spawned.flatMap(x=>x.outbound).filter(x=>x.method==='refreshContextIndex');assert.ok(messages.length);
  assert.ok(messages.every(x=>x.semanticOutstanding instanceof SharedArrayBuffer));assert.ok(messages.every(x=>x.semanticOutstanding.byteLength===8));
});
for(const malformed of ['type','length'])test('reader fails closed for malformed semanticOutstanding '+malformed,async t=>{
  const s=await setup(t),r=pumpRuntime(s,{native:true}),tickets=broker(r),p=r.renew(r.config);s.f.workspace.defer(()=>guard(p.close(),'pump close'));
  await guard(r.step(),'startup');const capture=r.spawned[0],post=capture.worker.postMessage.bind(capture.worker);
  capture.worker.postMessage=(message,...args)=>post(message.method==='refreshContextIndex'?{...message,semanticOutstanding:malformed==='type'?{}:new SharedArrayBuffer(4)}:message,...args);
  await guard(r.step(),'malformed reader');assert.equal(p.getStatus().error,'authority_required');assert.deepEqual(tickets[1].releases,[['settled']]);
});

async function delayed(t,{crash=false,safety=false}={}){
  const turnControl=new SharedArrayBuffer(64),state=new Int32Array(turnControl);
  const s=await setup(t,{safety,expectedCleanupFailure:crash,isolated:crash,coordinatorHost:new URL('./fixtures/semantic-turn-host.mjs',import.meta.url).href,coordinatorConfiguration:{turnControl}});
  s.f.workspace.defer(()=>{for(const at of [2,6]){Atomics.store(state,at,1);Atomics.notify(state,at);}});
  const r=pumpRuntime(s,{native:true}),tickets=broker(r),p=r.renew(r.config);s.f.workspace.defer(()=>guard(p.close(),'delayed pump close').catch(()=>{}));
  state[0]=crash?2:1;
  for(let i=0;i<8;i++){
    const previous=tickets.length,work=r.step();let done=false;work.finally(()=>{done=true;}).catch(()=>{});
    await until(()=>tickets.length>previous||done,'selected turn');const ticket=tickets.at(-1);
    if(ticket.request.kind==='embeddings')return {s,r,tickets,p,state,ticket,work};
    await guard(work,'pre-embedding turn');
  }
  throw Error('embedding slot missing');
}
function partialMessage(r){return r.spawned.flatMap(x=>x.inbound).find(m=>m.result?.ok&&m.result.value?.status==='partial'&&m.result.value?.progress?.embeddingAttempts===1);}
for(const ledger of [false,true])test('route b: ok partial after client timeout holds provider'+(ledger?' and ledger attempt':''),async t=>{
  const d=await delayed(t),{s,r,state,ticket,work}=d;await until(()=>state[1]===1,'provider started');if(ledger)state[4]=1;
  await guard(s.advance(426),'provider deadline');await until(()=>partialMessage(r),'reader ok partial');
  const buffer=r.spawned.flatMap(x=>x.outbound).find(m=>m.input?.mode==='embeddings').semanticOutstanding,view=new Int32Array(buffer);
  await until(()=>Atomics.load(view,1)===1,'turn sealed');
  assert.equal(Atomics.load(state,1),1,'one provider batch was dispatched');
  // The join counts control handlers too. A pumpFinish reply can arrive before
  // its Worker's finally decrements, so sealing need not leave exactly one call.
  assert.ok(Atomics.load(view,0)>=1,'the blocked provider is still outstanding');assert.deepEqual(ticket.releases,[]);
  Atomics.store(state,2,1);Atomics.notify(state,2);
  if(ledger){await until(()=>state[5]===1,'ledger attempt pending');assert.ok(Atomics.load(view,0)>=1,'the blocked ledger attempt is still outstanding');assert.deepEqual(ticket.releases,[]);Atomics.store(state,6,1);Atomics.notify(state,6);}
  await guard(work,'notified settlement',1000);assert.equal(Atomics.load(view,0),0);assert.deepEqual(ticket.releases,[['settled']]);assert.equal(d.p.getStatus().error,null);
});

test('bounded wait expires without releasing, then failed disposal proof poisons',async t=>{
  const s=model(t);s.count=method=>method==='firstCoverage';s.create();await guard(s.fire(),'engine bounded join',7000);
  assert.deepEqual(s.tickets[0].releases,[]);s.status();assert.equal(s.diagnostic().turnPhase,'settling');s.proof.reject(Error('synthetic failed proof'));await flush();s.status();assert.equal(s.diagnostic().turnPhase,'poisoned');assert.equal(s.status().error,'reader_failed');
});
test('semantic Worker crash mid-call takes bounded proof path and withholds poisoned grant',async t=>{
  const {s,p,state,ticket,work}=await delayed(t,{crash:true});await until(()=>state[1]===1,'provider crash marker');
  await guard(work,'crash bounded join',7000);assert.deepEqual(ticket.releases,[]);assert.equal(p.getStatus().error,'reader_failed');assert.equal((await import('../context-product-pump.mjs')).maintenancePumpDiagnostic(p.getStatus()).turnPhase,'poisoned');
  await assert.rejects(guard(s.coordinator.close(),'failed crash proof'),{code:'reader_failed'});
});
test('route c validation timer replies before its ledger handler and holds the turn',async t=>{
  const turnControl=new SharedArrayBuffer(64),state=new Int32Array(turnControl);
  const s=await setup(t,{coordinatorHost:new URL('./fixtures/semantic-turn-host.mjs',import.meta.url).href,coordinatorConfiguration:{turnControl}}),r=pumpRuntime(s,{native:true}),tickets=broker(r),p=r.renew(r.config);
  s.f.workspace.defer(()=>{state[6]=1;Atomics.notify(state,6);});s.f.workspace.defer(()=>guard(p.close(),'validation pump close'));
  let validationBuffer;const internal=semanticHandle(s.coordinator),pumpTurn=internal.pumpTurn;internal.pumpTurn=function(input){validationBuffer=input.semanticOutstanding;return pumpTurn.call(this,input);};
  // Complete both intent publications before selecting the pump's validation.
  const configured=s.configure(),h=await (await import('../context-product-reader.mjs')).openContextIndexMaintainer(configured.options);s.f.workspace.defer(()=>guard(h.close(),'validation prebuild close'));
  for(const intent of ['current','history'])ok(await guard(h.refreshContextIndex({readSet:[ns],types:['memory'],intent,mode:'embeddings',budget:{maxItems:1024,maxMs:5000,maxUsd:'0.5'}},configured.credential),'validation publication'));await guard(h.close(),'prebuild close');
  let work,ticket;
  for(let i=0;i<12;i++){
    const n=tickets.length;state[4]=2;work=r.step();let done=false;work.finally(()=>{done=true;}).catch(()=>{});await until(()=>tickets.length>n||done,'validation selection');ticket=tickets.at(-1);
    if(ticket.request.kind==='validation')break;await guard(work,'pre-validation turn');
  }
  assert.equal(ticket.request.kind,'validation');await until(()=>state[5]===1,'validation ledger gate');assert.equal(new Int32Array(validationBuffer)[0],1,'validation counted before handler settlement');
  // Stop the main-thread API on its own timer without ticking the blocked Worker.
  await guard(s.advance(501,{waitForWorkers:false}),'validation timer');await flush();assert.deepEqual(ticket.releases,[]);
  Atomics.store(state,6,1);Atomics.notify(state,6);await guard(work,'validation ledger settlement',1000);await guard(s.coordinator.close(),'validation coordinator proof');await until(()=>ticket.releases.length===1,'validation release');assert.deepEqual(ticket.releases,[['settled']]);
});

test('retained settlement debt counts done, releases turn, next admission drains exact usage',async t=>{
  const turnControl=new SharedArrayBuffer(64),v=new Int32Array(turnControl);
  const s=await setupProductSemantic(t,{safety:true,corpus:2,coordinatorHost:new URL('./fixtures/semantic-turn-host.mjs',import.meta.url).href,host:{turnControl,cutoffControl:new SharedArrayBuffer(64)}});
  ok(await guard(s.coordinator.setOwnerSemantic({ownerId:ns.ownerId,semantic:true,expectedRevision:0},s.token),'enable retained owner'));
  const m=s.configure(true),h=await (await import('../context-product-reader.mjs')).openContextIndexMaintainer(m.options);s.f.workspace.defer(()=>h.close());
  for(const mode of ['lexical','embeddings'])ok(await guard(h.refreshContextIndex({readSet:[ns],types:['memory'],intent:'current',mode,budget:{maxItems:1024,maxMs:5000,...(mode==='embeddings'?{maxUsd:'0.5'}:{})}},m.credential),'retained publication'));
  const n=await nativeClient(t,s,m),mover=model(t);v[0]=1;v[2]=1;v[4]=3;const original=mover.h.pumpCall;
  mover.h.pumpCall=async(method,input,duration,internal)=>{
    if(method==='firstCoverage')await n.client.call('embed',{texts:['synthetic retained usage'],kind:'query',expected:n.snapshot.policy,projection:n.projection},undefined,internal).catch(()=>{});
    return original(method,input,duration,internal);
  };
  mover.create();await guard(mover.fire(),'retained debt grant');assert.equal(v[7],1,'failed settlement was attempted');assert.equal(new Int32Array(mover.buffer)[0],0);assert.deepEqual(mover.tickets[0].releases,[['settled']]);
  const {DatabaseSync}=await import('node:sqlite'),db=new DatabaseSync(s.ledgerPath);s.f.workspace.defer(()=>db.close());
  const read=()=>JSON.parse(db.prepare('SELECT state FROM semantic_owners WHERE owner_id=?').get(ns.ownerId).state);
  const retained=Object.values(read().reservations).find(r=>r.status==='may_transmit');assert.ok(retained,'debt is still retained before next admission');
  await guard(n.client.snapshot(),'next admission');const settled=read().reservations[retained.id];assert.equal(settled.status,'settled');assert.equal(settled.usage,'validated');assert.equal(settled.cost,String((await import('../context-semantic-input.mjs')).tokenCost(Buffer.byteLength('synthetic retained usage'),retained.price.rate)));
});
test('late increment on a sealed outstanding turn fails and poisons without counting',async t=>{
  const s=model(t);let v;s.count=(method,view)=>{if(method==='firstCoverage'){v=view;return true;}};s.create();const work=s.fire();await flush();
  assert.equal(v[0],1);assert.equal(v[1],1);assert.throws(()=>semanticOutstandingStart(s.buffer),{code:'reader_failed'});assert.equal(v[0],1);await guard(work,'late increment rejection');assert.deepEqual(s.tickets[0].releases,[]);assert.equal(s.status().error,'reader_failed');
  Atomics.sub(v,0,1);Atomics.notify(v,0);
});
test('a grant racing renewal is declined once; subsequent late result cannot dispatch',async t=>{
  const s=model(t),entry=gate();s.entry=()=>entry.promise;s.create();const work=s.fire();await flush();s.renew();entry.resolve('admitted');await guard(work,'grant renewal race');assert.deepEqual(s.tickets[0].releases,[['declined','generation_changed']]);assert.equal(s.events.includes('open'),false);
});
test('close racing settlement and successful proof releases exactly once',async t=>{
  const s=model(t);let v;s.count=(method,view)=>{if(method==='firstCoverage'){v=view;return true;}};const p=s.create(),work=s.fire();await flush();
  const close=p.close();Atomics.sub(v,0,1);Atomics.notify(v,0);s.proof.resolve();await guard(work,'close race');await guard(close,'close');await flush();assert.deepEqual(s.tickets[0].releases,[['settled']]);
});
test('absent port allocates no join and preserves control messages and output',async t=>{
  const s=model(t,{port:false}),NativeShared=globalThis.SharedArrayBuffer;let allocations=0;
  s.create();
  globalThis.SharedArrayBuffer=class extends NativeShared{constructor(...args){super(...args);allocations++;}};
  try{await guard(s.fire(),'absent turn');assert.equal(allocations,0);assert.equal(s.buffer,undefined);assert.equal(s.tickets.length,0);assert.equal('turnPhase' in (s.status(),s.diagnostic()),false);}
  finally{globalThis.SharedArrayBuffer=NativeShared;}
  const {id,...output}=s.status();const evidence={output,messages:s.events,allocations};
  if(process.env.C2_ABSENCE_OUTPUT)writeFileSync(process.env.C2_ABSENCE_OUTPUT,JSON.stringify(evidence,null,2)+'\n');
  assert.deepEqual(s.events,['firstCoverage','pumpReserve']);
  const {output:expected,messages,allocations:count}=JSON.parse(readFileSync(new URL('./fixtures/semantic-turn-absence-main.json',import.meta.url),'utf8')).evidence;
  assert.equal(JSON.stringify(evidence),JSON.stringify({output:expected,messages,allocations:count}),'absent model byte differential from archived main');
});

// Golden evidence was generated from archived c4e6b6e0 with the same model
// operation and six native steps. Stable DTO values and every statement count
// remain asserted after normalization of random identity and clock metadata.
test('absent port native DTOs, SQL counts, allocations and messages match archived engine',async t=>{
  const s=await setup(t),r=pumpRuntime(s,{native:true}),NativeShared=globalThis.SharedArrayBuffer,allocations=[];
  globalThis.SharedArrayBuffer=function(n){allocations.push(n);return new NativeShared(n);};globalThis.SharedArrayBuffer.prototype=NativeShared.prototype;
  let p;
  try{p=r.renew(r.config);for(let i=0;i<6;i++){assert.equal(p.getStatus().error,null,'absent native status '+i+': '+JSON.stringify(p.getStatus()));await guard(r.step(),'absent native step');}await guard(p.close(),'absent native close');}
  finally{globalThis.SharedArrayBuffer=NativeShared;}
  function clean(value){
    if(typeof value==='string'&&(/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)||/^[0-9a-f]{64}$/.test(value)||value.startsWith('/')||/^\d+:\d+(?::\d+)*$/.test(value)))return '<opaque>';
    if(Array.isArray(value))return value.map(clean);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['ordinal','enteredMonoNs','operationCutoffMonoNs','dispatchMs','finishedAtMonoMs'].includes(k)).map(([k,v])=>[k,clean(v)]));
    return value;
  }
  const frames=r.spawned.flatMap(c=>[c.data.frame,...c.outbound.map(m=>m.frame)]).filter(Boolean);
  const native={allocations,statements:frames.map(f=>{const v=new Int32Array(f.buffer);return {begun:v[0],completed:v[1],failures:v[2]};}),messages:r.spawned.flatMap(c=>c.outbound).map(m=>({method:m.method,keys:Object.keys(m).sort(),input:clean(m.input)})),outputs:r.spawned.flatMap(c=>c.inbound).filter(m=>m.result).map(m=>clean(m.result)),status:clean(p.getStatus())};
  delete native.status.id;delete native.status.windowId;
  const baseline=JSON.parse(readFileSync(new URL('./fixtures/semantic-turn-absence-main.json',import.meta.url),'utf8'));
  assert.equal(baseline.sourceRevision,'c4e6b6e0');
  assert.deepEqual(native.statements,baseline.evidence.native.statements,'absent-port SQL statement differential from archived main');
  // The semantic coordinator now reserves this same process domain during
  // setup. Its buffer therefore precedes the measured pump span; retain the
  // archived fixture and compare every remaining allocation/message/DTO byte.
  const expected=structuredClone(baseline.evidence.native);
  assert.equal(expected.allocations[8],4096,'archived first-reader domain allocation');
  expected.allocations.splice(8,1);
  assert.equal(JSON.stringify(native),JSON.stringify(expected),'absent-port byte differential: shared domain, allocations, messages, DTOs and status');
  if(process.env.C2_ABSENCE_OUTPUT){const path=process.env.C2_ABSENCE_OUTPUT;let evidence={};try{evidence=JSON.parse(readFileSync(path,'utf8'));}catch{}writeFileSync(path,JSON.stringify({...evidence,native},null,2)+'\n');}
});

test('semantic Worker rejects malformed turn buffers before executing a handler',async t=>{
  const s=await setup(t),handle=semanticHandle(s.coordinator);
  assert.deepEqual(Object.keys(s.coordinator).sort(),['close','getOwnerSemanticStatus','purgeOwnerVectors','setOwnerSemantic','validateOwnerSemanticCoverage']);
  const denied=await s.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},s.token,{semanticOutstanding:new SharedArrayBuffer(8)});assert.equal(denied.ok,false);assert.equal(denied.error.code,'invalid_input');
  for(const semanticOutstanding of [{},new SharedArrayBuffer(4)]){
    const port=handle.attach({ownerId:ns.ownerId,pump:true});
    try{const message=new Promise(resolve=>port.once('message',resolve));port.postMessage({id:randomUUID(),method:'firstCoverage',input:{},operation:{operationId:randomUUID(),operationCutoffMonoNs:String(process.hrtime.bigint()+5000000000n)},semanticOutstanding});const reply=await guard(message,'malformed semantic Worker');assert.equal(reply.ok,false);assert.equal(reply.code,'ledger_unavailable');}
    finally{port.close();}
  }
});

test('a failed coordinator disposal proof before finalization poisons even a control-only turn',async t=>{
  const s=model(t),original=s.h.pumpCall;s.h.pumpCall=(...args)=>{if(args[0]==='firstCoverage')s.proof.reject(Error('synthetic failed disposal'));return original(...args);};s.create();await guard(s.fire(),'failed proof');assert.deepEqual(s.tickets[0].releases,[]);assert.equal(s.status().error,'reader_failed');assert.equal(s.diagnostic().turnPhase,'poisoned');
});

test('timeout racing native provider settlement releases once through disposal proof',async t=>{
  const {s,p,state,ticket,work}=await delayed(t);await until(()=>state[1]===1,'racing provider');
  const cutoff=s.advance(500,{waitForWorkers:false});Atomics.store(state,2,1);Atomics.notify(state,2);await guard(cutoff,'racing cutoff');await guard(work,'racing turn',7000);await guard(p.close(),'racing pump close');await guard(s.coordinator.close(),'racing coordinator proof');await until(()=>ticket.releases.length===1,'racing release');assert.deepEqual(ticket.releases,[['settled']]);
});
test('waiting adds no work charge or failure and preserves honest observation duty',async t=>{
  const s=model(t,{maxWaitMs:5000}),queued=gate();s.entry=()=>queued.promise;s.create();const work=s.fire();await flush();s.set(s.time()+6000);queued.resolve('defer');await guard(work,'late scheduling defer');
  assert.equal(s.status().error,null);assert.equal(s.status().usedMs,0);assert.equal(s.diagnostic().lastFailure,null);assert.equal(s.diagnostic().turnWaitMs,6000);assert.equal(s.diagnostic().cadenceMisses,2);assert.equal(s.diagnostic().missedObservations,2);
  s.renew();s.status();assert.equal(s.diagnostic().cadenceMisses,2);assert.equal(s.diagnostic().missedObservations,2,'one miss per overdue interval');
});

test('a throwing release is attempted once and poisons the semantic claim',async t=>{
  const s=model(t);s.release=()=>{throw Error('synthetic release failure');};s.create();await guard(s.fire(),'throwing release');assert.deepEqual(s.tickets[0].releases,[['settled']]);assert.equal(s.status().error,'reader_failed');assert.equal(s.diagnostic().turnPhase,'poisoned');
});
test('a throwing turn factory fails closed before any ticket or work',async t=>{
  const s=model(t);s.preQuantum.createTurn=()=>{throw Error('synthetic factory failure');};s.create();await guard(s.fire(),'throwing factory');assert.equal(s.status().error,'authority_required');assert.deepEqual(s.events,[]);assert.equal(s.tickets.length,0);
});

test('a late internal validation call fails before posting and poisons the sealed grant',async t=>{
  const native=await setup(t),s=model(t),handle=semanticHandle(native.coordinator),start=handle.pumpTurn;let validation;
  s.h.pumpTurn=input=>(validation=start.call(handle,input));s.create();await guard(s.fire(),'validation sealed turn');assert.deepEqual(s.tickets[0].releases,[['settled']]);
  const status=ok(await guard(native.coordinator.getOwnerSemanticStatus({ownerId:ns.ownerId},native.token),'validation status')),view=new Int32Array(s.buffer);
  const result=await guard(validation.validate({ownerId:ns.ownerId,expectedTargetDigest:status.firstCoverage.targetSetDigest,budget:{maxTargets:1,maxMs:100}},native.token),'late validation refusal');
  assert.equal(result.ok,false);assert.equal(result.error.code,'reader_failed');assert.equal(view[0],0);await until(()=>s.status().error!==null,'late validation poisoned');assert.equal(s.status().error,'reader_failed');assert.equal(s.tickets[0].releases.length,1);
});

test('renewal cancellation after an overdue lookahead retains retry spacing without a failure',async t=>{
  const s=model(t,{maxWaitMs:5000}),entry=gate();s.entry=()=>entry.promise;s.create();const work=s.fire();await flush();s.set(s.time()+1500);s.renew();await guard(work,'overdue renewal cancellation');assert.ok([...s.timers.values()].every(v=>v.at>=s.time()+100),'cancelled retry never spins at zero delay');assert.equal(s.status().error,null);assert.equal(s.status().usedMs,0);assert.equal(s.diagnostic().lastFailure,null);entry.resolve('admitted');await flush();assert.deepEqual(s.tickets[0].releases,[['withdrawn']]);
});

for(const failed of [false,true])test('expiry boundary requires disposal proof '+failed,async t=>{
  const s=model(t);s.count=method=>method==='firstCoverage';s.create();
  const original=Atomics.waitAsync;let expired=false;
  Atomics.waitAsync=function(view,index,expected,timeout){
    const result=Reflect.apply(original,Atomics,[view,index,expected,timeout]);
    if(view.buffer===s.buffer&&index===0&&result.async)return {async:true,value:result.value.then(reason=>{
      if(reason==='timed-out'){
        expired=true;
        // Deterministic rendezvous: settlement wins after the wait has already
        // expired, before the finalizer's subsequent release/proof decision.
        Atomics.sub(view,0,1);Atomics.notify(view,0);
      }
      return reason;
    })};
    return result;
  };
  try{await guard(s.fire(),'review expired join',7000);}finally{Atomics.waitAsync=original;}
  assert.equal(expired,true,'the atomic wait itself reported expiry');
  t.diagnostic(JSON.stringify({expired,outstanding:new Int32Array(s.buffer)[0],releases:s.tickets[0].releases}));
  assert.deepEqual(s.tickets[0].releases,[],'expiry must retain the registered host disposal proof even if settlement then reaches zero');
  if(failed)s.proof.reject(Error('synthetic failed proof'));else s.proof.resolve();
  await flush();assert.deepEqual(s.tickets[0].releases,failed?[]:[['settled']]);
  if(failed){assert.equal(s.status().error,'reader_failed');assert.equal(s.diagnostic().turnPhase,'poisoned');}
});

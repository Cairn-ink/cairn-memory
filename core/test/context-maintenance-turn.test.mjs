import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { captureMaintenanceTurnPort, maintenanceTurnRequest, createMaintenanceTurnController, maintenanceTurnPoisoned } from '../context-maintenance-turn.mjs';

const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
const pending=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const request=()=>({version:1,pumpId:'pump',windowId:'window',lane:0,family:'lexical',kind:'lexical',phase:'admission',intent:'current',maxMs:1000});
function setup(factory=()=>({enter:()=> 'admitted',release(){}})){
  let time=0;const timers=new Map(),port={version:1,maxWaitMs:1000,createTurn:factory},identity={key:randomUUID(),physical:randomUUID()};
  const clock={now:()=>time,setTimer:(f,ms)=>{const id={};timers.set(id,{f,at:time+ms});return id;},clearTimer:id=>timers.delete(id)};
  const turns=createMaintenanceTurnController(captureMaintenanceTurnPort(port),clock),abort=new AbortController();
  return {turns,port,identity,abort,timers,clock,set:n=>{time=n;},
    wait:()=>turns.wait(request(),{identity,signal:abort.signal,untilMonoMs:1000}),
    async deadline(){time=1000;for(const {f} of [...timers.values()])f();await flush();}};
}

test('port validation refuses accessors and proxies without executing them',()=>{
  assert.equal(maintenanceTurnPoisoned(()=>assert.fail('unbrokered identity probe without any poison')),false);
  let calls=0;const trap=()=>{calls++;throw Error('must be inert');};
  for(const value of [new Proxy({}, {get:trap,getPrototypeOf:trap,ownKeys:trap,getOwnPropertyDescriptor:trap}),
    {version:1,maxWaitMs:1000,get createTurn(){return trap();}},
    Object.create(new Proxy({}, {getPrototypeOf:trap,getOwnPropertyDescriptor:trap})),
    {version:1,maxWaitMs:1000,createTurn:new Proxy(()=>{}, {apply:trap})}])
    assert.throws(()=>captureMaintenanceTurnPort(value),{code:'invalid_input'});
  assert.equal(calls,0);assert.equal(captureMaintenanceTurnPort(undefined),undefined);
  for(const patch of [{version:2},{maxWaitMs:0},{maxWaitMs:5001},{maxWaitMs:1.5},{createTurn:null}])
    assert.throws(()=>captureMaintenanceTurnPort({version:1,maxWaitMs:1000,createTurn(){},...patch}),{code:'invalid_input'});
});

test('maxWaitMs defaults only when absent and validates present data without invoking accessors',async()=>{
  const createTurn=()=>({enter:()=> 'admitted',release(){}});
  assert.equal(captureMaintenanceTurnPort({version:1,createTurn}).maxWaitMs,2000);
  for(const maxWaitMs of [1,5000]){
    assert.equal(captureMaintenanceTurnPort({version:1,maxWaitMs,createTurn}).maxWaitMs,maxWaitMs);
    assert.equal(captureMaintenanceTurnPort(Object.create({version:1,maxWaitMs,createTurn})).maxWaitMs,maxWaitMs);
  }
  for(const maxWaitMs of [0,5001,1.5,undefined])
    assert.throws(()=>captureMaintenanceTurnPort({version:1,maxWaitMs,createTurn}),{code:'invalid_input'});
  let calls=0;
  const accessor={version:1,createTurn,get maxWaitMs(){calls++;return 2000;}};
  for(const port of [accessor,Object.create(accessor)])
    assert.throws(()=>captureMaintenanceTurnPort(port),{code:'invalid_input'});
  assert.equal(calls,0);
  // Absence is part of the captured descriptor shape, even at the default value.
  const s=setup(),port={version:1,createTurn},turns=createMaintenanceTurnController(captureMaintenanceTurnPort(port),s.clock);
  port.maxWaitMs=2000;
  assert.deepEqual(await turns.wait(request(),{identity:s.identity,signal:s.abort.signal,untilMonoMs:2000}),
    {status:'failed',error:'authority_required'});
});

test('descriptor-chain capture preserves the port receiver and frozen primitive request',async()=>{
  const proto={version:1,maxWaitMs:1000,createTurn(r){assert.equal(this,port);assert.equal(Object.isFrozen(r),true);return {enter:()=> 'admitted',release(){}};}};
  const port=Object.create(proto),s=setup(),controller=createMaintenanceTurnController(captureMaintenanceTurnPort(port),s.clock);
  const r=await controller.wait(request(),{identity:s.identity,signal:s.abort.signal,untilMonoMs:1000});
  assert.equal(r.status,'admitted');controller.release(r.ticket,'settled');
  for(const patch of [{intent:{}},{lane:'0'},{pumpId:{}},{maxMs:NaN}])assert.throws(()=>maintenanceTurnRequest({...request(),...patch}),{code:'invalid_input'});
});

test('ticket reflection refuses accessors and proxies before either method is called',async()=>{
  let calls=0;const trap=()=>{calls++;throw null;};
  for(const ticket of [new Proxy({}, {getPrototypeOf:trap,ownKeys:trap,getOwnPropertyDescriptor:trap}),
    {enter:trap,get release(){return trap();}}, {get enter(){return trap();},release:trap},
    {enter:trap,release:trap,get extra(){return trap();}},Object.create({enter:trap,release:trap}),
    {enter:new Proxy(()=>{}, {apply:trap}),release:trap}]){
    const s=setup(()=>ticket);assert.deepEqual(await s.wait(),{status:'failed',error:'authority_required'});
  }
  assert.equal(calls,0);
  const promise=Promise.resolve();Object.defineProperty(promise,'constructor',{get:trap});
  assert.deepEqual(await setup(()=>promise).wait(),{status:'failed',error:'authority_required'});assert.equal(calls,0);
});

test('ticket methods and receiver are captured before enter mutates release',async()=>{
  const calls=[];let ticket;
  const s=setup(()=>ticket={enter(){assert.equal(this,ticket);this.release=()=>assert.fail('replacement');return 'admitted';},release(...args){assert.equal(this,ticket);calls.push(args);}});
  const r=await s.wait();assert.equal(s.turns.release(r.ticket,'settled'),'released');assert.deepEqual(calls,[['settled']]);
});

test('an inherited prototype method never supplies a missing own ticket method',async()=>{
  const previous=Object.getOwnPropertyDescriptor(Object.prototype,'release');let calls=0;
  try{
    Object.defineProperty(Object.prototype,'release',{configurable:true,writable:true,value:()=>{calls++;}});
    const s=setup(()=>({enter(){calls++;return 'admitted';}}));
    assert.deepEqual(await s.wait(),{status:'failed',error:'authority_required'});assert.equal(calls,0);
  }finally{if(previous)Object.defineProperty(Object.prototype,'release',previous);else delete Object.prototype.release;}
});

test('non-native thenable is never read or awaited; malformed outcomes withdraw once',async()=>{
  let touched=0;
  for(const value of [{get then(){touched++;throw null;}},new Proxy({}, {get(){touched++;throw null;}}),undefined,null,true,'grant',Promise.resolve({invalid:true})]){
    const calls=[],s=setup(()=>({enter:()=>value,release:(...args)=>calls.push(args)}));
    assert.deepEqual(await s.wait(),{status:'failed',error:'authority_required'});assert.deepEqual(calls,[['withdrawn']]);
  }
  assert.equal(touched,0);
});

test('createTurn throws or returns malformed ticket without inspecting caller errors or releasing',async()=>{
  let touched=0;const hostile=new Proxy({}, {get(){touched++;throw null;}});
  for(const factory of [()=>{throw hostile;},()=>null,()=>({}),()=>Promise.reject(hostile)]){
    const s=setup(factory);assert.deepEqual(await s.wait(),{status:'failed',error:'authority_required'});
  }
  assert.equal(touched,0);
});

for(const mode of ['throw','reject'])test(`enter ${mode} withdraws exactly once and ignores caller error properties`,async()=>{
  let touched=0;const calls=[],hostile=new Proxy({}, {get(){touched++;throw null;}});
  const s=setup(()=>({enter(){if(mode==='throw')throw hostile;return Promise.reject(hostile);},release:(...args)=>calls.push(args)}));
  assert.deepEqual(await s.wait(),{status:'failed',error:'authority_required'});assert.deepEqual(calls,[['withdrawn']]);assert.equal(touched,0);
});

test('double and reentrant release attempts record before callback',async()=>{
  let calls=0,ticket;const s=setup(()=>({enter:()=> 'admitted',release(){calls++;assert.equal(s.turns.release(ticket,'settled'),'ignored');}}));
  const r=await s.wait();ticket=r.ticket;
  assert.equal(s.turns.release(ticket,'settled'),'released');assert.equal(s.turns.release(ticket,'settled'),'ignored');assert.equal(calls,1);
});

test('withdrawal cannot be followed by settlement or another wait on an unsettled grant',async()=>{
  const calls=[],s=setup(()=>({enter:()=> 'admitted',release:(...args)=>calls.push(args)})),r=await s.wait();
  await assert.rejects(s.wait(),{code:'read_in_progress'});
  s.turns.release(r.ticket,'withdrawn');assert.equal(s.turns.release(r.ticket,'settled'),'ignored');assert.deepEqual(calls,[['withdrawn']]);
});

test('release arguments stay closed and each decline reason has a fixed counter',async()=>{
  for(const reason of ['stopped','renewal_expired','generation_changed','budget_exhausted','spacing','lane_changed','admission_held','wait_expired']){
    const calls=[],s=setup(()=>({enter:()=> 'admitted',release:(...args)=>calls.push(args)})),r=await s.wait();
    assert.throws(()=>s.turns.release(r.ticket,'settled',{}),{code:'invalid_input'});
    assert.throws(()=>s.turns.release(r.ticket,'declined','other'),{code:'invalid_input'});assert.deepEqual(calls,[]);
    s.turns.release(r.ticket,'declined',reason);assert.deepEqual(calls,[['declined',reason]]);assert.equal(s.turns.snapshot().declinedTurns[reason],1);
  }
});

for(const late of ['admitted','reject'])test(`withdrawal is final with late ${late}`,async()=>{
  const p=pending(),calls=[],s=setup(()=>({enter:()=>p.promise,release:(...args)=>calls.push(args)}));
  const result=s.wait();s.abort.abort();assert.deepEqual(await result,{status:'cancelled'});
  if(late==='admitted')p.resolve('admitted');else p.reject(new Proxy({},{}));await flush();
  assert.deepEqual(calls,[['withdrawn']]);assert.equal(s.turns.snapshot().turnPhase,'idle');
});

for(const cause of ['abort','deadline'])test(`cooperative broker rejection on ${cause} preserves engine cancellation`,async()=>{
  const calls=[],s=setup(()=>({enter({signal}){return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(new Proxy({},{})),{once:true}));},release:(...args)=>calls.push(args)}));
  const result=s.wait();if(cause==='abort')s.abort.abort();else await s.deadline();
  assert.deepEqual(await result,{status:cause==='abort'?'cancelled':'defer'});assert.deepEqual(calls,[['withdrawn']]);
});

for(const cause of ['abort','deadline'])test(`grant settled before ${cause} but observed afterward remains owned until explicit decline`,async()=>{
  const p=pending(),calls=[],s=setup(()=>({enter:()=>p.promise,release:(...args)=>calls.push(args)}));
  const result=s.wait();s.set(999);p.resolve('admitted');
  s.set(1000);if(cause==='abort')s.abort.abort();else for(const {f} of [...s.timers.values()])f();
  const r=await result;
  assert.equal(r.status,'admitted');assert.deepEqual(calls,[]);
  assert.equal(r.waitExpired,cause==='deadline'||s.clock.now()>=1000);
  assert.equal(s.turns.snapshot().deferredTurns,0);assert.equal(s.turns.snapshot().turnPhase,'running');
  assert.equal(s.timers.size,0);assert.equal(s.turns.snapshot().turnWaitMs,1000);
  const reason=cause==='abort'?'generation_changed':'renewal_expired';
  s.turns.release(r.ticket,'declined',reason);assert.deepEqual(calls,[['declined',reason]]);
  assert.equal(s.turns.snapshot().declinedTurns[reason],1);
});

for(const cause of ['abort','deadline'])test(`grant returned during ${cause} notification remains owned until explicit decline`,async()=>{
  const p=pending(),calls=[],s=setup(()=>({enter({signal}){
    signal.addEventListener('abort',()=>p.resolve('admitted'),{once:true});return p.promise;
  },release:(...args)=>calls.push(args)}));
  const result=s.wait();
  if(cause==='abort'){s.set(999);s.abort.abort();}else await s.deadline();
  const r=await result;
  assert.equal(r.status,'admitted');assert.deepEqual(calls,[]);
  assert.equal(r.waitExpired,cause==='deadline'||s.clock.now()>=1000);assert.equal(s.turns.snapshot().deferredTurns,0);
  s.turns.release(r.ticket,'declined',cause==='abort'?'generation_changed':'renewal_expired');
  assert.deepEqual(calls,[['declined',cause==='abort'?'generation_changed':'renewal_expired']]);
});

for(const cause of ['abort','deadline'])test(`grant settled after ${cause} notification in the same turn remains owned`,async()=>{
  const p=pending(),calls=[],s=setup(()=>({enter:()=>p.promise,release:(...args)=>calls.push(args)}));
  const result=s.wait();
  if(cause==='abort'){s.set(999);s.abort.abort();}
  else {s.set(1000);for(const {f} of [...s.timers.values()])f();}
  p.resolve('admitted');const r=await result;
  assert.equal(r.status,'admitted');assert.deepEqual(calls,[]);
  assert.equal(r.waitExpired,cause==='deadline'||s.clock.now()>=1000);assert.equal(s.turns.snapshot().deferredTurns,0);
  s.turns.release(r.ticket,'declined',cause==='abort'?'generation_changed':'renewal_expired');
  assert.deepEqual(calls,[['declined',cause==='abort'?'generation_changed':'renewal_expired']]);
});

for(const property of ['constructor','species'])for(const state of ['rejected','fulfilled','handled'])
test(`native entry Promise with throwing ${property}: ${state} leaves only the host rejection unhandled`,()=>{
  const child=promiseChild({property,state});
  assert.equal(child.signal,null);assert.equal(child.error,undefined);
  assert.deepEqual(JSON.parse(child.stdout),{result:{status:'failed',error:'authority_required'},calls:[['withdrawn']],touched:1,thenTouched:0});
  assert.equal(child.status,state==='rejected'?1:0,child.stderr);
  if(state==='rejected'){
    assert.equal((child.stderr.match(/Error: host-entry-rejection/g)??[]).length,1);
    assert.doesNotMatch(child.stderr,/Error: accessor-failure/);
  }else assert.equal(child.stderr,'','no engine-created rejection escapes when the host Promise cannot reject unhandled');
});

test('captured native then contains rejection without invoking a throwing then getter',()=>{
  const child=promiseChild({property:'then',state:'rejected'});
  assert.equal(child.signal,null);assert.equal(child.error,undefined);assert.equal(child.status,0,child.stderr);assert.equal(child.stderr,'');
  assert.deepEqual(JSON.parse(child.stdout),{result:{status:'failed',error:'authority_required'},calls:[['withdrawn']],touched:0,thenTouched:0});
});

function promiseChild(config){
  const moduleUrl=new URL('../context-maintenance-turn.mjs',import.meta.url).href;
  return spawnSync(process.execPath,['--input-type=module','-e',`
    import { captureMaintenanceTurnPort, createMaintenanceTurnController } from ${JSON.stringify(moduleUrl)};
    const {property,state}=${JSON.stringify(config)},calls=[];let touched=0,thenTouched=0;
    const value=state==='fulfilled'?Promise.resolve('admitted'):Promise.reject(new Error('host-entry-rejection'));
    // The host can handle its own rejection before making observation impossible.
    if(state==='handled')value.catch(()=>{});
    const trap=()=>{touched++;throw new Error('accessor-failure');};
    Object.defineProperty(value,'then',{get(){thenTouched++;throw new Error('then-accessor-failure');}});
    if(property==='constructor')Object.defineProperty(value,'constructor',{get:trap});
    if(property==='species')Object.defineProperty(value,'constructor',{value:Object.defineProperty({},Symbol.species,{get:trap})});
    Object.freeze(value);
    const port={version:1,maxWaitMs:1000,createTurn:()=>({enter:()=>value,release:(...args)=>calls.push(args)})};
    const turns=createMaintenanceTurnController(captureMaintenanceTurnPort(port),{now:()=>0,setTimer:()=>1,clearTimer(){}});
    const result=await turns.wait(${JSON.stringify(request())},{signal:new AbortController().signal,identity:{key:'native-entry'},untilMonoMs:1000});
    console.log(JSON.stringify({result,calls,touched,thenTouched}));
    // An event-loop checkpoint lets default Node rejection handling determine exit.
    await new Promise(resolve=>setImmediate(resolve));
  `],{encoding:'utf8'});
}

test('deadline aborts host signal, counts defer, includes pending wait and removes timer',async()=>{
  const p=pending(),calls=[];let signal;
  const s=setup(()=>({enter(input){signal=input.signal;assert.equal(input.untilMonoMs,1000);return p.promise;},release:(...args)=>calls.push(args)}));
  const result=s.wait();s.set(400);assert.equal(s.turns.snapshot().turnWaitMs,400);await s.deadline();
  assert.deepEqual(await result,{status:'defer'});assert.equal(signal.aborted,true);assert.equal(s.timers.size,0);
  assert.equal(s.turns.snapshot().deferredTurns,1);assert.equal(s.turns.snapshot().turnWaitMs,1000);assert.deepEqual(calls,[['withdrawn']]);
});

test('release throw poisons both port and physical identity across controllers and aliases',async()=>{
  const s=setup(()=>({enter:()=> 'admitted',release(){throw new Proxy({},{});}})),r=await s.wait();
  assert.equal(s.turns.release(r.ticket,'settled'),'poisoned');assert.equal(s.turns.release(r.ticket,'settled'),'poisoned');
  const other=setup();assert.equal(other.turns.isPoisoned({key:randomUUID(),physical:s.identity.physical}),true);
  assert.equal(maintenanceTurnPoisoned(()=>({key:randomUUID(),physical:s.identity.physical})),true,'physical poison also bars an unbrokered successor');
  const samePort=createMaintenanceTurnController(captureMaintenanceTurnPort(s.port),s.clock);
  assert.equal(samePort.isPoisoned({key:randomUUID(),physical:randomUUID()}),true);assert.equal(s.turns.snapshot().turnPhase,'poisoned');
});

test('unproven disposal withholds release permanently, including newly learned physical identity',async()=>{
  let calls=0;const s=setup(()=>({enter:()=> 'admitted',release(){calls++;}})),r=await s.wait();
  s.turns.settling(r.ticket);assert.equal(s.turns.snapshot().turnPhase,'settling');s.turns.poison(r.ticket);
  const identity={key:randomUUID(),physical:randomUUID()};s.turns.bindIdentity(r.ticket,identity);
  assert.equal(s.turns.release(r.ticket,'settled'),'poisoned');assert.equal(setup().turns.isPoisoned(identity),true);assert.equal(calls,0);
});

test('port shape mutation before allocation and during entry fails closed',async()=>{
  let creates=0;const s=setup(()=>{creates++;return {enter:()=> 'defer',release(){}};});s.port.maxWaitMs=2;
  assert.deepEqual(await s.wait(),{status:'failed',error:'authority_required'});assert.equal(creates,0);
  const calls=[],p=pending(),other=setup(()=>({enter:()=>p.promise,release:(...args)=>calls.push(args)}));
  const result=other.wait();other.port.version=2;p.resolve('admitted');
  assert.deepEqual(await result,{status:'failed',error:'authority_required'});assert.deepEqual(calls,[['withdrawn']]);
  const releases=[],duringFactory=setup(()=>{
    duringFactory.port.version=2;
    return {enter(){assert.fail('changed port entered');},release:(...args)=>releases.push(args)};
  });
  assert.deepEqual(await duringFactory.wait(),{status:'failed',error:'authority_required'});assert.deepEqual(releases,[['withdrawn']]);
});

test('counter accumulation saturates and snapshots are fixed, frozen and include hold',async()=>{
  const s=setup(()=>({enter:()=> 'defer',release(){}}));s.set(Number.MAX_SAFE_INTEGER-1);
  // Move through two large pending waits without a timer or wall-clock sleep.
  const p=pending(),other=setup(()=>({enter:()=>p.promise,release(){}}));const result=other.wait();other.set(Number.MAX_SAFE_INTEGER);
  assert.equal(other.turns.snapshot().turnWaitMs,Number.MAX_SAFE_INTEGER);other.abort.abort();await result;
  assert.equal(other.turns.snapshot().turnWaitMs,Number.MAX_SAFE_INTEGER);
  const abort=new AbortController(),second=other.turns.wait(request(),{identity:other.identity,signal:abort.signal,untilMonoMs:Number.MAX_SAFE_INTEGER+10000});
  other.set(Number.MAX_SAFE_INTEGER+2000);assert.equal(other.turns.snapshot().turnWaitMs,Number.MAX_SAFE_INTEGER);abort.abort();await second;
  assert.equal(other.turns.snapshot().turnWaitMs,Number.MAX_SAFE_INTEGER,'completed accumulation saturates too');
  s.turns.missedObservation();const snapshot=s.turns.snapshot({held:true,attempts:3});
  assert.equal(snapshot.missedObservations,1);assert.equal(Object.isFrozen(snapshot),true);assert.equal(Object.isFrozen(snapshot.admissionHold),true);
  assert.equal(Object.isFrozen(snapshot.declinedTurns),true);
});

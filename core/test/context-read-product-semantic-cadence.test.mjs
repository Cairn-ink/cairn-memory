import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { semanticPump } from '../context-semantic-pump.mjs';
const snapshots=new WeakMap();
import { createContextReadSupervisor } from '../context-read-supervisor.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';

// Coordinator replies and reader work are injected at internal seams.
// Exercise production admission, scheduling, deadlines, accounting and disposal.
function setup(t, patch={}, hooks={}) {
  let clock=0,serial=0,chargedItems=0,chargedMs=0,validationCursor=0;
  const timers=new Map(),events=[],times=new WeakMap(),reservations=new Map();
  const supervisor=createContextReadSupervisor(),coordinator={},credential={service:randomUUID()};
  const readSet=[{ownerId:'cadence',scope:'personal',projectId:null}],ownerCoverage={policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const options={supervisor,path:'/synthetic-cadence-'+randomUUID()+'.sqlite',version:'context-read-v1',profile:PRODUCT_PROFILE,readSet,ownerCoverage,
    host:{moduleUrl:'file:///synthetic-cadence-host.mjs',configuration:{serviceBinding:{kind:'service',serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,
      credentialDigest:credentialDigest(credential),ownerId:'cadence',namespaces:{readSet,ownerCoverage},issuedAt:0}}}};
  const coverage={targetSetDigest:'synthetic',complete:false,pending:false};
  const client={closed:()=>false,ownerId:'cadence',targets:[{canonicalPath:options.path,readSet,types:['memory']}],validatePumpCredential(){},
    async pumpCall(method,input,duration){
      events.push({kind:method,at:clock,duration,input});await hooks.control?.(method,input,advance);
      if(method==='firstCoverage')return {...coverage};
      if(method==='embeddingAdmission')return {allowed:hooks.allowed!==false};
      if(method==='pumpReserve'){
        // Independent conservative ledger with known acknowledgements on the
        // next admission, matching the production transport's receipt contract.
        const prior=input.reconcile;
        if(prior?.usage){const old=reservations.get(prior.id);if(old&&!old.refunded){chargedItems-=old.maxItems-prior.usage.items;chargedMs-=old.maxMs-prior.usage.elapsedMs;old.refunded=true;}}
        chargedItems=Math.max(chargedItems,input.window.usedItems)+input.maxItems;
        chargedMs=Math.max(chargedMs,input.window.usedMs)+input.maxMs;
        const id=randomUUID();reservations.set(id,{...input});
        return {id,windowId:input.window.id,generation:input.accounting.generation,usedItems:chargedItems,usedMs:chargedMs,usedUsd:input.window.usedUsd};
      }
      if(method==='pumpFinish')return {windowId:input.windowId,generation:input.generation,usedItems:chargedItems,usedMs:chargedMs,usedUsd:'0'};
      throw Error('unexpected control');
    }};
  const handles=globalThis[Symbol.for('context-read-product-p2e-v1/handles')];handles.set(coordinator,client);
  coordinator.validateOwnerSemanticCoverage=async input=>{
    events.push({kind:'validate',at:clock,input,cursor:validationCursor++});
    if(hooks.validate)return hooks.validate(input,validationCursor);
    if(validationCursor===2){coverage.pending=false;coverage.complete=true;}
    return {ok:true,value:{status:coverage.complete?'complete':'partial'}};
  };
  const config={supervisor,id:randomUUID(),serviceCredential:credential,semanticServiceCredential:{semantic:randomUUID()},
    semanticConfig:{version:'context-read-product-p2e-v1',coordinator},firstCoverageValidation:{maxTargets:1,maxMs:700},
    window:{id:randomUUID(),endsAtMonoMs:60000,usedItems:0,usedMs:0,usedUsd:'0'},budgets:{maxItems:10000,maxMs:60000,maxUsd:'0.5'},
    quantum:{maxItems:1,maxMs:700,maxUsd:'0.01'},pollMs:100,renewalMs:60000,projections:[{options,types:['memory'],modes:['lexical','embeddings']}],...patch};
  const dependencies={snapshot:(value,diagnostic)=>snapshots.set(value,diagnostic),now:()=>clock,observedAt:result=>times.get(result),
    setTimer(fn,ms){const id=++serial;timers.set(id,{fn,at:clock+ms});return id;},clearTimer:id=>timers.delete(id),
    async open(){events.push({kind:'open',at:clock});return {
      async getContextIndexStatus(input){events.push({kind:'status',at:clock,intent:input.intent});return {ok:true,value:{lexical:{state:'ready'},semantic:{coverage:{status:hooks.covered?'complete':'partial'}}}};},
      async refreshContextIndex(input){
        events.push({kind:'refresh',at:clock,mode:input.mode,intent:input.intent});await hooks.refresh?.(input,advance);
        const result=hooks.result?.(input)??{ok:true,value:{status:'complete',progress:{transformed:0,embeddingAttempts:0}}};times.set(result,clock);return result;
      },async close(){events.push({kind:'close',at:clock});}};}};
  const renew=input=>semanticPump(input,dependencies);
  let pump;
  t.after(async()=>{await pump?.close();await supervisor.close();handles.delete(coordinator);});
  async function advance(ms){clock+=ms;for(const [id,timer] of [...timers])if(timer.at<=clock){timers.delete(id);void timer.fn();}await Promise.resolve();}
  return {config,events,coverage,renew,get now(){return clock;},get delay(){return Math.min(...[...timers.values()].map(t=>t.at-clock));},
    start(){pump=renew(config);return pump;},setTime(value){clock=value;},advance,
    async step({early=false}={}){const [id,timer]=[...timers].sort((a,b)=>a[1].at-b[1].at)[0]??[];assert.ok(timer,'a turn is scheduled');timers.delete(id);if(!early)clock=Math.max(clock,timer.at);await timer.fn();},
    async regular(){const before=events.filter(e=>e.kind==='refresh'||e.kind==='embeddingAdmission').length;for(let n=0;n<10;n++){await this.step();if(events.filter(e=>e.kind==='refresh'||e.kind==='embeddingAdmission').length>before)return;}throw Error('regular cursor stalled');}};
}
const diagnostic=p=>snapshots.get(p.getStatus());

test('semantic minimum spacing includes startup, regular and validation turns',async t=>{
  const s=setup(t,{}, {covered:true}),p=s.start();s.coverage.pending=true;
  for(let n=0;n<12;n++)await s.step();
  const starts=s.events.filter(e=>e.kind==='firstCoverage').filter((e,i,a)=>!i||e.at!==a[i-1].at).map(e=>e.at);
  assert.ok(starts.length>=10,'bounded startup does not bundle work');
  for(let i=1;i<starts.length;i++)assert.ok(starts[i]-starts[i-1]>=700,'minimum_start_spacing');
  assert.equal(p.getStatus().state,'active');
});

test('semantic capacity pacing spreads cheap work across the minute',async t=>{
  const s=setup(t,{budgets:{maxItems:60,maxMs:6000,maxUsd:'0.5'}});s.start();await s.step();
  assert.ok(s.now>700,'capacity_pacing_delays_first_turn');
  // Deadline lookahead may advance the budget interval, but never below S.
  assert.ok(s.now<=1500,'lookahead_preserves_initial_history_deadline');
});

test('semantic lookahead advances a paced turn to the lexical observation deadline',async t=>{
  const s=setup(t,{budgets:{maxItems:10,maxMs:6000,maxUsd:'0.5'}}),p=s.start();
  for(let n=0;n<18;n++){const previous=s.now;await s.step();if(n===2)assert.equal(s.now-previous,800,'lookahead_advances_the_paced_start');assert.equal(p.getStatus().error,null);}
  const observations=s.events.filter(e=>e.kind==='refresh'&&e.mode==='lexical');
  assert.ok(observations.length>=6,'lookahead_admits_lexical_work');
  for(const intent of ['current','history']){
    const times=[0,...observations.filter(e=>e.intent===intent).map(e=>e.at)];
    for(let i=1;i<times.length;i++)assert.ok(times[i]-times[i-1]<=5000,'lookahead_bounds_observation_gap');
  }
  assert.equal(diagnostic(p).cadenceMisses,0);
});

test('semantic lookahead leaves observation headroom when embedding discovers pending validation',async t=>{
  let s;
  s=setup(t,{budgets:{maxItems:10,maxMs:60000,maxUsd:'0.5'}},{
    refresh:async(input,advance)=>{await advance(699);if(input.mode==='embeddings'&&input.intent==='history')s.coverage.pending=true;},
    validate:()=>({ok:true,value:{status:'partial'}}),
  });
  const p=s.start();
  for(let n=0;n<35;n++)await s.step();
  for(const intent of ['current','history']){
    const times=[0,...s.events.filter(e=>e.kind==='refresh'&&e.mode==='lexical'&&e.intent===intent).map(e=>e.at+699)];
    for(let n=1;n<times.length;n++)assert.ok(times[n]-times[n-1]<=5000,'pending_validation_preserves_observation_headroom');
  }
  assert.ok(s.events.filter(e=>e.kind==='validate').length>=3,'validation_uses_scheduled_capacity');
  assert.equal(diagnostic(p).cadenceMisses,0,'validation_does_not_create_misses');
});

test('semantic one miss per overdue lexical duty without status or embedding credit',async t=>{
  const s=setup(t),p=s.start();s.setTime(6000);await s.step();
  assert.equal(diagnostic(p).cadenceMisses,2,'one_miss_per_overdue_duty');
  s.setTime(9000);await s.step();assert.equal(diagnostic(p).cadenceMisses,2,'still_overdue_is_not_recounted');
  assert.equal(diagnostic(p).observation?.cadenceMiss,true);
  assert.equal(p.getStatus().state,'active');
});

test('semantic recovery after lateness resumes normal spacing and future miss accounting',async t=>{
  const s=setup(t),p=s.start();s.setTime(6000);
  for(let n=0;n<9;n++)await s.step();
  assert.equal(diagnostic(p).cadenceMisses,2,'lateness_recovers_without_recounting');
  assert.equal(diagnostic(p).observation?.cadenceMiss,false,'recovered_observation_is_punctual');
  s.setTime(s.now+6000);await s.step();assert.equal(diagnostic(p).cadenceMisses,4,'a_new_overdue_duty_counts_again');
  assert.equal(p.getStatus().error,null);
});

test('semantic startup cursor is fair with regular work and validation advances one batch per turn',async t=>{
  const s=setup(t,{}, {covered:true}),p=s.start();s.coverage.pending=true;
  await s.step();assert.deepEqual(s.events.filter(e=>['status','refresh','validate'].includes(e.kind)).map(e=>e.kind),['status'],'startup_is_one_bounded_turn');
  await s.step();assert.equal(s.events.filter(e=>e.kind==='refresh').length,1);
  await s.step();
  assert.deepEqual(s.events.filter(e=>e.kind==='status'||e.kind==='refresh').map(e=>[e.kind,e.intent]),[['status','current'],['refresh','current'],['status','history']],'startup_yields_to_regular_work');
  for(let n=0;n<10;n++)await s.step();
  const validations=s.events.filter(e=>e.kind==='validate');assert.deepEqual(validations.map(e=>e.cursor),[0,1],'validation_cursor_advances');
  assert.equal(validations[0].input.budget.maxMs,700);assert.equal(validations[0].input.budget.maxTargets,1);
  assert.ok(s.events.some(e=>e.kind==='refresh'&&e.at>validations[0].at&&e.at<validations[1].at),'validation_yields_to_regular_work');
  assert.equal(p.getStatus().error,null);
});

test('semantic validation cursor yields after each bounded batch',async t=>{
  const s=setup(t,{}, {covered:true}),p=s.start();s.coverage.pending=true;
  for(let n=0;n<16;n++){
    const before=s.events.length;await s.step();const work=s.events.slice(before).filter(e=>['status','refresh','validate'].includes(e.kind));
    if(work.some(e=>e.kind==='validate'))assert.equal(work.length,1,'validation_is_one_bounded_turn');
  }
  assert.deepEqual(s.events.filter(e=>e.kind==='validate').map(e=>e.cursor),[0,1],'partial_validation_resumes_cursor');
  assert.equal(p.getStatus().error,null);
});

test('semantic late successful refresh remains active and records its actual observation',async t=>{
  const s=setup(t),p=s.start();await s.step();s.setTime(6000);await s.step();
  assert.equal(diagnostic(p).observation?.cadenceMiss,true,'late_success_is_a_cadence_miss');
  assert.equal(diagnostic(p).observation.atMonoMs,6000);
  assert.equal(p.getStatus().state,'active');await s.regular();assert.equal(p.getStatus().error,null);
});

test('semantic successful rebuilding advances the regular cursor and observation duty',async t=>{
  const s=setup(t,{}, {result:()=>({ok:true,value:{status:'rebuilding',progress:{transformed:0,embeddingAttempts:0}}})}),p=s.start();
  await s.regular();assert.equal(diagnostic(p).observation?.projection,0,'rebuilding_has_observation_credit');
  await s.regular();assert.deepEqual(s.events.filter(e=>e.kind==='refresh').map(e=>[e.mode,e.intent]),[['lexical','current'],['embeddings','current']]);
  assert.equal(p.getStatus().error,null);
});

test('semantic a slow coverage reply shares the reserved turn deadline with subsequent control work',async t=>{
  let armed=false;
  const s=setup(t,{}, {control:async(method,_input,advance)=>{if(armed&&['firstCoverage','pumpReserve'].includes(method))await advance(400);}}),p=s.start();
  await s.step();const refreshed=s.events.filter(e=>e.kind==='refresh').length;armed=true;await s.step();
  assert.equal(p.getStatus().error,'timeout','control_overhead_cannot_start_a_fresh_deadline');
  assert.equal(s.events.filter(e=>e.kind==='refresh').length,refreshed,'expired_control_cannot_dispatch');
  assert.equal(p.getStatus().usedItems,1);assert.equal(p.getStatus().usedMs,700,'unknown_reserve_is_fully_charged');
});

for(const code of ['authority_required','storage_error','read_timeout'])test(`semantic terminal ${code} stays terminal and fully charged (control)`,async t=>{
  const s=setup(t,{}, {result:()=>({ok:false,error:{code}})}),p=s.start();await s.regular();
  assert.equal((await p.completion).error,code);assert.equal(p.getStatus().usedItems,1);assert.equal(p.getStatus().usedMs,700);
});
for(const kind of ['admission','USD'])test(`semantic embedding ${kind} skip stays active without a reservation (control)`,async t=>{
  const s=setup(t,kind==='USD'?{budgets:{maxItems:100,maxMs:60000,maxUsd:'0'}}:{},{allowed:kind!=='admission'}),p=s.start();
  await s.regular();
  let skipped=false;
  for(let n=0;n<4&&!skipped;n++){
    const before=s.events.length;await s.step();const work=s.events.slice(before);
    if(work.some(e=>e.kind==='embeddingAdmission')){
      assert.equal(work.some(e=>e.kind==='pumpReserve'&&e.input.mode==='embeddings'),false,'embedding_skip_has_no_reserve');skipped=true;
    }
  }
  assert.equal(skipped,true);await s.regular();
  assert.equal(s.events.filter(e=>e.kind==='refresh').at(-1).intent,'history');assert.equal(p.getStatus().error,null);
});

for(const [ms,accepted] of [[714,true],[715,false]])test(`semantic documented guard boundary ${ms} ms is ${accepted?'admitted':'refused'}`,async t=>{
  const doc=readFileSync(new URL('../../docs/context-read-product.md',import.meta.url),'utf8');
  assert.match(doc,/\(N\+1\+2T\)\s*[×*]\s*S\s*≤\s*5000/,'documented_semantic_formula');
  assert.match(doc,/714/);assert.match(doc,/715/);
  const s=setup(t,{quantum:{maxItems:1,maxMs:ms,maxUsd:'0.01'},firstCoverageValidation:{maxTargets:1,maxMs:ms}});
  if(accepted){const p=s.start();assert.equal(p.getStatus().error,null);}else assert.throws(()=>s.start(),{code:'invalid_input'});
});

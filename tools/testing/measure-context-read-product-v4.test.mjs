import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { V4,DEFINITIONS,LABELS,buildV4Plan,estimateV4,windowSlot,rotatingCell } from './fixtures/context-product/v4-plan.mjs';
import { validateExposure,validateWM,validateAvailabilitySchedule,reconcileAvailability,validateSessionRegistration,validateSessionEvidence,validateSubprobes,admissionBudget,mergeSegments } from './fixtures/context-product/v4-validation.mjs';
import { validateV4Registration } from './fixtures/context-product/v4-runner.mjs';
import { windowReferences,exposureCell,normalDecision } from './fixtures/context-product/v4-windows.mjs';
import { requestSeries } from './fixtures/context-product/series.mjs';
import { PROTOCOL } from './fixtures/context-product/protocol.mjs';
import { digest } from './fixtures/context-product/report.mjs';
const loop=()=>({maxMs:1,over100:0,blocks:[]});
const record=(extra={})=>({ok:true,validated:true,bounds:true,expected:true,elapsedMs:1,readMs:1,telemetry:'complete',nativeBusy:0,publicBusy:0,hostLoop:loop(),...extra});
const sink=()=>({rows:[],async record(...args){this.rows.push(args);}});
for(const [profile,n,w,r,s,res] of [['engine',728,432,252,46627.4,47700],['production',488,224,172,26284,27000]])test(`Revision 1 ${profile}: independent table arithmetic and exact estimate`,()=>{
  const plan=buildV4Plan(profile),e=estimateV4(profile);assert.equal(plan.length,n);assert.equal(e.fixedWindows,w);assert.equal(e.reference,r);assert.equal(e.estimateSeconds,s);assert.equal(e.reservationSeconds,res);
  assert.equal(e.stateSubprobes,12*(4+4+8+4+4));assert.equal(e.main,profile==='engine'?556:332);assert.equal(e.cold,profile==='engine'?420:292);
  assert.deepEqual(plan,buildV4Plan(profile));assert.equal(new Set(plan.map(c=>c.key)).size,n);assert.equal(e.costSeconds.mainAndWarmups,e.main*53*(profile==='engine'?55:50)/100);
  const cli=spawnSync(process.execPath,['tools/testing/measure-context-read-product.mjs','--profile',profile,'--estimate'],{encoding:'utf8'});assert.equal(cli.status,0,cli.stderr);assert.deepEqual(JSON.parse(cli.stdout),e);
});
test('default CLI estimate is v4; explicit v3 remains available',()=>{
  for(const [args,version] of [[[],'P2-product-v4'],[['--protocol','v3'],'P2-product-v3']]){
    const r=spawnSync(process.execPath,['tools/testing/measure-context-read-product.mjs','--estimate',...args],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);assert.equal(JSON.parse(r.stdout).protocol,version);
  }
});
test('profile cells preserve request method/adapter/language/load identities and series attachment',()=>{
  const p=buildV4Plan('production'),e=buildV4Plan('engine');
  assert.equal(p.filter(c=>c.row==='R7p').length,24);assert.deepEqual(new Set(p.filter(c=>c.row==='R7p').map(c=>c.adapter).filter(Boolean)),new Set(['compact']));
  assert.equal(p.filter(c=>c.row==='R4p').every(c=>c.count===3336),true);
  for(const cell of [...p,...e].filter(c=>c.kind==='requests')){assert.equal(cell.series.includes('cold'),cell.load==='idle');assert.equal(cell.series.includes('warm-reference'),cell.load==='idle'&&cell.method==='findCandidates');}
  assert.equal(p.some(c=>c.type==='card'&&c.schema===18),false);assert.equal(Object.isFrozen(DEFINITIONS.engine),true);
});
const exposureFixture=(retained=false)=>{
  const cell=buildV4Plan('engine').find(c=>c.kind==='exposure'&&(c.load==='retained-target-rotation')===retained);
  const windows=Array.from({length:cell.windows},(_,repetition)=>{
    const startAt=100000+repetition*100000,endAt=startAt+30000;
    const makeWriter=()=>{const calls=[],records=[];
      for(let n=0;n<(retained?200:100);n++){
        const writerTarget=retained?['same','other'][n%2]:'same',operation=retained?['capture','capture','review','review'][n%4]:['capture','review'][n%2];
        const id=calls.length;calls.push({id,writerTarget,operation,lifecycle:retained?'retained':'fresh',writeStartedAt:startAt,writeFinishedAt:endAt,closeStartedAt:startAt,closeFinishedAt:endAt});
        records.push({kind:'native_end',stage:'commit',ok:true,operation:id,phase:'write',commit:true,at:startAt+100+n});
      }
      return {calls,diagnostics:{records,coverage:'complete',busy:0}};
    };
    const attempts=Array.from({length:40},(_,slot)=>{const mix=windowSlot(cell,repetition,slot);return record({slot,series:'window',methodLabel:mix.methodLabel,language:mix.language,intent:mix.intent,readStartedAt:startAt+slot*5+1,readFinishedAt:startAt+slot*5+2});});
    return {repetition,startAt,endAt,attempts,writer:makeWriter(),baseline:{startAt,endAt,writer:makeWriter()}};
  });return {cell,windows};
};
test('W method minima independently pass at twenty successes across five windows',()=>{const f=exposureFixture();const r=validateExposure(f.cell,f.windows);assert.equal(r.decision,'passed',JSON.stringify(r.errors));for(const m of LABELS)assert.equal(r.credits.same[m].write,20);});
for(const failure of ['unavailable','failed','unvalidated','wrong-bounds','oracle-mismatch','WM','out-of-window'])test(`W excludes ${failure} from method credits even with aggregate overlaps`,()=>{
  const f=exposureFixture();for(const w of f.windows)for(const r of w.attempts)if(r.methodLabel==='f24-snapshot'){
    if(failure==='unavailable')Object.assign(r,{ok:false,code:'index_unavailable'});
    if(failure==='failed')r.ok=false;if(failure==='unvalidated')r.validated=false;if(failure==='wrong-bounds')r.bounds=false;if(failure==='oracle-mismatch')r.expected=false;
    if(failure==='WM')r.series='WM';if(failure==='out-of-window'){r.readStartedAt=w.endAt+1;r.readFinishedAt=w.endAt+2;}
  }
  const r=validateExposure(f.cell,f.windows);assert.equal(r.decision,'invalid');assert.equal(r.credits.same['f24-snapshot'].write,0);
});
test('fresh-close credits are a subset of successful public-write overlaps',()=>{
  const f=exposureFixture();for(const w of f.windows)for(const c of w.writer.calls){c.writeStartedAt=w.startAt+10000;c.writeFinishedAt=w.startAt+20000;}
  const r=validateExposure(f.cell,f.windows);assert.equal(r.decision,'invalid');assert.equal(r.credits.same.c12.close,0);
});
test('method write and close successes must each span three windows',()=>{
  const f=exposureFixture();for(const w of f.windows.slice(2))for(const r of w.attempts)r.ok=false;
  for(const w of f.windows.slice(0,2)){const original=[...w.attempts];for(let n=0;n<4;n++)for(const r of original)w.attempts.push({...r,slot:w.attempts.length});}
  assert.equal(validateExposure(f.cell,f.windows).decision,'invalid');
});
test('W3 independently gates both retained targets and never demands fresh closes',()=>{
  const f=exposureFixture(true);for(const w of f.windows)for(const c of w.writer.calls){delete c.closeStartedAt;delete c.closeFinishedAt;}
  assert.equal(validateExposure(f.cell,f.windows).decision,'passed');
  for(const w of f.windows)w.writer.calls=w.writer.calls.filter(c=>c.writerTarget==='same');
  const r=validateExposure(f.cell,f.windows);assert.equal(r.decision,'invalid');assert.ok(r.errors.some(s=>s.includes('other')));
});
test('W raw-ledger deduplication, exact rotation and every-window mix are mandatory',()=>{
  for(const change of [f=>{f.windows[0].attempts[0].slot=1;},f=>{f.windows[0].attempts[0].language='ja';},f=>{f.windows[0].attempts=f.windows[0].attempts.filter(r=>r.methodLabel!=='a4000');},f=>{f.windows[0].endAt++;}]){const f=exposureFixture();change(f);assert.equal(validateExposure(f.cell,f.windows).decision,'invalid');}
});
test('WM interleaves four independent 50-success series, with their own failure/language ordinals',async()=>{
  const cell=buildV4Plan('engine').find(c=>c.kind==='exposure'),seen=[],output=sink();let time=100;
  const pump={async flush(){}};
  const r=await windowReferences({pump:{id:'pump'}},cell,99,pump,async(c,slot)=>{seen.push(slot);return c;},output,{now:()=>time,read:async c=>({record:record({ok:seen.length>4,startedAt:time++,finishedAt:time++,readMs:1})})});
  assert.equal(r.states.length,4);assert.deepEqual(r.states.map(s=>s.records.length),[51,51,51,51]);
  assert.deepEqual(seen.slice(0,8).map(s=>[s.methodLabel,s.intent,s.language]),[['c12','current','zh'],['c24','current','zh'],['c12','history','zh'],['c24','history','zh'],['c12','current','ja'],['c24','current','ja'],['c12','history','ja'],['c24','history','ja']]);
  const e={...r,pumpStoppedAt:time+1,telemetry:'complete',trace:[{kind:'start',at:0},{kind:'renew',at:99,status:{id:'pump',state:'active'}},{kind:'quantum',at:100,status:{id:'pump',state:'active',usedItems:1}},{kind:'stop',at:time+1}]};
  assert.equal(validateWM(cell,e).decision,'passed');
  for(const delta of [{pumpReplaced:true},{readinessWait:true},{telemetry:'incomplete'},{pumpId:'other'},{trace:[]},{trace:e.trace.map(t=>t.kind==='renew'?{...t,replaced:true}:t)},{trace:e.trace.map(t=>t.status?{...t,status:{...t.status,state:'renewal_expired'}}:t)}])assert.equal(validateWM(cell,{...e,...delta}).decision,'invalid');
});
const sessionFixture=()=>{
  const availability=Array.from({length:100},(_,k)=>['current','history'].map((intent,i)=>({id:intent+':'+k,intent,methodLabel:['c12','a1500'][k%2],language:['zh','ja','mixed'][k%3],releaseMs:k*1800+i*5}))).flat();
  return {key:JSON.stringify([1112,18,'DELETE','DELETE']),durationMs:180000,probeLanes:20,availabilityLanes:1,probeEveryMs:900,
    writer:{lifecycle:'fresh',target:'same-projection',cadenceMs:20,backlog:false,keeper:false,operations:['capture','review'],startMs:0,endMs:180000},availability,
    targets:Array.from({length:100},(_,k)=>({id:'m'+k,type:'memory',probe:'unique'+k,batch:Math.floor(k/20),createMs:k*850,reviewMs:k*850+35000})),
    batches:Array.from({length:5},(_,ordinal)=>({ordinal,query:'batch'+ordinal}))};
};
test('availability alternates by scheduled ordinal per intent and retains failed attempts',()=>{
  const s=sessionFixture(),rs=s.availability.map(a=>({...a,scheduledId:a.id,scheduled:true,startedAt:a.releaseMs,code:'index_unavailable'}));
  assert.equal(validateAvailabilitySchedule(s.availability).decision,'passed');assert.equal(reconcileAvailability(s.availability,[...rs].reverse()).decision,'passed');
  const bad=structuredClone(s.availability);for(const a of bad)if(a.intent==='current')a.methodLabel='c12';bad.find(a=>a.intent==='current').methodLabel='a1500';
  assert.equal(validateAvailabilitySchedule(bad).decision,'invalid');
  for(const change of [a=>a.pop(),a=>a.push(a[0]),a=>{a[0].methodLabel='a1500';},a=>{a[0].scheduledId='omitted';}]){const r=structuredClone(rs);change(r);assert.equal(reconcileAvailability(s.availability,r).decision,'invalid');}
});
test('session registration freezes fresh same-projection continuous writer and target hold recipes',()=>{
  const s=sessionFixture();assert.equal(validateSessionRegistration(s,18).decision,'passed');
  for(const delta of [{lifecycle:'retained'},{target:'other-owner'},{cadenceMs:40},{backlog:true},{keeper:true},{operations:['capture']},{endMs:120000}])assert.equal(validateSessionRegistration({...s,writer:{...s.writer,...delta}},18).decision,'invalid');
  const wrong=structuredClone(s);wrong.targets[0].reviewMs=35001;assert.equal(validateSessionRegistration(wrong,18).decision,'invalid');
});
test('session reconciliation checks actual lifecycles, eligible revisions, complete seal and tail',()=>{
  const s=sessionFixture(),call={startedAt:0,cycleStartedMono:0,lifecycle:'fresh',writerTarget:'same',nativeCommit:true,streamKind:'ordinary',openStartedAt:1,openFinishedAt:2,writeStartedAt:3,writeFinishedAt:4,closeStartedAt:5,closeFinishedAt:6,finishedAt:6};
  const e={startAt:0,durationMs:180000,scheduleHash:digest(s),availability:s.availability.map(a=>({...a,scheduledId:a.id,scheduled:true,startedAt:a.releaseMs})),
    writer:{calls:[{...call,id:0,ordinaryOrdinal:0,operation:'capture'},{...call,id:2,streamKind:'target',startedAt:119990,openStartedAt:119991,openFinishedAt:119992,writeStartedAt:119993,writeFinishedAt:120001,closeStartedAt:120002,closeFinishedAt:120003,finishedAt:120003,operation:'review'},{...call,id:1,startedAt:179990,openStartedAt:179991,openFinishedAt:179992,writeStartedAt:179993,writeFinishedAt:179994,closeStartedAt:179995,closeFinishedAt:179996,finishedAt:179996,cycleStartedMono:179990,ordinaryOrdinal:1,operation:'review'}],pacing:[{ordinal:0,startedMono:0,workFinishedMono:6,delayMs:14,resumedMono:20},{ordinal:1,startedMono:179990,workFinishedMono:179996,delayMs:14,resumedMono:180010}],diagnostics:{coverage:'complete',records:[{sequence:1,operation:2,kind:'native_end',phase:'write',commit:true,at:120000}]},exit:{code:0,signal:null}},writerEndAt:180000,targets:[{targetId:'m0',type:'memory',committedAt:120000,nativeCommitSequence:1,nativeCommitOperation:2,intent:'current',firstEligibility:true,eligibilityCoverage:'complete',revision:1}]};
  assert.equal(validateSessionEvidence(s,e).decision,'passed');
  for(const change of [r=>{r.writerEndAt=149999;},r=>{r.writer.diagnostics.coverage='incomplete';},r=>{r.writer.calls[0].lifecycle='retained';},r=>{r.writer.calls[2].operation='capture';},r=>{r.targets[0].firstEligibility=false;},r=>{r.probeCadenceMissed=true;},r=>{r.scheduleHash='different';}]){const r=structuredClone(e);change(r);assert.equal(validateSessionEvidence(s,r).decision,'invalid');}
});
const subprobes=kind=>V4.stateSubprobes[kind].map((p,k)=>({id:p.id,path:p.path??p.id,trigger:p.trigger??null,resetId:'reset'+k,
  code:kind==='absent'?(['candidates','assembly'].includes(p.id)?'index_unavailable':null):kind==='exhaustion'?'storage_busy':kind==='abort'?(p.trigger==='abort'?'read_cancelled':'read_timeout'):kind==='crash'?'reader_failed':null,
  expected:true,noLateData:true,loop:loop(),actualExitConfirmed:true,ownershipDrained:true,sidecarUnchanged:true,state:kind==='post-catch-up'?'ready':'absent',progress:null,counts:null,writerCoverage:'complete',writerExit:{code:0,signal:null},writerProfileComplete:true,writer:{hostLoop:loop(),diagnostics:{busy:0},calls:['capture','review'].map(operation=>({operation,lifecycle:'fresh',writerTarget:'same',deadlineMs:5000,writeElapsedMs:1}))},
  cutoffAt:100,nativeEnteredAt:1,settledAt:kind==='exhaustion'?50:101,abortObservedAt:99,nativePrimary:5,nativeProvenanceComplete:true,handleEscaped:false,
  nativePendingAtSettlement:true,writerCommitWhileCleanupPending:true,writerDeadlineOverrun:false,supervisedUntilDisposal:true,nativeDisposed:true,workerExitConfirmed:true,cleanupId:'cleanup',explicitBuild:true}));
for(const kind of Object.keys(V4.stateSubprobes))test(`T ${kind}: every exact manifest branch and expected outcome is required`,()=>{
  const cell={injection:kind},rs=subprobes(kind);assert.equal(validateSubprobes(cell,rs).decision,'passed');
  for(const p of rs){assert.equal(validateSubprobes(cell,rs.filter(r=>r!==p)).decision,'invalid');const wrong=structuredClone(rs);wrong.find(r=>r.id===p.id).code='wrong';assert.equal(validateSubprobes(cell,wrong).decision,'failed');}
  assert.equal(validateSubprobes(cell,[...rs,rs[0]]).decision,'invalid');assert.equal(validateSubprobes(cell,[...rs.slice(1),{...rs[0],id:'unknown'}]).decision,'invalid');
});
test('T validates every abort/timeout cutoff, pending cleanup and writer-progress assertion',()=>{
  for(const field of ['nativePendingAtSettlement','writerCommitWhileCleanupPending','supervisedUntilDisposal','nativeDisposed','actualExitConfirmed','ownershipDrained'])for(let i=0;i<8;i++){
    const rs=subprobes('abort');rs[i][field]=false;assert.equal(validateSubprobes({injection:'abort'},rs).decision,'invalid',field+':'+i);
  }
  for(let i=0;i<8;i++){const rs=subprobes('abort');rs[i].settledAt=151;assert.equal(validateSubprobes({injection:'abort'},rs).decision,'failed');}
});
test('budget admission stops on projected overrun, stalled activity or missing progress without altering a sample',()=>{
  const b={now:100,startedAt:0,reservationMs:1000,observationMs:1000,lastActivityAt:100,lastProgressAt:100,stallMs:100,progressMs:100,projectedCellMs:500,drainMs:10};
  assert.equal(admissionBudget(b).admit,true);assert.equal(admissionBudget({...b,projectedCellMs:900}).reason,'projected_overrun');assert.equal(admissionBudget({...b,lastActivityAt:-1}).reason,'stalled_activity');assert.equal(admissionBudget({...b,lastProgressAt:-1}).reason,'missing_progress');
  assert.deepEqual(Object.keys(admissionBudget(b)).sort(),['admit','decision','reason']);
});
test('segment merging preserves failures and only complete, unique records on the exact registration/platform',()=>{
  const r={hash:'h',hostId:'host',volumeId:'volume',node:'v24.15.0',segmentIds:['first','later'],cellCount:2},s={id:'first',registrationHash:'h',hostId:'host',volumeId:'volume',node:'v24.15.0',cells:[{key:'one',complete:true,decision:'failed'},{key:'partial',complete:false,decision:'passed'}]};
  const m=mergeSegments(r,[s,{...s,id:'later',cells:[{key:'two',complete:true,decision:'passed'}]}]);assert.equal(m.cells.length,2);assert.equal(m.complete,true);assert.equal(m.decision,'failed');
  assert.throws(()=>mergeSegments(r,[s,s]),/duplicate/);for(const [k,v] of Object.entries({hostId:'other',volumeId:'other',node:'v24.16.0',registrationHash:'changed',id:'unregistered'}))assert.throws(()=>mergeSegments(r,[{...s,[k]:v}]),/identity/);
});
test('v4 registration refuses missing production inputs before collection',()=>{
  const plan=buildV4Plan('production'),sessions=[];
  for(const count of [1112,3336])for(const schema of [18,23,33])for(const j of [['DELETE','DELETE'],['WAL','WAL']]){
    const s=sessionFixture();s.key=JSON.stringify([count,schema,...j]);if(schema!==18)s.targets.push(...s.targets.map(t=>({...t,id:'c'+t.id,type:'card',probe:'card'+t.probe,batch:t.batch+5})));s.batches=Array.from({length:schema===18?5:10},(_,ordinal)=>({ordinal,query:'batch'+ordinal}));sessions.push(s);
  }
  const input={host:{id:'host',cpu:'cpu',ramBytes:1,os:'Linux',owner:'owner'},volume:{id:'vol',mount:'mount',filesystem:'ext4',production:true,nonWSL:true},productionNode:'v24.15.0',platformRole:'production-linux-ext4',
    telemetryCapacities:PROTOCOL.telemetry,drainSchedule:PROTOCOL.drainSchedule,reservation:{seconds:27000,exclusive:true,owner:'owner'},observationBudgetMs:27000000,
    supervision:{stallMs:10000,progressMs:30000,drainAllowanceMs:1000},deadlineProvenance:'product',writerProfile:{captureMs:null,reviewMs:null,provenance:'product'},stateDeadlines:{opening:1000,candidates:1000,fetch:1000,assembly:1000},sessions,
    segments:[{id:'first',cellKeys:plan.map(c=>c.key)}],stateProbes:Object.fromEntries(plan.filter(c=>c.kind==='injection'&&c.injection==='post-catch-up').flatMap(c=>c.subprobes.map(p=>[c.key+':'+p.id,'unique'+c.id+p.id])))};
  assert.equal(validateV4Registration(input,'production'),input);
  for(const key of ['host','volume','productionNode','telemetryCapacities','reservation','observationBudgetMs','deadlineProvenance','stateDeadlines','sessions','segments','stateProbes']){const r=structuredClone(input);delete r[key];assert.throws(()=>validateV4Registration(r,'production'),undefined,key);}
  const ns={ownerId:'owner',scope:'personal',projectId:null},projects=Array.from({length:32},(_,i)=>({...ns,scope:'project',projectId:String(i)}));
  const sameOwner={...input,fixtures:[{schema:18,cards:0,selectionRevision:'s',inventory:[ns,...projects.slice(0,3)],overflowInventory:[ns,...projects],otherOwnerNamespace:ns}]};
  assert.throws(()=>validateV4Registration(sameOwner,'production'),/other_owner/);
  const wrong=structuredClone(input);wrong.reservation.seconds=25200;assert.throws(()=>validateV4Registration(wrong,'production'),/reservation/);
});

test('first eligible native commit survives later capture bookkeeping and later review revisions',async()=>{
  const {eligibilityLedger}=await import('./fixtures/context-product/v4-eligibility.mjs');
  let commit={at:10,sequence:1,operation:0};const l=eligibilityLedger(),connection={};l.enable(true);
  l.statement('BEGIN IMMEDIATE',[],undefined,connection,commit);
  l.statement('INSERT INTO memories (id, owner_id, scope, project_id, fingerprint, content, kind, origin, confidence, revision, deleted, created_at, updated_at, review_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)', ['memory'],{changes:1},connection,commit);
  l.statement('COMMIT',[],undefined,connection,commit);
  commit={at:50,sequence:2,operation:0};l.statement('BEGIN IMMEDIATE',[],undefined,connection,commit);l.statement('COMMIT',[],undefined,connection,commit);
  commit={at:100,sequence:3,operation:1};l.statement('BEGIN IMMEDIATE',[],undefined,connection,commit);
  l.statement("UPDATE memories SET review_state='confirmed',revision=revision+1,updated_at=? WHERE id=?",['time','memory'],{changes:1},connection,commit);l.statement('COMMIT',[],undefined,connection,commit);
  assert.deepEqual(l.targets('memory','memory').map(t=>[t.intent,t.revision,t.committedAt]),[['history',1,10],['current',2,100]]);
  assert.equal(l.complete,true);
});
test('Card drafts never qualify; both Card intents share a timestamp only at the actual confirmation commit',async()=>{
  const {eligibilityLedger}=await import('./fixtures/context-product/v4-eligibility.mjs');let commit={at:1,sequence:1,operation:0};const l=eligibilityLedger(),db={};l.enable(true);
  l.statement('BEGIN',[],undefined,db,commit);l.statement("INSERT INTO private_cards VALUES(?,?,?,?,1,'draft',?,?,NULL,?,?,NULL)",['card'],{changes:1},db,commit);l.statement('COMMIT',[],undefined,db,commit);assert.deepEqual(l.targets('card','card'),[]);
  commit={at:35001,sequence:2,operation:1};l.statement('BEGIN',[],undefined,db,commit);l.statement("UPDATE private_cards SET state='confirmed',revision=revision+1,body_revision=1, confirmed_at=?,updated_at=? WHERE id=?",[1,1,'card'],{changes:1},db,commit);l.statement('COMMIT',[],undefined,db,commit);
  assert.deepEqual(l.targets('card','card').map(t=>[t.intent,t.revision,t.bodyRevision,t.committedAt]),[['current',2,1,35001],['history',2,1,35001]]);
});

test('real W orchestration keeps fixed durations, unique pair placements and same-pump WM with a manual clock',async()=>{
  const cell=buildV4Plan('production').find(c=>c.kind==='exposure'),output=sink(),clones=[],readSlots=[];let clock=0,wmReads=0;
  const result=await exposureCell(cell,{sink:output,prepareClone:async suffix=>{clones.push(suffix);return {protocol:'P2-product-v4',cell,pump:{id:suffix},maintainerCoverage:'complete',maintainerDiagnostics:[{coverage:'complete',busy:0}],load:cell.load};},prepareInput:async(c,slot)=>({...c,cell:slot,method:slot.method})},{
    now:()=>clock,wait:async ms=>{clock+=ms;},makeSampler:async()=>({collect:async()=>[],stop:async()=>({samples:[]})}),
    makePump:async config=>{const status={id:config.pump.id,state:'active',usedItems:1};const trace=[{kind:'start',at:clock},{kind:'renew',at:clock,status}];return {trace,async flush(){trace.push({kind:'quantum',at:clock,status});},async stop(){trace.push({kind:'stop',at:clock});return [{diagnostics:{protocol:'context-native-v1',coverage:'complete',busy:0}}];}};},
    makeWriter:async()=>{let start,end;const calls=[];return {child:{pid:1},calls,flush(){},start(s,e){start=s;end=e;for(let n=0;n<100;n++)calls.push({id:n,writerTarget:'same',lifecycle:'fresh',operation:n%2?'review':'capture',deadlineMs:5000,writeElapsedMs:1,writeStartedAt:start,writeFinishedAt:end,closeStartedAt:start,closeFinishedAt:end});},async stop(){return {calls,hostLoop:loop(),diagnostics:{coverage:'complete',busy:0,records:calls.map(c=>({kind:'native_end',stage:'commit',ok:true,operation:c.id,phase:'write',commit:true,at:start+1}))}};}};},
    read:async(config,{initialize})=>{const start=clock;clock+=initialize?1:750;readSlots.push(config.cell);if(initialize)wmReads++;return {record:record({startedAt:start,finishedAt:clock,readStartedAt:start,readFinishedAt:start+1})};},
  });
  assert.equal(result.decision,'passed',JSON.stringify(result));assert.equal(clones.length,10);assert.equal(new Set(clones).size,10);assert.equal(wmReads,200);
  const boundaries=output.rows.filter(r=>r[1]==='window-boundary');assert.equal(boundaries.length,10);for(const [, ,b] of boundaries)assert.equal(b.endAt-b.startAt,30000);
  assert.equal(output.rows.filter(r=>r[1]==='pair').length,5);assert.equal(result.exposure.credits.same.c12.write,20);
  assert.deepEqual(clones.slice(0,4),['0-baseline','0-reader','1-reader','1-baseline']);
});
test('loaded v4 requests collect main only, rotate on failures, and never inherit W windows or WM samples',async()=>{
  const cell=buildV4Plan('engine').find(c=>c.row==='R5e'&&c.method==='findCandidates'),output=sink(),slots=[],calls=[{writeStartedAt:0,writeFinishedAt:1e15,operation:'capture',deadlineMs:5000,writeElapsedMs:1},{writeStartedAt:0,writeFinishedAt:1e15,operation:'review',deadlineMs:5000,writeElapsedMs:1}];
  let ordinal=0;const r=await requestSeries({load:cell.load,method:cell.method,seriesCeilingMs:100000,maintainerCoverage:'complete',maintainerDiagnostics:[{coverage:'complete',busy:0}]},{cell,sink:output},{
    prepareAttempt:async(c,s)=>{slots.push(s);return c;},attempt:async()=>({record:record({readStartedAt:1,readFinishedAt:2,...(++ordinal===4?{ok:false,code:'index_unavailable'}:{})})}),coldAttempt:async()=>{throw Error('unregistered cold');},
    startWriter:async()=>({child:{pid:1},calls,flush(){},start(){},async stop(){return {calls,hostLoop:loop(),exit:{code:0,signal:null},diagnostics:{coverage:'complete',busy:0}};}}),
    startPump:async()=>({flush:async()=>{},stop:async()=>[]}),startSampler:async()=>({collect:async()=>[],stop:async()=>({samples:[]})}),
  });
  assert.equal(r.decision.decision,'passed');assert.deepEqual(Object.keys(r.populations),['main']);assert.equal(r.languageCoverage,true);assert.equal(slots.length,54);assert.equal(r.populations.main.attempts,51);assert.equal(r.populations.main.successes,50);assert.deepEqual(slots.slice(3,6).map(s=>s.language),['zh','ja','mixed']);
});

test('copied declarative appendix and claim boundaries match the accepted contract byte for byte as data',async()=>{
  const {readFile}=await import('node:fs/promises');const text=await readFile(new URL('../../docs/plans/context-read-product.md',import.meta.url),'utf8');
  const start=text.indexOf('```json',text.indexOf('### Appendix V4-A'))+7,end=text.indexOf('```',start);
  assert.deepEqual(V4,JSON.parse(text.slice(start,end)));
  const claims=JSON.parse(await readFile(new URL('./fixtures/context-product/v4-claims.json',import.meta.url),'utf8'));
  for(const value of Object.values(claims))assert.ok(text.includes(value));assert.match(claims.unclaimed,/full\/snapshot/);assert.match(claims.unclaimed,/mixed-pair latency/);
});
test('checkpoint loading retains a known failure in an interrupted cell, without pooling its samples into a later complete cell',async t=>{
  const {createTestWorkspace}=await import('./workspace.mjs'),{join}=await import('node:path');
  const {createReportSink}=await import('./fixtures/context-product/report.mjs'),{readSegments,checkedSegments}=await import('./fixtures/context-product/v4-checkpoints.mjs');
  const w=createTestWorkspace(t),cell={id:0,key:'cell',kind:'exposure',canonical:'WAL',sidecar:'WAL'};
  const header={protocol:{version:'P2-product-v4'},segmentId:'first',registrationHash:'registration',host:{id:'host'},volume:{id:'volume'},node:'v24.15.0',segments:[{id:'first',cellKeys:['cell']}],inventory:[cell],cellCount:1};
  const partial=join(w.path,'partial.jsonl'),complete=join(w.path,'complete.jsonl'),a=await createReportSink(partial,header);
  await a.record(0,'window',record({nativeBusy:1}));await a.interrupt();
  const b=await createReportSink(complete,header);await b.cell(cell,{decision:'passed',complete:true});await b.finish('passed');
  const segments=await readSegments([partial+'.partial',complete]);assert.equal(segments[0].cells.length,0);assert.equal(segments[0].knownFailure,true);
  const checked=checkedSegments(header,segments);assert.equal(checked.cells.length,1);assert.equal(checked.complete,true);assert.equal(checked.decision,'failed');
});
test('availability must span the session; balanced calls concentrated at its start are rejected',()=>{
  const s=sessionFixture();for(const [k,a] of s.availability.entries())a.releaseMs=k;
  assert.equal(validateAvailabilitySchedule(s.availability).decision,'invalid');
});

test('B restores and verifies both intents through independent fresh handles; history refusal prevents completion',async()=>{
  const {backupSeries}=await import('./measure-context-read-product.mjs');
  for(const refuse of [false,true]){
    const verified=[],opened=[],cell=buildV4Plan('engine').find(c=>c.kind==='backup'),configuration={protocol:'P2-product-v4',method:'findCandidates',path:'owned.sqlite',readSet:[],types:['memory'],deadlines:{readMs:5000},maintainerCoverage:'complete',maintainerDiagnostics:[]};
    const deps={storage:async()=>({value:{logicalHash:'same',schema:cell.schema}}),fileChild(){},stat:async()=>({size:1}),build:async()=>({coverage:'complete',diagnostics:[]}),
      startSampler:async()=>({stop:async()=>({coverage:'complete',samples:[{sizes:[{name:`restore-${cell.id}.sqlite.context-read-product-v1.1.sqlite`,bytes:1}]}]})}),
      configure:async()=>{const id=opened.length;opened.push(id);return {open:async()=>({getContextIndexStatus:async({intent})=>{verified.push([id,intent]);return {ok:true,value:{lexical:{state:refuse&&intent==='history'?'absent':'ready'}}};},async close(){}}),supervisor:{async close(){},async drain(){return [];},ackCleanup(){}}};},
      attempt:async()=>({record:record()}),observeLoop:()=>({finish:async()=>loop()})};
    if(refuse)await assert.rejects(backupSeries(configuration,cell,{path:'.'},sink(),undefined,deps),/restore_not_ready/);
    else {const r=await backupSeries(configuration,cell,{path:'.'},sink(),undefined,deps);assert.equal(r.decision,'passed');assert.deepEqual(r.outputs.verifiedIntents,['current','history']);}
    assert.deepEqual(verified,[[0,'current'],[1,'history']]);
  }
});
test('native journal uses a fixed intrinsic target recorder; target identities never enter diagnostic chunks',async()=>{
  const {createWriterJournal,observedDatabase}=await import('./fixtures/context-product/writer-journal.mjs');
  const journal=createWriterJournal({stream:'stream',epoch:1,capacity:512,observeEligibility:true,clock:()=>10});
  class Native{exec(){}prepare(){return {run(){return {changes:1};}}}close(){}}
  const Database=observedDatabase(Native,journal);journal.enter(0,'open');const db=new Database();journal.leave();journal.enableTargets(true);journal.enter(1,'write');db.exec('BEGIN IMMEDIATE');
  db.prepare('INSERT INTO memories (id, owner_id, scope, project_id, fingerprint, content, kind, origin, confidence, revision, deleted, created_at, updated_at, review_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?)').run('target-identity');db.exec('COMMIT');journal.leave();
  assert.equal(journal.eligibleTargets('memory','target-identity')[0].committedAt,10);assert.equal(journal.eligibilityComplete(),true);
  assert.equal(JSON.stringify(journal.chunk()).includes('target-identity'),false);assert.equal(JSON.stringify(journal.chunk()).includes('INSERT'),false);
});

test('qualification CLI import remains SQLite-free',()=>{
  const code="import {registerHooks} from 'node:module';registerHooks({resolve(s,c,n){if(s==='node:sqlite')throw Error('eager_sqlite');return n(s,c);}});await import('./tools/testing/measure-context-read-product.mjs');";
  const r=spawnSync(process.execPath,['--input-type=module','-e',code],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
});

test('post-catch-up checks the newly inserted identity/revision for full evidence and assembly diagnostic refs',async()=>{
  const {postCatchupHasRef}=await import('./fixtures/context-product/v4-state.mjs');
  const row={id:'new',revision:2,owner_id:'owner',scope:'personal',project_id:null},ref={type:'memory',memoryId:'new',revision:2,namespace:{ownerId:'owner',scope:'personal',projectId:null}};
  for(const value of [{items:[{ref}]},{metered:{items:[{ref:{ns:0,type:'memory',id:'new',rev:2}}]},diagnostics:{items:[{ref}]}}]){
    assert.equal(postCatchupHasRef({value},row),true);assert.equal(postCatchupHasRef({value},{...row,id:'old'}),false);assert.equal(postCatchupHasRef({value},{...row,revision:3}),false);
  }
  assert.equal(postCatchupHasRef({value:{items:[{ref}]}},null),false);
});

test('a language success without actual writer overlap cannot complete loaded rotation coverage',async()=>{
  const {rotationCoverage}=await import('./fixtures/context-product/v4-validation.mjs');
  const rows=['zh','ja','mixed'].map(language=>record({language,overlap:language!=='ja'}));
  assert.equal(rotationCoverage(rows),true);assert.equal(rotationCoverage(rows,true),false);
});

test('v4 complete build fallback cannot overwrite incomplete maintainer diagnostics',()=>{
  const cell={kind:'exposure',canonical:'WAL',sidecar:'WAL',scope:'launch'};
  assert.equal(normalDecision(cell,[record()],{maintenance:[{coverage:'incomplete',busy:0}],maintainerCoverage:'complete'}).decision,'invalid');
  assert.equal(normalDecision(cell,[record()],{maintenance:[{coverage:'complete',busy:0}],maintainerCoverage:'complete'}).decision,'passed');
  for(const missing of [null,{}, {maxMs:1,over100:null}])assert.equal(normalDecision(cell,[record()],{maintenance:[{coverage:'complete',busy:0}],maintainerCoverage:'complete',loops:[missing]}).decision,'invalid');
  assert.equal(normalDecision(cell,[record({hostLoop:{maxMs:101,over100:1}})],{maintenance:[{coverage:'complete',busy:0}],maintainerCoverage:'complete',loops:[null]}).decision,'failed');
});

test('window commits at the exclusive end and broken retained operation cycles cannot qualify',()=>{
  const f=exposureFixture();for(const r of f.windows[0].writer.diagnostics.records)r.at=f.windows[0].endAt;
  assert.equal(validateExposure(f.cell,f.windows).decision,'invalid');
  const retained=exposureFixture(true);retained.windows[0].writer.calls[0].operation='review';
  assert.equal(validateExposure(retained.cell,retained.windows).decision,'invalid');
});

for(const failure of ['sampler-startup','locker-startup'])test(`T ${failure} drains prior acquisitions and retains actual locker exit`,async()=>{
  const {stateCell}=await import('./fixtures/context-product/v4-state.mjs');let released=0,restored=0,gcClosed=0,closed=0,drained=0;const output=sink();
  const config={path:'owned.sqlite',deadlines:{openMs:5000,requestMs:5000,readMs:5000},input:{},supervision:{stallMs:30000}},error=Object.assign(Error(failure),{code:'child_failed',exitCode:7});
  await assert.rejects(stateCell({id:0,injection:'exhaustion'},{sink:output,input:{stateDeadlines:{opening:1000}},prepare:async()=>config,prepareInput:async c=>c,build:async()=>{}},{
    configure:async()=>({supervisor:{async close(){closed++;},async drain(){drained++;return [];},ackCleanup(){}}}),
    nativeFactory:()=>({release(){released++;},close(){restored++;}}),instrumentGc:()=>({entries:[],close(){gcClosed++;}}),observeLoop:()=>({finish:async()=>loop()}),
    startSampler:async()=>{if(failure==='sampler-startup')throw error;return {async stop(){return {samples:[]};}};},
    makeLock:()=>({connected:false,exitCode:7,signalCode:null,exited:Promise.resolve({code:7,signal:null}),async wait(){throw error;}}),
  }),e=>e===error);
  assert.equal(released,1);assert.equal(restored,1);assert.equal(gcClosed,1);assert.equal(closed,1);assert.equal(drained,1);
  if(failure==='locker-startup')assert.equal(output.rows.find(r=>r[1]==='locker-exit')[2].exit.code,7);
});

test('writer metadata comes from the exact stored identity, including normalized text and newer revisions',async()=>{
  const {inspectWrittenMemory}=await import('./fixtures/context-product/v4-writer.mjs');const ns={ownerId:'owner',scope:'personal',projectId:null},seen=[];
  const core={get(input){seen.push(input);return {ok:true,value:{memory:{id:input.memoryId,revision:3,content:'ABC normalized'}}};},list(){throw Error('unbounded_or_wrong_identity');}};
  const returned={value:{admission:{memories:[{id:'captured',revision:1}]}}};
  assert.deepEqual(inspectWrittenMemory(core,ns,'capture',returned),{id:'captured',revision:3,content:'ABC normalized'});
  assert.equal(inspectWrittenMemory(core,ns,'review',{},{id:'confirmed',revision:1}).id,'confirmed');
  assert.deepEqual(seen,[{namespace:ns,memoryId:'captured',includeAwaiting:true},{namespace:ns,memoryId:'confirmed',includeAwaiting:true}]);
});

test('F/A below the registered minimum is inconclusive; insufficient samples cannot acquire a gate verdict',async()=>{
  const {sessionPopulation}=await import('./fixtures/context-product/v4-session.mjs');
  for(const count of [0,99,100]){
    const targets=Array.from({length:count},()=>({type:'memory',intent:'current',committedAt:0,observedAt:null}));
    const attempts=Array.from({length:count},()=>({method:'findCandidates',scheduled:true,intent:'current',code:'index_unavailable'}));
    const expected=count<100?'inconclusive':'failed';
    assert.equal(sessionPopulation({kind:'freshness',intent:'current',type:'memory'},[],targets).freshness.decision,expected);
    assert.equal(sessionPopulation({kind:'availability',intent:'current'},attempts,[]).availability.decision,expected);
  }
});

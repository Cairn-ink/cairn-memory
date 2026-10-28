// Round-3 durability regressions. Engine work, clocks and interruptions are injected.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { buildV4Plan } from '../../../tools/testing/fixtures/context-product/v4-plan.mjs';
import { createReportSink,appendSessionRecords } from '../../../tools/testing/fixtures/context-product/report.mjs';
import { readSegments,checkedSegments } from '../../../tools/testing/fixtures/context-product/v4-checkpoints.mjs';
import { journalFailure } from '../../../tools/testing/fixtures/context-product/journal-failures.mjs';
const harness=new URL('../../../tools/testing/fixtures/context-product/',import.meta.url);
const inventory=buildV4Plan('engine'),template=JSON.parse(readFileSync(new URL('../registration.engine.template.json',import.meta.url),'utf8'));
async function load(name,overrides={},context) {
  const url=new URL(name,harness),dependency=async spec=>{
    const values=overrides[spec]??(spec.endsWith('.json')?{default:JSON.parse(readFileSync(new URL(spec,url),'utf8'))}:await import(spec.startsWith('.')?new URL(spec,url).href:spec));
    const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context});await m.link(()=>{});await m.evaluate();return m;
  };
  const m=new vm.SourceTextModule(readFileSync(url,'utf8'),{context,identifier:url.href,initializeImportMeta:m=>m.url=url.href,importModuleDynamically:dependency});await m.link(dependency);await m.evaluate();return m.namespace;
}
const loop=()=>({maxMs:0,over100:0,blocks:[]});
function registration(root){
  const input=structuredClone(template);input.productionNode='v24.22.1';input.volumeRoot=root;input.adapterModule='data:text/javascript,export const validate=()=>true;export const validateProbe=()=>true;';
  const group=inventory.filter(c=>['freshness','availability'].includes(c.kind));
  input.segments=[{id:'sessions',cellKeys:group.map(c=>c.key)},{id:'rest',cellKeys:inventory.filter(c=>!group.includes(c)).map(c=>c.key)}];return input;
}
const legacy={node:'v24.22.1',hardware:{cpus:[]},filesystem:{},corpus:[]};
function runnerContext(){return vm.createContext({process:{version:'v24.22.1',once(){},off(){}},console:{log(){},error(){}},Date,setInterval:()=>1,clearInterval(){}});}
async function retries(t,header,excluded=[]){
  const w=createTestWorkspace(t),paths=[];
  for(const part of header.segments){const path=join(w.path,part.id+'.jsonl'),sink=await createReportSink(path,{...header,segmentId:part.id});for(const cell of inventory.filter(c=>part.cellKeys.includes(c.key)&&!excluded.includes(c.key)))await sink.cell(cell,{decision:'passed',complete:true});await sink.finish('passed');paths.push(path);}
  return readSegments(paths);
}
async function faultSession(kind,rehearsal,config,sink){
  const timers=[],context=vm.createContext({process,setInterval:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearInterval(){}});let renews=0,supervisorCloses=0;
  const pump={getStatus:()=>({state:'stopped'}),completion:Promise.resolve({state:'stopped'}),close:async()=>{if(kind==='close')throw Error('injected_close_exception');}};
  const driverModule=await load('v4-session-pump.mjs',{'./engine.mjs':{configure:async()=>({options:{},token:{},supervisor:{drain:async()=>[],ackCleanup(){},close:async()=>{supervisorCloses++;}}})},'../../../../core/index.mjs':{renewContextMaintenancePump:()=>{if(renews++&&kind==='renewal')throw Error('injected_renewal_exception');return pump;}}},context);
  const sessionModule=await load('v4-session.mjs',{'./actors.mjs':{actor(){},terminate:async child=>{await child.exited;},startSampler(){},attributeBlocks(){}}});
  let childSink,lease,resolveExit;const child={connected:true,exited:new Promise(r=>resolveExit=r),send(message){if(message==='export'){child.connected=false;resolveExit({code:0,signal:null});}},async wait(type){
    if(Array.isArray(type))return {type:'ready'};
    if(type==='done'){if(kind==='renewal')timers.find(t=>t.ms===60000).fn();childSink=await appendSessionRecords({...lease,rehearsal});await childSink.record(config.cell.id,'session-validation',{decision:'passed'});await childSink.close();return {type:'done'};}
    if(type==='result')return {sequence:childSink.sequence,value:{}};
  }};
  const leased={...sink,delegate:async()=>{lease=await sink.delegate();return lease;}};
  try{await sessionModule.sharedSession([],{}, {config:{...config,rehearsal,pump:{id:'unit-pump',cronMs:60000}},sink:leased},{makeSession:()=>child,preparePump:async c=>{return driverModule.prepareSessionPump(c);},makeSampler:async()=>({stop:async()=>({supported:false,samples:[]})}),loopFactory:()=>({finish:async()=>loop()})});assert.fail('shutdown exception disappeared');}
  catch(error){assert.equal(error.cleanup?.pumpUnconfirmed,true);assert.match(error.message,/workspace_retained/);assert.equal(supervisorCloses,1);throw error;}
}
for(const kind of ['renewal','close'])for(const rehearsal of [false,true])test(`Q3-01 real caller and runner retain ${kind} exception with child-owned journal, rehearsal=${rehearsal}`,async t=>{
  const w=createTestWorkspace(t),input=registration(w.path),path=join(w.path,'interrupted.jsonl');let sink;
  const reports=await import(new URL('report.mjs',harness));
  const runner=await load('v4-runner.mjs',{'./report.mjs':{...reports,createReportSink:async(...args)=>sink=await reports.createReportSink(...args)},'./series.mjs':{build:async()=>({coverage:'complete',diagnostics:[]}),requestSeries(){ }},'./v4-session.mjs':{sharedSession:async(cells,session,{config,sink})=>faultSession(kind,rehearsal,config,sink)}},runnerContext());
  await assert.rejects(runner.runV4(input,{profile:'engine',segmentId:'sessions',reportPath:path},{validateRegistration(){},preregister:async()=>legacy,idleBaseline:async()=>loop(),prepareCell:async()=>({readSet:[input.fixtures[0].inventory[0]]}),probeDependencies:async()=>({ready:true}),storage:async()=>({value:{}})}),/workspace_retained/);
  assert.ok(readFileSync(path+'.partial','utf8').includes('registration'));assert.ok(!readFileSync(path+'.partial','utf8').includes('"type":"final"'));
  const [prior]=await readSegments([path+'.partial']);assert.equal(prior.knownFailure,true);assert.equal(prior.cells.length,0);
  const passing=await retries(t,prior.header),merged=checkedSegments(prior.header,[prior,...passing]);assert.equal(merged.cells.length,728);assert.equal(merged.complete,true);assert.equal(merged.decision,'failed');
  // The coordinator and runner must each durably preserve their own failure.
  const file=path+'.failures.jsonl',rows=readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(rows.some(r=>r.series==='pump'&&r.record.kind===kind+'-exception'));
  assert.ok(rows.some(r=>r.series==='failure'&&r.record.stage==='shared-session'));
  assert.ok(rows.some(r=>r.series==='failure'&&r.record.stage==='runner-cleanup'));
});

for(const completeCount of [0,1])for(const boundary of ['before-idle','after-header'])test(`Q3-02 inherited failures and ${completeCount} complete cells survive three interrupted resume links at ${boundary}`,async t=>{
  const w=createTestWorkspace(t),input=registration(w.path),headers=[],reports=await import(new URL('report.mjs',harness));let sink,interruptAfterHeader=false;
  const runner=await load('v4-runner.mjs',{'./report.mjs':{...reports,createReportSink:async(path,header)=>{headers.push(header);sink=await reports.createReportSink(path,header);if(interruptAfterHeader){await sink.interrupt();throw Error('injected_interruption_after_header');}return {...sink,finish:async()=>sink.interrupt()};}}},runnerContext());
  const deps={validateRegistration(){},preregister:async()=>legacy,idleBaseline:async()=>{throw Error('injected_interruption_before_first_cell');}};
  const probe=join(w.path,'header.jsonl');await assert.rejects(runner.runV4(structuredClone(input),{profile:'engine',segmentId:'sessions',reportPath:probe},deps),/injected_interruption/);
  const header=headers[0],a=join(w.path,'A.jsonl'),first=await createReportSink(a,header);await first.record(inventory.find(c=>c.kind==='freshness').id,'pump',{state:'failed',error:'pump_failed'});
  const complete=inventory.filter(c=>header.segments.find(s=>s.id==='sessions').cellKeys.includes(c.key)).slice(0,completeCount);
  for(const cell of complete)await first.cell(cell,{decision:'passed',complete:true});await first.interrupt();let previous=a+'.partial';
  const success=await retries(t,header,complete.map(c=>c.key));interruptAfterHeader=boundary==='after-header';
  for(const name of ['B','C','D']){
    const path=join(w.path,name+'.jsonl');await assert.rejects(runner.runV4(structuredClone(input),{profile:'engine',segmentId:'sessions',reportPath:path,resume:[previous]},deps),/injected_interruption/);
    const [retained]=await readSegments([path+'.partial']);assert.equal(retained.knownFailure,true,name+' retains aggregate failure');assert.deepEqual(retained.cells.map(c=>c.key),complete.map(c=>c.key),name+' retains complete cells');
    const merged=checkedSegments(header,[retained,...success]);assert.equal(merged.cells.length,728);assert.equal(merged.complete,true);assert.equal(merged.decision,'failed');previous=path+'.partial';
  }
});

const read={ok:true,expected:true,bounds:true,validated:true,code:null};
const healthy={
  'lane-exit':{exit:{code:0,signal:null}},pump:{state:'stopped'},maintenance:{status:'partial'},
  main:read,availability:{...read,ok:false,code:'index_unavailable'},probe:read,
  capability:{ready:true},checkpoint:{decision:{decision:'inconclusive',observedFailure:false}},
};
test('Q3-03 missing exit/status fields, unknown kinds and unknown series fail closed; expected controls stay healthy',()=>{
  assert.equal(journalFailure('lane-exit',{exit:{signal:null}}),true);
  assert.equal(journalFailure('pump',{kind:'renewal-exception',error:'renewal_exception'}),true);
  assert.equal(journalFailure('unregistered-series',{state:'stopped'}),true);
  for(const [series,value] of Object.entries(healthy)){
    assert.equal(journalFailure(series,value),false,series+' healthy');
    for(const bad of [null,{},[],{...value,kind:'unregistered'}])assert.equal(journalFailure(series,bad),true,series+' malformed '+JSON.stringify(bad));
  }
  for(const series of ['main','availability','probe'])assert.equal(journalFailure(series,{...read,ok:false,code:'read_timeout',retryable:true}),false,series+' timeout control');
  assert.equal(journalFailure('maintenance',{status:'rebuilding'}),false);
  assert.equal(journalFailure('capability',{ready:false,blocked:['missing-capability']}),false);
});


test('Q3-03 every registered writer series has a healthy shape or is always a failure',async t=>{
  const sampleRead={ok:true,expected:true,bounds:true,validated:true,code:null};
  const success={decision:'passed'},zeroExit={code:0,signal:null,disconnected:true};
  const samples={
    pump:{kind:'renew',status:{state:'active',error:null}},maintenance:{status:'rebuilding'},
    'lane-exit':{pid:1,exit:zeroExit},'locker-exit':{exit:zeroExit},
    capability:{ready:false,blocked:['absent']},checkpoint:{decision:success},pair:{decision:success},
    'resumed-checkpoints':{retainedDecisions:['passed','invalid','inconclusive'],inheritedFailure:false,cells:[],cellKeys:[]},
    'session-validation':success,'WM-functional':{decision:'inconclusive',functionalPassed:true},'exposure-final':success,
    'WM-evidence':{validation:success,decisions:[success]},'exposure-functional':{windows:1,WM:{decision:'inconclusive',functionalPassed:true}},
    'freshness-targets':[{type:'memory',id:'memory',intent:'current',revision:1,observedAt:null}],
    'maintenance-drain':[{state:'complete',workerStopped:true,nativeDisposed:true}],
    'pump-drain':[],'state-reader-final-drain':[],
    'lane-startup':{pid:1},'session-parent-loop':{hostPid:1},'idle-baseline':loop(),
    population:{initial:{memories:4,cards:1,schema:23},final:{memories:5,cards:1,schema:23}},
    'window-boundary':{repetition:0,variant:'baseline'},'overlap-final':{series:'main',index:0,overlap:false},
    'admission-stopped':{reason:'operator_interrupted',remaining:728},
    'backup-output':{verifiedIntents:['current','history'],sidecar:{main:1,wal:0,shm:0,total:1},maintainerCoverage:'complete'},
    subprobe:{id:'opening-timeout',expected:true,code:'read_timeout'},
  };
  for(const series of ['warmups','main','cold','warm-reference','WM','window','probe','availability','restored-reader','functional','smoke','injection','c12','c24','a1500','a4000','f1-full','f1-compact','f1-snapshot','f24-full','f24-compact','f24-snapshot'])samples[series]=sampleRead;
  for(const series of ['writer','session-writer','window-writer','state-writer','catchup-writer','injected-writer'])samples[series]={exit:zeroExit,calls:[{operation:'capture',code:null}]};
  for(const series of ['attribution','backup-attribution','session-parent-attribution'])samples[series]={supported:true,exit:zeroExit,coverage:'complete'};
  const failures=['failure','lane-failure','session-supervision','schedule-omission','subprobe-incomplete'];
  for(const [series,value] of Object.entries(samples))await t.test(series,()=>{
    assert.equal(journalFailure(series,value),false,'current healthy shape');
    const malformed=Array.isArray(value)?[null,{},[{}],{kind:'unregistered'}]:[null,{},[],{...value,kind:'unregistered'}];
    for(const record of malformed)assert.equal(journalFailure(series,record),true,'malformed '+JSON.stringify(record));
  });
  for(const series of failures)for(const record of [null,{},[],{code:'failure'}])assert.equal(journalFailure(series,record),true,series);
  const {JOURNAL_SERIES}=await import('../../../tools/testing/fixtures/context-product/journal-failures.mjs');
  assert.deepEqual(JOURNAL_SERIES??[],[...Object.keys(samples),...failures].sort());
  // Discover real writer sites independently of this registry and these samples.
  const sources=[...readdirSync(harness).filter(f=>f.endsWith('.mjs')).map(f=>new URL(f,harness)),new URL('../../../tools/testing/measure-context-read-product.mjs',import.meta.url)];
  const found=new Set();for(const file of sources)for(const match of readFileSync(file,'utf8').matchAll(/(?:\bwrite\(|\brecord\([^,\n]+,)\s*'([^']+)'/g))found.add(match[1]);
  for(const series of found)assert.ok(JOURNAL_SERIES.includes(series),'unregistered writer site: '+series);
  t.diagnostic('Audited '+found.size+' literal writer series; '+JOURNAL_SERIES.length+' total registered series including dynamic readers and writers.');
});

test('Q3-03 nested status and exit defects fail closed without reclassifying progress controls',()=>{
  for(const record of [{kind:'renew',status:{}},{kind:'renew',status:{state:'active',kind:'unregistered'}},{kind:'unknown',state:'active'},{kind:'renewal-exception',error:'renewal_exception'},{state:'unknown'},{state:null}])assert.equal(journalFailure('pump',record),true);
  for(const exit of [{signal:null},{code:0},{code:'0',signal:null},{code:0,signal:'SIGTERM'},{code:0,signal:null,disconnected:false}]){
    assert.equal(journalFailure('lane-exit',{exit}),true);assert.equal(journalFailure('session-writer',{calls:[],exit}),true);
  }
  for(const code of ['read_timeout','index_unavailable','storage_busy'])for(const series of ['main','availability','probe'])assert.equal(journalFailure(series,{...read,ok:false,code,retryable:true}),false);
  assert.equal(journalFailure('pump',{kind:'renew',status:{state:'active',error:null}}),false);
  assert.equal(journalFailure('maintenance',{intent:'current',quantum:0,status:'rebuilding',reason:'fence_changed'}),false);
  assert.equal(journalFailure('subprobe',{id:'status',code:null,expected:true,state:'catching_up',progress:{phase:1,checkpoint:0}}),false);
});

test('Q3-01 failure-journal loss refuses replay and journal IO errors preserve the cleanup guard',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'report.jsonl'),header={protocol:{version:'P2-product-v4'},inventory,cellCount:728,segmentId:'all',segments:[{id:'all',cellKeys:inventory.map(c=>c.key)}],registrationHash:'unit',host:{id:'host'},volume:{id:'volume'},node:'v24.22.1'};
  const sink=await createReportSink(path,header);await sink.interrupt();
  const {unlinkSync}=await import('node:fs');unlinkSync(path+'.failures.jsonl');await assert.rejects(readSegments([path+'.partial']),/missing_failure_journal/);
  const owned=await createReportSink(join(w.path,'guard.jsonl'),header);
  const broken={...owned,failure:async()=>{throw Error('injected_journal_IO_failure');},record:async()=>{throw Error('main_lease_still_owned');},reclaim:async()=>assert.fail('unsafe lease reclaim')};
  try{await assert.rejects(faultSession('close',false,{cell:{id:1}},broken),e=>e.cleanup?.pumpUnconfirmed===true&&e.journalError==='injected_journal_IO_failure');}finally{await owned.interrupt();}
});


test('Q3-03 replay latches malformed payloads in every series before population interpretation',async t=>{
  const w=createTestWorkspace(t),header={protocol:{version:'P2-product-v4'},inventory,cellCount:728,segmentId:'all',segments:[{id:'all',cellKeys:inventory.map(c=>c.key)}],registrationHash:'unit',host:{id:'host'},volume:{id:'volume'},node:'v24.22.1'};
  const {JOURNAL_SERIES}=await import('../../../tools/testing/fixtures/context-product/journal-failures.mjs');
  for(const [i,series] of [...(JOURNAL_SERIES??['pump','lane-exit','freshness-targets','main','resumed-checkpoints']),'unregistered-series'].entries()){
    const path=join(w.path,i+'.jsonl'),sink=await createReportSink(path,header);await sink.record(inventory[0].id,series,null);await sink.interrupt();
    // Remove the new marker too: replay must fail closed for pre-marker reports.
    const journal=path+'.records.jsonl',rows=readFileSync(journal,'utf8').trim().split('\n').map(JSON.parse);delete rows[1].failure;
    const {writeFileSync}=await import('node:fs');writeFileSync(journal,rows.map(JSON.stringify).join('\n')+'\n');
    const [prior]=await readSegments([path+'.partial']);assert.equal(prior.knownFailure,true,series);
  }
});

test('Q3-03 a real tiny functional report has only recognized healthy records',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'functional.jsonl');
  const {functionalOnly}=await import('../../../tools/testing/measure-context-read-product.mjs');
  const result=await functionalOnly(path);assert.equal(result.functionalPassed,true);assert.equal(result.status,'inconclusive');
  const rows=readFileSync(path+'.records.jsonl','utf8').trim().split('\n').map(JSON.parse).filter(r=>r.type==='record');
  assert.ok(rows.length>0);for(const row of rows){assert.equal(journalFailure(row.series,row.record),false,row.series);assert.notEqual(row.failure,true,row.series);}
});


test('Q3-03 malformed completed-cell verdicts cannot bypass the shared status classifier',async t=>{
  const w=createTestWorkspace(t),header={protocol:{version:'P2-product-v4'},inventory,cellCount:728,segmentId:'all',segments:[{id:'all',cellKeys:inventory.map(c=>c.key)}],registrationHash:'unit',host:{id:'host'},volume:{id:'volume'},node:'v24.22.1'};
  for(const [i,decision] of [{complete:true},{decision:'unknown',complete:true},{decision:'passed',complete:'yes'}].entries()){
    const path=join(w.path,i+'.jsonl'),sink=await createReportSink(path,header);await sink.cell(inventory[0],decision);await sink.interrupt();assert.equal((await readSegments([path+'.partial']))[0].knownFailure,true);
  }
});

test('Q3-02 mirrored inherited cells are idempotent while duplicate new cells still refuse merge',async t=>{
  const w=createTestWorkspace(t),cell=inventory[0],prior={key:cell.key,cell,complete:true,decision:'passed',record:{decision:'passed',complete:true},summary:{}};
  const carried={inheritedFailure:false,cells:[prior],cellKeys:[cell.key],retainedDecisions:['passed']};
  const header={protocol:{version:'P2-product-v4'},inventory,cellCount:728,segmentId:'all',segments:[{id:'all',cellKeys:inventory.map(c=>c.key)}],registrationHash:'unit',host:{id:'host'},volume:{id:'volume'},node:'v24.22.1',resumedCheckpoint:carried};
  const path=join(w.path,'duplicates.jsonl'),sink=await createReportSink(path,header);await sink.record(-1,'resumed-checkpoints',carried);
  await sink.cell(cell,{decision:'passed',complete:true});await sink.cell(cell,{decision:'passed',complete:true});await sink.interrupt();
  const segments=await readSegments([path+'.partial']);assert.equal(segments[0].knownFailure,false);assert.equal(segments[0].cells.length,2);
  assert.throws(()=>checkedSegments(header,segments),/segment_duplicate_cell/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createTestWorkspace} from '../../../tools/testing/workspace.mjs';
import {buildV4Plan} from '../../../tools/testing/fixtures/context-product/v4-plan.mjs';
import {createReportSink} from '../../../tools/testing/fixtures/context-product/report.mjs';
import {readSegments,checkedSegments} from '../../../tools/testing/fixtures/context-product/v4-checkpoints.mjs';
import {journalFailure} from '../../../tools/testing/fixtures/context-product/journal-failures.mjs';
import {decide} from '../../../tools/testing/fixtures/context-product/protocol.mjs';
const harness=new URL('../../../tools/testing/fixtures/context-product/',import.meta.url),inventory=buildV4Plan('engine');
const template=JSON.parse(readFileSync(new URL('../registration.engine.template.json',import.meta.url),'utf8'));
const loop=()=>({maxMs:0,over100:0,blocks:[]});
async function load(name,overrides={},context,transform=s=>s) {
  const url=new URL(name,harness),dependency=async spec=>{
    const values=overrides[spec]??(spec.endsWith('.json')?{default:JSON.parse(readFileSync(new URL(spec,url),'utf8'))}:await import(spec.startsWith('.')?new URL(spec,url).href:spec));
    const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context});await m.link(()=>{});await m.evaluate();return m;
  };
  const m=new vm.SourceTextModule(transform(readFileSync(url,'utf8')),{context,identifier:url.href,initializeImportMeta:m=>m.url=url.href,importModuleDynamically:dependency});await m.link(dependency);await m.evaluate();return m.namespace;
}
function registration(root,role='wsl2-ext4'){
  const input=structuredClone(template);input.volumeRoot=root;input.platformRole=role;input.volume={id:'volume',mount:root,filesystem:'ext4',production:false};input.host={id:'host',cpu:'cpu',ramBytes:1,os:'os',owner:'operator'};
  input.adapterModule='data:text/javascript,export const validate=()=>true;export const validateProbe=()=>true;';return input;
}
async function runner(t,input,{failed=false,interrupt=Infinity}={}) {
  let stop,prepared=0;const configs=[],output=[],context=vm.createContext({process:{version:'v24.22.1',once:(event,fn)=>{if(event==='SIGINT')stop=fn;},off(){}},console:{log:value=>output.push(value),error(){}},Date,setInterval:()=>1,clearInterval(){}});
  const verdict=c=>({decision:failed&&c.id===0?'failed':'passed'});
  const mod=await load('v4-runner.mjs',{'node:os':{platform:()=> 'linux',release:()=> 'native-kernel'},'./series.mjs':{build:async()=>({coverage:'complete',diagnostics:[]}),requestSeries:async(config,{cell})=>{configs.push(config);return {decision:verdict(cell),languageCoverage:true};}},'./v4-windows.mjs':{exposureCell:async c=>verdict(c)},'./v4-state.mjs':{stateCell:async c=>verdict(c)},'./v4-session.mjs':{sharedSession:async cells=>new Map(cells.map(c=>[c.key,verdict(c)]))}},context);
  const deps={validateRegistration(){},preregister:async()=>({node:'v24.22.1',hardware:{cpus:[]},filesystem:{type:0xef53},corpus:[]}),idleBaseline:async()=>loop(),prepareCell:async()=>{if(++prepared===interrupt)stop();return {readSet:[input.fixtures[0].inventory[0]],initialCounts:{memories:32,cards:4,schema:23},production:false};},probeDependencies:async()=>({ready:true}),prepareInput:async c=>c,storage:async()=>({value:{memories:32,cardCount:4,schema:23}}),backupSeries:async(c,cell)=>verdict(cell)};
  return {configs,output,run:(segmentId,path,resume=[])=>mod.runV4(structuredClone(input),{profile:'engine',segmentId,reportPath:path,resume},deps)};
}
for(const scenario of ['success','failure','interrupted'])test(`Q3c-01 real 364 + 364 segment resume and merge: ${scenario}`,async t=>{
  const w=createTestWorkspace(t),input=registration(w.path),r=await runner(t,input,{failed:scenario==='failure'}),a=join(w.path,'segment-1.jsonl'),b=join(w.path,'segment-2.jsonl');
  assert.ok(input.segments[0].cellKeys.includes(inventory[0].key),'the injected failure belongs to segment 1');
  await r.run('segment-1',a);let latest=b;
  if(scenario==='interrupted'){
    const interrupted=await runner(t,input,{interrupt:8});await interrupted.run('segment-2',b,[a]);const [prefix]=await readSegments([b]);assert.ok(prefix.cells.length>0&&prefix.cells.length<364);assert.equal(prefix.carriedCells.length,364);assert.equal(prefix.knownFailure,false);latest=join(w.path,'segment-2-resumed.jsonl');await r.run('segment-2',latest,[b]);
  }else await r.run('segment-2',b,[a]);
  const segments=await readSegments([a,latest]);
  assert.deepEqual(segments.map(s=>s.cells.length),[364,364]);
  const end=readFileSync(latest,'utf8').trim().split('\n').map(JSON.parse).at(-1);assert.equal(end.segmentComplete,true);assert.equal(end.complete,true);
  assert.ok(segments[1].cells.every(c=>input.segments[1].cellKeys.includes(c.key)));assert.equal(segments[1].carriedCells.length,364);
  assert.equal(checkedSegments(segments[0].header,[segments[1]]).decision,scenario==='failure'?'failed':'inconclusive');
  const merged=checkedSegments(segments[0].header,segments);assert.equal(merged.cells.length,728);assert.equal(merged.complete,true);assert.equal(merged.decision,scenario==='failure'?'failed':'passed');
  assert.throws(()=>checkedSegments(segments[0].header,[...segments,segments[1]]),/segment_duplicate_cell/);
});

// Drive the real coordinator and pump wrapper; inject only engine/actor failures.
async function brokenSession(kind,rehearsal,config,sink){
  let renews=0,lease,childSink,resolveExit;const timers=[],context=vm.createContext({process,setInterval:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearInterval(){}});
  const pump={getStatus:()=>({state:'stopped'}),completion:Promise.resolve({state:'stopped'}),close:async()=>{if(kind==='close')throw Error('close_exception');}};
  const driverModule=await load('v4-session-pump.mjs',{'./engine.mjs':{configure:async()=>({options:{},token:{},supervisor:{drain:async()=>[],ackCleanup(){},close:async()=>{}}})},'../../../../core/index.mjs':{renewContextMaintenancePump:()=>{if(renews++&&kind==='renewal')throw Error('renewal_exception');return pump;}}},context);
  const mod=await load('v4-session.mjs',{'./actors.mjs':{actor(){},terminate:async c=>c.exited,startSampler(){},attributeBlocks(){}}});
  const {appendSessionRecords}=await import(new URL('report.mjs',harness));
  const child={connected:true,exited:new Promise(r=>resolveExit=r),send(m){if(m==='export'){child.connected=false;resolveExit({code:0,signal:null});}},async wait(type){if(Array.isArray(type))return {type:'ready'};if(type==='done'){if(kind==='renewal')timers[0].fn();childSink=await appendSessionRecords({...lease,rehearsal});await childSink.record(config.cell.id,'session-validation',{decision:'passed'});await childSink.close();return {type:'done'};}return {sequence:childSink.sequence,value:{}};}};
  const leased={...sink,delegate:async()=>lease=await sink.delegate()};
  return mod.sharedSession([],{}, {config:{...config,rehearsal,pump:{id:'unit',cronMs:20000}},sink:leased},{makeSession:()=>child,preparePump:c=>driverModule.prepareSessionPump(c),makeSampler:async()=>({stop:async()=>({supported:false,samples:[]})}),loopFactory:()=>({finish:async()=>loop()})});
}
for(const kind of ['renewal','close'])for(const rehearsal of [false,true])test(`Q3c-02 durable session-open survives EACCES appends: ${kind}, rehearsal=${rehearsal}`,async t=>{
  const w=createTestWorkspace(t),input=registration(w.path),group=inventory.filter(c=>['freshness','availability'].includes(c.kind));input.segments=[{id:'sessions',cellKeys:group.map(c=>c.key)},{id:'rest',cellKeys:inventory.filter(c=>!group.includes(c)).map(c=>c.key)}];
  const reports=await import(new URL('report.mjs',harness)),path=join(w.path,'interrupted.jsonl');
  const context=vm.createContext({process:{version:'v24.22.1',once(){},off(){}},console:{log(){},error(){}},Date,setInterval:()=>1,clearInterval(){}});
  const mod=await load('v4-runner.mjs',{'./report.mjs':{...reports,createReportSink:async(...args)=>({...await reports.createReportSink(...args),failure:async()=>{throw Object.assign(Error('append denied'),{code:'EACCES'});}})},'./series.mjs':{build:async()=>({coverage:'complete',diagnostics:[]}),requestSeries(){}},'./v4-session.mjs':{sharedSession:(cells,session,{config,sink})=>brokenSession(kind,rehearsal,config,sink)}},context);
  await assert.rejects(mod.runV4(input,{profile:'engine',segmentId:'sessions',reportPath:path},{validateRegistration(){},preregister:async()=>({node:'v24.22.1',hardware:{cpus:[]},filesystem:{},corpus:[]}),idleBaseline:async()=>loop(),prepareCell:async()=>({readSet:[input.fixtures[0].inventory[0]]}),probeDependencies:async()=>({ready:true})}),e=>e.cleanup?.pumpUnconfirmed===true&&e.journalError==='EACCES');
  const [prior]=await readSegments([path+'.partial']);assert.equal(prior.knownFailure,true);assert.equal(readFileSync(path+'.failures.jsonl','utf8').trim().split('\n').length,1);
  const retries=[];for(const segment of input.segments){const path=join(w.path,segment.id+'.jsonl'),sink=await createReportSink(path,{...prior.header,segmentId:segment.id});for(const c of inventory.filter(c=>segment.cellKeys.includes(c.key)))await sink.cell(c,{complete:true,decision:'passed'});await sink.finish('passed');retries.push(path);}
  const merged=checkedSegments(prior.header,[prior,...await readSegments(retries)]);assert.equal(merged.complete,true);assert.equal(merged.decision,'failed');
});

test('Q3c-03 exact incomplete coverage sentinel stays invalid, with malformed variants failed',async t=>{
  const sentinel=[{diagnostics:{protocol:'context-native-v1',coverage:'incomplete',busy:0,records:[]}}];const {functionalEvidence}=await import(new URL('rehearsal-checks.mjs',harness));
  for(const mutate of [d=>{d.busy=1;},d=>{delete d.records;},d=>{d.extra=true;},d=>{d.protocol='unknown';}]){const bad=structuredClone(sentinel);mutate(bad[0].diagnostics);assert.equal(journalFailure('pump-drain',bad),true);}
  const w=createTestWorkspace(t),cell=inventory.find(c=>c.canonical==='WAL'),header={protocol:{version:'P2-product-v4'},inventory,cellCount:728,segmentId:'all',segments:[{id:'all',cellKeys:inventory.map(c=>c.key)}],registrationHash:'unit',host:{id:'host'},volume:{id:'volume'},node:'v24.22.1'};
  const value=decide(cell,{loops:[loop()],readerCoverage:'complete',maintainerCoverage:'incomplete',writerCoverage:'complete',baselineCoverage:'complete'});assert.equal(value.decision,'invalid');assert.equal(value.observedFailure,false);
  const path=join(w.path,'coverage.jsonl'),sink=await createReportSink(path,header);await sink.record(cell.id,'pump-drain',sentinel);await sink.cell(cell,{...value,complete:true});await sink.finish('invalid');
  const segments=await readSegments([path]);assert.equal(checkedSegments(header,segments).decision,'invalid');assert.equal(segments[0].knownFailure,false);assert.equal(journalFailure('pump-drain',sentinel),false);
  assert.deepEqual(functionalEvidence(sentinel),sentinel);
  const filteredPath=join(w.path,'filtered-coverage.jsonl'),filtered=await createReportSink(filteredPath,header);await filtered.record(cell.id,'pump-drain',functionalEvidence(sentinel));await filtered.cell(cell,{...value,complete:true});await filtered.finish('invalid');assert.equal(checkedSegments(header,await readSegments([filteredPath])).decision,'invalid');
});

test('Q3c-04 storage stdout decodes split multibyte bytes only after transport flush',async()=>{
  const code=`const bytes=Buffer.from(JSON.stringify({value:{text:'保守予算'}}));const cut=bytes.indexOf(Buffer.from('予'))+1;process.stdout.write(bytes.subarray(0,cut));process.on('message',()=>process.stdout.write(bytes.subarray(cut),()=>process.disconnect()));`;
  const mod=await load('../../measure-context-read-product.mjs',{'node:child_process':{...(await import('node:child_process')),spawn(){const child=spawn(process.execPath,['-e',code],{stdio:['ignore','pipe','pipe','ipc']});child.stdout.once('data',()=>{child.send('flush');});return child;}}},undefined,source=>"import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';\n"+source.slice(source.indexOf('const storageUrl='),source.indexOf('export function writerProfile')));
  const result=await mod.storage('inspect',{});assert.equal(result.value.text,'保守予算');assert.equal(result.exit.code,0);
});

test('Q3c-06 deterministic product template and SHA-256 seal register the final in-process pump',async()=>{
  assert.deepEqual(template.pump,{cronMs:20000,pollMs:25,renewalMs:60000,quantum:{maxItems:32,maxMs:1000},budgets:{maxItems:2048,maxMs:60000}});
  const {buildTemplate}=await import('../build-template.mjs'),bytes=readFileSync(new URL('../registration.engine.template.json',import.meta.url));
  assert.equal(JSON.stringify(buildTemplate(),null,2)+'\n',bytes.toString());assert.equal(readFileSync(new URL('../registration.engine.template.sha256',import.meta.url),'utf8'),createHash('sha256').update(bytes).digest('hex')+'  registration.engine.template.json\n');
  assert.deepEqual(template.pump,{cronMs:20000,pollMs:25,renewalMs:60000,quantum:{maxItems:32,maxMs:1000},budgets:{maxItems:2048,maxMs:60000}});assert.ok(template.productInputs.pump.representationLimits.length>=5);
});

test('Q3c-07 native revision-1 engine scores gates but stays non-qualifying; production rejects; WSL unchanged',async t=>{
  const {validateRegistration}=await import('../../../tools/testing/measure-context-read-product.mjs');const {V3_DEFINITION}=await import(new URL('protocol.mjs',harness));
  const {enginePlatform,validateV4Registration}=await import(new URL('v4-runner.mjs',harness));
  const w=createTestWorkspace(t),input=registration(w.path,'native-linux-ext4');assert.doesNotThrow(()=>validateRegistration({...input,protocolDefinition:V3_DEFINITION,profileCommit:'a'.repeat(40),protocolCommit:'b'.repeat(40),adapterModule:new URL('../adapter.mjs',import.meta.url).href,counterModule:new URL('../counter.mjs',import.meta.url).href},{engineProfile:true}));assert.doesNotThrow(()=>validateV4Registration(input,'engine'));
  assert.throws(()=>validateV4Registration({...input,protocolDefinition:undefined},'production'),/production_platform/);
  const native=enginePlatform(input,'engine','v24.22.1');assert.equal(native.production,false);assert.equal(native.qualifying,false);assert.equal(native.diagnostic,true);assert.ok(native.diagnosticReason);
  const data={records:[],loops:[loop()],production:false,enginePlatformEligible:native.enginePlatformEligible};assert.equal(decide(inventory[0],data).decision,'passed');assert.equal(decide(inventory[0],{...data,enginePlatformEligible:false}).decision,'inconclusive');
  const wsl=enginePlatform({...input,platformRole:'wsl2-ext4'},'engine','v24.22.1');assert.equal(wsl.enginePlatformEligible,true);assert.equal(wsl.diagnostic,undefined);assert.equal(wsl.qualifying,undefined);
  const {requestSeries}=await import(new URL('series.mjs',harness));
  const read=async()=>({record:{ok:true,expected:true,bounds:true,validated:true,elapsedMs:1,readMs:1,hostLoop:loop(),telemetry:'complete',nativeBusy:0,publicBusy:0}});
  for(const eligible of [true,false]){
    const actual=await requestSeries({production:false,enginePlatformEligible:eligible,load:'idle',seriesCeilingMs:60000,maintainerCoverage:'complete',maintainerDiagnostics:[]},{cell:inventory[0],sink:{record:async()=>{}},oracle:()=>true},{attempt:read,coldAttempt:read,startSampler:async()=>({collect:async()=>[],stop:async()=>({})})});
    assert.equal(actual.decision.decision,eligible?'passed':'inconclusive');assert.equal(actual.decision.checks.mainLatency,true);assert.equal(actual.decision.checks.coldLatency,true);assert.equal(actual.decision.checks['warm-referenceLatency'],true);t.diagnostic(JSON.stringify({enginePlatformEligible:eligible,production:false,decision:actual.decision.decision,checks:actual.decision.checks}));
  }
  const r=await runner(t,input),path=join(w.path,'native.jsonl');const result=await r.run('segment-1',path);assert.equal(result.diagnostic,true);assert.equal(result.qualifying,false);assert.ok(r.configs.every(c=>c.production===false&&c.enginePlatformEligible===true));
  const final=readFileSync(path,'utf8').trim().split('\n').map(JSON.parse).at(-1);assert.equal(final.diagnostic,true);assert.equal(final.qualifying,false);assert.equal(final.segmentComplete,true);
  assert.equal(JSON.parse(r.output.at(-1)).qualifying,false);
  const {summarize}=await import('../../../tools/testing/summarize-context-read-product.mjs');const summary=await summarize(path,()=>{});assert.equal(summary.diagnostic,true);assert.equal(summary.qualifying,false);assert.ok(summary.diagnosticReason);
  const second=join(w.path,'native-second.jsonl');await r.run('segment-2',second,[path]);
  const {main}=await import('../../../tools/testing/measure-context-read-product.mjs'),printed=[];t.mock.method(console,'log',line=>printed.push(line));
  const mergedPath=join(w.path,'native-merged.jsonl'),merged=await main(['--profile','engine','--merge',path,'--merge',second,'--report',mergedPath]);assert.equal(merged.decision,'passed');assert.equal(merged.cells.length,728);assert.equal(merged.qualifying,false);assert.equal(merged.diagnostic,true);
  const display=JSON.parse(printed.at(-1));assert.equal(display.status,'passed');assert.equal(display.qualifying,false);assert.equal(display.diagnostic,true);
  const mergedSummary=await summarize(mergedPath,()=>{});assert.equal(mergedSummary.status,'passed');assert.equal(mergedSummary.qualifying,false);assert.equal(mergedSummary.diagnostic,true);

});

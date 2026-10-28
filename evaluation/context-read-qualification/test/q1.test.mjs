import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync,writeFileSync,mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorks } from '../../../tools/testing/fixtures/context-product/rehearsal-checks.mjs';
const harness=new URL('../../../tools/testing/fixtures/context-product/',import.meta.url);
async function load(name,overrides={},base=harness) {
  const url=new URL(name,base);
  const dependency=async spec=>{
    const values=overrides[spec]??(spec.endsWith('.json')?{default:JSON.parse(readFileSync(new URL(spec,url),'utf8'))}:await import(new URL(spec,url).href));
    const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);});await m.link(()=>{});await m.evaluate();return m;
  };
  const m=new vm.SourceTextModule(readFileSync(url,'utf8'),{identifier:url.href,initializeImportMeta:m=>m.url=url.href,importModuleDynamically:dependency});await m.link(dependency);await m.evaluate();return m.namespace;
}
test('Q1-01 both pumps retain a failure completed during close, plus final status',async()=>{
  for(const file of ['v4-session-pump.mjs','series.mjs'])for(const late of [true,false,'reject','rejected-completion','supervisor-reject']) {
    let resolve,reject,status={state:'active',id:'pump'},records=[];
    const completion=new Promise((r,j)=>{resolve=r;reject=j;});if(!late)resolve({state:'stopped'});
    const pump={completion,getStatus:()=>status,async close(){status={state:'failed',error:'index_unavailable',id:'pump'};if(late==='rejected-completion'){status={state:'stopped'};reject(Error('reader_failed'));}else if(late)resolve(status);if(late==='reject')throw Error('close_failed');}};
    const supervisor={drain:async()=>[],ackCleanup(){},close:async()=>{if(late==='supervisor-reject')throw Error('super_close_failed');}};
    const c={supervisor,options:{},token:{}};
    const mod=await load(file,{'./engine.mjs':{configure:async()=>c,attempt(){},drain:async()=>[]},'../../../../core/index.mjs':{renewContextMaintenancePump:()=>pump}});
    const config={protocol:'P2-product-v4',types:['memory'],pump:{id:'pump',cronMs:60000,pollMs:25,renewalMs:10000,quantum:{maxItems:128,maxMs:1000},budgets:{maxItems:1024,maxMs:8000}}};
    const write=async(s,r)=>records.push([s,r]);
    const driver=file==='series.mjs'?await mod.startPump(config,write):await mod.prepareSessionPump(config);
    const running=file==='series.mjs'?driver:driver.start();
    await assert.rejects(running.stop(),/index_unavailable|maintenance_pump_failed|close_failed|reader_failed|super_close_failed/);
    if(driver.report)await driver.report(write);
    assert.ok(records.some(([s,r])=>s==='pump'&&r.state==='failed'));
  }
});
test('Q1-02 nonzero lane exits fail independently in both modes',async()=>{
  for(const rehearsal of [true,false]) {
    let n=0;
    const mod=await load('v4-session-work.mjs',{'./controller.mjs':{startWriter(){},recordedWriter:async()=>({start(){},flush(){},child:{take:()=>[]},stop:async()=>({calls:[],pacing:[],writerEndAt:1e9,diagnostics:{coverage:'complete',records:[]},exit:{code:0}})})},'./v4-validation.mjs':{validateSessionRegistration:()=>({decision:'passed'}),validateSessionEvidence:()=>({decision:'passed'})}});
    const lane=()=>({pid:++n,connected:true,send(){},wait:async()=>({}),exited:Promise.resolve({code:1,signal:null})});
    let clock=0;
    await assert.rejects(mod.sessionWork([],{availability:[],targets:[],batches:[]},{config:{rehearsal,cell:{id:1,schema:18}},prepareInput:async()=>({}),sink:{record:async()=>{}},validateProbe:()=>true},{makeLane:lane,makeWriter(){},now:()=>clock+=200000,wait:async()=>{}}),/lane_exit_failed/);
  }
});
test('Q1-03 unsuccessful initialization and unexpected unavailable are never WM successes',()=>{
  const r={ok:false,code:'index_unavailable',expected:false,validated:true,bounds:true,telemetry:'complete',initialization:{ok:false,expected:false,bounds:true,validated:true}};
  assert.equal(readWorks(r,true),false);
  assert.equal(readWorks({...r,expected:true},true),false);
  assert.equal(readWorks({...r,initialization:undefined,expected:true},true),true);
  assert.equal(readWorks({...r,initialization:undefined,expected:false},true),false);
});

async function filled(t,overrides={}) {
  const {fillRegistration}=await import('../registration.mjs');
  const root=mkdtempSync(join(tmpdir(),'qualification-q1-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const profile=join(root,'writer.json');writeFileSync(profile,JSON.stringify({captureMs:25000,reviewMs:5000,provenance:'synthetic test'}));
  const host={host:{id:'host',cpu:'cpu',ramBytes:1024,os:'test',owner:'test'},volume:{id:'volume',mount:root,filesystem:'ext4',production:false},volumeRoot:root,platformRole:'wsl2-ext4',counterConfiguration:{dependencyRoot:fileURLToPath(new URL('../counter-deps/',import.meta.url))},...overrides};
  return fillRegistration(host,profile);
}
test('Q1-05 host cannot replace the executable counter or frozen facts',async t=>{
  for(const extra of [{counterModule:new URL('../adapter.mjs',import.meta.url).href},{counterId:'o200k_base-v1'},{buildCeiling:1}])await assert.rejects(filled(t,extra),/host_field_not_fillable/);
  const input=await filled(t);input.counterModule=new URL('../adapter.mjs',import.meta.url).href;
  const {validateFilled}=await import('../registration.mjs');assert.throws(()=>validateFilled(input),/counter_module|frozen_input/);
  const {configure}=await import('../../../tools/testing/fixtures/context-product/engine.mjs');
  await assert.rejects(async()=>{const c=await configure({counterId:'o200k_base-v1',counterModule:input.counterModule,readSet:[{ownerId:'owner',scope:'personal',projectId:null}],deadlines:{openMs:5000,requestMs:5000}});await c.supervisor.close();},/counter_module_must_be_registered/);
});
test('Q1-05 dependency hashes cover every file loaded by the counter',async()=>{
  const {counterAssets}=await import('../counter.mjs');const {createRequire}=await import('node:module');
  const root=fileURLToPath(new URL('../counter-deps/',import.meta.url));const require=createRequire(join(root,'package.json'));
  require('tiktoken/lite');require('js-tiktoken/ranks/o200k_base');
  const assets=new Set(counterAssets({dependencyRoot:root}));
  for(const path of Object.keys(require.cache).filter(p=>p.startsWith(root)))assert.ok(assets.has(path),'unhashed loaded file: '+path);
  const {spawnSync}=await import('node:child_process');
  const program=`import fs from 'node:fs';import {createRequire} from 'node:module';const reads=[];const read=fs.readFileSync;fs.readFileSync=function(path,...args){reads.push(String(path));return read.call(this,path,...args);};const c=await import(process.argv[1]);const counter=await c.createCounter({dependencyRoot:process.argv[2]});counter.countTokens('東京');const require=createRequire(import.meta.url);console.log(JSON.stringify([...new Set([...reads,...Object.keys(require.cache)])]));`;
  const observed=spawnSync(process.execPath,['--input-type=module','-e',program,new URL('../counter.mjs',import.meta.url).href,root],{encoding:'utf8'});assert.equal(observed.status,0,observed.stderr);
  const loaded=JSON.parse(observed.stdout).map(p=>p.startsWith('file:')?fileURLToPath(p):p).filter(p=>p.startsWith(root));
  assert.ok(loaded.some(p=>p.endsWith('tiktoken_bg.wasm')));
  for(const path of loaded)assert.ok(assets.has(path),'unhashed actual read/load: '+path);

});
test('Q1-06 filled validation rejects unresolved substitutions anywhere',async t=>{
  const input=await filled(t),{validateFilled}=await import('../registration.mjs');
  for(const path of ['${volumeRoot}/snapshot.sqlite','${packageRoot}/labels.json']){const x=structuredClone(input);x.fixtures[0].path=path;assert.throws(()=>validateFilled(x),/unfilled_registration/);}
});
test('Q1-10 a destination created between admission and child generation stays untouched',async t=>{
  const root=mkdtempSync(join(tmpdir(),'qualification-race-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const target=join(root,'destination.sqlite');const {generateSnapshot}=await import('../generate.mjs');const {spawnSync}=await import('node:child_process');
  let before,created=false;
  const generate=await load('generate.mjs',{'node:child_process':{spawnSync(...args){if(!created){created=true;generateSnapshot({schema:18,count:1,cards:0},target);before=readFileSync(target);}return spawnSync(...args);}}},new URL('../',import.meta.url));
  assert.throws(()=>generate.generateSnapshot({schema:18,count:2,cards:0},target));
  assert.deepEqual(readFileSync(target),before);
});
test('Q1-11 deterministic builder regenerates the exact committed template',async()=>{
  const {buildTemplate}=await import('../build-template.mjs');
  assert.equal(JSON.stringify(buildTemplate(),null,2)+'\n',readFileSync(new URL('../registration.engine.template.json',import.meta.url),'utf8'));
});
test('Q1-12 tests and pinned dependencies are wired into the workspace CI job',async()=>{
  const root=new URL('../../../',import.meta.url),pkg=JSON.parse(readFileSync(new URL('package.json',root),'utf8'));
  assert.match(pkg.scripts['test:qualification-inputs']??'',/^QUAL_INPUT_MODE=reduced node .*evaluation\/context-read-qualification\/test\/\*\.test\.mjs$/);
  assert.match(pkg.scripts['test:qualification-inputs:full']??'',/^QUAL_INPUT_MODE=full node .*evaluation\/context-read-qualification\/test\/\*\.test\.mjs$/);
  const ci=readFileSync(new URL('.github/workflows/ci.yml',root),'utf8').split('  live-evidence-offline:')[1].split('\n  test:')[0];
  assert.match(ci,/npm ci --prefix evaluation\/context-read-qualification\/counter-deps --ignore-scripts/);
  assert.match(ci,/npm run test:qualification-inputs/);
  const {createCounter}=await import('../counter.mjs');assert.equal((await createCounter()).id,'o200k_base-v1');
});

test('Q1-04 a consistent defective preparation read cannot teach the oracle',async()=>{
  const ns={ownerId:'owner',scope:'personal',projectId:null};
  const items=['one','two'].map((content,n)=>({type:'memory',ref:{type:'memory',namespace:ns,memoryId:'m'+n,revision:1},content}));
  for(const corrupt of [x=>x.reverse(),x=>{x[0].content='wrong';return x;},x=>{x[0].ref.revision++;return x;},x=>{x[0].unexpected=true;return x;}]) {
    const wrong=corrupt(structuredClone(items));
    const snapshot=Buffer.from(JSON.stringify({fences:['12345678','abcdefgh']})).toString('base64url')+'.opaque';
    const mod=await load('adapter.mjs',{'../../tools/testing/fixtures/context-product/engine.mjs':{closedShape:(await import('../../../tools/testing/fixtures/context-product/engine.mjs')).closedShape,configure:async()=>({open:async()=>({fetchCandidateEvidence:async()=>({ok:true,value:{items:wrong,snapshot}}),close:async()=>{}}),supervisor:{close:async()=>{}}}),drain:async()=>[]}},new URL('../',import.meta.url));
    const config={method:'fetchCandidateEvidence',readSet:[ns],deadlines:{readMs:5000}},cell={refs:2,adapter:'full',language:'zh'},ledger={memory:items.map(i=>({id:i.ref.memoryId,revision:1,owner_id:'owner',scope:'personal',project_id:'',content:i.content})),cards:[],evidence:items};
    await assert.rejects(mod.prepare({cell,config,ledger}),/evidence_preparation_mismatch/);
  }
});

test('Q1-07 language-bearing corpus includes exact canonical item limits and large byte cases',async()=>{
  const {memoryText,cardText}=await import('../corpus.mjs');
  for(const [n,term] of ['海港','桜庭','cobaltledger'].entries()) {
    const memory=memoryText(16+n),card=cardText(4+n);
    assert.ok(memory.includes(term));assert.ok(card.title.includes(term));assert.ok(card.body.includes(term));
    assert.equal(memory.length,4000);assert.equal(card.title.length,200);assert.equal(card.body.length,20000);
    assert.ok(Buffer.byteLength(memory)>=4000);assert.ok(Buffer.byteLength(card.body)>=20000);
  }
});

test('Q1-08 SQLite child rejects orphan documents, statistics and empty terms',async t=>{
  const root=mkdtempSync(join(tmpdir(),'qualification-orphan-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const {generateSnapshot}=await import('../generate.mjs'),{storage}=await import('../../../tools/testing/measure-context-read-product.mjs'),{build}=await import('../../../tools/testing/fixtures/context-product/series.mjs'),{selectReadSet}=await import('../../../tools/testing/fixtures/context-product/engine.mjs'),{inventory}=await import('../corpus.mjs'),{fileChild}=await import('../../../tools/testing/fixtures/context-product/actors.mjs'),{spawnSync}=await import('node:child_process');
  const path=join(root,'tiny.sqlite');generateSnapshot({schema:18,count:2,cards:0},path);
  await build({path,...selectReadSet(inventory,'orphan'),types:['memory'],functionalOnly:true,sidecar:'DELETE',canonical:'DELETE',deadlines:{openMs:5000,requestMs:5000,readMs:5000},buildCeiling:1000,pump:{quantum:{maxItems:128,maxMs:5000}}});
  const verify=async path=>{if(!process.env.QUAL_Q1_BASE)return storage('verify-sidecar',{path});
    const source=spawnSync('git',['show',process.env.QUAL_Q1_BASE+':tools/testing/fixtures/context-product/storage-child.mjs'],{encoding:'utf8'});assert.equal(source.status,0);
    const code=source.stdout.replace(/from '(\.[^']+)'/g,(_,name)=>'from '+JSON.stringify(new URL(name,new URL('storage-child.mjs',harness)).href));
    const child=spawnSync(process.execPath,['--input-type=module','-e',code,'pad','verify-sidecar',JSON.stringify({path})],{encoding:'utf8'});if(child.status!==0)throw Error('verification_refused');return {exit:{code:0}};
  };
  const original=path+'.context-read-product-v1.1.sqlite';assert.equal((await verify(original)).exit.code,0);
  for(const kind of ['document','statistics','term']) {
    const target=join(root,kind+'.sqlite');fileChild('copy',original,target);
    const script=`import {DatabaseSync} from 'node:sqlite';const db=new DatabaseSync(process.argv[1]);try{db.exec('PRAGMA foreign_keys=OFF');const g=db.prepare('SELECT storage_id FROM generations LIMIT 1').get().storage_id;const d=db.prepare('SELECT doc FROM documents WHERE generation=? LIMIT 1').get(g).doc;const t=db.prepare('SELECT term_id FROM statistics WHERE generation=? AND term_id>0 LIMIT 1').get(g).term_id;db.prepare('INSERT INTO postings VALUES(?,?,?,?,?)').run(g,${kind==='document'?'999999':'d'},${kind==='term'?'0':'999999'},1,999999);}finally{db.close();}`;
    const changed=spawnSync(process.execPath,['--input-type=module','-e',script,target],{encoding:'utf8'});assert.equal(changed.status,0,changed.stderr);
    await assert.rejects(verify(target),undefined,kind);
  }
});
test('Q1-09 shared attempt exceedances are attributed to every own population',async t=>{
  const root=mkdtempSync(join(tmpdir(),'qualification-population-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const path=join(root,'unit-report.jsonl');
  writeFileSync(path,[{type:'record',cell:10,record:{method:'findCandidates',readExceededAdapterDefault:true,populationIdentities:[{cell:11,method:'findCandidates',intent:'current',type:'memory'},{cell:12,method:'findCandidates',intent:'current',type:'card'}]}},{type:'record',cell:10,record:{method:'contextRead',intent:'history',readExceededAdapterDefault:false,populationIdentities:[{cell:13,method:'contextRead',intent:'history'}]}}].map(JSON.stringify).join('\n')+'\n');
  const {summarize}=await import('../../../tools/testing/summarize-context-read-product.mjs');const result=await summarize(path,()=>{});
  assert.deepEqual(result.adapterReadCutoffs.map(r=>[r.cell,r.method,r.intent,r.reads,r.exceeded1000Ms]),[[11,'findCandidates','current',1,1],[12,'findCandidates','current',1,1],[13,'contextRead','history',1,0]]);
});

test('Q1-07 real fetch and assembly rotations select the frozen large Memory and Card cases',async t=>{
  const root=mkdtempSync(join(tmpdir(),'qualification-large-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const {generateSnapshot}=await import('../generate.mjs'),{storage,prepareInput}=await import('../../../tools/testing/measure-context-read-product.mjs'),{build}=await import('../../../tools/testing/fixtures/context-product/series.mjs'),{selectReadSet,attempt}=await import('../../../tools/testing/fixtures/context-product/engine.mjs'),{inventory}=await import('../corpus.mjs'),{methodProfile}=await import('../../../tools/testing/fixtures/context-product/v4-plan.mjs'),adapter=await import('../adapter.mjs');
  const path=join(root,'large.sqlite');generateSnapshot({schema:23,count:32,cards:7},path);
  const config={path,...selectReadSet(inventory,'large'),types:['memory','card'],canonical:'DELETE',sidecar:'DELETE',deadlines:{openMs:5000,requestMs:5000,readMs:5000},buildCeiling:1000,pump:{quantum:{maxItems:128,maxMs:5000}},counterModule:new URL('../counter.mjs',import.meta.url).href,counterId:'o200k_base-v1',ledger:(await storage('inspect',{path})).value};
  await build(config);
  for(const language of ['zh','ja','mixed'])for(const label of ['f1-full','f1-compact','f24-snapshot','a1500','a4000']) {
    const cell={id:1,scope:'launch',schema:23,count:32,intent:'current',language,...methodProfile(label)},c=await prepareInput({...config,cell,method:cell.method},adapter),r=await attempt(c,{oracle:adapter.validate});
    assert.equal(r.record.ok,true,label+':'+JSON.stringify(r.result));assert.equal(r.record.expected,true,label+':'+JSON.stringify({validated:r.record.validated,refs:r.result?.value?.diagnostics?.items?.map(i=>i.ref),expected:c.oracleData.order,metadata:r.result?.value?.metered?.items?.map(i=>i.metadata)}));assert.equal(r.record.bounds,true,label);
    assert.ok(r.record.bytes<=65536);
    const items=r.result.value.items??r.result.value.metered.items;
    if(label==='f1-full')assert.equal(items[0].content.length,4000);
    else if(label==='f1-compact')assert.equal(items[0].body.length,20000);
    else {assert.ok(items.some(i=>(i.content??i.body).length===4000),label);assert.ok(items.some(i=>[20000,20201].includes(i.body?.length)),label);}
    if(cell.method==='contextRead'){const wrong=structuredClone(r.result);wrong.value.metered.items[0].metadata={...wrong.value.metered.items[0].metadata,unregistered:true};assert.equal(adapter.validate(wrong,c),false);}
    if(cell.method==='fetchCandidateEvidence')for(const corrupt of [x=>x.reverse(),x=>{x[0].content!==undefined?x[0].content='wrong':x[0].body='wrong';return x;},x=>{x[0].ref.revision++;return x;},x=>{x[0].extra=true;return x;}]) {
      const wrong=structuredClone(r.result);wrong.value.items=corrupt(wrong.value.items);if(label!=='f1-full'&&label!=='f1-compact'||wrong.value.items[0].extra||wrong.value.items[0].content==='wrong'||wrong.value.items[0].body==='wrong'||wrong.value.items[0].ref.revision!==r.result.value.items[0].ref.revision)assert.equal(adapter.validate(wrong,c),false);
    }
  }
});

test('Q1-02 nonzero writer exit independently fails both session modes',async()=>{
  for(const rehearsal of [true,false]) {
    const mod=await load('v4-session-work.mjs',{'./controller.mjs':{startWriter(){},recordedWriter:async()=>({start(){},flush(){},child:{take:()=>[]},stop:async()=>({calls:[],pacing:[],writerEndAt:1e9,diagnostics:{coverage:'complete',records:[]},exit:{code:1}})})},'./v4-validation.mjs':{validateSessionRegistration:()=>({decision:'passed'}),validateSessionEvidence:()=>({decision:'passed'})}});
    let clock=0;await assert.rejects(mod.sessionWork([],{availability:[],targets:[],batches:[]},{config:{rehearsal,cell:{id:1,schema:18}},prepareInput:async()=>({}),sink:{record:async()=>{}},validateProbe:()=>true},{makeLane:()=>({pid:1,connected:true,send(){},wait:async()=>({}),exited:Promise.resolve({code:0,signal:null})}),makeWriter(){},now:()=>clock+=200000,wait:async()=>{}}),/writer_exit_failed/);
  }
});

test('Q1-09 probes resolve separate type/intent cells and A calls resolve their own cell',async()=>{
  const {sessionPopulations}=await import('../../../tools/testing/fixtures/context-product/v4-session-work.mjs');
  const cells=[{id:11,kind:'freshness',intent:'current',type:'memory'},{id:12,kind:'freshness',intent:'current',type:'card'},{id:13,kind:'availability',intent:'history'}];
  const targets=['memory','card'].map(type=>({batch:0,intent:'current',type}));
  assert.deepEqual(sessionPopulations(cells,{kind:'probe',batch:0,intent:'current'},targets).map(x=>x.cell),[11,12]);
  assert.deepEqual(sessionPopulations(cells,{kind:'availability',intent:'history',method:'contextRead'},targets),[{cell:13,method:'contextRead',intent:'history'}]);
});

test('Q1-07 large assembly inputs preserve the original tiny F/A language queries',async()=>{
  const {prepare}=await import('../adapter.mjs'),{queries,memoryText,cardText}=await import('../corpus.mjs');
  const namespace={ownerId:'owner',scope:'personal',projectId:null};
  const ledger={memory:Array.from({length:4},(_,i)=>({id:'m'+i,revision:1,owner_id:'owner',scope:'personal',project_id:'',content:memoryText(i)})),cards:[{id:'c0',revision:1,body_revision:1,owner_id:'owner',scope:'personal',project_id:'',state:'confirmed',...cardText(0)}]};
  for(const language of ['zh','ja','mixed']){
    const r=await prepare({cell:{count:4,schema:23,language,intent:'current'},config:{method:'contextRead',readSet:[namespace],deadlines:{readMs:5000}},ledger});
    assert.equal(r.input.query,queries.find(q=>q.id===language).query);
  }
});

test('CI snapshot modes are explicit and full never falls back to reduced',async()=>{
  const {snapshotPlan}=await import('./snapshot-checks.mjs');
  for(const value of [undefined,'','false','FULL','unknown'])assert.throws(()=>snapshotPlan(value),/qualification_input_mode/);
  const reduced=snapshotPlan('reduced'),full=snapshotPlan('full');
  assert.deepEqual(reduced.selected.map(s=>s.id),['m1112-v18','m1112-v23']);
  assert.equal(reduced.skipped.length,4);assert.equal(full.selected.length,6);assert.deepEqual(full.skipped,[]);
  assert.deepEqual(full.deterministicIds,reduced.selected.map(s=>s.id));
});
test('reduced CI retains metadata and label/ref checks for all four skipped layouts',async()=>{
  const {verifyFrozenCatalogs}=await import('./snapshot-checks.mjs');
  const manifest=JSON.parse(readFileSync(new URL('../manifest.json',import.meta.url),'utf8')),labels=JSON.parse(readFileSync(new URL('../labels.json',import.meta.url),'utf8'));
  verifyFrozenCatalogs(manifest,labels);
  const absent=structuredClone(manifest);absent.snapshots.pop();assert.throws(()=>verifyFrozenCatalogs(absent,labels));
  const badSeal=structuredClone(manifest);badSeal.snapshots.at(-1).contentHash='not-a-seal';assert.throws(()=>verifyFrozenCatalogs(badSeal,labels));
  const wrongRef=structuredClone(labels);wrongRef.fixtures.at(-1).queries[0].ranking[0].revision++;assert.throws(()=>verifyFrozenCatalogs(manifest,wrongRef));
  const wrongBody=structuredClone(labels);wrongBody.fixtures.at(-1).catalog[0].text='corrupted';assert.throws(()=>verifyFrozenCatalogs(manifest,wrongBody));
});

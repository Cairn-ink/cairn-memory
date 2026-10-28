// Round-2 review regressions. Synthetic failures never assert wall-clock gates.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { buildV4Plan } from '../../../tools/testing/fixtures/context-product/v4-plan.mjs';
import { createReportSink,appendSessionRecords } from '../../../tools/testing/fixtures/context-product/report.mjs';
import { readSegments,checkedSegments } from '../../../tools/testing/fixtures/context-product/v4-checkpoints.mjs';
const harness=new URL('../../../tools/testing/fixtures/context-product/',import.meta.url);
async function load(url,overrides={},context) {
  const dependency=async spec=>{
    const values=overrides[spec]??(spec.endsWith('.json')?{default:JSON.parse(readFileSync(new URL(spec,url),'utf8'))}:await import(spec.startsWith('.')?new URL(spec,url).href:spec));
    const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);},{context});await m.link(()=>{});await m.evaluate();return m;
  };
  const m=new vm.SourceTextModule(readFileSync(url,'utf8'),{context,identifier:url.href,initializeImportMeta:m=>m.url=url.href,importModuleDynamically:dependency});await m.link(dependency);await m.evaluate();return m.namespace;
}
const inventory=buildV4Plan('engine');
const template=JSON.parse(readFileSync(new URL('../registration.engine.template.json',import.meta.url),'utf8'));
const header={protocol:{version:'P2-product-v4'},registrationHash:'registered',host:{id:'host'},volume:{id:'volume'},node:process.version,inventory,segments:template.segments,cellCount:728};
for(const [series,record,kind] of [['pump',{tick:1,state:'failed',error:'index_unavailable'},'requests'],['lane-exit',{pid:123,exit:{code:1,signal:null}},'freshness']]) {
  test(`Q2-01 durable ${series} failure survives interruption and successful retries across the real 728-cell inventory`,async t=>{
    assert.equal(inventory.length,728);const w=createTestWorkspace(t),cell=inventory.find(c=>c.kind===kind),segment=header.segments.find(s=>s.cellKeys.includes(cell.key));
    const retries=[];
    for(const part of header.segments){const path=join(w.path,'retry-'+part.id+'.jsonl'),sink=await createReportSink(path,{...header,segmentId:part.id});for(const c of inventory.filter(c=>part.cellKeys.includes(c.key)))await sink.cell(c,{complete:true,decision:'passed'});await sink.finish('passed');retries.push(path);}
    const successful=await readSegments(retries);assert.equal(checkedSegments(header,successful).decision,'passed');
    for(const rehearsal of [false,true]){
      const path=join(w.path,'interrupted-'+rehearsal+'.jsonl'),h={...header,segmentId:segment.id,...(rehearsal?{mode:'rehearse',qualifying:false}:{})},sink=await createReportSink(path,h);
      if(rehearsal){const lease=await sink.delegate(),child=await appendSessionRecords({...lease,rehearsal});await child.record(cell.id,series,record);await child.close();await sink.reclaim(child.sequence);}else await sink.record(cell.id,series,record);
      await sink.interrupt();let [prior]=await readSegments([path+'.partial']);
      assert.equal(prior.knownFailure,true,'durable '+series+' rehearsal='+rehearsal);
      // Also reproduce the exact pre-marker record emitted by the reviewed code.
      const journal=path+'.records.jsonl',rows=readFileSync(journal,'utf8').trim().split('\n').map(JSON.parse);delete rows[1].failure;writeFileSync(journal,rows.map(JSON.stringify).join('\n')+'\n');
      [prior]=await readSegments([path+'.partial']);
      assert.equal(prior.knownFailure,true,'legacy '+series+' rehearsal='+rehearsal);assert.deepEqual(prior.cells,[]);
      const merged=checkedSegments(header,[prior,...successful]);assert.equal(merged.complete,true);assert.equal(merged.cells.length,728);assert.equal(merged.decision,'failed');
      if(rehearsal)assert.throws(()=>checkedSegments(h,[prior]),/rehearsal_cannot_qualify/);
    }
  });
}

test('Q2-02 shared Card-helper DTO corruption cannot teach the canonical oracle or fetch schema',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'cards.sqlite');
  const {generateSnapshot}=await import('../generate.mjs');generateSnapshot({schema:23,count:1,cards:5},path);
  // Only this disposable child loads SQLite. Load module source before opening
  // the connection; never read database bytes or share its handle with a child.
  const child=spawnSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',`
    import vm from 'node:vm';import {readFileSync} from 'node:fs';
    import {createPrivateCardStorage} from './core/private-card-storage.mjs';
    import {createPrivateEvidenceStorage} from './core/private-evidence-storage.mjs';
    const url=new URL('./evaluation/context-read-qualification/canonical-evidence.mjs',import.meta.url),source=readFileSync(url,'utf8');
    const defective=options=>{const storage=createPrivateCardStorage(options);return {...storage,cardDetailInside(...args){const dto=storage.cardDetailInside(...args);dto.support.unregistered=true;return dto;}};};
    const oracle=new vm.SourceTextModule(source);await oracle.link(async spec=>{const values=spec.endsWith('/private-card-storage.mjs')?{createPrivateCardStorage:defective}:await import(new URL(spec,url));const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v] of Object.entries(values))this.setExport(k,v);});await m.link(()=>{});await m.evaluate();return m;});await oracle.evaluate();
    // Include a retained-receipt Card as well as the seeded authored-note Cards.
    const {openMemoryCore}=await import('./core/index.mjs'),{cardHost}=await import('./core/testing/raw-source-fixtures.mjs'),{card}=await import('./core/testing/context-product-owner-fixture.mjs');
    const {DatabaseSync}=await import('node:sqlite');let db=new DatabaseSync(process.argv[1],{readOnly:true}),m;try{m=db.prepare('SELECT * FROM memories LIMIT 1').get();}finally{db.close();}
    const host=cardHost(),core=openMemoryCore({path:process.argv[1],privateCards:host.options});try{card({call:(method,input)=>host.call(core,method,input)},{ownerId:m.owner_id,scope:m.scope,projectId:m.scope==='personal'?null:m.project_id},'receipt card','retained source',m);}finally{core.close();}
    db=new DatabaseSync(process.argv[1],{readOnly:true});
    try{const stored=db.prepare('SELECT * FROM store_metadata WHERE singleton=1').get(),identity={storeId:stored.store_id,cursorSecret:stored.cursor_secret},cards=db.prepare('SELECT * FROM private_cards ORDER BY id').all(),memory=db.prepare('SELECT * FROM memories').all(),ns=r=>({ownerId:r.owner_id,scope:r.scope,projectId:r.scope==='personal'?null:r.project_id}),readSet=[...new Map([...memory,...cards].map(r=>[JSON.stringify(ns(r)),ns(r)])).values()];
      const ordinary=createPrivateCardStorage({db,identity,ready(){}}),good=createPrivateEvidenceStorage({db,identity,cardDetailInside:ordinary.cardDetailInside});
      const actual=cards.flatMap(c=>good.itemsInside(ns(c),[{type:'card',namespace:ns(c),cardId:c.id,revision:c.revision,bodyRevision:c.body_revision}],'current',readSet));
      const storage=defective({db,identity,ready(){}}),evidence=createPrivateEvidenceStorage({db,identity,cardDetailInside:storage.cardDetailInside});
      const wrong=cards.filter(c=>c.title.startsWith('Large zh ')).map(c=>evidence.itemsInside(ns(c),[{type:'card',namespace:ns(c),cardId:c.id,revision:c.revision,bodyRevision:c.body_revision}],'current',readSet)[0]);
      console.log(JSON.stringify({ledger:{memory,cards,evidence:oracle.namespace.canonicalEvidence(db)},wrong,readSet,actual}));
    }finally{db.close();}
  `,path],{encoding:'utf8',maxBuffer:8*1024*1024});
  assert.equal(child.status,0,child.stderr);const {ledger,wrong,readSet,actual}=JSON.parse(child.stdout);assert.equal(wrong.length,1);assert.equal(wrong[0].support.unregistered,true);
  const snapshot=Buffer.from(JSON.stringify({fences:['12345678']})).toString('base64url')+'.opaque';
  const result={ok:true,value:{items:wrong,snapshot}},realEngine=await import(new URL('engine.mjs',harness));
  const adapter=await load(new URL('../adapter.mjs',import.meta.url),{'../../tools/testing/fixtures/context-product/engine.mjs':{closedShape:realEngine.closedShape,configure:async()=>({open:async()=>({fetchCandidateEvidence:async()=>result,close:async()=>{}}),supervisor:{close:async()=>{}}}),drain:async()=>[]}});
  const cell={refs:1,adapter:'compact',language:'zh'},config={method:'fetchCandidateEvidence',readSet,deadlines:{readMs:5000}};
  await assert.rejects(adapter.prepare({cell,config,ledger}),/evidence_preparation_mismatch/);
  assert.deepEqual(ledger.evidence.filter(i=>i.type==='card'),actual);
  assert.ok(actual.some(i=>i.bindings[0].dependency==='memory-interpretation'));
  assert.ok(ledger.evidence.filter(i=>i.type==='card').every(i=>!Object.hasOwn(i.support,'unregistered')));
  result.value.items=ledger.evidence.filter(i=>i.type==='card'&&i.title.startsWith('Large zh '));
  const prepared=await adapter.prepare({cell,config,ledger}),c={...config,...prepared};assert.equal(adapter.validate(result,c),true);
  for(const mutate of [i=>i.support.unregistered=true,i=>i.bindings[0].unregistered=true,i=>i.bindings[0].source.unregistered=true,i=>i.triggerMemoryRefs.push({unregistered:true})]){const bad=structuredClone(result);mutate(bad.value.items[0]);assert.equal(adapter.validate(bad,c),false);}
});

test('Q2-03 failed initialization performs no measured read and summarizes as noRead',async t=>{
  const w=createTestWorkspace(t),{attempt}=await import(new URL('engine.mjs',harness));let calls=0;
  const config={method:'findCandidates',readSet:[{ownerId:'owner',scope:'personal',projectId:null}],deadlines:{openMs:5000,requestMs:5000},input:{deadlineMs:5000},readCutoffReport:{thresholdMs:1000}};
  const initial={ok:false,error:{code:'index_unavailable'}};
  const {record}=await attempt(config,{initialize:true,open:async()=>({findCandidates:async()=>{calls++;return initial;},close:async()=>{}}),validate:()=>({bounds:true,validated:true}),oracle:()=>true});
  assert.equal(calls,1);assert.equal(record.initialization.ok,false);assert.equal(record.expected,false);
  assert.equal(record.readStartedAt,null);assert.equal(record.readFinishedAt,null);assert.equal(record.readMs,0);assert.equal(record.readExceededAdapterDefault,null);
  const path=join(w.path,'no-read.jsonl');writeFileSync(path,JSON.stringify({type:'record',cell:1,series:'WM',record})+'\n');
  const {summarize}=await import('../../../tools/testing/summarize-context-read-product.mjs');const result=await summarize(path,()=>{});
  assert.deepEqual(result.adapterReadCutoffs,[{cell:1,method:'findCandidates',intent:null,reads:0,exceeded1000Ms:0,noRead:1,gate:false}]);
  const actual=await attempt(config,{initialize:true,open:async()=>({findCandidates:async()=>({ok:true,value:{}}),close:async()=>{}}),validate:()=>({bounds:true,validated:true}),oracle:()=>true});
  assert.equal(typeof actual.record.readStartedAt,'number');assert.equal(typeof actual.record.readFinishedAt,'number');assert.equal(actual.record.readExceededAdapterDefault,actual.record.readMs>1000);
});

test('Q2-01 every durable failure vocabulary survives both journal writers and legacy unmarked replay',async t=>{
  const w=createTestWorkspace(t),cell=inventory.find(c=>c.kind==='requests'),part=header.segments.find(s=>s.cellKeys.includes(cell.key));
  const failures=[['maintenance',{intent:'current',quantum:0,status:'reader_failed'}],['session-parent-attribution',{error:'parent_sampler_failed',coverage:'incomplete'}],['pump',{kind:'renew',status:{state:'failed',error:'reader_failed'}}],['pump',{kind:'renewal-exception',state:'failed',error:'renew_failed'}],['session-writer',{exit:{code:2,signal:null}}],['window-writer',{error:'writer_failed',exit:{code:0}}],['lane-exit',{exit:{code:null,signal:'SIGTERM'}}],['locker-exit',{exit:{code:3}}],['attribution',{exit:{code:4}}],['child-result',{processExit:{code:5}}],['failure',{code:'harness_failed'}],['lane-failure',{code:'lane_failed'}],['session-supervision',{code:'session_progress_timeout'}],['resumed-checkpoints',{retainedDecisions:['failed']}],['capability',{ready:false,blocked:null}],['session-validation',{decision:'failed'}],['WM-functional',{functionalPassed:false}],['pair',{decision:{observedFailure:true,decision:'invalid'}}]];
  for(const rehearsal of [false,true])for(const [i,[series,record]] of failures.entries()){
    const path=join(w.path,`${rehearsal}-${i}.jsonl`),sink=await createReportSink(path,{...header,segmentId:part.id});
    if(rehearsal){const lease=await sink.delegate(),child=await appendSessionRecords({...lease,rehearsal});await child.record(cell.id,series,record);await child.close();await sink.reclaim(child.sequence);}else await sink.record(cell.id,series,record);
    await sink.interrupt();const journal=path+'.records.jsonl',rows=readFileSync(journal,'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(rows[1].failure,true,series+' stamped before any rehearsal filtering');
    assert.equal((await readSegments([path+'.partial']))[0].knownFailure,true,series);
    // Old reports predate the marker. They must still classify the raw evidence.
    if(!rehearsal){delete rows[1].failure;writeFileSync(journal,rows.map(JSON.stringify).join('\n')+'\n');assert.equal((await readSegments([path+'.partial']))[0].knownFailure,true,series+' legacy');}
  }
  for(const [i,[series,record]] of [['maintenance',{intent:'current',quantum:0,status:'partial'}],['pump',{state:'stopped'}],['lane-exit',{exit:{code:0,signal:null,disconnected:true}}],['capability',{ready:false,blocked:['missing']}],['main',{ok:false,code:'index_unavailable',expected:true,validated:true,bounds:true}],['checkpoint',{decision:{decision:'inconclusive',observedFailure:false}}]].entries()){
    const path=join(w.path,'healthy-'+i+'.jsonl'),sink=await createReportSink(path,{...header,segmentId:part.id});await sink.record(cell.id,series,record);await sink.interrupt();assert.equal((await readSegments([path+'.partial']))[0].knownFailure,false,series+' is not a failure');
  }
});


test('Q2-01 renewal exceptions produce replayable pump failures in both real pump wrappers',async()=>{
  for(const file of ['series.mjs','v4-session-pump.mjs']){
    const timers=[],records=[],context=vm.createContext({process,setInterval:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearInterval(){}});
    let renews=0;const pump={getStatus:()=>({state:'stopped'}),completion:Promise.resolve({state:'stopped'}),close:async()=>{}};
    const c={options:{},token:{},supervisor:{drain:async()=>[],ackCleanup(){},close:async()=>{}}};
    const mod=await load(new URL(file,harness),{'./engine.mjs':{configure:async()=>c,attempt(){},drain:async()=>[]},'../../../../core/index.mjs':{renewContextMaintenancePump:()=>{if(renews++)throw Error('renewal_exception');return pump;}}},context);
    const config={protocol:'P2-product-v4',pump:{id:'pump',cronMs:60000},types:['memory']},write=async(series,record)=>records.push({series,record});
    const driver=file==='series.mjs'?await mod.startPump(config,write):await mod.prepareSessionPump(config),running=file==='series.mjs'?driver:driver.start();
    timers.find(t=>t.ms===60000).fn();await assert.rejects(running.stop(),/renewal_exception/);if(driver.report)await driver.report(write);
    assert.ok(records.some(r=>r.series==='pump'&&r.record.state==='failed'&&r.record.kind==='renewal-exception'&&r.record.error==='renewal_exception'),file);
  }
});

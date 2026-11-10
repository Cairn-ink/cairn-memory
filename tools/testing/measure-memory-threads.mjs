import assert from 'node:assert/strict';
import { cpSync,mkdtempSync,mkdirSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { memoryThreadFixture,measureThreadChain,threadNamespace as ns,unwrap } from '../../core/testing/memory-thread-fixture.mjs';
import { SAME_THREAD_THRESHOLD,sameThreadScore } from '../../core/memory-relations.mjs';
import { syntheticThreadPairs,threadClassificationCounts } from './memory-thread-synthetic.mjs';
import { measureContentRead } from '../../core/testing/content-safety-cost-meter.mjs';
import { host } from '../../core/testing/context-read-core-fixture.mjs';

const mode=process.argv[2]??'all';
if(mode==='all'||mode==='chains'){
 const chains=[];
 for(const tier of [1,2])for(const changes of [1,2,4,8]){
  const cleanup=[],f=memoryThreadFixture({after:work=>cleanup.push(work)},{tier});
  try{chains.push({tier,...await measureThreadChain(f,changes)});}finally{for(const work of cleanup)await work();}
 }
 console.log(JSON.stringify({kind:'chains',chains}));assert.ok(chains.every(row=>row.latest&&row.markedCurrent&&row.retracted&&row.dated));
}
if(mode==='all'||mode==='precision'){
 const pairs=syntheticThreadPairs();
 console.log(JSON.stringify({kind:'same-thread',threshold:SAME_THREAD_THRESHOLD,pairs:pairs.length,
  strata:threadClassificationCounts(pairs,sameThreadScore,SAME_THREAD_THRESHOLD),
  calibration:[.6,.8,1].map(threshold=>({threshold,strata:threadClassificationCounts(pairs,sameThreadScore,threshold)}))}));
}
if(mode==='all'||mode==='cost'){
 const scratch=mkdtempSync(join(tmpdir(),'memory-thread-cost-')),baseline=join(scratch,'baseline');mkdirSync(baseline);
 try{
  const root=fileURLToPath(new URL('../../',import.meta.url));
  const archive=spawnSync('git',['archive','35a29c14','--','core','plugins/cairn-memory/lib'],{cwd:root,maxBuffer:64*1024*1024,timeout:30000});assert.equal(archive.status,0,String(archive.stderr));
  const unpack=spawnSync('tar',['-xC',baseline],{input:archive.stdout,timeout:30000});assert.equal(unpack.status,0,String(unpack.stderr));
  const old=await import(pathToFileURL(join(baseline,'core/index.mjs'))),current=await import('../../core/index.mjs');
  const measurements=[];
  for(const scenario of ['zero-relations','thread']){
   const seed=join(scratch,'seed-'+scenario);mkdirSync(seed);let core=old.openMemoryCore({path:join(seed,'store.sqlite')});
   const ids=[];
   for(let i=0;i<12;i++)ids.push(unwrap(core.admit({namespace:ns,memory:{content:scenario==='thread'&&i<9?
     (i===0?'UniqueBreakfastAnchor My breakfast is value 0.':`My breakfast is value ${i}.`):`Independent breakfast observation ${i}.`,kind:'fact'},
     receipts:[{client:'synthetic',sessionId:'session',eventId:'message-'+i,role:'user',excerpt:'Synthetic source '+i}]})).memory.id);
   await core.close();
   for(let sample=0;sample<12;sample++){
    const pair=[];
    for(const [variant,engine]of [['before',old],['after',current]]){
     const folder=join(scratch,scenario+'-'+sample+'-'+variant);cpSync(seed,folder,{recursive:true});const path=join(folder,'store.sqlite');
     const trusted=host();trusted.state.allowed=[ns];
     core=engine.openMemoryCore({path,contextRead:{version:'context-read-v1',authority:trusted.authority,counter:{id:'synthetic-cost',countTokens:text=>Math.ceil(text.length/4)}}});
     if(scenario==='thread'&&variant==='after'){
      const db=new DatabaseSync(path);
      for(let i=0;i<9;i++){
       const memory=db.prepare('SELECT revision FROM memories WHERE id=?').get(ids[i]);
       const receipt=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(ids[i]).id;
       const date=new Date(Date.UTC(2025,0,i+1)).toISOString();
       db.prepare('INSERT INTO memory_relation_times VALUES(?,?,?,?)').run(ids[i],memory.revision,date,receipt);
       if(i){const previous=db.prepare('SELECT revision FROM memories WHERE id=?').get(ids[i-1]);db.prepare(`INSERT INTO memory_relations
        (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,receipt_id,event_time,created_at)
        VALUES(?,?,?,?,?,'same_thread',1,'rule',?,?,?)`).run('synthetic-edge-'+i,ids[i],memory.revision,ids[i-1],previous.revision,receipt,date,date);}
      }
      db.close();
     }
     const projection={readSet:[ns],types:['memory'],intent:'current'};
     for(let attempt=0;attempt<100;attempt++)if(unwrap(await trusted.call(core,'refreshContextIndex',{...projection,budget:{maxItems:1024,maxMs:5000}})).status==='complete')break;
     const input={...projection,query:scenario==='thread'?'UniqueBreakfastAnchor':'breakfast',semantic:false,budget:{maxItems:24,maxTokens:6000}};
     const start=performance.now(),row=await measureContentRead('contextRead',scenario,()=>trusted.call(core,'contextRead',input)),ms=performance.now()-start;
     const pack=unwrap(row.result);pair.push({variant,scenario,sample,ms,statements:row.statements,begin:row.begin,items:pack.metered.items.length,wire:JSON.stringify({metered:pack.metered,snapshot:pack.snapshot})});
     await core.close();
    }
    if(scenario==='zero-relations'){
     assert.equal(pair[0].wire,pair[1].wire,'empty graph wire bytes');assert.equal(pair[0].statements,pair[1].statements,'empty graph statement count');assert.equal(pair[0].begin,pair[1].begin,'empty graph transaction count');
    }
    measurements.push(...pair.map(({wire,...row})=>row));
   }
  }
  const summary=[];
  for(const scenario of ['zero-relations','thread'])for(const variant of ['before','after']){
   const rows=measurements.filter(row=>row.scenario===scenario&&row.variant===variant),times=rows.map(row=>row.ms).sort((a,b)=>a-b);
   summary.push({scenario,variant,samples:rows.length,p95Ms:times[Math.ceil(times.length*.95)-1],statements:[...new Set(rows.map(row=>row.statements))],begin:[...new Set(rows.map(row=>row.begin))],items:[...new Set(rows.map(row=>row.items))]});
  }
  console.log(JSON.stringify({kind:'cost',timing:'shared-slot-wall-clock',summary,measurements}));
 }finally{rmSync(scratch,{recursive:true,force:true});}
}

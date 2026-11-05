import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fingerprint } from '../validation.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { captureSnapshot } from '../capture-input.mjs';
import { sourceWindowCatalog } from '../source-windows.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
const input={namespace:ns,client:'synthetic',sessionId:'review-duration',eventId:'review-duration',
  messages:Array.from({length:24},(_,i)=>({id:'source-'+i,role:'user',content:'x'.repeat(801)}))};
const catalog=sourceWindowCatalog(captureSnapshot(input,undefined,'indexed-windows-v1'));
const sources=catalog.messages.map(message=>({client:input.client,sessionId:input.sessionId,eventId:message.id,role:message.role,excerpt:message.content}));
assert.equal(sources.length,48);
const episodeSources=Array.from({length:1552},(_,i)=>({client:input.client,sessionId:input.sessionId,eventId:'episode-source-'+i,role:'user',excerpt:'e'}));
const childCode=String.raw`
import {DatabaseSync} from 'node:sqlite';
import {renameSync,writeFileSync} from 'node:fs';
const [path,marker,id]=process.argv.slice(1),db=new DatabaseSync(path);
db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; BEGIN IMMEDIATE');
db.prepare("UPDATE memories SET updated_at='2026-11-05T00:00:00.000Z' WHERE id=?").run(id);
process.send('ready');
process.on('message',cmd=>{if(cmd==='go'){
 writeFileSync(marker+'.start.tmp','{}');renameSync(marker+'.start.tmp',marker+'.start');const start=performance.now();let result;
 try{db.exec('COMMIT');result={ok:true};}catch(e){result={ok:false,code:e.code,errcode:e.errcode};if(db.isTransaction)db.exec('ROLLBACK');}
 const commitMs=performance.now()-start;
 const persisted=db.prepare('SELECT updated_at FROM memories WHERE id=?').get(id)?.updated_at==='2026-11-05T00:00:00.000Z';
 writeFileSync(marker+'.done.tmp',JSON.stringify({result,commitMs,persisted}));renameSync(marker+'.done.tmp',marker+'.done');process.send('done');
 }else if(cmd==='close'){if(db.isTransaction)db.exec('ROLLBACK');db.close();process.disconnect();}});
`;
const pause=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms);
function until(path){const end=Date.now()+15000;while(!existsSync(path)){assert.ok(Date.now()<end,'rendezvous deadline '+path);pause(1);}return JSON.parse(readFileSync(path,'utf8'));}
async function writer(f,id){
 const marker=join(f.workspace.path,'writer-'+(++f.sequence)),messages=[];
 const child=spawn(process.execPath,['--input-type=module','-e',childCode,f.path,marker,id],{stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr.on('data',chunk=>stderr+=chunk);child.on('message',value=>messages.push(value));
 const ended=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));
 const wait=async value=>{const end=Date.now()+20000;while(!messages.includes(value)){assert.equal(child.exitCode,null,stderr);assert.ok(Date.now()<end,'child deadline '+stderr);await new Promise(resolve=>setTimeout(resolve,2));}};
 await wait('ready');
 return {marker,go:()=>child.send('go'),wait,async close(){child.send('close');assert.deepEqual(await ended,{code:0,signal:null},stderr);}};
}
async function fixture(t,layout,journal){
 const base=({34:18,38:23,48:33,51:18,52:23,53:33})[layout];
 const f=(layout>=51?eventTimeSafetyFixture:safetyFixture)(t,base);await f.migrate();const core=openMemoryCore({path:f.path}),seed=f.connect();
 assert.equal(seed.prepare('PRAGMA user_version').get().user_version,layout);
 assert.equal(seed.prepare('PRAGMA journal_mode='+journal).get().journal_mode,journal.toLowerCase());
 const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic reviewer duration seed',kind:'fact'},receipts:[sources[0]]})).memory;
 let db;const runtime=createMemoryRuntime({path:f.path},{attachRaw(value){db=value;}});
 t.after(()=>{runtime.close();core.close();seed.close();});
 return {...f,layout,core,seed,db,runtime,memory,sequence:0,population:1};
}
function seedTo(f,count){
 const im=f.seed.prepare(`INSERT INTO memories(id,owner_id,scope,project_id,fingerprint,content,kind,origin,confidence,revision,deleted,created_at,updated_at,filing_status,currentness)
 SELECT ?,owner_id,scope,project_id,?,?,kind,origin,confidence,revision,deleted,created_at,updated_at,filing_status,currentness FROM memories WHERE id=?`);
 const ir=f.seed.prepare(`INSERT INTO receipts(id,memory_id,receipt_key,client,session_id,event_id,role,excerpt,created_at) VALUES(?,?,?,?,?,?,?,?,?)`);
 const source=sources[0],hash=createHash('sha256').update(JSON.stringify(source)).digest('hex');
 f.seed.exec('BEGIN IMMEDIATE');
 try{for(let i=f.population;i<count;i++){const id='review-fanout-'+i,content='Synthetic distinct reviewer fact '+i;
 im.run(id,fingerprint(content),content,f.memory.id);ir.run('review-receipt-'+i,id,i===f.badReceiptIndex?'malformed-key':hash,source.client,source.sessionId,source.eventId,source.role,source.excerpt,'2026-01-01T00:00:00.000Z');}
 f.seed.exec('COMMIT');f.population=count;}catch(e){f.seed.exec('ROLLBACK');throw e;}
}
async function measure(f,journal,method,values,phase,withWriter=true){
 // A unique timestamp per writer permits an independent persisted/rollback check.
 f.seed.prepare("UPDATE memories SET updated_at='2026-01-01T00:00:00.000Z' WHERE id=?").run(f.memory.id);
 const b=withWriter?await writer(f,f.memory.id):null;
 const priorExec=Object.getOwnPropertyDescriptor(f.db,'exec'),priorPrepare=Object.getOwnPropertyDescriptor(f.db,'prepare');
 const nativeExec=f.db.exec.bind(f.db),nativePrepare=f.db.prepare.bind(f.db);
 let begin,readMs=0,triggered=false,rendezvousMs=0,firstReadRows=0;const intervals=[];let readStatements=0;const statementCounts=[];
 f.db.exec=sql=>{const result=nativeExec(sql);if(sql==='BEGIN'){begin=performance.now();readStatements=1;}else if(begin!==undefined)readStatements++;if((sql==='COMMIT'||sql==='ROLLBACK') && begin!==undefined){const ms=performance.now()-begin;intervals.push(ms);statementCounts.push(readStatements);readMs=Math.max(readMs,ms);begin=undefined;}return result;};
 f.db.prepare=sql=>{
  const st=nativePrepare(sql),sourceInput=sql.includes('SELECT r.*,m.revision AS memory_revision')||sql.includes('FROM memories INDEXED BY namespace_memories');
  for(const method of ['get','all','iterate','run']){
   const native=st[method].bind(st);st[method]=(...args)=>{
    if(begin!==undefined)readStatements++;
    const result=native(...args);
    if(begin!==undefined&&sourceInput&&method==='all'&&!firstReadRows)firstReadRows=result.length;
    // Start COMMIT while the first canonical read is retained, including fact
    // acquisition. A deadline may release SHARED before source enumeration.
    if(b&&!triggered&&begin!==undefined&&(sql.includes('FROM owner_suppression_epochs')||sourceInput)){
     triggered=true;const start=performance.now();b.go();until(b.marker+'.start');rendezvousMs=performance.now()-start;
    }
    return result;
   };
  }
  return st;
 };
 const start=performance.now();let result,failure;
 try{result=f.runtime[method](ns,values);}catch(error){failure=error;}finally{
  if(priorExec)Object.defineProperty(f.db,'exec',priorExec);else delete f.db.exec;
  if(priorPrepare)Object.defineProperty(f.db,'prepare',priorPrepare);else delete f.db.prepare;
 }
 const wallMs=performance.now()-start;
 let outcome;
 if(b){try{if(triggered){await b.wait('done');outcome=until(b.marker+'.done');}}finally{await b.close();}}
 if(failure)throw failure;
 if(b)assert.equal(triggered,true);
 assert.deepEqual(result,method==='filterCaptureSources'?values.map((_,i)=>i):undefined);
 assert.equal(f.db.isTransaction,false);assert.equal(f.db.prepare('PRAGMA query_only').get().query_only,0);
 const row={node:process.version,journal,layout:f.layout,method,phase,sources:values.length,matches:f.population,facts:f.facts??0,readMs,firstReadRows,intervals,statementCounts,wallMs,rendezvousMs,...outcome};
 console.log('SOURCE_SNAPSHOT_DURATION '+JSON.stringify(row));return row;
}

// Fail-before: natural receipt fanout exceeds the shared snapshot budget. The
// Raw-capable base holds SHARED beyond the writer's 5s busy timeout; the
// other layouts also fail the explicit indexed-input enumeration bound.
for(const layout of [34,38,48,51,52,53])for(const method of ['filterCaptureSources','assertCaptureSources'])
test(`bounded source snapshot releases RESERVED DELETE writer v${layout} ${method}`,async t=>{
 const f=await fixture(t,layout,'DELETE');seedTo(f,40001);
 const row=await measure(f,'DELETE',method,[sources[0]],'overflow-writer-fallback');
 assert.equal(row.result.ok,true,'an earlier RESERVED writer must COMMIT: '+JSON.stringify(row));
 assert.equal(row.persisted,true);assert.ok(row.commitMs<5000);
 assert.ok(row.firstReadRows<=129,'fail-before: source inputs are capped before matching');
 assert.ok(row.readMs<1000,'bounded SHARED duration including acquisition/fences');
 assert.ok(row.statementCounts.every(n=>n<=524),'512 lineage statements plus bounded acquisition/fences');
});
// Fail-before statement-bound regression and maximum-input measurement: 128 retained receipt rows, 48
// attainable catalog windows, the 1552 conservative Episode-source maximum,
// and the maximum complete scoped fact set (4096).
for(const layout of [34,38,48,51,52,53])
test(`bounded source snapshot maximum input v${layout}`,async t=>{
 const f=await fixture(t,layout,'DELETE');seedTo(f,128);
 transaction(f.seed,()=>{for(let i=0;i<4096;i++)writeContentSuppressionInside(f.seed,{namespace:ns,kind:'memory',
   key:'unrelated-maximum-'+i,reason:'purge',actionId:'maximum-fact-'+i});});f.facts=4096;
 for(const values of [sources,episodeSources]) {
  const row=await measure(f,'DELETE','assertCaptureSources',values,'maximum-input');
  assert.equal(row.result.ok,true);assert.equal(row.persisted,true);assert.ok(row.readMs<1000);
  assert.ok(row.statementCounts.every(n=>n<=524),'fail-before: maximum input cannot hold an unbounded read snapshot');
 }
 const row=await measureContentRead('assertCaptureSources','maximum-snapshot',()=>f.runtime.assertCaptureSources(ns,sources));
 console.log('SOURCE_SNAPSHOT_COST '+JSON.stringify({layout,sources:sources.length,statements:row.statements,begin:row.begin,sql:row.sql}));
});

// Fail-before: expire during scoped fact acquisition, before lineage starts.
// The deadline belongs to the entire read, not just its validator callback.
for(const layout of [34,38,48,51,52,53])test(`source snapshot deadline includes scoped facts v${layout}`,async t=>{
 const f=await fixture(t,layout,'DELETE'),exec=f.db.exec.bind(f.db),prepare=f.db.prepare.bind(f.db);
 const clock=performance.now.bind(performance);let mode,expired=false,readInputs=0,writerInputs=0;
 const timeHook=t.mock.method(performance,'now',()=>expired?Number.MAX_SAFE_INTEGER:clock());
 const execHook=t.mock.method(f.db,'exec',sql=>{
  const result=exec(sql);if(sql==='BEGIN')mode='read';else if(sql==='BEGIN IMMEDIATE')mode='writer';
  else if(sql==='COMMIT'||sql==='ROLLBACK')mode=undefined;return result;
 });
 const prepareHook=t.mock.method(f.db,'prepare',sql=>{
  const st=prepare(sql),get=st.get.bind(st),all=st.all.bind(st);
  st.get=(...args)=>{const result=get(...args);if(mode==='read'&&sql.includes('FROM owner_suppression_epochs'))expired=true;return result;};
  if(sql.includes('SELECT r.*,m.revision AS memory_revision')||sql.includes('FROM memories INDEXED BY namespace_memories'))
   st.all=(...args)=>{if(mode==='read')readInputs++;else if(mode==='writer')writerInputs++;return all(...args);};
  return st;
 });
 try{
  f.runtime.assertCaptureSources(ns,[sources[0]]);
  assert.equal(expired,true,'fact acquisition was reached in the read');
  assert.equal(readInputs,0,'fail-before: an expired snapshot cannot begin source enumeration');
  assert.ok(writerInputs>0,'complete conservative validation runs after releasing SHARED');
  assert.equal(f.db.isTransaction,false);
 }finally{prepareHook.mock.restore();execHook.mock.restore();timeHook.mock.restore();}
});

// Controls: input overflow is not proof overflow. Complete paging must still
// find a suppressed or malformed parent beyond the first indexed input page.
for(const kind of ['suppression','receipt commitment'])test(`control: source input overflow retains late ${kind}`,async t=>{
 const f=await fixture(t,48,'WAL');if(kind==='receipt commitment')f.badReceiptIndex=256;seedTo(f,257);
 if(kind==='suppression')transaction(f.seed,()=>writeContentSuppressionInside(f.seed,{namespace:ns,kind:'memory',
   key:'review-fanout-256',reason:'purge',actionId:'late-parent'}));

 assert.deepEqual(f.runtime.filterCaptureSources(ns,[sources[0]]),[]);
 assert.throws(()=>f.runtime.assertCaptureSources(ns,[sources[0]]),{code:'source_excluded'});
 assert.equal(f.db.isTransaction,false);
});

// Synthetic, offline body-only recall. Acquire a heavy slot for each cell.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../core/contract.mjs';
import { QUERY_CANDIDATES, QUERY_SCAN_BUDGET_MS } from '../core/query-candidates.mjs';
import { layoutFixture, seed, ns, namespace, model, marker, key, ok } from '../core/testing/recall-recency-fixture.mjs';

const script=fileURLToPath(import.meta.url);
const monotonic=()=>Number(process.hrtime.bigint())/1e6;
const p50=values=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)]??null;
const max=values=>values.length?Math.max(...values):null;
const overlaps=(a,b)=>a.start<b.end&&a.end>b.start;

async function writerLoop(path, pauseMs) {
  const db=new DatabaseSync(path),waits=[];
  db.exec('PRAGMA busy_timeout=5000');
  let stopped=false;
  process.on('message',message=>{if(message==='stop')stopped=true;});
  process.on('disconnect',()=>{stopped=true;});
  const watchdog=setTimeout(()=>{stopped=true;process.exitCode=1;},50000);
  try {
    process.send('ready');
    while(!stopped) {
      const start=monotonic();
      db.exec('BEGIN IMMEDIATE');
      db.prepare("UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id='synthetic-writer'").run();
      db.exec('COMMIT');
      const end=monotonic(); waits.push({start,end,ms:end-start});
      await new Promise(resolve=>pauseMs?setTimeout(resolve,pauseMs):setImmediate(resolve));
    }
    await new Promise((resolve,reject)=>process.send({waits},error=>error?reject(error):resolve()));
  } finally {clearTimeout(watchdog);db.close();process.disconnect();}
}

async function startWriter(path, pauseMs) {
  const child=spawn(process.execPath,[script,'--writer-child',path,String(pauseMs)],{stdio:['ignore','ignore','pipe','ipc']});
  let stderr=''; child.stderr.on('data',chunk=>{stderr+=chunk;});
  const ready=once(child,'message'),exit=once(child,'exit'),closed=once(child,'close');
  const [message]=await Promise.race([ready,closed.then(([code])=>{throw Error('writer exited before ready: '+code+' '+stderr);})]);
  assert.equal(message,'ready');
  return async()=>{
    const data=once(child,'message'); child.send('stop');
    const [{waits}]=await Promise.race([data,closed.then(([code])=>{throw Error('writer exited without measurements: '+code+' '+stderr);})]);
    const [code,signal]=await exit;
    assert.equal(signal,null);assert.equal(code,0,stderr);
    return waits;
  };
}

async function measure({count,layout,writer,samples,writerPauseMs}) {
  const f=await layoutFixture(null,layout);
  let stopWriter;
  try {
    seed(f.db,count,ns);
    f.db.prepare('INSERT INTO namespace_epochs(owner_id,scope,project_id,epoch) VALUES (?,?,?,1)')
      .run('synthetic-writer','personal','');
    f.core.close(); f.runtime.close();
    let scanStart,scanEnd,candidateEnd,holdStart,boundary,scanExhausted,holds,visited;
    const exec=DatabaseSync.prototype.exec,prepare=DatabaseSync.prototype.prepare,clear=Map.prototype.clear;
    DatabaseSync.prototype.prepare=function(sql) {
      if(scanStart===undefined&&sql.startsWith('SELECT id, revision, updated_at FROM memories'))scanStart=monotonic();
      const statement=prepare.call(this,sql);
      if(sql.startsWith('SELECT id, revision, content')) {
        const get=statement.get.bind(statement);
        statement.get=(...args)=>{const row=get(...args);if(candidateEnd===undefined&&row)visited++;return row;};
      }
      return statement;
    };
    Map.prototype.clear=function() {
      if(this.size>0&&[...this.keys()].every(sql=>typeof sql==='string'&&
          (sql.startsWith('SELECT id FROM index_read_memories WHERE')||sql.startsWith('SELECT r.* FROM index_read_memory_refs r')))) {
        candidateEnd=monotonic();
      }
      return clear.call(this);
    };
    DatabaseSync.prototype.exec=function(sql) {
      if(scanStart!==undefined&&candidateEnd===undefined&&sql==='BEGIN')holdStart=monotonic();
      const value=exec.call(this,sql);
      if(scanStart!==undefined&&candidateEnd===undefined&&(sql==='COMMIT'||sql==='ROLLBACK')&&holdStart!==undefined) {
        const end=monotonic();holds.push({start:holdStart,end,ms:end-holdStart,kind:holds.length?'tail':'floor'});
        holdStart=undefined;
      }
      return value;
    };
    const port=model();
    port.countTokens=text=>{
      if(scanStart!==undefined&&scanEnd===undefined&&text) {
        const frame=JSON.parse(text);
        if(frame.value?.nextCursor&&frame.value?.items) {
          scanEnd=monotonic();
          boundary=JSON.parse(Buffer.from(frame.value.nextCursor.split('.')[0],'base64url')).a.scanBoundary;
          scanExhausted=boundary.stop==='end'&&boundary.rows<=QUERY_CANDIDATES.top;
        }
      }
      return 1;
    };
    const core=openMemoryCore({path:f.path,model:port}),runs=[];
    try {
      // Open/attestation finishes before contention begins. Only candidate
      // transactions are timed; writer overlap uses actual write-call intervals.
      scanStart=undefined;
      if(writer)stopWriter=await startWriter(f.path,writerPauseMs);
      for(let index=0;index<samples;index++) {
        scanStart=undefined;scanEnd=undefined;candidateEnd=undefined;holdStart=undefined;boundary=undefined;holds=[];visited=0;
        const start=monotonic();
        const response=await core.recall({readSet:[namespace],query:marker(count)});
        const end=monotonic();
        const error=response.ok?undefined:response.error;
        if(!error) {
          assert.ok(boundary,'signed map cursor carries scan measurements');
          assert.ok(ok(response).memories.some(row=>row.memory.id===key(count)),'newest note returned');
        }
        runs.push({start,end,holds,synthetic:true,node:process.version,count,layout,writer,writerPauseMs,
          temperature:index?'warm':'cold',rowsScanned:visited,boundaryRows:boundary?.rows??null,
          scanExhausted:boundary?scanExhausted:null,stop:boundary?.stop??null,error:error??null,
          scanMs:candidateEnd===undefined?null:candidateEnd-scanStart,
          mapReadyMs:scanEnd===undefined?null:scanEnd-scanStart,totalRecallMs:end-start,
          longestFloorHoldMs:max(holds.filter(h=>h.kind==='floor').map(h=>h.ms))??0,
          longestTailPageHoldMs:max(holds.filter(h=>h.kind==='tail').map(h=>h.ms))??0});
        if(error||writer&&end-start>runs.at(-1).longestFloorHoldMs+QUERY_SCAN_BUDGET_MS+runs.at(-1).longestTailPageHoldMs)break;
        await new Promise(resolve=>setImmediate(resolve));
      }
      const finish=stopWriter;stopWriter=undefined;
      const waits=finish?await finish():[];
      for(const run of runs) {
        const relevant=waits.filter(wait=>overlaps(wait,run));
        const {holds,start,end,...row}=run;
        console.log(JSON.stringify({...row,writerWaitP50Ms:p50(relevant.map(w=>w.ms)),writerWaitMaxMs:max(relevant.map(w=>w.ms))}));
      }
      const relevant=waits.filter(wait=>runs.some(run=>overlaps(wait,run)));
      const floor=wait=>runs.some(run=>run.holds.some(hold=>hold.kind==='floor'&&overlaps(wait,hold)));
      const tailWaits=relevant.filter(wait=>!floor(wait)&&runs.some(run=>run.holds.some(hold=>hold.kind==='tail'&&overlaps(wait,hold))));
      const longestFloorHoldMs=max(runs.map(r=>r.longestFloorHoldMs));
      const longestTailPageHoldMs=max(runs.map(r=>r.longestTailPageHoldMs));
      const recallMaxMs=max(runs.map(r=>r.totalRecallMs));
      const recallWithinBound=runs.every(run=>!run.error&&
        run.totalRecallMs<=run.longestFloorHoldMs+QUERY_SCAN_BUDGET_MS+run.longestTailPageHoldMs);
      const writerWithinBound=!tailWaits.length||max(tailWaits.map(w=>w.ms))<=longestTailPageHoldMs+30;
      console.log(JSON.stringify({summary:true,count,layout,writer,writerPauseMs,requestedSamples:samples,samples:runs.length,recallWithinBound,writerWithinBound,
        rowsScanned:runs.map(r=>r.rowsScanned),scanExhausted:runs.map(r=>r.scanExhausted),
        scanP50Ms:p50(runs.map(r=>r.scanMs).filter(ms=>ms!==null)),scanMaxMs:max(runs.map(r=>r.scanMs).filter(ms=>ms!==null)),
        recallP50Ms:p50(runs.map(r=>r.totalRecallMs)),recallMaxMs,
        longestFloorHoldMs,longestTailPageHoldMs,writerCalls:relevant.length,
        writerWaitP50Ms:p50(relevant.map(w=>w.ms)),writerWaitMaxMs:max(relevant.map(w=>w.ms)),
        tailOnlyWriterCalls:tailWaits.length,tailOnlyWriterWaitP50Ms:p50(tailWaits.map(w=>w.ms)),
        tailOnlyWriterWaitMaxMs:max(tailWaits.map(w=>w.ms)),scanBudgetMs:QUERY_SCAN_BUDGET_MS,
        coldDefinition:'first recall on a reopened core; OS caches are not cleared',
        scanTiming:'physical-statement preparation through discovery-cache cleanup; mapReadyMs separately includes delivery fences',
        writerTiming:'BEGIN IMMEDIATE through COMMIT; actual call intervals overlapping recalls; floor overlaps separated'}));
      // Preserve measurements even when a resource assertion or recall fails.
      assert.ok(runs.every(run=>!run.error),'recall failed; see emitted sample error');
      if(writer)assert.ok(recallWithinBound,'recall exceeds floor + wall-clock budget + one page');
      if(writer)assert.ok(writerWithinBound,'writer wait outside floor exceeds one tail page plus scheduler allowance');
    } finally {core.close();DatabaseSync.prototype.exec=exec;DatabaseSync.prototype.prepare=prepare;Map.prototype.clear=clear;}
  } finally {
    if(stopWriter)await stopWriter();
    await f.workspace.cleanup();
  }
}

if(process.argv[2]==='--writer-child')await writerLoop(process.argv[3],Number(process.argv[4]));
else {
  const args=process.argv.slice(2),option=name=>{const at=args.indexOf(name);return at<0?undefined:args[at+1];};
  const rawLayout=option('--layout')??'plain',layout=rawLayout==='plain'?'plain':Number(rawLayout);
  const count=Number(args.at(-1)),samples=Number(option('--samples')??12),writer=args.includes('--writer');
  const writerPauseMs=Number(option('--writer-pause-ms')??0);
  assert.ok(['plain',53].includes(layout),'--layout must be plain or 53');
  assert.ok(Number.isSafeInteger(count)&&count>0&&count<=1000000,'supply a positive namespace size last');
  assert.ok(Number.isSafeInteger(samples)&&samples>=2&&samples<=100,'--samples must be 2..100');
  assert.ok(Number.isSafeInteger(writerPauseMs)&&writerPauseMs>=0&&writerPauseMs<=1000,'--writer-pause-ms must be 0..1000');
  if(args.includes('--child'))await measure({count,layout,writer,samples,writerPauseMs});
  else {
    const result=spawnSync(process.execPath,[script,'--child',...args],{encoding:'utf8',timeout:60000,maxBuffer:1048576});
    process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
    if(result.error)console.error(result.error.code);
    process.exitCode=result.status??1;
  }
}

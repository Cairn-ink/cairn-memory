import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {isStorageBusy} from '../../core/database.mjs';

// Measurement only. Expose SQLite lock waits by replacing its opaque timeout
// with bounded synchronous retries. The successful COMMIT includes fsync.
// Rollback journals have no WAL checkpoint, including inside COMMIT.
export function observeCaptureWriter(){
  const exec=DatabaseSync.prototype.exec,configured=new Map(),active=new Map();
  let rows=[];
  DatabaseSync.prototype.exec=function(sql){
    if(!['BEGIN IMMEDIATE','COMMIT','ROLLBACK'].includes(sql))return exec.call(this,sql);
    if(sql==='BEGIN IMMEDIATE'&&!configured.has(this)){
      const mode=this.prepare('PRAGMA journal_mode').get().journal_mode;
      if(mode!=='delete')throw Error('writer_attribution_requires_rollback_journal');
      const timeout=this.prepare('PRAGMA busy_timeout').get().timeout;
      configured.set(this,timeout);exec.call(this,'PRAGMA busy_timeout=0');
    }
    const started=process.hrtime.bigint(),until=performance.now()+(configured.get(this)??0);
    let waitingMs=0;
    while(true){
      const callStart=process.hrtime.bigint();
      try{
        const value=exec.call(this,sql),ended=process.hrtime.bigint();
        if(sql==='BEGIN IMMEDIATE')active.set(this,{start:String(started),beginEnd:String(ended),
          lockWaitMs:Number(ended-started)/1e6,commitLockWaitMs:0,commitAndFsyncMs:0,checkpointMs:0,journal:'delete'});
        else if(sql==='COMMIT'&&active.has(this)){
          rows.push({...active.get(this),commitStart:String(started),end:String(ended),
            lockWaitMs:active.get(this).lockWaitMs+waitingMs,commitLockWaitMs:waitingMs,
            commitAndFsyncMs:Number(ended-callStart)/1e6});active.delete(this);
        }else if(sql==='ROLLBACK')active.delete(this);
        return value;
      }catch(error){
        if(!isStorageBusy(error)||performance.now()>=until)throw error;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.min(1,Math.max(0,until-performance.now())));
        waitingMs+=Number(process.hrtime.bigint()-callStart)/1e6;
      }
    }
  };
  return {take(){const value=rows;rows=[];return value;},close(){
    DatabaseSync.prototype.exec=exec;
    for(const [db,timeout] of configured)if(db.isOpen)exec.call(db,'PRAGMA busy_timeout='+timeout);
  }};
}

export function sharedOverlapMs(start,end,intervals){
  const left=BigInt(start),right=BigInt(end),pieces=intervals.map(([a,b])=>[a>left?a:left,b<right?b:right])
    .filter(([a,b])=>a<b).sort(([a],[b])=>a<b?-1:a>b?1:0);
  let through=left,total=0n;
  for(const [a,b] of pieces){const from=a>through?a:through;if(b>from)total+=b-from;if(b>through)through=b;}
  return Number(total)/1e6;
}

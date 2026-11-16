// Real competing runtime openers, synchronized only before their side BEGIN.
import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { LOCAL_RAW_PRIVACY_DDL, LOCAL_RAW_PEER_INDEX_DDL, attestedLocalRawPackage } from '../content-safety-schema.mjs';
const exec=DatabaseSync.prototype.exec,close=DatabaseSync.prototype.close;
const words=new Int32Array(workerData.barrier);
let runtime,side,creates=0,status,closed=false;
DatabaseSync.prototype.exec=function(sql){
  if(sql===LOCAL_RAW_PRIVACY_DDL.join('\n'))runtime=this;
  if(runtime && this!==runtime && sql==='BEGIN IMMEDIATE'){
    side=this;Atomics.add(words,0,1);parentPort.postMessage('ready');
    if(Atomics.wait(words,1,0,30000)==='timed-out')throw Error('builder barrier timed out');
  }
  const result=exec.call(this,sql);
  if(this===side){
    if(sql===LOCAL_RAW_PEER_INDEX_DDL.join('\n'))creates++;
    if(sql==='COMMIT')status='built';
    if(sql==='ROLLBACK')status='present';
  }
  return result;
};
DatabaseSync.prototype.close=function(){const result=close.call(this);if(this===side)closed=true;return result;};
const core=openMemoryCore({path:workerData.path,raw:true,rawSearch:false});
try {
  const read=core.list({namespace:{ownerId:'synthetic-owner',scope:'personal',projectId:null}}).ok;
  parentPort.postMessage({status,creates,closed,read,version:attestedLocalRawPackage(runtime)});
} finally {await core.close();}

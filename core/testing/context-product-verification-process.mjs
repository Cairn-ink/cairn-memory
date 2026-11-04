// Dedicated process; barriers use stdout/IPC, all database access uses SQLite.
import { DatabaseSync } from 'node:sqlite';
import * as diagnostics from '../context-product-attribution.mjs';
import { local, workRow } from './context-product-verification-fixture.mjs';
const [path,mode,point]=process.argv.slice(2),state=new SharedArrayBuffer(8);
// Seed only calibration; the parent checks actual multi-chunk transactions.
new Int32Array(state)[0]=1;
if(point==='native')process.stdout.write('maintenance-pid '+process.pid+'\n');
const a=local(path,{mode,enabled:true,state}),exec=DatabaseSync.prototype.exec;
let chunks=0,armed=false,cacheSize;const writes=new WeakSet();
const previous=point==='preparation'?workRow(path).last_key:null;
a.setHook(kind=>{
  if(kind==='checkpoint'&&point==='preparation'){process.send({barrier:point,previous,pid:process.pid});process.kill(process.pid,'SIGSTOP');}
  if(kind==='verification-chunk') {chunks++;if(chunks===2)a.setClock(900);}
  if(kind==='verify-item'&&point==='mid'&&!armed&&(chunks>=1||typeof diagnostics.verificationBatchingQualified!=='function')){armed=true;process.send({barrier:point,chunks,cacheSize,pid:process.pid});process.kill(process.pid,'SIGSTOP');}
});
DatabaseSync.prototype.exec=function(sql) {
  if(sql==='BEGIN IMMEDIATE'){
    const side=this.prepare('PRAGMA application_id').get().application_id===0x43525032;
    if(side&&point!=='native')exec.call(this,'PRAGMA cache_size=1; PRAGMA cache_spill=1; PRAGMA wal_autocheckpoint=0;');
    const result=exec.call(this,sql);
    if(side){writes.add(this);cacheSize=this.prepare('PRAGMA cache_size').get().cache_size;}return result;
  }
  if(sql!=='COMMIT'||!writes.has(this))return exec.call(this,sql);
  writes.delete(this);
  if(point==='native')process.stdout.write('native-commit '+process.pid+' '+chunks+'\n');
  if(point==='before'){process.send({barrier:point,chunks,cacheSize,pid:process.pid});process.kill(process.pid,'SIGSTOP');}
  const result=exec.call(this,sql);
  if(point==='after'){process.send({barrier:point,chunks,cacheSize,pid:process.pid});process.kill(process.pid,'SIGSTOP');}
  return result;
};
try {a.step(point==='preparation'?1:1024);throw Error('crash barrier was not reached');}finally{a.close();}

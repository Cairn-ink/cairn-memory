import { existsSync,readFileSync,writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { assetHost,pdf } from './asset-fixtures.mjs';
const config=JSON.parse(readFileSync(process.argv[2],'utf8')),trusted=assetHost();
const core=openMemoryCore({path:config.path,assets:trusted.options});
const {byteCount,...input}=config.input;if(byteCount!==undefined)input.bytes=pdf(byteCount);
try {
  writeFileSync(config.ready,String(process.pid),{flag:'wx',mode:0o600});
  const deadline=Date.now()+30000;
  while(!existsSync(config.start)){if(Date.now()>deadline)throw Error('asset_race_barrier_timeout');await delay(5);}
  trusted.state.hook=count=>{if(count===2)writeFileSync(config.entered,String(process.pid),{flag:'wx',mode:0o600});};
  if(config.killBeforeCommit){
    const original=DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec=function(sql){
      if(sql==='COMMIT'){
        writeFileSync(config.beforeCommit,String(process.pid),{flag:'wx',mode:0o600});
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);
      }
      return original.call(this,sql);
    };
  }
  const outcome=trusted.call(core,config.method,input);
  writeFileSync(config.result,JSON.stringify({pid:process.pid,outcome,checks:trusted.state.checks}),{flag:'wx',mode:0o600});
}finally{core.close();}

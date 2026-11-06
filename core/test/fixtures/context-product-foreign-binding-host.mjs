import { testClock } from '../../testing/context-product-test-clock.mjs';
import { DatabaseSync } from 'node:sqlite';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createContextReadHost as baseHost } from '../../testing/context-product-index-host.mjs';

export async function createContextReadHost(configuration){
  const c=new Int32Array(configuration.bindingControl),state=new Int32Array(configuration.state);
  const prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  const spawnSync=childProcess.spawnSync;
  childProcess.spawnSync=function(command,args,...rest){
    const replacing=args.indexOf('replace-product-cache'),initializing=args.indexOf('initialize-product-cache');
    const at=Math.max(replacing,initializing);
    let init,unframe=false;
    if(at>=0){
      init=JSON.parse(args[at+2]);
      if(replacing>=0){
        Atomics.add(c,13,1);
        if(Atomics.load(c,12)){
          args=[...args];
          if(Atomics.load(c,12)===1)init.foreignBindingDigest='0'.repeat(64);else delete init.foreignBindingDigest;
          args[at+2]=JSON.stringify(init);
        }
      }
      if(!args.includes('observe-native')){
        // Meter the helper's existing native transcript, then restore the
        // legacy one-value transport expected by the no-port production path.
        args=[...args,'observe-native'];rest=[{...rest[0],maxBuffer:65536},...rest.slice(1)];unframe=true;
      }
    }
    const result=Reflect.apply(spawnSync,this,[command,args,...rest]);
    let terminal;
    for(const line of String(result.stdout??'').split('\n')){
      let event;try{const parsed=JSON.parse(line);if(parsed.value)terminal=parsed.value;event=parsed.outcome;}catch{continue;}
      if(!event?.ok||!['execute','configure','begin','commit','rollback'].includes(event.stage))continue;
      Atomics.add(c,6,1);
      const statements=event.database==='initialize'&&event.stage==='begin'?1+init.sql.split(';').filter(x=>x.trim()).length:
        event.database==='lifecycle'&&event.stage==='configure'?2:1;
      Atomics.add(c,7,statements);
    }
    return unframe&&terminal?{...result,stdout:JSON.stringify(terminal)}:result;
  };
  syncBuiltinESMExports();
  DatabaseSync.prototype.exec=function(sql){
    Atomics.add(c,1,sql.split(';').filter(x=>x.trim()).length);
    if(sql.startsWith('PRAGMA foreign_keys=ON;'))Atomics.add(c,4,1);
    return Reflect.apply(exec,this,[sql]);
  };
  DatabaseSync.prototype.prepare=function(sql){
    const stmt=Reflect.apply(prepare,this,[sql]);
    return new Proxy(stmt,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return(...args)=>{
        if(['get','all','iterate','run'].includes(key)){
          Atomics.add(c,0,1);
          if(sql==='SELECT * FROM product_metadata WHERE singleton=1'&&Atomics.load(c,11)){
            return {...Reflect.apply(value,target,args),profile:'synthetic invalidated resident'};
          }
          if(sql==='PRAGMA quick_check'){
            Atomics.add(c,2,1);
          }
          if(sql==='PRAGMA foreign_key_check'){
            Atomics.add(c,3,1);
          }
          if(sql==='SELECT stamp,record FROM product_attestation WHERE singleton=1'){
            const n=Atomics.add(c,14,1)+1,fault=Atomics.load(c,8);
            if(n===2&&fault)return {stamp:fault===1?1:0,record:'synthetic invalid seal'};
          }
          if(sql.startsWith('SELECT substr(record,')){
            Atomics.add(c,5,1);
            if(Atomics.exchange(c,9,0))void testClock.advance(1001,{waitForWorkers:false});
            if(Atomics.exchange(c,10,0))Atomics.store(state,0,0);
          }
        }
        return Reflect.apply(value,target,args);
      };
    }});
  };
  return baseHost(configuration);
}

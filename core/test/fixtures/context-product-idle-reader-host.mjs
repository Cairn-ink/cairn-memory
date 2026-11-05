import { DatabaseSync } from 'node:sqlite';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { createContextReadHost as base } from '../../testing/context-product-index-host.mjs';

export async function createContextReadHost(configuration) {
  const control=new Int32Array(configuration.idleControl),tracked=new WeakSet();
  const {prepare,exec,close}=DatabaseSync.prototype,spawn=childProcess.spawnSync;
  const track=db=>{
    if(tracked.has(db))return;
    const file=prepare.call(db,'PRAGMA database_list').all().find(x=>x.name==='main')?.file;
    if(file?.endsWith('.context-read-product-v1.1.sqlite')){tracked.add(db);Atomics.add(control,0,1);Atomics.add(control,3,1);}
  };
  DatabaseSync.prototype.prepare=function(sql){
    track(this);return Reflect.apply(prepare,this,[sql]);
  };
  DatabaseSync.prototype.exec=function(sql){track(this);return Reflect.apply(exec,this,[sql]);};
  DatabaseSync.prototype.close=function(){
    const was=tracked.has(this),result=Reflect.apply(close,this,[]);
    if(was){tracked.delete(this);Atomics.sub(control,0,1);}return result;
  };
  childProcess.spawnSync=function(command,args,...rest){
    if(args?.includes('replace-product-cache')){
      Atomics.add(control,1,1);Atomics.store(control,2,Atomics.load(control,0));
    }
    return Reflect.apply(spawn,this,[command,args,...rest]);
  };
  syncBuiltinESMExports();
  return base(configuration);
}

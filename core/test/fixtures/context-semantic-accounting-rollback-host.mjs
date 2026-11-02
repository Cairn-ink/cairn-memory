// Inject after a real transformation attempt, inside its sidecar transaction.
import { DatabaseSync } from 'node:sqlite';
import { createContextReadHost as base } from './context-semantic-pump-cutoff-host.mjs';
export async function createContextReadHost(configuration) {
  const host=await base(configuration),prepare=DatabaseSync.prototype.prepare;
  let armed=false,fired=false;
  DatabaseSync.prototype.prepare=function(sql,...rest){
    const statement=Reflect.apply(prepare,this,[sql,...rest]);
    if(sql==='INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)'){
      const run=statement.run;
      statement.run=function(...args){
        if(!armed||fired)return Reflect.apply(run,this,args);
        fired=true;
        if(!configuration.rollbackFence)throw new TypeError('synthetic transformation rollback');
        const result=Reflect.apply(run,this,args),db=new DatabaseSync(configuration.canonicalPath);
        try{db.exec('UPDATE namespace_epochs SET epoch=epoch+1');}finally{db.close();}
        return result;
      };
    }return statement;
  };
  return {...host,authorize(request,credential){
    const binding=host.authorize(request,credential);
    if(request.method==='refreshContextIndex')armed=true;return binding;
  }};
}

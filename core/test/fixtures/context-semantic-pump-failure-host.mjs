// Offline failure at the first SQLite statement of an authorized refresh.
import { createContextReadHost as base } from './context-semantic-pump-cutoff-host.mjs';
import { DatabaseSync } from 'node:sqlite';
export async function createContextReadHost(configuration) {
  const host=await base(configuration);let armed=false,failed=false;
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(...args) {
    if(armed&&!failed) {
      failed=true;DatabaseSync.prototype.prepare=prepare;
      if(configuration.failureCode==='storage_error') {
        const db=new DatabaseSync(':memory:');
        try { Reflect.apply(prepare,db,['SELECT missing FROM nonexistent']).get(); } finally { db.close(); }
      }
      throw Object.assign(Error('synthetic operation failure'),{code:configuration.failureCode});
    }
    return Reflect.apply(prepare,this,args);
  };
  return {...host,authorize(request,credential) {
    const authorized=host.authorize(request,credential);
    if(request.method==='refreshContextIndex'&&!failed)armed=true;
    return authorized;
  }};
}

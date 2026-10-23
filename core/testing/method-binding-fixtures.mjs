import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openMemoryCore } from '../contract.mjs';
import { STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { host,ns } from './method-package-fixtures.mjs';
export {ns,project,ok,error,input,file,history,child,childHost,moduleURL} from './method-package-fixtures.mjs';
export const context=(readSet=[ns],roleId='reviewer')=>({readSet,roleId});
export const adoption=(receipt,actionId='adopt',patch={})=>({bindingNamespace:ns,actionId,package:receipt.package,version:receipt.version,
  roleId:'reviewer',expectedRevision:null,readSet:[ns],...patch});
export const disable=(receipt,actionId='disable',patch={})=>({bindingNamespace:ns,actionId,package:receipt.package,
  roleId:'reviewer',expectedRevision:null,readSet:[ns],...patch});
export function bindingFixture(t) {
  const workspace=createTestWorkspace(t,{prefix:'method-bindings-'}),path=join(workspace.path,'store.sqlite'),trusted=host();
  const state={deniedReads:new Set(),deniedWrites:new Set(),generations:new Map(),checks:0,hook:null,requests:[]};
  const key=ns=>JSON.stringify(ns);
  const authority={
    authorize(request,token) {
      state.requests.push(request);
      if((request.actionClass==='read'?state.deniedReads:state.deniedWrites).has(key(request.namespace)))return null;
      return trusted.authority.authorize(request,token);
    },
    isCurrent(grant,request) {
      state.hook?.(++state.checks,request);
      if((request.actionClass==='read'?state.deniedReads:state.deniedWrites).has(key(request.namespace)))return null;
      const value=trusted.authority.isCurrent(grant,request);
      return value?{...value,accessGeneration:state.generations.get(key(request.namespace))??value.accessGeneration}:null;
    },
  };
  const configuration={path,methodPackages:{...trusted.options,authority},privateCards:{...trusted.cards,authority}};
  let core=openMemoryCore(configuration);workspace.defer(()=>core.close());
  const db=new DatabaseSync(path,{timeout:STORAGE_BUSY_TIMEOUT_MS});workspace.defer(()=>db.close());
  return {workspace,path,db,trusted,state,get core(){return core;},
    call(method,input){return trusted.call(core,method,input);},
    reopen(){core.close();core=openMemoryCore(configuration);return core;},
    denyRead(namespace,deny=true){deny?state.deniedReads.add(key(namespace)):state.deniedReads.delete(key(namespace));},
    generation(namespace,value){state.generations.set(key(namespace),value);},
  };
}

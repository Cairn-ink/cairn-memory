import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openRawSearch } from '../raw-search-index.mjs';
import { ns,cardHost,localPlainPort } from './raw-source-fixtures.mjs';
import { openDatabase } from '../database.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { rationaleModel } from './rationale-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

export function rawSearchHost() {
  let generation=1;
  const grants=new WeakMap(),token={};
  const authority={authorize(request,provided){
    if(provided!==token||!['rawSearch','rawSearchSource','rawSearchMaintenance'].includes(request.method))return null;
    const grant={};const {input,...binding}=request;grants.set(grant,binding);return grant;
  },isCurrent(grant){const binding=grants.get(grant);return binding?{...binding,accessGeneration:generation}:null;}};
  return {authority,token,revoke(){generation++;}};
}
export const broker = () => ({version:1,createTurn(){let released=false;return {
  enter(){return 'admitted';},release(){if(released)throw Error('duplicate release');released=true;},
};}});
export async function searchFixture(f,patch={}) {
  f.db.exec('PRAGMA busy_timeout=5000');
  const host=rawSearchHost(),directory=join(f.workspace.path,'raw-index');mkdirSync(directory,{mode:0o700});
  const {setupHost,...settings}=patch;setupHost?.(host);
  const options={version:'raw-search-v1',enabled:true,backend:'local',path:f.path,directory,ownerId:ns.ownerId,
    readSet:[ns],authority:host.authority,crypto:f.port,maintenanceTurn:broker(),...settings};
  let service=await openRawSearch(options);
  f.workspace.defer(()=>service.close());
  return {host,options,directory,get service(){return service;},
    indexCount(){const db=new DatabaseSync(join(directory,readdirSync(directory).find(name=>name.endsWith('.sqlite'))));
      try{return db.prepare('SELECT count(*) n FROM segments WHERE published=1').get().n;}finally{db.close();}},
    async reopen(){await service.close();service=await openRawSearch(options);},
    maintain:input=>service.maintain(input,host.token),
    search:(input={query:'synthetic'})=>service.search(input,host.token),
    prepare:(candidate,intent='current')=>service.prepare(candidate,{intent},host.token),
    async tick(input){await new Promise(resolve=>setTimeout(resolve,1010));return service.maintain(input,host.token);}};
}

// New-file safety layout, with no migration or operational data.
export function safetySourceFixture(t,{model={}}={}) {
  const workspace=createTestWorkspace(t,{prefix:'raw-search-safety-'}),path=join(workspace.path,'store.sqlite');
  const seed=openDatabase(path,{currentDependencies:true,contentSafety:'s2h-v1'});seed.close();
  const host=cardHost(),port=localPlainPort();
  const core=openRawCaptureCore({path,model:{...rationaleModel(),...model},privateCards:host.options},
    {mode:'raw-v1',sources:true,port,readPolicy:()=>({generation:'synthetic',reason:null})});
  workspace.defer(()=>core.close());
  const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON');workspace.defer(()=>db.close());
  return {workspace,path,host,port,core,db,call:(method,input)=>host.call(core,method,input)};
}

import {rawSearchTestWait} from './raw-search-clock.mjs';
import { DatabaseSync } from 'node:sqlite';
import { createHmac } from 'node:crypto';
import { sidecarAttestationFile, writeSidecarAttestation } from '../context-product-sidecar-attestation.mjs';
import { mkdirSync,readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openReadDatabase } from '../read-database.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';
import { openRawSearchStorage } from '../raw-search-storage.mjs';
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
// Restore fixtures must pass physical-file admission before exercising stale
// source denial. Rebind only the outer seal; preserve every stored source hint.
export function attestRawSearchCopy(f,path) {
  const identity=f.db.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').get();
  const db=new DatabaseSync(path);
  try {
    db.exec('BEGIN IMMEDIATE');
    const binding=JSON.parse(db.prepare('SELECT binding FROM header WHERE singleton=1').get().binding);
    const bind=purpose=>createHmac('sha256',identity.cursor_secret)
      .update(JSON.stringify([purpose,identity.store_id,binding])).digest('base64url');
    writeSidecarAttestation(db,bind('raw-search-attestation-key-v1'),sidecarAttestationFile(path),
      {name:'raw-search',binding:bind('raw-search-attestation-format-v1')});
    db.exec('COMMIT');
  } finally {try {if(db.isTransaction)db.exec('ROLLBACK');}finally{db.close();}}
}
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
    async tick(input){await rawSearchTestWait(1010);return service.maintain(input,host.token);}};
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

// Fixture-only: consume discovery hints without publication so a regression can
// deliberately exercise the independent full-inventory path.
export async function consumeRecentHints(f,s) {
  const reader=openReadDatabase(f.path,{contextRead:true});
  const authority=createRawSearchAuthority(reader,s.options);
  const storage=await openRawSearchStorage({directory:s.directory,identity:authority.identity,bind:authority.bind,quotaBytes:512*1024*1024});
  try {
    let cursor;
    for(let turn=0;turn<128;turn++){
      const batch=authority.recent(cursor);cursor=batch.cursor;
      if(!cursor.recovery&&!Object.keys(cursor.active).length)break;
      if(turn===127)throw Error('synthetic recent hints did not drain');
    }
    await storage.commitBatch({checkpoint:{...storage.head().checkpoint,recent:cursor}});
  }finally{await storage.close();reader.db.close();}
}

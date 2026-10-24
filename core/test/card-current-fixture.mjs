import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync, readFileSync, writeFileSync, openSync, closeSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { host, ns, project, ok, importMethod, adopt } from './role-fixture.mjs';
export { host, ns, project, ok, importMethod, adopt };
export const cardOptions = (authority, enabled = true) => ({ version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority,
  ...(enabled ? { currentDependencies:{version:'card-current-dependencies-v1'} } : {}) });
export const query = (patch = {}) => ({readSet:[ns],query:'finance',types:['card'],intent:'current',deadlineMs:5000,...patch});
export function fixture(t,{h=host(),enabled=true,sources,...extra}={}) {
  const dir=mkdtempSync(join(tmpdir(),'card-current-'));chmodSync(dir,0o700);const path=join(dir,'store.sqlite');
  let core=openMemoryCore({path,privateCards:cardOptions(h.authority,enabled),methodPackages:h.methods,roleProfiles:h.options,contextRead:{...h.context,...(sources?{sources}:{})},...extra});
  const db=new DatabaseSync(path);db.exec('PRAGMA busy_timeout=5000;PRAGMA foreign_keys=ON');
  const f={path,dir,h,db,get core(){return core;},call:(method,input)=>core[method](input,{}),
    reopen(enabled=true,extra={}) {core.close();core=openMemoryCore({path,privateCards:cardOptions(h.authority,enabled),methodPackages:h.methods,roleProfiles:h.options,contextRead:h.context,...extra});return core;},
    card({namespace=ns,declare=true,context={readSet:[namespace],roleId:'finance'},packages=[f.v1.package],title='Finance report',body='finance monthly report uses v1',applicability='current',memoryRefs}={}) {
      const action=String(++f.serial),draft=ok(f.call('createCardDraft',{namespace,actionId:'draft-'+action,drafting:'authored',input:{title,body,...(memoryRefs?{memoryRefs,sourcePolicy:'retained-receipts-v1'}:{authoredInput:{text:'Synthetic finance source',occurredAt:null}})}}));
      const currentDependencies=f.declaration(context,packages);
      const confirmed=ok(f.call('confirmCardDraft',{namespace,cardId:draft.id,expectedRevision:1,actionId:'confirm-'+action,applicability,...(declare?{currentDependencies}:{})}));
      return {type:'card',namespace,cardId:confirmed.id,revision:confirmed.revision,bodyRevision:confirmed.bodyRevision};
    },
    declaration(context={readSet:[ns],roleId:'finance'},packages=[f.v1.package]) {return {context,packages:packages.map(pkg=>({package:pkg,snapshot:ok(f.call('resolveMethod',{...context,package:pkg})).snapshot}))};},
    serial:0};
  f.v1=ok(f.call('importMethodVersion',importMethod()));ok(f.call('adoptMethodVersion',adopt(f.v1)));
  f.v2=ok(f.call('importMethodVersion',{...importMethod('method-2','version two'),package:f.v1.package,expectedPackageRevision:1,basedOn:f.v1.version}));
  f.change=(version=f.v2,patch={})=>ok(f.call('adoptMethodVersion',{...adopt(version,'adopt-'+(++f.serial),null,ns,1,[ns]),...patch}));
  t.after(()=>{core.close();db.close();rmSync(dir,{recursive:true,force:true});});return f;
}
export function child(f,job) {
  const key=String(++f.serial),jobPath=join(f.dir,key+'.job.json'),outPath=join(f.dir,key+'.out'),errPath=join(f.dir,key+'.err');
  writeFileSync(jobPath,JSON.stringify(job));const out=openSync(outPath,'wx',0o600),err=openSync(errPath,'wx',0o600);let r;
  try {r=spawnSync(process.execPath,[new URL('./fixtures/card-current-worker.mjs',import.meta.url).pathname,f.path,jobPath],{stdio:['ignore',out,err],timeout:20000});}finally{closeSync(out);closeSync(err);}
  assert.equal(r.error,undefined);assert.equal(r.signal,null);assert.equal(r.status,0,readFileSync(errPath,'utf8'));console.log(JSON.stringify({child:job.method,exit:r.status}));return JSON.parse(readFileSync(outPath,'utf8'));
}

export function rendezvous(t,f,job) {
 const key='rendezvous-'+(++f.serial),jobPath=join(f.dir,key+'.json'),outPath=join(f.dir,key+'.out'),errPath=join(f.dir,key+'.err');
 writeFileSync(jobPath,JSON.stringify({...job,rendezvous:true,expectedCodes:['revision_conflict','card_not_found','card_state_conflict']}));
 const out=openSync(outPath,'wx',0o600),err=openSync(errPath,'wx',0o600);let processChild;
 try {processChild=spawn(process.execPath,[new URL('./fixtures/card-current-worker.mjs',import.meta.url).pathname,f.path,jobPath],{stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
 let finished=false;
 const done=new Promise((resolve,reject)=>{const timer=setTimeout(()=>processChild.kill('SIGKILL'),25000);processChild.once('error',reject);processChild.once('close',(code,signal)=>{clearTimeout(timer);finished=true;try{assert.equal(code,0,readFileSync(errPath,'utf8'));assert.equal(signal,null);console.log(JSON.stringify({child:key,exit:code}));resolve(JSON.parse(readFileSync(outPath,'utf8')));}catch(error){reject(error);}});});done.catch(()=>{});
 t.after(async()=>{if(!finished)processChild.kill('SIGKILL');await done.catch(()=>{});});
 return {done,release(){writeFileSync(jobPath+'.release','go');},async ready(){const deadline=Date.now()+20000;while(!existsSync(jobPath+'.ready')){if(finished){await done;throw Error('child exited before ready');}assert.ok(Date.now()<deadline,'child ready timeout');await new Promise(resolve=>setTimeout(resolve,5));}}};
}

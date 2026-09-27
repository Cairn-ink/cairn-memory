import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { rationaleModel } from './rationale-model.mjs';
export { ns, options, ok } from './episode-helpers.mjs';
import { ns, options } from './episode-helpers.mjs';
export function interpretation(request, type='work') {
  const index=request.input.classificationTarget[0]??0;
  const field=value=>({value,anchors:[{sourceIndex:index,start:0,end:request.input.sources[index].text.length}]});
  return {type:field(type),language:'mixed',gist:field('Synthetic 中文 activity'),outcome:null,nextStep:null,disposition:null};
}
export function model(overrides={}) {
  const calls=[];
  const base={...rationaleModel(),extract:()=>({items:[]}),interpretEpisode:request=>interpretation(request),...overrides};
  const wrapped={...base,calls};
  for(const method of ['extract','qualifyCandidates','classify','interpretEpisode']) {
    const original=base[method];
    if(original)wrapped[method]=request=>{calls.push({method,request:structuredClone({...request,signal:undefined})});return original(request);};
  }
  return wrapped;
}
export function setup(t, overrides={}, config={}) {
  const dir=mkdtempSync(join(tmpdir(),'se2-capture-')),path=join(dir,'store.sqlite');
  const port=model(overrides),core=openMemoryCore({path,...options,model:port,...config});
  const db=new DatabaseSync(path);db.exec('PRAGMA foreign_keys=ON');
  t.after(()=>{core.close();db.close();rmSync(dir,{recursive:true,force:true});});
  return {core,db,path,model:port};
}
export function input(n=1,sessionId='private-session',extra={}) {
  return {namespace:ns,client:'synthetic',sessionId,eventId:'event-'+createHash('sha256').update(sessionId+':'+n).digest('hex'),
    episodeContext:{clientLabel:'Synthetic client',generation:'initial',origin:'ordinary'},
    messages:[{id:`message-${n}`,role:'user',content:`Synthetic 中文 English 😀 evidence ${n}.`,occurredAt:'2026-09-28T00:00:00.000Z'}],...extra};
}
export function counts(port,method='interpretEpisode') {return port.calls.filter(call=>call.method===method).length;}
export function deferred() {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
export function assertError(result,code) {assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,code);}

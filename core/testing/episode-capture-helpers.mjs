import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
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
  const ws=createTestWorkspace(t,{prefix:'se2-capture-'}),path=join(ws.path,'store.sqlite');
  const port=model(overrides),core=openMemoryCore({path,...options,model:port,...config});
  ws.defer(()=>core.close());
  const db=new DatabaseSync(path); ws.defer(()=>db.close());
  db.exec('PRAGMA foreign_keys=ON');
  return {core,db,path,model:port,ws};
}
export function input(n=1,sessionId='private-session',extra={}) {
  return {namespace:ns,client:'synthetic',sessionId,eventId:'event-'+createHash('sha256').update(sessionId+':'+n).digest('hex'),
    episodeContext:{clientLabel:'Synthetic client',generation:'initial',origin:'ordinary'},
    messages:[{id:`message-${n}`,role:'user',content:`Synthetic 中文 English 😀 evidence ${n}.`,occurredAt:'1901-02-03T04:05:06.789Z'}],...extra};
}
export function counts(port,method='interpretEpisode') {return port.calls.filter(call=>call.method===method).length;}
export function deferred() {let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
export function assertError(result,code) {assert.equal(result.ok,false,JSON.stringify(result));assert.equal(result.error.code,code);}

// Real storage seams with the public success envelope, for boundary injection.
export function captureOperations(runtime) {
  return Object.fromEntries(['finishAdmission', 'assertCaptureEvidence'].map(method =>
    [method, input => ({ ok: true, value: runtime[method](ns, input) })]).concat([
    ['abandonAdmission', (input, retryable) => runtime.abandonAdmission(ns, { ...input, retryable })],
  ]));
}

import assert from 'node:assert/strict';
import { mkdtempSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openMemoryCore } from '../index.mjs';
export const ns={ownerId:'owner',scope:'personal',projectId:null};
export const project={ownerId:'owner',scope:'project',projectId:'project'};
export const ok=result=>{assert.equal(result.ok,true,JSON.stringify(result));return result.value;};
export function host({allow=()=>true,onCurrent=()=>{},counter}={}) {
  let revoked=false;
  const requests=[];
  const authority={authorize(request,token){requests.push(request);if(revoked||!token||!allow(request))return null;const {input,...grant}=request;return {...grant,accessGeneration:1};},isCurrent(grant,request){onCurrent(request);return revoked?null:grant;}};
  return {authority,requests,revoke(){revoked=true;},options:{version:'role-profiles-local-v1',storage:'local-plain-v1',authority,attribution:{actorId:'actor',agentId:'agent'}},
    methods:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority},
    context:{version:'context-read-v1',authority,counter:counter??{id:'synthetic-exact',countTokens:text=>Math.ceil(Buffer.byteLength(text)/4)}}};
}
export function fixture(t,{h=host(),...options}={}) {
  const dir=mkdtempSync(join(tmpdir(),'cairn-role-'));chmodSync(dir,0o700);const path=join(dir,'store.sqlite');
  let core;
  const open=()=>core=openMemoryCore({path,methodPackages:h.methods,assets:h.assets,contextRead:h.context,roleProfiles:h.options,...options});open();
  const f={dir,path,h,get core(){return core;},reopen(){core.close();return open();},call(method,input){return core[method](input,{});}};
  t.after(()=>{core.close();rmSync(dir,{recursive:true,force:true});});return f;
}
export const publish=(namespace=ns,roleKey='finance',actionId='publish',head=null,revision=null,fields={duties:['Review records'],requiredOutputs:['Report decisions']})=>({namespace,roleKey,actionId,expectedCurrentRelease:head,expectedRegistryRevision:revision,fields});
export const read=(roleKey='finance',readSet=[ns])=>({mode:'now',roleKey,readSet});
export const importMethod=(actionId='method-1',text='version one',namespace=ns)=>({namespace,actionId,title:'Synthetic method',files:[{path:'guide.txt',text,mediaType:'text/plain'}]});
export const adopt=(value,actionId='adopt',roleId=null,bindingNamespace=ns,expectedRevision=null,readSet=[ns])=>({bindingNamespace,package:value.package,version:value.version,readSet,roleId,expectedRevision,actionId});

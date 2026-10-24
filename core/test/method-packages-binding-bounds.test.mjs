import assert from 'node:assert/strict';
import test from 'node:test';
import {join} from 'node:path';
import {openMemoryCore} from '../contract.mjs';
import {createTestWorkspace} from '../../tools/testing/workspace.mjs';
import {ok} from '../testing/method-package-fixtures.mjs';

test('M10 legal maximum namespaces, roles and 16 reasons shrink role/event pages by whole-envelope bytes',t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'store.sqlite'),token={},grants=new WeakMap();
  const authority={authorize(request,supplied){if(supplied!==token)return null;const grant={}, {input,...binding}=request;grants.set(grant,{...binding,accessGeneration:1});return grant;},isCurrent:grant=>grants.get(grant)??null};
  const core=openMemoryCore({path,methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority},privateCards:{version:'private-cards-local-v1',source:'submitted-note-v1',storage:'local-plain-v1',disclosure:'explicit-submitted-note-v1',authority}});workspace.defer(()=>core.close());
  const ns={ownerId:'界'.repeat(200),scope:'personal',projectId:null},project={...ns,scope:'project',projectId:'界'.repeat(200)},readSet=[ns,project],roleId='r'.repeat(200);
  const call=(method,input)=>{const result=core[method](input,token);assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);return ok(result);};
  const reasons=Array.from({length:16},(_,i)=>call('submitSourceNote',{namespace:project,actionId:'note-'+i,text:'Synthetic bounded reason.',occurredAt:null}).source);
  for(let i=0;i<23;i++){
    const imported=call('importMethodVersion',{namespace:ns,actionId:'import-'+i,title:'Synthetic bounded package',files:[{path:'SKILL.md',text:'Synthetic',mediaType:'text/markdown'}]});
    call('adoptMethodVersion',{bindingNamespace:project,actionId:'adopt-'+i,package:imported.package,version:imported.version,roleId,readSet,expectedRevision:null,reasonRefs:reasons});
  }
  for(const [method,args,key] of [['resolveMethodsForRole',{readSet,roleId},'methods'],['listMethodBindingEvents',{bindingNamespace:project},'events']]){
    const first=call(method,args);assert.ok(first[key].length<20,'legal large metadata must shrink the page');assert.ok(first.nextCursor);assert.ok(first.nextCursor.length<=8192);
    let page=first,count=0;
    do{
      count+=page[key].length;
      if(method==='resolveMethodsForRole' && page.methods.length){const version=page.methods[0].version;assert.ok(page.snapshot.length<=65536);call('getMethodVersion',{version,intent:'current',context:{readSet,roleId},snapshot:page.snapshot});}
      if(!page.nextCursor)break;
      page=call(method,{...args,cursor:page.nextCursor});
    }while(true);
    assert.equal(count,23);
  }
});

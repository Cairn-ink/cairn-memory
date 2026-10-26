import assert from 'node:assert/strict';
import test from 'node:test';
import { bindingFixture,ns,project,ok,error,input,adoption,disable,context } from '../testing/method-binding-fixtures.mjs';
const resolve=(f,pkg,readSet=[ns,project],roleId='reviewer')=>ok(f.call('resolveMethod',{package:pkg,...context(readSet,roleId)}));

test('M05 all four precedence levels, higher-level insertion and role-independent disabled creation barriers',t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  assert.equal(resolve(f,first.package).status,'no-active-version');
  const second=ok(f.call('importMethodVersion',input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version})));
  for(const [i,bindingNamespace,roleId,version] of [[0,ns,null,first.version],[1,ns,'reviewer',second.version],[2,project,null,first.version],[3,project,'reviewer',second.version]]){
    ok(f.call('adoptMethodVersion',adoption(first,'level-'+i,{bindingNamespace,roleId,version,readSet:[ns,project]})));
    const result=resolve(f,first.package);assert.deepEqual(result.version,version);assert.deepEqual(result.binding.bindingNamespace,bindingNamespace);assert.equal(result.binding.roleKey,roleId??'*');
  }
  assert.deepEqual(resolve(f,first.package,[ns]).version,second.version);
  assert.deepEqual(resolve(f,first.package,[ns,project],'other-role').version,first.version);
  assert.equal(resolve(f,first.package,[project]).status,'unavailable','unreadable project-to-personal target blocks fallback');
  ok(f.call('disableMethodBinding',disable(first,'barrier',{roleId:'new-role',bindingNamespace:project,readSet:[ns,project]})));
  assert.equal(resolve(f,first.package,[ns,project],'new-role').status,'disabled');
  assert.deepEqual(resolve(f,first.package,[ns],'new-role').version,first.version);
  assert.deepEqual(resolve(f,first.package,[ns,project],null).version,first.version);
});

test('M05/M08 deleted version and package bindings remain unavailable barriers with no fanout',t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  const second=ok(f.call('importMethodVersion',input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version})));
  ok(f.call('adoptMethodVersion',adoption(first,'default',{roleId:null})));
  const higher=adoption(first,'higher',{bindingNamespace:project,readSet:[ns,project],version:second.version});
  ok(f.call('adoptMethodVersion',higher));
  const before=f.db.prepare('SELECT * FROM method_bindings ORDER BY rowid').all(),generations=f.db.prepare('SELECT * FROM method_binding_generations ORDER BY rowid').all();
  ok(f.call('deleteMethodVersion',{actionId:'delete-v2',ref:second.version,expectedRevision:1}));
  assert.equal(resolve(f,first.package).status,'unavailable');assert.deepEqual(resolve(f,first.package,[ns]).version,first.version);
  assert.deepEqual(f.db.prepare('SELECT * FROM method_bindings ORDER BY rowid').all(),before);assert.deepEqual(f.db.prepare('SELECT * FROM method_binding_generations ORDER BY rowid').all(),generations);
  ok(f.call('adoptMethodVersion',{...higher,actionId:'repair',version:first.version,expectedRevision:1}));
  assert.equal(resolve(f,first.package).status,'current');
  ok(f.call('deleteMethodPackage',{actionId:'delete-p',ref:first.package,expectedRevision:3}));
  assert.equal(resolve(f,first.package).status,'unavailable');
  assert.deepEqual(ok(f.call('listMethodEffects',{namespace:project})).effects.map(effect=>effect.kind),['binding_changed','binding_changed']);
  assert.ok(!ok(f.call('listMethodEffects',{namespace:ns})).effects.some(effect=>effect.kind==='binding_unavailable'));
  f.reopen();assert.equal(resolve(f,first.package).status,'unavailable');
});

test('M05/M09 canonical cross-scope identity, read-set authority and foreign namespace isolation',t=>{
  const f=bindingFixture(t),personal=ok(f.call('importMethodVersion',input())),local=ok(f.call('importMethodVersion',input('project',{namespace:project})));
  ok(f.call('adoptMethodVersion',adoption(personal,'cross',{bindingNamespace:project,readSet:[ns,project]})));
  ok(f.call('adoptMethodVersion',adoption(local,'adopt-project',{bindingNamespace:project,readSet:[project]})));
  const projectOnly=ok(f.call('resolveMethodsForRole',context([project])));
  assert.equal(projectOnly.methods.find(method=>method.package.packageId===personal.package.packageId).status,'unavailable');
  assert.equal(projectOnly.methods.find(method=>method.package.packageId===local.package.packageId).status,'current');
  assert.equal(ok(f.call('listMethodBindingEvents',{bindingNamespace:project,package:{...personal.package,namespace:project}})).events.length,0);
  assert.equal(ok(f.call('listMethodBindingEvents',{bindingNamespace:project,package:{...personal.package,packageId:'missing'}})).events.length,0);
  f.denyRead(ns);error(f.call('resolveMethod',{package:personal.package,...context([ns,project])}),'authority_required');
  assert.equal(resolve(f,personal.package,[project]).status,'unavailable');f.denyRead(ns,false);
  error(f.call('resolveMethod',{package:{...personal.package,namespace:project},...context([ns,project])}),'method_not_found');
  error(f.call('resolveMethod',{package:{...personal.package,namespace:{...ns,ownerId:'foreign'}},...context([ns,project])}),'method_not_found');
  for(const readSet of [[],[ns,ns],[project,{...project,projectId:'other'}],[ns,{...project,ownerId:'foreign'}],[ns,project,ns]])error(f.call('resolveMethodsForRole',context(readSet)),'invalid_input');
});

test('M05 role listing includes unrelated-role bindings only within the authorized read set',t=>{
  const f=bindingFixture(t),personal=ok(f.call('importMethodVersion',input()));
  const local=ok(f.call('importMethodVersion',input('project-only',{namespace:project})));
  ok(f.call('importMethodVersion',input('unbound')));
  ok(f.call('adoptMethodVersion',adoption(personal,'personal-planner',{roleId:'planner'})));
  ok(f.call('adoptMethodVersion',adoption(local,'project-planner',{bindingNamespace:project,roleId:'planner',readSet:[project]})));
  for(const roleId of ['reviewer',null]){
    const page=ok(f.call('resolveMethodsForRole',context([ns],roleId)));
    const {snapshot,...expected}=resolve(f,personal.package,[ns],roleId);
    assert.equal(expected.status,'no-active-version');assert.equal(expected.binding,null);assert.equal(expected.version,null);
    assert.deepEqual(page.methods,[expected]);assert.ok(page.snapshot);assert.ok(snapshot);
    assert.equal(page.nextCursor,null);
  }
  const combined=ok(f.call('resolveMethodsForRole',context([ns,project])));
  assert.deepEqual(combined.methods.map(method=>method.package.packageId),[personal.package.packageId,local.package.packageId].sort((a,b)=>a.localeCompare(b)));
  assert.ok(combined.methods.every(method=>method.status==='no-active-version'));
});

test('M05/M06/M10 mixed role results page in package order with barriers, bounded envelopes and usable snapshots',t=>{
  const f=bindingFixture(t),ctx=context([ns,project]),expected=[],imports=[];
  const statuses=['current','disabled','unavailable','no-active-version'];
  for(let i=0;i<24;i++){
    const imported=ok(f.call('importMethodVersion',input('mixed-'+i)));imports.push(imported);
    ok(f.call('adoptMethodVersion',adoption(imported,'planner-'+i,{roleId:'planner'})));
    if(i%4!==3)ok(f.call('adoptMethodVersion',adoption(imported,'default-'+i,{roleId:null})));
    if(i%4===1)ok(f.call('disableMethodBinding',disable(imported,'disabled-'+i,{bindingNamespace:project,readSet:ctx.readSet})));
    if(i%4===2){
      const later=ok(f.call('importMethodVersion',input('later-'+i,{package:imported.package,expectedPackageRevision:1,basedOn:imported.version})));
      ok(f.call('adoptMethodVersion',adoption(later,'deleted-target-'+i,{bindingNamespace:project,readSet:ctx.readSet})));
      ok(f.call('deleteMethodVersion',{actionId:'delete-'+i,ref:later.version,expectedRevision:1}));
      assert.deepEqual(resolve(f,imported.package,[ns]).version,imported.version,'the unavailable higher binding blocks an available fallback');
    }
    const {snapshot,...resolved}=resolve(f,imported.package);
    assert.equal(resolved.status,statuses[i%4]);assert.ok(snapshot);expected.push(resolved);
  }
  expected.sort((a,b)=>a.package.packageId.localeCompare(b.package.packageId));
  const first=ok(f.call('resolveMethodsForRole',ctx));
  assert.ok(first.methods.length<=20);assert.ok(first.nextCursor);
  assert.deepEqual(first.methods,expected.slice(0,first.methods.length));
  const all=[],pins=[];let cursor,pages=0;
  do{
    const result=f.call('resolveMethodsForRole',{...ctx,limit:3,...(cursor?{cursor}:{})});
    assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);
    const page=ok(result);assert.equal(page.methods.length,3);assert.ok(page.snapshot);pages++;
    for(const method of page.methods)if(method.status==='current'){
      const request={version:method.version,intent:'current',context:ctx,snapshot:page.snapshot};
      assert.equal(ok(f.call('getMethodVersion',request)).version.adoptionStatus,'current');pins.push(request);
    }
    all.push(...page.methods);cursor=page.nextCursor;
  }while(cursor);
  assert.equal(pages,8);assert.deepEqual(all,expected);
  for(const status of statuses)assert.equal(all.filter(method=>method.status===status).length,6);
  const formerlyUnrelated=imports[3];
  ok(f.call('adoptMethodVersion',adoption(formerlyUnrelated,'now-reviewer')));
  error(f.call('resolveMethodsForRole',{...ctx,cursor:first.nextCursor}),'cursor_stale');
  for(const request of pins){
    error(f.call('getMethodVersion',request),'cursor_stale');
    assert.deepEqual(ok(f.call('getMethodVersion',{...request,intent:'history'})).version.ref,request.version);
  }
});

test('M10 role listing and binding-event pages cap at 20, bind cursors and keep envelopes bounded',t=>{
  const f=bindingFixture(t);
  for(let i=0;i<23;i++){
    const imported=ok(f.call('importMethodVersion',input('p'+i)));
    ok(f.call('adoptMethodVersion',adoption(imported,'a'+i,{roleId:null})));
  }
  let expectedCount=23;
  for(const method of ['resolveMethodsForRole','listMethodBindingEvents']){
    const args=method==='resolveMethodsForRole'?context([ns],null):{bindingNamespace:ns};
    const key=method==='resolveMethodsForRole'?'methods':'events';let cursor,all=[];
    do{const result=f.call(method,{...args,...(cursor?{cursor}:{})});assert.ok(Buffer.byteLength(JSON.stringify(result))<=65536);const page=ok(result);assert.ok(page[key].length<=20);all.push(...page[key]);cursor=page.nextCursor;}while(cursor);
    assert.equal(all.length,expectedCount);
    const page=ok(f.call(method,{...args,limit:1}));assert.ok(page.nextCursor);
    error(f.call(method,{...args,limit:2,cursor:page.nextCursor}),'invalid_cursor');
    f.generation(ns,2);error(f.call(method,{...args,limit:1,cursor:page.nextCursor}),'invalid_cursor');f.generation(ns,1);
    const imported=ok(f.call('importMethodVersion',input('mutation-'+method)));
    ok(f.call('disableMethodBinding',disable(imported,'barrier-'+method,{roleId:null})));
    error(f.call(method,{...args,limit:1,cursor:page.nextCursor}),'cursor_stale');expectedCount++;
    for(const limit of [0,21,1.1,-1])error(f.call(method,{...args,limit}),'invalid_input');
  }
});

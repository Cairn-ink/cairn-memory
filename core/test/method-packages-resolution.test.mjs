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

import assert from 'node:assert/strict';
import test from 'node:test';
import { bindingFixture,ns,project,ok,error,input,file,adoption,disable,context,history } from '../testing/method-binding-fixtures.mjs';
const status=(f,version,ctx=context())=>ok(f.call('getMethodVersion',{version,intent:'history',context:ctx})).version.adoptionStatus;
function versions(t){const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input('first',{files:[file('SKILL.md','a'.repeat(9000))]}))),second=ok(f.call('importMethodVersion',input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version})));return {f,first,second};}

test('M06 every adoption status, rollback to an older ordinal and context-free unassessed reads',t=>{
  const {f,first,second}=versions(t);
  assert.equal(status(f,first.version),'never-adopted');
  assert.equal(ok(f.call('getMethodVersion',history(first.version))).version.adoptionStatus,'unassessed');
  ok(f.call('adoptMethodVersion',adoption(first)));assert.equal(status(f,first.version),'current');assert.equal(status(f,second.version),'never-adopted');
  ok(f.call('adoptMethodVersion',adoption(second,'newer',{expectedRevision:1})));assert.equal(status(f,first.version),'newer-version-available');
  ok(f.call('adoptMethodVersion',adoption(first,'rollback',{expectedRevision:2})));assert.equal(status(f,second.version),'newer-version-available');
  ok(f.call('disableMethodBinding',disable(first,'withdraw',{expectedRevision:3})));assert.equal(status(f,first.version),'withdrawn');assert.equal(status(f,second.version),'withdrawn');
  ok(f.call('adoptMethodVersion',adoption(first,'again',{expectedRevision:4})));
  ok(f.call('adoptMethodVersion',adoption(second,'higher',{bindingNamespace:project,readSet:[ns,project]})));
  ok(f.call('deleteMethodVersion',{actionId:'delete-winner',ref:second.version,expectedRevision:1}));
  assert.equal(status(f,first.version,context([ns,project])),'historical');
  assert.equal(ok(f.call('getMethodVersion',{version:second.version,intent:'history',context:context([ns,project])})).adoptionStatus,'unavailable');
});

test('M06 current delivery checks the available winner; all read methods reject wrong winners and preserve immutable file bytes',t=>{
  const {f,first,second}=versions(t);ok(f.call('adoptMethodVersion',adoption(first)));
  const resolved=ok(f.call('resolveMethod',{package:first.package,...context()}));assert.equal(resolved.status,'current');assert.ok(resolved.snapshot);
  for(const method of ['getMethodVersion','listMethodManifest','readMethodFile']){
    const base={version:first.version,intent:'current',context:context(),snapshot:resolved.snapshot,...(method==='readMethodFile'?{path:'SKILL.md'}:{})};
    const value=ok(f.call(method,base));assert.equal(method==='getMethodVersion'?value.version.adoptionStatus:value.adoptionStatus,'current');
    if(method==='readMethodFile'){assert.equal(value.parts[0].text,'a'.repeat(4000));assert.ok(value.nextCursor);assert.equal(ok(f.call(method,{...base,cursor:value.nextCursor})).parts[0].start,4000);}
    error(f.call(method,{...base,version:second.version,snapshot:undefined}),'invalid_input');
    const other={...base,version:second.version};delete other.snapshot;error(f.call(method,other),'method_version_unavailable');
  }
});

test('M06 binding changes, absence insertion, access generations and lifecycle revisions stale current snapshots while history pins hold',t=>{
  const {f,first,second}=versions(t);ok(f.call('adoptMethodVersion',adoption(first,'default',{roleId:null})));
  const ctx=context([ns,project]),pin=ok(f.call('resolveMethod',{package:first.package,...ctx})).snapshot;
  const current={version:first.version,intent:'current',context:ctx,snapshot:pin};ok(f.call('getMethodVersion',current));
  ok(f.call('disableMethodBinding',disable(first,'higher',{bindingNamespace:project,readSet:[ns,project]})));
  error(f.call('getMethodVersion',current),'cursor_stale');
  assert.equal(ok(f.call('readMethodFile',{version:first.version,path:'SKILL.md',intent:'history',context:ctx,snapshot:pin})).parts[0].text,'a'.repeat(4000));
  assert.equal(ok(f.call('getMethodVersion',{version:first.version,intent:'history',snapshot:pin})).version.adoptionStatus,'unassessed');
  ok(f.call('adoptMethodVersion',adoption(first,'higher-adopt',{bindingNamespace:project,readSet:[ns,project],expectedRevision:1})));
  const fresh={...current,snapshot:ok(f.call('resolveMethod',{package:first.package,...ctx})).snapshot};
  f.generation(project,2);error(f.call('getMethodVersion',fresh),'cursor_stale');
  ok(f.call('getMethodVersion',{...fresh,intent:'history'}));f.generation(project,1);
  ok(f.call('importMethodVersion',input('third',{package:first.package,expectedPackageRevision:2,basedOn:first.version})));
  error(f.call('getMethodVersion',fresh),'cursor_stale');
  ok(f.call('getMethodVersion',{...fresh,intent:'history'}));
  error(f.call('getMethodVersion',{...fresh,snapshot:pin+'tamper'}),'invalid_input');
  error(f.call('getMethodVersion',{version:second.version,intent:'history',snapshot:pin}),'invalid_input');
});

test('M06/M08 history pins require fresh authority and deleted or unreadable targets return unavailable',t=>{
  const {f,first}=versions(t);ok(f.call('adoptMethodVersion',adoption(first)));
  const snapshot=ok(f.call('resolveMethod',{package:first.package,...context()})).snapshot;
  f.denyRead(ns);error(f.call('getMethodVersion',{...history(first.version),snapshot}),'authority_required');f.denyRead(ns,false);
  const projectContext=context([project]);
  const hidden=ok(f.call('getMethodVersion',{...history(first.version),context:projectContext,snapshot}));assert.equal(hidden.adoptionStatus,'unavailable');
  for(const intent of ['history','current']){
    ok(f.call('getMethodVersion',{version:first.version,intent,context:context(),snapshot}));
  }
  ok(f.call('deleteMethodVersion',{actionId:'purge',ref:first.version,expectedRevision:1}));
  for(const intent of ['history','current'])for(const method of ['getMethodVersion','listMethodManifest','readMethodFile']){
    const result=ok(f.call(method,{version:first.version,intent,context:context(),snapshot,...(method==='readMethodFile'?{path:'SKILL.md'}:{})}));assert.equal(result.adoptionStatus,'unavailable');
  }
});

test('M06 role-list snapshots pin a selected version without retargeting and context cursors stale across either namespace',t=>{
  const {f,first,second}=versions(t);ok(f.call('adoptMethodVersion',adoption(first)));
  const ctx=context([ns,project]),page=ok(f.call('resolveMethodsForRole',ctx));assert.equal(page.methods.length,1);
  ok(f.call('getMethodVersion',{version:first.version,intent:'current',context:ctx,snapshot:page.snapshot}));
  ok(f.call('adoptMethodVersion',adoption(second,'move',{expectedRevision:1})));
  error(f.call('getMethodVersion',{version:first.version,intent:'current',context:ctx,snapshot:page.snapshot}),'cursor_stale');
  assert.equal(ok(f.call('getMethodVersion',{version:first.version,intent:'history',snapshot:page.snapshot})).version.ref.versionId,first.version.versionId);
  const pin=ok(f.call('resolveMethod',{package:first.package,...ctx})).snapshot;
  const request={version:second.version,path:'SKILL.md',intent:'history',context:ctx,snapshot:pin};
  const firstPage=ok(f.call('readMethodFile',request));
  // v2's default short file has no continuation; use v1's long historical pin.
  const long={version:first.version,path:'SKILL.md',intent:'history',context:ctx,snapshot:page.snapshot},part=ok(f.call('readMethodFile',long));
  ok(f.call('disableMethodBinding',disable(first,'project-change',{bindingNamespace:project,readSet:[ns,project]})));
  error(f.call('readMethodFile',{...long,cursor:part.nextCursor}),'cursor_stale');
  assert.ok(firstPage.parts.length);
});

test('M06 current and historical pins survive restart, reject another store, and stale on lower binding transitions',t=>{
  const {f,first}=versions(t);ok(f.call('adoptMethodVersion',adoption(first,'higher',{bindingNamespace:project,readSet:[ns,project]})));
  const ctx=context([ns,project]),resolved=ok(f.call('resolveMethod',{package:first.package,...ctx}));assert.deepEqual(resolved.package,first.package);
  const request={version:first.version,intent:'current',context:ctx,snapshot:resolved.snapshot};
  f.reopen();ok(f.call('getMethodVersion',request));
  const other=bindingFixture(t);error(other.call('getMethodVersion',request),'invalid_input');
  ok(f.call('disableMethodBinding',disable(first,'lower',{roleId:null})));
  error(f.call('getMethodVersion',request),'cursor_stale');
  ok(f.call('getMethodVersion',{...request,intent:'history'}));
  assert.deepEqual(ok(f.call('resolveMethod',{package:first.package,...context([ns],'unused-role')})).package,first.package);
});

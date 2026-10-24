import assert from 'node:assert/strict';
import test from 'node:test';
import { bindingFixture,ns,project,ok,error,input,adoption,disable,context,child,childHost,moduleURL } from '../testing/method-binding-fixtures.mjs';
const rows=(f,table)=>f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();
const state=f=>['method_bindings','method_binding_generations','method_binding_events','method_effects','method_operations','method_epochs'].map(table=>[table,rows(f,table)]);

test('M04/M08 binding CAS, disabled creation, re-adoption, durable events/effects and replay after purge',t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  const barrier=disable(first),disabled=ok(f.call('disableMethodBinding',barrier));
  assert.equal(disabled.binding.type,'method-binding');assert.equal(disabled.binding.roleKey,'reviewer');assert.equal(disabled.binding.revision,1);assert.equal(disabled.version,null);
  assert.equal(ok(f.call('resolveMethod',{...context(),package:first.package})).status,'disabled');
  const initial=state(f);error(f.call('adoptMethodVersion',adoption(first)),'revision_conflict');assert.deepEqual(state(f),initial);
  const adopt=adoption(first,'adopt',{expectedRevision:1}),adopted=ok(f.call('adoptMethodVersion',adopt));
  assert.equal(adopted.binding.revision,2);assert.deepEqual(adopted.version,first.version);
  const newer=ok(f.call('importMethodVersion',input('new',{package:first.package,expectedPackageRevision:1,basedOn:first.version})));
  assert.equal(rows(f,'method_binding_generations')[0].generation,2,'import does not advance bindings');
  assert.deepEqual(ok(f.call('resolveMethod',{...context(),package:first.package})).version,first.version);
  const removed=ok(f.call('deleteMethodPackage',{actionId:'purge',ref:first.package,expectedRevision:2}));assert.equal(removed.effectCount,1);
  assert.equal(ok(f.call('resolveMethod',{...context(),package:first.package})).status,'unavailable');
  assert.equal(rows(f,'method_binding_generations')[0].generation,2);assert.equal(rows(f,'method_binding_events').length,2);
  assert.deepEqual(rows(f,'method_effects').map(row=>row.kind),['binding_changed','binding_changed','method_package_deleted']);
  f.core.close();
  child(`import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    const [path,encoded]=process.argv.slice(1),saved=JSON.parse(encoded),c=openMemoryCore({path,methodPackages:methods});
    try{assert.deepEqual(ok(c.disableMethodBinding(saved.barrier,token)),saved.disabled);assert.deepEqual(ok(c.adoptMethodVersion(saved.adopt,token)),saved.adopted);
    assert.equal(ok(c.resolveMethod(saved.resolve,token)).status,'unavailable');assert.deepEqual(ok(c.listMethodEffects({namespace:saved.ns},token)).effects.map(e=>e.kind),['binding_changed','binding_changed','method_package_deleted']);}finally{c.close();}`,
    [f.path,JSON.stringify({barrier,disabled,adopt,adopted,resolve:{...context(),package:first.package},ns})]);
  f.reopen();assert.deepEqual(ok(f.call('adoptMethodVersion',adopt)),adopted);
  error(f.call('adoptMethodVersion',{...adopt,version:newer.version}),'action_conflict');
  assert.deepEqual(ok(f.call('disableMethodBinding',barrier)),disabled);assert.equal(rows(f,'method_binding_events').length,2);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('M05/M09 project-to-personal adoption requires explicit binding authority, package read and the authorized read set',t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  const cross=adoption(first,'cross',{bindingNamespace:project,readSet:[ns,project]});
  f.denyRead(ns);error(f.call('adoptMethodVersion',cross),'authority_required');assert.equal(rows(f,'method_bindings').length,0);f.denyRead(ns,false);
  f.state.deniedWrites.add(JSON.stringify(project));error(f.call('adoptMethodVersion',cross),'authority_required');f.state.deniedWrites.clear();
  error(f.call('adoptMethodVersion',{...cross,readSet:[project]}),'method_not_found');
  const accepted=ok(f.call('adoptMethodVersion',cross));assert.deepEqual(accepted.binding.bindingNamespace,project);
  const requests=f.state.requests.filter(request=>request.method==='adoptMethodVersion' && request.input.actionId==='cross');
  assert.ok(requests.some(request=>request.actionClass==='explicit-user' && request.namespace.scope==='project'));
  assert.ok(requests.some(request=>request.actionClass==='read' && request.namespace.scope==='personal'));
  assert.ok(requests.every(request=>request.input.readSet.length===2));
  const projectPackage=ok(f.call('importMethodVersion',input('project',{namespace:project})));
  error(f.call('adoptMethodVersion',adoption(projectPackage,'reverse',{readSet:[ns,project]})),'method_not_found');
  error(f.call('disableMethodBinding',disable(first,'other-project',{bindingNamespace:{...project,projectId:'other'},readSet:[ns,project]})),'method_not_found');
});

test('M08/M09 binding reasons belong to binding namespace, need read authority, and recheck canonical state inside the transaction',t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  const note=ok(f.call('submitSourceNote',{namespace:project,actionId:'note',text:'Synthetic binding reason.',occurredAt:null})).source;
  const personal=ok(f.call('submitSourceNote',{namespace:ns,actionId:'personal-note',text:'Synthetic foreign reason.',occurredAt:null})).source;
  const action=adoption(first,'with-reason',{bindingNamespace:project,readSet:[ns,project],reasonRefs:[note]});
  f.denyRead(project);error(f.call('adoptMethodVersion',action),'authority_required');f.denyRead(project,false);
  error(f.call('adoptMethodVersion',{...action,reasonRefs:[personal]}),'method_not_found');
  const adopted=ok(f.call('adoptMethodVersion',action));assert.equal(adopted.binding.revision,1);
  const events=ok(f.call('listMethodBindingEvents',{bindingNamespace:project,package:first.package}));assert.equal(events.events[0].reasonRefs[0].status,'available');
  ok(f.call('deleteSourceNote',{namespace:project,actionId:'delete-note',sourceId:note.sourceId,expectedRevision:note.revision}));
  assert.equal(ok(f.call('listMethodBindingEvents',{bindingNamespace:project})).events[0].reasonRefs[0].status,'unavailable');
  const candidate=disable(first,'bad-reason',{bindingNamespace:project,readSet:[ns,project],expectedRevision:1,reasonRefs:[note]});
  const before=state(f);error(f.call('disableMethodBinding',candidate),'method_not_found');assert.deepEqual(state(f),before);
  const live=ok(f.call('submitSourceNote',{namespace:project,actionId:'live-note',text:'Synthetic final fence.',occurredAt:null})).source;
  f.state.checks=0;f.state.hook=count=>{if(count===6)f.db.prepare("UPDATE card_notes SET state='deleted',text=NULL,byte_count=0 WHERE id=?").run(live.sourceId);};
  error(f.call('disableMethodBinding',{...candidate,reasonRefs:[live]}),'method_not_found');f.state.hook=null;
  assert.equal(rows(f,'method_binding_events').length,1);
  const retained=JSON.stringify([rows(f,'method_binding_events'),rows(f,'method_operations'),rows(f,'method_effects')]);
  assert.ok(!retained.includes('Synthetic binding reason.'));assert.ok(!retained.includes('Synthetic foreign reason.'));
});

test('M10 exact binding cap includes disabled barriers and failures allocate no revisions, generations, events or effects',t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  for(let i=0;i<1024;i++)ok(f.call('disableMethodBinding',disable(first,'barrier-'+i,{roleId:'r'+i})));
  assert.equal(rows(f,'method_bindings').length,1024);assert.equal(rows(f,'method_binding_generations')[0].generation,1024);
  const before=state(f);error(f.call('disableMethodBinding',disable(first,'over',{roleId:'over'})),'package_limit_reached');assert.deepEqual(state(f),before);
  const existing=adoption(first,'existing',{roleId:'r0',expectedRevision:1});assert.equal(ok(f.call('adoptMethodVersion',existing)).binding.revision,2);
  assert.equal(rows(f,'method_binding_generations')[0].generation,1025);
  for(const roleId of ['',undefined,'*','two words','é','a'.repeat(201)])error(f.call('disableMethodBinding',disable(first,'invalid',{roleId})),'invalid_input');
  for(const expectedRevision of [undefined,0,-1,1.1,NaN])error(f.call('disableMethodBinding',disable(first,'invalid',{expectedRevision})),'invalid_input');
  ok(f.call('disableMethodBinding',disable(first,'max-role',{roleId:'r0',expectedRevision:2})));
});

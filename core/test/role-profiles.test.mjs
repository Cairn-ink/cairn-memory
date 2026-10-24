import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture,host,ns,project,publish,read,ok } from './role-fixture.mjs';

const action=(value,actionId)=>({namespace:value.registry.namespace,roleKey:value.registry.roleKey,actionId,expectedCurrentRelease:value.registry.currentRelease,expectedRegistryRevision:value.registry.revision});
test('C01 direct attributed three-role releases survive restart; closed fields are required',t=>{
  const f=fixture(t);
  for(const role of ['COO','CTO','finance']){
    const input=publish(ns,role,role),value=ok(f.call('publishRoleProfileRelease',input));
    assert.equal(value.registry.revision,1);assert.equal(value.ordinal,1);
    f.reopen();const result=ok(f.call('readRoleTaskContext',read(role))).metered;
    assert.equal(result.profile.applicability,'current');assert.deepEqual(result.profile.release.fields,{duties:input.fields.duties,requiredOutputs:input.fields.requiredOutputs,methods:[],related:[],appliesTo:null});
    assert.equal(result.profile.release.actorId,'actor');assert.equal(result.profile.release.agentId,'agent');
  }
  for(const fields of [{duties:['a']},{requiredOutputs:['b']},{duties:[],requiredOutputs:['b']},{duties:['a'],requiredOutputs:['b'],unknown:true}])assert.equal(f.call('publishRoleProfileRelease',publish(ns,'invalid','bad',null,null,fields)).error.code,'invalid_input');
  const r=f.h.requests.find(r=>r.method==='publishRoleProfileRelease');assert.equal(r.actionClass,'write');assert.equal(r.targetId,'COO');assert.equal(r.expectedRevision,null);assert.deepEqual(r.input.attribution,{actorId:'actor',agentId:'agent'});
});
test('C01/C04 dual CAS, disabled/no-release barriers, restore, replay after purge and exact quota accounting',t=>{
  const f=fixture(t),input=publish(),first=ok(f.call('publishRoleProfileRelease',input));
  const second=ok(f.call('publishRoleProfileRelease',{...publish(ns,'finance','second',first.release,1),changeReason:{text:'Updated review'}}));
  const db=new DatabaseSync(f.path);t.after(()=>db.close());
  const charges=()=>db.prepare('SELECT byte_count FROM role_profile_owner_usage').get().byte_count;
  assert.equal(charges(),db.prepare('SELECT sum(byte_count) n FROM role_profile_releases').get().n+db.prepare('SELECT sum(byte_count) n FROM role_profile_changes').get().n);
  assert.equal(f.call('disableRoleProfile',{...action(second,'bad'),expectedCurrentRelease:first.release}).error.code,'revision_conflict');
  const disabled=ok(f.call('disableRoleProfile',action(second,'disable')));assert.equal(disabled.registry.revision,3);
  const barrier=ok(f.call('disableRoleProfile',{namespace:project,roleKey:'finance',actionId:'barrier',expectedCurrentRelease:null,expectedRegistryRevision:null}));assert.equal(barrier.registry.revision,1);assert.equal(barrier.registry.currentRelease,null);
  const blocked=ok(f.call('readRoleTaskContext',read('finance',[ns,project]))).metered;assert.equal(blocked.profile.applicability,'withdrawn');assert.equal(blocked.registries.length,1);
  const restored=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','restore',second.release,3)));assert.equal(restored.ordinal,3);
  const history=ok(f.call('readRoleTaskContext',{...read(),history:{profile:first.release.profile}})).metered.history;assert.equal(history.rows.length,3);
  const before=charges();const removed=ok(f.call('deleteRoleProfileRelease',{...action(restored,'delete-first'),release:first.release,expectedRevision:1}));assert.equal(removed.registry.revision,5);assert.equal(before-charges(),removed.purgedBytes);
  assert.equal(db.prepare('SELECT payload FROM role_profile_changes WHERE to_id=?').get(second.release.releaseId).payload,null);
  const count=db.prepare('SELECT count(*) n FROM role_profile_events').get().n,usage=charges();
  assert.deepEqual(ok(f.call('publishRoleProfileRelease',input)),first);assert.equal(charges(),usage);assert.equal(db.prepare('SELECT count(*) n FROM role_profile_events').get().n,count);
  assert.equal(f.call('publishRoleProfileRelease',{...input,fields:{duties:['different'],requiredOutputs:['x']}}).error.code,'action_conflict');
  const currentDeleted=ok(f.call('deleteRoleProfileRelease',{...action(removed,'delete-current'),release:restored.release,expectedRevision:1}));
  assert.deepEqual(currentDeleted.registry.currentRelease,restored.release);assert.equal(ok(f.call('readRoleTaskContext',read())).metered.profile.applicability,'unavailable');
  f.reopen();assert.equal(ok(f.call('readRoleTaskContext',{...read(),history:{profile:first.release.profile}})).metered.history.rows.find(r=>r.ref.releaseId===first.release.releaseId).fields,null);
});
test('C01 foreign namespace authority is checked before content and supplemental reason grants bind null scalars',t=>{
  const h=host({allow:r=>r.namespace.ownerId==='owner'&&r.namespace.projectId!=='foreign'}),f=fixture(t,{h});
  assert.equal(f.call('publishRoleProfileRelease',publish({...ns,ownerId:'foreign'})).error.code,'authority_required');
  assert.equal(f.call('readRoleTaskContext',read('finance',[{...project,projectId:'foreign'}])).error.code,'authority_required');
  const note=ok(f.call('admit',{namespace:ns,memory:{kind:'fact',content:'Synthetic source'},receipts:[{client:'test',sessionId:'s',eventId:'e',role:'user',excerpt:'Synthetic source'}]}));
  const ref={type:'memory',namespace:ns,memoryId:note.memory.id,revision:1};
  ok(f.call('publishRoleProfileRelease',{...publish(),changeReason:{text:'Explicit reason',reasonRefs:[ref]}}));
  const request=h.requests.find(r=>r.method==='publishRoleProfileRelease'&&r.actionClass==='read');assert.equal(request.actionId,null);assert.equal(request.targetId,null);assert.equal(request.expectedRevision,null);
});
test('C01/C03 closed pre/post bounds, exact role keys, related refs and revision grammar',t=>{
 const f=fixture(t);
 const invalid=[{duties:['d'],requiredOutputs:['r'],methods:null},{duties:['d'],requiredOutputs:['r'],related:null},{duties:['x'.repeat(301)],requiredOutputs:['r']},{duties:Array(9).fill('d'),requiredOutputs:['r']},{duties:[' '],requiredOutputs:['r']},{duties:['\uD800'],requiredOutputs:['r']},{duties:['a\0b'],requiredOutputs:['r']},{duties:['d'],requiredOutputs:['r'],appliesTo:null},{duties:['d'],requiredOutputs:['r'],appliesTo:'x'.repeat(501)}];
 for(const fields of invalid)assert.equal(f.call('publishRoleProfileRelease',publish(ns,'finance','invalid',null,null,fields)).error.code,'invalid_input');
 for(const role of ['*','',null,'with space'])assert.equal(f.call('publishRoleProfileRelease',publish(ns,role)).error.code,'invalid_input');
 for(const revision of [0,-1,1.5,Number.MAX_SAFE_INTEGER+1])assert.equal(f.call('publishRoleProfileRelease',publish(ns,'finance','invalid',null,revision)).error.code,'invalid_input');
 const first=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','boundary',null,null,{duties:Array(8).fill('d'.repeat(300)),requiredOutputs:Array(8).fill('r'.repeat(300)),appliesTo:'a'.repeat(500)})));
 assert.equal(first.registry.revision,1);
 for(const patch of [{budget:{maxTokens:null}},{budget:{maxItems:null}},{deadlineMs:null}])assert.equal(f.call('readRoleTaskContext',{...read(),...patch}).error.code,'invalid_input');
 assert.equal(f.call('readRoleTaskContext',{...read(),history:{profile:first.release.profile,limit:21}}).error.code,'invalid_input');
 assert.equal(f.call('publishRoleProfileRelease',{...publish(ns,'finance','extra',first.release,1),extra:true}).error.code,'invalid_input');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {bindingFixture,ns,project,ok,error} from '../testing/method-binding-fixtures.mjs';

test('H04 reason preparation is read-only, availability-only, bounded and uses canonical revisions',t=>{
  const f=bindingFixture(t),limits=ok(f.core.getMethodPackageCapabilities()).limits;
  assert.equal(limits.files,256);assert.equal(limits.fileUnits,400000);assert.equal(limits.versionUnits,4000000);
  const refs=Array.from({length:16},(_,i)=>ok(f.call('submitSourceNote',{
    namespace:ns,actionId:'note-'+i,text:'Private synthetic reason prose '+i,occurredAt:null})).source);
  const args={namespace:ns,reasonRefs:refs};
  const before=['method_operations','method_effects','method_packages'].map(table=>f.db.prepare('SELECT * FROM '+table).all());
  const result=ok(f.call('checkMethodReasonRefs',args));
  assert.deepEqual(result.reasonRefs,refs.map(ref=>({ref,status:'available'})));
  assert.ok(!JSON.stringify(result).includes('Private synthetic reason prose'));
  assert.deepEqual(ok(f.call('checkMethodReasonRefs',{...args,reasonRefs:[]})),{reasonRefs:[]});
  error(f.call('checkMethodReasonRefs',{...args,reasonRefs:[...refs,refs[0]]}),'invalid_input');
  error(f.call('checkMethodReasonRefs',{...args,reasonRefs:[refs[0],refs[0]]}),'invalid_input');
  const changed={...refs[0],revision:refs[0].revision+1};
  assert.equal(ok(f.call('checkMethodReasonRefs',{...args,reasonRefs:[changed]})).reasonRefs[0].status,'unavailable');
  assert.deepEqual(['method_operations','method_effects','method_packages'].map(table=>f.db.prepare('SELECT * FROM '+table).all()),before);
});

test('H04 preparation grants never become mutation authority; foreign namespaces authorize before canonical validation',t=>{
  const f=bindingFixture(t),args={namespace:ns,reasonRefs:[]};
  error(f.core.checkMethodReasonRefs(args),'authority_required');error(f.core.checkMethodReasonRefs(args,{}),'authority_required');
  for(const classes of [['explicit-user'],['draft'],['capture'],['organization']]){
    f.trusted.state.classes=classes;error(f.call('checkMethodReasonRefs',args),'authority_required');
  }
  f.trusted.state.classes=['read'];ok(f.call('checkMethodReasonRefs',args));f.trusted.state.classes=null;
  const malformed={namespace:project,type:'malformed'};
  f.denyRead(project);error(f.call('checkMethodReasonRefs',{...args,reasonRefs:[malformed]}),'authority_required');
  f.denyRead(project,false);error(f.call('checkMethodReasonRefs',{...args,reasonRefs:[malformed]}),'method_not_found');
  f.denyRead(ns);error(f.call('checkMethodReasonRefs',args),'authority_required');
});

test('H04 preparation uses eligible current memory revisions rather than existence',t=>{
  const f=bindingFixture(t),memory=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic memory reason',kind:'fact'},
    receipts:[{client:'synthetic',sessionId:'synthetic',eventId:'reason',role:'user',excerpt:'Synthetic memory reason'}]})).memory;
  const ref={type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision},args={namespace:ns,reasonRefs:[ref]};
  assert.equal(ok(f.call('checkMethodReasonRefs',args)).reasonRefs[0].status,'available');
  ok(f.core.correct({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,content:'Synthetic replacement',kind:'fact',
    receipt:{client:'synthetic',sessionId:'synthetic',eventId:'correct',role:'user',excerpt:'Synthetic replacement'}}));
  assert.equal(ok(f.call('checkMethodReasonRefs',args)).reasonRefs[0].status,'unavailable');
  assert.ok(f.db.prepare('SELECT id FROM memories WHERE id=?').get(memory.id),'existence alone is insufficient');
});

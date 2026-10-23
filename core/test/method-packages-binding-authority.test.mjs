import assert from 'node:assert/strict';
import test from 'node:test';
import {bindingFixture,ns,project,ok,error,input,adoption,disable,context} from '../testing/method-binding-fixtures.mjs';
const methods=receipt=>({adoptMethodVersion:adoption(receipt),disableMethodBinding:disable(receipt),
  resolveMethod:{package:receipt.package,...context()},resolveMethodsForRole:context(),listMethodBindingEvents:{bindingNamespace:ns}});

test('M09 all U2b methods reject missing, forged, wrong-scope, revoked, generation-changed and capture-only authority',t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  for(const [method,args] of Object.entries(methods(first))){
    error(f.core[method](args),'authority_required');error(f.core[method](args,{}),'authority_required');
    f.trusted.state.wrongScope=true;error(f.call(method,args),'authority_required');f.trusted.state.wrongScope=false;
    for(const classes of [['capture'],['draft'],['organization']]){f.trusted.state.classes=classes;error(f.call(method,args),'authority_required');}f.trusted.state.classes=null;
    const final=method==='adoptMethodVersion'||method==='disableMethodBinding'?3:2;
    f.state.checks=0;f.state.hook=count=>{if(count===final)f.generation(ns,2);};error(f.call(method,args),'scope_changed');f.state.hook=null;f.generation(ns,1);
    f.state.checks=0;f.state.hook=count=>{if(count===final)f.trusted.state.enabled=false;};error(f.call(method,args),'scope_changed');f.state.hook=null;f.trusted.state.enabled=true;
  }
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_bindings').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM method_operations').get().n,1);
});

test('M09 both namespaces are fenced again before resolution and mutations; read and mutation classes remain separate',t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  const action=adoption(first,'cross',{bindingNamespace:project,readSet:[ns,project]});
  f.trusted.state.classes=['explicit-user'];error(f.call('adoptMethodVersion',action),'authority_required');f.trusted.state.classes=['read'];error(f.call('adoptMethodVersion',action),'authority_required');f.trusted.state.classes=null;
  ok(f.call('adoptMethodVersion',action));
  for(const method of ['resolveMethod','resolveMethodsForRole']){
    f.state.checks=0;f.state.hook=(count,request)=>{if(count===4)f.generation(project,2);};
    error(f.call(method,{...context([ns,project]),...(method==='resolveMethod'?{package:first.package}:{})}),'scope_changed');f.state.hook=null;f.generation(project,1);
  }
});

test('M10 new inputs reject getters, proxies, forged approval flags and unbounded contexts without invoking caller code',t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));let invoked=0;
  for(const [method,args] of Object.entries(methods(first))){
    const candidate={...args};Object.defineProperty(candidate,'roleId',{enumerable:true,get(){invoked++;throw Error('synthetic_secret');}});
    error(f.core[method](candidate,{}),'invalid_input');error(f.core[method](new Proxy(args,{ownKeys(){invoked++;return [];}}),{}),'invalid_input');
    error(f.call(method,{...args,humanConfirmed:true}),'invalid_input');
  }
  assert.equal(invoked,0);
  for(const reasonRefs of [null,[null],Array(17).fill({namespace:ns}),[{}]])error(f.call('adoptMethodVersion',{...adoption(first),reasonRefs}),'invalid_input');
  for(const snapshot of ['',null,'x'.repeat(65537)])error(f.call('getMethodVersion',{version:first.version,intent:'history',snapshot}),'invalid_input');
  for(const roleId of ['',undefined,'*','x'.repeat(201),'bad/role','é'])error(f.call('resolveMethod',{readSet:[ns],roleId,package:first.package}),'invalid_input');
  const maximal=ok(f.call('disableMethodBinding',disable(first,'max-role',{roleId:'r'.repeat(200)})));assert.equal(maximal.binding.roleKey.length,200);
});

test('M10 binding event failure rolls back every row and unexpected exceptions contain no submitted prose',t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  f.db.exec("CREATE TRIGGER fail_binding_event BEFORE INSERT ON method_binding_events BEGIN SELECT RAISE(ABORT,'synthetic_private_failure'); END");
  const candidate=adoption(first);
  error(f.call('adoptMethodVersion',candidate),'storage_error');
  for(const table of ['method_bindings','method_binding_generations','method_binding_events','method_effects'])assert.equal(f.db.prepare('SELECT count(*) n FROM '+table).get().n,0,table);
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_operations').get().n,1);
  f.db.exec('DROP TRIGGER fail_binding_event');assert.equal(ok(f.call('adoptMethodVersion',candidate)).binding.revision,1);
  f.state.checks=0;f.state.hook=()=>{throw Error('synthetic_private_callback');};
  error(f.call('resolveMethod',{package:first.package,...context()}),'storage_error');f.state.hook=null;
});

test('M10 adoption, resolution, pin and event delivery never access package files, network, models or execution',async t=>{
  const {default:fs}=await import('node:fs'),{syncBuiltinESMExports}=await import('node:module');
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  const saved=new Map(),fetch=globalThis.fetch;let calls=0;
  const trap=()=>{calls++;throw Error('unexpected_package_access');};
  for(const name of ['readFileSync','writeFileSync','openSync','readdirSync','statSync','lstatSync']){saved.set(name,fs[name]);fs[name]=trap;}
  globalThis.fetch=trap;syncBuiltinESMExports();
  try{
    ok(f.call('adoptMethodVersion',adoption(first)));
    const resolved=ok(f.call('resolveMethod',{package:first.package,...context()}));
    ok(f.call('readMethodFile',{version:first.version,path:'SKILL.md',intent:'current',context:context(),snapshot:resolved.snapshot}));
    ok(f.call('resolveMethodsForRole',context()));ok(f.call('listMethodBindingEvents',{bindingNamespace:ns}));
    ok(f.call('disableMethodBinding',disable(first,'disable',{expectedRevision:1})));
    assert.equal(calls,0);
  }finally{for(const [name,original]of saved)fs[name]=original;globalThis.fetch=fetch;syncBuiltinESMExports();}
});

test('M09 scoped MCP host opts into the new reads explicitly and cannot mint binding mutations or cross-scope reads',async t=>{
  const {createScopedCardAccess}=await import('../../adapters/mcp/private-card-access.mjs');
  const {openMemoryCore}=await import('../contract.mjs');
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));ok(f.call('adoptMethodVersion',adoption(first)));
  const selected=createScopedCardAccess(ns,{methodPackages:true});
  const core=openMemoryCore({path:f.path,methodPackages:selected.methodPackageConfiguration});f.workspace.defer(()=>core.close());
  assert.equal(ok(selected.call(core,'resolveMethod',{package:first.package,...context()})).status,'current');
  assert.equal(ok(selected.call(core,'resolveMethodsForRole',context())).methods.length,1);
  assert.equal(ok(selected.call(core,'listMethodBindingEvents',{bindingNamespace:ns})).events.length,1);
  error(selected.call(core,'adoptMethodVersion',adoption(first,'denied',{expectedRevision:1})),'authority_required');
  error(selected.call(core,'disableMethodBinding',disable(first,'denied-disable',{expectedRevision:1})),'authority_required');
  error(selected.call(core,'resolveMethod',{package:first.package,...context([ns,project])}),'authority_required');
  selected.revoke();error(selected.call(core,'resolveMethodsForRole',context()),'authority_required');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {race} from '../testing/method-binding-race.mjs';
import {bindingFixture,ns,ok,error,input,adoption,context,child,childHost,moduleURL} from '../testing/method-binding-fixtures.mjs';
const rows=(f,table)=>f.db.prepare('SELECT * FROM '+table+' ORDER BY rowid').all();
function replay(f,operations,results) {
  child(`import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    const [path,actions,encoded]=process.argv.slice(1),core=openMemoryCore({path,methodPackages:methods});
    try{assert.deepEqual(JSON.parse(actions).map(({method,input})=>core[method](input,token)),JSON.parse(encoded));}finally{core.close();}`,[f.path,JSON.stringify(operations),JSON.stringify(results)]);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
}

test('M04 concurrent adopt/adopt of the same binding has one CAS winner and durable exactly-once events',{timeout:30000},async t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input())),second=ok(f.call('importMethodVersion',input('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version})));
  const operations=[first,second].map((receipt,i)=>({method:'adoptMethodVersion',input:adoption(receipt,'race-adopt-'+i)}));
  const results=await race(f,operations),winner=results.findIndex(result=>result.ok);assert.ok(winner>=0);error(results[1-winner],'revision_conflict');
  assert.equal(rows(f,'method_bindings').length,1);assert.equal(rows(f,'method_bindings')[0].revision,1);
  assert.equal(rows(f,'method_binding_generations')[0].generation,1);assert.equal(rows(f,'method_binding_events').length,1);assert.equal(rows(f,'method_effects').length,1);
  assert.deepEqual(ok(f.call('resolveMethod',{...context(),package:first.package})).version,results[winner].value.version);
  const before=rows(f,'method_operations');replay(f,operations,results);assert.deepEqual(rows(f,'method_operations'),before);
  assert.equal(rows(f,'method_packages')[0].revision,2);assert.equal(rows(f,'method_versions').length,2);
});

for(const kind of ['Version','Package'])test(`M04/M08 concurrent adopt/deleteMethod${kind} validates lifecycle and preserves deletion barriers`,{timeout:30000},async t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  const operations=[{method:'adoptMethodVersion',input:adoption(first,'racing-adopt')},{method:'deleteMethod'+kind,input:{actionId:'racing-delete',ref:kind==='Version'?first.version:first.package,expectedRevision:1}}];
  const results=await race(f,operations);ok(results[1]);if(!results[0].ok)error(results[0],'method_version_unavailable');
  const adopted=Number(results[0].ok);assert.equal(rows(f,'method_bindings').length,adopted);assert.equal(rows(f,'method_binding_events').length,adopted);
  assert.equal(rows(f,'method_binding_generations')[0]?.generation??0,adopted);
  const resolved=ok(f.call('resolveMethod',{...context(),package:first.package}));assert.equal(resolved.status,adopted?'unavailable':'no-active-version');
  assert.equal(rows(f,'method_files').length,0);assert.equal(rows(f,'method_owner_usage')[0].byte_count,0);
  assert.equal(rows(f,'method_effects').length,1+adopted);assert.equal(rows(f,'method_effects').at(-1).kind,'method_'+kind.toLowerCase()+'_deleted');
  assert.ok(!rows(f,'method_effects').some(row=>row.kind==='binding_unavailable'));
  const before=['method_bindings','method_binding_generations','method_binding_events','method_effects','method_operations'].map(table=>[table,rows(f,table)]);
  replay(f,operations,results);assert.deepEqual(['method_bindings','method_binding_generations','method_binding_events','method_effects','method_operations'].map(table=>[table,rows(f,table)]),before);
});

test('M04 concurrent import/adopt keeps adoption pinned to the explicitly selected immutable version',{timeout:30000},async t=>{
  const f=bindingFixture(t),first=ok(f.call('importMethodVersion',input()));
  const operations=[{method:'importMethodVersion',input:input('racing-import',{package:first.package,expectedPackageRevision:1,basedOn:first.version})},{method:'adoptMethodVersion',input:adoption(first,'racing-adopt')}];
  const results=await race(f,operations);results.forEach(ok);
  assert.equal(results[0].value.ordinal,2);assert.deepEqual(results[1].value.version,first.version);
  assert.deepEqual(ok(f.call('resolveMethod',{...context(),package:first.package})).version,first.version);
  assert.equal(rows(f,'method_packages')[0].revision,2);assert.equal(rows(f,'method_packages')[0].next_ordinal,3);
  assert.equal(rows(f,'method_versions').length,2);assert.equal(rows(f,'method_operations').length,3);assert.equal(rows(f,'method_binding_events').length,1);assert.equal(rows(f,'method_binding_generations')[0].generation,1);
  replay(f,operations,results);assert.equal(rows(f,'method_effects').length,1);
});

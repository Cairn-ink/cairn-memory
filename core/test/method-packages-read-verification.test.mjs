import assert from 'node:assert/strict';
import test from 'node:test';
import {DatabaseSync} from 'node:sqlite';
import {bindingFixture,ns,ok,error,input,file,adoption,context} from '../testing/method-binding-fixtures.mjs';

function setup(t){const f=bindingFixture(t),receipt=ok(f.call('importMethodVersion',input('two-files',{files:[file('A','alpha'),file('B','beta')]})));
  ok(f.call('adoptMethodVersion',adoption(receipt)));
  const reason=ok(f.call('submitSourceNote',{namespace:ns,actionId:'unrelated-reason',text:'Synthetic retained reason',occurredAt:null})).source;
  return {f,receipt,reason};}
const read=(receipt,path,contextual=false)=>({version:receipt.version,intent:contextual?'current':'history',path,...(contextual?{context:context()}:{})});

test('C03 text corruption is isolated to the requested file; whole-version views still refuse and resolution uses metadata',t=>{
  const {f,receipt}=setup(t);
  f.db.prepare('UPDATE method_files SET text=? WHERE version_id=? AND path=?').run('out-of-band corruption',receipt.version.versionId,'A');
  for(const contextual of [false,true]){
    error(f.call('readMethodFile',read(receipt,'A',contextual)),'method_version_unavailable');
    const unaffected=ok(f.call('readMethodFile',read(receipt,'B',contextual)));
    assert.equal(unaffected.parts[0].text,'beta');assert.equal(unaffected.adoptionStatus,contextual?'current':'unassessed');
  }
  for(const method of ['getMethodVersion','listMethodManifest'])error(f.call(method,{version:receipt.version,intent:'history'}),'method_version_unavailable');
  error(f.call('compareMethodVersions',{from:receipt.version,to:receipt.version}),'method_version_unavailable');
  assert.equal(ok(f.call('resolveMethod',{package:receipt.package,...context()})).status,'current');
  assert.equal(ok(f.call('resolveMethodsForRole',context())).methods[0].status,'current');
});

for(const column of ['content_identity','path','media_type','manifest_identity'])test(`C03 ${column} corruption refuses affected verifiers and resolution, while unrelated reads stay available`,t=>{
  const {f,receipt,reason}=setup(t),other=ok(f.call('importMethodVersion',input('other',{files:[file('other','unrelated')]})));
  f.db.exec('PRAGMA foreign_keys=OFF'); // Deliberate out-of-band corruption, beyond supported in-band writers.
  if(column==='manifest_identity')f.db.prepare('UPDATE method_versions SET manifest_identity=? WHERE id=?').run('x'.repeat(43),receipt.version.versionId);
  else f.db.prepare('UPDATE method_files SET '+column+'=? WHERE version_id=? AND path=?')
    .run(column==='content_identity'?'x'.repeat(43):column==='path'?'changed-path':'application/json',receipt.version.versionId,'A');
  for(const path of ['A','B'])error(f.call('readMethodFile',read(receipt,path)),'method_version_unavailable');
  for(const method of ['getMethodVersion','listMethodManifest'])error(f.call(method,{version:receipt.version,intent:'history'}),'method_version_unavailable');
  error(f.call('compareMethodVersions',{from:receipt.version,to:receipt.version}),'method_version_unavailable');
  error(f.call('resolveMethod',{package:receipt.package,...context()}),'method_version_unavailable');
  error(f.call('resolveMethodsForRole',context()),'method_version_unavailable');
  assert.equal(ok(f.call('readMethodFile',{version:other.version,intent:'history',path:'other'})).parts[0].text,'unrelated');
  assert.equal(ok(f.call('listMethodPackages',{namespace:ns})).packages.length,2);
  assert.equal(ok(f.call('listMethodVersions',{package:receipt.package})).versions.length,1);
  assert.ok(ok(f.call('getMethodPackageUsage',{namespace:ns})).retainedFileBytes>0);
  assert.equal(ok(f.call('listMethodEffects',{namespace:ns})).effects.length,1);
  assert.deepEqual(ok(f.call('checkMethodReasonRefs',{namespace:ns,reasonRefs:[reason]})),{reasonRefs:[{ref:reason,status:'available'}]});
});

test('C03 requested-file byte counts are verified without reading another file text',t=>{
  const {f,receipt}=setup(t);
  f.db.prepare('UPDATE method_files SET byte_count=99 WHERE version_id=? AND path=?').run(receipt.version.versionId,'A');
  error(f.call('readMethodFile',read(receipt,'A')),'method_version_unavailable');
  assert.equal(ok(f.call('readMethodFile',read(receipt,'B'))).parts[0].text,'beta');
  error(f.call('getMethodVersion',{version:receipt.version,intent:'history'}),'method_version_unavailable');
});

test('C03 file/current/resolution paths select metadata and exactly one requested text, without wildcard text projections',t=>{
  const {f,receipt}=setup(t),prepare=DatabaseSync.prototype.prepare,statements=[];
  const mock=t.mock.method(DatabaseSync.prototype,'prepare',function(sql){if(/\bmethod_files\b/.test(sql))statements.push(sql);return prepare.call(this,sql);});
  for(const method of ['resolveMethod','resolveMethodsForRole']){
    statements.length=0;ok(f.call(method,{...context(),...(method==='resolveMethod'?{package:receipt.package}:{})}));
    assert.ok(statements.length>0);assert.ok(statements.every(sql=>!/(?:\*|\btext\b)/.test(sql)),statements.join('\n'));
  }
  statements.length=0;ok(f.call('readMethodFile',read(receipt,'B',true)));
  assert.equal(statements.filter(sql=>/\btext\b/.test(sql)).length,1);
  assert.ok(statements.every(sql=>!sql.includes('*')));assert.match(statements.find(sql=>/\btext\b/.test(sql)),/WHERE version_id=\? AND path=\?/);
  for(const method of ['getMethodVersion','listMethodManifest','compareMethodVersions']){
    statements.length=0;ok(f.call(method,method==='compareMethodVersions'?{from:receipt.version,to:receipt.version}:{version:receipt.version,intent:'history'}));
    assert.ok(statements.some(sql=>/\btext\b/.test(sql)&&!sql.includes('AND path=')),method+' retains whole-version verification');
  }
  mock.mock.restore();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture,ns,project,foreign,input,pdf,ok,error,collect,corrupt } from '../testing/asset-fixtures.mjs';

test('K07 selected chunks authenticate exact metadata and total; unrelated chunk corruption does not widen verification',t=>{
  const f=fixture(t),original=pdf(65537),saved=ok(f.call('importAssetVersion',input('chunks',{bytes:original}))),version=saved.version;
  const first=ok(f.call('readAssetBytes',{version}));assert.equal(first.byteCount,32768);assert.equal(first.complete,false);
  const object=f.db.prepare('SELECT object_id FROM asset_versions WHERE id=?').get(version.versionId).object_id;
  corrupt(f.db,'binary_chunk_immutable','UPDATE binary_chunks SET bytes=? WHERE object_id=? AND chunk_index=1',Buffer.alloc(32768),object);
  assert.deepEqual(Buffer.from(ok(f.call('readAssetBytes',{version})).bytes,'base64'),original.subarray(0,32768));
  error(f.call('readAssetBytes',{version,cursor:first.nextCursor}),'asset_version_unavailable');
  corrupt(f.db,'binary_chunk_immutable','UPDATE binary_chunks SET bytes=? WHERE object_id=? AND chunk_index=1',original.subarray(32768,65536),object);
  const second=ok(f.call('readAssetBytes',{version,cursor:first.nextCursor}));assert.equal(second.complete,false);
  f.db.prepare('DELETE FROM binary_chunks WHERE object_id=? AND chunk_index=2').run(object);
  error(f.call('readAssetBytes',{version,cursor:second.nextCursor}),'asset_version_unavailable');
});
for(const count of [32768,65538])test(`K07 changing authenticated total to ${count} cannot truncate or extend completion`,t=>{
  const f=fixture(t),receipt=ok(f.call('importAssetVersion',input('counts',{bytes:pdf(65537)}))),id=receipt.version.versionId;
  corrupt(f.db,'asset_version_immutable','UPDATE asset_versions SET byte_count=? WHERE id=?',count,id);
  corrupt(f.db,'binary_object_immutable','UPDATE binary_objects SET byte_count=? WHERE asset_version_id=?',count,id);
  error(f.call('readAssetBytes',{version:receipt.version}),'asset_version_unavailable');
});
test('K07 cursors bind store, namespace, exact identity/version, method, and fresh access generations before lookup',t=>{
  const f=fixture(t),first=ok(f.call('importAssetVersion',input('first',{bytes:pdf(40000)}))),second=ok(f.call('importAssetVersion',input('second',{bytes:pdf(40000)})));
  const cursor=ok(f.call('readAssetBytes',{version:first.version})).nextCursor;
  const reordered={contentIdentity:first.version.contentIdentity,versionId:first.version.versionId,assetId:first.version.assetId,namespace:{projectId:null,scope:ns.scope,ownerId:ns.ownerId},type:'asset-version'};
  assert.equal(ok(f.call('readAssetBytes',{cursor,version:reordered})).complete,true);
  for(const version of [second.version,{...first.version,versionId:'missing'},{...first.version,contentIdentity:'x'.repeat(43)}])error(f.call('readAssetBytes',{version,cursor}),'invalid_cursor');
  error(f.call('readAssetBytes',{version:first.version,cursor:cursor+'x'}),'invalid_cursor');
  const v={...first.version,namespace:project};error(f.call('readAssetBytes',{version:v,cursor}),'invalid_cursor');
  const other=fixture(t);error(other.call('readAssetBytes',{version:first.version,cursor}),'invalid_cursor');
  f.trusted.state.generation++;error(f.call('readAssetBytes',{version:first.version,cursor}),'invalid_cursor');
  f.trusted.state.enabled=false;error(f.call('readAssetBytes',{version:first.version,cursor}),'authority_required');
});
test('K07 valid deleted-target continuation is unavailable before epoch/revision staleness; malformed cursor still refuses first',t=>{
  const f=fixture(t),first=ok(f.call('importAssetVersion',input('first',{bytes:pdf(40000)}))),version=first.version;
  const cursor=ok(f.call('readAssetBytes',{version})).nextCursor;
  ok(f.call('deleteAssetVersion',{actionId:'delete',ref:version,expectedRevision:1}));
  assert.deepEqual(ok(f.call('readAssetBytes',{version,cursor})),{status:'unavailable'});
  assert.deepEqual(ok(f.call('readAssetBytes',{version})),{status:'unavailable'});
  error(f.call('readAssetBytes',{version,cursor:cursor+'changed'}),'invalid_cursor');
  error(f.call('verifyAssetBytes',{version,bytes:pdf()}),'asset_version_unavailable');
});
test('K07 asset lists use envelope-byte pagination, deterministic ordinals/order and mutation/access-bound cursors',t=>{
  const f=fixture(t),saved=[];
  for(let i=0;i<24;i++)saved.push(ok(f.call('importAssetVersion',input('asset-'+i))));
  const first=ok(f.call('listAssets',{namespace:ns,limit:7}));assert.equal(first.assets.length,7);
  const all=collect(f,'listAssets',{namespace:ns,limit:7},'assets');assert.equal(all.length,24);
  assert.deepEqual(all.map(a=>a.ref.assetId),all.map(a=>a.ref.assetId).sort());
  error(f.call('listAssetEffects',{namespace:ns,limit:7,cursor:first.nextCursor}),'invalid_cursor');
  error(f.call('listAssets',{namespace:ns,limit:8,cursor:first.nextCursor}),'invalid_cursor');
  const effects=collect(f,'listAssetEffects',{namespace:ns,limit:3},'effects');assert.deepEqual(effects.map(e=>e.ordinal),Array.from({length:24},(_,i)=>i+1));
  ok(f.call('importAssetVersion',input('change')));error(f.call('listAssets',{namespace:ns,limit:7,cursor:first.nextCursor}),'cursor_stale');
});
test('K07 asset-specific explicit-user grants exclude capture consent and all stale/forged/wrong-namespace authority',t=>{
  const f=fixture(t),value=input();error(f.core.importAssetVersion(value),'authority_required');error(f.core.importAssetVersion(value,{}),'authority_required');
  f.trusted.state.allowAssets=false;error(f.call('importAssetVersion',value),'authority_required');f.trusted.state.allowAssets=true;
  f.trusted.state.classes=['capture'];error(f.call('importAssetVersion',value),'authority_required');f.trusted.state.classes=['read'];error(f.call('importAssetVersion',value),'authority_required');
  f.trusted.state.classes=null;f.trusted.state.wrongScope=true;error(f.call('importAssetVersion',value),'authority_required');f.trusted.state.wrongScope=false;
  // Use an exact second-check revocation rather than relying on prior call counts.
  const at=f.trusted.state.checks;f.trusted.state.hook=checks=>{if(checks===at+2)f.trusted.state.generation++;};
  error(f.call('importAssetVersion',value),'scope_changed');f.trusted.state.hook=null;
  assert.equal(f.db.prepare('SELECT count(*) n FROM assets').get().n,0);
  const saved=ok(f.call('importAssetVersion',value));f.trusted.state.classes=['explicit-user'];
  error(f.call('getAssetVersion',{version:saved.version}),'authority_required');f.trusted.state.classes=null;
  error(f.call('getAssetVersion',{version:{...saved.version,namespace:foreign}}),'authority_required');
  error(f.call('getAssetVersion',{version:{...saved.version,assetId:'missing'}}),'asset_not_found');
  error(f.call('getAssetVersion',{version:{...saved.version,contentIdentity:'x'.repeat(43)}}),'asset_version_unavailable');
  // Port functions were copied during construction; throwing through the host hook
  // verifies sanitized exceptions without changing the constructor's authority.
  f.trusted.state.authorizeHook=()=>{throw Error('private exception prose');};
  error(f.call('getAssetVersion',{version:saved.version}),'storage_error');
});
test('K12 every asset read executes under deferred query_only and restores it, including refusals',t=>{
  const f=fixture(t),saved=ok(f.call('importAssetVersion',input())),calls=[
    ['listAssets',{namespace:ns}],['listAssetVersions',{asset:saved.asset}],['getAssetVersion',{version:saved.version}],
    ['readAssetBytes',{version:saved.version}],['verifyAssetBytes',{version:saved.version,bytes:pdf()}],['getAssetUsage',{namespace:ns}],['listAssetEffects',{namespace:ns}],
  ];
  const original=DatabaseSync.prototype.prepare;let attempts=0;
  DatabaseSync.prototype.prepare=function(sql){
    if(sql==='PRAGMA query_only')return original.call(this,sql);
    if(this.isTransaction&&original.call(this,'PRAGMA query_only').get().query_only===1){
      attempts++;assert.throws(()=>this.exec("INSERT INTO binary_owner_usage VALUES('forced-write',0)"));
    }
    return original.call(this,sql);
  };
  t.after(()=>{DatabaseSync.prototype.prepare=original;});
  for(const [method,value]of calls)ok(f.call(method,value));
  error(f.call('getAssetVersion',{version:{...saved.version,versionId:'missing'}}),'asset_not_found');
  assert.ok(attempts>=calls.length);
  DatabaseSync.prototype.prepare=original;
  ok(f.call('importAssetVersion',input('after-reads')));
});
test('K03/K07 copying an intact chunk and MAC from an equal-content object refuses by exclusive object identity',t=>{
  const f=fixture(t),one=ok(f.call('importAssetVersion',input('object-one',{bytes:pdf(32769)}))),two=ok(f.call('importAssetVersion',input('object-two',{bytes:pdf(32769)})));
  assert.equal(one.version.contentIdentity,two.version.contentIdentity);
  const a=f.db.prepare('SELECT object_id FROM asset_versions WHERE id=?').get(one.version.versionId).object_id;
  const b=f.db.prepare('SELECT object_id FROM asset_versions WHERE id=?').get(two.version.versionId).object_id;
  assert.notEqual(a,b);const chunk=f.db.prepare('SELECT chunk_mac,bytes FROM binary_chunks WHERE object_id=? AND chunk_index=0').get(b);
  corrupt(f.db,'binary_chunk_immutable','UPDATE binary_chunks SET chunk_mac=?,bytes=? WHERE object_id=? AND chunk_index=0',chunk.chunk_mac,chunk.bytes,a);
  error(f.call('readAssetBytes',{version:one.version}),'asset_version_unavailable');assert.equal(ok(f.call('readAssetBytes',{version:two.version})).byteCount,32768);
});
test('K07 malformed, proxy, accessor and async current-grant values collapse to authority_required without data',t=>{
  const f=fixture(t),saved=ok(f.call('importAssetVersion',input())),values=[null,undefined,{},new Proxy({},{}),Promise.resolve({}),Object.defineProperty({},'accessGeneration',{get(){throw Error('must not invoke');}})];
  for(const value of values){f.trusted.state.currentValue=value;error(f.call('getAssetVersion',{version:saved.version}),'authority_required');}
  delete f.trusted.state.currentValue;assert.equal(ok(f.call('getAssetVersion',{version:saved.version})).version.byteCount,8);
});

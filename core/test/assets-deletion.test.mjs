import test from 'node:test';
import assert from 'node:assert/strict';
import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import { validateMixedManifest } from '../asset-schema.mjs';
import { openMemoryCore } from '../contract.mjs';
import { fixture,ns,input,pdf,ok,error,bytes,collect,corrupt,child,childHost,moduleURL } from '../testing/asset-fixtures.mjs';

test('K09 asset/version purges remove every descriptive field and chunk, release once, and preserve replay/effects in a fresh process',t=>{
  const f=fixture(t),oneInput=input('one',{title:'private title',filename:'private.pdf',bytes:pdf(40000)}),one=ok(f.call('importAssetVersion',oneInput));
  const twoInput=input('two',{asset:one.asset,expectedAssetRevision:1,bytes:pdf(33000)}),two=ok(f.call('importAssetVersion',twoInput));
  const delVersion={actionId:'version-delete',ref:one.version,expectedRevision:1};
  const deleted=ok(f.call('deleteAssetVersion',delVersion));assert.equal(deleted.revision,2);assert.equal(deleted.effectCount,1);
  assert.deepEqual(ok(f.call('deleteAssetVersion',delVersion)),deleted);assert.equal(ok(f.call('getAssetUsage',{namespace:ns})).retainedBinaryBytes,33000);
  const delAsset={actionId:'asset-delete',ref:one.asset,expectedRevision:3};const receipt=ok(f.call('deleteAsset',delAsset));assert.equal(receipt.revision,4);
  assert.equal(f.db.prepare('SELECT count(*) n FROM binary_objects').get().n,0);assert.equal(f.db.prepare('SELECT count(*) n FROM binary_chunks').get().n,0);
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,0);
  for(const row of f.db.prepare('SELECT * FROM asset_versions').all()) {
    assert.equal(row.state,'deleted');assert.equal(row.revision,2);assert.equal(row.byte_count,0);
    for(const name of ['title','filename','media_type','object_id'])assert.equal(row[name],null);
  }
  assert.deepEqual(ok(f.call('importAssetVersion',oneInput)),one);assert.deepEqual(ok(f.call('importAssetVersion',twoInput)),two);
  assert.equal(f.db.prepare('SELECT count(*) n FROM binary_chunks').get().n,0);
  const effects=collect(f,'listAssetEffects',{namespace:ns},'effects');assert.deepEqual(effects.map(e=>e.kind),['asset_version_imported','asset_version_imported','asset_version_deleted','asset_deleted']);
  assert.doesNotMatch(JSON.stringify(effects),/private title|private.pdf/);
  const replayFile=join(f.workspace.path,'replays.json');
  writeFileSync(replayFile,JSON.stringify({namespace:ns,version:two.version,replays:[['importAssetVersion',oneInput,one],['importAssetVersion',twoInput,two],['deleteAssetVersion',delVersion,deleted],['deleteAsset',delAsset,receipt]].map(([method,value,result])=>{const {bytes,...metadata}=value;return [method,{...metadata,...(bytes?{bytesHex:bytes.toString('hex')}:{})},result];})}));
  child(`import {readFileSync} from 'node:fs';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    const core=openMemoryCore({path:process.argv[1],assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});
    const saved=JSON.parse(readFileSync(process.argv[2],'utf8'));try {
      for(const [method,input,result]of saved.replays){if(input.bytesHex){input.bytes=Buffer.from(input.bytesHex,'hex');delete input.bytesHex;}assert.deepEqual(ok(core[method](input,token)),result);}
      assert.deepEqual(ok(core.getAssetVersion({version:saved.version},token)),{version:null,status:'unavailable'});
      assert.equal(ok(core.getAssetUsage({namespace:saved.namespace},token)).retainedBinaryBytes,0);
      assert.equal(ok(core.listAssetEffects({namespace:saved.namespace},token)).effects.length,4);
    }finally{core.close();}
    const db=new DatabaseSync(process.argv[1]);try{assert.equal(db.prepare('SELECT count(*) n FROM binary_objects').get().n,0);assert.equal(db.prepare('SELECT count(*) n FROM binary_chunks').get().n,0);assert.equal(db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);}finally{db.close();}`,
    [f.path,replayFile]);
});
test('K09 corrupt bytes/metadata never prevent logical deletion; terminal rows refuse resurrection and late children',t=>{
  const f=fixture(t),one=ok(f.call('importAssetVersion',input('one',{bytes:pdf(40000)})));
  f.db.prepare('DELETE FROM binary_chunks WHERE chunk_index=1').run();
  corrupt(f.db,'binary_object_immutable',"UPDATE binary_objects SET content_identity=? WHERE asset_version_id=?",'x'.repeat(43),one.version.versionId);
  error(f.call('readAssetBytes',{version:one.version}),'asset_version_unavailable');
  ok(f.call('deleteAssetVersion',{actionId:'delete',ref:one.version,expectedRevision:1}));
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,0);
  assert.throws(()=>f.db.prepare("UPDATE asset_versions SET state='available',revision=1,title='late',filename='late.pdf',media_type='application/pdf',byte_count=8,object_id='late' WHERE id=?").run(one.version.versionId));
  ok(f.call('deleteAsset',{actionId:'delete-parent',ref:one.asset,expectedRevision:2}));
  error(f.call('importAssetVersion',input('late-child',{asset:one.asset,expectedAssetRevision:3})),'asset_version_unavailable');
  assert.throws(()=>f.db.prepare("UPDATE assets SET state='available' WHERE id=?").run(one.asset.assetId));
  assert.throws(()=>f.db.prepare("INSERT INTO asset_versions VALUES('late',?,2,?,'available',1,'late','late.pdf','application/pdf',8,'object','now')").run(one.asset.assetId,'x'.repeat(43)));
  assert.equal(f.db.prepare('SELECT count(*) n FROM binary_chunks').get().n,0);
});
test('K09 method deletion with the asset feature off does not inspect or modify standalone assets',t=>{
  const f=fixture(t,{methods:true}),asset=ok(f.call('importAssetVersion',input('asset'))),method=ok(f.call('importMethodVersion',{
    namespace:ns,actionId:'method',title:'Synthetic',files:[{path:'SKILL.md',text:'Synthetic method.',mediaType:'text/markdown'}]}));
  const before=['assets','asset_versions','binary_objects','binary_chunks','binary_owner_usage','asset_operations','asset_effects','asset_epochs']
    .map(table=>[table,f.db.prepare('SELECT * FROM '+table).all()]);
  const methodOnly=openMemoryCore({path:f.path,methodPackages:f.trusted.methods});
  try {
    assert.equal(methodOnly.deleteAsset,undefined);
    ok(f.trusted.call(methodOnly,'deleteMethodVersion',{actionId:'method-delete',ref:method.version,expectedRevision:1}));
    ok(f.trusted.call(methodOnly,'deleteMethodPackage',{actionId:'package-delete',ref:method.package,expectedRevision:2}));
  }finally{methodOnly.close();}
  for(const [table,rows]of before)assert.deepEqual(f.db.prepare('SELECT * FROM '+table).all(),rows,table);
  assert.deepEqual(bytes(f,asset.version),pdf());
});
test('K04 v31 ownership, exact references, STRICT chunk shapes and deferred exclusive owner links reject invalid DML',t=>{
  const f=fixture(t,{methods:true}),one=ok(f.call('importAssetVersion',input())),row=f.db.prepare('SELECT * FROM asset_versions').get();
  const insert=f.db.prepare('INSERT INTO binary_objects VALUES(?,?,?,?,?,?,?,?,?,?)');
  const args=['invalid',ns.ownerId,ns.scope,'','application/pdf',one.version.contentIdentity,8,one.version.versionId,null,null];
  for(const patch of [{0:'bad',7:null},{0:'bad',8:'method',9:0},{0:'bad',1:'foreign'},{0:'bad',4:'image/png'},{0:'bad',5:'wrong'},{0:'bad',6:9}]) {
    const values=[...args];for(const [key,value]of Object.entries(patch))values[Number(key)]=value;assert.throws(()=>insert.run(...values));
  }
  assert.throws(()=>f.db.prepare("INSERT INTO binary_chunks VALUES(?,1,'mac',?)").run(row.object_id,Buffer.from('late')));
  assert.throws(()=>f.db.prepare("INSERT INTO binary_chunks VALUES(?,0,'mac','not-a-blob')").run('missing'));
  assert.throws(()=>f.db.prepare("INSERT INTO asset_versions VALUES('bad',?,2,?,'available',1,'bad','bad.pdf','application/pdf',8,?,'now')").run(one.asset.assetId,'y'.repeat(43),row.object_id));
  assert.throws(()=>f.db.exec("INSERT INTO method_manifest_formats VALUES('missing','mixed-v1')"));
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,8);
});
test('K01/K09 derivative layout supports exact-source constraints and sole-writer release alongside the derivative API',t=>{
  const f=fixture(t),saved=ok(f.call('importAssetVersion',input())),provenance=JSON.stringify({source:saved.version,method:{kind:'user-provided'}}),text='synthetic derivative';
  f.db.exec('BEGIN IMMEDIATE');
  try {
    f.db.prepare('UPDATE binary_owner_usage SET byte_count=byte_count+?').run(Buffer.byteLength(text));
    f.db.prepare("INSERT INTO asset_derivatives VALUES('derivative',?,?,'available',1,'description',?,?,?,NULL,NULL,?,'now')")
      .run(saved.version.versionId,saved.version.contentIdentity,text,'d'.repeat(43),provenance,Buffer.byteLength(text));
    f.db.exec('COMMIT');
  }catch(failure){f.db.exec('ROLLBACK');throw failure;}
  assert.equal(typeof f.core.createAssetDerivative,'function');
  ok(f.call('deleteAsset',{actionId:'parent-delete',ref:saved.asset,expectedRevision:1}));
  const row=f.db.prepare('SELECT * FROM asset_derivatives').get();assert.equal(row.state,'deleted');assert.equal(row.revision,2);assert.equal(row.byte_count,0);
  for(const key of ['kind','text','provenance','language','timecodes'])assert.equal(row[key],null);
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,0);
  assert.throws(()=>f.db.prepare("INSERT INTO asset_derivatives VALUES('late',?,?,'available',1,'description','late',?,?,NULL,NULL,4,'now')")
    .run(saved.version.versionId,saved.version.contentIdentity,'d'.repeat(43),provenance));
  assert.throws(()=>f.db.prepare('INSERT INTO binary_objects VALUES(?,?,?,?,?,?,?,?,NULL,NULL)')
    .run('late-object',ns.ownerId,ns.scope,'','application/pdf',saved.version.contentIdentity,8,saved.version.versionId));
});
test('K01/K09 reserved mixed layout enforces owners and feature-off method-package purge releases only its own binary bytes',t=>{
  const f=fixture(t,{methods:true}),standalone=ok(f.call('importAssetVersion',input('standalone'))),method=ok(f.call('importMethodVersion',{
    namespace:ns,actionId:'mixed-schema-fixture',title:'Synthetic',files:[{path:'SKILL.md',text:'text',mediaType:'text/markdown'}]}));
  const file=f.db.prepare('SELECT * FROM method_files WHERE version_id=?').get(method.version.versionId),objectId='reserved-method-binary',identity='b'.repeat(43);
  f.db.exec('BEGIN IMMEDIATE');
  try {
    f.db.prepare("INSERT INTO method_manifest_formats VALUES(?,'mixed-v1')").run(method.version.versionId);
    const entry=f.db.prepare('INSERT INTO method_mixed_entries VALUES(?,?,?,?,?,?,?,?,?)');
    entry.run(file.version_id,0,'text',file.path,file.path.toLowerCase(),file.media_type,file.content_identity,file.byte_count,null);
    entry.run(file.version_id,1,'binary','opaque.pdf','opaque.pdf','application/pdf',identity,8,objectId);
    f.db.prepare('UPDATE binary_owner_usage SET byte_count=byte_count+8').run();
    f.db.prepare('INSERT INTO binary_objects VALUES(?,?,?,?,?,?,?,NULL,?,?)').run(objectId,ns.ownerId,ns.scope,'','application/pdf',identity,8,file.version_id,1);
    f.db.prepare('INSERT INTO binary_chunks VALUES(?,0,?,?)').run(objectId,'fixture-mac',pdf());
    assert.throws(()=>entry.run(file.version_id,2,'text','wrong','wrong',file.media_type,file.content_identity,file.byte_count,null));
    validateMixedManifest(f.db,file.version_id);
    f.db.exec('COMMIT');
  }catch(failure){f.db.exec('ROLLBACK');throw failure;}
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,16);
  const methodOnly=openMemoryCore({path:f.path,methodPackages:f.trusted.methods});
  try{ok(f.trusted.call(methodOnly,'deleteMethodPackage',{actionId:'feature-off-mixed-purge',ref:method.package,expectedRevision:1}));}finally{methodOnly.close();}
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_mixed_entries').get().n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM binary_objects WHERE method_version_id IS NOT NULL').get().n,0);
  assert.equal(f.db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,8);
  assert.deepEqual(bytes(f,standalone.version),pdf());assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('K01 reserved timecode CHECKs use contract startMs/endMs, exact source and ordered safe intervals',t=>{
  const f=fixture(t),saved=ok(f.call('importAssetVersion',input('audio',{filename:'sound.wav',mediaType:'audio/wav',bytes:Buffer.from('RIFF0000WAVE')})));
  const provenance=JSON.stringify({source:saved.version,method:{kind:'user-provided'}}),insert=f.db.prepare("INSERT INTO asset_derivatives VALUES(?,?,?,'available',1,'transcript','x',?,?,NULL,?,1,'now')");
  f.db.exec('BEGIN IMMEDIATE');
  try {
    f.db.prepare('UPDATE binary_owner_usage SET byte_count=byte_count+1').run();
    insert.run('valid-intervals',saved.version.versionId,saved.version.contentIdentity,'d'.repeat(43),provenance,JSON.stringify([{startMs:0,endMs:100},{startMs:100,endMs:200}]));
    for(const [i,timecodes]of [[{start:0,end:100}],[{startMs:-1,endMs:0}],[{startMs:2,endMs:1}],[{startMs:0,endMs:2**53}],[{startMs:0,endMs:100},{startMs:99,endMs:200}]].entries())
      assert.throws(()=>insert.run('invalid-'+i,saved.version.versionId,saved.version.contentIdentity,'d'.repeat(43),provenance,JSON.stringify(timecodes)));
    const wrong=JSON.stringify({source:{...saved.version,namespace:{...ns,ownerId:'foreign'}},method:{kind:'user-provided'}});
    assert.throws(()=>insert.run('wrong-source',saved.version.versionId,saved.version.contentIdentity,'d'.repeat(43),wrong,null));
  }finally{f.db.exec('ROLLBACK');}
  assert.equal(f.db.prepare('SELECT count(*) n FROM asset_derivatives').get().n,0);
});

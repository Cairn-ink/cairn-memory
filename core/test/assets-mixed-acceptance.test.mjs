import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture,ns,input,pdf,ok,child,childHost,moduleURL } from '../testing/asset-fixtures.mjs';
import { mixedInput,binaryEntry,derivativeInput } from '../testing/asset-mixed-fixtures.mjs';

// Compare every retained row, including chunks, usage, epochs, receipts and
// effects. Rebuild-only changes are excluded when checking the purge fence.
function retainedState(db,payloadOnly=false) {
  const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  return Object.fromEntries(tables.filter(({name})=>!payloadOnly||/^(asset|binary_|method_)/.test(name)).map(({name})=>[
    name,db.prepare('SELECT * FROM "'+name.replaceAll('"','""')+'"').all().map(row=>JSON.stringify(row,(_key,value)=>
      value instanceof Uint8Array?{base64:Buffer.from(value).toString('base64')}:value)).sort(),
  ]));
}

test('K04 genuine mixed ownership rejects wrong namespace/version/position and reused method/standalone objects in independent SQL transactions',t=>{
  const f=fixture(t,{methods:true}),first=ok(f.call('importMethodVersion',mixedInput('first')));
  const second=ok(f.call('importMethodVersion',mixedInput('second',{package:first.package,expectedPackageRevision:1,basedOn:first.version})));
  const standalone=ok(f.call('importAssetVersion',input()));
  const before=retainedState(f.db);
  const result=JSON.parse(child(`
    import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
    import {STORAGE_BUSY_TIMEOUT_MS} from ${JSON.stringify(moduleURL('core/database.mjs'))};
    ${retainedState.toString()}
    const [path,firstId,secondId,assetId]=process.argv.slice(1),db=new DatabaseSync(path,{timeout:STORAGE_BUSY_TIMEOUT_MS});
    db.exec('PRAGMA foreign_keys=ON');
    const source=db.prepare('SELECT * FROM binary_objects WHERE method_version_id=?').get(firstId);
    const target=db.prepare('SELECT * FROM binary_objects WHERE method_version_id=?').get(secondId);
    const standalone=db.prepare('SELECT * FROM binary_objects WHERE asset_version_id=?').get(assetId);
    const entry=db.prepare("SELECT * FROM method_mixed_entries WHERE version_id=? AND kind='binary'").get(secondId);
    const saved=retainedState(db),checked=[];
    const insert=(table,row)=>{const keys=Object.keys(row);db.prepare('INSERT INTO '+table+' ('+keys.join(',')+') VALUES ('+keys.map(()=>'?').join(',')+')').run(...Object.values(row));};
    const cases=[
      ['wrong owner',{owner_id:'another-owner'}],
      ['wrong namespace',{scope:'project',project_id:'another-project'}],
      ['wrong version',{method_version_id:secondId}],
      ['text position',{position:0}],
      ['absent position',{position:2}],
    ];
    try {
      for(const [label,patch] of cases) {
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM binary_objects WHERE id=?').run(source.id);
          // Free the other ownership key so this observes the composite owner
          // guard, rather than an unrelated uniqueness/REPLACE guard.
          if(patch.method_version_id)db.prepare('DELETE FROM binary_objects WHERE id=?').run(target.id);
          assert.throws(()=>insert('binary_objects',{...source,...patch}),/invalid_binary_owner/,label);
        } finally {db.exec('ROLLBACK');}
        assert.deepEqual(retainedState(db),saved,label);checked.push(label);
      }
      for(const [label,object] of [['reuse across versions',source],['reuse standalone object',standalone]]) {
        db.exec('BEGIN IMMEDIATE');
        try {
          db.prepare('DELETE FROM binary_objects WHERE id=?').run(target.id);
          db.prepare('DELETE FROM method_mixed_entries WHERE version_id=? AND position=?').run(secondId,entry.position);
          assert.throws(()=>insert('method_mixed_entries',{...entry,binary_object_id:object.id,
            media_type:object.media_type,content_identity:object.content_identity,byte_count:object.byte_count}),
            /invalid_method_entry|method_entry_immutable/,label);
        } finally {db.exec('ROLLBACK');}
        assert.deepEqual(retainedState(db),saved,label);checked.push(label);
      }
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
      console.log(JSON.stringify({pid:process.pid,checked}));
    } finally {db.close();}
  `,[f.path,first.version.versionId,second.version.versionId,standalone.version.versionId]));
  assert.notEqual(result.pid,process.pid);
  assert.deepEqual(result.checked,['wrong owner','wrong namespace','wrong version','text position','absent position','reuse across versions','reuse standalone object']);
  assert.deepEqual(retainedState(f.db),before,'all retained rows, usage and effects unchanged after the child exits');
});

function assertPurged(db,call,config) {
  assert.equal(call('readAssetDerivative',{ref:config.derivative}).status,'unavailable');
  assert.equal(call('readMethodAttachmentBytes',{version:config.version,path:'reference.pdf',intent:'history'}).status,'unavailable');
  assert.equal(call('getMethodVersion',{version:config.version,intent:'history'}).status,'unavailable');
  const derivative=db.prepare('SELECT * FROM asset_derivatives WHERE id=?').get(config.derivative.derivativeId);
  assert.equal(derivative.state,'deleted');assert.equal(derivative.revision,2);assert.equal(derivative.byte_count,0);
  for(const key of ['kind','text','provenance','language','timecodes'])assert.equal(derivative[key],null,key);
  const version=db.prepare('SELECT * FROM method_versions WHERE id=?').get(config.version.versionId);
  assert.equal(version.state,'deleted');assert.equal(version.byte_count,0);assert.equal(version.title,null);assert.equal(version.submitted_by,null);
  for(const table of ['method_files','method_mixed_entries'])assert.equal(db.prepare('SELECT count(*) n FROM '+table+' WHERE version_id=?').get(config.version.versionId).n,0,table);
  assert.equal(db.prepare('SELECT count(*) n FROM binary_objects WHERE method_version_id=?').get(config.version.versionId).n,0);
  assert.equal(db.prepare('SELECT count(*) n FROM binary_chunks WHERE object_id=?').get(config.objectId).n,0);
  const actual=db.prepare('SELECT coalesce(sum(byte_count),0) n FROM binary_objects').get().n+
    db.prepare('SELECT coalesce(sum(byte_count),0) n FROM asset_derivatives').get().n;
  assert.equal(actual,config.retainedBytes);assert.equal(db.prepare('SELECT byte_count FROM binary_owner_usage').get().byte_count,actual);
  const usage=call('getAssetUsage',{namespace:config.namespace});
  assert.equal(usage.retainedBinaryBytes,64+65);assert.equal(usage.retainedDerivativeBytes,Buffer.byteLength('Retained derivative'));
  assert.equal(usage.retainedBinaryBytes+usage.retainedDerivativeBytes,actual);
  assert.equal(call('getMethodPackageUsage',{namespace:config.namespace}).retainedFileBytes,0);
  assert.equal(call('readAssetDerivative',{ref:config.controlDerivative}).status,'available');
  assert.equal(call('readMethodAttachmentBytes',{version:config.controlVersion,path:'control.pdf',intent:'history'}).status,'available');
  assert.equal(db.prepare("SELECT count(*) n FROM asset_effects WHERE kind='asset_derivative_deleted'").get().n,1);
  assert.equal(db.prepare("SELECT count(*) n FROM method_effects WHERE kind='method_version_deleted'").get().n,1);
  assert.equal(db.prepare('SELECT count(*) n FROM asset_effects').get().n,4);
  assert.equal(db.prepare('SELECT count(*) n FROM method_effects').get().n,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
}

test('K09 a staged rebuild resumed after derivative/attachment purge cannot resurrect payloads, rows, quota or effects across restart',t=>{
  const f=fixture(t,{methods:true}),source=ok(f.call('importAssetVersion',input('source',{bytes:pdf(64)})));
  const derived=ok(f.call('createAssetDerivative',derivativeInput(source.version,'purged-derive',{text:'Stale derived payload to purge'})));
  const control=ok(f.call('createAssetDerivative',derivativeInput(source.version,'control-derive',{text:'Retained derivative'})));
  const mixed=ok(f.call('importMethodVersion',mixedInput('purged-mixed')));
  const controlMixed=ok(f.call('importMethodVersion',mixedInput('control-mixed',{files:[binaryEntry('control.pdf',pdf(65))]})));
  const objectId=f.db.prepare('SELECT id FROM binary_objects WHERE method_version_id=?').get(mixed.version.versionId).id;
  for(let i=0;i<2;i++)ok(f.core.admit({namespace:ns,memory:{kind:'fact',content:'Synthetic rebuild seed '+i},
    receipts:[{client:'asset-rebuild',sessionId:'synthetic',eventId:'seed-'+i,role:'user',excerpt:'Synthetic rebuild seed '+i}]}));
  const revision=f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId,ns.scope,'').epoch;
  const request={namespace:ns,expectedIndexRevision:revision,limit:1};
  const staged=JSON.parse(child(`
    import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};
    const [path,input]=process.argv.slice(1),core=openMemoryCore({path});
    try{const result=core.rebuildIndex(JSON.parse(input));assert.equal(result.ok,true,JSON.stringify(result));
      assert.equal(result.value.state,'staged');assert.equal(typeof result.value.nextCursor,'string');
      console.log(JSON.stringify({pid:process.pid,...result.value}));}finally{core.close();}
  `,[f.path,JSON.stringify(request)]));
  assert.notEqual(staged.pid,process.pid);assert.equal(staged.exhausted,false);
  assert.equal(f.db.prepare('SELECT count(*) n FROM index_generations WHERE published=0').get().n,1);
  assert.equal(f.db.prepare('SELECT count(*) n FROM index_memories').get().n,1,'real rebuild projection has staged data');
  const deletions=[
    {method:'deleteAssetDerivative',input:{ref:derived.derivative,actionId:'purge-derive',expectedRevision:1}},
    {method:'deleteMethodVersion',input:{ref:mixed.version,actionId:'purge-mixed',expectedRevision:1}},
  ].map(operation=>({...operation,receipt:ok(f.call(operation.method,operation.input))}));
  const config={namespace:ns,derivative:derived.derivative,version:mixed.version,objectId,
    controlDerivative:control.derivative,controlVersion:controlMixed.version,
    retainedBytes:64+65+Buffer.byteLength('Retained derivative'),deletions};
  assertPurged(f.db,(method,input)=>ok(f.call(method,input)),config);
  const afterPurge=retainedState(f.db,true);f.core.close();
  const resumed=JSON.parse(child(`
    import assert from 'node:assert/strict';import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};
    const [path,input]=process.argv.slice(1),core=openMemoryCore({path}),request=JSON.parse(input);let pages=0,result;
    try{do{result=core.rebuildIndex(request);pages++;assert.ok(pages<=10,'finite rebuild continuation');
      if(!result.ok){assert.equal(result.error.code,'stale_rebuild');break;}
      assert.deepEqual(result.value.invalidRefs,[]);request.cursor=result.value.nextCursor;
    }while(request.cursor);
    if(result.ok)assert.equal(result.value.state,'published');
    console.log(JSON.stringify({pid:process.pid,pages,result}));}finally{core.close();}
  `,[f.path,JSON.stringify({...request,cursor:staged.nextCursor})]));
  assert.notEqual(resumed.pid,process.pid);assert.notEqual(resumed.pid,staged.pid);
  assert.deepEqual(retainedState(f.db,true),afterPurge,'resume/publish does not touch retained method/asset data');
  child(`
    import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
    import {STORAGE_BUSY_TIMEOUT_MS} from ${JSON.stringify(moduleURL('core/database.mjs'))};
    import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};${childHost}
    ${retainedState.toString()}${assertPurged.toString()}
    const [path,json,saved]=process.argv.slice(1),config=JSON.parse(json);
    const core=openMemoryCore({path,methodPackages:methods,assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}});
    const db=new DatabaseSync(path,{readOnly:true,timeout:STORAGE_BUSY_TIMEOUT_MS});
    try{assertPurged(db,(method,input)=>ok(core[method](input,token)),config);
      for(const operation of config.deletions)assert.deepEqual(ok(core[operation.method](operation.input,token)),operation.receipt);
      assert.deepEqual(retainedState(db,true),JSON.parse(saved),'restart and replay keep exact rows, usage, receipts and effects');
    }finally{core.close();db.close();}
  `,[f.path,JSON.stringify(config),JSON.stringify(afterPurge)]);
  f.reopen();assertPurged(f.db,(method,input)=>ok(f.call(method,input)),config);
  assert.deepEqual(retainedState(f.db,true),afterPurge);
});

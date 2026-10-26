import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';

// Constructor composition must preserve independently selected capabilities.
// No authority is exercised, and no disk store, sidecar or provider is used.
test('L01 all eight asset/context/method capability combinations compose',()=>{
  const authority={authorize(){return null;},isCurrent(){return null;}};
  let combinations=0;
  for(const assets of [false,true])for(const context of [false,true])for(const methods of [false,true]){
    const core=openMemoryCore({path:':memory:',
      ...(assets?{assets:{version:'assets-local-v1',storage:'sqlite-blob-v1',authority}}:{}),
      ...(context?{contextRead:{version:'context-read-v1',authority}}:{}),
      ...(methods?{methodPackages:{version:'method-packages-local-v1',storage:'local-plain-v1',authority}}:{})});
    try{
      assert.equal(typeof core.getAssetCapabilities,assets?'function':'undefined');
      assert.equal(typeof core.getContextReadCapabilities,context?'function':'undefined');
      assert.equal(typeof core.getMethodPackageCapabilities,methods?'function':'undefined');
      if(assets)assert.equal(core.getAssetCapabilities().ok,true);
      if(context)assert.equal(core.getContextReadCapabilities().ok,true);
      if(methods)assert.equal(core.getMethodPackageCapabilities().ok,true);
      assert.equal(core.list({namespace:{ownerId:'synthetic',scope:'personal',projectId:null}}).ok,true);
      combinations++;
    }finally{core.close();}
  }
  assert.equal(combinations,8);
});

test('L01 context wrapper preserves other legal options and rejects unknown/accessor options',()=>{
  const authority={authorize(){return null;},isCurrent(){return null;}},contextRead={version:'context-read-v1',authority};
  const core=openMemoryCore({path:':memory:',contextRead,captureQualification:'source-bound-v2',
    captureQualifiedDuplicates:'append-matching-evidence-v1',captureDeadlineMs:1000,sourceCandidatePolicy:'bounded-keyset-v1'});
  core.close();
  assert.throws(()=>openMemoryCore({path:':memory:',contextRead,unknown:true}),{code:'invalid_input'});
  let inspected=false;
  assert.throws(()=>openMemoryCore({path:':memory:',contextRead,get assets(){inspected=true;return {};}}),{code:'invalid_input'});
  assert.equal(inspected,false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFileSync,writeFileSync,openSync,closeSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture,ok,pdf,corrupt } from '../../core/testing/asset-fixtures.mjs';
import { mixedInput,binaryEntry,textEntry } from '../../core/testing/asset-mixed-fixtures.mjs';
import { assertMixedAssetImportGate,assetContentionCases } from './measure-assets.mjs';
test('K13 the 64-MiB mixed gate asserts exact bytes, all pre-lock MACs, one transaction, lock time and preparation-inclusive RSS',()=>{
  const report={status:'complete',bytes:67108864,binaryEntries:2,entries:256,textUnits:4000000,hmacCalls:2306,writeTransactions:1,allMACsBeforeCallbacksAndLock:true,transactionMs:2000,rssGrowthBytes:134217728};
  assertMixedAssetImportGate(report);
  for(const patch of [{bytes:67108863},{binaryEntries:1},{entries:255},{textUnits:3999999},{hmacCalls:2305},{transactionMs:2000.01},{rssGrowthBytes:134217729},
    {allMACsBeforeCallbacksAndLock:false},{writeTransactions:2},{status:'failed'}])assert.throws(()=>assertMixedAssetImportGate({...report,...patch}));
});
test('K13 both maximum reader workloads retain separate paced gates and unpaced stress observations',()=>{
  const cases=assetContentionCases();
  assert.deepEqual(cases.map(({key,workload,scenario,readMethod})=>({key,workload,scenario,readMethod})),[
    {key:'paced',workload:'standalone',scenario:'paced',readMethod:'readAssetBytes'},
    {key:'unpaced',workload:'standalone',scenario:'unpaced',readMethod:'readAssetBytes'},
    {key:'mixed-paced',workload:'mixed',scenario:'paced',readMethod:'readMethodAttachmentBytes'},
    {key:'mixed-unpaced',workload:'mixed',scenario:'unpaced',readMethod:'readMethodAttachmentBytes'},
  ]);
  for(const entry of cases.filter(entry=>entry.workload==='mixed')) {
    assert.equal(entry.manifestEntries,256);
    assert.deepEqual(entry.attachments,[{path:'maximum-0.pdf',byteCount:33554432},{path:'maximum-1.pdf',byteCount:33554432}]);
    assert.equal(entry.attachments.reduce((sum,attachment)=>sum+attachment.byteCount,0),67108864);
    assert.equal(entry.attachments.reduce((sum,attachment)=>sum+Math.ceil(attachment.byteCount/32768),0),2048);
  }
});
test('K13 real mixed measurement reader checks all 256 manifest entries, both exact attachment streams and corrupt/mismatched content',t=>{
  const f=fixture(t,{methods:true}),attachments=[pdf(33000),pdf(40000)];
  const receipt=ok(f.call('importMethodVersion',mixedInput('measurement-reader',{files:[
    ...Array.from({length:254},(_,i)=>textEntry('entry-'+i+'.txt','')),
    ...attachments.map((bytes,i)=>binaryEntry('maximum-'+i+'.pdf',bytes)),
  ]})));
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_mixed_entries WHERE version_id=?').get(receipt.version.versionId).n,256);
  const hash=createHash('sha256');for(const bytes of attachments)hash.update(bytes);const sha256=hash.digest('hex');
  const run=(label,scenario,expectedExit,expectedHash=sha256)=>{
    const prefix=join(f.workspace.path,label),config={path:f.path,receipt,workload:'mixed',scenario,failOnBusy:scenario==='paced',
      deadlineAt:Date.now()+15000,sha256:expectedHash,attachments:attachments.map((bytes,i)=>({path:'maximum-'+i+'.pdf',byteCount:bytes.length})),
      ...Object.fromEntries(['ready','start','baseline','result','readerActive','readerPassDone','writerEntered','writerDone','readerPages','writerCalls'].map(name=>[name,prefix+'.'+name]))};
    // A completed writer lets the paced reader finish exactly one full pass;
    // unpaced reads stop after their own first verified pass. The full command
    // supplies live independent writers and asserts the contention thresholds.
    writeFileSync(config.start,'start');writeFileSync(config.writerDone,JSON.stringify({at:performance.timeOrigin+performance.now()}));
    const configPath=prefix+'.json';writeFileSync(configPath,JSON.stringify(config));
    const stdout=openSync(prefix+'.stdout','wx'),stderr=openSync(prefix+'.stderr','wx'),env={...process.env};delete env.NODE_TEST_CONTEXT;
    let child;try{child=spawnSync(process.execPath,[fileURLToPath(new URL('./measure-assets.mjs',import.meta.url)),'--reader',configPath],
      {env,timeout:20000,stdio:['ignore',stdout,stderr]});}finally{closeSync(stdout);closeSync(stderr);}
    assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,expectedExit,readFileSync(prefix+'.stderr','utf8'));
    const result=JSON.parse(readFileSync(config.result,'utf8'));assert.notEqual(result.pid,process.pid);return {result,config};
  };
  for(const scenario of ['paced','unpaced']) {
    const {result,config}=run('valid-'+scenario,scenario,0),baseline=JSON.parse(readFileSync(config.baseline,'utf8'));
    assert.equal(result.status,'complete');assert.equal(result.readMethod,'readMethodAttachmentBytes');
    assert.equal(result.passes,1);assert.equal(result.pagesPerPass,4);assert.equal(result.pages,4);
    assert.equal(result.bytesPerPass,73000);assert.equal(result.byteExact,true);assert.equal(result.readCompleted,true);
    assert.equal(result.sha256,sha256);assert.equal(result.storageBusy,0);
    assert.equal(baseline.complete,true);assert.equal(baseline.readMethod,'readMethodAttachmentBytes');assert.equal(baseline.bytes,73000);
  }
  const wrong=run('wrong-hash','unpaced',1,'0'.repeat(64)).result;
  assert.equal(wrong.status,'failed');assert.equal(wrong.byteExact,false);
  // Corrupt an unrelated text entry, not either requested binary entry. Every
  // attachment page must still revalidate the complete manifest metadata.
  corrupt(f.db,'method_mixed_immutable','UPDATE method_mixed_entries SET content_identity=? WHERE version_id=? AND position=0','x'.repeat(43),receipt.version.versionId);
  const changed=run('corrupt-metadata','paced',1).result;
  assert.equal(changed.status,'failed');assert.equal(changed.byteExact,false);assert.match(changed.reason,/method_version_unavailable/);
});

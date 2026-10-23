import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAssetImportGate,ASSET_MEASUREMENT_BOUNDS,assetWriterInterval } from './measure-assets.mjs';
import { assertMethodGate } from './measure-method-packages.mjs';
import { assertStressObservation } from './measure-contention.mjs';
test('K13 import gates reject excess lock time/RSS, missing pre-lock preparation and extra transactions',()=>{
  const report={status:'complete',bytes:33554432,writeTransactions:1,allMACsBeforeCallbacksAndLock:true,transactionMs:2000,rssGrowthBytes:134217728};
  assertAssetImportGate(report);
  for(const patch of [{bytes:33554431},{transactionMs:2000.01},{rssGrowthBytes:134217729},{allMACsBeforeCallbacksAndLock:false},{writeTransactions:2},{status:'failed'}])assert.throws(()=>assertAssetImportGate({...report,...patch}));
  assert.equal(ASSET_MEASUREMENT_BOUNDS.overallMs,600000);
  assert.equal(assetWriterInterval(500),50);assert.equal(assetWriterInterval(1000),100);
  for(const value of [0,-1,Infinity,NaN])assert.throws(()=>assetWriterInterval(value));
});
test('K13 contention requires independent successful exits, zero busy, 100 transitions, 200 actively overlapping pages and bounded p95',()=>{
  const report={reader:{pid:1,status:'complete',storageBusy:0,passes:1,pagesDuringWriter:200,pagesDuringActiveWrites:200},writer:{pid:2,status:'complete',storageBusy:0,committed:100,p95Ms:250},exits:{reader:{code:0,signal:null},writer:{code:0,signal:null}}};
  assertMethodGate(report);
  for(const [side,patch]of [['reader',{storageBusy:1}],['writer',{storageBusy:1}],['reader',{pagesDuringWriter:199}],['reader',{pagesDuringActiveWrites:199}],['writer',{committed:99}],['writer',{p95Ms:250.01}],['reader',{pid:2}]])assert.throws(()=>assertMethodGate({...report,[side]:{...report[side],...patch}}));
  for(const side of ['reader','writer'])assert.throws(()=>assertMethodGate({...report,exits:{...report.exits,[side]:{code:1,signal:null}}}));
});
test('§16 K13 unpaced stress accepts busy reader recovery without weakening the paced gate',()=>{
  const report={reader:{pid:1,status:'complete',storageBusy:2,busyWaitMs:10000,retryDelayMs:30,maxPageMs:10030,
    passes:1,readCompleted:true,byteExact:true,pages:1024,pagesDuringWriter:2,pagesDuringActiveWrites:2},
    writer:{pid:2,status:'complete',storageBusy:0,committed:5,p95Ms:300},
    exits:{reader:{code:0,signal:null},writer:{code:0,signal:null}}};
  assertStressObservation(report);assert.throws(()=>assertMethodGate(report));
  assert.throws(()=>assertStressObservation({...report,reader:{...report.reader,byteExact:false}}),/exact bytes/);
});

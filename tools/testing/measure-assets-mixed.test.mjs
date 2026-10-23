import test from 'node:test';
import assert from 'node:assert/strict';
import { assertMixedAssetImportGate } from './measure-assets.mjs';
test('K13 the 64-MiB mixed gate asserts exact bytes, all pre-lock MACs, one transaction, lock time and preparation-inclusive RSS',()=>{
  const report={status:'complete',bytes:67108864,binaryEntries:2,entries:256,textUnits:4000000,hmacCalls:2306,writeTransactions:1,allMACsBeforeCallbacksAndLock:true,transactionMs:2000,rssGrowthBytes:134217728};
  assertMixedAssetImportGate(report);
  for(const patch of [{bytes:67108863},{binaryEntries:1},{entries:255},{textUnits:3999999},{hmacCalls:2305},{transactionMs:2000.01},{rssGrowthBytes:134217729},
    {allMACsBeforeCallbacksAndLock:false},{writeTransactions:2},{status:'failed'}])assert.throws(()=>assertMixedAssetImportGate({...report,...patch}));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { sourceFixture, ok, request, splitRaw } from '../../core/testing/raw-source-fixtures.mjs';
import { searchFixture } from '../../core/testing/raw-search-fixtures.mjs';
import { createRawSearchAuthority } from '../../core/raw-search-authority.mjs';
import { openReadDatabase } from '../../core/read-database.mjs';
import { openRawSearchStorage } from '../../core/raw-search-storage.mjs';

// Real elapsed work; only the one-second admission cadence is accelerated.
// A cap is an observation, never a runner-speed-dependent CI expectation.
const maxMs = Number(process.argv[2] ?? 12), output = process.argv[3];
assert.ok([12,25].includes(maxMs));
test('real-slice inventory completion and restoration after a save', async t => {
  const realNow = performance.now.bind(performance), own = Object.getOwnPropertyDescriptor(performance,'now');
  let cadence = 0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>realNow()+cadence});
  t.after(()=>{if(own)Object.defineProperty(performance,'now',own);else delete performance.now;});
  const f = sourceFixture(t), count = 2500, cap = 12000;
  for(let start=0;start<count-1;start+=24) {
    const messages=Array.from({length:Math.min(24,count-1-start)},(_,offset)=>{
      const i=start+offset;return splitRaw('synthetic copper baseline '+i,{id:'baseline-'+i,ordinal:i+1})[0];
    });
    ok(await f.core.captureRaw({...request(messages[0],{sessionId:'synthetic-baseline',eventId:'baseline-batch-'+start}),messages}));
  }
  ok(await f.core.captureRaw(request(splitRaw('synthetic copper tail',{id:'baseline-tail',ordinal:count})[0],
    {sessionId:'synthetic-baseline',eventId:'baseline-tail'})));
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_messages').get().n,count);
  const s=await searchFixture(f),reader=openReadDatabase(f.path,{contextRead:true});
  const authority=createRawSearchAuthority(reader,s.options);
  const storage=await openRawSearchStorage({directory:s.directory,identity:authority.identity,bind:authority.bind,quotaBytes:512*1024*1024});
  t.after(async()=>{await storage.close();reader.db.close();});
  const result={count,maxMs,cap,firstCompletePasses:null,recompleteAfterSavePasses:null,longestPassMs:0};
  const began=realNow();
  async function complete(phase) {
    for(let n=1;n<=cap;n++) {
      cadence+=1010;const start=realNow();await s.maintain({maxItems:16,maxMs});
      result.longestPassMs=Math.max(result.longestPassMs,realNow()-start);
      if(storage.head().checkpoint.coverageComplete) {
        const coverage=(await s.search({query:'synthetic'})).coverage;
        result.lastSearchCoverage=coverage;
        if(!coverage.causes?.includes('index_incomplete')&&!coverage.causes?.includes('deadline'))return n;
      }
      if(n%1000===0)console.log(JSON.stringify({phase,passes:n,wallMs:realNow()-began}));
    }
    return null;
  }
  result.firstCompletePasses=await complete('initial');
  if(result.firstCompletePasses!==null) {
    ok(await f.core.captureRaw(request(splitRaw('synthetic copper arrival',{id:'new-arrival',ordinal:1})[0],
      {sessionId:'synthetic-new',eventId:'synthetic-new'})));
    result.recompleteAfterSavePasses=await complete('after-save');
  }
  result.wallMs=realNow()-began;
  if(output)writeFileSync(output,JSON.stringify(result,null,2)+'\n');
  t.diagnostic(JSON.stringify(result));
});

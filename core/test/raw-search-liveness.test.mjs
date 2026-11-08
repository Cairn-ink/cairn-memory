import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {performance} from 'node:perf_hooks';
import {installRawSearchTestClock} from '../testing/raw-search-clock.mjs';
import {sourceFixture,savedSource} from '../testing/raw-source-fixtures.mjs';
import {searchFixture} from '../testing/raw-search-fixtures.mjs';
test.beforeEach(installRawSearchTestClock);
test('a candidate deadline is budget-shaped and the next search works after a canonical write',async t=>{
  const f=sourceFixture(t);await savedSource(f,'copper');const s=await searchFixture(f);await s.maintain();
  const own=Object.getOwnPropertyDescriptor(performance,'now');let now=100,armed=true,checks=0;
  Object.defineProperty(performance,'now',{configurable:true,value:()=>now});
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){const stmt=prepare.call(this,sql);
    if(sql.startsWith('SELECT 1 FROM raw_source_maps WHERE')){checks++;if(armed){armed=false;now+=1001;}}
    return stmt;
  };
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;if(own)Object.defineProperty(performance,'now',own);else delete performance.now;});
  const result=await s.search({query:'copper'});
  assert.deepEqual(result,{version:'raw-search-v1',publication:null,candidates:[],
    coverage:{status:'partial',scanned:null,expanded:null,causes:['deadline']},semantic:{state:'unknown',reason:null}});
  assert.equal(checks,1);
  f.db.exec('UPDATE raw_owner_usage SET revision=revision+1');
  assert.equal((await s.search({query:'copper'})).candidates.length,1);
});
test('search never rebuilds the full canonical commitment',async t=>{
  const f=sourceFixture(t);await savedSource(f,'copper');const s=await searchFixture(f);await s.maintain();
  const prepare=DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare=function(sql){assert.ok(!sql.startsWith('SELECT * FROM ('),'search must not run the commitment census');return prepare.call(this,sql);};
  t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
  assert.equal((await s.search({query:'copper'})).candidates.length,1);
});

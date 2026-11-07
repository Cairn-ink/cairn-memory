import test from 'node:test';
import assert from 'node:assert/strict';
import { safetySourceFixture,searchFixture } from '../testing/raw-search-fixtures.mjs';
import { savedSource,ns } from '../testing/raw-source-fixtures.mjs';
import { assertContentPort } from '../content-safety-boundary.mjs';
import { transaction } from '../database.mjs';
import { suppressOwnerInside } from '../content-suppression-storage.mjs';

test('fresh Raw operation inside a caller scope must not reuse pre-erasure suppression facts',{timeout:30000},async t=>{
  const f=safetySourceFixture(t);await savedSource(f,'copper confidential specimen');
  const open=f.port.openRaw;let opens=0;
  f.port.openRaw=async value=>{opens++;return open(value);};
  let armed=false,sourceAuthorizations=0;
  const s=await searchFixture(f,{setupHost(host){const authorize=host.authority.authorize;
    host.authority.authorize=function(request,token){
      if(armed&&request.method==='rawSearchSource')sourceAuthorizations++;
      return authorize.call(this,request,token);
    };}});await s.maintain();
  let before,after,ref,classification;
  await assertContentPort({invoke:async()=>{
    const first=await s.search({query:'copper'});assert.equal(first.candidates.length,1);ref=first.candidates[0].ranges[0];
    const epochs=f.db.prepare('SELECT * FROM namespace_epochs').all();
    transaction(f.db,()=>suppressOwnerInside(f.db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-real-owner-erasure'}));
    assert.equal(f.db.prepare('SELECT count(*) n FROM content_suppressions').get().n,1);
    assert.deepEqual(f.db.prepare('SELECT * FROM namespace_epochs').all(),epochs);
    armed=true;
    before=opens;
    await assert.rejects(s.service.prepareSource(ref,{intent:'current'},s.host.token),{code:'raw_search_unavailable'});
    after=opens;
  }});
  // A fresh outer call is the control: the same committed erasure is seen and
  // no opener is invoked. Only the inherited caller request differs.
  const controlBefore=opens;
  await assert.rejects(s.service.prepareSource(ref,{intent:'current'},s.host.token),{code:'raw_search_unavailable'});
  assert.equal(opens,controlBefore);
  assert.equal((await s.search({query:'copper'})).candidates.length,0);
  assert.equal(after-before,0,'no protected opener may receive erased Raw, even if a prior read populated the caller request memo');
  assert.equal(sourceAuthorizations,0,'no later source-bearing authority callback may receive erased Raw identity');
});

test('real Raw opener reentry must not emit source-bearing authority requests after owner erasure',{timeout:30000},async t=>{
  const f=safetySourceFixture(t);await savedSource(f,'copper confidential specimen');
  const originalOpen=f.port.openRaw;let service,runScenario=false,erased=false,sourceAuthorizations=0,deniedOpens=0,insideCalls=0,ref;
  f.port.openRaw=async input=>{
    if(erased)deniedOpens++;
    if(runScenario){
      runScenario=false;
      const first=await service.search({query:'copper'});assert.equal(first.candidates.length,1);ref=first.candidates[0].ranges[0];
      const epochs=f.db.prepare('SELECT * FROM namespace_epochs').all();
      transaction(f.db,()=>suppressOwnerInside(f.db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-opener-owner-erasure'}));
      assert.equal(f.db.prepare('SELECT count(*) n FROM content_suppressions').get().n,1);
      assert.deepEqual(f.db.prepare('SELECT * FROM namespace_epochs').all(),epochs);erased=true;
      await assert.rejects(service.service.prepareSource(ref,{intent:'current'},service.host.token),{code:'raw_search_unavailable'});
      insideCalls=sourceAuthorizations;
    }
    return originalOpen(input);
  };
  service=await searchFixture(f,{setupHost(host){const authorize=host.authority.authorize;
    host.authority.authorize=function(request,token){
      if(erased&&request.method==='rawSearchSource'){
        assert.ok(request.input.source,'this is a source-bearing request, not an empty scope check');sourceAuthorizations++;
      }
      return authorize.call(this,request,token);
    };}});
  await service.maintain();const candidate=(await service.search({query:'copper'})).candidates[0];runScenario=true;
  await assert.rejects(service.prepare(candidate),{code:'raw_search_unavailable'});assert.equal(erased,true);
  const before=sourceAuthorizations;
  await assert.rejects(service.service.prepareSource(ref,{intent:'current'},service.host.token),{code:'raw_search_unavailable'});
  assert.equal(sourceAuthorizations,before,'outside the original opener request the same committed denial is seen before authorization');
  assert.equal(deniedOpens,0,'the inner fresh opener wrapper still blocks plaintext');
  assert.equal(insideCalls,0,'a first opener that erases the owner must block the next source-bearing authority callback');
});

import { assertCostGateCell } from '../testing/content-safety-s2h-cost-inventory.mjs';
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { costGateFamilies, costFamilyLabel, costFamilyFixture, costMatrixGate } from '../testing/receipt-event-time-gates.mjs';
import { openMemoryCore } from '../index.mjs';
import { createCardReceiptSources } from '../card-receipt-sources.mjs';
import { keyed } from '../private-card-input.mjs';
import { transaction, readTransaction } from '../database.mjs';
import { contentReadSafety, createContentReadMemo } from '../content-safety.mjs';
import { contentSuppressionMayMatchInside, suppressOwnerInside, withContentSuppressionReadInside,
  withContentSuppressionRequest, writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
const projection={readSet:[ns],types:['memory'],intent:'current'};
const query={...projection,query:'Synthetic batch evidence',limit:12,deadlineMs:5000};
function facts(db,n=5) {
  transaction(db,()=>{for(let i=0;i<n;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-'+i,
    reason:'purge',actionId:'unrelated-'+i});});
}
function setup(t,f,patch={}) {
  const db=f.connect(),core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority,...patch}});
  t.after(()=>{core.close();db.close();});
  const memories=Array.from({length:3},(_,i)=>ok(core.admit({namespace:ns,memory:{content:'Synthetic batch evidence '+i,kind:'fact'},receipts:[receipt('batch-'+i)]})).memory);
  const refs=memories.map(m=>({type:'memory',namespace:ns,memoryId:m.id,revision:m.revision}));
  return {db,core,memories,refs};
}

const completeBatch=costMatrixGate('S2h-3 batch evidence regressions',costGateFamilies().length*19);
afterEach(t=>completeBatch(t.name));
for(const family of costGateFamilies()) {
// Fail-before on a6ec0e0e: every item used three Memory SELECTs per
// snapshot, in addition to receipt-source binding reads. The canonical batch
// now supplies each item's single S1+receipt decision.
for(const base of [18,23,33])for(const intent of ['current','history'])test(`batch evidence selected-row S1 v${base} ${intent}${costFamilyLabel(family,base)}`,async t=>{
  const f=costFamilyFixture(t,base,family);await f.migrate();const {db,core,refs}=setup(t,f);facts(db);
  assertCostGateCell(db,base,true,5,ns.ownerId,{family,testName:t.name,n:3});
  const row=await measureContentRead('fetchCandidateEvidence','selected-row',()=>core.fetchCandidateEvidence({readSet:[ns],intent,refs},{}));
  assert.equal(row.result.ok,true,JSON.stringify(row.result));assert.equal(row.result.value.items.length,3);
  // Control on a6ec0e0e: selected-row source refs keep the exact existing
  // canonical receipt binding, including its current Memory revision.
  readTransaction(db,()=>{
    const identity=db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
    const reader=createCardReceiptSources(db,(purpose,value)=>keyed(identity.cursorSecret,purpose,[identity.storeId,value]));
    for(const item of row.result.value.items)for(const source of item.provenance.sources){
      const memory=db.prepare('SELECT * FROM memories WHERE id=?').get(source.memoryId);
      const receipt=db.prepare('SELECT * FROM receipts WHERE id=?').get(source.receiptId);
      assert.deepEqual(source,reader.refInside(ns,memory,receipt));
    }
  });
  const memoryReads=row.sql.filter(([sql])=>/\bFROM memories\b/.test(sql)).reduce((n,[,count])=>n+count,0);
  assert.equal(memoryReads,2,'one canonical batch SELECT in each snapshot, including receipt-source bindings');
  assert.equal(row.sql.filter(([sql])=>/^SELECT id,revision,deleted,currentness,review_state/.test(sql)).reduce((n,[,count])=>n+count,0),0,'no duplicate S1 Memory refetches');
  assert.equal(row.ports,0);
  assert.doesNotMatch(JSON.stringify(row.result),/invalid_raw_ancestry|empty_raw_ancestry|batch_receipts|has_qualification|fact_documents|cursor_secret|selectedMemory/);
});

// Fail-before cost regression with correctness controls: two reasons for one
// key must subtract one document. Receipt facts do not suppress Memory text;
// they still filter that receipt from the final canonical evidence decision.
for(const base of [18,23,33])test(`batch visible documents v${base}: duplicate reasons and mixed receipt facts${costFamilyLabel(family,base)}`,async t=>{
  const f=costFamilyFixture(t,base,family);await f.migrate();const {db,core,memories,refs}=setup(t,f);
  ok(await core.refreshContextIndex({...projection,budget:{maxItems:1024,maxMs:5000}},{}));
  facts(db);
  const target=memories[0],receiptId=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memories[1].id).id;
  transaction(db,()=>{
    for(const reason of ['purge','privacy_erase'])writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:target.id,reason,actionId:reason});
    writeContentSuppressionInside(db,{namespace:ns,kind:'receipt',key:receiptId,reason:'purge',actionId:'receipt'});
  });
  assertCostGateCell(db,base,true,8,ns.ownerId,{family,testName:t.name,n:3});
  const row=await measureContentRead('findCandidates','duplicate-keys',()=>core.findCandidates(query,{}));
  assert.equal(row.result.ok,true,JSON.stringify(row.result));
  assert.deepEqual(new Set(row.result.value.items.map(item=>item.ref.memoryId)),new Set(memories.slice(1).map(m=>m.id)));
  const perFactQueries=row.sql.filter(([sql])=>/^SELECT revision,body_revision,eligible,token_length FROM documents/.test(sql)).reduce((n,[,count])=>n+count,0);
  // Control on a6ec0e0e: Raw-capable layouts retain unknown population counts.
  const counts=row.result.value.coverage.byType.memory;
  assert.equal(counts.eligible,base===33?null:2);
  assert.equal(counts.indexed,base===33?null:2);
  const evidence=ok(await core.fetchCandidateEvidence({readSet:[ns],intent:'current',refs:[refs[1]]},{}));
  assert.deepEqual(evidence.items[0].provenance.receiptMetadata,[],'positive receipt fact filters the selected canonical receipt page');
  assert.deepEqual(evidence.items[0].provenance.sources,[]);
  assert.equal((await core.fetchCandidateEvidence({readSet:[ns],intent:'history',refs:[refs[0]]},{})).ok,false);
  transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'namespace',matchMode:'namespace',reason:'privacy_erase',actionId:'namespace'}));
  const denied=await core.findCandidates(query,{});
  assert.equal(denied.ok,false);assert.doesNotMatch(JSON.stringify(denied),/Synthetic batch evidence/);
  assert.equal(perFactQueries,0,'fact-key metadata is projected into the existing totals/count queries');
});

// Controls on a6ec0e0e: a negative direct target proof cannot waive invalid
// canonical Raw ancestry, nor a possible Raw fact's conservative path.
for(const kind of ['foreign ancestry','Raw fact'])test(`batch applicability control: ${kind}${costFamilyLabel(family,33)}`,async t=>{
  const f=costFamilyFixture(t,33,family);await f.migrate();const {db,core,memories,refs}=setup(t,f);
  ok(await core.refreshContextIndex({...projection,budget:{maxItems:1024,maxMs:5000}},{}));
  facts(db);
  transaction(db,()=>{
    db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run('synthetic-raw',kind==='foreign ancestry'?'synthetic-foreign':ns.ownerId,
      ns.scope,ns.projectId,'codex','synthetic-session','time','time');
    const id=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memories[0].id).id;
    db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(id,'synthetic-raw','message',0,2,'exact');
    if(kind==='Raw fact')writeContentSuppressionInside(db,{namespace:ns,kind:'raw',key:'synthetic-raw',reason:'purge',actionId:'raw'});
  });
  withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],()=>{
    assert.equal(contentSuppressionMayMatchInside(db,ns,{kind:'memory',key:memories[0].id}),kind==='Raw fact');
    assert.equal(contentReadSafety(db,{namespace:ns,ref:refs[0],memo:createContentReadMemo(db)}).allowed,false);
  })));
  const candidates=await core.findCandidates(query,{});
  assert.equal(candidates.ok,true,JSON.stringify(candidates));
  assert.deepEqual(new Set(candidates.value.items.map(item=>item.ref.memoryId)),new Set(memories.slice(1).map(memory=>memory.id)),
    'uncertain canonical ancestry is filtered before ranking and counts, even with an empty direct fact intersection');
  const result=await core.fetchCandidateEvidence({readSet:[ns],intent:'history',refs:[refs[0]]},{});
  assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/Synthetic batch evidence/);
});

// Control on a6ec0e0e: explicit unknown origin is not an independence proof,
// even when all currently visible source-session intersections are empty.
test(`batch applicability control: unknown receipt origin retains full lineage${costFamilyLabel(family,33)}`,async t=>{
  const f=costFamilyFixture(t,33,family);await f.migrate();const {db,core,refs}=setup(t,f);facts(db);
  transaction(db,()=>db.prepare("UPDATE raw_receipt_origins SET kind='unknown' WHERE receipt_id IN (SELECT id FROM receipts WHERE memory_id=?)").run(refs[0].memoryId));
  assertCostGateCell(db,33,true,5,ns.ownerId,{family,testName:t.name,n:3});
  const row=await measureContentRead('fetchCandidateEvidence','unknown-origin',()=>core.fetchCandidateEvidence({readSet:[ns],intent:'current',refs:[refs[0]]},{}));
  assert.equal(row.result.ok,true,JSON.stringify(row.result));
  assert.ok(row.sql.some(([sql,count])=>count>0 && /FROM raw_receipt_lineage l LEFT JOIN raw_conversations/.test(sql)),
    'unknown ancestry keeps the canonical stored-lineage read');
});

// Controls on a6ec0e0e: 4096 is complete; 4097 is an indexed fallback, never a
// truncated negative proof. The unrelated payload remains canonically checked.
test(`batch applicability control: exact 4096/4097 boundary${costFamilyLabel(family,33)}`,async t=>{
  const f=costFamilyFixture(t,33,family);await f.migrate();const {db,refs}=setup(t,f);facts(db,4096);
  const inspect=expected=>withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],state=>{
    assert.equal(state.facts===null,expected===4097);
    if(state.facts)assert.equal(state.facts.length,4096);
    assert.equal(contentSuppressionMayMatchInside(db,ns,{kind:'memory',key:refs[0].memoryId}),expected===4097);
    assert.equal(contentReadSafety(db,{namespace:ns,ref:refs[0],memo:createContentReadMemo(db)}).allowed,true);
  })));
  inspect(4096);facts(db,4097);inspect(4097);
});

// Controls on a6ec0e0e: the reduced candidate work must leave the actual
// caller-return fence intact. A committed fact stops the very next payload.
for(const mutation of ['forget','correct','account erasure'])test(`batch counter control: ${mutation}${costFamilyLabel(family,33)}`,async t=>{
  const f=costFamilyFixture(t,33,family);await f.migrate();let armed=false,fired=false,next=0;
  const fixture=setup(t,f,{counter:{id:'synthetic-batch-counter',countTokens(){
    if(fired)next++;
    if(armed&&!fired){
      assert.equal(fixture.db.isTransaction,false);
      const target=fixture.memories[0];
      if(mutation==='account erasure')transaction(fixture.db,()=>suppressOwnerInside(fixture.db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'counter'}));
      else ok(fixture.core[mutation]({namespace:ns,memoryId:target.id,expectedRevision:target.revision,
        ...(mutation==='correct'?{content:'Synthetic replacement',kind:'fact',receipt:receipt('replacement')}:{} )}));
      fired=true;
    }
    return 1;
  }}});
  facts(fixture.db);armed=true;
  const result=await fixture.core.contextRead({...projection,query:query.query,budget:{maxTokens:4000,maxItems:12},deadlineMs:5000},{});
  assert.equal(fired,true);assert.equal(next,0);assert.equal(result.ok,false);
  assert.doesNotMatch(JSON.stringify(result),/Synthetic batch evidence/);
});

// Controls on a6ec0e0e: materialization/thenable assimilation happens within
// the caller boundary, before its one outer E1. No return hook survives it.
for(const shape of ['getter','Proxy','thenable'])test(`batch embed return control: ${shape}${costFamilyLabel(family,33)}`,async t=>{
  const f=costFamilyFixture(t,33,family);await f.migrate();let armed=false,fired=false,after=0,hooks=0,fixture;
  const erase=()=>{if(fired)return;transaction(fixture.db,()=>suppressOwnerInside(fixture.db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'return'}));fired=true;};
  fixture=setup(t,f,{embedder:{id:'synthetic-batch-'+shape,revision:'1',dimensions:2,normalization:'l2',embed(texts){
    if(fired)after++;
    if(!armed)return texts.map(()=>[1,0]);
    if(shape==='thenable')return {then(resolve){erase();resolve(texts.map(()=>[1,0]));}};
    if(shape==='Proxy')return new Proxy(texts.map(()=>[1,0]),{get(target,key,receiver){hooks++;erase();return Reflect.get(target,key,receiver);},ownKeys(target){hooks++;erase();return Reflect.ownKeys(target);}});
    const result=[];Object.defineProperty(result,0,{enumerable:true,get(){erase();return [1,0];}});return result;
  }},policy:{family:'local',maxRequests:10000,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}});
  // Same-namespace unrelated facts are present before refresh, as in the cost
  // fixture. Its established maintenance refusal happens after index work.
  facts(fixture.db);armed=true;
  const result=await fixture.core.refreshContextIndex({...projection,budget:{maxItems:1024,maxMs:5000}},{});
  assert.equal(fired,true);assert.equal(after,0);assert.equal(hooks,shape==='Proxy'?1:0,'only caller-boundary thenable assimilation may touch the Proxy');assert.equal(result.ok,false);
  assert.doesNotMatch(JSON.stringify(result),/Synthetic batch evidence/);
});

}

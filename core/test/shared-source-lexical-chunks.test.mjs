import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fixture, trace, memoryRef, hasId } from '../testing/shared-source-fixture.mjs';
import { ns, ok, receipt } from '../testing/card-lineage-fixture.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { productSidecar } from '../context-product-sidecar.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { descriptor } from '../testing/context-product-owner-fixture.mjs';
import { createBM25 } from '../context-read-bm25.mjs';
import { cardDeliverySnapshot, cardDeliverable, receiptDenialTokens } from '../content-safety.mjs';
import { readTransaction } from '../database.mjs';

const routes=['embedded','ordinary','suppressed'];
const collector=row=>row.sql.includes('CROSS JOIN card_memory_bindings b');
const query='needle pear';
const selection={readSet:[ns],types:['card'],intent:'current'};
const projection={...selection,accessGeneration:1};

// Public Card creation follows the existing shared-source context fixture;
// admit avoids model work. Independent Memories avoid dependent-Card limits.
function card(f,i){
  const memory=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic support '+i,kind:'fact'},
    receipts:[receipt('synthetic-chunk-'+i)]})).memory;
  const title='Synthetic needle '+i,body=i%2?'needle pear pear':'needle needle pear';
  let value=ok(f.call('createCardDraft',{actionId:'synthetic-chunk-draft-'+i,drafting:'authored',
    input:{title,body,memoryRefs:[memoryRef(memory)],sourcePolicy:'retained-receipts-v1'}}));
  value=ok(f.call('confirmCardDraft',{actionId:'synthetic-chunk-confirm-'+i,cardId:value.id,
    expectedRevision:value.revision,applicability:'current'}));
  return {memory,ref:{type:'card',namespace:ns,cardId:value.id,revision:value.revision,bodyRevision:value.bodyRevision},text:title+'\n'+body};
}

function sidecar(t,f,route,clock=()=>performance.now()){
  if(route==='embedded'){
    const storage=openContextReadSidecar({path:f.path,db:f.db});t.after(()=>storage.close());
    return {storage,refresh(){
      for(let i=0;i<16;i++)if(storage.reconcile({...projection,budget:{maxItems:1024,maxMs:5000}}).status==='complete')return;
      assert.fail('embedded publication did not finish');
    },lexical(deadlineAt=Infinity){return storage.lexicalPage(projection,query,24,{deadlineAt});}};
  }
  const facade=openContextProductFacade(f.path,{}),p={...projection,ownerCoverage:descriptor([ns])};
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,
    features:facade.port.features,writable:true,now:clock});
  t.after(()=>{storage.close();facade.close();});
  const access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}});let publication;
  return {storage,refresh(){
    for(let i=0;i<16;i++){
      storage.refresh(p,access,{maxItems:1024,maxMs:5000});
      const observed=storage.observe(p,access);
      if(observed.dto.lexical.state==='ready'){publication=observed.publication;return;}
    }
    assert.fail('product publication did not finish');
  },lexical(deadlineAt=Infinity){return storage.lexical({...p,deadlineAt},publication,query);}};
}

function pages(t,f,route){
  if(route==='embedded')return input=>f.trusted.call(f.context,'findCandidates',input);
  const facade=openContextProductFacade(f.path,{});
  const index=openProductIndex({path:f.path,facade,ownerCoverage:descriptor([ns]),maintenance:true,
    authorize:()=>({accessGenerations:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),check(){},envelope:work=>work()})});
  t.after(()=>{index.close();facade.close();});
  return input=>index.run('findCandidates',input,{});
}

async function cachedPages(call){
  const values=[];let cursor;
  for(let i=0;i<24;i++){
    const value=ok(await call({...selection,query,semantic:false,limit:1,deadlineMs:5000,...(cursor?{cursor}:{})}));
    values.push(value);cursor=value.nextCursor;
    if(!cursor)return values;
  }
  assert.fail('ranking pagination exceeded its 24-row horizon');
}

// Extend the cooperative lexical deadline contract and product timeout mapping
// with expiry inside the Card population, rather than only at entry/guard time.
for(const route of routes)test(`Card token chunks and mid-population deadline: ${route}`,{timeout:120000},async t=>{
  const f=await fixture(t,route==='ordinary'?'ordinary-48':'ordinary-53');
  const documents=Array.from({length:300},(_,i)=>card(f,i));
  let clock=0,samples=0;
  const a=sidecar(t,f,route,()=>{samples++;return clock;});a.refresh();
  const measured=await trace(()=>a.lexical()),collections=measured.rows.filter(collector);
  // The embedded final validation is a separate canonical snapshot of <=24
  // selected rows. Population chunks share one fence snapshot.
  const population=route==='embedded'?collections.filter(row=>row.snapshot===collections[0].snapshot):collections;
  assert.deepEqual(population.map(row=>JSON.parse(row.args[0]).length),[128,128,44]);
  assert.equal(population.length,Math.ceil(documents.length/128));
  assert.ok(collections.every(row=>JSON.parse(row.args[0]).length<=128));
  assert.equal(measured.result.matched,300);
  const expected=createBM25(documents.map(d=>({ref:d.ref,text:d.text}))).search(query);
  assert.deepEqual(measured.result.rows,expected,'unchanged BM25 arithmetic, order and ties');
  const ordered=expected.map(({ref,score})=>{
    const selected=route==='embedded'?{type:ref.type,namespace:ref.namespace,revision:ref.revision,
      cardId:ref.cardId,bodyRevision:ref.bodyRevision}:ref;
    return route==='ordinary'?{score,ref:selected}:{ref:selected,score};
  });
  assert.equal(JSON.stringify(measured.result.rows),JSON.stringify(ordered),'base row/ref key order and bytes');
  const original=performance.now.bind(performance);let expired=false,reads=0,checksAfterExpiry=0,samplesAtExpiry;
  t.mock.method(performance,'now',()=>{
    if(expired)checksAfterExpiry++;
    return expired?Number.MAX_SAFE_INTEGER:original();
  });
  const cutoff=route==='embedded'?original()+5000:1;
  const timed=await trace(()=>{
    assert.throws(()=>a.lexical(cutoff),route==='embedded'?{code:'index_unavailable',reason:'timeout'}:{code:'read_timeout'});
  },(sql)=>{
    if(collector({sql})&&++reads===1){expired=true;clock=1;samplesAtExpiry=samples;}
  });
  assert.equal(timed.rows.filter(collector).length,1,'no second token statement after cutoff');
  assert.ok(route==='embedded'?checksAfterExpiry>0:samples>samplesAtExpiry,'existing clock consulted after the first chunk');
  expired=false;clock=0;reads=0;
  const call=pages(t,f,route);
  const delivered=await trace(()=>call({...selection,query,semantic:false,limit:1,deadlineMs:5000}),sql=>{
    if(collector({sql})&&++reads===1)expired=true;
  });
  assert.equal(delivered.rows.filter(collector).length,1);
  if(route==='embedded'){
    assert.equal(delivered.result.ok,false);assert.equal(delivered.result.error.code,'index_unavailable');
    const details=delivered.result.error.details;
    assert.equal(details.channels.lexical.state,'timeout');assert.equal(details.coverage.stops.deadline,true);
  }else assert.deepEqual(delivered.result,{ok:false,error:{code:'read_timeout',retryable:false}});
});

for(const kind of ['ordinary-48','ordinary-53'])
test(`one Card token statement for a chunk spanning namespaces: ${kind}`,async t=>{
  const f=await fixture(t,kind),first=card(f,0),other={...ns,scope:'personal',projectId:null};
  const memory=ok(f.core.admit({namespace:other,memory:{content:'Synthetic other support',kind:'fact'},
    receipts:[receipt('synthetic-other-chunk')]})).memory;
  let second=ok(f.call('createCardDraft',{namespace:other,actionId:'synthetic-other-draft',drafting:'authored',
    input:{title:'Synthetic needle',body:'Synthetic pear',memoryRefs:[{...memoryRef(memory),namespace:other}],sourcePolicy:'retained-receipts-v1'}}));
  second=ok(f.call('confirmCardDraft',{namespace:other,actionId:'synthetic-other-confirm',cardId:second.id,
    expectedRevision:second.revision,applicability:'current'}));
  const refs=[first.ref,{type:'card',namespace:other,cardId:second.id}];
  const header=f.db.prepare('SELECT receipt_key,client,session_id,event_id,role FROM receipts WHERE memory_id=?').get(memory.id);
  // The same token under the other boundary cannot deny the first Card.
  for(const token of receiptDenialTokens([header]))f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)')
    .run(other.ownerId,other.scope,'',token);
  const measured=await trace(()=>readTransaction(f.db,()=>{
    const memo=cardDeliverySnapshot(f.db,[...refs,...refs]);
    cardDeliverySnapshot(f.db,refs,memo);
    return refs.map(ref=>cardDeliverable(f.db,ref.namespace,ref.cardId,memo));
  }));
  assert.deepEqual(measured.result,[true,false]);
  const collections=measured.rows.filter(collector);assert.equal(collections.length,1);
  assert.equal(JSON.parse(collections[0].args[0]).length,2,'deduplicated full boundary tuples');
  assert.doesNotMatch(collections[0].sql,/excerpt|r\.\*/);
});

for(const route of routes)test(`withheld Card has no lexical population or cached ranking contribution: ${route}`,{timeout:60000},async t=>{
  const f=await fixture(t,route==='ordinary'?'ordinary-48':'ordinary-53');
  Array.from({length:30},(_,i)=>card(f,i));
  const a=sidecar(t,f,route);a.refresh();
  const call=pages(t,f,route),before=a.lexical(),beforePages=await cachedPages(call);
  const denied=card(f,30);
  const headers=f.db.prepare('SELECT receipt_key,client,session_id,event_id,role FROM receipts WHERE memory_id=?').all(denied.memory.id);
  for(const token of receiptDenialTokens(headers))f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId,ns.scope,ns.projectId,token);
  a.refresh();
  const measured=await trace(()=>a.lexical()),after=measured.result,afterPages=await cachedPages(call);
  assert.equal(measured.rows.filter(collector).length,route==='ordinary'?2:route==='embedded'?2:1,
    'ordinary statistics correction replays bounded chunks; embedded retains its independent final fence');
  assert.equal(before.matched,30);assert.equal(after.matched,before.matched);
  assert.deepEqual(after.rows,before.rows,'withholding equals absence, including scores and ties');
  assert.deepEqual(afterPages.map(p=>p.coverage.omitted),beforePages.map(p=>p.coverage.omitted));
  assert.deepEqual(afterPages.flatMap(p=>p.items),beforePages.flatMap(p=>p.items));
  for(const value of [after,...afterPages])assert.equal(hasId(value,denied.ref.cardId),false,'id absent from results, diagnostics and cached pages');
});

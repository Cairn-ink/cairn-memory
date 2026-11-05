import test from 'node:test';
import assert from 'node:assert/strict';
import * as sidecar from '../context-product-sidecar.mjs';
import { candidateAllowedReference } from '../testing/content-safety-s2h-candidate-oracle.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { readTransaction, transaction } from '../database.mjs';
import { withContentSuppressionRequest, withContentSuppressionReadInside, writeContentSuppressionInside } from '../content-suppression-storage.mjs';

const seeds=[17,41];
const ancestries=['none','in-scope','foreign-owner','foreign-namespace','mixed'];
const states=['live','forgotten','conversation','overlap','disjoint','whole-message'];
const memoryFacts=['zero','forgotten','receipt','correction','owner','namespace','disjoint','version'];
const precisions=['exact','whole-message'];
const oracleOnly=process.env.CAIRN_S2H_ORACLE_ONLY==='1';
// Fixture order, subset order and duplicate positions are deterministic. UUIDs
// are supplied by public writers; no generated decision is sampled or skipped.
function random(seed){return ()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/2**32;};}
for(const base of [18,23,33])test(`Memory batch equals the pre-batch S1 oracle v${base}`,async t=>{
 const f=safetyFixture(t,base);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});
 const raw=base===33?openRawCaptureCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[{content:'Synthetic captured interpretation',kind:'fact',confidence:.8,sourceIndices:[0]}]})}},
  {mode:'raw-v1',deletion:true,port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})}):null;
 t.after(()=>{raw?.close();core.close();db.close();});
 let fixtures=0,cases=0,candidates=0,allowedCount=0,deniedCount=0;
 const mismatches=[];
 let measuring=false,statementCount=0,sqlReported=false;const prepare=db.prepare;
 db.prepare=function(sql){if(measuring){statementCount++;if(!sqlReported&&sql.startsWith('WITH candidates')){t.diagnostic('BATCH_SQL '+JSON.stringify({base,sql}));sqlReported=true;}}return prepare.call(this,sql);};
 const exec=db.exec;db.exec=function(sql){assert.equal(measuring,false,'batch never executes transaction control');return exec.call(this,sql);};
 const ancestryValues=base===33?ancestries:['none'],stateValues=base===33?states:['live'],precisionValues=base===33?precisions:['exact'];
 for(const seed of seeds){const rng=random(seed);
  for(const ancestry of ancestryValues)for(const state of stateValues)for(const precision of precisionValues)for(const fact of memoryFacts){
   const serial=fixtures++,a={...ns,ownerId:'synthetic-batch-'+base+'-'+serial,projectId:'selected'},b={...a,projectId:'second'},foreign={...a,ownerId:a.ownerId+'-foreign',projectId:'foreign'};
   const admit=(namespace,label)=>ok(core.admit({namespace,memory:{content:'Synthetic '+label+' '+serial,kind:'fact'},receipts:[receipt('batch-'+serial+'-'+label)]})).memory;
   const m=admit(a,'subject'),neighbor=admit(a,'neighbor'),second=admit(b,'second'),other=admit(foreign,'foreign');
   const originalReceiptId=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id;
   const ref=(memory,namespace)=>({type:'memory',namespace,memoryId:memory.id,revision:memory.revision});
   // Perform public Memory mutations before injecting unsafe ancestry.
   if(fact==='forgotten')ok(core.forget({namespace:a,memoryId:m.id,expectedRevision:m.revision}));
   else if(fact==='correction')ok(core.correct({namespace:a,memoryId:m.id,expectedRevision:m.revision,content:'Synthetic corrected '+serial,kind:'fact',receipt:receipt('correct-'+serial)}));
   let captured;
   if(ancestry!=='none'){
    const sourceNS=ancestry==='foreign-owner'?foreign:ancestry==='foreign-namespace'?b:a;
    const part=splitRaw('Synthetic captured source for batch '+serial)[0];
    captured=ok(await raw.captureRaw(request(part,{namespace:sourceNS,sessionId:'batch-'+serial,eventId:'batch-'+serial})));
    // Public capture supplies authentic roots/receipts. Transplanting a stored
    // lineage edge is intentional fault injection: public writers forbid the
    // foreign/mixed ancestry which canonical S1 must nevertheless refuse.
    const source=db.prepare('SELECT * FROM raw_receipt_lineage WHERE conversation_id=? LIMIT 1').get(captured.raw.conversationId);
    assert.ok(source,'public Raw capture creates lineage');
    // Delete authentic sources before installing impossible ancestry. A
    // deleted source has no live header: the deliberately dangling edge tests
    // S1's missing-origin refusal. Only this fixture connection disables FKs,
    // synchronously and temporarily; public writers keep their own FK checks.
    if(state==='forgotten'){
     const revision=db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(source.conversation_id).revision;
     ok(raw.deleteConversation({namespace:sourceNS,conversationId:source.conversation_id,expectedRevision:revision,actionId:'delete-'+serial}));
     db.exec('PRAGMA foreign_keys=OFF');
    }
    try{transaction(db,()=>{
     const rid=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id)?.id;
     if(rid)db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(rid,source.conversation_id,source.message_id,source.start,source.end,precision);
     if(rid&&ancestry==='mixed'){
      const foreignRoot='synthetic-mixed-'+serial;
      db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run(foreignRoot,foreign.ownerId,foreign.scope,foreign.projectId,'codex','mixed-'+serial,'time','time');
      db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(rid,foreignRoot,source.message_id,0,1,precision);
     }
     if(['conversation','overlap','disjoint','whole-message'].includes(state))writeContentSuppressionInside(db,{namespace:sourceNS,kind:'raw',key:source.conversation_id,
      ...(state==='conversation'?{}:{matchMode:'span',messageId:source.message_id,start:state==='disjoint'?source.end+1:0,end:state==='disjoint'?source.end+2:state==='whole-message'?10000:1}),reason:'privacy_erase',actionId:'raw-'+serial});
    });}finally{if(state==='forgotten')db.exec('PRAGMA foreign_keys=ON');}
   }
   if(!['zero','forgotten','correction'].includes(fact))transaction(db,()=>writeContentSuppressionInside(db,{namespace:fact==='owner'?{ownerId:a.ownerId,scope:'owner',projectId:''}:a,
    kind:fact==='receipt'?'receipt':fact==='owner'?'owner':fact==='namespace'?'namespace':'memory',key:['owner','namespace'].includes(fact)?'':fact==='receipt'?originalReceiptId:fact==='disjoint'?'unrelated-'+serial:m.id,
    ...(fact==='owner'?{matchMode:'owner'}:fact==='namespace'?{matchMode:'namespace'}:fact==='version'?{matchMode:'version',sourceVersion:JSON.stringify(['memory-revision-v1',m.revision])}:{}),reason:'purge',actionId:'memory-'+serial}));
   const refs=[ref(m,a),ref(neighbor,a),ref(second,b),ref(other,foreign),{...ref(m,a),revision:99},{...ref(m,a),memoryId:'missing-'+serial}];
   // Include pre-correction and current revision; include duplicates across
   // terms in nontrivial orders, then validate the entire retained order.
   if(fact==='correction')refs.push({...ref(m,a),revision:db.prepare('SELECT revision FROM memories WHERE id=?').get(m.id).revision});
   const shuffled=[...refs];for(let i=shuffled.length-1;i>0;i--){const j=Math.floor(rng()*(i+1));[shuffled[i],shuffled[j]]=[shuffled[j],shuffled[i]];}
   shuffled.push(shuffled[0],shuffled[1]);
   for(const readSet of [[a],[a,b],[a,b,foreign]])for(const intent of ['current','history']){
    const p={readSet,intent},identity={};
    withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,readSet,()=>{
     const expected=shuffled.map(r=>candidateAllowedReference(db,identity,{},r,p));
     // Final canonical S1 remains a separate reference, including every deny.
     assert.deepEqual(expected,shuffled.map(r=>candidateAllowedReference(db,identity,{},r,p)));
     for(const indices of [[],[0],shuffled.map((_,i)=>i),expected.flatMap((yes,i)=>yes?[i]:[]),expected.flatMap((yes,i)=>yes?[]:[i]),Array.from({length:24},(_,i)=>i%shuffled.length)]){
      const input=indices.map(i=>shuffled[i]),reference=indices.map(i=>expected[i]);
      statementCount=0;measuring=!oracleOnly;
      const actual=oracleOnly?input.map(r=>candidateAllowedReference(db,identity,{},r,p)):sidecar.memoryCandidatesAllowedInside(db,input,p,identity);
      measuring=false;
      if(!oracleOnly)assert.equal(statementCount,input.length?1:0,'one statement for every nonempty batch, including 24 candidates');
      const label=JSON.stringify({base,seed,ancestry,state,precision,fact,readSet:readSet.length,intent,case:cases});
      if(JSON.stringify(actual)!==JSON.stringify(reference))mismatches.push({label,actual,reference});
      if(JSON.stringify(input.filter((_,i)=>actual[i]))!==JSON.stringify(input.filter((_,i)=>reference[i])))assert.ok(mismatches.some(m=>m.label===label),'retained order '+label);
      cases++;candidates+=input.length;allowedCount+=reference.filter(Boolean).length;deniedCount+=reference.filter(x=>!x).length;
     }
    })));
   }
  }
 }
 t.diagnostic('BATCH_DIFFERENTIAL '+JSON.stringify({node:process.version,base,seeds,fixtures,cases,candidates,allowed:allowedCount,denied:deniedCount,oracleOnly,mismatchCases:mismatches.length}));
 assert.ok(cases&&allowedCount&&deniedCount);
 assert.equal(mismatches.length,0,JSON.stringify({count:mismatches.length,first:mismatches.slice(0,3)}));
});

import '../testing/context-product-test-clock.mjs';
import { costFamilyFixture, costGateFamilies } from '../testing/content-safety-cost-families.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { ns,ok,receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { accessDigest } from '../context-product-validation.mjs';
import { createProductSqlitePolicy } from '../context-product-sqlite.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
const refresh={readSet:[ns],types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}};
function product(t,f,maintenance,counter){
 const sqlite=createProductSqlitePolicy();sqlite.start(Number(process.hrtime.bigint())/1e6+5000);const facade=openContextProductFacade(f.path,{sqlite});t.after(()=>facade.close());
 const access={accessGenerations:accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}}),check(){},envelope:f=>f()};
 const index=openProductIndex({path:f.path,facade,sqlite,maintenance,counter,authorize:()=>access,ownerCoverage:{policy:'recent-projects-v1',selectionRevision:'synthetic',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0}});t.after(()=>index.close());return index;
}
for(const family of costGateFamilies())for(const ancestry of ['foreign-owner','cross-namespace','after-fence'])for(const facts of ['same-namespace','scoped-empty'])test(`R4 ${family} ${ancestry} ${facts}`,async t=>{
 const f=costFamilyFixture(t,33,family);await f.migrate();const db=f.connect();db.exec('PRAGMA journal_mode=WAL');
 const core=openMemoryCore({path:f.path});t.after(()=>{core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic review protected foreign ancestry',kind:'fact'},receipts:[receipt('review-foreign')]})).memory;
 const maintainer=product(t,f,true);ok(maintainer.run('refreshContextIndex',refresh));
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:facts==='same-namespace'?ns:{...ns,projectId:'unselected'},kind:'memory',key:'unrelated-review-memory',reason:'purge',actionId:'review-unrelated'}));
 const add=()=>transaction(db,()=>{
  db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run('review-raw',ancestry==='cross-namespace'?ns.ownerId:'foreign-review-owner',ns.scope,ancestry==='cross-namespace'?'foreign-project':ns.projectId,'codex','review-session','time','time');
  const id=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id).id;
  db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(id,'review-raw','message',0,2,'exact');
 });
 if(ancestry!=='after-fence')add();
 let inserted=false;
 if(ancestry==='after-fence'){
  const native=DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){const stmt=Reflect.apply(native,this,[sql]);if(!sql.includes('AS raw_lineage_present')&&sql!=='SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?')return stmt;
   const get=stmt.get;stmt.get=function(...args){const result=Reflect.apply(get,this,args);if(!inserted){if(Object.hasOwn(result,'raw_lineage_present'))assert.equal(result.raw_lineage_present,0);else assert.equal(db.prepare('SELECT count(*) n FROM raw_receipt_lineage').get().n,0);inserted=true;add();}return result;};return stmt;
  });
 }
 let protectedCounter=0;const reader=product(t,f,false,{id:'review',countTokens(text){if(text.includes('Synthetic review protected foreign ancestry'))protectedCounter++;return 1;}});
 for(const method of ['findCandidates','contextRead']){
  const result=await reader.run(method,{readSet:[ns],types:['memory'],intent:'current',query:'foreign',...(method==='findCandidates'?{limit:12}:{budget:{maxItems:4,maxTokens:2000}})});
  t.diagnostic(JSON.stringify({node:process.version,ancestry,facts,method,ok:result.ok,error:result.error?.code,items:result.value?.items?.length??result.value?.metered?.items?.length}));
  if(ancestry!=='after-fence'&&facts==='same-namespace')assert.equal(result.ok,true,'R4 must remove foreign ancestry before paging');
  if(result.ok){const items=result.value.items??result.value.metered.items;assert.equal(items.length,0,'foreign Raw ancestry is never an eligible candidate');}
  assert.doesNotMatch(JSON.stringify(result),/Synthetic review protected foreign ancestry/,'foreign body never delivered');
 }
 assert.equal(protectedCounter,0,'foreign body never reaches counter');
 if(ancestry==='after-fence')assert.equal(inserted,true,'Raw row committed after an observed empty presence bit');
});
for(const family of costGateFamilies())for(const base of [23,33])test(`historical Card contributor stays canonical ${family} v${base}`,async t=>{
 const f=costFamilyFixture(t,base,family);await f.migrate();const host=cardHost(),core=openMemoryCore({path:f.path,privateCards:host.options}),db=f.connect();t.after(()=>{core.close();db.close();});
 const call=(method,input)=>host.call(core,method,{namespace:ns,...input});
 const card=ok(call('createCardDraft',{actionId:'review-card',drafting:'authored',input:{title:'Synthetic review Card',body:'Synthetic review Card body',authoredInput:{text:'Synthetic review note',occurredAt:null}}}));
 ok(call('confirmCardDraft',{actionId:'review-confirm',cardId:card.id,expectedRevision:card.revision}));
 const maintainer=product(t,f,true);ok(maintainer.run('refreshContextIndex',{...refresh,types:['card'],intent:'history'}));
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'review-unrelated',reason:'purge',actionId:'review-unrelated'}));
 const detail=ok(call('getCard',{cardId:card.id})).card;t.diagnostic('REVIEW_CARD '+JSON.stringify({state:detail.state,support:detail.support}));const reader=product(t,f,false);const query={readSet:[ns],types:['card'],intent:'history',query:'review',limit:12};
 assert.equal(ok(reader.run('findCandidates',query)).items.length,1,'unrelated Memory fact preserves the canonical Card');
 const note=db.prepare('SELECT id FROM card_notes LIMIT 1').get().id;
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'submitted-note',key:note,reason:'privacy_erase',actionId:'review-note'}));
 const result=reader.run('findCandidates',query);if(result.ok)assert.equal(result.value.items.length,0,'suppressed contributor excludes Card');
 assert.doesNotMatch(JSON.stringify(result),/Synthetic review Card body/);
});
for(const family of costGateFamilies())for(const base of [18,23,33])test(`receipt suppression removes excerpt before counter ${family} v${base}`,async t=>{
 const f=costFamilyFixture(t,base,family);await f.migrate();const core=openMemoryCore({path:f.path}),db=f.connect();t.after(()=>{core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic review body',kind:'fact'},receipts:[receipt('review-receipt','Synthetic review protected excerpt')]})).memory;
 const maintainer=product(t,f,true);ok(maintainer.run('refreshContextIndex',refresh));
 const id=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id).id;
 transaction(db,()=>writeContentSuppressionInside(db,{namespace:ns,kind:'receipt',key:id,reason:'privacy_erase',actionId:'review-receipt'}));
 let leaked=0;const reader=product(t,f,false,{id:'review',countTokens(text){if(text.includes('Synthetic review protected excerpt'))leaked++;return 1;}});
 const result=ok(reader.run('contextRead',{readSet:[ns],types:['memory'],intent:'current',query:'review',budget:{maxItems:4,maxTokens:2000}}));
 assert.doesNotMatch(JSON.stringify(result),/Synthetic review protected excerpt/);assert.equal(leaked,0);
});

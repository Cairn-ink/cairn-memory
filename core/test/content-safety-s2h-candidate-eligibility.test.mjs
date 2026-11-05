import '../testing/context-product-test-clock.mjs';
import {costFamilyFixture,costFamilyPhysical,costGateFamilies} from '../testing/content-safety-cost-families.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {ns,ok,receipt} from '../testing/content-safety-s2h-fixture.mjs';
import {openMemoryCore} from '../index.mjs';
import {contentReadSafety,memoryReadEligible} from '../content-safety.mjs';
import {memoryCandidatesAllowedInside} from '../context-product-sidecar.mjs';
import {readTransaction} from '../database.mjs';
import {withContentSuppressionRequest,withContentSuppressionReadInside} from '../content-suppression-storage.mjs';
for(const family of costGateFamilies())for(const base of [18,23,33])test(`current retrieval refuses exact current revision of superseded Memory ${family} v${base}`,async t=>{
 const f=costFamilyFixture(t,base,family);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});
 assert.equal(db.prepare('PRAGMA user_version').get().user_version,costFamilyPhysical(base,family),'actual eligibility witness physical layout');
 t.after(()=>{core.close();db.close();});
 for(const eligibility of ['superseded','current','awaiting','deleted','missing']){
 const m=ok(core.admit({namespace:ns,memory:{content:'Synthetic predecessor policy witness '+eligibility,kind:'fact'},receipts:[receipt('policy-old-'+eligibility)]})).memory;
 if(eligibility==='superseded')ok(core.supersede({namespace:ns,memoryId:m.id,expectedRevision:m.revision,replacement:{content:'Synthetic successor policy witness',kind:'fact'},receipts:[receipt('policy-new-'+eligibility)]}));
 if(eligibility==='awaiting')db.prepare("UPDATE memories SET review_state='awaiting' WHERE id=?").run(m.id);
 if(eligibility==='deleted')db.prepare('UPDATE memories SET deleted=1,content=NULL WHERE id=?').run(m.id);
 const row=eligibility==='missing'?null:db.prepare('SELECT revision,deleted,currentness,review_state FROM memories WHERE id=?').get(m.id);
 if(eligibility==='superseded')assert.equal(row.currentness,'historical');
 const ref={type:'memory',namespace:ns,memoryId:eligibility==='missing'?'synthetic-missing':m.id,revision:row?.revision??1};
 for(const intent of ['current','history'])withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],()=>{
  const expected=eligibility==='current'||intent==='history'&&['superseded','awaiting'].includes(eligibility);
  const old=contentReadSafety(db,{identity:{},namespace:ns,ref,intent}).allowed;
  const batch=memoryCandidatesAllowedInside(db,[ref],{readSet:[ns],intent},{});
  t.diagnostic(JSON.stringify({family,base,physical:costFamilyPhysical(base,family),eligibility,intent,expected,old,batch}));
  assert.deepEqual([old,...batch],[expected,expected],'spec incremental-catchup:237-258 / context-read-product:2086 '+eligibility+' '+intent);
  assert.equal(memoryReadEligible(row,intent),expected,'helper contract '+eligibility+' '+intent);
 })));
 }
});

import '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {safetyFixture,ns,ok,receipt} from '../testing/content-safety-s2h-fixture.mjs';
import {openMemoryCore} from '../index.mjs';
import {contentReadSafety} from '../content-safety.mjs';
import {memoryCandidatesAllowedInside} from '../context-product-sidecar.mjs';
import {readTransaction} from '../database.mjs';
import {withContentSuppressionRequest,withContentSuppressionReadInside} from '../content-suppression-storage.mjs';
test('current retrieval refuses exact current revision of superseded Memory',async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});
 t.after(()=>{core.close();db.close();});
 const m=ok(core.admit({namespace:ns,memory:{content:'Synthetic predecessor policy witness',kind:'fact'},receipts:[receipt('policy-old')]})).memory;
 ok(core.supersede({namespace:ns,memoryId:m.id,expectedRevision:m.revision,replacement:{content:'Synthetic successor policy witness',kind:'fact'},receipts:[receipt('policy-new')]}));
 const row=db.prepare('SELECT revision,currentness FROM memories WHERE id=?').get(m.id);
 assert.equal(row.currentness,'historical');
 const ref={type:'memory',namespace:ns,memoryId:m.id,revision:row.revision};
 for(const intent of ['current','history'])withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],()=>{
  const expected=intent==='history';
  const old=contentReadSafety(db,{identity:{},namespace:ns,ref,intent}).allowed;
  const batch=memoryCandidatesAllowedInside(db,[ref],{readSet:[ns],intent},{});
  t.diagnostic(JSON.stringify({intent,expected,old,batch}));
  assert.deepEqual([old,...batch],[expected,expected],'spec incremental-catchup:237-258 current supersession eligibility');
 })));
});

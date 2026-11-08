import '../testing/context-product-test-clock.mjs';
import test from 'node:test';import assert from 'node:assert/strict';
import {safetyFixture,ns,ok,receipt} from '../testing/content-safety-s2h-fixture.mjs';
import {openMemoryCore} from '../index.mjs';import {openRawCaptureCore} from '../raw-capture.mjs';
import {request,splitRaw,localPlainPort} from '../testing/raw-capture-fixtures.mjs';
import {contentReadSafety} from '../content-safety.mjs';import {memoryCandidatesAllowedInside} from '../context-product-sidecar.mjs';
import {readTransaction,transaction} from '../database.mjs';
import {withContentSuppressionRequest,withContentSuppressionReadInside,writeContentSuppressionInside} from '../content-suppression-storage.mjs';
test('one-unit UTF-16 Raw suppression denies on both paths',async t=>{
 const f=safetyFixture(t,33);await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path});
 const raw=openRawCaptureCore({path:f.path,model:{contextWindow:8192,countTokens:()=>1,extract:()=>({items:[{content:'Synthetic span witness interpretation',kind:'fact',confidence:.8,sourceIndices:[0]}]})}}, {mode:'raw-v1',deletion:true,port:localPlainPort(),readPolicy:()=>({generation:'synthetic',reason:null})});
 t.after(()=>{raw.close();core.close();db.close();});
 const m=ok(core.admit({namespace:ns,memory:{content:'Synthetic span witness',kind:'fact'},receipts:[receipt('span-witness')]})).memory;
 const captured=ok(await raw.captureRaw(request(splitRaw('Synthetic source span')[0],{namespace:ns,sessionId:'span-witness',eventId:'span-witness'})));
 const source=db.prepare('SELECT * FROM raw_receipt_lineage WHERE conversation_id=? LIMIT 1').get(captured.raw.conversationId);
 const rid=db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(m.id).id;
 transaction(db,()=>{
 db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(rid,source.conversation_id,source.message_id,0,1,'exact');
 writeContentSuppressionInside(db,{namespace:ns,kind:'raw',key:source.conversation_id,matchMode:'span',messageId:source.message_id,start:0,end:1,reason:'privacy_erase',actionId:'span-witness'});
 });
 const ref={type:'memory',namespace:ns,memoryId:m.id,revision:m.revision};
 for(const intent of ['current','history'])withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],()=>{
 const old=contentReadSafety(db,{identity:{},namespace:ns,ref,intent}).allowed;
 const batch=memoryCandidatesAllowedInside(db,[ref],{readSet:[ns],intent},{});
 t.diagnostic(JSON.stringify({intent,expected:false,old,batch}));assert.deepEqual([old,...batch],[false,false],'a matching one-unit Raw span suppresses Memory');
 })));
});

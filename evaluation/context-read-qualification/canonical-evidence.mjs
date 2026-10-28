// Independent canonical-input projection. No context reader/fetch implementation.
// The caller is the SQLite-only inspection child, after placement/writer drain.
import { createHash,createHmac } from 'node:crypto';
import { createQualificationStorage } from '../../core/claim-qualification-storage.mjs';
import { createPrivateCardStorage } from '../../core/private-card-storage.mjs';
export function canonicalEvidence(db) {
  const stored=db.prepare('SELECT * FROM store_metadata WHERE singleton=1').get();
  const identity={storeId:stored.store_id,cursorSecret:stored.cursor_secret};
  const bind=(purpose,value)=>createHmac('sha256',identity.cursorSecret).update(JSON.stringify([purpose,[identity.storeId,value]])).digest('base64url');
  const ns=r=>({ownerId:r.owner_id,scope:r.scope,projectId:r.scope==='personal'?null:r.project_id});
  const rows=db.prepare('SELECT * FROM memories WHERE deleted=0 ORDER BY id').all();
  const readSet=[...new Map(rows.map(r=>[JSON.stringify(ns(r)),ns(r)])).values()];
  const qualification=createQualificationStorage({db,receiptKey:r=>createHash('sha256').update(JSON.stringify(r)).digest('hex')});
  const items=rows.map(r=>{
    const namespace=ns(r),receipts=db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 17').all(r.id),available=r.currentness==='current'&&r.review_state!=='awaiting';
    const assessed=qualification.inspect(r),qualified=assessed?{...assessed,sourceText:'read-separately',anchors:assessed.anchors.map(({text,...a})=>a)}:null;
    return {type:'memory',ref:{type:'memory',namespace,memoryId:r.id,revision:r.revision},state:r.currentness==='current'?'active':'historical',reviewState:r.review_state,
      filing:{status:r.filing_status},kind:r.kind,origin:r.origin,confidence:r.confidence,content:r.content,qualification:qualified,
      provenance:{sources:available?receipts.slice(0,16).map(s=>({type:'receipt',namespace,memoryId:r.id,memoryRevision:r.revision,receiptId:s.id,
        contentIdentity:bind('retained-receipt-content-v1',[namespace,r.id,r.revision,s.id,s.client,s.session_id,s.event_id,s.role,s.excerpt]),completeness:'excerpt-only'})):[],
        sourceAccess:available?'available':'unavailable-for-noncurrent-memory',receiptMetadata:receipts.slice(0,16).map(s=>({memoryId:r.id,memoryRevision:r.revision,receiptId:s.id})),completeness:'excerpt-only',conversationCoverage:'unknown',meaning:'unassessed',attribution:{status:'unassessed',commitment:'unknown'},corroboration:'not-assessed',coverage:{status:receipts.length>16?'budget_exhausted':'complete',included:Math.min(receipts.length,16),omitted:receipts.length>16?null:0}}};
  });
  if(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='private_cards'").get()) {
    const storage=createPrivateCardStorage({db,identity,ready(){}});
    for(const row of db.prepare("SELECT * FROM private_cards WHERE state='confirmed' ORDER BY id").all()) {
      const c=storage.cardDetailInside(ns(row),row.id,readSet),sources=c.bindings.map(b=>b.source);
      items.push({type:'card',ref:{type:'card',namespace:ns(row),cardId:row.id,revision:row.revision,bodyRevision:row.body_revision},state:row.state,support:c.support,origin:'authored',title:row.title,body:row.body,
        qualification:{applicability:c.support.applicability,attribution:'unassessed',commitment:'unknown'},provenance:{sources,completeness:sources.some(s=>s.type==='raw')?(sources.every(s=>s.type==='raw')?'selected-raw-span':'mixed-sources'):sources.every(s=>s.type==='submitted-note')?'provided-note':'excerpt-only',conversationCoverage:'unknown',meaning:'unassessed',support:c.support.status,corroboration:'not-assessed',coverage:{status:'complete',included:sources.length,omitted:0}},bindings:c.bindings,triggerMemoryRefs:c.triggerMemoryRefs});
    }
  }
  return items;
}

// Independent canonical-input projection. No context reader/fetch implementation.
// The caller is the SQLite-only inspection child, after placement/writer drain.
import { createHash,createHmac } from 'node:crypto';
import { createQualificationStorage } from '../../core/claim-qualification-storage.mjs';
export function canonicalEvidence(db) {
  const stored=db.prepare('SELECT * FROM store_metadata WHERE singleton=1').get();
  const identity={storeId:stored.store_id,cursorSecret:stored.cursor_secret};
  const bind=(purpose,value)=>createHmac('sha256',identity.cursorSecret).update(JSON.stringify([purpose,[identity.storeId,value]])).digest('base64url');
  const ns=r=>({ownerId:r.owner_id,scope:r.scope,projectId:r.scope==='personal'?null:r.project_id});
  const rows=db.prepare('SELECT * FROM memories WHERE deleted=0 ORDER BY id').all();
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
    for(const row of db.prepare("SELECT * FROM private_cards WHERE state='confirmed' ORDER BY id").all()) {
      const c=canonicalCard(db,row,ns(row),bind),sources=c.bindings.map(b=>b.source);
      items.push({type:'card',ref:{type:'card',namespace:ns(row),cardId:row.id,revision:row.revision,bodyRevision:row.body_revision},state:row.state,support:c.support,origin:'authored',title:row.title,body:row.body,
        qualification:{applicability:c.support.applicability,attribution:'unassessed',commitment:'unknown'},provenance:{sources,completeness:sources.some(s=>s.type==='raw')?(sources.every(s=>s.type==='raw')?'selected-raw-span':'mixed-sources'):sources.every(s=>s.type==='submitted-note')?'provided-note':'excerpt-only',conversationCoverage:'unknown',meaning:'unassessed',support:c.support.status,corroboration:'not-assessed',coverage:{status:'complete',included:sources.length,omitted:0}},bindings:c.bindings,triggerMemoryRefs:c.triggerMemoryRefs});
    }
  }
  return items;
}

// Frozen qualification worlds use authored notes and retained receipts. Project
// their DTOs here from SQL and registered fields, never from engine DTO builders.
function canonicalCard(db,row,namespace,bind) {
  const has=table=>!!db.prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?").get(table);
  // New source/dependency recipes require an explicit independent oracle too.
  for(const table of ['card_raw_bindings','card_current_dependencies'])if(has(table)&&db.prepare(`SELECT 1 FROM ${table} WHERE card_id=? LIMIT 1`).get(row.id))throw Error('canonical_card_unregistered_recipe:'+table);
  const refs=db.prepare(`SELECT source_ref,position FROM card_bindings WHERE card_id=?
    UNION ALL SELECT source_ref,position FROM card_memory_bindings WHERE card_id=? ORDER BY position`).all(row.id,row.id).map(r=>JSON.parse(r.source_ref));
  const sources=refs.map(ref=>{
    const ns={ownerId:ref.namespace.ownerId,scope:ref.namespace.scope,projectId:ref.namespace.scope==='personal'?null:ref.namespace.projectId};
    if(ref.type==='submitted-note')return {type:'submitted-note',namespace:ns,sourceId:ref.sourceId,revision:ref.revision,contentIdentity:ref.contentIdentity,completeness:'provided-note'};
    if(ref.type==='receipt')return {type:'receipt',namespace:ns,memoryId:ref.memoryId,memoryRevision:ref.memoryRevision,receiptId:ref.receiptId,contentIdentity:ref.contentIdentity,completeness:'excerpt-only'};
    throw Error('canonical_card_unregistered_source');
  });
  const available=sources.length>0&&sources.every(ref=>{
    if(JSON.stringify(ref.namespace)!==JSON.stringify(namespace))return false;
    if(ref.type==='submitted-note'){
      const note=db.prepare('SELECT * FROM card_notes WHERE id=? AND owner_id=? AND scope=? AND project_id=?').get(ref.sourceId,namespace.ownerId,namespace.scope,namespace.projectId??'');
      return !!note&&note.state==='available'&&note.revision===ref.revision&&bind('submitted-note-content-v1',[namespace,note.id,note.revision,note.text])===ref.contentIdentity;
    }
    const memory=db.prepare("SELECT * FROM memories WHERE id=? AND owner_id=? AND scope=? AND project_id=? AND deleted=0 AND currentness='current' AND review_state!='awaiting'").get(ref.memoryId,namespace.ownerId,namespace.scope,namespace.projectId??'');
    const receipt=db.prepare('SELECT * FROM receipts WHERE memory_id=? AND id=?').get(ref.memoryId,ref.receiptId);
    return !!memory&&!!receipt&&memory.revision===ref.memoryRevision&&bind('retained-receipt-content-v1',[namespace,memory.id,memory.revision,receipt.id,receipt.client,receipt.session_id,receipt.event_id,receipt.role,receipt.excerpt])===ref.contentIdentity;
  });
  const review=db.prepare('SELECT reviewed_revision,applicability FROM card_applicability_reviews WHERE card_id=?').get(row.id),currentReview=review?.reviewed_revision===row.revision;
  const support={status:available?'eligible':'unavailable',applicability:currentReview?review.applicability:'unknown',reasons:[available?'unassessed':sources.some(ref=>ref.type==='receipt')?'memory_changed':'source_deleted'],applicabilityReviewedRevision:currentReview?review.reviewed_revision:null,checkedAt:row.updated_at};
  const bindings=sources.map(source=>({id:source.type==='receipt'?source.receiptId:source.sourceId,source,dependency:source.type==='receipt'?'memory-interpretation':'source-only',memoryRef:source.type==='receipt'?{type:'memory',namespace,memoryId:source.memoryId,revision:source.memoryRevision}:null,receiptId:source.type==='receipt'?source.receiptId:null,role:'required',attribution:{sourceAuthor:null,claimant:null,subject:null,eventTime:null,commitment:'unknown',status:'unassessed'}}));
  return {support,bindings,triggerMemoryRefs:[]};
}

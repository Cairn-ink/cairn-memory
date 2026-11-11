import { createHash } from 'node:crypto';
import { createRawLineageStorage } from './raw-lineage-storage.mjs';
import { contentSuppressionReasonInside } from './content-suppression-storage.mjs';

// Data-only writer cleanup. Use the same receipt identity, retained lineage
// and fact authorities as serving, without calling back into a serving entry.
export function purgeUnreadableMemoryRelations(db, namespace, owner = false) {
 const rows=db.prepare(`SELECT id,revision,deleted,owner_id,scope,project_id FROM memories WHERE owner_id=?
  ${owner?'':'AND scope=? AND project_id=?'}`).all(namespace.ownerId,...(owner?[]:[namespace.scope,namespace.projectId??'']));
 const lineage=createRawLineageStorage(db,{readMemo:new Map()});
 const hasLineage=lineage.enabled();
 function unreadable(row,ns){
  if(row.deleted||contentSuppressionReasonInside(db,ns,{kind:'memory',key:row.id,revision:row.revision,
   version:JSON.stringify(['memory-revision-v1',row.revision])}))return true;
  const receipts=db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(row.id);
  if(!receipts.length)return true;
  for(const receipt of receipts){
   const source={client:receipt.client,sessionId:receipt.session_id,eventId:receipt.event_id,role:receipt.role,excerpt:receipt.excerpt};
   if(createHash('sha256').update(JSON.stringify(source)).digest('hex')!==receipt.receipt_key||
    contentSuppressionReasonInside(db,ns,{kind:'receipt',key:receipt.id}))return true;
   const targets=[];
   if(hasLineage)try{lineage.assertStoredReceipts(ns,[receipt],{readExisting:true,rawTargets:targets});}
   catch(error){
    if(['source_excluded','conversation_deleted','raw_lineage_unavailable'].includes(error.code))return true;
    throw error;
   }
   for(const anchor of targets)if(contentSuppressionReasonInside(db,ns,{kind:'raw',key:anchor.conversationId,
    messageId:anchor.messageId,start:anchor.start,end:anchor.end}))return true;
  }
  return false;
 }
 for(const row of rows){
  const ns={ownerId:row.owner_id,scope:row.scope,projectId:row.project_id||null};
  if(!unreadable(row,ns))continue;
  db.prepare('DELETE FROM memory_relations WHERE from_memory_id=? OR to_memory_id=?').run(row.id,row.id);
  db.prepare('DELETE FROM memory_relation_times WHERE memory_id=?').run(row.id);
 }
}

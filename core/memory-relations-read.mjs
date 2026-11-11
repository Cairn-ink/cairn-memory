import { memoryRelationEligible } from './memory-relations-safety.mjs';
import { performance } from 'node:perf_hooks';
import { cachedContentLayout, contentSafetyConnection } from './content-safety-schema.mjs';
import { createContentReadMemo } from './content-safety.mjs';
import { memoryRelationTime } from './memory-relations-time.mjs';

export const THREAD_MEMBER_CAP = 4;
const presence = new WeakMap();
// Fold this bit into an existing epoch statement. Empty graphs never add a
// relation statement to a context read, including across writer connections.
export const relationEpochColumn = db => cachedContentLayout(db)?.relationsRevision === 2
 ? ',EXISTS(SELECT 1 FROM memory_relations LIMIT 1) AS memory_relations_present' : '';
export function observeRelationPresence(db,row) {
 if(row && Object.hasOwn(row,'memory_relations_present'))presence.set(contentSafetyConnection(db),Boolean(row.memory_relations_present));
}
export const memoryRelationsPresent = db => (cachedContentLayout(db)?.relationsRevision === 2) && presence.get(contentSafetyConnection(db)) === true;
const boundary=ns=>[ns.ownerId,ns.scope,ns.projectId??''];
const where='m.owner_id=? AND m.scope=? AND m.project_id=?';
const refKey=ref=>JSON.stringify([boundary(ref.namespace),ref.type,ref.memoryId??ref.cardId,ref.revision,ref.bodyRevision??null]);
const refOf=(ns,row)=>({type:'memory',namespace:ns,memoryId:row.id,revision:row.revision});
export function relationNeighbors(db,ns,id,limit=256){
 return db.prepare(`SELECT * FROM (SELECT r.*,m.id AS other_id,m.revision AS other_revision,m.created_at AS other_created_at,m.rowid AS other_capture_order
 FROM memory_relations r INDEXED BY memory_relations_from JOIN memories m ON m.id=r.to_memory_id
 JOIN memories seed ON seed.id=r.from_memory_id
 WHERE r.from_memory_id=? AND ${where} AND m.deleted=0 AND m.review_state!='awaiting'
 AND m.revision=r.to_revision AND seed.revision=r.from_revision AND seed.deleted=0
 AND (r.decided_by!='rule' OR r.relation='same_thread')
 ORDER BY r.created_at DESC,r.id LIMIT ?)
 UNION ALL
 SELECT * FROM (SELECT r.*,m.id AS other_id,m.revision AS other_revision,m.created_at AS other_created_at,m.rowid AS other_capture_order
 FROM memory_relations r INDEXED BY memory_relations_to_date JOIN memories m ON m.id=r.from_memory_id
 JOIN memories seed ON seed.id=r.to_memory_id
 WHERE r.to_memory_id=? AND ${where} AND m.deleted=0 AND m.review_state!='awaiting'
 AND m.revision=r.from_revision AND seed.revision=r.to_revision AND seed.deleted=0
 AND (r.decided_by!='rule' OR r.relation='same_thread')
 ORDER BY r.created_at DESC,r.id LIMIT ?)
 ORDER BY created_at DESC,id LIMIT ?`).all(id,...boundary(ns),limit,id,...boundary(ns),limit,limit);
}
const timeOrder=(a,b)=>(a.time??'').localeCompare(b.time??'')||a.captureOrder-b.captureOrder;
export function deliverMemoryRelations(db,input,candidates,deadlineAt=Infinity,validateSeeds=false){
 const present=memoryRelationsPresent(db);
 if(!present&&!validateSeeds)return candidates;
 const memo=createContentReadMemo(db),safeCache=new Map(),neighborCache=new Map();
 const expired=()=>performance.now()>=deadlineAt;
 const safe=ref=>{
  const key=refKey(ref);if(safeCache.has(key))return safeCache.get(key);
  const value=!expired()&&(!input.readSet||input.readSet.some(ns=>JSON.stringify(boundary(ns))===JSON.stringify(boundary(ref.namespace))))
   &&memoryRelationEligible(db,ref.namespace,ref,memo);
  safeCache.set(key,value);return value;
 };
 const neighbors=ref=>{
  const key=refKey(ref);if(neighborCache.has(key))return neighborCache.get(key);
  const rows=expired()||!present?[]:relationNeighbors(db,ref.namespace,ref.memoryId).filter(row=>safe(refOf(ref.namespace,{id:row.other_id,revision:row.other_revision})));
  neighborCache.set(key,rows);return rows;
 };
 const selected=[],visited=new Set(),cap=24;
 for(const seed of candidates){
  if(expired()||selected.length>=cap)break;
  const key=refKey(seed.ref);
  if(visited.has(key))continue;
  if(seed.ref.type!=='memory'){selected.push(seed);visited.add(key);continue;}
  if(!safe(seed.ref))continue;
  const first=neighbors(seed.ref);
  if(!first.length){selected.push(seed);visited.add(key);continue;}
  const start=db.prepare(`SELECT id,revision,created_at,rowid AS capture_order FROM memories WHERE id=?`).get(seed.ref.memoryId);
  const members=new Map(),enqueued=new Set([key]),queue=[{ref:seed.ref,captureOrder:start.capture_order,time:memoryRelationTime(db,start)}];
  let complete=true;
  // Bounded connected-component traversal, in the same authorized snapshot.
  for(let at=0;at<queue.length&&!expired();at++){
   if(at>=256){complete=false;break;}
   const member=queue[at],memberKey=refKey(member.ref);
   if(members.has(memberKey))continue;
   members.set(memberKey,member);visited.add(memberKey);
   const incident=neighbors(member.ref);
   if(incident.length>=256){complete=false;break;}
   for(const edge of incident){
    const ref=refOf(seed.ref.namespace,{id:edge.other_id,revision:edge.other_revision});
    if(!enqueued.has(refKey(ref))){enqueued.add(refKey(ref));queue.push({ref,captureOrder:edge.other_capture_order,
     time:memoryRelationTime(db,{id:edge.other_id,revision:edge.other_revision,created_at:edge.other_created_at})});}
   }
  }
  if(!complete||expired())continue;
  const ordered=[...members.values()].sort((a,b)=>timeOrder(b,a)),current=ordered[0];
  if(!current)continue;
  for(const member of ordered.slice(0,THREAD_MEMBER_CAP)){
   if(selected.length>=cap)break;
   const direct=neighbors(member.ref).find(edge=>edge.other_id===current.ref.memoryId);
   const isCurrent=member===current;
   selected.push({...seed,ref:member.ref,via:undefined,threadKey:refKey(current.ref),threadRank:seed.rank,thread:{
    currentMemoryId:current.ref.memoryId,currentRevision:current.ref.revision,
    status:isCurrent?'current':'earlier',eventTime:member.time,
    relation:isCurrent?null:direct?.relation??'same_thread',
    direction:direct?(direct.from_memory_id===member.ref.memoryId?'outgoing':'incoming'):null,
    reason:direct?.reason??null},threadOrder:member.captureOrder});
  }
 }
 if(input.intent==='history')selected.sort((a,b)=>a.thread&&b.thread?
  (a.thread.eventTime??'').localeCompare(b.thread.eventTime??'')||a.threadOrder-b.threadOrder:a.rank-b.rank);
 return selected.map((item,index)=>({...item,rank:index+1}));
}
export function memoryRelationLabels(db,ref,deadlineAt=Infinity){
 if(ref.type!=='memory'||!memoryRelationsPresent(db))return [];
 const memo=createContentReadMemo(db),ns=ref.namespace;
 if(!memoryRelationEligible(db,ns,ref,memo))return [];
 return relationNeighbors(db,ns,ref.memoryId,5).filter(row=>performance.now()<deadlineAt&&memoryRelationEligible(db,ns,refOf(ns,{id:row.other_id,revision:row.other_revision}),memo)).map(row=>{
   const outgoing=row.from_memory_id===ref.memoryId;
   return {memoryId:row.other_id,revision:row.other_revision,relation:row.relation,
    direction:outgoing?'outgoing':'incoming',label:row.relation==='supersedes'&&!outgoing?'superseded by':row.relation==='refines'&&!outgoing?'refined by':row.relation==='causes'&&!outgoing?'caused by':row.relation,
    confidence:row.confidence,decidedBy:row.decided_by,eventTime:row.event_time,
    ...(row.reason?{reason:row.reason}:{}),
    otherEventTime:memoryRelationTime(db,{id:row.other_id,revision:row.other_revision,created_at:row.other_created_at})};
  });
}

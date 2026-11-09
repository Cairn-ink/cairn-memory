import { performance } from 'node:perf_hooks';
import { cachedContentLayout } from './content-safety-schema.mjs';
import { contentReadSafety, createContentReadMemo } from './content-safety.mjs';
import { memoryRelationTime } from './memory-relations-time.mjs';

const boundary=ns=>[ns.ownerId,ns.scope,ns.projectId??''];
const where='m.owner_id=? AND m.scope=? AND m.project_id=?';
const refKey=ref=>JSON.stringify([ref.namespace.ownerId,ref.namespace.scope,ref.namespace.projectId??'',ref.type,ref.memoryId??ref.cardId,ref.revision,ref.bodyRevision??null]);
const related=(seed,ref,depth)=>{const {via,...origin}=seed;return {...origin,ref,depth,fusionScore:null,channels:{lexical:null,semantic:null,...(Object.hasOwn(seed.channels??{},'moc')?{moc:null}:{})}};};
const refOf=(ns,row)=>({type:'memory',namespace:ns,memoryId:row.id,revision:row.revision});
// Both directions use the endpoint indexes. Revision checks happen in the same
// canonical read transaction as authorization and final evidence preparation.
export function relationNeighbors(db,ns,id,limit=24){
 return db.prepare(`SELECT * FROM (SELECT r.*,m.id AS other_id,m.revision AS other_revision,m.created_at AS other_created_at
 FROM memory_relations r INDEXED BY memory_relations_from JOIN memories m ON m.id=r.to_memory_id
 JOIN memories seed ON seed.id=r.from_memory_id
 WHERE r.from_memory_id=? AND ${where} AND m.deleted=0 AND m.review_state!='awaiting'
 AND m.revision=r.to_revision AND seed.revision=r.from_revision AND seed.deleted=0
 ORDER BY r.created_at DESC,r.id LIMIT ?)
 UNION ALL
 SELECT * FROM (SELECT r.*,m.id AS other_id,m.revision AS other_revision,m.created_at AS other_created_at
 FROM memory_relations r INDEXED BY memory_relations_to_date JOIN memories m ON m.id=r.from_memory_id
 JOIN memories seed ON seed.id=r.to_memory_id
 WHERE r.to_memory_id=? AND ${where} AND m.deleted=0 AND m.review_state!='awaiting'
 AND m.revision=r.from_revision AND seed.revision=r.to_revision AND seed.deleted=0
 ORDER BY r.created_at DESC,r.id LIMIT ?)
 ORDER BY created_at DESC,id LIMIT ?`).all(id,...boundary(ns),limit,id,...boundary(ns),limit,limit);
}
export function memoryRelationCurrent(db,ns,id,eligible,deadlineAt=Infinity){
 if(!cachedContentLayout(db)?.relationsRevision)return true;
 const rows=db.prepare(`SELECT m.id,m.revision FROM memory_relations r INDEXED BY memory_relations_to
 JOIN memories m ON m.id=r.from_memory_id JOIN memories old ON old.id=r.to_memory_id
 WHERE r.to_memory_id=? AND r.relation='supersedes' AND ${where}
 AND m.deleted=0 AND m.review_state!='awaiting' AND m.revision=r.from_revision
 AND old.revision=r.to_revision`).iterate(id,...boundary(ns));
 for(const row of rows){if(performance.now()>=deadlineAt)return false;if(eligible(refOf(ns,row)))return false;}
 return true;
}
export function deliverMemoryRelations(db,input,candidates,deadlineAt){
 if(!cachedContentLayout(db)?.relationsRevision)return candidates;
 const ids=candidates.filter(candidate=>candidate.ref.type==='memory').map(candidate=>candidate.ref.memoryId);
 if(!ids.length)return candidates;
 const linked=db.prepare(`SELECT 1 FROM memory_relations WHERE from_memory_id IN(SELECT value FROM json_each(?))
  OR to_memory_id IN(SELECT value FROM json_each(?)) LIMIT 1`).get(JSON.stringify(ids),JSON.stringify(ids));
 if(!linked)return candidates;
 const memo=createContentReadMemo(db),safeCache=new Map(),neighborCache=new Map();
 const expired=()=>performance.now()>=deadlineAt;
 const safe=ref=>{
  const key=refKey(ref);if(safeCache.has(key))return safeCache.get(key);
  const value=!expired()&&contentReadSafety(db,{namespace:ref.namespace,ref,intent:'history',memo}).allowed;
  safeCache.set(key,value);return value;
 };
 const neighbors=ref=>{
  const key=refKey(ref);if(neighborCache.has(key))return neighborCache.get(key);
  const rows=expired()?[]:relationNeighbors(db,ref.namespace,ref.memoryId).filter(row=>safe(refOf(ref.namespace,{id:row.other_id,revision:row.other_revision})));
  neighborCache.set(key,rows);return rows;
 };
 const current=ref=>memoryRelationCurrent(db,ref.namespace,ref.memoryId,safe,deadlineAt);
 const selected=new Map(),cap=24;
 const add=candidate=>{
  const key=refKey(candidate.ref);
  if(selected.size<cap&&!selected.has(key))selected.set(key,candidate);
 };
 // Resolve every lexical/vector seed to its live newest end. History follows
 // only provenance-chain edges, in either direction, through at most 8 steps.
 for(const seed of candidates){
  if(expired())break;
  if(seed.ref.type!=='memory'){add(seed);continue;}
  const queue=[{...seed,depth:0}],visited=new Set();
  for(let at=0;at<queue.length&&at<216&&!expired();at++){
   const candidate=queue[at],key=refKey(candidate.ref);
   if(visited.has(key)||!safe(candidate.ref))continue;visited.add(key);
   const rows=neighbors(candidate.ref);
   if(input.intent==='history'||current(candidate.ref))add(candidate);
   if(input.intent==='history'&&candidate.depth>=8)continue;
   for(const row of rows){
    const follow=input.intent==='history'?['supersedes','refines'].includes(row.relation)
     :row.relation==='supersedes'&&row.to_memory_id===candidate.ref.memoryId;
    if(follow)queue.push(related(seed,refOf(seed.ref.namespace,{id:row.other_id,revision:row.other_revision}),candidate.depth+1));
   }
  }
 }
 // Direct one-hop delivery replaces the former low-weight source reranking.
 for(const candidate of [...selected.values()]){
  if(expired())break;
  if(candidate.ref.type!=='memory')continue;
  for(const row of neighbors(candidate.ref)){
   if(input.intent==='history'&&(candidate.depth??0)>=8&&['supersedes','refines'].includes(row.relation))continue;
   const ref=refOf(candidate.ref.namespace,{id:row.other_id,revision:row.other_revision});
   if(input.intent==='current'&&!current(ref))continue;
   add(related(candidate,ref,(candidate.depth??0)+1));
  }
 }
 const result=[...selected.values()].map((candidate,index)=>{
  const {depth,...clean}=candidate;
  return {...clean,rank:index+1};
 });
 if(input.intent==='history')result.sort((a,b)=>{
  if(a.ref.type!=='memory'||b.ref.type!=='memory')return a.rank-b.rank;
  const date=ref=>memoryRelationTime(db,{id:ref.memoryId,revision:ref.revision});
  return (date(a.ref)??'').localeCompare(date(b.ref)??'')||a.rank-b.rank;
 });
 return result.map((item,index)=>({...item,rank:index+1}));
}
export function memoryRelationLabels(db,ref,deadlineAt=Infinity){
 if(ref.type!=='memory'||!cachedContentLayout(db)?.relationsRevision)return [];
 const memo=createContentReadMemo(db),ns=ref.namespace;
 return relationNeighbors(db,ns,ref.memoryId).filter(row=>performance.now()<deadlineAt&&contentReadSafety(db,{namespace:ns,
  ref:refOf(ns,{id:row.other_id,revision:row.other_revision}),intent:'history',memo}).allowed).map(row=>{
   const outgoing=row.from_memory_id===ref.memoryId;
   return {memoryId:row.other_id,revision:row.other_revision,relation:row.relation,
    direction:outgoing?'outgoing':'incoming',label:row.relation==='supersedes'&&!outgoing?'superseded by':row.relation==='refines'&&!outgoing?'refined by':row.relation==='causes'&&!outgoing?'caused by':row.relation,
    confidence:row.confidence,decidedBy:row.decided_by,eventTime:row.event_time,
    otherEventTime:memoryRelationTime(db,{id:row.other_id,revision:row.other_revision,created_at:row.other_created_at})};
  });
}

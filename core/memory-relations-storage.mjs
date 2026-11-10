import { memoryRelationTime } from './memory-relations-time.mjs';
import { randomUUID } from 'node:crypto';
import { readTransaction } from './database.mjs';
import { contentReadSafety, createContentReadMemo } from './content-safety.mjs';
import { installMemoryRelations } from './memory-relations-schema.mjs';
import { cachedContentLayout, installedContentLayout, attestContentSafety, contentLayoutCheckpoint } from './content-safety-schema.mjs';
import { createBM25 } from './context-read-bm25.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
export function createMemoryRelationStorage({ db, advanceEpoch, enabled = true, managed = false }) {
  const writable = () => enabled && (!managed || cachedContentLayout(db,{refresh:false})?.relationsRevision === 2);
  // Before the first edge, keep only a bounded, volatile clock hint. Legacy
  // stores have no source-date column: persisting one would change main's bytes.
  // Every hint is receipt-validated before it can enter the installed package.
  const pendingTimes=new Map(),timeKey=(ns,fingerprint)=>JSON.stringify([boundary(ns),fingerprint]);
  const pendingTime=(ns,memory)=>{
    const time=pendingTimes.get(timeKey(ns,memory.fingerprint));
    return time?.memory_id===memory.id?time:undefined;
  };
  const row = (ns,id) => db.prepare(`SELECT * FROM memories WHERE ${where} AND id=? AND deleted=0 AND review_state!='awaiting'`)
    .get(...boundary(ns),id);
  const safe = (ns,memory,memo) => memory && contentReadSafety(db,{namespace:ns,intent:'history',memo,
    ref:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}}).allowed;
  function rememberedTime(ns,fingerprint) {
    if(cachedContentLayout(db)?.relationsRevision!==2)return pendingTimes.get(timeKey(ns,fingerprint));
    return db.prepare(`SELECT t.* FROM memory_relation_times t JOIN memories m
      ON m.id=t.memory_id AND m.revision=t.revision WHERE m.owner_id=? AND m.scope=? AND m.project_id=?
      AND m.fingerprint=? AND m.deleted=0`).get(...boundary(ns),fingerprint);
  }
  function candidates(ns,facts) {
    return readTransaction(db,()=>{
      const memo=createContentReadMemo(db);
      const rows=db.prepare(`SELECT * FROM memories WHERE ${where} AND deleted=0 AND review_state!='awaiting' ORDER BY id`).all(...boundary(ns))
        .filter(memory=>safe(ns,memory,memo));
      const byId=new Map(rows.map(memory=>[memory.id,memory]));
      const bm25=createBM25(rows.map(memory=>({id:memory.id,text:memory.content})));
      return facts.map(fact=>bm25.search(fact.content,10).map(hit=>{
        const memory=byId.get(hit.id);
        return {id:memory.id,revision:memory.revision,content:memory.content,eventTime:(cachedContentLayout(db)?.relationsRevision!==2?pendingTime(ns,memory)?.event_time:undefined)??memoryRelationTime(db,memory)};
      }));
    });
  }
  function resolve(ns,refs){
    return readTransaction(db,()=>{
      const memo=createContentReadMemo(db);
      return refs.flatMap(ref=>{const memory=row(ns,ref.id);return memory&&memory.revision===ref.revision&&safe(ns,memory,memo)
        ?[{id:memory.id,revision:memory.revision,content:memory.content,eventTime:(cachedContentLayout(db)?.relationsRevision!==2?pendingTime(ns,memory)?.event_time:undefined)??memoryRelationTime(db,memory)}]:[];});
    });
  }
  function write(ns,entries,proposals=[]) {
    const snapshot={edges:[],times:[]};
    if(!proposals?.length)return snapshot;
    const memo=createContentReadMemo(db);let changed=false;
    for(const entry of entries){
      const from=row(ns,entry.memoryId);
      if(!safe(ns,from,memo))continue;
      const timing=proposals.find(p=>p.factIndex===entry.factIndex&&p.timingOnly);
      if(timing&&entry.insertedReceiptIds[0]){
        // Exact-content receipt attachment changes the revision. Retain the
        // latest trusted support date before that mutation's revision trigger
        // removes the old row; a late older receipt must not rewind the fact.
        const currentTime=db.prepare('SELECT * FROM memory_relation_times WHERE memory_id=? AND revision=?').get(from.id,from.revision);
        const previous=[entry.previousRelationTime,currentTime].filter(time=>time?.memory_id===from.id)
          .sort((a,b)=>b.event_time.localeCompare(a.event_time))[0];
        const retain=previous&&previous.event_time>timing.eventTime&&db.prepare('SELECT 1 FROM receipts WHERE id=? AND memory_id=?').get(previous.receipt_id,from.id);
        db.prepare(`INSERT INTO memory_relation_times VALUES(?,?,?,?) ON CONFLICT(memory_id)
          DO UPDATE SET revision=excluded.revision,event_time=excluded.event_time,receipt_id=excluded.receipt_id`)
          .run(from.id,from.revision,retain?previous.event_time:timing.eventTime,retain?previous.receipt_id:entry.insertedReceiptIds[0]);
        snapshot.times.push(from.id);
      }
      let count=db.prepare('SELECT count(*) n FROM memory_relations WHERE from_memory_id=? AND from_revision=?').get(from.id,from.revision).n;
      const seen=new Set();
      for(const proposal of proposals.filter(p=>p.factIndex===entry.factIndex)){
        if(proposal.timingOnly)continue;
        if(seen.has(proposal.candidateId)||proposal.candidateId===from.id)continue;
        seen.add(proposal.candidateId);
        const to=row(ns,proposal.candidateId);
        if(!safe(ns,to,memo)||to.revision!==proposal.candidateRevision)continue;
        const receiptId=entry.insertedReceiptIds[0];
        if(!receiptId)continue;
        const relation=proposal.relation;
        if(relation!=='same_thread'){
          const removed=db.prepare(`DELETE FROM memory_relations WHERE relation='same_thread' AND
            ((from_memory_id=? AND to_memory_id=?) OR (from_memory_id=? AND to_memory_id=?))`)
            .run(from.id,to.id,to.id,from.id).changes;
          if(removed)count=db.prepare('SELECT count(*) n FROM memory_relations WHERE from_memory_id=? AND from_revision=?').get(from.id,from.revision).n;
        }
        if(count>=5)continue;
        const id=randomUUID();
        db.prepare(`INSERT INTO memory_relations
          (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,receipt_id,event_time,created_at,reason)
          VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(id,from.id,from.revision,to.id,to.revision,relation,
          proposal.confidence,proposal.decidedBy,receiptId,proposal.eventTime,new Date().toISOString(),proposal.reason??null);
        snapshot.edges.push(id);
        count++;changed=true;
      }
    }
    if(changed)advanceEpoch(ns);
    return snapshot;
  }
  function insert(ns,entries,proposals=[]) {
    const empty={edges:[],times:[]};
    if(!writable() || !proposals?.length)return empty;
    const layout=cachedContentLayout(db);
    if(layout?.relationsRevision!==2)for(const entry of entries){
      const timing=proposals.find(p=>p.timingOnly&&p.factIndex===entry.factIndex);
      if(!timing||!entry.insertedReceiptIds[0])continue;
      const key=timeKey(ns,entry.item.fingerprint),previous=pendingTimes.get(key);
      const latest=previous?.memory_id===entry.memoryId&&previous.event_time>timing.eventTime?previous:null;
      pendingTimes.delete(key);pendingTimes.set(key,latest??{memory_id:entry.memoryId,revision:entry.memoryRevision,
        event_time:timing.eventTime,receipt_id:entry.insertedReceiptIds[0]});
      if(pendingTimes.size>256)pendingTimes.delete(pendingTimes.keys().next().value);
    }
    // Timing metadata alone never justifies installing or upgrading a package.
    if(layout?.relationsRevision!==2 && !proposals.some(p=>!p.timingOnly))return empty;
    // The caller already holds admission's writer lock. No separate migration
    // transaction or lock wait is allowed for this optional feature.
    if(!db.isTransaction)return empty;
    let valid;
    try {
    const memo=createContentReadMemo(db);
    valid=proposals.filter(proposal=>{
      if(proposal.timingOnly)return true;
      const entry=entries.find(entry=>entry.factIndex===proposal.factIndex);
      if(!entry?.insertedReceiptIds[0] || entry.memoryId===proposal.candidateId)return false;
      const from=row(ns,entry.memoryId),to=row(ns,proposal.candidateId);
      return to?.revision===proposal.candidateRevision && safe(ns,from,memo) && safe(ns,to,memo);
    });
    }catch{return empty;}
    if(layout?.relationsRevision!==2 && !valid.some(p=>!p.timingOnly))return empty;
    const restoreLayout=contentLayoutCheckpoint(db,{optional:true});
    try{db.exec('SAVEPOINT memory_relation_admission');}catch{return empty;}
    try {
      // Refresh only when an edge will be written, including a package another
      // connection installed after this runtime opened. Managed stores never
      // reach this installer until the host has explicitly upgraded them.
      if(layout?.relationsRevision!==2){
        installMemoryRelations(db);
        attestContentSafety(db);
        for(const proposal of valid.filter(p=>!p.timingOnly)){
          const to=row(ns,proposal.candidateId),time=pendingTime(ns,to);
          if(time&&db.prepare('SELECT 1 FROM receipts WHERE id=? AND memory_id=?').get(time.receipt_id,to.id)){
            db.prepare('INSERT OR IGNORE INTO memory_relation_times VALUES(?,?,?,?)').run(to.id,to.revision,time.event_time,time.receipt_id);
          }
        }
      }else installedContentLayout(db);
      const snapshot=write(ns,entries,valid);
      if(layout?.relationsRevision!==2&&!snapshot.edges.length)throw Error('relation_write_skipped');
      db.exec('RELEASE memory_relation_admission');
      return snapshot;
    }catch(error){
      db.exec('ROLLBACK TO memory_relation_admission');
      db.exec('RELEASE memory_relation_admission');
      restoreLayout();
      return empty;
    }
  }
  // Backfill can reuse candidates + insert in an authorized writer transaction;
  // replacing rule rows must bind the same revisions and retain their receipt.
  return { candidates, resolve, insert, rememberedTime, enabled: writable };
}

// An automatic capture's own initial filing settles its final revision. This
// narrowly scoped rebind never restores user assertions or manual filing edges.
export function snapshotInitialRelations(db,ns,ids,owned={edges:[],times:[]}){
 if(!cachedContentLayout(db)?.relationsRevision)return {edges:[],times:[]};
 const rows=new Map(),times=[];
 ids=[...ids];const selected=new Set(ids);
 for(const id of ids)if(owned.times.includes(id)){const time=db.prepare('SELECT * FROM memory_relation_times WHERE memory_id=?').get(id);if(time)times.push(time);}
 for(const id of ids)for(const edge of db.prepare(`SELECT * FROM memory_relations
 WHERE (from_memory_id=? OR to_memory_id=?) AND decided_by!='user'`).all(id,id))if(selected.has(edge.from_memory_id)&&owned.edges.includes(edge.id))rows.set(edge.id,edge);
 return {edges:[...rows.values()],times};
}
export function restoreInitialRelations(db,ns,snapshot){
 for(const time of snapshot.times??[]){
  const memory=db.prepare('SELECT revision FROM memories WHERE id=? AND deleted=0').get(time.memory_id);
  if(memory)db.prepare('INSERT OR REPLACE INTO memory_relation_times VALUES(?,?,?,?)').run(time.memory_id,memory.revision,time.event_time,time.receipt_id);
 }
 for(const edge of snapshot.edges??[]){
  const get=db.prepare(`SELECT * FROM memories WHERE owner_id=? AND scope=? AND project_id=? AND id=? AND deleted=0`);
  const from=get.get(...boundary(ns),edge.from_memory_id),to=get.get(...boundary(ns),edge.to_memory_id);
  if(!from||!to)continue;
  db.prepare(`INSERT OR IGNORE INTO memory_relations
   (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,receipt_id,event_time,created_at,reason)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(edge.id,from.id,from.revision,to.id,to.revision,edge.relation,
    edge.confidence,edge.decided_by,edge.receipt_id,edge.event_time,edge.created_at,edge.reason??null);
 }
}

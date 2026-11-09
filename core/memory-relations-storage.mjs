import { memoryRelationTime } from './memory-relations-time.mjs';
import { randomUUID } from 'node:crypto';
import { readTransaction } from './database.mjs';
import { contentReadSafety, createContentReadMemo } from './content-safety.mjs';
import { cachedContentLayout } from './content-safety-schema.mjs';
import { createBM25 } from './context-read-bm25.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
export function createMemoryRelationStorage({ db, advanceEpoch }) {
  const row = (ns,id) => db.prepare(`SELECT * FROM memories WHERE ${where} AND id=? AND deleted=0 AND review_state!='awaiting'`)
    .get(...boundary(ns),id);
  const safe = (ns,memory,memo) => memory && contentReadSafety(db,{namespace:ns,intent:'history',memo,
    ref:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}}).allowed;
  function candidates(ns,facts) {
    return readTransaction(db,()=>{
      const memo=createContentReadMemo(db);
      const rows=db.prepare(`SELECT * FROM memories WHERE ${where} AND deleted=0 AND review_state!='awaiting' ORDER BY id`).all(...boundary(ns))
        .filter(memory=>safe(ns,memory,memo));
      const byId=new Map(rows.map(memory=>[memory.id,memory]));
      const bm25=createBM25(rows.map(memory=>({id:memory.id,text:memory.content})));
      return facts.map(fact=>bm25.search(fact.content,10).map(hit=>{
        const memory=byId.get(hit.id);
        return {id:memory.id,revision:memory.revision,content:memory.content,eventTime:memoryRelationTime(db,memory)};
      }));
    });
  }
  function resolve(ns,refs){
    return readTransaction(db,()=>{
      const memo=createContentReadMemo(db);
      return refs.flatMap(ref=>{const memory=row(ns,ref.id);return memory&&memory.revision===ref.revision&&safe(ns,memory,memo)
        ?[{id:memory.id,revision:memory.revision,content:memory.content,eventTime:memoryRelationTime(db,memory)}]:[];});
    });
  }
  function insert(ns,entries,proposals=[]) {
    const snapshot={edges:[],times:[]};
    if(!proposals?.length)return snapshot;
    const memo=createContentReadMemo(db);let changed=false;
    for(const entry of entries){
      const from=row(ns,entry.memoryId);
      if(!safe(ns,from,memo))continue;
      const timing=proposals.find(p=>p.factIndex===entry.factIndex&&p.timingOnly);
      if(timing&&entry.insertedReceiptIds[0]){
        db.prepare(`INSERT INTO memory_relation_times VALUES(?,?,?,?) ON CONFLICT(memory_id)
          DO UPDATE SET revision=excluded.revision,event_time=excluded.event_time,receipt_id=excluded.receipt_id`)
          .run(from.id,from.revision,timing.eventTime,entry.insertedReceiptIds[0]);
        snapshot.times.push(from.id);
      }
      let count=db.prepare('SELECT count(*) n FROM memory_relations WHERE from_memory_id=? AND from_revision=?').get(from.id,from.revision).n;
      const seen=new Set();
      for(const proposal of proposals.filter(p=>p.factIndex===entry.factIndex)){
        if(proposal.timingOnly)continue;
        if(count>=5)break;
        if(seen.has(proposal.candidateId)||proposal.candidateId===from.id)continue;
        seen.add(proposal.candidateId);
        const to=row(ns,proposal.candidateId);
        if(!safe(ns,to,memo)||to.revision!==proposal.candidateRevision)continue;
        // Recheck the ordering against the final transaction snapshot.
        let relation=proposal.relation;
        if(relation==='supersedes'&&(proposal.confidence<0.6||proposal.eventTime<memoryRelationTime(db,to)))relation='contradicts';
        const receiptId=entry.insertedReceiptIds[0];
        if(!receiptId)continue;
        const id=randomUUID();
        db.prepare(`INSERT INTO memory_relations
          (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,receipt_id,event_time,created_at)
          VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(id,from.id,from.revision,to.id,to.revision,relation,
          proposal.confidence,proposal.decidedBy,receiptId,proposal.eventTime,new Date().toISOString());
        snapshot.edges.push(id);
        count++;changed=true;
      }
    }
    if(changed)advanceEpoch(ns);
    return snapshot;
  }
  // Backfill can reuse candidates + insert in an authorized writer transaction;
  // replacing rule rows must bind the same revisions and retain their receipt.
  return { candidates, resolve, insert };
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
   (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,receipt_id,event_time,created_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(edge.id,from.id,from.revision,to.id,to.revision,edge.relation,
    edge.confidence,edge.decided_by,edge.receipt_id,edge.event_time,edge.created_at);
 }
}

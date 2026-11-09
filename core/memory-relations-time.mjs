import { cachedContentLayout, receiptEventTimeEnabled } from './content-safety-schema.mjs';

export const memoryRelationStatedTime=(db,row)=>db.prepare('SELECT event_time FROM memory_relation_times WHERE memory_id=? AND revision=?').get(row.id,row.revision)?.event_time;

export function memoryRelationTime(db, row) {
  const stated=memoryRelationStatedTime(db,row);
  if(stated)return stated;
  const relation = db.prepare('SELECT max(event_time) t FROM memory_relations WHERE from_memory_id=? AND from_revision=?').get(row.id,row.revision)?.t;
  if (relation) return relation;
  const column = receiptEventTimeEnabled(cachedContentLayout(db)) ? 'coalesce(occurred_at,created_at)' : 'created_at';
  return db.prepare(`SELECT max(${column}) t FROM receipts WHERE memory_id=?`).get(row.id)?.t ?? row.created_at;
}

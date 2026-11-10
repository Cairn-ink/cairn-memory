import { cachedContentLayout, receiptEventTimeEnabled } from './content-safety-schema.mjs';

export const memoryRelationStatedTime=(db,row)=>cachedContentLayout(db)?.relationsRevision>=2
 ?db.prepare('SELECT event_time FROM memory_relation_times WHERE memory_id=? AND revision=?').get(row.id,row.revision)?.event_time:undefined;

export function memoryRelationTime(db, row) {
  const stated=memoryRelationStatedTime(db,row);
  if(stated)return stated;
  const column = receiptEventTimeEnabled(cachedContentLayout(db)) ? 'coalesce(occurred_at,created_at)' : 'created_at';
  return db.prepare(`SELECT max(${column}) t FROM receipts WHERE memory_id=?`).get(row.id)?.t ?? row.created_at;
}

import { createHmac } from 'node:crypto';
import { transaction } from './database.mjs';
import { rawBoundary } from './raw-input.mjs';
import { fail } from './validation.mjs';

export const UUID_HASH_CHUNK = 128, UUID_BACKFILL_CHUNK = 64;
const where = 'owner_id=? AND scope=? AND project_id=? AND client=? AND session_key=?';
// All methods are local-selection only. Jobs and backfill watermarks commit
// with fences; capture cannot pass while either kind of work remains.
export function createLocalUuidFence(db) {
  const secret = Buffer.from(db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret,'hex');
  const hash = (ns,client,id) => createHmac('sha256',secret)
    .update(JSON.stringify(['local-raw-forgotten-uuid-v1',...rawBoundary(ns),client,id])).digest('hex');
  const required = () => { if (!db.isTransaction) fail('raw_transaction_required'); };
  function rememberInside(ns,client,messages) {
    required(); if (client !== 'claude-code') return;
    const insert = db.prepare('INSERT OR IGNORE INTO local_raw_uuid_fences VALUES(?,?,?,?,?)');
    for (const message of messages) insert.run(...rawBoundary(ns),client,hash(ns,client,message.id));
  }
  function enqueueInside(ns,client,session) {
    required(); if (client !== 'claude-code') return;
    db.prepare('INSERT OR IGNORE INTO local_raw_uuid_jobs(owner_id,scope,project_id,client,session_key) VALUES(?,?,?,?,?)')
      .run(...rawBoundary(ns),client,session);
  }
  function advanceInside() {
    required();
    db.prepare('INSERT OR IGNORE INTO local_raw_uuid_backfill VALUES(1,?,0)').run(JSON.stringify(['','','','','']));
    const state = db.prepare('SELECT * FROM local_raw_uuid_backfill WHERE singleton=1').get();
    if (!state.complete) {
      const rows = db.prepare(`SELECT owner_id,scope,project_id,client,session_key FROM raw_session_fences
        WHERE (owner_id,scope,project_id,client,session_key)>(?,?,?,?,?)
        ORDER BY owner_id,scope,project_id,client,session_key LIMIT ?`).all(...JSON.parse(state.cursor),UUID_BACKFILL_CHUNK);
      for (const row of rows) enqueueInside({ownerId:row.owner_id,scope:row.scope,projectId:row.project_id},row.client,row.session_key);
      db.prepare('UPDATE local_raw_uuid_backfill SET cursor=?,complete=? WHERE singleton=1')
        .run(rows.length ? JSON.stringify(Object.values(rows.at(-1))) : state.cursor,Number(rows.length<UUID_BACKFILL_CHUNK));
    }
    let remaining = UUID_HASH_CHUNK;
    for (let count=0; count<UUID_BACKFILL_CHUNK && remaining>0; count++) {
      const job = db.prepare('SELECT * FROM local_raw_uuid_jobs WHERE complete=0 ORDER BY owner_id,scope,project_id,client,session_key LIMIT 1').get();
      if (!job) break;
      const ns = {ownerId:job.owner_id,scope:job.scope,projectId:job.project_id}, args = [...rawBoundary(ns),job.client,job.session_key];
      const conversation = db.prepare(`SELECT id FROM raw_conversations WHERE ${where}`).get(...args);
      const rows = conversation ? db.prepare(`SELECT message_id AS id,ordinal FROM raw_messages WHERE conversation_id=? AND ordinal>?
        ORDER BY ordinal LIMIT ?`).all(conversation.id,job.last_ordinal,remaining) : [];
      rememberInside(ns,job.client,rows);
      const last = rows.at(-1)?.ordinal ?? job.last_ordinal;
      const more = conversation && db.prepare('SELECT 1 FROM raw_messages WHERE conversation_id=? AND ordinal>? LIMIT 1').get(conversation.id,last);
      remaining -= rows.length;
      db.prepare(`UPDATE local_raw_uuid_jobs SET last_ordinal=?,complete=? WHERE ${where}`)
        .run(last,Number(!more),...args);
    }
    return !pending();
  }
  function pending() {
    return !db.prepare('SELECT complete FROM local_raw_uuid_backfill WHERE singleton=1').get()?.complete ||
      Boolean(db.prepare('SELECT 1 FROM local_raw_uuid_jobs WHERE complete=0 LIMIT 1').get());
  }
  function matches(ns,client,messages) {
    if (client !== 'claude-code') return false;
    const lookup = db.prepare('SELECT 1 FROM local_raw_uuid_fences WHERE owner_id=? AND scope=? AND project_id=? AND client=? AND uuid_hash=?');
    return messages.some(message=>lookup.get(...rawBoundary(ns),client,hash(ns,client,message.id)));
  }
  // Before destructive deletion, make bounded durable progress outside its
  // transaction. A retry cannot discard messages whose hash job is unfinished.
  function beforeDelete(ns,client,session) {
    const ready = transaction(db,()=>{
      db.prepare('INSERT OR IGNORE INTO raw_session_fences VALUES(?,?,?,?,?)').run(...rawBoundary(ns),client,session);
      enqueueInside(ns,client,session); return advanceInside(); });
    if (!ready) fail('local_raw_privacy_write_failed');
  }
  return { rememberInside,enqueueInside,advanceInside,pending,matches,beforeDelete };
}

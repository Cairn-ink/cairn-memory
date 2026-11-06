import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname, join } from 'node:path';
import { createExclusiveSqliteFile, sqliteFileStat, sameJournal } from './sqlite-journal-probe.mjs';
import { fail } from './validation.mjs';
import { same, RAW_SEARCH_LIMITS } from './raw-search-input.mjs';

const FORMAT = 2;
function stat(path) { try { return sqliteFileStat(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
function privateDirectory(path) {
  const own = stat(path);
  if (!own?.isDirectory() || own.isSymbolicLink() || (own.mode & 0o777n) !== 0o700n ||
      Number(own.uid) !== process.getuid?.()) fail('unsafe_index_file');
  for (let parent = dirname(path);;parent = dirname(parent)) {
    if (stat(parent)?.isSymbolicLink()) fail('unsafe_index_file');
    if (dirname(parent) === parent) break;
  }
  return own;
}
function privateFile(path) {
  const value = stat(path);
  if (!value?.isFile() || value.isSymbolicLink() || value.nlink !== 1n ||
      (value.mode & 0o777n) !== 0o600n || Number(value.uid) !== process.getuid?.()) fail('unsafe_index_file');
  return value;
}

/** Owner-scoped segment backend. No canonical connection or callback is held. */
export async function openRawSearchStorage({ directory, identity, bind, quotaBytes }) {
  directory = resolve(directory);
  const parent = privateDirectory(directory);
  const binding = { format:FORMAT,...identity,tokenizer:'hr1-t1-v1',projection:'raw-ranges-nfkc-v1',policy:'raw-hierarchy-v1' };
  const signHeader = (sequence,checkpoint) => bind('raw-search-header-v2',[binding,sequence,checkpoint]);
  const emptyCheckpoint = () => JSON.stringify({after:['','',-1],sweep:0,cycles:0});
  // One active file per canonical store/file and owner. A different projection
  // must not silently obtain another full owner quota in the same directory.
  const {readSet,...ownerIdentity}=identity;
  const path = join(directory,bind('raw-search-owner-file-v2',ownerIdentity)+'.raw-search.sqlite');
  if (!stat(path)) createExclusiveSqliteFile(path);
  const initial = privateFile(path);
  for (const suffix of ['-wal','-shm']) if (stat(path+suffix)) fail('unsafe_index_file');
  const journal = stat(path+'-journal');
  if (journal) privateFile(path+'-journal');
  let db = new DatabaseSync(path);
  let closed = false;
  function ready() {
    if (closed) fail('store_closed');
    if (!sameJournal(privateFile(path),initial) || !sameJournal(privateDirectory(directory),parent)) fail('unsafe_index_file');
  }
  function transaction(work) {
    ready(); db.exec('BEGIN IMMEDIATE');
    try { const result = work(); db.exec('COMMIT'); return result; }
    catch (error) { if(db.isTransaction)db.exec('ROLLBACK'); throw error; }
  }
  function header() {
    const row=db.prepare('SELECT * FROM header WHERE singleton=1').get();
    if(!row||row.binding!==JSON.stringify(binding)||row.signature!==signHeader(row.sequence,row.checkpoint))fail('forged_index');
    return row;
  }
  function writeHeader(sequence,checkpoint) {
    db.prepare('UPDATE header SET sequence=?,checkpoint=?,signature=? WHERE singleton=1')
      .run(sequence,checkpoint,signHeader(sequence,checkpoint));
  }
  try {
    db.exec('PRAGMA busy_timeout=50; PRAGMA trusted_schema=OFF; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON;');
    if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('unsafe_index_file');
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name='header'").get();
    if (!exists) transaction(() => db.exec(`
      CREATE TABLE header(singleton INTEGER PRIMARY KEY CHECK(singleton=1),binding TEXT NOT NULL,sequence INTEGER NOT NULL,checkpoint TEXT NOT NULL,signature TEXT NOT NULL);
      CREATE TABLE segments(id INTEGER PRIMARY KEY,segment_key TEXT NOT NULL UNIQUE,data TEXT NOT NULL,signature TEXT NOT NULL,published INTEGER NOT NULL CHECK(published IN(0,1)));
      CREATE INDEX published_segments ON segments(published,id);
    `));
    const previous = db.prepare('SELECT * FROM header WHERE singleton=1').get();
    if (!previous) transaction(() => db.prepare('INSERT INTO header VALUES(1,?,0,?,?)')
      .run(JSON.stringify(binding),emptyCheckpoint(),signHeader(0,emptyCheckpoint())));
    else {if (!same(JSON.parse(previous.binding),binding)) fail('foreign_index');header();}
    // Reserve rollback-journal pages and framing as part of the owner quota.
    // No second online generation or export is created by this backend.
    const pages = Math.floor((quotaBytes-8192)/2.01/db.prepare('PRAGMA page_size').get().page_size);
    db.exec(`PRAGMA max_page_count=${pages}`);
    if (db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('index_corrupt');
    // A crash can leave an unpublished segment; it is never searchable.
    transaction(() => db.prepare('DELETE FROM segments WHERE id IN (SELECT id FROM segments WHERE published=0 LIMIT 4096)').run());
  } catch (error) { db.close(); throw error; }
  const sign = data => bind('raw-search-segment-v1',[binding,data]);
  function decode(row) {
    if (!row || row.signature !== sign(row.data)) fail('forged_index');
    const data = JSON.parse(row.data);
    if (data.key !== row.segment_key) fail('forged_index');
    return { ...data,segment:row.id };
  }
  async function snapshot({ after = 0, limit = RAW_SEARCH_LIMITS.work } = {}) {
    ready();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > RAW_SEARCH_LIMITS.work) fail('invalid_input');
    // One statement owns the snapshot, including its publication sequence.
    const statement = db.prepare(`SELECT s.*,h.sequence,h.checkpoint,h.signature AS header_signature,h.binding AS header_binding FROM header h LEFT JOIN segments s ON s.published=1 AND s.id>?
      WHERE h.singleton=1 ORDER BY s.id LIMIT ?`);
    let sequence=0,checkpoint,bytes=0,partial=false,partialReason=null;
    const rows=[];
    // A native iterator bounds allocation before decoding large vector-bearing
    // segments. Closing it also releases its single-statement read snapshot.
    for (const row of statement.iterate(after,limit+1)) {
      if(row.header_binding!==JSON.stringify(binding)||row.header_signature!==signHeader(row.sequence,row.checkpoint))fail('forged_index');
      sequence=row.sequence;checkpoint??=JSON.parse(row.checkpoint);
      if(row.id===null)break;
      const size=Buffer.byteLength(row.data);
      if(rows.length===limit||bytes+size>RAW_SEARCH_LIMITS.snapshotBytes){partial=true;
        partialReason=rows.length===limit?'inventory_limit':'snapshot_byte_limit';break;}
      bytes+=size;rows.push(decode(row));
    }
    return {sequence,checkpoint,rows,partial,partialReason};
  }
  async function stage(segment) {
    ready();
    const data = JSON.stringify(segment);
    if (Buffer.byteLength(data) > 1024*1024) fail('index_segment_too_large');
    return Object.freeze({ key:segment.key,data,signature:sign(data) });
  }
  async function publish(staged, expected) {
    if (staged.signature !== sign(staged.data) || JSON.parse(staged.data).key!==staged.key) fail('forged_index');
    return transaction(() => {
      const previous = db.prepare('SELECT id FROM segments WHERE segment_key=? AND published=1').get(staged.key);
      if ((previous?.id ?? null) !== expected) fail('stale_publication');
      if (previous) db.prepare('DELETE FROM segments WHERE id=?').run(previous.id);
      const current=header(),sequence=current.sequence+1;
      writeHeader(sequence,current.checkpoint);
      // Use the monotone header clock as immutable segment ID, never SQLite's
      // reusable rowid after a complete purge.
      db.prepare('INSERT INTO segments VALUES(?,?,?,?,0)').run(sequence,staged.key,staged.data,staged.signature);
      db.prepare('UPDATE segments SET published=1 WHERE id=?').run(sequence);
      return sequence;
    });
  }
  async function invalidate(ids) {
    if (ids.length > 1024) fail('invalid_input');
    return transaction(() => {
      const removed = db.prepare('DELETE FROM segments WHERE id IN (SELECT value FROM json_each(?))').run(JSON.stringify(ids)).changes;
      const current=header();
      if (removed) writeHeader(current.sequence+1,current.checkpoint);
      return removed;
    });
  }
  async function checkpoint(next) {
    return transaction(() => {const current=header();writeHeader(current.sequence,JSON.stringify(next));});
  }
  async function lookup(keys) {
    ready();
    if(keys.length>128)fail('invalid_input');
    return db.prepare('SELECT * FROM segments WHERE published=1 AND segment_key IN (SELECT value FROM json_each(?))')
      .all(JSON.stringify(keys)).map(decode);
  }
  async function commitBatch({staged=[],remove=[],checkpoint:next}) {
    if(staged.length>128||remove.length>1024)fail('invalid_input');
    for(const row of staged)if(row.signature!==sign(row.data)||JSON.parse(row.data).key!==row.key)fail('forged_index');
    return transaction(()=>{
      const previous=db.prepare('SELECT segment_key,id FROM segments WHERE segment_key IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(staged.map(row=>row.key)));
      const ids=new Map(previous.map(row=>[row.segment_key,row.id]));
      if(staged.some(row=>(ids.get(row.key)??null)!==row.expected))fail('stale_publication');
      const base=header().sequence;
      const removed=db.prepare(`DELETE FROM segments WHERE id IN (SELECT value FROM json_each(?))
        OR segment_key IN (SELECT value FROM json_each(?))`).run(JSON.stringify(remove),JSON.stringify(staged.map(row=>row.key))).changes;
      const records=staged.map((row,i)=>({id:base+i+1,key:row.key,data:row.data,signature:row.signature}));
      db.prepare(`INSERT INTO segments SELECT json_extract(value,'$.id'),json_extract(value,'$.key'),
        json_extract(value,'$.data'),json_extract(value,'$.signature'),1 FROM json_each(?)`).run(JSON.stringify(records));
      writeHeader(base+staged.length+1,JSON.stringify(next));
      return {removed,sequence:base+staged.length+1};
    });
  }
  async function status() {
    ready();
    header();
    const row = db.prepare('SELECT sequence,checkpoint,(SELECT count(*) FROM segments WHERE published=1) AS segments FROM header WHERE singleton=1').get();
    return { sequence:row.sequence,checkpoint:JSON.parse(row.checkpoint),segments:row.segments,
      allocatedBytes:db.prepare('PRAGMA page_count').get().page_count*db.prepare('PRAGMA page_size').get().page_size,
      freeBytes:db.prepare('PRAGMA freelist_count').get().freelist_count*db.prepare('PRAGMA page_size').get().page_size,
      journalBytes:Number(stat(path+'-journal')?.size ?? 0n),quotaBytes };
  }
  async function dropOwner() {
    let removed;
    do{removed=transaction(() => {
      const current=header(),result=db.prepare('DELETE FROM segments WHERE id IN (SELECT id FROM segments LIMIT 1024)').run();
      writeHeader(current.sequence+1,emptyCheckpoint());return result.changes;
    });}while(removed);
    db.exec('VACUUM');
  }
  return Object.freeze({ openOwner:async () => binding,snapshot,search:snapshot,stage,publish,invalidate,checkpoint,lookup,commitBatch,status,dropOwner,
    async close() { if (!closed) { closed = true; db.close(); } } });
}

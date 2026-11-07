import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { resolve, dirname, join } from 'node:path';
import { createExclusiveSqliteFile, sqliteFileStat, sameJournal } from './sqlite-journal-probe.mjs';
import { fail } from './validation.mjs';
import { same, RAW_SEARCH_LIMITS, rawSourceHint } from './raw-search-input.mjs';
import { sidecarAttestationFile, readSidecarAttestation, validSidecarAttestation, writeSidecarAttestation } from './context-product-sidecar-attestation.mjs';
import { rawSearchSqlite } from './raw-search-sqlite.mjs';

const FORMAT = 3;
const schemaSql = [
  'CREATE TABLE header(singleton INTEGER PRIMARY KEY CHECK(singleton=1),binding TEXT NOT NULL,sequence INTEGER NOT NULL,checkpoint TEXT NOT NULL,signature TEXT NOT NULL)',
  'CREATE TABLE segments(id INTEGER PRIMARY KEY,segment_key TEXT NOT NULL UNIQUE,data TEXT NOT NULL,signature TEXT NOT NULL,vectors BLOB NOT NULL,published INTEGER NOT NULL CHECK(published IN(0,1)))',
  'CREATE INDEX published_segments ON segments(published,id)',
  'CREATE TABLE product_attestation(singleton INTEGER PRIMARY KEY CHECK(singleton=1),stamp INTEGER NOT NULL CHECK(stamp>=1),record TEXT NOT NULL CHECK(length(record)<=4096)) STRICT',
];
const schema = db => db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY name').all();
function expectedSchema(check) {
  const probe = rawSearchSqlite(new DatabaseSync(':memory:'),check);
  try { for (const sql of schemaSql) probe.exec(sql); return schema(probe); }
  finally { probe.close(); }
}
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
export async function openRawSearchStorage({ directory, identity, bind, quotaBytes, deadlineAt = performance.now()+1000 }) {
  const check = () => { if (performance.now() >= deadlineAt) fail('search_deadline'); };
  check();
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
  const generation = bind('raw-search-generation-v1',[binding,String(initial.dev),String(initial.ino)]);
  for (const suffix of ['-wal','-shm']) if (stat(path+suffix)) fail('unsafe_index_file');
  const journal = stat(path+'-journal');
  if (journal) privateFile(path+'-journal');
  const sealKey = bind('raw-search-attestation-key-v1',binding);
  const sealFormat = {name:'raw-search',binding};
  const sealFile = sidecarAttestationFile(path);
  check();
  const db = rawSearchSqlite(new DatabaseSync(path),check);
  let sealing = false;
  let closed = false;
  function ready() {
    if (closed) fail('store_closed');
    if (!sameJournal(privateFile(path),initial) || !sameJournal(privateDirectory(directory),parent)) fail('unsafe_index_file');
  }
  function transaction(work) {
    ready(); db.exec('BEGIN IMMEDIATE');
    try { const result = work(); if (sealing) writeSidecarAttestation(db,sealKey,sealFile,sealFormat); db.exec('COMMIT'); return result; }
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
    for (const sql of ['PRAGMA busy_timeout=0','PRAGMA trusted_schema=OFF','PRAGMA foreign_keys=ON','PRAGMA secure_delete=ON']) db.exec(sql);
    if (db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('unsafe_index_file');
    const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE name='header'").get();
    if (!exists) transaction(() => { for (const sql of schemaSql) db.exec(sql); });
    const objects = schema(db), expected = expectedSchema(check);
    if (!same(objects,expected)) fail('index_corrupt');
    const previous = db.prepare('SELECT * FROM header WHERE singleton=1').get();
    if (!previous) {
      if (exists) fail('forged_index');
      transaction(() => db.prepare('INSERT INTO header VALUES(1,?,0,?,?)')
        .run(JSON.stringify(binding),emptyCheckpoint(),signHeader(0,emptyCheckpoint())));
    }
    else {if (!same(JSON.parse(previous.binding),binding)) fail('foreign_index');header();}
    if (exists && !validSidecarAttestation(sealKey,readSidecarAttestation(db,objects),sealFile,sealFormat)) fail('forged_index');
    sealing = true;
    // Reserve rollback-journal pages and framing as part of the owner quota.
    // No second online generation or export is created by this backend.
    const pages = Math.floor((quotaBytes-8192)/2.01/db.prepare('PRAGMA page_size').get().page_size);
    db.exec(`PRAGMA max_page_count=${pages}`);
    // A crash can leave an unpublished segment; it is never searchable.
    transaction(() => db.prepare('DELETE FROM segments WHERE id IN (SELECT id FROM segments WHERE published=0 LIMIT 4096)').run());
  } catch (error) { db.close(); throw error; }
  deadlineAt = Infinity;
  const vectorBytes = value => value instanceof Uint8Array ? Buffer.from(value.buffer,value.byteOffset,value.byteLength) : Buffer.from(value,'hex');
  const sign = (data,vectors) => bind('raw-search-segment-v3',[binding,data,
    createHash('sha256').update(vectors).digest('hex')]);
  // Fixed tuples avoid repeated property names and duplicate source identities.
  // Generic records are retained for storage-only callers and refusal fixtures.
  function pack(segment) {
    if(!segment.source?.manifest&&!segment.source?.canonical)return {data:JSON.stringify(segment),vectors:Buffer.alloc(0)};
    const source=rawSourceHint(segment.source,bind),ref=source.ref,ns=binding.readSet.findIndex(ns=>same(ns,ref.namespace));
    if(ns<0)fail('foreign_index');
    const vectors=[];
    const chunks=segment.chunks.map(c=>{if(c.vector)vectors.push(vectorBytes(c.vector));return [c.start,c.end,c.inputIdentity,c.vector?vectorBytes(c.vector).length:0];});
    const data=JSON.stringify([segment.key,ns,ref.span.start,ref.span.end,ref.span.precision,ref.contentIdentity,
      source.ordinal,source.role,source.occurredAt,source.currentness,source.classification.kind,source.classification.reason,
      source.totalUnits,source.bytes,source.canonical,segment.fingerprint,segment.postings.length,segment.postings.terms,
      chunks,segment.embedder,segment.retry]);
    return {data,vectors:Buffer.concat(vectors)};
  }
  function unpack(data,bytes) {
    const value=JSON.parse(data);
    if(!Array.isArray(value))return value;
    const [key,ns,start,end,precision,contentIdentity,ordinal,role,occurredAt,currentness,kind,reason,
      totalUnits,sourceBytes,canonical,fingerprint,length,terms,chunks,embedder,retry]=value;
    const [conversationId,messageId]=JSON.parse(key);let offset=0;
    const decoded=chunks.map(([start,end,inputIdentity,size])=>{
      const c={start,end,inputIdentity};
      if(size){if(offset+size>bytes.length)fail('forged_index');c.vector=bytes.subarray(offset,offset+size);offset+=size;}
      return c;
    });
    if(offset!==bytes.length||!binding.readSet[ns])fail('forged_index');
    return {key,source:{ref:{type:'raw',namespace:binding.readSet[ns],conversationId,messageId,
      span:{start,end,precision},contentIdentity},ordinal,role,occurredAt,currentness,
      classification:{kind,reason},totalUnits,bytes:sourceBytes,canonical},fingerprint,
      postings:{length,terms},chunks:decoded,embedder,retry};
  }
  function decode(row, timings) {
    let start=performance.now();
    if (!row || row.signature !== sign(row.data,row.vectors)) fail('forged_index');
    if(timings)timings.authenticationMs+=performance.now()-start;start=performance.now();
    const data = unpack(row.data,vectorBytes(row.vectors));
    if(timings)timings.decodeMs+=performance.now()-start;
    if (data.key !== row.segment_key) fail('forged_index');
    return { ...data,segment:row.id };
  }
  const stagedKey = row => {if(row.signature!==sign(row.data,row.vectors))fail('forged_index');
    const data=JSON.parse(row.data);if((Array.isArray(data)?data[0]:data.key)!==row.key)fail('forged_index');};
  function within(at,work) {
    const previous=deadlineAt;deadlineAt=at;
    try { check();return work(); } finally { deadlineAt=previous; }
  }
  async function snapshot(options = {}) {
    return within(options.deadlineAt??Infinity,()=>snapshotInside(options));
  }
  function snapshotInside({ after = 0, limit = RAW_SEARCH_LIMITS.work,deadlineAt=Infinity } = {}) {
    ready();
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > RAW_SEARCH_LIMITS.work) fail('invalid_input');
    // One statement owns the snapshot, including its publication sequence.
    const statement = db.prepare(`SELECT s.*,h.sequence,h.checkpoint,h.signature AS header_signature,h.binding AS header_binding FROM header h LEFT JOIN segments s ON s.published=1 AND s.id>?
      WHERE h.singleton=1 ORDER BY s.id LIMIT ?`);
    let sequence=0,checkpoint,bytes=0,vectorSize=0,partial=false,partialReason=null;
    const rows=[],timings={sqliteMs:0,authenticationMs:0,decodeMs:0};
    // A native iterator bounds allocation before decoding large vector-bearing
    // segments. Closing it also releases its single-statement read snapshot.
    const iterator=statement.iterate(after,limit+1);
    try{while(true){
      if(performance.now()>=deadlineAt)fail('search_deadline');
      const start=performance.now(),step=iterator.next();timings.sqliteMs+=performance.now()-start;
      if(step.done)break;const row=step.value;
      if(checkpoint===undefined&&(row.header_binding!==JSON.stringify(binding)||row.header_signature!==signHeader(row.sequence,row.checkpoint)))fail('forged_index');
      sequence=row.sequence;checkpoint??=JSON.parse(row.checkpoint);
      if(row.id===null)break;
      const size=Buffer.byteLength(row.data);
      if(rows.length===limit||bytes+size>RAW_SEARCH_LIMITS.snapshotBytes){partial=true;
        partialReason=rows.length===limit?'inventory_limit':'snapshot_byte_limit';break;}
      if(vectorSize+row.vectors.byteLength>128*1024*1024){partial=true;partialReason='vector_byte_limit';break;}
      bytes+=size;vectorSize+=row.vectors.byteLength;rows.push(decode(row,timings));
    }}finally{iterator.return();}
    return {sequence,checkpoint,rows,partial,partialReason,hintBytes:bytes,vectorBytes:vectorSize,timings};
  }
  function publication(options={}) {
    return within(options.deadlineAt??Infinity,()=>publicationInside(options));
  }
  function publicationInside({shape=true,deadlineAt=Infinity}={}) {
    ready();
    // Native change detection also invalidates on an out-of-band sidecar write
    // that did not advance the signed publication clock. One sidecar snapshot
    // reads the authenticated header and the uncached coverage shape.
    db.exec('BEGIN DEFERRED');
    try {
      const current=header(),revision=db.prepare('PRAGMA data_version').get().data_version;
      if(!shape){db.exec('COMMIT');return {generation,revision,sequence:current.sequence};}
      const iterator=db.prepare('SELECT length(CAST(data AS BLOB)) AS hints,length(vectors) AS vectors FROM segments WHERE published=1 ORDER BY id LIMIT ?')
        .iterate(RAW_SEARCH_LIMITS.work+1);
      let hintBytes=0,vectorBytes=0,count=0,partial=false,partialReason=null;
      try{for(const row of iterator){
        if(performance.now()>=deadlineAt)fail('search_deadline');
        if(count===RAW_SEARCH_LIMITS.work||hintBytes+row.hints>RAW_SEARCH_LIMITS.snapshotBytes){
          partial=true;partialReason=count===RAW_SEARCH_LIMITS.work?'inventory_limit':'snapshot_byte_limit';break;
        }
        if(vectorBytes+row.vectors>128*1024*1024){partial=true;partialReason='vector_byte_limit';break;}
        hintBytes+=row.hints;vectorBytes+=row.vectors;count++;
      }}finally{iterator.return();}
      db.exec('COMMIT');
      return {generation,revision,sequence:current.sequence,checkpoint:JSON.parse(current.checkpoint),
        partial,partialReason,hintBytes,vectorBytes};
    }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  }
  async function stage(segment) {
    ready();
    const {data,vectors} = pack(segment);
    if (Buffer.byteLength(data) > 1024*1024) fail('index_segment_too_large');
    return Object.freeze({ key:segment.key,data,vectors,signature:sign(data,vectors),source:segment.source });
  }
  async function publish(staged, expected) {
    stagedKey(staged);
    return transaction(() => {
      const previous = db.prepare('SELECT id FROM segments WHERE segment_key=? AND published=1').get(staged.key);
      if ((previous?.id ?? null) !== expected) fail('stale_publication');
      if (previous) db.prepare('DELETE FROM segments WHERE id=?').run(previous.id);
      const current=header(),sequence=current.sequence+1;
      writeHeader(sequence,current.checkpoint);
      // Use the monotone header clock as immutable segment ID, never SQLite's
      // reusable rowid after a complete purge.
      db.prepare('INSERT INTO segments VALUES(?,?,?,?,?,0)').run(sequence,staged.key,staged.data,staged.signature,staged.vectors);
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
      .all(JSON.stringify(keys)).map(row=>decode(row));
  }
  async function commitBatch({staged=[],remove=[],checkpoint:next}) {
    if(staged.length>128||remove.length>1024)fail('invalid_input');
    for(const row of staged)stagedKey(row);
    return transaction(()=>{
      const previous=db.prepare('SELECT segment_key,id FROM segments WHERE segment_key IN (SELECT value FROM json_each(?))')
        .all(JSON.stringify(staged.map(row=>row.key)));
      const ids=new Map(previous.map(row=>[row.segment_key,row.id]));
      if(staged.some(row=>(ids.get(row.key)??null)!==row.expected))fail('stale_publication');
      const base=header().sequence;
      const removed=db.prepare(`DELETE FROM segments WHERE id IN (SELECT value FROM json_each(?))
        OR segment_key IN (SELECT value FROM json_each(?))`).run(JSON.stringify(remove),JSON.stringify(staged.map(row=>row.key))).changes;
      if(staged.length)db.prepare('INSERT INTO segments VALUES '+staged.map(()=>'(?,?,?,?,?,1)').join(','))
        .run(...staged.flatMap((row,i)=>[base+i+1,row.key,row.data,row.signature,row.vectors]));
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
  return Object.freeze({ openOwner:async () => binding,snapshot,search:snapshot,publication,stage,publish,invalidate,checkpoint,lookup,commitBatch,status,dropOwner,
    async close() { if (!closed) { closed = true; db.close(); } } });
}

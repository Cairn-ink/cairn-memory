import { reserveSidecarHandle, sidecarHandleGuard } from './context-product-handles.mjs';
import { admissionRequired, PRODUCT_SIDECAR_SUFFIX } from './context-product-admission.mjs';
import { cachedContentSuppressionRequestInside, contentSuppressionRequestInside, withMemoryCandidateBatchInside, withContentSuppressionReadInside, contentSuppressionReasonInside, contentSuppressionRequestFenceInside, contentSuppressionMayMatchInside } from './content-suppression-storage.mjs';
import { bindContentSafetyConnection, cachedContentLayout } from './content-safety-schema.mjs';
import { contentReadSafety, memoryReadEligible } from './content-safety.mjs';
import { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { dirname } from 'node:path';
import { createExclusiveSqliteFile, probeRollbackJournal, sqliteFileStat, protectedDeleteJournal, sameJournal } from './sqlite-journal-probe.mjs';
import { readTransaction } from './database.mjs';
import { contextCardEligible, contextReadDeleteJournal } from './context-read-sidecar.mjs';
import { cardDependencyFence } from './card-current-storage.mjs';
import { termFrequencies, tokenizeT1, TOKENIZER_VERSION, REPRESENTATION_VERSION } from './context-read-tokenize.mjs';
import { scoreBM25, rankScores } from './context-read-bm25.mjs';
import { PRODUCT_PROFILE } from './context-product-control.mjs';
import { contextReadSet } from './context-read-input.mjs';
import { canonicalJson, digest, projectionDigest, signedRecord, verifiedRecord } from './context-product-validation.mjs';
import { maintenanceQuantum } from './context-product-quantum.mjs';
import { checkpointCost } from './context-product-checkpoint-cost.mjs';
import { ManifestHash } from './context-product-manifest.mjs';
import { fail } from './validation.mjs';
import { VECTOR_DDL } from './context-product-vectors.mjs';
import { verificationBatch, verificationMeter, verificationBound } from './context-product-verification-batch.mjs';
import { comparisonWorkFields } from './context-product-attribution.mjs';

// Internal Memory-only equivalent of candidateAllowed. Cards retain their
// conservative per-candidate path. No handle, transaction or epoch is acquired.
export function memoryCandidatesAllowedInside(db, refs, p, identity) {
  return withMemoryCandidateBatchInside(db,refs,rows=>rows.map((row,i)=>
    Boolean(row.id && row.revision === refs[i].revision && memoryReadEligible(row,p.intent) &&
      contentReadSafety(db,{identity,namespace:refs[i].namespace,ref:refs[i],intent:p.intent,selectedMemory:row}).allowed)));
}

export const PRODUCT_SIDECAR_FORMAT = 3;
export { PRODUCT_SIDECAR_SUFFIX };
const APPLICATION_ID = 0x43525032;
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
const unavailable = reason => { throw Object.assign(Error('index_unavailable'), { code: 'index_unavailable', reason }); };
// Private control flow: rollback this batch, then report honest progress.
// Never classify storage/corruption/authority errors by their public code.
const fenceChanged = Symbol('maintenance fence changed');
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
// Identical provenance predicate for private reuse and immutable-base copying.
const exactDocument = (old, row) => old && old.revision===row.revision && old.body_revision===row.body_revision && old.eligible===row.eligible;
const initialVerification = p => ({ byteSafe:1,phase:0,last:[],hash:new ManifestHash().state(),
  counts:{ byType:Object.fromEntries(['memory','card'].filter(t => p.types.includes(t)).map(t => [t,{eligible:0,indexed:0}])),documents:0,terms:0,totalTokenLength:0 } });
// Cleanup must not replace a native failure already committed to telemetry.
function cleaned(work, cleanup) {
  let result;
  try { result = work(); }
  catch (error) { try { cleanup(); } catch { /* Preserve the original failure. */ } throw error; }
  cleanup(); return result;
}
// The independent storage seam validates and normalizes before any file work.
// The frozen v1 sidecar keeps its separate one/two-namespace grammar.
function projection(p) {
  let readSet;
  try {
    if (types.isProxy(p)) fail('invalid_read_set');
    const selected = Object.getOwnPropertyDescriptor(p, 'readSet');
    if (!selected || !Object.hasOwn(selected, 'value')) fail('invalid_read_set');
    readSet = contextReadSet(selected.value, PRODUCT_PROFILE);
  } catch { fail('invalid_read_set'); }
  return { ...p, readSet };
}
const ddl = `
CREATE TABLE product_metadata(singleton INTEGER PRIMARY KEY CHECK(singleton=1),store_id TEXT NOT NULL,profile TEXT NOT NULL,incarnation TEXT NOT NULL,kind TEXT NOT NULL) STRICT;
CREATE TABLE generations(storage_id INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT NOT NULL UNIQUE,owner TEXT NOT NULL,projection TEXT NOT NULL,incarnation TEXT NOT NULL,sequence INTEGER NOT NULL,base_sequence INTEGER NOT NULL,checkpoint INTEGER NOT NULL,kind TEXT NOT NULL,fences TEXT NOT NULL,access TEXT NOT NULL,phase INTEGER NOT NULL,last_key TEXT NOT NULL,base_id TEXT,verify TEXT NOT NULL,manifest TEXT,published INTEGER NOT NULL,seed TEXT NOT NULL) STRICT;
CREATE TABLE publications(projection TEXT PRIMARY KEY,generation TEXT NOT NULL,publication TEXT NOT NULL) STRICT;
CREATE TABLE work(projection TEXT PRIMARY KEY,generation TEXT NOT NULL) STRICT;
CREATE TABLE validation_records(publication TEXT PRIMARY KEY,generation TEXT NOT NULL UNIQUE,record TEXT NOT NULL) STRICT;
CREATE TABLE progress_records(generation TEXT PRIMARY KEY,record TEXT NOT NULL) STRICT;
CREATE TABLE selections(projection TEXT PRIMARY KEY,owner TEXT NOT NULL,types TEXT NOT NULL,intent TEXT NOT NULL) STRICT;
CREATE TABLE documents(generation INTEGER NOT NULL,doc INTEGER NOT NULL CHECK(doc > 0),stream INTEGER NOT NULL,id TEXT NOT NULL,identity TEXT NOT NULL,revision INTEGER NOT NULL,body_revision INTEGER NOT NULL,eligible INTEGER NOT NULL CHECK(eligible IN(0,1)),token_length INTEGER NOT NULL CHECK(token_length>=0),PRIMARY KEY(generation,doc),UNIQUE(generation,stream,id),UNIQUE(generation,identity)) STRICT, WITHOUT ROWID;
CREATE TABLE postings(generation INTEGER NOT NULL,doc INTEGER NOT NULL CHECK(doc > 0),term INTEGER NOT NULL,frequency INTEGER NOT NULL CHECK(frequency>0),position INTEGER NOT NULL CHECK(position>0),PRIMARY KEY(generation,doc,term),FOREIGN KEY(generation,doc) REFERENCES documents(generation,doc)) STRICT, WITHOUT ROWID;
CREATE INDEX product_term ON postings(generation,term,doc);
CREATE INDEX product_document_order ON postings(generation,doc,position,term,frequency);
CREATE TABLE statistics(generation INTEGER NOT NULL,term_id INTEGER NOT NULL,term TEXT NOT NULL,df INTEGER NOT NULL,n INTEGER NOT NULL,total_length INTEGER NOT NULL,verified_df INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(generation,term_id),UNIQUE(generation,term)) STRICT, WITHOUT ROWID;
`;
// Compare constant-size physical metadata, including actual index definitions.
// Never infer a format from user_version alone, or scan a content table here.
function schema(db) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
}
const expectedSchema = (ddl+VECTOR_DDL).trim().split(';').filter(sql => sql.trim()).map(sql => {
  sql=sql.trim(); const match=/^CREATE (TABLE|INDEX) (\w+)/.exec(sql);
  return {type:match[1].toLowerCase(),name:match[2],tbl_name:match[1]==='TABLE'?match[2]:/ ON (\w+)/.exec(sql)[1],sql};
}).sort((a,b) => Buffer.compare(Buffer.from(a.type),Buffer.from(b.type)) || Buffer.compare(Buffer.from(a.name),Buffer.from(b.name)));
function attest(db) {
  if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
      db.prepare('PRAGMA user_version').get().user_version !== PRODUCT_SIDECAR_FORMAT || !same(schema(db), expectedSchema)) unavailable('incompatible');
}
function productStat(path, optional = false) {
  let s;
  try { s = sqliteFileStat(path); } catch (e) { if (optional && e.code === 'ENOENT') return null; unavailable('storage_unavailable'); }
  if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o777n) !== 0o600n) unavailable('storage_unavailable');
  return s;
}
export function productFile(path, optional = false) {
  const s = productStat(path, optional);
  return s ? { device: String(s.dev), inode: String(s.ino) } : null;
}
function auxiliaries(path, writable, expectedIdentity, observer) {
  let journal;
  const companions = {};
  for (const suffix of ['-wal','-shm','-journal']) {
    const entry = productStat(path + suffix, true);
    companions[suffix] = entry;
    if (!entry) continue;
    if (!writable && suffix === '-journal') { journal = entry; continue; }
    if (!writable || suffix !== '-journal') unavailable('storage_unavailable');
  }
  if (journal) {
    let main, directory;
    try { main = productStat(path); directory = sqliteFileStat(dirname(path)); } catch { unavailable('storage_unavailable'); }
    if (expectedIdentity && (String(main.dev) !== expectedIdentity.device || String(main.ino) !== expectedIdentity.inode)) unavailable('storage_unavailable');
    const proof = { main, directory, journal };
    if (!protectedDeleteJournal({ ...proof, wal: companions['-wal'], shm: companions['-shm'] })) unavailable('storage_unavailable');
    if (!contextReadDeleteJournal(path, observer, { main, directory, expectedIdentity })) unavailable('storage_unavailable');
    const current = productStat(path + '-journal', true);
    if (current && !sameJournal(current, journal)) {
      let checked;
      try { checked = { main: sqliteFileStat(path), directory: sqliteFileStat(dirname(path)), journal: current,
        wal: productStat(path + '-wal', true), shm: productStat(path + '-shm', true) }; } catch { unavailable('storage_unavailable'); }
      if (!protectedDeleteJournal(checked, proof)) unavailable('storage_unavailable');
      // Sample the journal first so the remaining proof also covers this window.
      // Disappearance is busy only while the remaining protection proof holds.
      try {
        const optional = file => {
          try { return sqliteFileStat(file); } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
        };
        const finalJournal = optional(path + '-journal');
        const final = { journal: finalJournal ?? current, main: sqliteFileStat(path), directory: sqliteFileStat(dirname(path)),
          wal: optional(path + '-wal'), shm: optional(path + '-shm') };
        if (!protectedDeleteJournal(final, proof) || finalJournal && !sameJournal(finalJournal, current))
          unavailable('storage_unavailable');
      } catch { unavailable('storage_unavailable'); }
      fail('storage_busy');
    }
    for (const suffix of ['-wal','-shm']) if (productStat(path + suffix, true)) unavailable('storage_unavailable');
    fail('storage_busy');
  }
}
const generationId = g => digest({seed:g.seed,sequence:g.sequence,baseSequence:g.base_sequence,projection:g.projection});
const incarnationOf = g => digest({seed:g.seed,id:g.id,projection:g.projection,sequence:g.sequence,baseSequence:g.base_sequence,kind:g.kind,access:g.access,
  fences:JSON.parse(g.fences),phase:g.phase,lastKey:g.last_key,verify:typeof g.verify==='string'?JSON.parse(g.verify):g.verify});
const progressOf = g => ({ phase: g.phase, checkpoint: g.checkpoint, sequence: g.sequence, baseSequence: g.base_sequence });
function streams(p) {
  return p.readSet.flatMap(ns => ['card','memory'].filter(t => p.types.includes(t)).flatMap(type => type === 'card'
    ? ['draft','confirmed','cancelled','deleted'].map(state => ({ ns,type,state })) : [{ ns,type }]));
}
export function canonicalProductFences(db, p) {
  const canonical = [], dependency = [];
  for (const ns of p.readSet) {
    let memory;
    const layout=cachedContentLayout(db);
    if(layout?.suppressionRevision){
      const row=db.prepare(`SELECT n.epoch,coalesce(f.epoch_hi,0) epoch_hi,coalesce(f.epoch_lo,0) epoch_lo,
        f.owner_id IS NOT NULL suppression_present${layout.rawLineage?',EXISTS(SELECT 1 FROM raw_receipt_lineage LIMIT 1) AS raw_lineage_present':''} FROM (SELECT 1) anchor
        LEFT JOIN namespace_epochs n ON n.owner_id=? AND n.scope=? AND n.project_id=?
        LEFT JOIN owner_suppression_epochs f ON f.owner_id=?`).get(...boundary(ns),ns.ownerId);
      // An empty Raw-lineage table proves that unrelated Memory facts do not
      // need an extra ancestry pass. Otherwise retain canonical S1 filtering.
      // This is request data, never part of a signed publication or DTO.
      p.rawLineagePresent=layout.rawLineage?Boolean(row.raw_lineage_present):false;
      const epoch=`${row.epoch_hi}:${row.epoch_lo}`;
      if(p.suppressionEpoch!==undefined&&p.suppressionEpoch!==epoch)fail('evidence_unavailable');
      memory=row.epoch??1;
    }else memory=db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...boundary(ns))?.epoch??1;
    canonical.push({ memory,
      ...(p.types.includes('card') ? { card: db.prepare(`SELECT generation FROM card_epochs WHERE ${where}`).get(...boundary(ns))?.generation ?? 1 } : {}) });
    dependency.push(p.types.includes('card') ? cardDependencyFence(db, ns, p.readSet) : {});
  }
  return { canonicalFenceDigest: digest(canonical), dependencyFenceDigest: digest(dependency) };
}
export function canonicalProductIdentity(path, db) {
  const s = sqliteFileStat(path);
  return { device:String(s.dev),inode:String(s.ino), applicationId: db.prepare('PRAGMA application_id').get().application_id,
    userVersion: db.prepare('PRAGMA user_version').get().user_version, schemaVersion: db.prepare('PRAGMA schema_version').get().schema_version };
}

// Construction acquires no sidecar. Only a separately authorized operation
// invokes observe/refresh, including when the file is missing or malformed.
export function productSidecar({ path, db: canonicalDatabase, identity, features, observer, sqlite, sidecarJournalMode = 'DELETE', writable = false,
  sidecarHandles, now = () => performance.now(), rendezvous = () => {}, attribution, memoryComparison = null, comparisonOptions = {}, verificationBatching = false, verificationBatchState = verificationBatching ? new SharedArrayBuffer(8) : null }) {
  const canonical=canonicalDatabase;
  const canonicalRead=work=>attribution ? attribution.transaction(canonicalDatabase,work,readTransaction) : readTransaction(canonicalDatabase,work);
  features={...features,reviews:features.cards,receipts:features.cards};
  const sidePath = path + PRODUCT_SIDECAR_SUFFIX;
  let localHandle,handles=sidecarHandles&&sidecarHandleGuard(sidecarHandles);
  const handleRegistry=()=>handles??=sidecarHandleGuard(localHandle=reserveSidecarHandle(Object.values(productFile(path)).join(':')));
  const compare=memoryComparison?memoryComparison.createMemoryComparator():null;
  let comparisonBase=null, reuseOnlyWork=false;
  const costs=checkpointCost(now), checkpointYield=Symbol('checkpoint yield');
  let workQuantum=null, checkpointStarted, observationStarted, checkpointAttempted=false;
  // Pricing only limits later work transactions in this turn. The first
  // retains the base engine's admission, even after a slow commit. Setup-only
  // writes (selection retention and generation initialization) cannot consume it.
  const admitCheckpoint=(started=checkpointStarted)=>!workQuantum || !checkpointAttempted || costs.admit(workQuantum,started);
  let sideFormat, side, sideWritable, sideFiles, sideMode, openedIdentity, closed = false, metadata, lifecycle, lockIdentity, observedMissing=false, guardDepth=0, discardAfterGuard=false, guardWritable=false;
  function failed(error, wasWritable) {
    if(wasWritable || error.reason==='storage_unavailable' ||
        error.code==='ERR_SQLITE_ERROR' && Number.isInteger(error.errcode) && [10,11,13,26].includes(error.errcode&255))discardAfterGuard=true;
  }
  const lockPath=sidePath+'.lifecycle-lock.sqlite';
  const stamp=()=>{const s=sqliteFileStat(sidePath);return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');};
  function acquire(createLock=false) {
    if (!lifecycle) {
      if (!productFile(lockPath,true)) {
        if (!createLock) unavailable('storage_unavailable');
        try { createExclusiveSqliteFile(lockPath); } catch(e) {attribution?.captureFailure(e); if(e.code!=='EEXIST')throw e; }
      }
      lockIdentity=productFile(lockPath);
      const open=()=>new DatabaseSync(lockPath,{readOnly:true});
      const native=observer ? observer.invoke('open','connection',open) : open();
      // sqlite.open owns disposal on refusal; publish only an admitted handle.
      lifecycle=sqlite ? sqlite.open(native,lockPath).db : observer ? observer.database(native) : native;
    }
    lifecycle.exec('BEGIN');
    // A deferred BEGIN alone has no OS lock. This query pins the shared lock.
    lifecycle.prepare('PRAGMA schema_version').get();
    if(!same(lockIdentity,productFile(lockPath,true))){release();lifecycle.close();lifecycle=null;unavailable('storage_unavailable');}
  }
  function release() { if(lifecycle?.isTransaction)lifecycle.exec('ROLLBACK'); }
  function guarded(work,createLock=false) {
    if (closed) fail('store_closed');
    if(guardDepth)return work();
    guardWritable=!!(side && sideWritable);
    return cleaned(()=>{
      try {
        if(!createLock && !productFile(sidePath,true)){
          // Linearize absence here; do not open a concurrently published cache
          // without first taking its lifecycle lock.
          observedMissing=true;try{return work();}finally{observedMissing=false;}
        }
        return cleaned(()=>{acquire(createLock);guardDepth++;return work();},()=>{guardDepth=0;release();});
      } catch(error) {failed(error,guardWritable);throw error;}
    },()=>{
      // A caught bound may return honest progress without another write.
      // Discard here too when no later writable step consumed the flag.
      if(discardAfterGuard)close();
    });
  }
  function publish(replacement,init) {
    const work=()=>createExclusiveSqliteFile(sidePath,replacement,init,sqlite && observer ? {observe:observer.creation} : {});
    try { return observer && !sqlite ? observer.invoke('execute','transaction',work) : work(); }
    catch(error) {attribution?.captureFailure(error); if(sqlite)sqlite.initializationFailure(error);throw error; }
  }
  function verifyOpened() {
    sideFiles?.();
    if(!same(openedIdentity,productFile(sidePath,true)))unavailable('storage_unavailable');
  }
  function read(work) {
    const wasWritable=sideWritable===true;
    try { sideFiles?.({betweenSnapshots:sideMode==='DELETE' && !side.isTransaction});return readTransaction(side,()=>{
      side.prepare('PRAGMA schema_version').get();
      verifyOpened();rendezvous('snapshot');return work();
    }); } catch(e) {failed(e,wasWritable);attribution?.captureFailure(e); if(e.reason==='storage_unavailable')try{close();}catch{}throw e; }
  }
  const openNative = (write = false) => {
    try { return observer ? observer.invoke('open','connection', () => new DatabaseSync(sidePath, { readOnly: !write }))
      : new DatabaseSync(sidePath, { readOnly: !write }); }
    catch (error) {attribution?.captureFailure(error); if(sqlite)sqlite.openingFailure(error);throw error; }
  };
  function close() { discardAfterGuard=true;if (side?.isOpen) side.close(); handles?.closed(); side = null; metadata = null; sideFiles = null; discardAfterGuard=false; }
  function write(work, kind='setup', beforeCommit, checkpoint=true) {
    // Setup-only callers opt out explicitly; ambiguous writes count as work.
    // All lexical write starts share this gate, including setup, GC and the
    // qualified verification fallback. A denied start leaves signed work intact.
    if(!admitCheckpoint())throw checkpointYield;
    const started=checkpointStarted??now();checkpointStarted=undefined;
    // A caught verification rollback can continue within this refresh. Reopen
    // and check integrity before its fallback or any other transaction writes.
    if(discardAfterGuard)connection(true);
    const wasWritable=sideWritable===true;
    sideFiles?.({betweenSnapshots:sideMode==='DELETE' && !side.isTransaction});
    if(!admitCheckpoint(started))throw checkpointYield;
    if(workQuantum && checkpoint)checkpointAttempted=true;
    const began=now(),beginning=attribution?.start('begin');
    try {attribution?.checkpoint('begin');side.exec('BEGIN IMMEDIATE');}catch(error){failed(error,wasWritable);attribution?.captureFailure(error);throw error;}finally{attribution?.end(beginning);}
    try {
      verifyOpened();const result=work();rendezvous('batch');beforeCommit?.();
      const commitStarted=now(),committing=attribution?.start('commit');
      try {attribution?.checkpoint('commit');attribution?.add(kind+'CommitAttempts',1);side.exec('COMMIT');attribution?.add(kind+'Commits',1);}catch(error){attribution?.captureFailure(error);throw error;}finally{attribution?.end(committing);if(workQuantum)costs.commit(now()-commitStarted);}
      if(workQuantum){const ended=now();costs.transaction(ended-started,ended-began);}
      return result;
    }
    catch (e) {failed(e,wasWritable);attribution?.captureFailure(e);
      if(side.isTransaction) {attribution?.add(kind+'Rollbacks',1);
        if(verificationBatching&&kind==='verification'){try {side.exec('ROLLBACK');}catch(rollbackError) {
          if(e!==verificationBound&&e!==fenceChanged)attribution?.captureSecondaryFailure?.(rollbackError);
          try {close();}catch {}
          if(e===verificationBound||e===fenceChanged){attribution?.captureFailure(rollbackError);throw rollbackError;}
        }}
        else side.exec('ROLLBACK');
      }
      if(e!==fenceChanged && e!==verificationBound && e.reason==='storage_unavailable')close();throw e;
    }
  }
  function connection(create = false, checkAdmission) {
    checkAdmission?.();
    if (closed) fail('store_closed');
    // Capture the mode before admission can replace or upgrade the handle.
    guardWritable=!!(side && sideWritable);
    if(discardAfterGuard || side && !side.isOpen)close();
    if(observedMissing && !create)return false;
    const physical = productFile(sidePath, true), wantsWrite=writable&&create;
    if (!physical && !create) return false;
    if (side && physical && same(physical, openedIdentity) &&
        (sideWritable===wantsWrite || writable&&sideWritable&&!wantsWrite)) {
      if(sqlite){
        try {
          sideFiles?.({betweenSnapshots:sideMode==='DELETE' && !side.isTransaction});
          if((wantsWrite||sideWritable) && sideMode!==sidecarJournalMode)unavailable('storage_unavailable');
        } catch(error) {attribution?.captureFailure(error);try{close();}catch{}throw error;}
      } else {
        auxiliaries(sidePath, wantsWrite, openedIdentity, observer);
        if(sideWritable&&!wantsWrite) {
          // This request used to open a read-only connection. Preserve its
          // header refusal as well as the stricter non-write companion rule.
          const mode=probeRollbackJournal(sidePath,observer ? {observe:observer.journalProbe} : {});
          if(mode.code===14 || mode.mode && mode.mode!=='delete')unavailable('incompatible');
        }
      }
      if (create) read(() => {
        sideFormat=side.prepare('PRAGMA user_version').get().user_version;
        metadata=side.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
        if (!metadata || metadata.store_id!==identity.storeId) unavailable('wrong_store');
        attest(side);
        if (metadata.profile!==PRODUCT_PROFILE) unavailable('incompatible');
      });
      guardWritable=sideWritable;
      checkAdmission?.();
      return true;
    }
    // Pump work may reuse a validated handle, but must yield before any fresh
    // native admission (including a fallback after a caught writable failure).
    if(wantsWrite && reuseOnlyWork)throw admissionRequired;
    close();
    if(!sqlite)auxiliaries(sidePath, wantsWrite, openedIdentity, observer);
    if (!physical) {
      if (!writable) unavailable('missing');
      // The child publishes the complete format before any connection opens it.
      // It owns the exclusive lifecycle lock, so release our shared lock first.
      release();
      cleaned(()=>{try { checkAdmission?.();publish(null,initialization()); }
        catch(e) {attribution?.captureFailure(e); if(e.code!=='EEXIST')throw e; }},()=>acquire());
      checkAdmission?.();
    } else if (!sqlite) {
      const mode = probeRollbackJournal(sidePath, observer ? { observe: observer.journalProbe } : {});
      if (mode.code === 14 || mode.mode && mode.mode !== 'delete') unavailable('incompatible');
    }
    const admittedIdentity=productFile(sidePath), files=sqlite?.files(sidePath);
    checkAdmission?.();
    handleRegistry().opening();
    let candidate, admittedMetadata;
    sideMode=undefined;sideFormat=undefined;
    try {
      candidate=openNative(wantsWrite);
      if(sqlite){
        const native=candidate; // Retain disposal evidence if policy admission refuses.
        const opened=sqlite.open(native,sidePath);candidate=opened.db;sideMode=opened.mode;
        files({afterProbe:true});
        if(wantsWrite && sideMode!==sidecarJournalMode)unavailable('storage_unavailable');
      }else if(observer)candidate=observer.database(candidate);
      candidate.exec(sqlite ? 'PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;' : 'PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0;');
      files?.({betweenSnapshots:sideMode==='DELETE'});
      readTransaction(candidate,()=>{
        candidate.prepare('PRAGMA schema_version').get();files?.();
        if(!same(admittedIdentity,productFile(sidePath)))unavailable('storage_unavailable');
        rendezvous('snapshot');
        sideFormat=candidate.prepare('PRAGMA user_version').get().user_version;
        admittedMetadata=candidate.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
        if(!admittedMetadata || admittedMetadata.store_id!==identity.storeId)unavailable('wrong_store');
        if (sideFormat > 0 && sideFormat !== PRODUCT_SIDECAR_FORMAT) unavailable('incompatible');
        attest(candidate);
        if(admittedMetadata.profile!==PRODUCT_PROFILE)unavailable('incompatible');
        if(wantsWrite && (candidate.prepare('PRAGMA quick_check').get().quick_check!=='ok' || candidate.prepare('PRAGMA foreign_key_check').get()))unavailable('corrupt');
      });
      checkAdmission?.();
    } catch(error) {attribution?.captureFailure(error);try{if(candidate?.isOpen)candidate.close();}catch{}
      if(candidate?.isOpen)side=candidate;else handles.closed();throw error;}
    side=candidate;sideWritable=wantsWrite;sideFiles=files;openedIdentity=admittedIdentity;metadata=admittedMetadata;
    // Subsequent work starts on this admitted mode, including upgrade callers.
    guardWritable=wantsWrite;
    return true;
  }
  const initialization=()=>({autoVacuum:'INCREMENTAL',...(sqlite ? {journalMode:sidecarJournalMode} : {}),sql:`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${PRODUCT_SIDECAR_FORMAT}; ${ddl} ${VECTOR_DDL}`,
    storeId:identity.storeId,profile:PRODUCT_PROFILE,incarnation:randomUUID(),
    attestation:{applicationId:APPLICATION_ID,userVersion:PRODUCT_SIDECAR_FORMAT,schema:expectedSchema}});
  const sideIdentity = (reader=side,current=metadata) => ({ ...productFile(sidePath), incarnation: current.incarnation,
    schemaVersion: reader.prepare('PRAGMA schema_version').get().schema_version });
  function target(p, access,reader=canonical,sideReader=side,currentMetadata=metadata) {
    attribution?.step();
    let storeId;
    try {storeId=reader.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id;}
    catch(error){attribution?.captureFailure(error);throw error;}finally {attribution?.acquired();}
    if(storeId!==identity.storeId)unavailable('wrong_store');
    return { projectionDigest: projectionDigest(p), accessDigest: access, ...canonicalProductFences(reader,p),
      canonical: canonicalProductIdentity(path,reader), sidecar: sideIdentity(sideReader,currentMetadata) };
  }
  function recordBindings(r, t, progress = false) {
    if (r.storeId !== identity.storeId) return 'wrong_store';
    if (r.projectionDigest !== t.projectionDigest) return 'validation_invalid';
    if (progress ? r.canonicalIdentityDigest !== digest(t.canonical) || r.sidecarIdentityDigest !== digest({format:PRODUCT_SIDECAR_FORMAT,...t.sidecar})
      : !same(r.canonical,t.canonical) || !same(r.sidecar,t.sidecar) || r.tokenizer !== TOKENIZER_VERSION || r.representation !== REPRESENTATION_VERSION) return 'validation_invalid';
    if (r.accessDigest !== t.accessDigest) return 'access_changed';
    if (r.dependencyFenceDigest !== t.dependencyFenceDigest) return 'dependency_changed';
    if (r.canonicalFenceDigest !== t.canonicalFenceDigest) return 'fence_changed';
    return null;
  }
  const canMerge=()=>canonical.prepare('PRAGMA encoding').get().encoding==='UTF-8' && side.prepare('PRAGMA encoding').get().encoding==='UTF-8';
  function status(p, state, reason = null, progress = null, counts = null) {
    const ready = state === 'ready';
    return { profile: PRODUCT_PROFILE, lexical: { state,reason:reason ?? null,progress:progress ?? null }, semantic: { state:'disabled',reason:'not_enabled' },
      coverage: { status: ready ? p.ownerCoverage.omittedNamespaces ? 'partial' : 'complete' : 'unavailable',
        freshness: ready ? 'current' : ['stale','catching_up'].includes(state) ? 'stale' : 'unverified',
        byType: Object.fromEntries(['memory','card'].filter(t => p.types.includes(t)).map(t => [t,
          { eligible: ready ? counts.byType[t].eligible : null, indexed: ready ? counts.byType[t].indexed : null, embedded:null }])),
        namespaces: p.ownerCoverage } };
  }
  function invalid(p, reason) { if(guardWritable || reason==='validation_invalid' || reason==='foreign_binding')discardAfterGuard=true;return { dto: status(p,'unavailable',
    ['wrong_store','incompatible','corrupt','validation_missing','validation_invalid','storage_unavailable'].includes(reason) ? reason : 'storage_unavailable'), publication:null }; }
  // Caller supplies the canonical transaction. Pointer, generation and record
  // are read under one independent sidecar transaction, with no deep scans.
  function observe(p, access, {forWrite=false,knownFailure=null,workOnly=false,mergeOrder}={}) {
    if(knownFailure)return invalid(p,knownFailure);
    try {
      if (!connection(forWrite)) return { dto:status(p,'absent','missing'), publication:null };
      return read(() => {
        metadata = side.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
        if (!metadata || metadata.store_id !== identity.storeId) return invalid(p,'wrong_store');
        attest(side);
        if (metadata.profile !== PRODUCT_PROFILE) return invalid(p,'incompatible');
        const t = target(p,access), pointer = side.prepare('SELECT * FROM publications WHERE projection=?').get(t.projectionDigest);
        const work = side.prepare('SELECT * FROM work WHERE projection=?').get(t.projectionDigest);
        let checkpoint;
        const incomplete=()=>({ dto:status(p,checkpoint.baseSequence ? 'catching_up' : 'building',checkpoint.baseSequence ? 'resume_pending' : checkpoint.kind === 'rebuild' ? 'rebuild' : 'initial_build',checkpoint.progress),publication:null });
        if (work) {
          const g = side.prepare('SELECT * FROM generations WHERE id=?').get(work.generation);
          const text = side.prepare('SELECT record FROM progress_records WHERE generation=?').get(work.generation)?.record;
          if (!g || !text) return invalid(p,'validation_missing');
          const r = verifiedRecord(identity.cursorSecret,'progress',text,attribution);
          if ((JSON.parse(g.verify)?.byteSafe===1 && !(mergeOrder??canMerge()) && JSON.parse(g.verify)?.appendOnly!==true) || g.published || pointer?.generation===g.id || side.prepare('SELECT 1 FROM validation_records WHERE generation=?').get(g.id) ||
              g.id!==generationId(g) || g.incarnation!==incarnationOf(g) || !same(r.generation,{ id:g.id,incarnation:g.incarnation }) || !same(r.progress,progressOf(g)) ||
              r.kind !== g.kind || r.projectionDigest !== g.projection || r.accessDigest !== g.access ||
              !same(JSON.parse(g.fences), { canonicalFenceDigest:r.canonicalFenceDigest,dependencyFenceDigest:r.dependencyFenceDigest })) return invalid(p,'validation_invalid');
          const mismatch = recordBindings(r,t,true);
          if (mismatch && !['access_changed','dependency_changed','fence_changed'].includes(mismatch)) return invalid(p,mismatch);
          // Legacy work is authenticated but cannot attest byte-safe scanning.
          // Ignore it for resumption without hiding an existing publication.
          if(JSON.parse(g.verify).byteSafe===1)checkpoint = { mismatch,baseSequence:g.base_sequence,kind:g.kind,progress:r.progress };
        }
        if(workOnly)return {
          resumable:checkpoint && !checkpoint.mismatch ? work.generation : null,
          retargetable:checkpoint && ['dependency_changed','fence_changed'].includes(checkpoint.mismatch) ? work.generation : null
        };
        if (!pointer) return checkpoint ? checkpoint.mismatch ? { dto:status(p,'stale',checkpoint.mismatch),publication:null } : incomplete() : { dto:status(p,'absent','missing'),publication:null };
        const g = side.prepare('SELECT * FROM generations WHERE id=?').get(pointer.generation);
        // Fold the bounded visible-count proof into the record query already
        // executed in this observation's sidecar snapshot. It is request data,
        // never part of a signed lexical/vector publication.
        const memo=suppressionMemo(p),keys=memo?.facts?.filter(f=>f.kind==='memory').flatMap(f=>{
          const stream=streams(p).findIndex(s=>s.type==='memory'&&s.ns.scope===f.scope&&(s.ns.projectId??'')===f.project_id);
          return stream<0?[]:[[stream,f.stable_key]];
        });
        const record=keys?.length?side.prepare(`SELECT record,(SELECT json_group_array(json_object(
          'stream',d.stream,'id',d.id,'doc',d.doc,'revision',d.revision,'body_revision',d.body_revision,
          'eligible',d.eligible,'token_length',d.token_length)) FROM json_each(?) k CROSS JOIN documents d
          WHERE d.generation=? AND d.stream=json_extract(k.value,'$[0]')
            AND d.id=json_extract(k.value,'$[1]')) AS suppression_documents
          FROM validation_records WHERE publication=?`).get(JSON.stringify(keys),g?.storage_id??-1,pointer.publication):
          side.prepare('SELECT record FROM validation_records WHERE publication=?').get(pointer.publication);
        const text=record?.record;
        if (!g || !text) return invalid(p,'validation_missing');
        const r = verifiedRecord(identity.cursorSecret,'validation',text,attribution);
        const expectedTypes = ['memory','card'].filter(type => p.types.includes(type));
        if ((JSON.parse(g.verify)?.byteSafe===1 && !(mergeOrder??canMerge()) && JSON.parse(g.verify)?.appendOnly!==true) || g.id !== generationId(g) || g.incarnation !== incarnationOf(g) || g.phase !== streams(p).length+3 || !g.published || r.publicationId !== pointer.publication || !same(r.generation, { id:g.id,sequence:g.sequence,checkpoint:g.checkpoint,incarnation:g.incarnation }) ||
            g.projection !== r.projectionDigest || g.access !== r.accessDigest || g.manifest !== r.manifestDigest ||
            !same(JSON.parse(g.fences),{ canonicalFenceDigest:r.canonicalFenceDigest,dependencyFenceDigest:r.dependencyFenceDigest }) ||
            !same(r.counts,JSON.parse(g.verify).counts) || !same(Object.keys(r.counts.byType).sort(),expectedTypes.sort())) return invalid(p,'validation_invalid');
        const mismatch = recordBindings(r,t);
        if (mismatch && !['access_changed','dependency_changed','fence_changed'].includes(mismatch)) return invalid(p,mismatch);
        const byteSafe=JSON.parse(g.verify).byteSafe===1;
        // A legacy publication stays available while its replacement is private.
        if(byteSafe && checkpoint && !checkpoint.mismatch)return incomplete();
        if(memo) {
          const documents=new Map(JSON.parse(record?.suppression_documents??'[]').map(d=>[JSON.stringify([d.stream,d.id]),d]));
          let proofs=suppressionProofs.get(memo);if(!proofs){proofs=new WeakMap();suppressionProofs.set(memo,proofs);}
          proofs.set(r,{visible:suppressionView(p,r,memo,(stream,key)=>documents.get(JSON.stringify([stream,key])))});
        }
        return { dto:status(p,mismatch ? 'stale' : 'ready',mismatch,progressOf(g),r.counts), publication:r,byteSafe };
      });
    } catch (e) {failed(e,guardWritable);attribution?.captureFailure(e);
      if (e instanceof SyntaxError) return invalid(p,'validation_invalid');
      if (e.code === 'index_unavailable') return invalid(p,e.reason);
      if (e.code === 'ERR_SQLITE_ERROR' && [11,26].includes(e.errcode & 255)) return invalid(p,'corrupt');
      if (e.code === 'ERR_SQLITE_ERROR' && [5,6].includes(e.errcode & 255)) throw e;
      if (e.code === 'ERR_SQLITE_ERROR') return invalid(p,(e.errcode&255)===1?'incompatible':'storage_unavailable');
      throw e;
    }
  }
  function save(g,t) {
    // The signed incarnation commits to resumable hash/count/scan state too.
    // A changed verification checkpoint cannot be used to mint a certificate.
    const signing=attribution?.start('save');let record;
    try {
      attribution?.checkpoint('save');g.incarnation=incarnationOf(g);
      record=signedRecord(identity.cursorSecret,'progress',{ version:'context-index-progress-v1',profile:PRODUCT_PROFILE,storeId:identity.storeId,
      canonicalIdentityDigest:digest(t.canonical),sidecarIdentityDigest:digest({format:PRODUCT_SIDECAR_FORMAT,...t.sidecar}),projectionDigest:g.projection,accessDigest:g.access,
      ...JSON.parse(g.fences),generation:{ id:g.id,incarnation:g.incarnation },kind:g.kind,progress:progressOf(g) });
    }catch(error){attribution?.captureFailure(error);throw error;}finally{attribution?.end(signing);}
    if (Buffer.byteLength(record)>4096) fail('context_item_too_large');
    side.prepare('INSERT OR REPLACE INTO progress_records VALUES(?,?)').run(g.id,record);
    side.prepare('UPDATE generations SET incarnation=?,fences=?,phase=?,last_key=?,checkpoint=?,verify=? WHERE id=?').run(g.incarnation,g.fences,g.phase,g.last_key,g.checkpoint,JSON.stringify(g.verify),g.id);
    side.prepare('INSERT OR REPLACE INTO work VALUES(?,?)').run(g.projection,g.id);
  }
  function fresh(t,p,access) {
    return same(t,canonicalRead(() => target(p,access)));
  }
  function metadataRows(s, after, maximum, p, m, canonicalUtf8) {
    // Column collations are not attested. Both the cursor and ordering must
    // explicitly match the stored-byte merge; INDEXED BY never changes SQL order.
    attribution?.step();
    let rows;
    try {rows = canonical.prepare(s.type === 'memory'
      ? `SELECT id,hex(CAST(id AS BLOB)) AS id_bytes,revision,0 AS body_revision,deleted,currentness,review_state FROM memories INDEXED BY index_memory_keyset WHERE ${where} AND id COLLATE BINARY>? ORDER BY id COLLATE BINARY LIMIT ?`
      : `SELECT id,hex(CAST(id AS BLOB)) AS id_bytes,revision,coalesce(body_revision,0) AS body_revision,state FROM private_cards INDEXED BY private_card_scope WHERE ${where} AND state=? AND id COLLATE BINARY>? ORDER BY id COLLATE BINARY LIMIT ?`)
      .all(...boundary(s.ns),...(s.type === 'card' ? [s.state] : []),after,maximum);}
    catch(error){attribution?.captureFailure(error);throw error;}finally {attribution?.acquired();}
    m.canonicalRows += rows.length; m.metadataBytes += Buffer.byteLength(JSON.stringify(rows.map(({id_bytes,...row})=>row)));
    // UTF-8 binding agrees with Buffer encoding; only UTF-16 needs a native
    // round trip (its conversion can rewrite values such as U+FFFE).
    if(canonicalUtf8) {
      for(const row of rows)if(!Buffer.from(row.id).equals(Buffer.from(row.id_bytes,'hex')))unavailable('corrupt');
    } else {
      const rebound=canonical.prepare(`SELECT hex(CAST(id AS BLOB)) AS bytes FROM ${s.type==='memory'?'memories':'private_cards'} WHERE ${where} AND id COLLATE BINARY=?`);
      for(const row of rows)if(rebound.get(...boundary(s.ns),row.id)?.bytes!==row.id_bytes)unavailable('corrupt');
    }
    // Count and meter support independently of transformation attempts.
    const support = bindContentSafetyConnection({ get isTransaction() { return canonical.isTransaction; }, prepare(sql) { const stmt = canonical.prepare(sql); return Object.fromEntries(['get','all'].map(method => [method,(...args) => {
      m.supportLookups++; const r = stmt[method](...args); m.supportBytes += Buffer.byteLength(JSON.stringify(r ?? null)); return r;
    }])); } }, canonical);
    return rows.map(row => ({ id:row.id,id_bytes:row.id_bytes,revision:row.revision,body_revision:row.body_revision,
      eligible:Number(s.type === 'memory' ? memoryReadEligible(row, p.intent)
        : contextCardEligible(support,identity,features,s.ns,row,p.intent,{ readSet:p.readSet })) }));
  }
  const storageKey = id => {
    const key=side.prepare('SELECT storage_id FROM generations WHERE id=?').get(id)?.storage_id;
    if(key===undefined)unavailable('validation_missing');
    return key;
  };
  function put(g,stream,row,tokens,source,cacheUtf8) {
    const s=g.streams[stream], key=JSON.stringify([...boundary(s.ns),s.type,row.id]);
    const doc=side.prepare('SELECT coalesce(max(doc),0)+1 AS id FROM documents WHERE generation=?').get(g.storage_id).id;
    if(cacheUtf8 && (Buffer.from(row.id).toString()!==row.id || Buffer.from(key).toString()!==key))unavailable('corrupt');
    side.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run(g.storage_id,doc,stream,row.id,key,row.revision,row.body_revision,row.eligible,tokens.length);
    if(!cacheUtf8) {
      const stored=side.prepare('SELECT id,identity FROM documents WHERE generation=? AND doc=?').get(g.storage_id,doc);
      if(stored.id!==row.id || stored.identity!==key)unavailable('corrupt');
    }
    const terms=source ? side.prepare(`SELECT s.term,p.frequency FROM postings p JOIN statistics s
      ON s.generation=p.generation AND s.term_id=p.term JOIN documents d ON d.generation=p.generation AND d.doc=p.doc
      WHERE p.generation=? AND d.identity=? ORDER BY s.term`).all(storageKey(source),key)
      : [...tokens.frequencies].map(([term,frequency])=>({term,frequency}));
    let next=side.prepare('SELECT coalesce(max(term_id),0)+1 AS id FROM statistics WHERE generation=?').get(g.storage_id).id;
    let position=0;
    terms.sort((a,b)=>Buffer.compare(Buffer.from(a.term),Buffer.from(b.term)));
    for(const {term,frequency} of terms) {
      const termId=side.prepare('INSERT INTO statistics(generation,term_id,term,df,n,total_length) VALUES(?,?,?,1,0,0) ON CONFLICT(generation,term) DO UPDATE SET df=df+1 RETURNING term_id').get(g.storage_id,next++,term).term_id;
      side.prepare('INSERT INTO postings VALUES(?,?,?,?,?)').run(g.storage_id,doc,termId,frequency,++position);
    }
    side.prepare("UPDATE statistics SET n=n+?,total_length=total_length+? WHERE generation=? AND term='' ").run(row.eligible,tokens.length,g.storage_id);
  }
  // Only authenticated, unpublished work reaches this path. Integer keys need
  // not be dense: verification hashes identities/term text and audits references.
  function remove(g, old) {
    const terms=side.prepare(`UPDATE statistics SET df=df-1 WHERE generation=? AND term_id IN
      (SELECT term FROM postings WHERE generation=? AND doc=?) RETURNING term_id,df`).all(g.storage_id,g.storage_id,old.doc);
    side.prepare('DELETE FROM postings WHERE generation=? AND doc=?').run(g.storage_id,old.doc);
    for(const term of terms)if(term.df===0)side.prepare('DELETE FROM statistics WHERE generation=? AND term_id=?').run(g.storage_id,term.term_id);
    side.prepare("UPDATE statistics SET n=n-?,total_length=total_length-? WHERE generation=? AND term=''").run(old.eligible,old.token_length,g.storage_id);
    side.prepare('DELETE FROM documents WHERE generation=? AND doc=?').run(g.storage_id,old.doc);
  }
  function verifyPage(g, p, m, quantum, db=side, maximum=128, repeatBytes) {
    const v=g.verify;
    if(v.phase===1 && !v.resetDone) {
      // Counters are derived verification state, never unchecked input. Reset
      // them in bounded primary-key ranges before counting any postings.
      const reset=quantum.measure(()=>db.prepare(`UPDATE statistics SET verified_df=0 WHERE generation=? AND term_id IN
        (SELECT term_id FROM statistics WHERE generation=? ${v.resetLast===undefined?'':'AND term_id>?'} ORDER BY term_id LIMIT ${maximum})
        RETURNING term_id`).all(g.storage_id,g.storage_id,...(v.resetLast===undefined?[]:[v.resetLast])),'verification-reset');
      m.verifiedRows+=reset.length;attribution?.add('verificationRows',reset.length);
      if(reset.length)v.resetLast=Math.max(...reset.map(row=>row.term_id));
      if(reset.length===maximum)return;
      v.resetDone=true;
      if(!quantum.admit('verify-scan') || !quantum.admit('verification'))return;
    }
    const hash=new ManifestHash(v.hash), phase=v.statisticsDone ? 3 : v.phase, last=v.last;
    let rows, exhausted=false;
    quantum.measure(()=>{
      if(phase===0) rows=db.prepare(`SELECT * FROM documents WHERE generation=? ${last.length?'AND identity>?':''} ORDER BY identity LIMIT ${maximum}`).all(g.storage_id,...last);
      else if(phase===1) {
        // Fill a bounded prefix of the same logical manifest posting stream,
        // using bounded covering integer ranges for each document. Empty
        // documents count against a separate bounded document scan. Each
        // completed document is an ordered verification item too: even an
        // empty document must be checked before the durable cursor passes it.
        rows=[];
        let document=db.prepare(`SELECT * FROM documents WHERE generation=? ${last.length?`AND identity${v.documentDone?'>':'>='}?`:''} ORDER BY identity LIMIT 1`).get(g.storage_id,...(last.length?[last[0]]:[]));
        let visited=0,postings=0;
        while(document && postings<maximum && visited++<maximum) {
          const page=db.prepare(`SELECT p.term AS term_id,p.position,p.frequency,s.term FROM postings p INDEXED BY product_document_order
            LEFT JOIN statistics s ON s.generation=p.generation AND s.term_id=p.term
            WHERE p.generation=? AND p.doc=? AND p.position>? ORDER BY p.position LIMIT ${maximum}`).all(g.storage_id,document.doc,document.identity===last[0] ? last[1] ?? 0 : 0);
          const selected=page.slice(0,maximum-postings);
          repeatBytes?.(document.identity,selected.length);
          rows.push(...selected.map(row=>({...row,document})));
          postings+=selected.length;
          if(postings===maximum)break;
          rows.push({document,complete:true});
          document=db.prepare('SELECT * FROM documents WHERE generation=? AND identity>? ORDER BY identity LIMIT 1').get(g.storage_id,document.identity);
        }
        exhausted=!document;
      } else if(phase===2) rows=db.prepare(`SELECT * FROM statistics WHERE generation=? ${last.length?'AND term>?':''} ORDER BY term LIMIT ${maximum}`).all(g.storage_id,...last);
      else rows=db.prepare(`SELECT p.doc,p.term,d.eligible,s.term AS text FROM postings p
        LEFT JOIN documents d ON d.generation=p.generation AND d.doc=p.doc
        LEFT JOIN statistics s ON s.generation=p.generation AND s.term_id=p.term
        WHERE p.generation=? ${last.length?'AND (p.doc,p.term)>(?,?)':''} ORDER BY p.doc,p.term LIMIT ${maximum}`).all(g.storage_id,...last);
      attribution?.add('scanRows',rows.length);rendezvous('verify-scan');
    },'verify-scan');
    let processed=0;
    for(const r of rows) {
      // Scanning and the first returned row form one admission unit. A scan
      // that used its estimate must never commit a successful empty checkpoint.
      if(processed && !quantum.admit('verification'))break;
      if(now()>=quantum.cutoff)fail('read_timeout');
      quantum.measure(()=>{
        let tuple;
        if(phase===0) {
          // Lookup starts after zero. Check the same domain even when a
          // tampered file bypassed the attested DDL's CHECK constraints.
          if(r.doc<=0)unavailable('corrupt');
          tuple=['document',JSON.parse(r.identity),r.revision,r.body_revision,r.eligible,REPRESENTATION_VERSION,r.token_length];
          v.counts.documents++;v.counts.totalTokenLength+=r.token_length;
          const type=g.streams[r.stream].type;v.counts.byType[type].eligible+=r.eligible;v.counts.byType[type].indexed+=r.eligible;
          v.last=[r.identity];
        } else if(phase===1) {
          if(r.document.doc<=0)unavailable('corrupt');
          if(r.complete) {
            if(v.documentIdentity!==undefined && v.documentIdentity!==r.document.identity)unavailable('corrupt');
            const length=v.documentIdentity===r.document.identity ? v.documentLength : 0;
            if(length!==r.document.token_length)unavailable('corrupt');
            delete v.documentIdentity;delete v.documentLength;delete v.expectedLength;delete v.previousTerm;
            v.last=[r.document.identity,0];v.documentDone=true;
          } else {
            if(v.documentIdentity!==r.document.identity) {
              if(v.documentIdentity!==undefined)unavailable('corrupt');
              v.documentIdentity=r.document.identity;v.documentLength=0;v.previousTerm='';
            }
            if(!r.term || !r.document.eligible || (v.previousTerm && Buffer.compare(Buffer.from(v.previousTerm),Buffer.from(r.term))>=0))unavailable('corrupt');
            v.documentLength+=r.frequency;v.previousTerm=r.term;v.postings=(v.postings ?? 0)+1;
            db.prepare('UPDATE statistics SET verified_df=verified_df+1 WHERE generation=? AND term_id=?').run(g.storage_id,r.term_id);
            tuple=['posting',JSON.parse(r.document.identity),r.term,r.frequency];v.last=[r.document.identity,r.position];delete v.documentDone;
          }
        } else if(phase===2) {
          const n=Object.values(v.counts.byType).reduce((sum,c)=>sum+c.eligible,0);
          if(r.term==='' ? r.n!==n || r.total_length!==v.counts.totalTokenLength || r.df!==0 || r.verified_df!==0
            : r.df<=0 || r.df!==r.verified_df || r.n!==0 || r.total_length!==0)unavailable('corrupt');
          tuple=['statistics',r.term,r.df,r.n,r.total_length];if(r.term)v.counts.terms++;v.last=[r.term];
        } else {
          if(r.doc<=0 || r.eligible!==1 || !r.text)unavailable('corrupt');
          v.last=[r.doc,r.term];v.checkedPostings=(v.checkedPostings ?? 0)+1;
        }
        if(tuple)hash.update(JSON.stringify(tuple)+'\n');m.verifiedRows++;processed++;
        attribution?.add('verificationRows',1);rendezvous('verify-item');
      },'verification');
    }
    v.hash=hash.state();
    if(phase===1) {
      if(processed===rows.length && exhausted){v.phase++;v.last=[];delete v.documentDone;}
    } else if(processed===rows.length && rows.length<maximum) {
      if(phase===2) {
        v.statisticsDone=true;v.last=[];
        // Fold the bounded referential audit into this checkpoint when it
        // fits. Its cursor resumes durably without adding a public phase.
        if(maximum===128 && quantum.admit('verify-scan') && quantum.admit('verification')) {verifyPage(g,p,m,quantum);return;}
      } else {
        if(phase===3 && (v.checkedPostings ?? 0)!==(v.postings ?? 0))unavailable('corrupt');
        v.phase++;v.last=[];
      }
    }
    g.phase=g.streams.length+v.phase;
  }
  // Derived retention: one most recently maintained selection per owner,
  // exact type set and intent. Never discard the other intent or a staging
  // generation's immutable base. All deletion slices are replayable SQLite
  // transactions under the same lifecycle lock and service operation.
  function selectProjection(p,t) {
    const owner=p.readSet[0].ownerId, types=canonicalJson([...p.types].sort());
    const old=side.prepare('SELECT projection FROM selections WHERE owner=? AND types=? AND intent=? AND projection<>? LIMIT 1').get(owner,types,p.intent,t.projectionDigest);
    if(!old && side.prepare('SELECT 1 FROM selections WHERE projection=?').get(t.projectionDigest))return;
    write(()=>{
      side.prepare('INSERT OR IGNORE INTO selections VALUES(?,?,?,?)').run(t.projectionDigest,owner,types,p.intent);
      if(old) {
        side.prepare('DELETE FROM publications WHERE projection=?').run(old.projection);
        side.prepare('DELETE FROM work WHERE projection=?').run(old.projection);
        side.prepare('DELETE FROM vector_publications WHERE projection=? AND owner=?').run(old.projection,owner);
        side.prepare('DELETE FROM vector_work WHERE projection=?').run(old.projection);
        side.prepare('DELETE FROM selections WHERE projection=?').run(old.projection);
      }
    },'setup',undefined,false);
  }
  function vectorCandidate(owner,lexicalGeneration) {
    return side.prepare(`SELECT storage_id,id FROM vector_generations v WHERE owner=? AND ${lexicalGeneration!==undefined?'lexical_generation=?':`
      (NOT EXISTS(SELECT 1 FROM generations l JOIN publications p ON p.generation=l.id WHERE l.storage_id=v.lexical_generation AND p.projection=v.projection)
       OR (NOT EXISTS(SELECT 1 FROM vector_publications WHERE generation=v.storage_id) AND NOT EXISTS(SELECT 1 FROM vector_work WHERE generation=v.storage_id)))`}
      ORDER BY storage_id LIMIT 1`).get(owner,...(lexicalGeneration!==undefined?[lexicalGeneration]:[]));
  }
  // Remove rows before their signed metadata. A slice advances exactly one
  // bounded range; an interrupted deletion resumes from the remaining rows.
  const gcChanges=result=>{attribution?.add('gcRows',result.changes);return result;};
  function collectVector(owner,lexicalGeneration) {
    if(lexicalGeneration!==undefined) {
      const cached=gcChanges(side.prepare(`DELETE FROM semantic_vectors WHERE owner=? AND generation=? AND (doc,identity,epoch) IN
        (SELECT doc,identity,epoch FROM semantic_vectors WHERE owner=? AND generation=? LIMIT 128)`).run(owner,lexicalGeneration,owner,lexicalGeneration));
      if(cached.changes)return true;
    }
    const g=vectorCandidate(owner,lexicalGeneration);
    if(!g)return false;
    const rows=gcChanges(side.prepare('DELETE FROM vector_rows WHERE generation=? AND doc IN (SELECT doc FROM vector_rows WHERE generation=? LIMIT 128)').run(g.storage_id,g.storage_id));
    if(rows.changes)return true;
    gcChanges(side.prepare('DELETE FROM vector_publications WHERE generation=? AND owner=?').run(g.storage_id,owner));
    gcChanges(side.prepare('DELETE FROM vector_work WHERE generation=?').run(g.storage_id));
    gcChanges(side.prepare('DELETE FROM vector_validation_records WHERE generation=? AND owner=?').run(g.storage_id,owner));
    gcChanges(side.prepare('DELETE FROM vector_generations WHERE storage_id=? AND owner=?').run(g.storage_id,owner));
    return true;
  }
  function collect(quantum,owner,maximum=128) {
    let slices=0;
    while(admitCheckpoint() && quantum.admit('gc') && slices++<maximum) {
      // A read-only hint avoids empty write transactions. Repeat both
      // lexical and vector retirement decisions under BEGIN IMMEDIATE.
      const lexicalCandidate=side.prepare(`SELECT 1 FROM generations g WHERE g.owner=? AND
        NOT EXISTS(SELECT 1 FROM publications WHERE generation=g.id) AND
        NOT EXISTS(SELECT 1 FROM work WHERE generation=g.id) AND
        NOT EXISTS(SELECT 1 FROM generations b JOIN work w ON w.generation=b.id WHERE b.base_id=g.id) LIMIT 1`).get(owner);
      if(!lexicalCandidate&&!vectorCandidate(owner))break;
      rendezvous('gc-candidate');
      let found=false;
      quantum.measure(()=>{write(()=>{
        const g=side.prepare(`SELECT storage_id,id FROM generations g WHERE g.owner=? AND
        NOT EXISTS(SELECT 1 FROM publications WHERE generation=g.id) AND
        NOT EXISTS(SELECT 1 FROM work WHERE generation=g.id) AND
        NOT EXISTS(SELECT 1 FROM generations b JOIN work w ON w.generation=b.id WHERE b.base_id=g.id)
        ORDER BY storage_id LIMIT 1`).get(owner);
        if(!g){found=collectVector(owner);return;}
        found=true;
        for(const [table,key] of [['postings','doc,term'],['documents','doc'],['statistics','term_id']]) {
          const result=gcChanges(side.prepare(`DELETE FROM ${table} WHERE generation=? AND (${key}) IN (SELECT ${key} FROM ${table} WHERE generation=? LIMIT 128)`).run(g.storage_id,g.storage_id));
          if(result.changes)return;
        }
        if(collectVector(owner,g.storage_id))return;
        gcChanges(side.prepare('DELETE FROM validation_records WHERE generation=?').run(g.id));
        gcChanges(side.prepare('DELETE FROM progress_records WHERE generation=?').run(g.id));
        gcChanges(side.prepare('DELETE FROM generations WHERE id=?').run(g.id));
      },'gc');if(found)rendezvous('gc');},'gc');
      if(!found)break;
    }
    if(admitCheckpoint() && quantum.admit('gc'))quantum.measure(()=>{
      if(discardAfterGuard)connection(true);
      const wasWritable=sideWritable===true;
      try {side.exec('PRAGMA incremental_vacuum(32)');}
      catch(e) {failed(e,wasWritable);if(e.code!=='ERR_SQLITE_ERROR' || (e.errcode&255)!==5)throw e;}
      // Optional BUSY skips reclamation; attribution counts admitted attempts.
    },'gc','vacuum');
  }
  function compareInputs(p,access,budget,quantum,baseUnavailable=false) {
    const m={};
    if(compare){
      // Load/authenticate the immutable volatile input map and the current
      // sidecar seals before acquiring the comparison's canonical snapshot.
      // Legacy signed records authenticate only their own B1 state; they never
      // substitute for a complete B3 input manifest.
      let checkpoint;
      const comparison=quantum.measure(()=>compare({db:canonical,read:canonicalRead,selection:p,identity:{storeId:identity.storeId},access,
        now,cutoff:quantum.cutoff-quantum.reserve,budget,attribution,physicalIdentity:reader=>canonicalProductIdentity(path,reader),
        ...comparisonOptions,loadBase:account=>{
          if(baseUnavailable)throw Error('comparison_base_unavailable');
          if(!side)return {checkpoint:null,base:null};
          checkpoint=read(()=>{
            const metered=memoryComparison.comparisonReader(side,account),projection=projectionDigest(p),bindings=[];
            const currentMetadata=metered.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
            if(!currentMetadata||currentMetadata.store_id!==identity.storeId)unavailable('wrong_store');
            attest(metered);
            if(currentMetadata.profile!==PRODUCT_PROFILE)unavailable('incompatible');
            const currentTarget=canonicalRead(()=>target(p,access,memoryComparison.comparisonReader(canonical,account),metered,currentMetadata));
            for(const [table,column,purpose]of [['work','generation','progress'],['publications','publication','validation']]){
              const pointer=metered.prepare(`SELECT * FROM ${table} WHERE projection=?`).get(projection);
              if(!pointer){bindings.push(null);continue;}
              const g=metered.prepare('SELECT * FROM generations WHERE id=?').get(pointer.generation);
              const text=metered.prepare(`SELECT record FROM ${purpose==='progress'?'progress_records':'validation_records'} WHERE ${column}=?`).get(pointer[column])?.record;
              if(!g||!text)throw Error('comparison_base_missing');
              if([text,g.fences,g.verify].some(value=>typeof value!=='string'||Buffer.byteLength(value)>262144))throw Error('comparison_base_frame');
              account.charge(0,4*Buffer.byteLength(text));
              const record=verifiedRecord(identity.cursorSecret,purpose,text,attribution);
              const progress=purpose==='progress',checkpointValid=progress
                ? !g.published&&record.kind===g.kind&&Object.entries(progressOf(g)).every(([k,v])=>record.progress[k]===v)
                : g.published===1&&record.generation.sequence===g.sequence&&record.generation.checkpoint===g.checkpoint&&
                  record.publicationId===pointer.publication&&record.manifestDigest===g.manifest;
              if(record.storeId!==identity.storeId||g.owner!==p.readSet[0].ownerId||
                g.projection!==projection||record.projectionDigest!==projection||record.accessDigest!==g.access||!checkpointValid||
                g.id!==generationId(g)||g.incarnation!==incarnationOf(g)||record.generation.id!==g.id||record.generation.incarnation!==g.incarnation)throw Error('comparison_base_invalid');
              const mismatch=recordBindings(record,currentTarget,progress);
              if(mismatch&&!['access_changed','dependency_changed','fence_changed'].includes(mismatch))throw Error('comparison_base_binding');
              bindings.push({id:g.id,incarnation:g.incarnation,checkpoint:g.checkpoint});
            }
            return memoryComparison.comparisonJson(bindings,account);
          });
          return {checkpoint,base:comparisonBase?.checkpoint===checkpoint?comparisonBase.output:null};
        }}),'comparison','scan');
      m.comparison=comparison;
      Object.assign(m,Object.fromEntries(comparisonWorkFields.map(k=>[k,0])),{comparisonAttempts:1,
        comparisonComplete:Number(comparison.status!=='incomplete'),comparisonEqual:Number(comparison.status==='complete/equal'),
        comparisonDifferent:Number(comparison.status==='complete/different'),comparisonIncomplete:Number(comparison.status==='incomplete'),
        comparisonRows:comparison.rows,comparisonBytes:comparison.bytes});
      // Incompletion retains no partial map or clock. A restart drops this
      // volatile basis; no format, certificate, publication or serving change.
      comparisonBase=comparison.status==='incomplete'?null:{checkpoint,output:comparison};
    }
    return m;
  }
  function admissionBindings(checkAdmission) {
    // Authenticate before interpreting identity metadata, including retained
    // certificates without live pointers. Never scan corpus rows here.
    const canonicalIdentity=canonicalRead(()=>canonicalProductIdentity(path,canonical));
    checkAdmission();
    return read(()=>{
      const cacheIdentity=sideIdentity();
      for(const sql of [
        'SELECT 1 FROM publications p LEFT JOIN validation_records r ON r.publication=p.publication AND r.generation=p.generation WHERE r.publication IS NULL LIMIT 1',
        'SELECT 1 FROM work w LEFT JOIN progress_records r ON r.generation=w.generation WHERE r.generation IS NULL LIMIT 1'
      ]){checkAdmission();if(side.prepare(sql).get())unavailable('validation_missing');}
      checkAdmission();
      const basis=createHash('sha256');let foreign=false;
      for(const [purpose,sql] of [
        ['validation','SELECT substr(record,1,16385) AS record FROM validation_records ORDER BY publication'],
        ['progress','SELECT substr(record,1,4097) AS record FROM progress_records ORDER BY generation']
      ]){
        checkAdmission();
        for(const {record:text} of side.prepare(sql).iterate()) {
          checkAdmission();
          const record=verifiedRecord(identity.cursorSecret,purpose,text,attribution);
          if(record.storeId!==identity.storeId)unavailable('wrong_store');
          basis.update(purpose+'\0'+text+'\0');
          foreign ||= purpose==='progress'
            ? record.canonicalIdentityDigest!==digest(canonicalIdentity)||record.sidecarIdentityDigest!==digest({format:PRODUCT_SIDECAR_FORMAT,...cacheIdentity})
            : !same(record.canonical,canonicalIdentity)||!same(record.sidecar,cacheIdentity);
        }
        checkAdmission();
      }
      // Complete authentication of both sets before authorizing replacement.
      return foreign?basis.digest('hex'):null;
    });
  }
  function admit(checkBindings=false,cutoff=Infinity) {
    const checkAdmission=()=>{if(cutoff!==Infinity&&now()>=cutoff)fail('read_timeout');};
    checkAdmission();
    // Retain the identity whose validation failed. A different selection may
    // repair the cache before this maintainer reaches its own repair branch.
    const repairIdentity=productFile(sidePath,true),repairStamp=repairIdentity && stamp();
    let foreignBindingDigest;
    try { connection(true,checkAdmission);if(checkBindings&&(foreignBindingDigest=admissionBindings(checkAdmission)))unavailable('foreign_binding'); }
    catch(e) {if(e===admissionRequired)throw e;attribution?.captureFailure(e);
      if (!['wrong_store','incompatible','corrupt','foreign_binding'].includes(e.reason) && !(e.code==='ERR_SQLITE_ERROR' && [1,11,26].includes(e.errcode&255))) throw e;
      const oldFormat = sideFormat > 0 && sideFormat !== PRODUCT_SIDECAR_FORMAT; close();
      checkAdmission();
      if (oldFormat) unavailable(e.reason==='wrong_store'?'wrong_store':'incompatible');
      // A WAL cache (or an indeterminate mode) cannot enter the legacy nolock
      // replacement protocol. Quiesce and rebuild it explicitly at the host.
      if(sqlite && sideMode!=='DELETE')unavailable('storage_unavailable');
      // Repair is explicit maintenance, never a read fallback. Refuse live or
      // unsafe companions; SQLite alone performs journal recovery on opening.
      auxiliaries(sidePath,false,openedIdentity,observer);
      const old=productFile(sidePath);
      if(!repairIdentity || !same(old,repairIdentity))unavailable('storage_unavailable');
      try {
        release();
        cleaned(()=>handleRegistry().replace(()=>{checkAdmission();return publish(old.device+':'+old.inode,{...initialization(),expectedStamp:repairStamp,...(foreignBindingDigest?{foreignBindingDigest}:{})});},()=>{throw admissionRequired;}),()=>acquire());
      } catch(e) {attribution?.captureFailure(e);
        if(['ESTALE','EEXIST','EBUSY'].includes(e.code))unavailable('storage_unavailable');
        throw e;
      }
      connection(true,checkAdmission);
      if(checkBindings&&admissionBindings(checkAdmission))unavailable('foreign_binding');
    }
  }
  function refresh(p,access,budget,quantum) {
    if (!writable) fail('invalid_input');
    const m = { transformed:0,canonicalRows:0,metadataBytes:0,textRows:0,textBytes:0,supportLookups:0,supportBytes:0,verifiedRows:0,
      reused:0,replaced:0,removed:0,copied:0,tokenized:0,retargets:0,verificationRestarts:0,verificationKept:0 };
    workQuantum=quantum;
    checkpointAttempted=false;costs.turn(quantum);
    try {return refreshWork(p,access,budget,quantum,m);}
    catch(error){if(error!==checkpointYield)throw error;attribution?.resetFailure();return m;}
    finally {workQuantum=null;checkpointStarted=undefined;}
  }
  function refreshWork(p,access,budget,quantum,m) {
    if(reuseOnlyWork) {
      try {connection(true);}catch(error) {
        if(error===admissionRequired)throw error;
        if(['wrong_store','incompatible','corrupt'].includes(error.reason)||error.code==='ERR_SQLITE_ERROR'&&[1,11,26].includes(error.errcode&255)){
          close();throw admissionRequired;
        }
        throw error;
      }
    }else admit();
    rendezvous('opened');
    if(compare)Object.assign(m,compareInputs(p,access,budget,quantum));
    // The merge's byte comparator and both indexed TEXT cursors must have
    // identical BINARY order. Other encodings retain the append-only builder.
    const canonicalUtf8=canonical.prepare('PRAGMA encoding').get().encoding==='UTF-8',
      cacheUtf8=side.prepare('PRAGMA encoding').get().encoding==='UTF-8',mergeOrder=canonicalUtf8&&cacheUtf8;
    let t = canonicalRead(() => target(p,access));
    selectProjection(p,t);
    // Cleanup also advances during a long build or repeated target changes;
    // it does not depend on having time left after corpus admission.
    collect(quantum,p.readSet[0].ownerId,1);
    const observed = canonicalRead(() => observe(p,access,{forWrite:true,mergeOrder}));
    if (observed.dto.lexical.state === 'ready' && observed.byteSafe) { collect(quantum,p.readSet[0].ownerId);rendezvous('noop'); return m; }
    const w = side.prepare('SELECT generation FROM work WHERE projection=?').get(t.projectionDigest);
    let g = w && side.prepare('SELECT * FROM generations WHERE id=?').get(w.generation);
    const workStatus=canonicalRead(()=>observe(p,access,{forWrite:true,workOnly:true,mergeOrder}));
    const resumable=g && (workStatus.resumable===g.id || mergeOrder && workStatus.retargetable===g.id);
    let rebinding=false;
    // Invalid publication evidence still controls status. Independently signed
    // rebuild work can resume; delta work must first abandon the invalid base.
    if (!resumable || !g || g.access !== access || (observed.dto.lexical.state === 'unavailable' && g.base_sequence!==0)) {
      const pointer = side.prepare('SELECT generation FROM publications WHERE projection=?').get(t.projectionDigest);
      const published = observed.dto.lexical.state !== 'unavailable' && pointer && side.prepare('SELECT * FROM generations WHERE id=?').get(pointer.generation);
      const base = observed.byteSafe && published;
      const baseSequence = base?.sequence ?? 0;
      g = { id:null,incarnation:null,seed:randomUUID(),projection:t.projectionDigest,sequence:Math.max(published?.sequence ?? 0,g?.sequence ?? 0)+1,
        base_sequence:baseSequence,checkpoint:0,kind:baseSequence ? 'delta' : pointer || w ? 'rebuild' : metadata.kind,
        fences:canonicalJson({ canonicalFenceDigest:t.canonicalFenceDigest,dependencyFenceDigest:t.dependencyFenceDigest }),access,
        phase:0,last_key:'',base_id:base?.id ?? null,verify:initialVerification(p) };
      if(!mergeOrder)g.verify.appendOnly=true;
      g.id=generationId(g);g.incarnation=incarnationOf(g);
      write(() => {
        side.prepare('INSERT INTO generations(id,owner,projection,incarnation,sequence,base_sequence,checkpoint,kind,fences,access,phase,last_key,base_id,verify,manifest,published,seed) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)').run(g.id,p.readSet[0].ownerId,g.projection,g.incarnation,g.sequence,g.base_sequence,0,g.kind,g.fences,g.access,0,'',g.base_id,JSON.stringify(g.verify),null,g.seed);
        g.storage_id=side.prepare('SELECT storage_id FROM generations WHERE id=?').get(g.id).storage_id;
        side.prepare("INSERT INTO statistics(generation,term_id,term,df,n,total_length) VALUES(?,0,'',0,0,0)").run(g.storage_id); save(g,t);
      },'setup',undefined,false);
    } else {
      g.verify=JSON.parse(g.verify);
      if(mergeOrder && workStatus.retargetable===g.id) {
        // Rebinding is provisional until a real comparison batch commits. A
        // cutoff/race before that commit leaves the old signed checkpoint intact.
        g.fences=canonicalJson({canonicalFenceDigest:t.canonicalFenceDigest,dependencyFenceDigest:t.dependencyFenceDigest});
        g.phase=0;g.last_key='';g.verify.reconciling=true;rebinding=true;
      }
    }
    g.streams = streams(p);
    while (admitCheckpoint() && quantum.admit('scan') && quantum.admit('item') && g.phase < g.streams.length && m.transformed<budget.maxItems) {
      checkpointStarted=now();
      if (!fresh(t,p,access)) return m;
      const stream = g.streams[g.phase], maximum = stream.type === 'card' ? 1 : 128;
      const { rows, exhausted } = quantum.measure(()=>{
        const canonicalRows=canonicalRead(() => metadataRows(stream,g.last_key,maximum,p,m,canonicalUtf8));
        if(!mergeOrder) {
          attribution?.add('scanRows',canonicalRows.length);
          rendezvous('scan');return {rows:canonicalRows.map(row=>({row,old:null})),exhausted:canonicalRows.length<maximum};
        }
        const workRows=side.prepare('SELECT *,hex(CAST(id AS BLOB)) AS id_bytes FROM documents WHERE generation=? AND stream=? AND id COLLATE BINARY>? ORDER BY id COLLATE BINARY LIMIT ?')
          .all(g.storage_id,g.phase,g.last_key,maximum);
        if(cacheUtf8) {
          for(const old of workRows)if(!Buffer.from(old.id).equals(Buffer.from(old.id_bytes,'hex')))unavailable('corrupt');
        } else {
          const rebound=side.prepare('SELECT hex(CAST(id AS BLOB)) AS bytes FROM documents WHERE generation=? AND stream=? AND id COLLATE BINARY=?');
          for(const old of workRows)if(rebound.get(g.storage_id,g.phase,old.id)?.bytes!==old.id_bytes)unavailable('corrupt');
        }
        const rows=[];let c=0,w=0;
        // Merge at most one page of keys. A full input page can never run out
        // before this output bound; absence is proved only in its scanned range.
        while(rows.length<maximum && (c<canonicalRows.length || w<workRows.length)) {
          const row=canonicalRows[c],old=workRows[w];
          const order=!row ? 1 : !old ? -1 : Buffer.compare(Buffer.from(row.id_bytes,'hex'),Buffer.from(old.id_bytes,'hex'));
          rows.push({row:order<=0 ? canonicalRows[c++] : null,old:order>=0 ? workRows[w++] : null});
        }
        attribution?.add('scanRows',rows.length);rendezvous('scan');return {rows,exhausted:c===canonicalRows.length && w===workRows.length && canonicalRows.length<maximum && workRows.length<maximum};
      },'scan');
      if(now()>=quantum.cutoff)fail('read_timeout');
      let units=0, processed=0, last=g.last_key;
      // Include postings/dictionary writes in the observed item cost. Staging
      // rows and their checkpoint commit together, even when admission yields.
      try { write(() => {
        const changing=()=>{
          if(g.verify.reconciling || g.verify.hash.bytes || g.verify.phase) {
            g.verify=initialVerification(p);m.verificationRestarts++;
          }
        };
        for (const {row,old} of rows) {
          if (processed && !quantum.admit() || m.transformed>=budget.maxItems) break;
          if(now()>=quantum.cutoff)fail('read_timeout');
          const kept=quantum.measure(()=>{
            if(row && exactDocument(old,row))m.reused++;
            else if(!row) {changing();remove(g,old);m.removed++;}
            else {
              const base=g.base_id && side.prepare('SELECT * FROM documents WHERE generation=? AND stream=? AND id=?').get(storageKey(g.base_id),g.phase,row.id);
              let tokens,source;
              if(exactDocument(base,row)) {tokens={length:base.token_length};source=g.base_id;}
              else {
                const text=row.eligible ? canonicalRead(()=>{
                  attribution?.step();
                  let found;
                  try {found=canonical.prepare(stream.type==='memory'
                    ? `SELECT content AS text FROM memories WHERE ${where} AND id COLLATE BINARY=?` : `SELECT title||char(10)||body AS text FROM private_cards WHERE ${where} AND id COLLATE BINARY=?`).get(...boundary(stream.ns),row.id);}
                  catch(error){attribution?.captureFailure(error);throw error;}finally {attribution?.acquired();}return found?.text;
                }) : '';
                if(typeof text!=='string' || text.length>2000000) {
                  // A deletion/forget can invalidate the observed body before
                  // this read. Preserve the same batch-only fence-race outcome.
                  if(!fresh(t,p,access))throw fenceChanged;
                  fail('context_item_too_large');
                }
                if(processed && units+text.length>2000000)return false;
                units+=text.length;m.transformed++;m.tokenized++;m.textRows+=Number(Boolean(row.eligible));m.textBytes+=Buffer.byteLength(text);tokens=termFrequencies(text);
              }
              changing();
              // Cards can move to an earlier state stream. Remove the old
              // identity before inserting there; the later stream then sees absence.
              const displaced=mergeOrder && (old || side.prepare('SELECT * FROM documents WHERE generation=? AND identity=?')
                .get(g.storage_id,JSON.stringify([...boundary(stream.ns),stream.type,row.id])));
              if(displaced){remove(g,displaced);if(displaced.stream===g.phase)m.replaced++;else m.removed++;}
              if(source)m.copied++;
              put(g,g.phase,row,tokens,source,cacheUtf8);
            }
            last=(row || old).id;processed++;
            attribution?.add('itemRows',1);rendezvous('item');return true;
          });
          if (!kept) break;
        }
        rendezvous('transformed');
        if(!fresh(t,p,access))throw fenceChanged;
        g.last_key=last;
        if(processed===rows.length && exhausted){g.phase++;g.last_key='';}
        if(g.phase===g.streams.length) {
          if(g.verify.reconciling){delete g.verify.reconciling;m.verificationKept++;}
          g.phase+=g.verify.phase;
        }
        if(rebinding){m.retargets++;rebinding=false;}
        g.checkpoint++;save(g,t);
      },'comparison'); } catch(e) {attribution?.captureFailure(e); if(e===fenceChanged)return m;throw e; }
      rendezvous('checkpoint');
    }
    const verificationAdmitted=()=>admitCheckpoint() && g.phase>=g.streams.length && g.verify.phase<3 && quantum.admit('verify-scan') && quantum.admit('verification') &&
      (g.verify.phase!==1 || g.verify.resetDone || quantum.admit('verification-reset'));
    const batching=verificationBatching && verificationBatch({now,quantum,state:verificationBatchState});
    const legacyVerification=()=>{
      let finalized;
      const copy={...g,verify:structuredClone(g.verify)};
      if(now()>=quantum.cutoff)fail('read_timeout');
      if(!verificationAdmitted()||!batching.admitLegacy())return false;
      const tail=batching.begin();
      try {write(()=>{
        verifyPage(copy,p,m,quantum);
        if(same(copy.verify,g.verify))throw verificationBound;
        finalized=now();tail.tail();
        if(!fresh(t,p,access))throw fenceChanged;copy.checkpoint++;save(copy,t);
      },'verification',()=>{
        tail.tail();if(!fresh(t,p,access))throw fenceChanged;tail.tail();
      });}
      catch(error){if(error===verificationBound||error===fenceChanged){attribution?.resetFailure();return false;}throw error;}
      g=copy;batching.observe(finalized);return true;
    };
    while (verificationAdmitted()) {
      checkpointStarted=now();
      if (!fresh(t,p,access)) return m;
      if(!batching) {
        write(() => { verifyPage(g,p,m,quantum); g.checkpoint++; save(g,t); },'verification');
      } else if(batching.legacy(g.verify.statisticsDone?3:g.verify.phase)) {
        if(!legacyVerification())return m;
      } else {
        const durable=g, tentative={...g,verify:structuredClone(g.verify)}, before=JSON.stringify(g.verify);
        let meter;const batch=batching.begin();
        if(!batch.work())break;
        let chunks=0, fallback=false;
        try {write(()=>{
          if(!batch.work())throw verificationBound;
          try {meter=verificationMeter(side,attribution,Buffer.byteLength(before),
            2*(5+p.readSet.length*(p.types.includes('card')?4+p.readSet.length:1)));}
          catch(error){if(error===verificationBound)fallback=true;throw error;}
          while(chunks<batch.width && tentative.verify.phase<3 && batch.work()) {
            const previous=structuredClone(tentative.verify), phase=tentative.phase;
            side.exec('SAVEPOINT verification_chunk');
            try {
              verifyPage(tentative,p,m,batch.quantum,meter.db,32,meter.repeat);
              side.exec('RELEASE verification_chunk');
            } catch(error) {
              if(error!==verificationBound)throw error;
              discardAfterGuard=true;side.exec('ROLLBACK TO verification_chunk; RELEASE verification_chunk');
              tentative.verify=previous;tentative.phase=phase;
              fallback=chunks===0;attribution?.resetFailure();break;
            }
            if(same(previous,tentative.verify))break;
            chunks++;rendezvous('verification-chunk');
          }
          if(JSON.stringify(tentative.verify)===before)throw verificationBound;
          batch.tail();if(!fresh(t,p,access))throw fenceChanged;
          tentative.checkpoint++;save(tentative,t);
        },'verification',()=>{batch.tail();if(!fresh(t,p,access))throw fenceChanged;batch.tail();});
        } catch(error) {
          // Reload through authenticated observation on the next call; never keep tentative aliases.
          g=durable;
          if(error===verificationBound) {
            attribution?.resetFailure();
            if(batch.shortage)return m;
            if(!fallback)break;
            batching.fallback(g.verify.statisticsDone?3:g.verify.phase);
            if(!legacyVerification())return m;
          } else if(error===fenceChanged){attribution?.resetFailure();return m;}else throw error;
        }
        if(chunks && !fallback){g=tentative;batch.committed();}
      }
      rendezvous('verification');
    }
    if (g.phase>=g.streams.length && g.verify.phase===3 && admitCheckpoint() && quantum.admit('publication')) {
      checkpointStarted=now();
      if(fresh(t,p,access))quantum.measure(()=>{
        if(!side.prepare("SELECT 1 FROM statistics WHERE generation=? AND term=''").get(g.storage_id))unavailable('corrupt');
        const publicationId=randomUUID(), manifestDigest=new ManifestHash(g.verify.hash).digest();
        // Last pre-commit canonical snapshot ends here. The independent writer
        // may commit after this check; the certificate still attests captured E.
        rendezvous('precommit');
        write(() => {
          g.checkpoint++;
          const body={ version:'context-index-validation-v1',profile:PRODUCT_PROFILE,format:PRODUCT_SIDECAR_FORMAT,storeId:identity.storeId,
            canonical:t.canonical,sidecar:t.sidecar,projectionDigest:g.projection,accessDigest:access,...JSON.parse(g.fences),
            tokenizer:TOKENIZER_VERSION,representation:REPRESENTATION_VERSION,
            generation:{id:g.id,sequence:g.sequence,checkpoint:g.checkpoint,incarnation:g.incarnation},publicationId,manifestDigest,counts:g.verify.counts };
          const record=signedRecord(identity.cursorSecret,'validation',body);
          if (Buffer.byteLength(record)>16384) fail('context_item_too_large');
          verifiedRecord(identity.cursorSecret,'validation',record,attribution);
          side.prepare('UPDATE generations SET published=1,checkpoint=?,manifest=? WHERE id=?').run(g.checkpoint,manifestDigest,g.id);
          side.prepare('INSERT INTO validation_records VALUES(?,?,?)').run(publicationId,g.id,record);
          side.prepare('INSERT OR REPLACE INTO publications VALUES(?,?,?)').run(g.projection,g.id,publicationId);
          side.prepare('DELETE FROM work WHERE projection=?').run(g.projection);
        },'publication');
        attribution?.add('publicationRows',1);rendezvous('published');
      },'publication');
    }
    collect(quantum,p.readSet[0].ownerId);
    return m;
  }
  const suppressionProofs=new WeakMap();
  function suppressionMemo(p) {
    if(!cachedContentLayout(canonical)?.suppressionRevision||!cachedContentSuppressionRequestInside(canonical,p.readSet[0].ownerId))return null;
    return contentSuppressionRequestInside(canonical,p.readSet);
  }
  function suppressionView(p,publication,memo,document) {
    if(memo.epoch==='0:0'||memo.facts?.length===0)return null;
    const ss=streams(p),denied=new Set();
    const counts={...publication.counts,byType:Object.fromEntries(p.types.map(type=>[type,{...publication.counts.byType[type]}]))};
    let unknown=!memo.facts || memo.layout.rawLineage || p.types.includes('card') || memo.facts.some(f=>!['memory','owner','namespace','receipt'].includes(f.kind));
    if(memo.facts)for(const fact of memo.facts){
      if(['owner','namespace'].includes(fact.kind))fail('evidence_unavailable');
      if(fact.kind!=='memory')continue;
      const stream=ss.findIndex(s=>s.type==='memory'&&s.ns.scope===fact.scope&&(s.ns.projectId??'')===fact.project_id);
      if(stream<0)continue;
      const row=document(stream,fact.stable_key);
      if(!row?.eligible||denied.has(row.doc))continue;
      if(contentSuppressionReasonInside(canonical,ss[stream].ns,{kind:'memory',key:fact.stable_key,revision:row.revision,
        version:JSON.stringify(['memory-revision-v1',row.revision])})){
        denied.add(row.doc);counts.byType.memory.eligible--;counts.byType.memory.indexed--;counts.totalTokenLength-=row.token_length;
      }
    }
    if(unknown)for(const type of p.types)counts.byType[type]={eligible:null,indexed:null};
    return {denied,counts,unknown,canonicalRequired:p.rawLineagePresent!==false,checkEach:!memo.facts || p.types.includes('card') || memo.facts.some(f=>f.kind==='raw'),filtered:unknown||denied.size>0};
  }
  function suppressionRequest(p,publication,work) {
    if(!publication || !cachedContentLayout(canonical)?.suppressionRevision ||
      contentSuppressionRequestFenceInside(canonical,p.readSet[0].ownerId)==='0:0')return work(null);
    const memo=suppressionMemo(p),proof=memo&&suppressionProofs.get(memo)?.get(publication);
    if(memo?.facts?.length===0)return work(null);
    if(proof)return work(proof.visible);
    const inspect=()=>withContentSuppressionReadInside(canonical,p.readSet,memo=>{
      if(memo.facts?.length===0)return work(null);
      const generation=storageKey(publication.generation.id);
      return work(suppressionView(p,publication,memo,(stream,key)=>side.prepare(
        'SELECT doc,revision,body_revision,eligible,token_length FROM documents WHERE generation=? AND stream=? AND id=?').get(generation,stream,key)));
    });
    return canonical.isTransaction?inspect():readTransaction(canonical,inspect);
  }
  function visibleCounts(p,publication) {
    if(!publication||!cachedContentLayout(canonical)?.suppressionRevision||
      contentSuppressionRequestFenceInside(canonical,p.readSet[0].ownerId)==='0:0')return null;
    const memo=suppressionMemo(p),proof=memo&&suppressionProofs.get(memo)?.get(publication);
    if(memo?.facts?.length===0)return null;
    if(proof)return proof.visible?.counts??null;
    return read(()=>suppressionRequest(p,publication,visible=>visible?.counts??null));
  }
  function cardCandidateAllowed(ref, p) {
    return contextCardEligible(canonical,identity,features,ref.namespace,
      {id:ref.cardId,revision:ref.revision,body_revision:ref.bodyRevision},p.intent,{readSet:p.readSet});
  }
  function lexicalSuppressed(p,publication,query,limit,visible) {
    const terms=[...new Set(tokenizeT1(query))],generation=storageKey(publication.generation.id),ss=streams(p),documents=[];
    const placeholders=terms.map(()=>'?').join(','),checked=new WeakSet();
    for(const term of terms){
      let after=0;
      while(true){
        if(now()>=(p.deadlineAt??Infinity))fail('read_timeout');
        const rows=side.prepare(`SELECT p.doc FROM postings p INDEXED BY product_term
          WHERE p.generation=? AND p.term=(SELECT term_id FROM statistics WHERE generation=? AND term=?) AND p.doc>? ORDER BY p.doc LIMIT 128`)
          .all(generation,generation,term,after);
        for(const row of rows){
          if(visible.denied.has(row.doc))continue;
          const frequencies=new Map(side.prepare(`SELECT s.term,p.frequency FROM statistics s INDEXED BY sqlite_autoindex_statistics_2 CROSS JOIN postings p
            ON p.generation=s.generation AND p.term=s.term_id AND p.doc=?
            WHERE s.generation=? AND s.term IN (${placeholders})`).all(row.doc,generation,...terms).map(r=>[r.term,r.frequency]));
          if(terms.find(t=>frequencies.has(t))!==term)continue;
          const document=side.prepare('SELECT stream,id,revision,body_revision,token_length,eligible FROM documents WHERE generation=? AND doc=?').get(generation,row.doc);
          if(!document?.eligible)continue;
          const stream=ss[document.stream],ref={type:stream.type,namespace:stream.ns,[stream.type==='memory'?'memoryId':'cardId']:document.id,
            revision:document.revision,...(stream.type==='card'?{bodyRevision:document.body_revision}:{})};
          if(stream.type==='card'&&visible.checkEach&&contentSuppressionMayMatchInside(canonical,stream.ns,{kind:'card',key:document.id})){
            if(!cardCandidateAllowed(ref,p))continue;
            checked.add(ref);
          }
          documents.push({ref,frequencies,length:document.token_length});
        }
        if(rows.length<128)break;after=rows.at(-1).doc;
      }
    }
    if(visible.checkEach){
      const memory=documents.filter(({ref})=>ref.type==='memory'&&contentSuppressionMayMatchInside(canonical,ref.namespace,{kind:'memory',key:ref.memoryId}));
      const allowed=memoryCandidatesAllowedInside(canonical,memory.map(d=>d.ref),p,identity);
      const decisions=new Map(memory.map((d,i)=>[d.ref,allowed[i]]));
      for(const {ref}of memory)if(decisions.get(ref))checked.add(ref);
      for(let i=documents.length-1;i>=0;i--)if(decisions.get(documents[i].ref)===false)documents.splice(i,1);
    }
    const df=new Map(terms.map(term=>[term,documents.filter(d=>d.frequencies.has(term)).length]));
    const N=visible.unknown?documents.length:Object.values(visible.counts.byType).reduce((n,c)=>n+c.eligible,0);
    const totalLength=visible.unknown?documents.reduce((n,d)=>n+d.length,0):visible.counts.totalTokenLength;
    const ranked=rankScores(documents.map(d=>({ref:d.ref,score:scoreBM25(terms,d,{N,totalLength,df})}))).slice(0,limit);
    const pending=ranked.filter(({ref})=>!checked.has(ref)&&!(visible.canonicalRequired===false&&!contentSuppressionMayMatchInside(canonical,ref.namespace,{kind:ref.type,key:ref.memoryId??ref.cardId})));
    const memory=pending.filter(({ref})=>ref.type==='memory');
    const allowed=memoryCandidatesAllowedInside(canonical,memory.map(d=>d.ref),p,identity);
    const decisions=new Map(memory.map((d,i)=>[d.ref,allowed[i]]));
    for(const {ref}of pending)if(ref.type==='card')decisions.set(ref,cardCandidateAllowed(ref,p));
    const rows=ranked.filter(({ref})=>decisions.get(ref)!==false);
    return {rows,matched:documents.length,counts:visible.counts,filtered:visible.filtered};
  }
  function lexical(p, publication, query, limit=24) {
    if (!publication || !connection()) unavailable('missing');
    rendezvous('lexical');
    return read(() => suppressionRequest(p,publication,visible => {
      if (visible) return lexicalSuppressed(p,publication,query,limit,visible);
      const terms=[...new Set(tokenizeT1(query))], total=publication.counts, df=new Map(), ranked=[];
      if(!terms.length)return {rows:[],matched:0};
      const placeholders=terms.map(()=>'?').join(','),generation=storageKey(publication.generation.id),ss=streams(p);
      const N=Object.values(total.byType).reduce((n,c)=>n+c.eligible,0);
      for(const term of terms)df.set(term,side.prepare('SELECT df FROM statistics WHERE generation=? AND term=?').get(generation,term)?.df??0);
      let matched=0;
      for(const term of terms) {
        let after=0;
        while(true){
          if(now()>=(p.deadlineAt??Infinity))fail('read_timeout');
          // A native statement visits at most 128 postings from one term's
          // index range. Missing terms never walk the generation's postings;
          // eligibility and scoring happen after the bounded enumeration.
          const rows=side.prepare(`SELECT p.doc FROM postings p INDEXED BY product_term
            WHERE p.generation=? AND p.term=(SELECT term_id FROM statistics WHERE generation=? AND term=?) AND p.doc>? ORDER BY p.doc LIMIT 128`).all(generation,generation,term,after);
          for(const row of rows){
            if(now()>=(p.deadlineAt??Infinity))fail('read_timeout');
            const frequencies=new Map(side.prepare(`SELECT s.term,p.frequency FROM statistics s INDEXED BY sqlite_autoindex_statistics_2 CROSS JOIN postings p
              ON p.generation=s.generation AND p.term=s.term_id AND p.doc=?
              WHERE s.generation=? AND s.term IN (${placeholders})`).all(row.doc,generation,...terms).map(r=>[r.term,r.frequency]));
            // Score an identity exactly once, on its first matching query term.
            // Keep the original term order for byte-identical BM25 arithmetic.
            if(terms.find(t=>frequencies.has(t))!==term)continue;
            const document=side.prepare('SELECT stream,id,revision,body_revision,token_length,eligible FROM documents WHERE generation=? AND doc=?').get(generation,row.doc);
            if(!document?.eligible)continue;
            const score=scoreBM25(terms,{frequencies,length:document.token_length},{N,totalLength:total.totalTokenLength,df});
            ranked.push({score,ref:{type:ss[document.stream].type,namespace:ss[document.stream].ns,
              [ss[document.stream].type==='memory'?'memoryId':'cardId']:document.id,revision:document.revision,...(ss[document.stream].type==='card'?{bodyRevision:document.body_revision}:{})}});
            rankScores(ranked);if(ranked.length>limit)ranked.pop();matched++;
          }
          if(rows.length<128)break;after=rows.at(-1).doc;
        }
      }
      return {rows:ranked,matched};
    }));
  }

  return {
    visibleCounts,
    vectorFence(p,lexical) {
      return recordBindings(lexical,target(projection(p),lexical.accessDigest))===null&&
        side.prepare('SELECT publication FROM publications WHERE projection=?').get(lexical.projectionDigest)?.publication===lexical.publicationId;
    },
    vectors(work, mutation=false) {
      return guarded(()=>{
        if(!connection(mutation))return null;
        if(!side.prepare("SELECT 1 FROM sqlite_schema WHERE name='vector_publications' AND type='table'").get())return null;
        return (mutation ? write : read)(()=>work(side));
      });
    },
    observe(p,...args) {
      p=projection(p);
      try {return guarded(()=>observe(p,...args));}
      catch(e) {attribution?.captureFailure(e);if(e.code==='index_unavailable')return invalid(p,e.reason);throw e;}
    },
    admit:cutoff=>{if(!writable)fail('invalid_input');return guarded(()=>admit(true,cutoff),true);},
    refresh:(p,access,budget,reuseOnly=false)=>{
      const started=now();p=projection(p);
      const cutoff=Math.min(p.deadlineAt ?? Infinity,started+budget.maxMs);
      const quantum=maintenanceQuantum({now,cutoff,maxMs:budget.maxMs,attribution});
      if(verificationBatching)quantum.batchStart=started;
      reuseOnlyWork=reuseOnly;
      try {return guarded(()=>refresh(p,access,budget,quantum),true);}
      finally {reuseOnlyWork=false;observationStarted=now();}
    },
    compare:(p,access,budget,quantum)=>{
      if(!compare)return null;
      const started=now();p=projection(p);
      quantum??=maintenanceQuantum({now,cutoff:Math.min(p.deadlineAt??Infinity,started+budget.maxMs),maxMs:budget.maxMs,attribution});
      return guarded(()=>{let baseUnavailable=false;try{connection(false);}catch(error){failed(error,guardWritable);comparisonBase=null;baseUnavailable=true;}
        return compareInputs(p,access,budget,quantum,baseUnavailable);
      });
    },
    lexical:(p,...args)=>{p=projection(p);return guarded(()=>lexical(p,...args));},
    // Start after refresh, finish outside the index's safety delivery envelope:
    // canonical acquisition, authorization, DTO preparation and delivery proofs.
    // The unchanged quantum reserve also leaves room for Worker/parent delivery.
    measureObservation(work) {
      try {return work();}finally {
        if(observationStarted!==undefined){costs.tail(now()-observationStarted);observationStarted=undefined;}
      }
    },
    prepareObservation() {
    try {return guarded(()=>{ connection(false);return null; }); }
    catch(e) {attribution?.captureFailure(e);
      // Carry the observed failure into this operation's final observation;
      // never retry a failed native opening/statement behind the status DTO.
      if(e.code==='index_unavailable')return e.reason;
      if(e.code==='ERR_SQLITE_ERROR' && ![5,6].includes(e.errcode&255))
        return [11,26].includes(e.errcode&255)?'corrupt':(e.errcode&255)===1?'incompatible':'storage_unavailable';
      throw e;
    }
  },discard() {
    // Worker failures can occur after sidecar work has succeeded. Use that
    // operation's captured mode, including an admitted upgrade, rather than
    // the current handle; read-only storage failures already mark disposal.
    if(guardWritable || discardAfterGuard)close();
  },
    close() { closed=true;comparisonBase=null;const lock=lifecycle;lifecycle=null;cleaned(()=>close(),()=>cleaned(()=>lock?.close(),()=>{if(!side?.isOpen){handles?.closed();localHandle?.release();}})); },
    // Explicit restore gate; callers must have already drained all clients.
    reset() {return guarded(()=>{
      if (!writable) fail('invalid_input');
      comparisonBase=null;
      if (!connection(true)) return;
      write(() => {
        side.exec('DELETE FROM vector_publications; DELETE FROM vector_work; DELETE FROM vector_rows; DELETE FROM semantic_vectors; DELETE FROM vector_validation_records; DELETE FROM vector_generations; DELETE FROM vector_purge_checkpoints; DELETE FROM publications; DELETE FROM work; DELETE FROM validation_records; DELETE FROM progress_records; DELETE FROM postings; DELETE FROM documents; DELETE FROM statistics; DELETE FROM generations; DELETE FROM selections;');
        side.prepare('UPDATE product_metadata SET incarnation=?,kind=? WHERE singleton=1').run(randomUUID(),'rebuild');
      });
      metadata = side.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
    },true);} };
}

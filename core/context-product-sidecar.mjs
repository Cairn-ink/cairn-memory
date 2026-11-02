import { memoryReadEligible } from './content-safety.mjs';
import { DatabaseSync } from 'node:sqlite';
import { types } from 'node:util';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { dirname } from 'node:path';
import { createExclusiveSqliteFile, probeRollbackJournal, sqliteFileStat } from './sqlite-journal-probe.mjs';
import { readTransaction } from './database.mjs';
import { contextCardEligible, contextReadDeleteJournal } from './context-read-sidecar.mjs';
import { cardDependencyFence } from './card-current-storage.mjs';
import { termFrequencies, tokenizeT1, TOKENIZER_VERSION, REPRESENTATION_VERSION } from './context-read-tokenize.mjs';
import { scoreBM25, rankScores } from './context-read-bm25.mjs';
import { PRODUCT_PROFILE } from './context-product-control.mjs';
import { contextReadSet } from './context-read-input.mjs';
import { canonicalJson, digest, projectionDigest, signedRecord, verifiedRecord } from './context-product-validation.mjs';
import { maintenanceQuantum } from './context-product-quantum.mjs';
import { ManifestHash } from './context-product-manifest.mjs';
import { fail } from './validation.mjs';
import { VECTOR_DDL } from './context-product-vectors.mjs';
import { verificationBatch, verificationMeter, verificationBound } from './context-product-verification-batch.mjs';
import { comparisonWorkFields } from './context-product-attribution.mjs';

export const PRODUCT_SIDECAR_FORMAT = 3;
export const PRODUCT_SIDECAR_SUFFIX = '.context-read-product-v1.1.sqlite';
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
  for (const suffix of ['-wal','-shm','-journal']) {
    const entry = productStat(path + suffix, true);
    if (!entry) continue;
    if (!writable && suffix === '-journal') { journal = entry; continue; }
    if (!writable || suffix !== '-journal') unavailable('storage_unavailable');
  }
  if (journal) {
    let main, directory;
    try { main = productStat(path); directory = sqliteFileStat(dirname(path)); } catch { unavailable('storage_unavailable'); }
    if (expectedIdentity && (String(main.dev) !== expectedIdentity.device || String(main.ino) !== expectedIdentity.inode)) unavailable('storage_unavailable');
    const uid = process.getuid?.();
    if (main.nlink !== 1n || journal.nlink !== 1n || !directory.isDirectory() || directory.isSymbolicLink() ||
        process.platform !== 'win32' && ((directory.mode & 0o777n) !== 0o700n ||
          uid === undefined || [main, journal, directory].some(entry => entry.uid !== BigInt(uid)))) unavailable('storage_unavailable');
    if (!contextReadDeleteJournal(path, observer, { main, directory, expectedIdentity })) unavailable('storage_unavailable');
    const current = productStat(path + '-journal', true);
    // A DELETE writer can commit and create its next protected journal while
    // the child runs. Recheck protection rather than requiring the old inode.
    if (current && !['mode','uid','nlink'].every(key => current[key] === journal[key])) unavailable('storage_unavailable');
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
    canonical.push({ memory: db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...boundary(ns))?.epoch ?? 1,
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
  now = () => performance.now(), rendezvous = () => {}, attribution, memoryComparison = null, comparisonOptions = {}, verificationBatching = false, verificationBatchState = verificationBatching ? new SharedArrayBuffer(8) : null }) {
  const canonical=canonicalDatabase;
  const canonicalRead=work=>attribution ? attribution.transaction(canonicalDatabase,work,readTransaction) : readTransaction(canonicalDatabase,work);
  features={...features,reviews:features.cards,receipts:features.cards};
  const sidePath = path + PRODUCT_SIDECAR_SUFFIX;
  const compare=memoryComparison?memoryComparison.createMemoryComparator():null;
  let comparisonBase=null;
  let sideFormat, side, sideWritable, sideFiles, sideMode, openedIdentity, closed = false, metadata, lifecycle, lockIdentity, observedMissing=false, guardDepth=0;
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
    if(!createLock && !productFile(sidePath,true)){
      // Linearize absence here; do not open a concurrently published cache
      // without first taking its lifecycle lock.
      observedMissing=true;try{return work();}finally{observedMissing=false;}
    }
    return cleaned(()=>{acquire(createLock);guardDepth++;return work();},()=>{guardDepth=0;release();});
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
    try { sideFiles?.({betweenSnapshots:sideMode==='DELETE' && !side.isTransaction});return readTransaction(side,()=>{
      side.prepare('PRAGMA schema_version').get();
      verifyOpened();rendezvous('snapshot');return work();
    }); } catch(e) {attribution?.captureFailure(e); if(e.reason==='storage_unavailable')try{close();}catch{}throw e; }
  }
  const openNative = (write = false) => {
    try { return observer ? observer.invoke('open','connection', () => new DatabaseSync(sidePath, { readOnly: !write }))
      : new DatabaseSync(sidePath, { readOnly: !write }); }
    catch (error) {attribution?.captureFailure(error); if(sqlite)sqlite.openingFailure(error);throw error; }
  };
  function close() { if (side?.isOpen) side.close(); side = null; metadata = null; sideFiles = null; }
  function write(work, kind='setup', beforeCommit) {
    sideFiles?.({betweenSnapshots:sideMode==='DELETE' && !side.isTransaction});
    const beginning=attribution?.start('begin');
    try {attribution?.checkpoint('begin');side.exec('BEGIN IMMEDIATE');}catch(error){attribution?.captureFailure(error);throw error;}finally{attribution?.end(beginning);}
    try {
      verifyOpened();const result=work();rendezvous('batch');beforeCommit?.();
      const committing=attribution?.start('commit');
      try {attribution?.checkpoint('commit');attribution?.add(kind+'CommitAttempts',1);side.exec('COMMIT');attribution?.add(kind+'Commits',1);}catch(error){attribution?.captureFailure(error);throw error;}finally{attribution?.end(committing);}
      return result;
    }
    catch (e) {attribution?.captureFailure(e);
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
  function connection(create = false) {
    if (closed) fail('store_closed');
    if(observedMissing && !create)return false;
    const physical = productFile(sidePath, true), wantsWrite=writable&&create;
    if (!physical && !create) return false;
    if (side && physical && same(physical, openedIdentity) && sideWritable===wantsWrite) {
      if(sqlite){
        try {
          sideFiles?.({betweenSnapshots:sideMode==='DELETE' && !side.isTransaction});
          if(wantsWrite && sideMode!==sidecarJournalMode)unavailable('storage_unavailable');
        } catch(error) {attribution?.captureFailure(error);try{close();}catch{}throw error;}
      } else auxiliaries(sidePath, wantsWrite, openedIdentity, observer);
      if (create) read(() => {
        sideFormat=side.prepare('PRAGMA user_version').get().user_version;
        metadata=side.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
        if (!metadata || metadata.store_id!==identity.storeId) unavailable('wrong_store');
        attest(side);
        if (metadata.profile!==PRODUCT_PROFILE) unavailable('incompatible');
      });
      return true;
    }
    close();
    if(!sqlite)auxiliaries(sidePath, wantsWrite, openedIdentity, observer);
    if (!physical) {
      if (!writable) unavailable('missing');
      // The child publishes the complete format before any connection opens it.
      // It owns the exclusive lifecycle lock, so release our shared lock first.
      release();
      cleaned(()=>{try { publish(null,initialization()); }
        catch(e) {attribution?.captureFailure(e); if(e.code!=='EEXIST')throw e; }},()=>acquire());
    } else if (!sqlite) {
      const mode = probeRollbackJournal(sidePath, observer ? { observe: observer.journalProbe } : {});
      if (mode.code === 14 || mode.mode && mode.mode !== 'delete') unavailable('incompatible');
    }
    const admittedIdentity=productFile(sidePath), files=sqlite?.files(sidePath);
    let candidate=openNative(wantsWrite), admittedMetadata;
    sideMode=undefined;sideFormat=undefined;
    try {
      if(sqlite){
        const native=candidate;candidate=null; // open() disposes a refused native handle.
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
    } catch(error) {attribution?.captureFailure(error);try{if(candidate?.isOpen)candidate.close();}catch{}throw error;}
    side=candidate;sideWritable=wantsWrite;sideFiles=files;openedIdentity=admittedIdentity;metadata=admittedMetadata;
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
  function invalid(p, reason) { return { dto: status(p,'unavailable',
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
        const text = side.prepare('SELECT record FROM validation_records WHERE publication=?').get(pointer.publication)?.record;
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
        return { dto:status(p,mismatch ? 'stale' : 'ready',mismatch,progressOf(g),r.counts), publication:r,byteSafe };
      });
    } catch (e) {attribution?.captureFailure(e);
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
    const support = { get isTransaction() { return canonical.isTransaction; }, prepare(sql) { const stmt = canonical.prepare(sql); return Object.fromEntries(['get','all'].map(method => [method,(...args) => {
      m.supportLookups++; const r = stmt[method](...args); m.supportBytes += Buffer.byteLength(JSON.stringify(r ?? null)); return r;
    }])); } };
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
    });
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
    while(quantum.admit('gc') && slices++<maximum) {
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
    if(quantum.admit('gc'))quantum.measure(()=>{
      try {side.exec('PRAGMA incremental_vacuum(32)');}
      catch(e) {if(e.code!=='ERR_SQLITE_ERROR' || (e.errcode&255)!==5)throw e;}
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
  function refresh(p,access,budget,quantum) {
    if (!writable) fail('invalid_input');
    const m = { transformed:0,canonicalRows:0,metadataBytes:0,textRows:0,textBytes:0,supportLookups:0,supportBytes:0,verifiedRows:0,
      reused:0,replaced:0,removed:0,copied:0,tokenized:0,retargets:0,verificationRestarts:0,verificationKept:0 };
    // Retain the identity whose validation failed. A different selection may
    // repair the cache before this maintainer reaches its own repair branch.
    const repairIdentity=productFile(sidePath,true),repairStamp=repairIdentity && stamp();
    try { connection(true); }
    catch(e) {attribution?.captureFailure(e);
      if (!['wrong_store','incompatible','corrupt'].includes(e.reason) && !(e.code==='ERR_SQLITE_ERROR' && [1,11,26].includes(e.errcode&255))) throw e;
      const oldFormat = sideFormat > 0 && sideFormat !== PRODUCT_SIDECAR_FORMAT; close();
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
        cleaned(()=>publish(old.device+':'+old.inode,{...initialization(),expectedStamp:repairStamp}),()=>acquire());
      } catch(e) {attribution?.captureFailure(e);
        if(['ESTALE','EEXIST','EBUSY'].includes(e.code))unavailable('storage_unavailable');
        throw e;
      }
      connection(true);
    }
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
      });
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
    while (quantum.admit('scan') && quantum.admit('item') && g.phase < g.streams.length && m.transformed<budget.maxItems) {
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
    const verificationAdmitted=()=>g.phase>=g.streams.length && g.verify.phase<3 && quantum.admit('verify-scan') && quantum.admit('verification') &&
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
              side.exec('ROLLBACK TO verification_chunk; RELEASE verification_chunk');
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
    if (g.phase>=g.streams.length && g.verify.phase===3 && quantum.admit('publication') && fresh(t,p,access)) {
      quantum.measure(()=>{
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
  function lexical(p, publication, query, limit=24) {
    if (!publication || !connection()) unavailable('missing');
    rendezvous('lexical');
    return read(() => {
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
    });
  }

  return {
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
    refresh:(p,access,budget)=>{
      const started=now();p=projection(p);
      const cutoff=Math.min(p.deadlineAt ?? Infinity,started+budget.maxMs);
      const quantum=maintenanceQuantum({now,cutoff,maxMs:budget.maxMs,attribution});
      if(verificationBatching)quantum.batchStart=started;
      return guarded(()=>refresh(p,access,budget,quantum),true);
    },
    compare:(p,access,budget,quantum)=>{
      if(!compare)return null;
      const started=now();p=projection(p);
      quantum??=maintenanceQuantum({now,cutoff:Math.min(p.deadlineAt??Infinity,started+budget.maxMs),maxMs:budget.maxMs,attribution});
      return guarded(()=>{let failed=false;try{connection(false);}catch{comparisonBase=null;failed=true;}
        return compareInputs(p,access,budget,quantum,failed);
      });
    },
    lexical:(p,...args)=>{p=projection(p);return guarded(()=>lexical(p,...args));},
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
  },close() { closed=true;comparisonBase=null;const lock=lifecycle;lifecycle=null;cleaned(()=>close(),()=>lock?.close()); },
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

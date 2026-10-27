import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createExclusiveSqliteFile, probeRollbackJournal, sqliteFileStat } from './sqlite-journal-probe.mjs';
import { readTransaction } from './database.mjs';
import { contextCardEligible } from './context-read-sidecar.mjs';
import { cardDependencyFence } from './card-current-storage.mjs';
import { termFrequencies, tokenizeT1, TOKENIZER_VERSION, REPRESENTATION_VERSION } from './context-read-tokenize.mjs';
import { scoreBM25, rankScores } from './context-read-bm25.mjs';
import { PRODUCT_PROFILE } from './context-product-control.mjs';
import { canonicalJson, digest, projectionDigest, signedRecord, verifiedRecord } from './context-product-validation.mjs';
import { ManifestHash } from './context-product-manifest.mjs';
import { fail } from './validation.mjs';

export const PRODUCT_SIDECAR_SUFFIX = '.context-read-product-v1.1.sqlite';
const APPLICATION_ID = 0x43525032;
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
const unavailable = reason => { throw Object.assign(Error('index_unavailable'), { code: 'index_unavailable', reason }); };
const same = (a,b) => canonicalJson(a) === canonicalJson(b);
const ddl = `
CREATE TABLE product_metadata(singleton INTEGER PRIMARY KEY CHECK(singleton=1),store_id TEXT NOT NULL,profile TEXT NOT NULL,incarnation TEXT NOT NULL,kind TEXT NOT NULL) STRICT;
CREATE TABLE generations(id TEXT PRIMARY KEY,projection TEXT NOT NULL,incarnation TEXT NOT NULL,sequence INTEGER NOT NULL,base_sequence INTEGER NOT NULL,checkpoint INTEGER NOT NULL,kind TEXT NOT NULL,fences TEXT NOT NULL,access TEXT NOT NULL,phase INTEGER NOT NULL,last_key TEXT NOT NULL,base_id TEXT,verify TEXT NOT NULL,manifest TEXT,published INTEGER NOT NULL,seed TEXT NOT NULL) STRICT;
CREATE TABLE publications(projection TEXT PRIMARY KEY,generation TEXT NOT NULL,publication TEXT NOT NULL) STRICT;
CREATE TABLE work(projection TEXT PRIMARY KEY,generation TEXT NOT NULL) STRICT;
CREATE TABLE validation_records(publication TEXT PRIMARY KEY,record TEXT NOT NULL) STRICT;
CREATE TABLE progress_records(generation TEXT PRIMARY KEY,record TEXT NOT NULL) STRICT;
CREATE TABLE documents(generation TEXT NOT NULL,stream INTEGER NOT NULL,id TEXT NOT NULL,identity TEXT NOT NULL,revision INTEGER NOT NULL,body_revision INTEGER NOT NULL,eligible INTEGER NOT NULL CHECK(eligible IN(0,1)),representation TEXT NOT NULL,token_length INTEGER NOT NULL CHECK(token_length>=0),PRIMARY KEY(generation,stream,id),UNIQUE(generation,identity)) STRICT;
CREATE TABLE postings(generation TEXT NOT NULL,stream INTEGER NOT NULL,id TEXT NOT NULL,identity TEXT NOT NULL,term TEXT NOT NULL,frequency INTEGER NOT NULL CHECK(frequency>0),PRIMARY KEY(generation,identity,term),FOREIGN KEY(generation,stream,id) REFERENCES documents(generation,stream,id)) STRICT;
CREATE INDEX product_term ON postings(generation,term,identity);
CREATE TABLE statistics(generation TEXT NOT NULL,term TEXT NOT NULL,df INTEGER NOT NULL,n INTEGER NOT NULL,total_length INTEGER NOT NULL,PRIMARY KEY(generation,term)) STRICT;
`;
// Compare constant-size physical metadata, including actual index definitions.
// Never infer a format from user_version alone, or scan a content table here.
function schema(db) {
  return db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
}
const expectedSchema = ddl.trim().split(';').filter(sql => sql.trim()).map(sql => {
  sql=sql.trim(); const match=/^CREATE (TABLE|INDEX) (\w+)/.exec(sql);
  return {type:match[1].toLowerCase(),name:match[2],tbl_name:match[1]==='TABLE'?match[2]:/ ON (\w+)/.exec(sql)[1],sql};
}).sort((a,b) => Buffer.compare(Buffer.from(a.type),Buffer.from(b.type)) || Buffer.compare(Buffer.from(a.name),Buffer.from(b.name)));
function attest(db) {
  if (db.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
      db.prepare('PRAGMA user_version').get().user_version !== 1 || !same(schema(db), expectedSchema)) unavailable('incompatible');
}
export function productFile(path, optional = false) {
  let s;
  try { s = sqliteFileStat(path); } catch (e) { if (optional && e.code === 'ENOENT') return null; unavailable('storage_unavailable'); }
  if (!s.isFile() || s.isSymbolicLink() || (s.mode & 0o777n) !== 0o600n) unavailable('storage_unavailable');
  return { device: String(s.dev), inode: String(s.ino) };
}
function auxiliaries(path, writable) {
  for (const suffix of ['-wal','-shm','-journal']) {
    if (productFile(path + suffix, true) && (!writable || suffix !== '-journal')) unavailable('storage_unavailable');
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
export function productSidecar({ path, db: canonical, identity, features, observer, writable = false,
  now = () => performance.now(), rendezvous = () => {} }) {
  features={...features,reviews:features.cards,receipts:features.cards};
  const sidePath = path + PRODUCT_SIDECAR_SUFFIX;
  let side, sideWritable, openedIdentity, closed = false, metadata;
  const openNative = (write = false) => observer ? observer.invoke('open','connection', () => new DatabaseSync(sidePath, { readOnly: !write }))
    : new DatabaseSync(sidePath, { readOnly: !write });
  function close() { if (side?.isOpen) side.close(); side = null; metadata = null; }
  function write(work) {
    side.exec('BEGIN IMMEDIATE');
    try { const result = work(); side.exec('COMMIT'); return result; }
    catch (e) { if (side.isTransaction) side.exec('ROLLBACK'); throw e; }
  }
  function connection(create = false) {
    if (closed) fail('store_closed');
    const physical = productFile(sidePath, true), wantsWrite=writable&&create;
    if (!physical && !create) return false;
    if (side && physical && same(physical, openedIdentity) && sideWritable===wantsWrite) {
      auxiliaries(sidePath, wantsWrite);
      if (create) {
        metadata=side.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
        if (!metadata || metadata.store_id!==identity.storeId) unavailable('wrong_store');
        attest(side);
        if (metadata.profile!==PRODUCT_PROFILE) unavailable('incompatible');
      }
      return true;
    }
    close();
    auxiliaries(sidePath, wantsWrite);
    if (!physical) {
      if (!writable) unavailable('missing');
      createExclusiveSqliteFile(sidePath);
    } else {
      const mode = probeRollbackJournal(sidePath, observer ? { observe: observer.journalProbe } : {});
      if (mode.code === 14 || mode.mode && mode.mode !== 'delete') unavailable('incompatible');
    }
    openedIdentity = productFile(sidePath);
    side = openNative(wantsWrite);sideWritable=wantsWrite; if (observer) side = observer.database(side);
    side.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0;');
    if (!same(openedIdentity, productFile(sidePath))) unavailable('storage_unavailable');
    if (!physical) write(() => {
      side.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1; ${ddl}`);
      side.prepare('INSERT INTO product_metadata VALUES(1,?,?,?,?)').run(identity.storeId, PRODUCT_PROFILE, randomUUID(), 'initial');
    });
    metadata = side.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
    if (!metadata || metadata.store_id !== identity.storeId) unavailable('wrong_store');
    attest(side);
    if (metadata.profile !== PRODUCT_PROFILE) unavailable('incompatible');
    if (wantsWrite) {
      if (side.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || side.prepare('PRAGMA foreign_key_check').get()) unavailable('corrupt');
    }
    return true;
  }
  const sideIdentity = () => ({ ...productFile(sidePath), incarnation: metadata.incarnation,
    schemaVersion: side.prepare('PRAGMA schema_version').get().schema_version });
  function target(p, access) {
    if(canonical.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id!==identity.storeId)unavailable('wrong_store');
    return { projectionDigest: projectionDigest(p), accessDigest: access, ...canonicalProductFences(canonical,p),
      canonical: canonicalProductIdentity(path,canonical), sidecar: sideIdentity() };
  }
  function recordBindings(r, t, progress = false) {
    if (r.storeId !== identity.storeId) return 'wrong_store';
    if (r.projectionDigest !== t.projectionDigest) return 'validation_invalid';
    if (progress ? r.canonicalIdentityDigest !== digest(t.canonical) || r.sidecarIdentityDigest !== digest(t.sidecar)
      : !same(r.canonical,t.canonical) || !same(r.sidecar,t.sidecar) || r.tokenizer !== TOKENIZER_VERSION || r.representation !== REPRESENTATION_VERSION) return 'validation_invalid';
    if (r.accessDigest !== t.accessDigest) return 'access_changed';
    if (r.dependencyFenceDigest !== t.dependencyFenceDigest) return 'dependency_changed';
    if (r.canonicalFenceDigest !== t.canonicalFenceDigest) return 'fence_changed';
    return null;
  }
  function status(p, state, reason, progress = null, counts = null) {
    const ready = state === 'ready';
    return { profile: PRODUCT_PROFILE, lexical: { state,reason,progress }, semantic: { state:'disabled',reason:'not_enabled' },
      coverage: { status: ready ? p.ownerCoverage.omittedNamespaces ? 'partial' : 'complete' : 'unavailable',
        freshness: ready ? 'current' : ['stale','catching_up'].includes(state) ? 'stale' : 'unverified',
        byType: Object.fromEntries(['memory','card'].filter(t => p.types.includes(t)).map(t => [t,
          { eligible: ready ? counts.byType[t].eligible : null, indexed: ready ? counts.byType[t].indexed : null, embedded:null }])),
        namespaces: p.ownerCoverage } };
  }
  function invalid(p, reason) { return { dto: status(p,'unavailable',reason), publication:null }; }
  // Caller supplies the canonical transaction. Pointer, generation and record
  // are read under one independent sidecar transaction, with no deep scans.
  function observe(p, access, {forWrite=false,knownFailure=null}={}) {
    if(knownFailure)return invalid(p,knownFailure);
    try {
      if (!connection(forWrite)) return { dto:status(p,'absent','missing'), publication:null };
      return readTransaction(side, () => {
        metadata = side.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
        if (!metadata || metadata.store_id !== identity.storeId) return invalid(p,'wrong_store');
        attest(side);
        if (metadata.profile !== PRODUCT_PROFILE) return invalid(p,'incompatible');
        const t = target(p,access), pointer = side.prepare('SELECT * FROM publications WHERE projection=?').get(t.projectionDigest);
        const work = side.prepare('SELECT * FROM work WHERE projection=?').get(t.projectionDigest);
        let checkpoint;
        if (work) {
          const g = side.prepare('SELECT * FROM generations WHERE id=?').get(work.generation);
          const text = side.prepare('SELECT record FROM progress_records WHERE generation=?').get(work.generation)?.record;
          if (!g || !text) return invalid(p,'validation_missing');
          const r = verifiedRecord(identity.cursorSecret,'progress',text);
          if (g.id!==generationId(g) || g.incarnation!==incarnationOf(g) || !same(r.generation,{ id:g.id,incarnation:g.incarnation }) || !same(r.progress,progressOf(g)) ||
              r.kind !== g.kind || r.projectionDigest !== g.projection || r.accessDigest !== g.access ||
              !same(JSON.parse(g.fences), { canonicalFenceDigest:r.canonicalFenceDigest,dependencyFenceDigest:r.dependencyFenceDigest })) return invalid(p,'validation_invalid');
          const mismatch = recordBindings(r,t,true);
          if (!mismatch) return { dto:status(p,g.base_sequence ? 'catching_up' : 'building',g.base_sequence ? 'resume_pending' : g.kind === 'rebuild' ? 'rebuild' : 'initial_build',r.progress), publication:null };
          if (!['access_changed','dependency_changed','fence_changed'].includes(mismatch)) return invalid(p,mismatch);
          checkpoint = { mismatch };
        }
        if (!pointer) return checkpoint ? { dto:status(p,'stale',checkpoint.mismatch),publication:null } : { dto:status(p,'absent','missing'),publication:null };
        const g = side.prepare('SELECT * FROM generations WHERE id=?').get(pointer.generation);
        const text = side.prepare('SELECT record FROM validation_records WHERE publication=?').get(pointer.publication)?.record;
        if (!g || !text) return invalid(p,'validation_missing');
        const r = verifiedRecord(identity.cursorSecret,'validation',text);
        const expectedTypes = ['memory','card'].filter(type => p.types.includes(type));
        if (g.id !== generationId(g) || g.incarnation !== incarnationOf(g) || g.phase !== streams(p).length+3 || !g.published || r.publicationId !== pointer.publication || !same(r.generation, { id:g.id,sequence:g.sequence,checkpoint:g.checkpoint,incarnation:g.incarnation }) ||
            g.projection !== r.projectionDigest || g.access !== r.accessDigest || g.manifest !== r.manifestDigest ||
            !same(JSON.parse(g.fences),{ canonicalFenceDigest:r.canonicalFenceDigest,dependencyFenceDigest:r.dependencyFenceDigest }) ||
            !same(r.counts,JSON.parse(g.verify).counts) || !same(Object.keys(r.counts.byType).sort(),expectedTypes.sort())) return invalid(p,'validation_invalid');
        const mismatch = recordBindings(r,t);
        if (mismatch && !['access_changed','dependency_changed','fence_changed'].includes(mismatch)) return invalid(p,mismatch);
        return { dto:status(p,mismatch ? 'stale' : 'ready',mismatch,progressOf(g),r.counts), publication:r };
      });
    } catch (e) {
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
    g.incarnation=incarnationOf(g);
    const record = signedRecord(identity.cursorSecret,'progress',{ version:'context-index-progress-v1',profile:PRODUCT_PROFILE,storeId:identity.storeId,
      canonicalIdentityDigest:digest(t.canonical),sidecarIdentityDigest:digest(t.sidecar),projectionDigest:g.projection,accessDigest:g.access,
      ...JSON.parse(g.fences),generation:{ id:g.id,incarnation:g.incarnation },kind:g.kind,progress:progressOf(g) });
    if (Buffer.byteLength(record)>4096) fail('context_item_too_large');
    side.prepare('INSERT OR REPLACE INTO progress_records VALUES(?,?)').run(g.id,record);
    side.prepare('UPDATE generations SET incarnation=?,phase=?,last_key=?,checkpoint=?,verify=? WHERE id=?').run(g.incarnation,g.phase,g.last_key,g.checkpoint,JSON.stringify(g.verify),g.id);
    side.prepare('INSERT OR REPLACE INTO work VALUES(?,?)').run(g.projection,g.id);
  }
  function fresh(t,p,access) {
    return same(t,readTransaction(canonical,() => target(p,access)));
  }
  function metadataRows(s, after, maximum, p, m) {
    const rows = canonical.prepare(s.type === 'memory'
      ? `SELECT id,revision,0 AS body_revision,deleted,currentness,review_state FROM memories INDEXED BY index_memory_keyset WHERE ${where} AND id>? ORDER BY id LIMIT ?`
      : `SELECT id,revision,coalesce(body_revision,0) AS body_revision,state FROM private_cards INDEXED BY private_card_scope WHERE ${where} AND state=? AND id>? ORDER BY id LIMIT ?`)
      .all(...boundary(s.ns),...(s.type === 'card' ? [s.state] : []),after,maximum);
    m.canonicalRows += rows.length; m.metadataBytes += Buffer.byteLength(JSON.stringify(rows));
    // Count and meter support independently of transformation attempts.
    const support = { prepare(sql) { const stmt = canonical.prepare(sql); return Object.fromEntries(['get','all'].map(method => [method,(...args) => {
      m.supportLookups++; const r = stmt[method](...args); m.supportBytes += Buffer.byteLength(JSON.stringify(r ?? null)); return r;
    }])); } };
    return rows.map(row => ({ id:row.id,revision:row.revision,body_revision:row.body_revision,
      eligible:Number(s.type === 'memory' ? !row.deleted && (p.intent === 'history' || row.currentness === 'current' && row.review_state !== 'awaiting')
        : contextCardEligible(support,identity,features,s.ns,row,p.intent,{ readSet:p.readSet })) }));
  }
  function put(g,stream,row,tokens,source) {
    const s = g.streams[stream], key = JSON.stringify([...boundary(s.ns),s.type,row.id]);
    side.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?,?)').run(g.id,stream,row.id,key,row.revision,row.body_revision,row.eligible,REPRESENTATION_VERSION,tokens.length);
    const terms = source ? side.prepare('SELECT term,frequency FROM postings WHERE generation=? AND identity=? ORDER BY term').all(source,key)
      : [...tokens.frequencies].map(([term,frequency]) => ({ term,frequency }));
    for (const {term,frequency} of terms) {
      side.prepare('INSERT INTO postings VALUES(?,?,?,?,?,?)').run(g.id,stream,row.id,key,term,frequency);
      side.prepare('INSERT INTO statistics VALUES(?,?,1,0,0) ON CONFLICT(generation,term) DO UPDATE SET df=df+1').run(g.id,term);
    }
    side.prepare("UPDATE statistics SET n=n+?,total_length=total_length+? WHERE generation=? AND term=''").run(row.eligible,tokens.length,g.id);
  }
  function verifyPage(g, p, m) {
    const v = g.verify, hash = new ManifestHash(v.hash), phase = v.phase, last = v.last;
    let rows;
    if (phase === 0) rows = side.prepare('SELECT * FROM documents WHERE generation=? AND identity>? ORDER BY identity LIMIT 128').all(g.id,last[0] ?? '');
    else if (phase === 1) rows = side.prepare('SELECT * FROM postings WHERE generation=? AND (identity,term)>(?,?) ORDER BY identity,term LIMIT 128').all(g.id,last[0] ?? '',last[1] ?? '');
    else rows = side.prepare('SELECT * FROM statistics WHERE generation=? AND term>=? ORDER BY term LIMIT 128 OFFSET ?').all(g.id,last[0] ?? '',last.length ? 1 : 0);
    for (const r of rows) {
      let tuple;
      if (phase === 0) {
        const sum = side.prepare('SELECT coalesce(sum(frequency),0) AS n FROM postings WHERE generation=? AND identity=?').get(g.id,r.identity).n;
        if (sum !== r.token_length || !r.eligible && sum || r.representation !== REPRESENTATION_VERSION) unavailable('corrupt');
        tuple = ['document',JSON.parse(r.identity),r.revision,r.body_revision,r.eligible,r.representation,r.token_length];
        v.counts.documents++; v.counts.totalTokenLength += r.token_length;
        const type = g.streams[r.stream].type; v.counts.byType[type].eligible += r.eligible; v.counts.byType[type].indexed += r.eligible;
        v.last = [r.identity];
      } else if (phase === 1) {
        if (!r.term || !side.prepare('SELECT 1 FROM documents WHERE generation=? AND stream=? AND id=? AND eligible=1').get(g.id,r.stream,r.id) ||
            !side.prepare('SELECT 1 FROM statistics WHERE generation=? AND term=?').get(g.id,r.term)) unavailable('corrupt');
        tuple = ['posting',JSON.parse(r.identity),r.term,r.frequency]; v.last = [r.identity,r.term];
      } else {
        const n = Object.values(v.counts.byType).reduce((sum,c) => sum + c.eligible,0);
        if (r.term === '' ? r.n !== n || r.total_length !== v.counts.totalTokenLength || r.df !== 0
          : r.df !== side.prepare('SELECT count(*) AS n FROM postings WHERE generation=? AND term=?').get(g.id,r.term).n || r.n !== 0 || r.total_length !== 0) unavailable('corrupt');
        tuple = ['statistics',r.term,r.df,r.n,r.total_length]; if (r.term) v.counts.terms++; v.last = [r.term];
      }
      hash.update(JSON.stringify(tuple)+'\n'); m.verifiedRows++;
    }
    v.hash = hash.state();
    if (rows.length < 128) { v.phase++; v.last=[]; }
    g.phase = g.streams.length + v.phase;
  }
  function refresh(p,access,budget) {
    if (!writable) fail('invalid_input');
    const started = now(), m = { transformed:0,canonicalRows:0,metadataBytes:0,textRows:0,textBytes:0,supportLookups:0,supportBytes:0,verifiedRows:0 };
    try { connection(true); }
    catch(e) {
      if (!['wrong_store','incompatible','corrupt'].includes(e.reason) && !(e.code==='ERR_SQLITE_ERROR' && [1,11,26].includes(e.errcode&255))) throw e;
      close();
      // Repair is explicit maintenance, never a read fallback. Refuse live or
      // unsafe companions; SQLite alone performs journal recovery on opening.
      auxiliaries(sidePath,false);
      const old=productFile(sidePath);
      createExclusiveSqliteFile(sidePath,old.device+':'+old.inode);
      // A newly created empty file is initialized through the same exclusive
      // path as a first build, with a fixed rebuild kind.
      openedIdentity=productFile(sidePath);side=openNative(true);sideWritable=true;if(observer)side=observer.database(side);
      side.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=0;');
      write(()=>{side.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=1; ${ddl}`);
        side.prepare('INSERT INTO product_metadata VALUES(1,?,?,?,?)').run(identity.storeId,PRODUCT_PROFILE,randomUUID(),'rebuild');});
      metadata=side.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
    }
    let t = readTransaction(canonical,() => target(p,access));
    const observed = readTransaction(canonical,() => observe(p,access,{forWrite:true}));
    if (observed.dto.lexical.state === 'ready') { rendezvous('noop'); return m; }
    const w = side.prepare('SELECT generation FROM work WHERE projection=?').get(t.projectionDigest);
    let g = w && side.prepare('SELECT * FROM generations WHERE id=?').get(w.generation);
    if (!g || g.access !== access || !same(JSON.parse(g.fences), { canonicalFenceDigest:t.canonicalFenceDigest,dependencyFenceDigest:t.dependencyFenceDigest }) || observed.dto.lexical.state === 'unavailable') {
      const pointer = side.prepare('SELECT generation FROM publications WHERE projection=?').get(t.projectionDigest);
      const base = observed.dto.lexical.state !== 'unavailable' && pointer && side.prepare('SELECT * FROM generations WHERE id=?').get(pointer.generation);
      const baseSequence = base?.sequence ?? 0;
      g = { id:null,incarnation:null,seed:randomUUID(),projection:t.projectionDigest,sequence:Math.max(baseSequence,g?.sequence ?? 0)+1,
        base_sequence:baseSequence,checkpoint:0,kind:baseSequence ? 'delta' : pointer || w ? 'rebuild' : metadata.kind,
        fences:canonicalJson({ canonicalFenceDigest:t.canonicalFenceDigest,dependencyFenceDigest:t.dependencyFenceDigest }),access,
        phase:0,last_key:'',base_id:base?.id ?? null,verify:{ phase:0,last:[],hash:new ManifestHash().state(),
          counts:{ byType:Object.fromEntries(['memory','card'].filter(t => p.types.includes(t)).map(t => [t,{eligible:0,indexed:0}])),documents:0,terms:0,totalTokenLength:0 } } };
      g.id=generationId(g);g.incarnation=incarnationOf(g);
      write(() => {
        side.prepare('INSERT INTO generations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?)').run(g.id,g.projection,g.incarnation,g.sequence,g.base_sequence,0,g.kind,g.fences,g.access,0,'',g.base_id,JSON.stringify(g.verify),null,g.seed);
        side.prepare("INSERT INTO statistics VALUES(?,'',0,0,0)").run(g.id); save(g,t);
      });
    } else g.verify = JSON.parse(g.verify);
    g.streams = streams(p);
    const until = started + budget.maxMs;
    while (now()<until && g.phase < g.streams.length && m.transformed<budget.maxItems) {
      if (!fresh(t,p,access)) return m;
      const stream = g.streams[g.phase], maximum = stream.type === 'card' ? 1 : 128;
      const rows = readTransaction(canonical,() => metadataRows(stream,g.last_key,maximum,p,m));
      let units=0, pending=[], last=g.last_key;
      for (const row of rows) {
        if (now()>=until || m.transformed>=budget.maxItems) break;
        const old = g.base_id && side.prepare('SELECT * FROM documents WHERE generation=? AND stream=? AND id=?').get(g.base_id,g.phase,row.id);
        let tokens, source;
        if (old && old.revision===row.revision && old.body_revision===row.body_revision && old.eligible===row.eligible) {
          tokens={ length:old.token_length }; source=g.base_id;
        } else {
          m.transformed++;
          const text = row.eligible ? readTransaction(canonical,() => canonical.prepare(stream.type==='memory'
            ? `SELECT content AS text FROM memories WHERE ${where} AND id=?` : `SELECT title||char(10)||body AS text FROM private_cards WHERE ${where} AND id=?`).get(...boundary(stream.ns),row.id)?.text) : '';
          if (typeof text !== 'string' || text.length>2000000) fail('context_item_too_large');
          if (pending.length && units+text.length>2000000) { m.transformed--; break; }
          units+=text.length; m.textRows+=Number(Boolean(row.eligible)); m.textBytes+=Buffer.byteLength(text); tokens=termFrequencies(text);
        }
        pending.push({row,tokens,source}); last=row.id;
      }
      const completed = pending.length===rows.length && rows.length<maximum;
      if (!fresh(t,p,access)) return m;
      write(() => {
        for (const item of pending) put(g,g.phase,item.row,item.tokens,item.source);
        g.last_key=last; if (completed) {g.phase++;g.last_key='';} g.checkpoint++; save(g,t);
      });
      rendezvous('checkpoint');
    }
    while (g.phase>=g.streams.length && g.verify.phase<3 && now()<until) {
      if (!fresh(t,p,access)) return m;
      write(() => { verifyPage(g,p,m); g.checkpoint++; save(g,t); });
      rendezvous('verification');
    }
    if (g.verify.phase===3 && now()<until && fresh(t,p,access)) {
      if(!side.prepare("SELECT 1 FROM statistics WHERE generation=? AND term=''").get(g.id))unavailable('corrupt');
      const publicationId=randomUUID(), manifestDigest=new ManifestHash(g.verify.hash).digest();
      // Last pre-commit canonical snapshot ends here. The independent writer
      // may commit after this check; the certificate still attests captured E.
      rendezvous('precommit');
      write(() => {
        g.checkpoint++;
        const body={ version:'context-index-validation-v1',profile:PRODUCT_PROFILE,format:1,storeId:identity.storeId,
          canonical:t.canonical,sidecar:t.sidecar,projectionDigest:g.projection,accessDigest:access,...JSON.parse(g.fences),
          tokenizer:TOKENIZER_VERSION,representation:REPRESENTATION_VERSION,
          generation:{id:g.id,sequence:g.sequence,checkpoint:g.checkpoint,incarnation:g.incarnation},publicationId,manifestDigest,counts:g.verify.counts };
        const record=signedRecord(identity.cursorSecret,'validation',body);
        if (Buffer.byteLength(record)>16384) fail('context_item_too_large');
        verifiedRecord(identity.cursorSecret,'validation',record);
        side.prepare('UPDATE generations SET published=1,checkpoint=?,manifest=? WHERE id=?').run(g.checkpoint,manifestDigest,g.id);
        side.prepare('INSERT INTO validation_records VALUES(?,?)').run(publicationId,record);
        side.prepare('INSERT OR REPLACE INTO publications VALUES(?,?,?)').run(g.projection,g.id,publicationId);
        side.prepare('DELETE FROM work WHERE projection=?').run(g.projection);
      });
      rendezvous('published');
    }
    return m;
  }
  function lexical(p, publication, query, limit=24) {
    if (!publication || !connection()) unavailable('missing');
    return readTransaction(side,() => {
      const terms=[...new Set(tokenizeT1(query))], total=publication.counts, df=new Map(), ranked=[];
      if(!terms.length)return {rows:[],matched:0};
      const placeholders=terms.map(()=>'?').join(','),generation=publication.generation.id,ss=streams(p);
      const N=Object.values(total.byType).reduce((n,c)=>n+c.eligible,0);
      for(const term of terms)df.set(term,side.prepare('SELECT df FROM statistics WHERE generation=? AND term=?').get(generation,term)?.df??0);
      let after='',matched=0;
      while(true){
        if(now()>=(p.deadlineAt??Infinity))fail('read_timeout');
        // Stream matching identities from the generation/identity/term primary
        // key. Retain at most one 128-row page and the winning 24 identities.
        const rows=side.prepare(`SELECT p.identity,p.stream,p.id,d.revision,d.body_revision,d.token_length FROM postings p
          JOIN documents d ON d.generation=p.generation AND d.stream=p.stream AND d.id=p.id
          WHERE p.generation=? AND p.identity>? AND p.term IN (${placeholders}) AND d.eligible=1
          GROUP BY p.identity ORDER BY p.identity LIMIT 128`).all(generation,after,...terms);
        for(const row of rows){
          const frequencies=new Map(side.prepare(`SELECT term,frequency FROM postings WHERE generation=? AND identity=? AND term IN (${placeholders})`).all(generation,row.identity,...terms).map(r=>[r.term,r.frequency]));
          const score=scoreBM25(terms,{frequencies,length:row.token_length},{N,totalLength:total.totalTokenLength,df});
          ranked.push({score,ref:{type:ss[row.stream].type,namespace:ss[row.stream].ns,
            [ss[row.stream].type==='memory'?'memoryId':'cardId']:row.id,revision:row.revision,...(ss[row.stream].type==='card'?{bodyRevision:row.body_revision}:{})}});
          rankScores(ranked);if(ranked.length>limit)ranked.pop();matched++;
        }
        if(rows.length<128)break;after=rows.at(-1).identity;
      }
      return {rows:ranked,matched};
    });
  }

  return { observe,refresh,lexical,prepareObservation() {
    try { connection(false);return null; }
    catch(e) {
      // Carry the observed failure into this operation's final observation;
      // never retry a failed native opening/statement behind the status DTO.
      if(e.code==='index_unavailable')return e.reason;
      if(e.code==='ERR_SQLITE_ERROR' && ![5,6].includes(e.errcode&255))
        return [11,26].includes(e.errcode&255)?'corrupt':(e.errcode&255)===1?'incompatible':'storage_unavailable';
      throw e;
    }
  },close() { closed=true;close(); },
    // Explicit restore gate; callers must have already drained all clients.
    reset() {
      if (!writable) fail('invalid_input');
      if (!connection(true)) return;
      write(() => {
        side.exec('DELETE FROM publications; DELETE FROM work; DELETE FROM validation_records; DELETE FROM progress_records; DELETE FROM postings; DELETE FROM documents; DELETE FROM statistics; DELETE FROM generations;');
        side.prepare('UPDATE product_metadata SET incarnation=?,kind=? WHERE singleton=1').run(randomUUID(),'rebuild');
      });
      metadata = side.prepare('SELECT * FROM product_metadata WHERE singleton=1').get();
    } };
}

import { AsyncLocalStorage } from 'node:async_hooks';
import { assertContentPort, inertContentPortValue, hasContentPortBoundary } from './content-safety-boundary.mjs';
import { isBudgetEmbeddingPort } from './context-read-budget.mjs';
import { withContentSuppressionReadInside, contentSuppressionReasonInside, inContentSuppressionRequestInside } from './content-suppression-storage.mjs';
import { contentSuppressionFenceInside, contentSuppressionRequestFenceInside, cachedContentSuppressionRequestInside } from './content-suppression-storage.mjs';
import { bindContentSafetyConnection, checkInstalledContentSafety, cachedContentLayout, installedContentLayout } from './content-safety-schema.mjs';
import { contentReadSafety, memoryReadEligible, createContentReadMemo } from './content-safety.mjs';
import { createCardCurrentStorage, cardDependencyFence } from './card-current-storage.mjs';
import { lstatSync, unlinkSync } from 'node:fs';
import { probeRollbackJournal, createExclusiveSqliteFile, protectedDeleteJournal, sameJournal } from './sqlite-journal-probe.mjs';
import { isAbsolute, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';
import { readTransaction, isConnectionDiscarded } from './database.mjs';
import { cardNamespace } from './private-card-input.mjs';
import { cardApplicabilityInside } from './private-evidence-schema.mjs';
import { fail } from './validation.mjs';
import { rankScores, scoreBM25 } from './context-read-bm25.mjs';
import { REPRESENTATION_VERSION, TOKENIZER_VERSION, termFrequencies, tokenizeT1 } from './context-read-tokenize.mjs';
import { cosine, encodeVector, loadVector, semanticCapacity, validateEmbedder } from './context-read-embedder.mjs';

export const SIDECAR_FORMAT = 1;
const APPLICATION_ID = 0x43525831;
// Keep AsyncResource private: exposing a bound callback's .asyncResource
// would let a caller execute arbitrary work in the engine's request context.
function engineGuard(work) {
  const bound = AsyncLocalStorage.bind(work);
  return function beforeDispatch(...args) { return Reflect.apply(bound,undefined,args); };
}
const throwIfAborted=AbortSignal.prototype.throwIfAborted;
const checkSignal=signal=>{if(signal)assertContentPort({invoke:()=>{try{Reflect.apply(throwIfAborted,signal,[]);}catch(error){if(!hasContentPortBoundary())throw error;fail('timeout');}}});};
const where = 'owner_id=? AND scope=? AND project_id=?';
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const unavailable = reason => { const error = Object.assign(new Error('index_unavailable'), { code: 'index_unavailable', reason }); throw error; };
function stat(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === 'ENOENT') return null;
    unavailable('unsafe_file');
  }
}
function protectedFile(path, required = true, value = stat(path)) {
  if (!value && !required) return null;
  if (!value || !value.isFile() || value.isSymbolicLink() || process.platform !== 'win32' && (value.mode & 0o777) !== 0o600)
    unavailable('unsafe_file');
  return value;
}
function walHeader(path, observer) {
  protectedFile(path);
  let result;
  try { result = probeRollbackJournal(path, observer ? { observe: observer.journalProbe } : {}); }
  catch (error) { if (observer && error?.code === 'ERR_SQLITE_ERROR') throw error; unavailable('unsafe_file'); }
  if (result.stage === 'open') unavailable('unsafe_file');
  // nolock SQLite refuses WAL with CANTOPEN before it can create companions.
  // Other malformed/inaccessible files fail closed through ordinary validation.
  if ([8, 11, 26].includes(result.code)) return false; // Normal recovery/corruption path.
  if (result.code && result.code !== 14) unavailable('unsafe_file');
  return result.code === 14 || result.mode !== 'delete';
}

// A recovery refusal does not distinguish DELETE from WAL. Read the fixed
// header in a child with no SQLite connection, so its raw descriptor close
// cannot release this process's SQLite locks.
export function contextReadDeleteJournal(path, observer, validated) {
  try {
    const before = lstatSync(path, { bigint: true }), directory = lstatSync(dirname(path), { bigint: true });
    const fields = ['dev','ino','mode','uid','gid','nlink'];
    const matches = (actual, expected) => fields.every(key =>
      (typeof expected[key] === 'bigint' || Number.isSafeInteger(expected[key])) && actual[key] === BigInt(expected[key]));
    const baseline = validated ?? { main: before, directory };
    // Retain the caller's protection/identity proof rather than resetting it.
    if (!matches(before, baseline.main) || !matches(directory, baseline.directory) ||
        baseline.expectedIdentity && (String(before.dev) !== baseline.expectedIdentity.device ||
          String(before.ino) !== baseline.expectedIdentity.inode)) return false;
    const timeout = Math.min(5000, Math.floor(observer?.journalRemainingMs?.() ?? 5000));
    if (!(timeout >= 1)) fail('read_timeout');
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { openSync, readSync, closeSync, fstatSync, constants } from 'node:fs';
      let fd;
      try {
        fd = openSync(process.argv[1], constants.O_RDONLY | constants.O_NOFOLLOW);
        const opened = fstatSync(fd, { bigint: true });
        const header = Buffer.alloc(20), length = readSync(fd, header, 0, 20, 0);
        process.stdout.write(JSON.stringify({ device: String(opened.dev), inode: String(opened.ino),
          mode: length === 20 && header.subarray(0,16).equals(Buffer.from('SQLite format 3\\0')) &&
          header[18] === 1 && header[19] === 1 ? 'delete' : 'other' }));
      } finally { if (fd !== undefined) closeSync(fd); }
    `, path], { encoding: 'utf8', env: {}, timeout, maxBuffer: 1024 });
    if (child.error?.code === 'ETIMEDOUT') fail('read_timeout');
    if (child.error || child.status !== 0) return false;
    const opened = JSON.parse(child.stdout);
    const after = lstatSync(path, { bigint: true }), currentDirectory = lstatSync(dirname(path), { bigint: true });
    // A writer may commit while the child starts. Content timestamps can
    // change; replacement or protection changes must retain the refusal.
    return opened.mode === 'delete' && opened.device === String(before.dev) && opened.inode === String(before.ino) &&
      matches(after, baseline.main) && matches(currentDirectory, baseline.directory);
  } catch (error) { if (error?.code === 'read_timeout') throw error; return false; }
}

function auxiliaries(path, readOnly, observer) {
  let journal;
  const companions = {};
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const entry = protectedFile(path + suffix, false);
    companions[suffix] = entry;
    if (entry && readOnly && suffix === '-journal') { journal = entry; continue; }
    if (entry && (readOnly || suffix !== '-journal')) unavailable('auxiliary_file');
  }
  if (journal) {
    // Refuse the operation; only a protected DELETE journal is contention.
    // The isolated header check cannot recover or admit a read through it.
    let main, directory;
    try { main = protectedFile(path); directory = stat(dirname(path)); } catch { unavailable('auxiliary_file'); }
    const proof = { main, directory, journal };
    if (!protectedDeleteJournal({ ...proof, wal: companions['-wal'], shm: companions['-shm'] })) unavailable('auxiliary_file');
    if (!contextReadDeleteJournal(path, observer, { main, directory })) unavailable('auxiliary_file');
    const current = stat(path + '-journal');
    // Preserve protection failures from the same post-child metadata sample.
    if (current) protectedFile(path + '-journal', false, current);
    if (current && !sameJournal(current, journal)) {
      let checked;
      try { checked = { main: stat(path), directory: stat(dirname(path)), journal: current,
        wal: stat(path + '-wal'), shm: stat(path + '-shm') }; } catch { unavailable('auxiliary_file'); }
      if (!protectedDeleteJournal(checked, proof)) unavailable('auxiliary_file');
      // Sample the journal first so the remaining proof also covers this window.
      // Disappearance is busy only while the remaining protection proof holds.
      try {
        const finalJournal = stat(path + '-journal');
        const final = { journal: finalJournal ?? current, main: stat(path), directory: stat(dirname(path)),
          wal: stat(path + '-wal'), shm: stat(path + '-shm') };
        if (!protectedDeleteJournal(final, proof) || finalJournal && !sameJournal(finalJournal, current))
          unavailable('auxiliary_file');
      } catch { unavailable('auxiliary_file'); }
      fail('storage_busy');
    }
    for (const suffix of ['-wal','-shm']) if (protectedFile(path + suffix, false)) unavailable('auxiliary_file');
    fail('storage_busy');
  }
  // A checkpointed WAL database can have no auxiliary files. Inspect its
  // mode through isolated SQLite before a host connection can create WAL/SHM.
  if (readOnly && protectedFile(path, false) && walHeader(path, observer)) unavailable('auxiliary_file');
}
/** Part-2 openers must call this after canonical path validation and BEFORE
 * constructing either SQLite connection. Missing files retain opener precedence;
 * this probe only refuses auxiliaries and non-rollback modes, without recovery. */
export function assertContextReadCanonicalDelete(path, observer) { auxiliaries(path, true, observer); }
export function assertContextReadReadOnlyAuxiliaries(path) {
  auxiliaries(path, true);
  auxiliaries(path + '.context-read-v1.sqlite', true);
}
const ddl = `
  CREATE TABLE generations (
    id TEXT PRIMARY KEY, store_id TEXT NOT NULL, format INTEGER NOT NULL CHECK(format=1),
    tokenizer TEXT NOT NULL, representation TEXT NOT NULL, projection TEXT NOT NULL,
    fence TEXT NOT NULL, access TEXT NOT NULL, sequence INTEGER NOT NULL CHECK(sequence>0),
    base_sequence INTEGER NOT NULL CHECK(base_sequence>=0), published INTEGER NOT NULL CHECK(published IN(0,1)),
    phase INTEGER NOT NULL CHECK(phase>=0), last_key TEXT NOT NULL, sweep_key TEXT NOT NULL,
    checkpoint INTEGER NOT NULL CHECK(checkpoint>=0), reason TEXT NOT NULL,
    reconciliation TEXT NOT NULL DEFAULT 'merge-v2' CHECK(reconciliation='merge-v2'),
    incarnation TEXT NOT NULL DEFAULT (lower(hex(randomblob(16))))
      CHECK(length(incarnation)=32 AND incarnation NOT GLOB '*[^0-9a-f]*')
  ) STRICT;
  CREATE TABLE documents (
    generation TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE,
    stream INTEGER NOT NULL CHECK(stream>=0), id TEXT NOT NULL,
    revision INTEGER NOT NULL CHECK(revision>0), body_revision INTEGER NOT NULL CHECK(body_revision>=0),
    eligible INTEGER NOT NULL CHECK(eligible IN(0,1)), representation TEXT NOT NULL,
    token_length INTEGER NOT NULL CHECK(token_length>=0),
    CHECK(eligible=1 OR token_length=0), PRIMARY KEY(generation,stream,id)
  ) STRICT;
  CREATE TABLE postings (
    generation TEXT NOT NULL, stream INTEGER NOT NULL, id TEXT NOT NULL,
    term TEXT NOT NULL CHECK(length(term)>0), frequency INTEGER NOT NULL CHECK(frequency>0),
    PRIMARY KEY(generation,term,stream,id),
    FOREIGN KEY(generation,stream,id) REFERENCES documents(generation,stream,id) ON DELETE CASCADE
  ) STRICT;
  CREATE INDEX document_postings ON postings(generation,stream,id,term);
  CREATE TABLE statistics (
    generation TEXT NOT NULL REFERENCES generations(id) ON DELETE CASCADE, term TEXT NOT NULL,
    df INTEGER NOT NULL CHECK(df>=0), n INTEGER NOT NULL CHECK(n>=0), total_length INTEGER NOT NULL CHECK(total_length>=0),
    CHECK((term='' AND df=0) OR (term!='' AND df>0 AND n=0 AND total_length=0)), PRIMARY KEY(generation,term)
  ) STRICT;
  CREATE TABLE vectors (
    generation TEXT NOT NULL, stream INTEGER NOT NULL, id TEXT NOT NULL,
    store_id TEXT NOT NULL, namespace TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN('memory','card')),
    revision INTEGER NOT NULL CHECK(revision>0), body_revision INTEGER NOT NULL CHECK(body_revision>=0),
    representation TEXT NOT NULL, embedder_id TEXT NOT NULL, embedder_revision TEXT NOT NULL,
    dimensions INTEGER NOT NULL CHECK(dimensions BETWEEN 1 AND 32768), normalization TEXT NOT NULL CHECK(normalization IN('none','l2')),
    data BLOB NOT NULL CHECK(length(data)=dimensions*4),
    PRIMARY KEY(generation,stream,id,embedder_id,embedder_revision,dimensions,normalization),
    FOREIGN KEY(generation,stream,id) REFERENCES documents(generation,stream,id) ON DELETE CASCADE
  ) STRICT;
`;

function projection(input) {
  if (!Array.isArray(input.readSet) || input.readSet.length < 1 || input.readSet.length > 2) fail('invalid_read_set');
  const entries = input.readSet.map((ns, i) => ({ namespace: cardNamespace(ns),
    accessGeneration: input.accessGenerations?.[i] ?? (input.readSet.length === 1 ? input.accessGeneration : undefined) }))
    .sort((a, b) => Buffer.compare(Buffer.from(JSON.stringify(boundary(a.namespace))), Buffer.from(JSON.stringify(boundary(b.namespace)))));
  const readSet = entries.map(entry => entry.namespace);
  if (readSet.length === 2 && (readSet[0].ownerId !== readSet[1].ownerId ||
      new Set(readSet.map(ns => ns.scope)).size !== 2)) fail('invalid_read_set');
  if (!Array.isArray(input.types) || !input.types.length || input.types.length > 2 ||
      new Set(input.types).size !== input.types.length || input.types.some(type => !['memory', 'card'].includes(type)) ||
      !['current', 'history'].includes(input.intent)) fail('invalid_input');
  // This internal port accepts already-authorized generations; it grants no
  // authority. Part 2 must authorize every namespace before calling it.
  if (entries.some(entry => !Number.isSafeInteger(entry.accessGeneration) || entry.accessGeneration < 1) ||
      input.accessGenerations !== undefined && (!Array.isArray(input.accessGenerations) || input.accessGenerations.length !== readSet.length)) fail('authority_required');
  const value = { readSet, types: ['card', 'memory'].filter(type => input.types.includes(type)), intent: input.intent };
  return { ...value, id: JSON.stringify(value), access: JSON.stringify(entries),
    // State is an internal scan partition, never part of a candidate identity.
    // It makes the existing (namespace,state,id) Card index a bounded keyset.
    streams: readSet.flatMap(ns => value.types.flatMap(type => type === 'card' ?
      ['draft', 'confirmed', 'cancelled', 'deleted'].map(state => ({ ns, type, state })) : [{ ns, type }])) };
}
function ref(stream, row) {
  return { type: stream.type, namespace: stream.ns, revision: row.revision,
    ...(stream.type === 'memory' ? { memoryId: row.id } : { cardId: row.id, bodyRevision: row.body_revision }) };
}

/** Internal storage port. db is an existing canonical connection; opening,
 * authority, asynchronous transport and envelopes belong to the facade.
 * Reads use U2c's synchronous deferred-BEGIN/query_only helper.
 * All canonical reads, including support validators, use that helper.
 * No host callback, provider or await occurs in either connection's transaction.
 */
export function openContextReadSidecar({ path, db: canonical, readOnly = false, batchSize = 128, authorizedProjection }) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 128) fail('invalid_input');
  if (path === ':memory:') unavailable('memory_store');
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) fail('invalid_path');
  const sidecarPath = path + '.context-read-v1.sqlite';
  const validationProjection = authorizedProjection ? projection(authorizedProjection).id : null;
  let closed = false, side, fileIdentity, rebuildReason, activeMetrics;
  const canonicalRead = work => {
    if (isConnectionDiscarded(canonical)) fail('store_closed');
    if (readOnly) auxiliaries(path, true);
    return readTransaction(canonical, () => inContentSuppressionRequestInside(canonical, () => { checkInstalledContentSafety(canonical); return work(); }));
  };
  const identity = canonicalRead(() => {
    const row = canonical.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').get();
    if (!row) unavailable('wrong_store');
    return { storeId: row.store_id, cursorSecret: row.cursor_secret };
  });
  const has = name => Boolean(canonical.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
  const features = canonicalRead(() => ({ cards: has('private_cards'), receipts: has('card_memory_bindings'), reviews: has('card_applicability_reviews') }));

  function checkFile() {
    if (closed || side && (!side.isOpen || isConnectionDiscarded(side))) fail('store_closed');
    const current = protectedFile(sidecarPath, false);
    if (!current) unavailable('missing');
    if (current.dev !== fileIdentity.dev || current.ino !== fileIdentity.ino) unavailable('replaced');
    auxiliaries(sidecarPath, readOnly);
  }
  const sideRead = work => { checkFile(); return readTransaction(side, work); };
  function write(work, kind = 'checkpoint') {
    if (readOnly) fail('invalid_input');
    checkFile();
    const m = activeMetrics, started = performance.now();
    let clock = performance.now();
    side.exec('BEGIN IMMEDIATE');
    if (m) m.beginMs += performance.now() - clock;
    try {
      const before = m ? side.prepare('SELECT total_changes() AS n').get().n : 0;
      clock = performance.now(); const result = work();
      if (m) {
        m.writeSqlMs += performance.now() - clock;
        m.rowWrites += side.prepare('SELECT total_changes() AS n').get().n - before;
        m.journalPeakBytes = Math.max(m.journalPeakBytes, stat(sidecarPath + '-journal')?.size ?? 0);
      }
      clock = performance.now(); side.exec('COMMIT');
      if (m) {
        m.commitMs += performance.now() - clock; m.writeTransactions++;
        m[kind + 'TransactionMs'] += performance.now() - started;
      }
      checkFile(); return result;
    }
    catch (error) { if (side.isTransaction) side.exec('ROLLBACK'); throw error; }
  }
  function open() {
    const initial = protectedFile(sidecarPath, false);
    if (initial && !readOnly && walHeader(sidecarPath)) unavailable('incompatible');
    auxiliaries(sidecarPath, readOnly);
    if (!initial) {
      if (readOnly) unavailable('missing');
      // Child-owned creation fd cannot release host/Worker SQLite locks.
      createExclusiveSqliteFile(sidecarPath);
      rebuildReason ??= 'missing';
    }
    fileIdentity = protectedFile(sidecarPath);
    try { side = new DatabaseSync(sidecarPath, { readOnly, timeout: 5000 }); }
    catch { unavailable('unsafe_file'); }
    side.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF; PRAGMA busy_timeout=5000;');
    checkFile();
    if (!initial) write(() => {
      side.exec(`PRAGMA application_id=${APPLICATION_ID}; PRAGMA user_version=${SIDECAR_FORMAT}; ${ddl}`);
    });
    const mode = sideRead(() => side.prepare('PRAGMA journal_mode').get().journal_mode);
    if (mode !== 'delete') unavailable('incompatible');
    sideRead(() => {
      if (side.prepare('PRAGMA application_id').get().application_id !== APPLICATION_ID ||
          side.prepare('PRAGMA user_version').get().user_version !== SIDECAR_FORMAT) unavailable('incompatible');
      if (side.prepare('PRAGMA quick_check').get().quick_check !== 'ok' || side.prepare('PRAGMA foreign_key_check').get()) unavailable('corrupt');
      if (side.prepare('SELECT 1 FROM generations WHERE store_id!=? LIMIT 1').get(identity.storeId)) unavailable('wrong_store');
      if (side.prepare("SELECT 1 FROM generations WHERE format!=? OR tokenizer!=? OR representation!=? OR reconciliation!='merge-v2' LIMIT 1")
        .get(SIDECAR_FORMAT, TOKENIZER_VERSION, REPRESENTATION_VERSION)) unavailable('incompatible');
      // Validate required columns even in an empty or partially built sidecar.
      for (const [table, columns] of Object.entries({ generations: 'id,fence,access,sequence,base_sequence,published,phase,last_key,sweep_key,checkpoint,reason,reconciliation,incarnation',
        documents: 'generation,stream,id,revision,body_revision,eligible,representation,token_length', postings: 'generation,stream,id,term,frequency',
        statistics: 'generation,term,df,n,total_length', vectors: 'generation,stream,id,store_id,namespace,type,revision,body_revision,representation,embedder_id,embedder_revision,dimensions,normalization,data' }))
        side.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`).all();
      // Product handles validate only the already-authorized projection. The
      // unscoped internal test/repair port can still audit the entire cache.
      const selected = alias => validationProjection === null ? '' : `${alias}.${alias === 'g' ? 'id' : 'generation'}=? AND `;
      const args = validationProjection === null ? [] : [validationProjection];
      const checks = [
        `SELECT 1 FROM generations g WHERE ${selected('g')}NOT EXISTS(SELECT 1 FROM statistics s WHERE s.generation=g.id AND s.term='') LIMIT 1`,
        `SELECT 1 FROM statistics s WHERE ${selected('s')}s.term='' AND (
          s.n!=(SELECT count(*) FROM documents d WHERE d.generation=s.generation AND d.eligible=1) OR
          s.total_length!=(SELECT coalesce(sum(token_length),0) FROM documents d WHERE d.generation=s.generation)) LIMIT 1`,
        `SELECT 1 FROM statistics s WHERE ${selected('s')}s.term!='' AND s.df!=(SELECT count(*) FROM postings p
          WHERE p.generation=s.generation AND p.term=s.term) LIMIT 1`,
        `SELECT 1 FROM documents d WHERE ${selected('d')}d.token_length!=(SELECT coalesce(sum(frequency),0) FROM postings p
          WHERE p.generation=d.generation AND p.stream=d.stream AND p.id=d.id) LIMIT 1`,
        `SELECT 1 FROM postings p LEFT JOIN statistics s ON s.generation=p.generation AND s.term=p.term
          WHERE ${selected('p')}s.term IS NULL LIMIT 1`,
      ];
      if (checks.some(sql => side.prepare(sql).get(...args))) unavailable('corrupt');
    });
  }
  try { open(); }
  catch (error) {
    try { side?.close(); } catch { /* Preserve the original refusal. */ }
    const repairable = ['wrong_store', 'incompatible', 'corrupt'].includes(error.reason) ||
      error.code === 'ERR_SQLITE_ERROR' && [1, 11, 26].includes(error.errcode & 0xff);
    if (!repairable) throw error;
    rebuildReason = error.reason ?? ((error.errcode & 0xff) === 1 ? 'incompatible' : 'corrupt');
    if (readOnly) unavailable(rebuildReason);
    protectedFile(sidecarPath);
    // Only a protected regular rollback journal may accompany repair. WAL/SHM
    // and unsafe paths are refused before any deletion.
    auxiliaries(sidecarPath, false);
    if (protectedFile(sidecarPath + '-journal', false)) unlinkSync(sidecarPath + '-journal');
    unlinkSync(sidecarPath);
    open();
  }

  function fence(p, validate, candidateWorklist) {
    return canonicalRead(() => {
      // Unknown Raw/Card counts still require canonical candidate decisions.
      // Carry their bounded metadata in the store fence SELECT already needed
      // by this snapshot; no extra transaction or per-candidate row refetch.
      const chunks=candidateWorklist?.chunks(), first=chunks?.next();
      const select = candidateRefs => candidateRefs?.length ? canonical.prepare(`SELECT store_id,
        (SELECT json_group_array(json_object('id',m.id,'owner_id',m.owner_id,'scope',m.scope,'project_id',m.project_id,
          'revision',m.revision,'deleted',m.deleted,'currentness',m.currentness,'review_state',m.review_state,
          'invalid_raw_ancestry',${cachedContentLayout(canonical)?.rawLineage ? `EXISTS(
            SELECT 1 FROM receipts ar JOIN raw_receipt_lineage al ON al.receipt_id=ar.id
            LEFT JOIN raw_conversations ac ON ac.id=al.conversation_id WHERE ar.memory_id=m.id
            AND (ac.owner_id IS NOT m.owner_id OR ac.scope IS NOT m.scope OR ac.project_id IS NOT m.project_id))` : '0'}))
          FROM (SELECT m.id,m.owner_id,m.scope,m.project_id,m.revision,m.deleted,m.currentness,m.review_state
            FROM (SELECT value FROM json_each(?) LIMIT 128) wanted
            CROSS JOIN memories m ON m.id=json_extract(wanted.value,'$[3]')
            AND m.owner_id=json_extract(wanted.value,'$[0]') AND m.scope=json_extract(wanted.value,'$[1]')
            AND m.project_id=json_extract(wanted.value,'$[2]') LIMIT 128) m) AS candidate_memories
        FROM store_metadata WHERE singleton=1`).get(JSON.stringify(candidateRefs)) :
        canonical.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
      const selected=select(first?.value?.refs);
      const store=selected?.store_id;
      if (store !== identity.storeId) unavailable('wrong_store');
      if (p.types.includes('card') && !features.cards) fail('invalid_input');
      const values=p.readSet.map(ns => {
        const proof=cachedContentSuppressionRequestInside(canonical,ns.ownerId);
        let memory;
        if(proof?.layout.suppressionRevision){
          const row=canonical.prepare(`SELECT n.epoch,coalesce(f.epoch_hi,0) epoch_hi,coalesce(f.epoch_lo,0) epoch_lo
            FROM (SELECT 1) anchor LEFT JOIN namespace_epochs n ON n.owner_id=? AND n.scope=? AND n.project_id=?
            LEFT JOIN owner_suppression_epochs f ON f.owner_id=?`).get(...boundary(ns),ns.ownerId);
          if(`${row.epoch_hi}:${row.epoch_lo}`!==proof.epoch)fail('evidence_unavailable');
          memory=row.epoch??1;
        }else memory=canonical.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...boundary(ns))?.epoch??1;
        return {memory,...(p.types.includes('card') ? { card: canonical.prepare(`SELECT generation FROM card_epochs WHERE ${where}`).get(...boundary(ns))?.generation ?? 1, ...cardDependencyFence(canonical, ns, p.readSet) } : {})};
      });
      if(candidateWorklist) {
        let chunk=first, rows=selected;
        while(!chunk.done) {
          candidateWorklist.check();
          candidateWorklist.accept(chunk.value,rows?.candidate_memories ? JSON.parse(rows.candidate_memories) : []);
          chunk=chunks.next();
          if(!chunk.done) { candidateWorklist.check(); rows=select(chunk.value.refs); }
        }
      }
      validate?.(values);return values;
    });
  }
  const generation = p => sideRead(() => side.prepare('SELECT * FROM generations WHERE id=?').get(p.id));
  function assertCheckpoint(g) {
    const current = side.prepare('SELECT sequence,checkpoint,fence,access,incarnation FROM generations WHERE id=?').get(g.id);
    if (!current || current.sequence !== g.sequence || current.checkpoint !== g.checkpoint ||
        current.fence !== g.fence || current.access !== g.access || current.incarnation !== g.incarnation) unavailable('stale_index');
  }
  function fresh(p, g, validate, candidateWorklist) {
    return g && g.published === 1 && g.access === p.access && g.fence === JSON.stringify(fence(p,validate,candidateWorklist));
  }

  function supportDatabase(metrics) {
    // Source support bytes/lookups are charged separately from candidate text.
    return bindContentSafetyConnection({ get isTransaction() { return canonical.isTransaction; }, prepare(sql) {
      const statement = canonical.prepare(sql);
      const charge = row => {
        for (const value of Object.values(row ?? {})) {
          if (typeof value === 'string') metrics.supportBytes += Buffer.byteLength(value);
          else if (value instanceof Uint8Array) metrics.supportBytes += value.byteLength;
        }
      };
      return { get(...args) { metrics.supportLookups++; const row = statement.get(...args); charge(row); return row; },
        all(...args) { metrics.supportLookups++; const rows = statement.all(...args); rows.forEach(charge); return rows; } };
    } }, canonical);
  }
  function cardEligible(ns, row, intent, metrics, readSet) {
    return contextCardEligible(supportDatabase(metrics), identity, features, ns, row, intent, { readSet });
  }

  function metadata(stream, after, maximum, p, metrics, exact = false) {
    const started = performance.now(); metrics.projectionLookups++;
    const { ns, type } = stream;
    // A Card's source verification can consume far more than its own text.
    // One projected Card per canonical transaction bounds that support work;
    // Memories retain the <=128-row metadata batch.
    if (type === 'card') maximum = 1;
    let rows;
    if (type === 'memory') {
      rows = canonical.prepare(`SELECT id,revision,0 AS body_revision,deleted,currentness,review_state
        FROM memories INDEXED BY index_memory_keyset WHERE ${where} AND id${exact ? '=' : '>'}? ORDER BY id LIMIT ?`)
        .all(...boundary(ns), after, maximum);
      metrics.canonicalRows += rows.length;
    } else {
      // private_card_scope has state before id. Each state is a separate scan
      // phase, avoiding a repeated sort of the remaining scope and keeping every
      // synchronous batch at <=128 rows without adding a canonical index.
      rows = canonical.prepare(`SELECT id,revision,coalesce(body_revision,0) AS body_revision,state
        FROM private_cards INDEXED BY private_card_scope WHERE ${where} AND state=? AND id${exact ? '=' : '>'}? ORDER BY id LIMIT ?`)
        .all(...boundary(ns), stream.state, after, maximum);
      metrics.canonicalRows += rows.length;
    }
    const result = rows.map(row => {
      const eligible = type === 'memory' ? memoryReadEligible(row, p.intent) :
        cardEligible(ns, row, p.intent, metrics, p.readSet);
      const tuple = { id: row.id, revision: row.revision, body_revision: row.body_revision, eligible: Number(eligible) };
      metrics.projectionBytes += Buffer.byteLength(JSON.stringify(tuple));
      return tuple;
    });
    metrics.projectionMs += performance.now() - started;
    return result;
  }
  function textFor(stream, id, metrics, proof) {
    const layout = cachedContentLayout(canonical);
    const ancestry = stream.type === 'memory' && layout?.suppressionRevision && layout.rawLineage ? `,EXISTS(
      SELECT 1 FROM receipts ar JOIN raw_receipt_lineage al ON al.receipt_id=ar.id
      LEFT JOIN raw_conversations ac ON ac.id=al.conversation_id WHERE ar.memory_id=memories.id
      AND (ac.owner_id IS NOT memories.owner_id OR ac.scope IS NOT memories.scope OR ac.project_id IS NOT memories.project_id)) AS invalid_raw_ancestry` : '';
    const columns=proof && stream.type==='memory' ? 'id,owner_id,scope,project_id,revision,deleted,currentness,review_state,' : '';
    const row = canonical.prepare(stream.type === 'memory' ? `SELECT ${columns}content AS text${ancestry} FROM memories WHERE ${where} AND id=?` :
      `SELECT title||char(10)||body AS text FROM private_cards WHERE ${where} AND id=?`).get(...boundary(stream.ns), id);
    if (row?.invalid_raw_ancestry) unavailable('stale_index');
    if (proof && stream.type==='memory' && !contentReadSafety(canonical,{identity,namespace:stream.ns,
      ref:ref(stream,proof.document),intent:proof.intent,selectedMemory:row,memo:createContentReadMemo(canonical)}).allowed) unavailable('stale_index');
    if (typeof row?.text !== 'string' || row.text.length > 2_000_000) fail('context_item_too_large');
    metrics.textRows++; metrics.textUnits += row.text.length; metrics.textBytes += Buffer.byteLength(row.text);
    return row.text;
  }
  function removeDocument(g, stream, id) {
    const previous = side.prepare('SELECT eligible,token_length FROM documents WHERE generation=? AND stream=? AND id=?').get(g.id, stream, id);
    if (!previous) return;
    const terms = side.prepare('SELECT term FROM postings WHERE generation=? AND stream=? AND id=?').all(g.id, stream, id);
    for (const { term } of terms) {
      const old = side.prepare('SELECT df FROM statistics WHERE generation=? AND term=?').get(g.id, term);
      if (old.df === 1) side.prepare('DELETE FROM statistics WHERE generation=? AND term=?').run(g.id, term);
      else side.prepare('UPDATE statistics SET df=df-1 WHERE generation=? AND term=?').run(g.id, term);
    }
    side.prepare("UPDATE statistics SET n=n-?,total_length=total_length-? WHERE generation=? AND term=''")
      .run(previous.eligible, previous.token_length, g.id);
    side.prepare('DELETE FROM documents WHERE generation=? AND stream=? AND id=?').run(g.id, stream, id);
  }
  function putDocument(g, stream, row, tokens) {
    removeDocument(g, stream, row.id);
    side.prepare('INSERT INTO documents VALUES(?,?,?,?,?,?,?,?)').run(g.id, stream, row.id, row.revision, row.body_revision,
      row.eligible, REPRESENTATION_VERSION, tokens.length);
    for (const [term, frequency] of tokens.frequencies) {
      side.prepare('INSERT INTO postings VALUES(?,?,?,?,?)').run(g.id, stream, row.id, term, frequency);
      side.prepare(`INSERT INTO statistics VALUES(?,?,1,0,0) ON CONFLICT(generation,term) DO UPDATE SET df=df+1`).run(g.id, term);
    }
    side.prepare("UPDATE statistics SET n=n+?,total_length=total_length+? WHERE generation=? AND term=''").run(row.eligible, tokens.length, g.id);
  }
  const metrics = () => ({ canonicalRows: 0, sidecarRows: 0, projectionBytes: 0, projectionLookups: 0, projectionMs: 0,
    sidecarScanMs: 0, sidecarBytes: 0, supportLookups: 0, supportBytes: 0,
    textRows: 0, textUnits: 0, textBytes: 0, transformed: 0, removed: 0, scanMs: 0, elapsedMs: 0,
    deltaDetectionMs: 0, retokenizeMs: 0, postingsStatisticsMs: 0, unchangedDocumentSqlMs: 0,
    writeSqlMs: 0, beginMs: 0, commitMs: 0, writeTransactions: 0, rowWrites: 0, journalPeakBytes: 0,
    fenceSqlMs: 0, fenceTransactionMs: 0, checkpointTransactionMs: 0, publicationTransactionMs: 0 });

  function reconcile(input, { isCurrent } = {}) {
    const m = metrics(); activeMetrics = m;
    try { return reconcileInside(input, m, isCurrent); } finally { activeMetrics = undefined; }
  }
  function reconcileInside(input, m, isCurrent) {
    if (readOnly) fail('invalid_input');
    const p = projection(input), budget = input.budget;
    if (!Number.isInteger(budget?.maxItems) || budget.maxItems < 1 || budget.maxItems > 1024 ||
        !Number.isInteger(budget.maxMs) || budget.maxMs < 1 || budget.maxMs > 5000) fail('invalid_input');
    const started = performance.now(), captured = JSON.stringify(fence(p));
    let durable = generation(p), restarting = !durable || durable.fence !== captured || durable.access !== p.access;
    let g = restarting ? { ...durable, id: p.id, fence: captured, access: p.access, published: 0, phase: 0, last_key: '',
      checkpoint: durable?.checkpoint ?? 0, sequence: (durable?.sequence ?? 0) + 1,
      base_sequence: durable?.published ? durable.sequence : durable?.base_sequence ?? 0,
      reason: durable ? 'reconcile' : rebuildReason ?? 'missing' } : durable;
    const matching = () => captured === JSON.stringify(fence(p));
    // Merge two ordered metadata streams. Only changed tuples enter the bounded
    // pending buffer. Scan positions are checkpointed with those deltas, or at
    // the call's cooperative deadline; unchanged rows are never stamped/copied.
    let phase = g.phase, lastKey = g.last_key, pending = [], pendingUnits = 0;
    function checkpoint(publish = false) {
      if (!restarting && phase === g.phase && lastKey === g.last_key && !pending.length && !publish) return true;
      isCurrent?.();
      if (!matching()) return false;
      // A matching published index is already invalidated by canonical epochs.
      // No durable 'rebuilding' marker is needed before the first checkpoint.
      // Complete scans atomically commit the fence, deltas, checkpoint and new
      // publication; partial scans atomically commit an incomplete checkpoint.
      write(() => {
        if (durable) assertCheckpoint(durable);
        else if (side.prepare('SELECT 1 FROM generations WHERE id=?').get(p.id)) unavailable('stale_index');
        const fenceStarted = performance.now();
        if (!durable) {
          side.prepare(`INSERT INTO generations(id,store_id,format,tokenizer,representation,projection,fence,access,sequence,
            base_sequence,published,phase,last_key,sweep_key,checkpoint,reason) VALUES(?,?,?,?,?,?,?,?,?,?,0,0,'','',0,?)`)
            .run(p.id, identity.storeId, SIDECAR_FORMAT, TOKENIZER_VERSION, REPRESENTATION_VERSION, p.id,
              captured, p.access, g.sequence, g.base_sequence, g.reason);
          side.prepare("INSERT INTO statistics VALUES(?,'',0,0,0)").run(p.id);
          g.incarnation = side.prepare('SELECT incarnation FROM generations WHERE id=?').get(p.id).incarnation;
        } else if (restarting) side.prepare(`UPDATE generations SET fence=?,access=?,base_sequence=?,sequence=?,
          published=0,phase=0,last_key='',sweep_key='',reason='reconcile' WHERE id=?`)
          .run(captured, p.access, g.base_sequence, g.sequence, p.id);
        m.fenceSqlMs += performance.now() - fenceStarted;
        const sqlStarted = performance.now();
        for (const delta of pending) {
          if (delta.row) putDocument(g, delta.stream, delta.row, delta.tokens);
          else { removeDocument(g, delta.stream, delta.id); m.removed++; }
        }
        m.postingsStatisticsMs += performance.now() - sqlStarted;
        side.prepare('UPDATE generations SET phase=?,last_key=?,published=?,checkpoint=checkpoint+1 WHERE id=?')
          .run(phase, lastKey, Number(publish), p.id);
      }, publish ? 'publication' : 'checkpoint');
      g = { ...g, phase, last_key: lastKey, published: Number(publish), checkpoint: g.checkpoint + 1 };
      durable = g; restarting = false;
      pending = []; pendingUnits = 0;
      return true;
    }
    while (!g.published && phase < p.streams.length && performance.now() - started < budget.maxMs && m.transformed < budget.maxItems) {
      if (!matching()) break;
      const stream = p.streams[phase], maximum = stream.type === 'card' ? 1 : batchSize;
      const scanStarted = performance.now();
      const rows = canonicalRead(() => metadata(stream, lastKey, maximum, p, m));
      const sidecarStarted = performance.now();
      const previous = sideRead(() => side.prepare(`SELECT id,revision,body_revision,eligible FROM documents
        WHERE generation=? AND stream=? AND id>? ORDER BY id LIMIT ?`).all(p.id, phase, lastKey, maximum));
      m.sidecarRows += previous.length;
      m.sidecarBytes += Buffer.byteLength(JSON.stringify(previous));
      m.sidecarScanMs += performance.now() - sidecarStarted;
      const canonicalEnded = rows.length < maximum, sidecarEnded = previous.length < maximum;
      let canonicalIndex = 0, sidecarIndex = 0, processed = 0;
      while (canonicalIndex < rows.length || sidecarIndex < previous.length) {
        // An exhausted full page can hide a next-page key before the other
        // stream's current key. Re-seek both streams after the common prefix.
        if (canonicalIndex === rows.length && !canonicalEnded || sidecarIndex === previous.length && !sidecarEnded || processed >= maximum) break;
        const detectionStarted = performance.now();
        const row = rows[canonicalIndex], old = previous[sidecarIndex];
        const order = !row ? 1 : !old ? -1 : row.id === old.id ? 0 : Buffer.compare(Buffer.from(row.id), Buffer.from(old.id));
        const changed = order < 0 || order === 0 && (row.revision !== old.revision || row.body_revision !== old.body_revision || row.eligible !== old.eligible);
        m.deltaDetectionMs += performance.now() - detectionStarted;
        if (changed) {
          if (m.transformed >= budget.maxItems || pending.length >= batchSize) break;
          m.transformed++;
          const text = row.eligible ? canonicalRead(() => textFor(stream, row.id, m)) : null;
          if (pendingUnits + (text?.length ?? 0) > 2_000_000 && !checkpoint()) break;
          pendingUnits += text?.length ?? 0;
          const tokenizeStarted = performance.now();
          pending.push({ stream: phase, row, tokens: text === null ? { length: 0, frequencies: new Map() } : termFrequencies(text) });
          m.retokenizeMs += performance.now() - tokenizeStarted;
        } else if (order > 0) {
          if (pending.length >= batchSize) break;
          pending.push({ stream: phase, id: old.id });
        }
        lastKey = order > 0 ? old.id : row.id;
        if (order <= 0) canonicalIndex++;
        if (order >= 0) sidecarIndex++;
        processed++;
        if (performance.now() - started >= budget.maxMs) break;
      }
      if (canonicalEnded && sidecarEnded && canonicalIndex === rows.length && sidecarIndex === previous.length) { phase++; lastKey = ''; }
      m.scanMs += performance.now() - scanStarted;
      if (pending.length >= batchSize || pendingUnits >= 1_980_000) {
        if (!checkpoint(phase >= p.streams.length)) break;
      }
    }
    // Durable progress is bounded by 128 changed documents / 2M text units and
    // the call deadline. A killed uncommitted scan is entirely replayable.
    if (!g.published) checkpoint(phase >= p.streams.length);
    m.elapsedMs = performance.now() - started;
    const ready = fresh(p, g);
    return { status: ready ? 'complete' : 'rebuilding', buildState: ready ? g.reason === 'reconcile' ? 'ready' : 'rebuilt' : 'rebuilding',
      reason: g.reason, progress: { phase: g.phase, checkpoint: g.checkpoint, sequence: g.sequence, baseSequence: g.base_sequence }, metrics: m,
      stops: { deadline: !ready && m.elapsedMs >= budget.maxMs, budget: !ready && m.transformed >= budget.maxItems },
      coverage: ready ? sideRead(() => ({ ...side.prepare("SELECT n,total_length FROM statistics WHERE generation=? AND term=''").get(p.id) })) : { n: null, total_length: null } };
  }

  function published(p, validate) {
    const g = generation(p);
    if (!fresh(p, g, validate)) unavailable('rebuilding');
    return g;
  }
  function candidateAllowed(item, intent, readSet, memo, selectedMemory) {
    return item.type === 'card' ? contextCardEligible(canonical,identity,features,item.namespace,
      {id:item.cardId,revision:item.revision,body_revision:item.bodyRevision},intent,{readSet}) :
      contentReadSafety(canonical,{identity,namespace:item.namespace,ref:item,intent,memo,selectedMemory}).allowed;
  }
  function safetyEpoch(p) {
    if (!(cachedContentLayout(canonical) ?? installedContentLayout(canonical)).suppressionRevision) return undefined;
    if (cachedContentSuppressionRequestInside(canonical)) return contentSuppressionRequestFenceInside(canonical,p.readSet[0].ownerId);
    return canonicalRead(() => contentSuppressionFenceInside(canonical,p.readSet[0].ownerId));
  }
  function emptyRequestFacts(p) {
    const state=cachedContentSuppressionRequestInside(canonical,p.readSet[0].ownerId);
    return state?.facts?.length===0 && p.readSet.every(ns=>state.readSet.some(selected=>
      selected.scope==='owner' || selected.scope===ns.scope && (selected.projectId??'')===(ns.projectId??'')));
  }
  // Project only the bounded fact keys into an already-required sidecar read.
  // The request fact set is provisional until the existing canonical fences;
  // no canonical row or read memo is retained by this projection.
  function factDocuments(p, state = cachedContentSuppressionRequestInside(canonical,p.readSet[0].ownerId)) {
    const layout=state?.layout ?? cachedContentLayout(canonical);
    if (!layout?.suppressionRevision || state?.epoch==='0:0' || state?.facts?.length===0 && p.readSet.every(ns=>state.readSet.some(selected=>
      selected.scope==='owner' || selected.scope===ns.scope && (selected.projectId??'')===(ns.projectId??'')))) return null;
    const keys = new Map();
    for (const fact of state?.facts ?? []) {
      if (fact.kind !== 'memory') continue;
      const stream = p.streams.findIndex(s=>s.type==='memory' && s.ns.scope===fact.scope && (s.ns.projectId??'')===fact.project_id);
      if (stream >= 0) keys.set(JSON.stringify([stream,fact.stable_key]),[stream,fact.stable_key]);
    }
    return JSON.stringify([...keys.values()]);
  }
  function visibleStatistics(p, keys) {
    if (keys === null) return side.prepare("SELECT n,total_length FROM statistics WHERE generation=? AND term=''").get(p.id);
    return side.prepare(`SELECT n,total_length,(SELECT json_group_array(json_object(
      'stream',stream,'id',id,'revision',revision,'token_length',token_length)) FROM documents
      WHERE generation=? AND eligible=1 AND (stream,id) IN
        (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))) AS fact_documents
      FROM statistics WHERE generation=? AND term=''`).get(p.id,keys,p.id);
  }
  // Called only inside a canonical snapshot the legacy algorithm already opens,
  // with sidecar metadata from its existing totals/count query.
  function visibleDocuments(p, totals, deadlineAt = performance.now()+1000, state) {
    const inspect=memo=>{
      if (!memo.layout.suppressionRevision || memo.epoch==='0:0') return null;
      if (memo.facts?.length === 0) return null;
      const ids=new Set(); let totalLength=totals.total_length;
      const unknown=!memo.facts||memo.layout.rawLineage||p.types.includes('card')||memo.facts.some(f=>!['memory','owner','namespace','receipt'].includes(f.kind));
      for (const fact of memo.facts ?? []) {
        if(performance.now()>=deadlineAt)unavailable('timeout');
        if(['owner','namespace'].includes(fact.kind))unavailable('stale_index');
      }
      for (const row of JSON.parse(totals.fact_documents ?? '[]')) {
        if(performance.now()>=deadlineAt)unavailable('timeout');
        const ns=p.streams[row.stream].ns, key=JSON.stringify([row.stream,row.id]);
        if(ids.has(key))continue;
        // Only direct Memory metadata is subtracted here. Raw/Card uncertainty
        // keeps unknown counts and the conservative canonical candidate pass.
        if(contentSuppressionReasonInside(canonical,ns,{kind:'memory',key:row.id,
          revision:row.revision,version:JSON.stringify(['memory-revision-v1',row.revision])})) {
          ids.add(key);totalLength-=row.token_length;
        }
      }
      const count=unknown?null:totals.n-ids.size;
      return {ids:[...ids],unknown,byType:Object.fromEntries(p.types.map(type=>[type,{eligible:count,indexed:count}])),totalLength,n:count};
    };
    return state ? inspect(state) : withContentSuppressionReadInside(canonical,p.readSet,inspect);
  }
  function lexicalPage(input, query, limit = 24, { deadlineAt = Infinity } = {}) {
    if (typeof query !== 'string' || !query.trim() || query.length > 4000 || query.includes('\0') || !query.isWellFormed() ||
        !Number.isSafeInteger(limit) || limit < 1 || limit > 24) fail('invalid_input');
    const p = projection(input), terms = [...new Set(tokenizeT1(query))], suppressionEpoch=safetyEpoch(p);
    const keys=factDocuments(p); let result, pending;
    const work=state=>sideRead(() => {
      const statistics=visibleStatistics(p,keys===null?null:factDocuments(p,state)), visible=keys===null?null:visibleDocuments(p,statistics,deadlineAt,state);
      const allowed=visible&&new Set(visible.ids);
      const totals = visible?{n:visible.n,total_length:visible.totalLength}:statistics, df = new Map(), docs = new Map();
      for (const term of terms) {
        if (performance.now() >= deadlineAt) unavailable('timeout');
        const frequency = side.prepare('SELECT df FROM statistics WHERE generation=? AND term=?').get(p.id, term)?.df;
        if (frequency === undefined) continue;
        df.set(term, frequency);
        let afterStream = -1, afterId = '';
        while (true) {
          if (performance.now() >= deadlineAt) unavailable('timeout');
          const rows = side.prepare(`SELECT d.*,p.frequency FROM postings p JOIN documents d
            ON d.generation=p.generation AND d.stream=p.stream AND d.id=p.id
            WHERE p.generation=? AND p.term=? AND d.eligible=1 AND (p.stream,p.id)>(?,?)
            ORDER BY p.stream,p.id LIMIT ?`).all(p.id, term, afterStream, afterId, batchSize);
          for (const row of rows) {
            const key = JSON.stringify([row.stream, row.id]);
            if(allowed&&allowed.has(key))continue;
            if (!docs.has(key)) docs.set(key, { ...row, frequencies: new Map() });
            docs.get(key).frequencies.set(term, row.frequency);
          }
          if (rows.length < batchSize) break;
          afterStream = rows.at(-1).stream; afterId = rows.at(-1).id;
        }
      }
      const rank = () => {
        if(visible)for(const term of terms)df.set(term,[...docs.values()].filter(row=>row.frequencies.has(term)).length);
        if(visible?.unknown){totals.n=docs.size;totals.total_length=[...docs.values()].reduce((n,r)=>n+r.token_length,0);}
        const ranked = rankScores([...docs.values()].map(row => ({ ref: ref(p.streams[row.stream], row),
          score: scoreBM25(terms, { frequencies: row.frequencies, length: row.token_length }, { N: totals.n, totalLength: totals.total_length, df }) }))).slice(0, limit);
        if (performance.now() >= deadlineAt) unavailable('timeout');
        return { rows: ranked, matched: docs.size };
      };
      if(!visible?.unknown)return rank();
      // These are sidecar rows, not retained canonical rows or read memos.
      // Fresh canonical metadata is consumed only by the final fence below.
      pending={
        check(){if(performance.now()>=deadlineAt)unavailable('timeout');},
        *chunks(){
          let refs=[],keys=[];
          for(const [key,row]of docs){
            this.check(); const stream=p.streams[row.stream]; keys.push(key);
            if(stream.type==='memory')refs.push([...boundary(stream.ns),row.id]);
            if(keys.length===128){yield {refs,keys};refs=[];keys=[];}
          }
          if(keys.length)yield {refs,keys};
        },
        accept(chunk,selected){
          const memo=createContentReadMemo(canonical), memories=new Map(selected.map(row=>
            [JSON.stringify([row.owner_id,row.scope,row.project_id,row.id]),row]));
          for(const key of chunk.keys){
            this.check(); const row=docs.get(key);
            const stream=p.streams[row.stream], item=ref(stream,row);
            if(!candidateAllowed(item,p.intent,p.readSet,memo,memories.get(JSON.stringify([...boundary(stream.ns),row.id]))))docs.delete(key);
          }
        },finish:rank};
      return {rows:[],matched:0};
    });
    // Legacy keeps its original snapshot order. Safety batches the additional
    // fact work into the canonical publication fence already required here.
    const g = keys===null ? published(p) : published(p,()=>withContentSuppressionReadInside(canonical,p.readSet,state=>{result=work(state);}));
    if(keys===null)result=work();
    if(suppressionEpoch!==safetyEpoch(p))unavailable('stale_index');
    const current = generation(p);
    if (!fresh(p, current,pending?()=>{result=pending.finish();}:undefined,pending) ||
        current.sequence !== g.sequence || current.incarnation !== g.incarnation) unavailable('stale_index');
    if(result.rows.length && suppressionEpoch!==undefined && suppressionEpoch!=='0:0' &&
        !cachedContentSuppressionRequestInside(canonical,p.readSet[0].ownerId)) {
      // Direct internal sidecar callers have no facade's final evidence pass.
      result.rows=canonicalRead(()=>{const memo=createContentReadMemo(canonical);
        return result.rows.filter(({ref:item})=>candidateAllowed(item,p.intent,p.readSet,memo));});
    }
    return result;
  }

  // Explicit document embedding is deliberately a separate operation. The
  // caller owns request/spend reservations, cancellation and authority rechecks.
  async function refreshVectors(input, embedder, { signal, isCurrent, onProgress, maxBatchDocuments } = {}) {
    if (readOnly) fail('invalid_input');
    if (typeof isCurrent !== 'function') fail('authority_required');
    const guard = () => { try { if (isCurrent() === true) return; } catch { /* A refused grant is stale. */ } fail('scope_changed'); };
    guard();
    const port = validateEmbedder(embedder), p = projection(input), g = published(p), m = metrics();
    const maximum = input.budget?.maxItems, maxMs = input.budget?.maxMs;
    if (!Number.isInteger(maximum) || maximum < 1 || maximum > 1024 || !Number.isInteger(maxMs) || maxMs < 1 || maxMs > 5000) fail('invalid_input');
    if (maxBatchDocuments !== undefined && maxBatchDocuments !== 1) fail('invalid_input');
    const safetyLayout = Boolean((cachedContentLayout(canonical) ?? installedContentLayout(canonical)).suppressionRevision);
    // The budget port already fences namespace and owner epochs before each
    // dispatch. Its scoped-empty proof needs no per-document fact recheck.
    const checkCandidates = safetyLayout && !(isBudgetEmbeddingPort(embedder) && emptyRequestFacts(p));
    const started = performance.now(); let attempted = 0, embedded = 0;
    while (attempted < maximum && performance.now() - started < maxMs) {
      guard();
      const rows = sideRead(() => side.prepare(`SELECT d.* FROM documents d WHERE d.generation=? AND d.eligible=1 AND NOT EXISTS(
        SELECT 1 FROM vectors v WHERE v.generation=d.generation AND v.stream=d.stream AND v.id=d.id AND v.embedder_id=?
        AND v.embedder_revision=? AND v.dimensions=? AND v.normalization=?) ORDER BY d.stream,d.id LIMIT ?`)
        .all(p.id, port.id, port.revision, port.dimensions, port.normalization, Math.min(batchSize, maxBatchDocuments ?? 64, maximum - attempted)));
      if (!rows.length) break;
      attempted += rows.length;
      onProgress?.({ attempted, embedded });
      // A single candidate can occupy the entire text budget. Materialize
      // each in its own bounded read transaction and check the deadline
      // between them; the transport batch has its own combined bound below.
      const texts = rows.map(row => {
        if (performance.now() - started >= maxMs) unavailable('timeout');
        if (!checkCandidates) return canonicalRead(() => textFor(p.streams[row.stream], row.id, m));
        return canonicalRead(() => {
          const stream = p.streams[row.stream];
          // The original text SELECT is the canonical proof source. It is
          // consumed synchronously here; only its text crosses the caller await.
          if(stream.type==='memory')return textFor(stream,row.id,m,{document:row,intent:p.intent});
          const current = metadata(stream, row.id, 1, p, m, true)[0];
          if (!current?.eligible || current.revision !== row.revision || current.body_revision !== row.body_revision) unavailable('stale_index');
          return textFor(stream, row.id, m);
        });
      });
      if (texts.reduce((sum, text) => sum + text.length, 0) > 2_000_000) fail('context_item_too_large');
      checkSignal(signal);
      guard();
      const before = generation(p);
      if (!fresh(p, before) || before.sequence !== g.sequence || before.incarnation !== g.incarnation) unavailable('stale_index');
      // The trusted budget wrapper invokes its existing namespace/owner fence
      // before transport. Unbranded direct callers retain the conservative
      // canonical candidate guard after text selection.
      const dispatch = !checkCandidates || isBudgetEmbeddingPort(embedder) ? () => {} : engineGuard(() => canonicalRead(() => {
        const memo=createContentReadMemo(canonical);
        for (const row of rows) {
          const stream=p.streams[row.stream];
          if (stream.type==='card' ? !cardEligible(stream.ns,row,p.intent,m,p.readSet) :
              !candidateAllowed(ref(stream,row),p.intent,p.readSet,memo)) unavailable('stale_index');
        }
      }));
      if(checkCandidates && !isBudgetEmbeddingPort(embedder))dispatch();
      let vectors;
      const budgetPort=isBudgetEmbeddingPort(embedder);
      assertContentPort({before:true});
      try {
        const invoke=async()=>{try{return inertContentPortValue(await port.embed(texts, { signal, beforeDispatch: dispatch }), 'invalid_input', { rejectProxies: true });}
          catch(error){
            if(budgetPort||!hasContentPortBoundary())throw error;
            let frame;try{frame=inertContentPortValue({code:error?.code,name:error?.name,status:error?.status,reason:error?.reason},'invalid_input');}catch{fail('invalid_input');}
            const safe=Object.assign(new Error('provider_error'),{code:typeof frame.code==='string'?frame.code:'provider_error'});
            for(const key of ['name','reason'])if(typeof frame[key]==='string')safe[key]=frame[key];
            if(typeof frame.status==='number')safe.status=frame.status;throw safe;
          }};
        vectors=await (budgetPort?invoke():assertContentPort({invoke}));
      } finally {
        // Authority callbacks finish before the invocation's sole epoch read.
        try {
          checkSignal(signal); if (closed) fail('store_closed'); guard();
          // Re-check after the guard: the caller's isCurrent may abort the signal or close the store.
          checkSignal(signal); if (closed) fail('store_closed');
        }
        finally { if(!budgetPort||embedder.didInvoke())assertContentPort(); }
      }
      if (performance.now() - started >= maxMs) unavailable('timeout');
      const after = generation(p);
      if (!fresh(p, after) || after.sequence !== g.sequence || after.incarnation !== g.incarnation) unavailable('stale_index');
      if (!Array.isArray(vectors) || vectors.length !== rows.length) fail('invalid_input');
      const encoded = vectors.map(vector => encodeVector(vector, port));
      const checkpoint = generation(p);
      write(() => {
        assertCheckpoint(checkpoint);
        rows.forEach((row, i) => {
          const current = side.prepare('SELECT revision,body_revision,eligible FROM documents WHERE generation=? AND stream=? AND id=?').get(p.id, row.stream, row.id);
          if (!current?.eligible || current.revision !== row.revision || current.body_revision !== row.body_revision) unavailable('stale_index');
          side.prepare('INSERT OR REPLACE INTO vectors VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(p.id, row.stream, row.id, identity.storeId,
            JSON.stringify(p.streams[row.stream].ns), p.streams[row.stream].type, row.revision, row.body_revision, REPRESENTATION_VERSION,
            port.id, port.revision, port.dimensions, port.normalization, encoded[i]);
          embedded++;
        });
        side.prepare('UPDATE generations SET checkpoint=checkpoint+1 WHERE id=?').run(p.id);
      });
      onProgress?.({ attempted, embedded });
    }
    return { attempted, embedded, metrics: m };
  }

  function state(input) {
    const p = projection(input), g = generation(p), keys=factDocuments(p);
    const byType = Object.fromEntries(p.types.map(type => [type, { eligible: null, indexed: null }]));
    const inspect = state => {
      const keys=factDocuments(p,state);
      const rows=sideRead(()=>keys===null ? side.prepare(`SELECT stream,count(*) AS n FROM documents
        WHERE generation=? AND eligible=1 GROUP BY stream`).all(p.id) :
        side.prepare(`SELECT stream,count(*) AS n,sum(token_length) AS total_length,
          json_group_array(json_object('stream',stream,'id',id,'revision',revision,'token_length',token_length))
          FILTER (WHERE (stream,id) IN (SELECT json_extract(value,'$[0]'),json_extract(value,'$[1]') FROM json_each(?))) AS fact_documents
          FROM documents WHERE generation=? AND eligible=1 GROUP BY stream`).all(keys,p.id));
      const totals={n:rows.reduce((n,r)=>n+r.n,0),total_length:rows.reduce((n,r)=>n+r.total_length,0),
        fact_documents:JSON.stringify(rows.flatMap(r=>JSON.parse(r.fact_documents??'[]')))};
      const visible=keys===null ? null : visibleDocuments(p,totals,undefined,state);
      for (const type of p.types) byType[type] = visible?visible.byType[type]:{ eligible: 0, indexed: 0 };
      if(!visible)for (const row of rows) {
        const value = byType[p.streams[row.stream].type]; value.eligible += row.n; value.indexed += row.n;
      }
    };
    const current=JSON.stringify(fence(p,fenceValues=>{
      if(keys!==null && g?.published===1 && g.fence===JSON.stringify(fenceValues) && g.access===p.access)withContentSuppressionReadInside(canonical,p.readSet,inspect);
    }));
    const ready = Boolean(g && g.published === 1 && g.fence === current && g.access === p.access);
    if(ready && keys===null)inspect();
    return { ready, fence: current, sequence: g?.sequence ?? null, checkpoint: g?.checkpoint ?? null, incarnation: g?.incarnation ?? null,
      ...(safetyEpoch(p)===undefined?{}:{suppressionEpoch:safetyEpoch(p)}),
      buildState: ready ? g.reason === 'reconcile' ? 'ready' : 'rebuilt' : 'rebuilding', reason: g?.reason ?? rebuildReason ?? null, byType,
      progress: g ? { phase: g.phase, checkpoint: g.checkpoint, sequence: g.sequence, baseSequence: g.base_sequence } : null };
  }
  function assertState(input, expected, { checkpoint = true, validate } = {}) {
    const p = projection(input), g = published(p,validate);
    if(expected.suppressionEpoch!==undefined&&expected.suppressionEpoch!==safetyEpoch(p))unavailable('stale_index');
    if (g.sequence !== expected.sequence || checkpoint && g.checkpoint !== expected.checkpoint ||
        g.fence !== expected.fence || g.incarnation !== expected.incarnation) unavailable('stale_index');
  }
  function semanticPreflight(input, embedder, { deadlineAt = Infinity } = {}) {
    const port = validateEmbedder(embedder), p = projection(input), keys=factDocuments(p);
    let visible, count;
    const inspect=state=>sideRead(()=>{
      if(keys===null){count=side.prepare("SELECT n FROM statistics WHERE generation=? AND term=''").get(p.id).n;return;}
      const totals=visibleStatistics(p,factDocuments(p,state));visible=visibleDocuments(p,totals,deadlineAt,state);count=visible?visible.n:totals.n;
    });
    const g = keys===null ? published(p) : published(p,()=>withContentSuppressionReadInside(canonical,p.readSet,inspect));
    if(keys===null)inspect();
    const allowed=visible&&new Set(visible.ids);
    if(visible?.unknown)return {state:'partial_coverage',eligible:null,embedded:null,scanned:0,byType:null};
    const byType = Object.fromEntries(p.types.map(type => [type, { embedded: 0, scanned: 0 }]));
    if (!semanticCapacity(count, port).eligible) return { state: 'partial_coverage', eligible: count, embedded: null, scanned: 0, byType: null };
    let embedded = 0, afterStream = -1, afterId = '', released = false; const vectors = [];
    while (true) {
      if (performance.now() >= deadlineAt) return { state: 'timeout', eligible: count, embedded, scanned: 0, byType };
      // U2c read results contain plain materialized data only. Decode and
      // validate one bounded batch of vectors after the transaction ends.
      const rows = sideRead(() => side.prepare(`SELECT v.store_id,v.namespace,v.type,v.revision,v.body_revision,v.representation,
        v.embedder_id,hex(v.data) AS vector_data,d.stream AS document_stream,d.id AS document_id,
        d.revision AS current_revision,d.body_revision AS current_body
        FROM documents d LEFT JOIN vectors v ON v.generation=d.generation AND v.stream=d.stream AND v.id=d.id AND v.embedder_id=?
        AND v.embedder_revision=? AND v.dimensions=? AND v.normalization=?
        WHERE d.generation=? AND d.eligible=1 AND (d.stream,d.id)>(?,?) ORDER BY d.stream,d.id LIMIT ?`)
        .all(port.id, port.revision, port.dimensions, port.normalization, p.id, afterStream, afterId, batchSize));
      for (const row of rows) {
        if(allowed&&allowed.has(JSON.stringify([row.document_stream,row.document_id])))continue;
        if (row.embedder_id === null) continue;
        const stream = p.streams[row.document_stream];
        if (row.store_id !== identity.storeId || row.revision !== row.current_revision || row.body_revision !== row.current_body ||
            row.representation !== REPRESENTATION_VERSION || row.namespace !== JSON.stringify(stream.ns) || row.type !== stream.type)
          return { state: 'stale_index', eligible: count, embedded, scanned: 0, byType };
        try {
          const vector = loadVector(Buffer.from(row.vector_data, 'hex'), port);
          vectors.push({ ref: ref(stream, { id: row.document_id, revision: row.revision, body_revision: row.body_revision }), vector });
          embedded++; byType[stream.type].embedded++;
        } catch (error) { return { state: error.code === 'dimension_mismatch' ? 'dimension_mismatch' : 'provider_error', eligible: count, embedded, scanned: 0, byType }; }
      }
      if (rows.length < batchSize) break;
      afterStream = rows.at(-1).document_stream; afterId = rows.at(-1).document_id;
    }
    assertState(input, g);
    if (embedded !== count) return { state: 'partial_coverage', eligible: count, embedded, scanned: 0, byType };
    for (const type of p.types) byType[type].scanned = byType[type].embedded;
    // This closure and its bounded fp32 cache are created outside the helper.
    return { state: 'ready', eligible: count, embedded, scanned: count, byType, sequence: g.sequence, checkpoint: g.checkpoint, fence: g.fence,
      release() { vectors.length = 0; released = true; },
      score(queryVector, { deadlineAt: scoreDeadline = deadlineAt } = {}) {
        if (released) unavailable('stale_index');
        assertState(input, g);
        const query = loadVector(encodeVector(queryVector, port), port), scores = [];
        for (let i = 0; i < vectors.length; i++) {
          if (i % batchSize === 0 && performance.now() >= scoreDeadline) unavailable('timeout');
          scores.push({ ref: vectors[i].ref, score: cosine(query, vectors[i].vector) });
        }
        const ranked = rankScores(scores).slice(0, 24);
        if (performance.now() >= scoreDeadline) unavailable('timeout');
        assertState(input, g);
        return ranked;
      } };
  }
  return Object.freeze({ reconcile, lexicalPage, lexical: (...args) => lexicalPage(...args).rows,
    refreshVectors, semanticPreflight, state, assertState, assertFile: checkFile,
    close() { if (!closed) { closed = true; if (side.isOpen) side.close(); } } });
}

// U5c-2 internal seam: the optional readers supply a charged database wrapper.
// Reconciliation, members and relation endpoints use the canonical current/
// history predicate. Only organization title-source checks omit applicability,
// matching private-organization-storage titleInside; support remains required.
export function contextCardEligible(sourceDb, identity, features, ns, row, intent = 'current', { requireApplicability = true, rawRows, readSet = [ns] } = {}) {
  return contentReadSafety(sourceDb, { identity, namespace: ns, intent,
    ref: { type: 'card', namespace: ns, cardId: row.id, revision: row.revision, bodyRevision: row.body_revision || null },
    rawRows,
    currentCardEligible: () => {
      const dependency = createCardCurrentStorage({ db: sourceDb, identity }).compare(ns, row, readSet);
      return (!dependency || dependency.status === 'current') && (!requireApplicability ||
        features.reviews && cardApplicabilityInside(sourceDb, row).applicability === 'current');
    } }).allowed;
}

// U5c-2: call only inside the facade's deferred authoritative transaction.
export function contextSourceFences(db, readSet, types, sources, features) {
  return readSet.map(ns => {
    const value = { memory: db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...boundary(ns))?.epoch ?? 1 };
    if (types.includes('card') && features.cards) {
      Object.assign(value, cardDependencyFence(db, ns, readSet));
      value.card = db.prepare(`SELECT generation FROM card_epochs WHERE ${where}`).get(...boundary(ns))?.generation ?? 1;
      if (sources.includes('moc-v1') && features.organization)
        value.cardMoc = db.prepare(`SELECT revision FROM card_moc_epochs WHERE ${where}`).get(...boundary(ns))?.revision ?? 1;
    }
    if (sources.includes('moc-v1') && types.includes('memory')) {
      const state = db.prepare(`SELECT active_generation FROM namespace_index_state WHERE ${where}`).get(...boundary(ns));
      value.memoryProjection = !state ? { state: 'live-without-state-row' } : state.active_generation === null ?
        { state: 'unavailable' } : { state: 'published', generation: state.active_generation };
    }
    return value;
  });
}

// Reached only through the supervised semantic service's lazy import boundary.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { createExclusiveSqliteFile, sqliteFileStat } from './sqlite-journal-probe.mjs';
import { createProductSqlitePolicy } from './context-product-sqlite.mjs';
import { canonicalJson } from './context-product-validation.mjs';
import { exact, ascii, hash, integer, LEDGER_VERSION } from './context-semantic-input.mjs';
import { fail } from './validation.mjs';
import { validatePumpAccounting } from './context-semantic-accounting.mjs';

// State contains engine-produced data only. It can outgrow an IPC envelope;
// neither its text nor its complete inventory is sent to a request Worker.
export function stateBytes(value) {
  if (Array.isArray(value)) return '[' + value.map(stateBytes).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort((a,b) => Buffer.compare(Buffer.from(a),Buffer.from(b)))
    .map(key => JSON.stringify(key) + ':' + stateBytes(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
export const stateDigest = value => {
  const state=structuredClone(value);
  for(const entry of Object.values(state.catalog??{}))delete entry.canonicalPath;
  return createHash('sha256').update(stateBytes({semantic_owners:[[state.ownerId,state]]})).digest('base64url');
};
const same = (a,b) => stateBytes(a) === stateBytes(b);
const unavailable = () => fail('index_unavailable');
const APPLICATION_ID=0x43534531;
const DDL='CREATE TABLE semantic_metadata(singleton INTEGER PRIMARY KEY CHECK(singleton=1),header TEXT NOT NULL) STRICT;CREATE TABLE semantic_owners(owner_id TEXT PRIMARY KEY,sequence INTEGER NOT NULL,state_digest TEXT NOT NULL,state TEXT NOT NULL) STRICT;';
const schema=db=>db.prepare("SELECT type,name,tbl_name,sql FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").all();
const expected=DDL.split(';').filter(Boolean).map(sql=>{const name=/CREATE TABLE (\w+)/.exec(sql)[1];return {type:'table',name,tbl_name:name,sql};});
function attest(db) {
  if(db.prepare('PRAGMA application_id').get().application_id!==APPLICATION_ID||db.prepare('PRAGMA user_version').get().user_version!==1||!same(schema(db),expected))unavailable();
}
// Rebuild ID-keyed records after JSON/structuredClone, which do not preserve
// null prototypes. Values remain ordinary closed engine records.
function stateRecords(state) {
  for(const key of ['days','reservations','identities','prices','receipts','hints','windows','pumpBindings','catalog'])
    state[key]=Object.assign(Object.create(null),state[key]);
  for(const window of Object.values(state.windows)){window.quanta=Object.assign(Object.create(null),window.quanta);validatePumpAccounting(window);}
  return state;
}
export function zeroSemanticOwner(ownerId, ledgerEpoch = 1, bindingRevision = 1) {
  return stateRecords({ownerId,ledgerEpoch,bindingRevision,sequence:0,ledgerFile:null,policy:{ownerId,semantic:false,revision:0,purgeEpoch:0},
    dayHighWater:0,days:{},reservations:{},identities:{},prices:{},targets:null,targetSetDigest:null,
    receipts:{},validationOrdinal:0,hints:{},validationPending:false,firstCoverageComplete:false,backfillUsd:'0',blocked:false,
    windows:{},pumpBindings:{},catalog:{},purge:{state:'idle',epoch:0,deletedVectors:0,checkpoint:null,remainingVectors:null,reason:null}});
}
function anchor(value) {
  const a = exact(value,'ownerId,accountingDomainId,ledgerId,ledgerEpoch,bindingRevision,sequence,stateDigest,pending');
  ascii(a.accountingDomainId); ascii(a.ledgerId); integer(a.ledgerEpoch,1); integer(a.bindingRevision,1); integer(a.sequence); hash(a.stateDigest);
  if (a.pending !== null) { const p = exact(a.pending,'sequence,stateDigest'); integer(p.sequence,1); hash(p.stateDigest); if(p.sequence!==a.sequence+1)unavailable(); }
  return a;
}
export function openSemanticLedger({path,identity,authority,policy,observer}) {
  if (!authority || typeof authority.load !== 'function' || typeof authority.compareAndSwap !== 'function' || typeof authority.listOwners !== 'function') fail('invalid_input');
  const sqlite = policy ?? createProductSqlitePolicy({observer});
  const files = sqlite.files(path), physical = sqliteFileStat(path);
  const native = observer ? observer.invoke('open','connection',()=>new DatabaseSync(path)) : new DatabaseSync(path);
  let db;
  try {
    db = sqlite.open(native,path).db;
    db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF');
    attest(db);
    const header = db.prepare('SELECT header FROM semantic_metadata WHERE singleton=1').get();
    if (!header || header.header !== canonicalJson({version:LEDGER_VERSION,...identity})) unavailable();
  } catch(error) {try{(db??native).close();}catch{}throw error;}
  function read(ownerId) {
    files(); const now = sqliteFileStat(path);
    if (now.dev!==physical.dev || now.ino!==physical.ino) unavailable();
    const row = db.prepare('SELECT sequence,state_digest,state FROM semantic_owners WHERE owner_id=?').get(ownerId);
    if (!row) unavailable();
    let state;
    try { state=stateRecords(JSON.parse(row.state)); } catch {unavailable();}
    if (row.state!==stateBytes(state) || stateDigest(state)!==row.state_digest || state.ownerId!==ownerId || state.sequence!==row.sequence ||
        !same(state.ledgerFile,{device:String(physical.dev),inode:String(physical.ino)})) unavailable();
    return {...row,state};
  }
  const expected = (ownerId,row) => ({ownerId,...identity,ledgerEpoch:row.state.ledgerEpoch,bindingRevision:row.state.bindingRevision,
    sequence:row.sequence,stateDigest:row.state_digest,pending:null});
  async function authenticate(ownerId,{recoverPrepared=false}={}) {
    let a;
    try {a=anchor(await authority.load(ownerId));} catch {unavailable();}
    const row=read(ownerId), e=expected(ownerId,row);
    if (a.pending!==null) {
      // Recovery is an explicit host disposal decision, never inferred from a
      // PID, a timed-out operation or a replaced service handle.
      if (!recoverPrepared || typeof authority.confirmDisposed!=='function' || await authority.confirmDisposed(a)!==true) unavailable();
      const previous={...a,pending:null}, prepared={...previous,sequence:a.pending.sequence,stateDigest:a.pending.stateDigest};
      if (!same(e,previous) && !same(e,prepared)) unavailable();
      if (await authority.compareAndSwap(a,e)!==true) unavailable(); a=e;
    }
    if (!same(a,e)) unavailable();
    return {anchor:a,...row};
  }
  async function authenticateAll() {
    // Inventory is independently durable host authority, enrolled before a
    // ledger row can exist. Discovering it from this file would bless a
    // same-inode snapshot that silently drops another owner's exposure.
    let owners;
    try {owners=await authority.listOwners({...identity});} catch {unavailable();}
    if(!Array.isArray(owners)||!owners.length||owners.some(id=>typeof id!=='string'||!id.length)||new Set(owners).size!==owners.length)unavailable();
    owners=[...owners].sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
    const rows=[];
    for(const ownerId of owners)rows.push(await authenticate(ownerId));
    checkAll(rows);
    return rows;
  }
  function checkAll(rows) {
    const owners=db.prepare('SELECT owner_id FROM semantic_owners ORDER BY owner_id').all();
    if(!same(owners.map(r=>r.owner_id),rows.map(r=>r.state.ownerId)))unavailable();
    for(const row of rows){const current=read(row.state.ownerId);if(current.sequence!==row.sequence||current.state_digest!==row.state_digest)unavailable();}
  }
  async function prepare(current,nextState) {
    if(!Number.isSafeInteger(current.anchor.sequence+1))unavailable();
    nextState.sequence=current.anchor.sequence+1;
    const nextDigest=stateDigest(nextState), a=current.anchor;
    const prepared={...a,pending:{sequence:a.sequence+1,stateDigest:nextDigest}};
    if (await authority.compareAndSwap(a,prepared)!==true) unavailable();
    return {prepared,nextState,nextDigest,previous:a};
  }
  function commit(preparation,check=()=>{}) {
    const {prepared,nextState,nextDigest,previous}=preparation;
    db.exec('BEGIN IMMEDIATE');
    try {
      const old=read(previous.ownerId);
      if (old.sequence!==previous.sequence || old.state_digest!==previous.stateDigest) unavailable();
      check(db,nextState);
      const changed=db.prepare('UPDATE semantic_owners SET sequence=?,state_digest=?,state=? WHERE owner_id=? AND sequence=? AND state_digest=?')
        .run(prepared.pending.sequence,nextDigest,stateBytes(nextState),previous.ownerId,previous.sequence,previous.stateDigest);
      if(changed.changes!==1)unavailable();
      db.exec('COMMIT');
    } catch(error) {if(db.isTransaction)db.exec('ROLLBACK');throw error;}
    return {...prepared,sequence:prepared.pending.sequence,stateDigest:nextDigest,pending:null};
  }
  async function mutate(current,change,check,beforeCommit,onPrepare) {
    const next=stateRecords(structuredClone(current.state)); change(next);
    const preparation=await prepare(current,next);onPrepare?.(preparation);let sealed;
    try {beforeCommit?.();sealed=commit(preparation,check);}catch(error) {
      // Failed native admission never acquired permission to send. Cancel only
      // an exact still-uncommitted preparation; ambiguous states stay pinned.
      const row=read(current.state.ownerId);
      if(row.sequence===current.sequence&&row.state_digest===current.state_digest)
        await authority.compareAndSwap(preparation.prepared,preparation.previous);
      throw error;
    }
    if(await authority.compareAndSwap(preparation.prepared,sealed)!==true)unavailable();
    return {anchor:sealed,sequence:sealed.sequence,state_digest:sealed.stateDigest,state:next};
  }
  return {read,authenticate,authenticateAll,checkAll,prepare,commit,mutate,close:()=>db.close(),db};
}

// Explicit control-plane enrollment. The host's independent enrollment service
// authenticates the owner and proves never-bound history in createIfNeverBound;
// ordinary coordinator operations never call this function or create a row.
export async function provisionSemanticOwner({path,identity,ownerId,enrollment,deadlineAt}) {
  if(typeof enrollment?.authorizeNeverBound!=='function'||typeof enrollment?.createIfNeverBound!=='function'||await enrollment.authorizeNeverBound(ownerId)!==true)fail('authority_required');
  const sqlite=createProductSqlitePolicy();sqlite.start(deadlineAt);
  try {sqliteFileStat(path);} catch(error) {if(error.code!=='ENOENT')throw error;createExclusiveSqliteFile(path);}
  const db=sqlite.open(new DatabaseSync(path),path).db;
  const state=zeroSemanticOwner(ownerId),physical=sqliteFileStat(path);state.ledgerFile={device:String(physical.dev),inode:String(physical.ino)};
  const bytes=stateBytes(state), digest=stateDigest(state);
  const a={ownerId,...identity,ledgerEpoch:1,bindingRevision:1,sequence:0,stateDigest:digest,pending:null};
  try {
    const empty=schema(db).length===0&&db.prepare('PRAGMA application_id').get().application_id===0&&db.prepare('PRAGMA user_version').get().user_version===0;
    if(!empty)attest(db);
    if(await enrollment.createIfNeverBound(a)!==true)fail('authority_required');
    db.exec('BEGIN IMMEDIATE');
    try {
      if(empty)db.exec(`PRAGMA application_id=${APPLICATION_ID};PRAGMA user_version=1;${DDL}`);
      const header=canonicalJson({version:LEDGER_VERSION,...identity}), existing=db.prepare('SELECT header FROM semantic_metadata WHERE singleton=1').get();
      if(existing && existing.header!==header)unavailable();
      db.prepare('INSERT OR IGNORE INTO semantic_metadata VALUES(1,?)').run(header);
      db.prepare('INSERT INTO semantic_owners VALUES(?,0,?,?)').run(ownerId,digest,bytes); db.exec('COMMIT');
    } catch(error) {if(db.isTransaction)db.exec('ROLLBACK');throw error;}
  } finally {db.close();}
  return a;
}

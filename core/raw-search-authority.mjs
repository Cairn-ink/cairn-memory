import { rawSearchDeadline } from './raw-search-sqlite.mjs';
import { performance } from 'node:perf_hooks';
import { createHash, createHmac } from 'node:crypto';
import { readTransaction, isStorageBusy } from './database.mjs';
import { installedContentLayout } from './content-safety-schema.mjs';
import { contentSuppressionFenceInside,resetContentSuppressionRequestInside } from './content-suppression-storage.mjs';
import { sourceReadSafety } from './content-safety.mjs';
import { createCardRawSources } from './card-raw-sources.mjs';
import { createRawSourceReader } from './raw-source-reader.mjs';
import { rawSourceRef } from './raw-source-input.mjs';
import { verifyPrivateGrant } from './private-card-facade.mjs';
import { contentAuthorityPort } from './content-safety-boundary.mjs';
import { fail,MemoryStoreError } from './validation.mjs';
import { immutable, same, rawSourceHint } from './raw-search-input.mjs';
import { rawSessionKeys } from './raw-source-roots.mjs';

const boundary = ns => [ns.ownerId,ns.scope,ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';

/** Adapts existing canonical source primitives. The sidecar is never authority. */
export function createRawSearchAuthority(database, options) {
  const { db } = database;
  const openRaw = options.crypto.openRaw.bind(options.crypto);
  // Engine-owned pure hashing, never a caller port or a raw filesystem read.
  db.function('raw_search_sealed_digest',{deterministic:true},value=>value===null?null:createHash('sha256').update(value).digest('hex'));
  let resumeAt=0;
  const deadline = at => {if(performance.now()>=at)rawSearchDeadline();};
  // Check before each native statement as well as each canonical snapshot.
  // Cleanup runs after restoring prepare, so expiry cannot prevent ROLLBACK.
  function timed(work,at) {
    deadline(at);if(at===Infinity)return work();
    const own=Object.getOwnPropertyDescriptor(db,'prepare'),prepare=db.prepare;
    db.prepare=function(sql){
      deadline(at);const statement=prepare.call(this,sql);
      for(const method of ['get','all']){
        const execute=statement[method];
        statement[method]=function(...args){deadline(at);return execute.apply(this,args);};
      }
      return statement;
    };
    try{return work();}finally{if(own)Object.defineProperty(db,'prepare',own);else delete db.prepare;}
  }
  const read = (work,at=Infinity) => {
    database.assertFile();
    deadline(at);if(performance.now()<resumeAt)fail('source_busy');
    try{return readTransaction(db,()=>{resetContentSuppressionRequestInside(db);return timed(work,at);});}catch(error){
      // A pending writer makes a fresh SHARED acquisition busy. Abandon the
      // quantum instead of waiting or repeatedly reacquiring ahead of capture.
      if(isStorageBusy(error)){resumeAt=performance.now()+25;fail('source_busy');}
      throw error;
    }
  };
  const identity = read(() => {
    const layout = installedContentLayout(db);
    if (!layout.rawSources || !layout.rawLineage || !layout.rawDeletion) fail('unsupported_database');
    return db.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').get();
  });
  const key = Buffer.from(read(() => db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get()).secret,'hex');
  const bind = (purpose,value) => createHmac('sha256',identity.cursor_secret).update(JSON.stringify([purpose,identity.store_id,value])).digest('base64url');
  function bindWithin(purpose,value,at=Infinity) {
    if(at===Infinity)return bind(purpose,value);
    const hash=createHmac('sha256',identity.cursor_secret);
    // Engine-owned JSON records only. Preserve JSON.stringify's exact bytes,
    // checking between values; a projected page string holds at most 32 rows.
    const write=value=>{
      deadline(at);
      if(Array.isArray(value)){
        hash.update('[');for(let i=0;i<value.length;i++){if(i)hash.update(',');write(value[i]);}hash.update(']');
      }else if(value&&typeof value==='object'){
        hash.update('{');let first=true;
        for(const key of Object.keys(value)){
          const next=value[key];if(next===undefined||['function','symbol'].includes(typeof next))continue;
          if(!first)hash.update(',');first=false;hash.update(JSON.stringify(key));hash.update(':');write(next);
        }
        hash.update('}');
      }else hash.update(JSON.stringify(value)??'null');
    };
    write([purpose,identity.store_id,value]);deadline(at);return hash.digest('base64url');
  }
  const sourceIdentity = { storeId: identity.store_id, cursorSecret: identity.cursor_secret };
  // Search refs bind immutable message/part manifests, not a conversation's
  // append counter. Other source readers retain their original revision query.
  const sources = createCardRawSources(db,sourceIdentity,{mutableRevision:false});
  const partDigest = m => createHmac('sha256',key).update(JSON.stringify(['raw-part-v1',m.id,m.messageOrdinal,m.role,m.occurredAt,
    m.part.index,m.part.start,m.part.totalUnits,m.part.totalBytes,m.content])).digest('hex');
  const host = contentAuthorityPort(options.authority);
  function namespace(ns) {
    if (!options.readSet.some(value => same(value,ns))) fail('source_unavailable');
  }
  function authorize(method,input,token,guard = () => {}) {
    const entries = options.readSet.map(ns => {
      const request = immutable({ method,namespace: ns,actionClass:'read',actionId:null,targetId:null,expectedRevision:null,
        payloadBinding:bind('raw-search-request-v1',[method,input]),input });
      guard();
      const grant = host.authorize(request,token);
      guard();
      const generation = verifyPrivateGrant(host.isCurrent(grant,request),request);
      guard();
      return { request,grant,generation };
    });
    return (check = guard) => {
      database.assertFile();
      for (const {request,grant,generation} of entries) {
        check();
        if (verifyPrivateGrant(host.isCurrent(grant,request),request) !== generation) fail('scope_changed');
        check();
      }
    };
  }
  function hostAncestry(ref, message) {
    // Host registration already persists a domain-separated empty projection.
    // Authenticate the message's first event, not a later overlapping batch or
    // an empty eligible list (which engine registration can also produce).
    const event = db.prepare(`SELECT e.session_key,e.event_id,e.first_message_ids,e.eligible_message_ids,e.binding_digest,e.projection_digest
      FROM raw_messages m JOIN raw_capture_events e ON e.conversation_id=m.conversation_id AND e.event_id=m.first_event_id
      WHERE m.conversation_id=? AND m.message_id=? AND e.owner_id=? AND e.scope=? AND e.project_id=? AND e.client=?`)
      .get(ref.conversationId,ref.messageId,...boundary(ref.namespace),message.client);
    if (!event || event.session_key !== message.session_key) return false;
    let first, eligible;
    try {
      first = JSON.parse(event.first_message_ids);
      eligible = JSON.parse(event.eligible_message_ids);
    } catch (error) {
      if (error instanceof SyntaxError) return false;
      throw error;
    }
    return Array.isArray(first) && first.includes(ref.messageId) && Array.isArray(eligible) && !eligible.length &&
      event.projection_digest === createHash('sha256').update(JSON.stringify(['raw-capture-host-empty-v1',
        event.session_key,event.event_id,first,event.binding_digest])).digest('hex');
  }
  function inspectInside(ref,intent = 'history',ignorePause = false) {
    namespace(ref.namespace); ref = rawSourceRef(ref,ref.namespace);
    const ns = ref.namespace, state = sources.budget();
    const view = sources.resolve(ns,ref,state);
    const dispatch=[];
    // Decryption opens a whole physical part. An allowed small slice cannot
    // carry a privacy-denied sibling into that caller port. Full-part refs end
    // this recursion; retirement outside the slice remains a history policy.
    for(const part of view.parts)if(part.start<ref.span.start||part.end>ref.span.end){
      const anchor={conversationId:ref.conversationId,messageId:ref.messageId,span:{start:part.start,end:part.end,precision:'exact'}};
      const full=sources.inspect(ns,anchor,state);
      dispatch.push(inspectInside(sources.refFor(ns,anchor,full),'history',ignorePause));
    }
    if (db.prepare(`SELECT 1 FROM raw_session_fences WHERE ${where} AND client=? AND session_key=?`)
      .get(...boundary(ns),view.message.client,view.message.session_key)) fail('source_unavailable');
    if (!sourceReadSafety(db,{identity:sourceIdentity,namespace:ns,ref,rawBudget:state,rawMutableRevision:false}).allowed) fail('source_unavailable');
    // Engine maps prove engine interpretation. Host registration instead binds
    // session ancestry; the host must fence every source session on forget or
    // correction. Never infer that contract from absent maps alone.
    const mapped = db.prepare('SELECT 1 FROM raw_source_maps WHERE conversation_id=? AND message_id=? LIMIT 1')
      .get(ref.conversationId,ref.messageId);
    const hostAncestryOnly = !mapped && hostAncestry(ref,view.message);
    if (!mapped && !hostAncestryOnly) fail('source_unavailable');
    // LEFT joins preserve unresolved ancestry. An inner join would turn missing
    // authority into an apparently bare source.
    const links = db.prepare(`SELECT l.receipt_id,l.start,l.end,l.precision,r.memory_id,r.client,r.session_id,r.event_id,r.role,r.excerpt,
      m.id,m.revision,m.owner_id,m.scope,m.project_id,m.currentness,m.deleted,m.review_state,o.kind FROM raw_receipt_lineage l
      LEFT JOIN receipts r ON r.id=l.receipt_id LEFT JOIN memories m ON m.id=r.memory_id
      LEFT JOIN raw_receipt_origins o ON o.receipt_id=r.id
      WHERE l.conversation_id=? AND l.message_id=? AND l.start<? AND l.end>?
      ORDER BY m.id LIMIT 1025`).all(ref.conversationId,ref.messageId,ref.span.end,ref.span.start);
    if (links.length > 1024) fail('source_unavailable');
    for (const row of links) {
      if (!row.id || row.deleted || row.kind !== 'derived' || row.owner_id !== ns.ownerId || row.scope !== ns.scope ||
          row.project_id !== (ns.projectId ?? '') || row.role !== view.message.role || row.event_id !== ref.messageId ||
          row.start < 0 || row.end > view.manifest.message.total_units ||
          row.precision === 'whole-message' && (row.start !== 0 || row.end !== view.manifest.message.total_units)) fail('source_unavailable');
      const receiptRef = {type:'receipt',namespace:ns,memoryId:row.id,memoryRevision:row.revision,receiptId:row.receipt_id,completeness:'excerpt-only',
        contentIdentity:sources.bind('retained-receipt-content-v1',[ns,row.id,row.revision,row.receipt_id,row.client,row.session_id,row.event_id,row.role,row.excerpt])};
      if (!sourceReadSafety(db,{identity:sourceIdentity,namespace:ns,ref:receiptRef}).allowed) fail('source_unavailable');
    }
    // Receipts whose source session/message matches but whose stored lineage is
    // missing are incomplete privacy ancestry, never proof of bare Raw.
    const possible = db.prepare(`SELECT r.id,r.session_id FROM receipts r JOIN memories m ON m.id=r.memory_id
      WHERE m.owner_id=? AND m.scope=? AND m.project_id=? AND r.client=? AND r.event_id=?
      AND NOT EXISTS(SELECT 1 FROM raw_receipt_lineage l WHERE l.receipt_id=r.id AND l.conversation_id=? AND l.message_id=?) LIMIT 1025`)
      .all(...boundary(ns),view.message.client,ref.messageId,ref.conversationId,ref.messageId);
    if (possible.length > 1024 || possible.some(row => rawSessionKeys(ns,view.message.client,row.session_id,key.toString('hex'))
      .includes(view.message.session_key))) fail('source_unavailable');
    const historical = links.some(row => row.currentness === 'historical');
    const unknown = links.some(row => row.currentness !== 'current' || row.review_state === 'awaiting');
    const classification = !links.length ? {kind:'current-eligible-bare',reason:'complete-privacy-no-memory-link'} :
      historical ? {kind:'history-only',reason:links.some(row=>row.currentness==='current')?'current-history-overlap':'retired-memory'} :
      unknown ? {kind:'history-only',reason:'unresolved-currentness'} : {kind:'current-eligible-linked',reason:'current-memory-links'};
    if (hostAncestryOnly && classification.kind === 'current-eligible-bare') classification.reason = 'host-session-ancestry';
    if (intent === 'current' && classification.kind === 'history-only') fail('source_unavailable');
    if (!ignorePause && paused(ns)) throw Object.assign(new MemoryStoreError('source_unavailable'),{disposition:'paused'});
    return { ref,manifest:view.manifest,role:view.message.role,ordinal:view.message.ordinal,occurredAt:view.message.occurred_at,
      currentness:historical ? 'historical' : unknown || !links.length ? 'unknown' : 'current',classification,
      suppression:contentSuppressionFenceInside(db,ns.ownerId),dispatch,links:links.map(row=>({receiptId:row.receipt_id,memoryId:row.id,
        revision:row.revision,start:row.start,end:row.end,precision:row.precision,currentness:row.currentness,reviewState:row.review_state})) };
  }
  function paused(ns) {
    const control=db.prepare(`SELECT paused,enabled FROM episode_controls WHERE ${where}`).get(...boundary(ns));
    return !!control?.paused || control?.enabled===0;
  }
  // Query text belongs to the whole selected read set. Check every namespace
  // in one fresh canonical snapshot, including namespaces with no index rows.
  function queryAllowed(at=Infinity) {
    return read(()=>!options.readSet.map(ns=>paused(ns)).some(Boolean),at);
  }
  // Permanent denials win over reversible pause, including during cleanup.
  function disposition(source) {
    return read(()=>{
      try {
        const next=inspectInside(source.ref,'history',true);
        if(!matches(source,next))return 'remove';
        return paused(source.ref.namespace)?'paused':'allowed';
      } catch(error) {
        if(!['source_unavailable','source_excluded','raw_crypto_unavailable'].includes(error.code))throw error;
        return 'remove';
      }
    });
  }
  function describe(part,ns) {
    const anchor = { conversationId:part.conversation_id,messageId:part.message_id,
      span:{start:part.start,end:part.end,precision:'exact'} };
    const view = sources.inspect(ns,anchor,sources.budget());
    const ref = sources.refFor(ns,anchor,view);
    return inspectInside(ref);
  }
  // The ref authenticates the exact canonical manifest. Mutable denial epochs
  // and unrelated lineage changes need not invalidate an otherwise allowed
  // hint; inspectInside has just applied the complete current predicate.
  const projection=source=>{
    const {canonical,...hint}=rawSourceHint(source,bind);return hint;
  };
  const matches=(source,next)=>same(projection(source),projection(next));
  function inventory(after = ['', '', -1], limit = 16) {
    // Global owner keyset also catches old writers and capture-only fences.
    const rows = read(()=>db.prepare(`SELECT p.conversation_id,p.message_id,p.part_index,p.start,p.end,c.scope,c.project_id
      FROM raw_parts p JOIN raw_conversations c ON c.id=p.conversation_id
      WHERE c.owner_id=? AND (p.conversation_id,p.message_id,p.part_index)>(?,?,?)
      ORDER BY p.conversation_id,p.message_id,p.part_index LIMIT ?`).all(options.ownerId,...after,limit));
    return { rows:rows.map(part => {
      const ns = { ownerId:options.ownerId,scope:part.scope,projectId:part.project_id || null };
      if (!options.readSet.some(value => same(value,ns))) return { key:[part.conversation_id,part.message_id,part.part_index] };
      try { return { key:[part.conversation_id,part.message_id,part.part_index],source:read(()=>describe(part,ns)) }; }
      catch (error) {
        if (!['source_unavailable','source_excluded','raw_crypto_unavailable','source_budget_exceeded'].includes(error.code)) throw error;
        return { key:[part.conversation_id,part.message_id,part.part_index],disposition:error.disposition };
      }
    }),complete:rows.length < limit };
  }

  // The journal is a selector, never permission. Row positions cross JSON as
  // decimal strings and enter SQLite as integers without Number conversion.
  const journalColumns='CAST(rowid AS TEXT) AS position,owner_id,scope,project_id,client,event_id,conversation_id,digest';
  const journalBinding=bind('raw-search-journal-binding-v1',[database.fileIdentity,options.ownerId,options.readSet]);
  const eventAnchor=row=>bind('raw-search-journal-anchor-v1',[journalBinding,row.position,row.owner_id,row.scope,
    row.project_id,row.client,row.event_id,row.conversation_id,row.digest]);
  const journalRow=position=>db.prepare(`SELECT ${journalColumns} FROM raw_events WHERE rowid=?`).get(BigInt(position));
  const anchored=entry=>{
    if(entry.position==='0')return entry.anchor===null;
    const row=journalRow(entry.position);
    return !!row&&eventAnchor(row)===entry.anchor;
  };
  const eventNamespace=row=>options.readSet.find(ns=>row.owner_id===ns.ownerId&&row.scope===ns.scope&&row.project_id===(ns.projectId??''));
  function recent(previous,{limit=4,at=Infinity}={}) {
    return read(()=>{
      const tip=db.prepare(`SELECT ${journalColumns} FROM raw_events ORDER BY rowid DESC LIMIT 1`).get();
      let cursor=previous&&structuredClone(previous),recovered=false;
      const validPosition=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(value)&&BigInt(value)<=9223372036854775807n;
      if(!cursor||cursor.version!==1||cursor.binding!==journalBinding||!validPosition(cursor.examined)||
          !cursor.active||typeof cursor.active!=='object'||Array.isArray(cursor.active)||!Number.isInteger(cursor.streak)||cursor.streak<0||cursor.streak>3||
          !Number.isSafeInteger(cursor.round)||cursor.round<0||
          cursor.recovery&&(!validPosition(cursor.recovery.before)||!Number.isInteger(cursor.recovery.remaining)||cursor.recovery.remaining<1||cursor.recovery.remaining>64)||
          Object.keys(cursor.active).length>options.readSet.length||
          Object.entries(cursor.active).some(([name,entry])=>!options.readSet.some(ns=>JSON.stringify(ns)===name)||
            !entry||!validPosition(entry.position)||!validPosition(entry.through)||BigInt(entry.position)>BigInt(entry.through)||
            entry.partOffset!==null&&(!Number.isInteger(entry.partOffset)||entry.partOffset<0||entry.partOffset>24)||!anchored(entry))||
          !anchored({position:cursor.examined,anchor:cursor.anchor})||BigInt(cursor.examined)>BigInt(tip?.position??'0')) {
        cursor={version:1,binding:journalBinding,examined:tip?.position??'0',anchor:tip?eventAnchor(tip):null,
          active:{},recovery:tip?{before:tip.position,remaining:64}:null,round:0,streak:0};
        recovered=true;
      }
      let headers=0,attempts=0;
      const rows=[],seen=new Set(),anchors=[];
      const remember=row=>{
        const ns=eventNamespace(row);if(!ns)return;
        const name=JSON.stringify(ns),old=cursor.active[name];
        if(old)old.through=row.position;
        else cursor.active[name]={position:row.position,anchor:eventAnchor(row),partOffset:0,through:row.position};
      };
      // Discovery cannot overwrite an unresolved event, including a parked pause.
      const discovery=db.prepare(`SELECT ${journalColumns} FROM raw_events WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT 32`)
        .all(BigInt(cursor.examined),BigInt(tip?.position??'0'));
      for(const row of discovery){remember(row);cursor.examined=row.position;cursor.anchor=eventAnchor(row);headers++;}
      const drain=()=>{
        const names=options.readSet.map(ns=>JSON.stringify(ns));let idle=0;
        while(attempts<limit&&headers<64&&idle<names.length&&performance.now()<at){
          const name=names[cursor.round++%names.length],entry=cursor.active[name];
          if(!entry){idle++;continue;}
          const ns=options.readSet.find(ns=>JSON.stringify(ns)===name);
          if(paused(ns)){idle++;continue;}
          if(entry.partOffset===null){
            if(entry.position===entry.through){delete cursor.active[name];idle=0;continue;}
            const row=db.prepare(`SELECT ${journalColumns} FROM raw_events WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT 1`)
              .get(BigInt(entry.position),BigInt(entry.through));
            if(!row){delete cursor.active[name];idle=0;continue;}
            headers++;entry.position=row.position;entry.anchor=eventAnchor(row);
            if(eventNamespace(row)&&JSON.stringify(eventNamespace(row))===name)entry.partOffset=0;
            if(entry.partOffset===null)continue;
          }
          const header=journalRow(entry.position);
          if(!header||eventAnchor(header)!==entry.anchor)fail('source_changed');
          // Load one bounded result at a time; physical headers were bounded
          // before namespace filtering. Unsupported payloads get full repair.
          anchors.push({position:header.position,anchor:eventAnchor(header)});
          const payload=db.prepare('SELECT result FROM raw_events WHERE rowid=? AND length(CAST(result AS BLOB))<=1048576').get(BigInt(entry.position));
          let event;try{event=payload&&JSON.parse(payload.result);}catch{}
          if(!event||event.conversationId!==header.conversation_id||!Array.isArray(event.parts)||event.parts.length>24){entry.partOffset=null;continue;}
          if(entry.partOffset>=event.parts.length){entry.partOffset=null;continue;}
          const part=event.parts[entry.partOffset];attempts++;idle=0;
          if(part&&typeof part==='object'&&part.saved===true&&typeof part.messageId==='string'&&Number.isSafeInteger(part.index)&&part.index>=0){
            const live=db.prepare(`SELECT p.conversation_id,p.message_id,p.part_index,p.start,p.end FROM raw_parts p
              JOIN raw_conversations c ON c.id=p.conversation_id WHERE p.conversation_id=? AND p.message_id=? AND p.part_index=?
              AND c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND p.saved=1`)
              .get(header.conversation_id,part.messageId,part.index,...boundary(ns),header.client);
            if(live){
              const key=[live.conversation_id,live.message_id,live.part_index];
              try{const source=describe(live,ns);if(!seen.has(JSON.stringify(key))){rows.push({key,source});seen.add(JSON.stringify(key));}}
              catch(error){
                if(error.disposition==='paused'){idle++;continue;}
                if(!['source_unavailable','source_excluded','raw_crypto_unavailable','source_budget_exceeded'].includes(error.code))throw error;
                // A resource refusal is retryable, never proof of consumption.
                if(['source_budget_exceeded','raw_crypto_unavailable'].includes(error.code))throw error;
              }
            }
          }
          entry.partOffset++;
          if(entry.partOffset===event.parts.length)entry.partOffset=null;
        }
      };
      drain();
      // Lend idle drain capacity back to discovery, bounding physical headers
      // before any owner/namespace filtering, including foreign-only traffic.
      if(discovery.length===32&&headers<64&&attempts<limit){
        const extra=db.prepare(`SELECT ${journalColumns} FROM raw_events WHERE rowid>? AND rowid<=? ORDER BY rowid LIMIT ?`)
          .all(BigInt(cursor.examined),BigInt(tip?.position??'0'),64-headers);
        for(const row of extra){remember(row);cursor.examined=row.position;cursor.anchor=eventAnchor(row);headers++;}
        drain();
      }
      // Recovery is newest first, and only after live intervals had a chance.
      // It visits at most 64 headers total across its durable continuation.
      while(cursor.recovery&&attempts<limit&&headers<64&&performance.now()<at){
        const recovery=cursor.recovery;
        const row=db.prepare(`SELECT ${journalColumns} FROM raw_events WHERE rowid<=? ORDER BY rowid DESC LIMIT 1`).get(BigInt(recovery.before));
        if(!row||recovery.remaining===0){cursor.recovery=null;break;}
        headers++;recovery.remaining--;recovery.before=(BigInt(row.position)-1n).toString();
        const ns=eventNamespace(row);
        if(ns){const name=JSON.stringify(ns),old=cursor.active[name];
          if(old){old.position=row.position;old.anchor=eventAnchor(row);old.partOffset=0;}
          else cursor.active[name]={position:row.position,anchor:eventAnchor(row),partOffset:0,through:row.position};
          drain();
        }
        if(!recovery.remaining)cursor.recovery=null;
      }
      // Keep even completed positions anchored until their next use. They are
      // removed on the next drain, so a paused namespace retains its horizon.
      cursor.round%=options.readSet.length;
      return {cursor,rows,recovered,headers,attempts,anchors};
    },at);
  }
  const fingerprint = source => bind('raw-search-manifest-v1',source);
  // This connection is read-only for its entire lifetime. SQLite's native
  // data_version invalidates cached canonical metadata for every other-writer
  // commit, including old writers that move no application epoch. It is a
  // connection-local cache key, never a persisted authority or publication ID.
  const versionInside = () => {
    db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
    return db.prepare('PRAGMA data_version').get().data_version;
  };
  let cachedFence;
  const fencesByValue=new Map();
  const authorityRead=read;
  const version = (at=Infinity) => read(versionInside,at);
  function buildFence(expectedVersion, bounds,at=Infinity) {
    const read=work=>authorityRead(work,at);
    deadline(at);
    // Reuse only native statements within this rebuild, never their results.
    let storeProbe,changeProbe;
    read(()=>{
      storeProbe=db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1');
      changeProbe=db.prepare('PRAGMA data_version');
    });
    const versionInside=()=>{storeProbe.get();return changeProbe.get().data_version;};
    bounds??=read(()=>({conversations:db.prepare('SELECT coalesce(max(rowid),0) AS last FROM raw_conversations').get().last,
      messages:db.prepare('SELECT coalesce(max(rowid),0) AS last FROM raw_messages').get().last}));
    let remaining=50000;
    // Keyset predicates always belong to the projected rows. Never splice a
    // predicate into a projection's final JOIN condition.
    const scan=(sql,args,keys,partitions)=>{
      const columns=read(()=>db.prepare(sql).columns().map(column=>column.name));
      const quoted=columns.map(name=>'"'+name.replaceAll('"','""')+'"');
      const order=sql.match(/ ORDER BY (.+) LIMIT 50001$/s)[1].split(',').map(name=>name.split('.').at(-1));
      const positions=order.map(name=>columns.indexOf(name));
      const seek=partitions?order.slice(1):order;
      if(positions.some(index=>index<0))fail('storage_error');
      const projection=sql.replace(/ ORDER BY (.+) LIMIT 50001$/s,'');
      const pages=[];let after=null,offset=0,partitionIndex=0;
      while(true){
        if(partitions&&partitionIndex===partitions.length)break;
        const limit=Math.min(32,remaining+1);
        const batch=keys?.slice(offset,offset+limit);
        if(batch&&!batch.length){if(!pages.length||JSON.parse(pages.at(-1)).length===32)pages.push('[]');break;}
        const bounded=`SELECT * FROM (${projection}) WHERE `+
          (partitions?'conversation_id=? AND ':'')+
          (after?'('+seek.join(',')+')>('+seek.map(()=>'?').join(',')+')':'1')+
          ' ORDER BY '+order.join(',')+' LIMIT '+limit;
        const page=read(()=>{
          if(versionInside()!==expectedVersion)fail('source_changed');
          return db.prepare(`SELECT count(*) AS count,json_group_array(json_array(${quoted.join(',')})) AS rows,json_extract(json_group_array(json_array(${positions.map(index=>quoted[index]).join(',')})),'$[#-1]') AS cursor FROM (${bounded})`)
            .get(...(batch?[JSON.stringify(batch)]:[]),...args,...(partitions?[partitions[partitionIndex]]:[]),...(after?.slice(partitions?1:0)??[]));
        });
        remaining-=page.count;if(remaining<0)fail('source_budget_exceeded');
        pages.push(page.rows);
        if(batch){offset+=batch.length;if(!page.count)continue;}
        else if(page.count<limit){
          if(partitions){partitionIndex++;after=null;continue;}
          break;
        }
        after=JSON.parse(page.cursor);
      }
      return {columns,pages};
    };
    // Build membership once. Each native read advances an indexed key and
    // returns at most 32 rows; no namespace-sized CTE runs again on each page.
    // Only bound identities are retained. Unrelated rows are streamed past.
    const each=(sql,args,visit,partitions)=>{
      let after=null,partitionIndex=0;
      const order=sql.match(/ ORDER BY (.+)$/s)[1].split(',');
      const projection=sql.replace(/ ORDER BY (.+)$/s,'');
      const seek=partitions?order.slice(1):order;
      while(true){
        if(partitions&&partitionIndex===partitions.length)break;
        // Native metadata is already materialized. Cross the snapshot boundary
        // as a value string, then decode outside SHARED instead of walking
        // every row's property descriptors in the generic result validator.
        const page=JSON.parse(read(()=>{
          if(versionInside()!==expectedVersion)fail('source_changed');
          return JSON.stringify(db.prepare(`SELECT * FROM (${projection}) WHERE `+
            (after?'('+seek.join(',')+')>('+seek.map(()=>'?').join(',')+')':'1')+
            ' ORDER BY '+order.join(',')+' LIMIT 32').all(...args,...(partitions?[partitions[partitionIndex]]:[]),...(after?.slice(partitions?1:0)??[])));
        }));
        for(const row of page)visit(row);
        if(page.length<32){
          if(partitions){partitionIndex++;after=null;continue;}
          break;
        }
        after=order.map(key=>page.at(-1)[key]);
      }
    };
    const remember=(set,value)=>{set.add(value);if(set.size>50000)fail('source_budget_exceeded');};
    const append=(list,value)=>{list.push(value);if(list.length>50000)fail('source_budget_exceeded');};
    const rows=options.readSet.map(ns=>{
      const args=boundary(ns), horizon=`c.rowid<=${bounds.conversations} AND m.rowid<=${bounds.messages}`;
      // A proof keeps its original source population. Appending another message
      // cannot change that population's inputs; edits and inbound edges can.
      const roots=new Set(),events=new Set(),scopes=new Set(),owners=new Set([ns.ownerId]);
      const rootReceipts=new Set(),memories=new Set(),receiptIds=new Set(),endpoints=new Set();
      const edgeKeys=[],receiptKeys=[],exclusionKeys=[],fenceKeys=[],factKeys=[],epochKeys=[];
      const pair=(c,m)=>JSON.stringify([c,m]);
      const scope=(owner,kind,project)=>JSON.stringify([owner,kind,project]);
      // Discover conversations through the namespace's existing unique prefix.
      // Sorting their bounded identity list happens once, after releasing SHARED.
      const conversationIds=[];
      each(`SELECT client,session_key,id FROM raw_conversations WHERE ${where}
        AND rowid<=${bounds.conversations} ORDER BY client,session_key`,args,row=>append(conversationIds,row.id));
      conversationIds.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
      each(`SELECT c.id AS conversation_id,m.message_id,c.client FROM raw_conversations c
        CROSS JOIN raw_messages m ON m.conversation_id=c.id
        WHERE c.id=? AND ${horizon}
        ORDER BY conversation_id,message_id`,[],row=>{
        remember(roots,pair(row.conversation_id,row.message_id));remember(events,pair(row.client,row.message_id));
      },conversationIds);
      if(roots.size)scopes.add(scope(...args));
      each('SELECT receipt_id,conversation_id,message_id,start,end FROM raw_receipt_lineage ORDER BY receipt_id,conversation_id,message_id,start,end',[],row=>{
        if(roots.has(pair(row.conversation_id,row.message_id)))remember(rootReceipts,row.receipt_id);
      });
      each(`SELECT r.id,r.memory_id,r.client,r.event_id,m.owner_id,m.scope,m.project_id
        FROM receipts r LEFT JOIN memories m ON m.id=r.memory_id ORDER BY id`,[],row=>{
        if(rootReceipts.has(row.id)||row.owner_id===ns.ownerId&&row.scope===ns.scope&&row.project_id===args[2]&&events.has(pair(row.client,row.event_id)))
          remember(memories,row.memory_id);
      });
      each('SELECT id,memory_id FROM receipts ORDER BY id',[],row=>{
        if(memories.has(row.memory_id)){remember(receiptIds,row.id);append(receiptKeys,row.id);}
      });
      each(`SELECT l.rowid AS seek,l.receipt_id,l.conversation_id,l.message_id,l.start,l.end,c.owner_id,c.scope,c.project_id
        FROM raw_receipt_lineage l LEFT JOIN raw_conversations c ON c.id=l.conversation_id
        ORDER BY receipt_id,conversation_id,message_id,start,end`,[],row=>{
        if(receiptIds.has(row.receipt_id)||roots.has(pair(row.conversation_id,row.message_id))){
          append(edgeKeys,row.seek);
          remember(endpoints,pair(row.conversation_id,row.message_id));
          if(row.owner_id!==null){remember(scopes,scope(row.owner_id,row.scope,row.project_id));owners.add(row.owner_id);}
        }
      });
      each('SELECT id,owner_id,scope,project_id FROM memories ORDER BY id',[],row=>{
        if(memories.has(row.id)){remember(scopes,scope(row.owner_id,row.scope,row.project_id));owners.add(row.owner_id);}
      });
      each('SELECT rowid AS seek,conversation_id,message_id,start,end FROM raw_source_exclusions ORDER BY conversation_id,message_id,start,end',[],row=>{
        if(roots.has(pair(row.conversation_id,row.message_id))||endpoints.has(pair(row.conversation_id,row.message_id)))append(exclusionKeys,row.seek);
      });
      each('SELECT rowid AS seek,owner_id,scope,project_id,client,session_key FROM raw_session_fences ORDER BY owner_id,scope,project_id,client,session_key',[],row=>{
        if(scopes.has(scope(row.owner_id,row.scope,row.project_id)))append(fenceKeys,row.seek);
      });
      const has=table=>read(()=>db.prepare('SELECT 1 FROM sqlite_master WHERE name=?').get(table));
      if(has('content_suppressions'))each('SELECT owner_id,fact_id FROM content_suppressions ORDER BY owner_id,fact_id',[],row=>{
        if(owners.has(row.owner_id))append(factKeys,[row.owner_id,row.fact_id]);
      });
      if(has('owner_suppression_epochs'))each('SELECT owner_id FROM owner_suppression_epochs ORDER BY owner_id',[],row=>{
        if(owners.has(row.owner_id))append(epochKeys,row.owner_id);
      });
      const related=`WITH edges AS (SELECT l.* FROM json_each(?) seek
        CROSS JOIN raw_receipt_lineage l ON l.rowid=seek.value) `;
      const conversations=scan(`SELECT id,owner_id,scope,project_id,client,session_key FROM (
        SELECT c.id,c.owner_id,c.scope,c.project_id,c.client,c.session_key
        FROM json_each(?) seek CROSS JOIN raw_conversations c ON c.id=seek.value
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.rowid<=${bounds.conversations})
        ORDER BY id LIMIT 50001`,args,conversationIds);
      const parts=scan(`SELECT p.conversation_id,p.message_id,p.part_index,p.start,p.end,p.saved,p.digest,
        p.byte_count,p.event_id,p.reason,p.format,p.key_version,length(p.sealed) AS bytes,raw_search_sealed_digest(p.sealed) AS fingerprint,
        m.role,m.ordinal,m.occurred_at,m.total_units,m.total_bytes
        FROM raw_parts p CROSS JOIN raw_conversations c ON c.id=p.conversation_id
        JOIN raw_messages m ON m.conversation_id=p.conversation_id AND m.message_id=p.message_id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND ${horizon}
        ORDER BY p.conversation_id,p.message_id,p.part_index LIMIT 50001`,args,undefined,conversationIds);
      const exclusions=scan(`SELECT x.* FROM json_each(?) seek CROSS JOIN raw_source_exclusions x ON x.rowid=seek.value
        ORDER BY x.conversation_id,x.message_id,x.start,x.end LIMIT 50001`,[],exclusionKeys);
      const fences=scan(`SELECT f.* FROM json_each(?) seek CROSS JOIN raw_session_fences f ON f.rowid=seek.value
        ORDER BY f.owner_id,f.scope,f.project_id,f.client,f.session_key LIMIT 50001`,[],fenceKeys);
      const lineage=scan(related+`SELECT l.* FROM edges l
        ORDER BY l.receipt_id,l.conversation_id,l.message_id,l.start,l.end LIMIT 50001`,[],edgeKeys);
      // Preserve missing, foreign and other-namespace endpoints.
      const ancestors=scan(related+`SELECT l.receipt_id,l.conversation_id,l.message_id,l.start,l.end,
        c.id,c.owner_id,c.scope,c.project_id,c.client,c.session_key,m.role,m.total_units
        FROM edges l LEFT JOIN raw_conversations c ON c.id=l.conversation_id
        LEFT JOIN raw_messages m ON m.conversation_id=l.conversation_id AND m.message_id=l.message_id
        ORDER BY l.receipt_id,l.conversation_id,l.message_id,l.start,l.end LIMIT 50001`,[],edgeKeys);
      const receipts=scan(`SELECT r.*,m.id AS parent_id,m.owner_id,m.scope,m.project_id,
        m.revision,m.currentness,m.review_state,m.deleted,o.kind
        FROM json_each(?) seek CROSS JOIN receipts r ON r.id=seek.value
        LEFT JOIN memories m ON m.id=r.memory_id LEFT JOIN raw_receipt_origins o ON o.receipt_id=r.id
        ORDER BY r.id LIMIT 50001`,[],receiptKeys);
      const maps=scan(`SELECT a.* FROM raw_source_maps a CROSS JOIN raw_conversations c ON c.id=a.conversation_id
        JOIN raw_messages m ON m.conversation_id=a.conversation_id AND m.message_id=a.message_id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND ${horizon}
        ORDER BY a.conversation_id,a.message_id,a.source_key,a.start,a.end LIMIT 50001`,args,undefined,conversationIds);
      const controls=read(()=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='local_capture_controls'").get())?
        scan(`SELECT client,revision FROM local_capture_controls WHERE ${where} ORDER BY client LIMIT 50001`,args):[];
      const facts=has('content_suppressions')?
        scan(`SELECT f.* FROM json_each(?) seek CROSS JOIN content_suppressions f ON f.owner_id=json_extract(seek.value,'$[0]') AND f.fact_id=json_extract(seek.value,'$[1]')
          ORDER BY f.owner_id,f.fact_id LIMIT 50001`,[],factKeys):[];
      const suppressions=has('owner_suppression_epochs')?
        scan(`SELECT e.* FROM json_each(?) seek CROSS JOIN owner_suppression_epochs e ON e.owner_id=seek.value
          ORDER BY e.owner_id LIMIT 50001`,[],epochKeys):[];
      return {ns,conversations,parts,exclusions,fences,lineage,ancestors,receipts,maps,controls,facts,suppressions,
        pause:read(()=>db.prepare(`SELECT generation,paused,enabled FROM episode_controls WHERE ${where}`).get(...args)),
        exclusion:read(()=>db.prepare(`SELECT generation FROM raw_exclusion_clocks WHERE ${where}`).get(...args))};
    });
    const schema=scan('SELECT type,name,tbl_name,sql FROM sqlite_master WHERE 1 ORDER BY type,name LIMIT 50001',[]);
    const control=read(()=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='content_safety_control'").get())?
      scan('SELECT * FROM content_safety_control WHERE 1 ORDER BY singleton LIMIT 50001',[]):[];
    const identities=read(()=>({store:db.prepare('SELECT singleton,store_id,cursor_secret FROM store_metadata WHERE singleton=1').get(),
      episode:db.prepare('SELECT singleton,secret FROM episode_identity WHERE singleton=1').get(),
      schema:db.prepare('PRAGMA schema_version').get(),version:db.prepare('PRAGMA user_version').get(),
      application:db.prepare('PRAGMA application_id').get()}));
    // Serialize/hash after each bounded canonical snapshot has released SHARED.
    const value=bindWithin('raw-search-inventory-fence-v3',[rows,schema,control,identities],at);
    if(version(at)!==expectedVersion)fail('source_changed');
    const record={version:expectedVersion,value,bounds};
    fencesByValue.set(value,record);
    while(fencesByValue.size>512)fencesByValue.delete(fencesByValue.keys().next().value);
    return record;
  }
  function fence(expected,at=Infinity) {
    try{return fenceAt(expected,at);}catch(error){
      // Existing maintenance/direct callers keep their refusal contract.
      // Searches and ticket operations pass a finite bound and may retry.
      if(at===Infinity&&error.code==='source_changed')fail('source_unavailable');
      throw error;
    }
  }
  function fenceAt(expected,at) {
    const current=version(at);
    if(expected!==undefined){
      const record=fencesByValue.get(expected);
      if(!record)fail('source_unavailable');
      return record.version===current?record.value:buildFence(current,record.bounds,at).value;
    }
    if(cachedFence?.version!==current)cachedFence=buildFence(current,undefined,at);
    fencesByValue.set(cachedFence.value,cachedFence);
    return cachedFence.value;
  }
  function fenceInside(expected) {
    const record=fencesByValue.get(expected);
    if(!record)fail('source_unavailable');
    if(versionInside()!==record.version)throw Object.assign(new MemoryStoreError('source_changed'),{fence:expected});
    return record.value;
  }
  function checkFence(expected,at=Infinity) {
    if(fence(expected,at)!==expected)fail('source_unavailable');
    return read(()=>{if(fenceInside(expected)!==expected)fail('source_unavailable');},at);
  }
  // Immutable signed publication data may outlive canonical changes. Every
  // returned source is checked afresh, so cache keys need no canonical census.
  const cacheKey = (publication,metadata,at=Infinity) => {
    deadline(at);
    return bindWithin('raw-search-cache-key-v3-recent-union',[identity.store_id,options.ownerId,options.readSet,publication.generation,publication.sequence,publication.revision,metadata],at);
  };
  function checkInside(source,intent) {
    const next=inspectInside(source.ref,intent);
    if(!matches(source,next))fail('source_unavailable');
    return next;
  }
  function check(source,intent = 'history',at=Infinity) {
    return read(()=>checkInside(source,intent),at);
  }
  async function open(source,intent = 'history',guard = () => {}) {
    const protectedDispatch = () => { check(source,intent); guard(); check(source,intent); };
    protectedDispatch();
    // The existing reader verifies bytes/digests/AAD. Wrap its *each-part*
    // callback so a direct fence in one opener blocks the next opener too.
    const reader = createRawSourceReader({db,identity,partDigest,open:async input => {
      protectedDispatch();
      try { return await openRaw(input); }
      finally { protectedDispatch(); }
    }});
    const prepared = await reader.prepare('readRawSource',source.ref.namespace,{ source:source.ref,limit:20,
      budgets:{sourceByteLimit:64000,scanRowLimit:1024,deadlineMs:5000,responseByteLimit:65536} },1);
    protectedDispatch(); const result = prepared.finish(); check(source,intent);
    const text = result.parts.map(part => part.text).join('');
    if (result.nextCursor || text.length !== source.ref.span.end-source.ref.span.start) fail('source_unavailable');
    return text;
  }
  function validate(entries,at=Infinity,{dropDenied=false,inventoryCheckpoint,journal}={}) {
    if(dropDenied){
      entries.forEach(entry=>entry.access());
      return read(()=>{
        const values=entries.flatMap(entry=>{
          try{for(const source of entry.sources)checkInside(source,entry.intent);return [entry.value];}
          catch(error){if(!['source_unavailable','source_excluded','raw_crypto_unavailable','source_budget_exceeded'].includes(error.code))throw error;return [];}
        });
        if(!inventoryCheckpoint)return values;
        // Coverage and candidates share the final snapshot, after all authority
        // callbacks. Only maintenance builds fences: search may reuse a cached
        // full-population fence at this exact store version, never rebuild it.
        const coverageComplete=inventoryCheckpoint.coverageComplete===true&&!!cachedFence&&
          cachedFence.version===versionInside()&&inventoryCheckpoint.fence===cachedFence.value;
        return {values,coverageComplete};
      },at);
    }
    const inside=()=>{
      if(journal&&(!anchored({position:journal.cursor.examined,anchor:journal.cursor.anchor})||
          [...Object.values(journal.cursor.active),...journal.anchors].some(entry=>!anchored(entry))))fail('source_changed');
      for(const entry of entries)for(const source of entry.sources)checkInside(source,entry.intent);
    };
    // Each callback sees only its own freshly checked sources. The final
    // snapshot checks the full batch once after all callbacks have finished.
    for(const entry of entries)entry.access(()=>read(()=>{
      for(const source of entry.sources)checkInside(source,entry.intent);
    },at));
    return read(()=>{inside();return entries.map(entry=>entry.value);},at);
  }
  function reset() {cachedFence=undefined;}
  function refresh(at=Infinity) {
    deadline(at);resetContentSuppressionRequestInside(db);
  }
  return { reset,refresh,resume:()=>resumeAt,read,identity:{storeId:identity.store_id,fileIdentity:database.fileIdentity,ownerId:options.ownerId,readSet:options.readSet},
    bind,authorize,inventory,recent,disposition,queryAllowed,check,open,validate,fingerprint,fence,checkFence,cacheKey,
    inspect:(ref,intent='history')=>read(()=>inspectInside(ref,intent)) };
}

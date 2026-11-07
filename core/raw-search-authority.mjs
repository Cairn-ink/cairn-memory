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
  const deadline = at => {if(performance.now()>=at)fail('search_deadline');};
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
    try{return readTransaction(db,()=>timed(work,at));}catch(error){
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
  function inspectInside(ref,intent = 'history') {
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
      dispatch.push(inspectInside(sources.refFor(ns,anchor,full),'history'));
    }
    if (db.prepare(`SELECT 1 FROM raw_session_fences WHERE ${where} AND client=? AND session_key=?`)
      .get(...boundary(ns),view.message.client,view.message.session_key)) fail('source_unavailable');
    if (!sourceReadSafety(db,{identity:sourceIdentity,namespace:ns,ref,rawBudget:state,rawMutableRevision:false}).allowed) fail('source_unavailable');
    // A message saved before lineage registration has no complete privacy
    // ancestry proof. Schema presence alone cannot repair that old gap.
    if (!db.prepare('SELECT 1 FROM raw_source_maps WHERE conversation_id=? AND message_id=? LIMIT 1')
      .get(ref.conversationId,ref.messageId)) fail('source_unavailable');
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
    if (intent === 'current' && classification.kind === 'history-only') fail('source_unavailable');
    return { ref,manifest:view.manifest,role:view.message.role,ordinal:view.message.ordinal,occurredAt:view.message.occurred_at,
      currentness:historical ? 'historical' : unknown || !links.length ? 'unknown' : 'current',classification,
      suppression:contentSuppressionFenceInside(db,ns.ownerId),dispatch,links:links.map(row=>({receiptId:row.receipt_id,memoryId:row.id,
        revision:row.revision,start:row.start,end:row.end,precision:row.precision,currentness:row.currentness,reviewState:row.review_state})) };
  }
  function describe(part,ns) {
    const anchor = { conversationId:part.conversation_id,messageId:part.message_id,
      span:{start:part.start,end:part.end,precision:'exact'} };
    const view = sources.inspect(ns,anchor,sources.budget());
    const ref = sources.refFor(ns,anchor,view);
    return inspectInside(ref);
  }
  const matches=(source,next)=>same(source,source.canonical?rawSourceHint(next,bind):next);
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
        return { key:[part.conversation_id,part.message_id,part.part_index] };
      }
    }),complete:rows.length < limit };
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
  function cacheKeyInside(publication,metadata,at=Infinity) {
    const observed=versionInside();
    const namespaces=options.readSet.map(ns=>{
      const args=boundary(ns);
      const fences=[];let after;
      while(true){
        const page=db.prepare(`SELECT client,session_key FROM raw_session_fences WHERE ${where}`+
          (after?' AND (client,session_key)>(?,?)':'')+' ORDER BY client,session_key LIMIT 32').all(...args,...(after??[]));
        fences.push(...page);if(fences.length>50000)fail('source_budget_exceeded');
        if(page.length<32)break;after=[page.at(-1).client,page.at(-1).session_key];
      }
      return [ns,db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...args)??null,
        db.prepare(`SELECT generation FROM raw_exclusion_clocks WHERE ${where}`).get(...args)??null,
        bindWithin('raw-search-session-fences-v1',fences,at)];
    });
    return bindWithin('raw-search-cache-key-v1',[identity.store_id,options.ownerId,publication.generation,
      publication.sequence,publication.revision,metadata,contentSuppressionFenceInside(db,options.ownerId),namespaces,observed],at);
  }
  // Every key component is read in a single canonical snapshot. The final
  // delivery snapshot repeats this read, closing any scoring/provider wait.
  const cacheKey = (publication,metadata,at=Infinity) => {
    database.assertFile();
    // An optional cache check must not set the shared reader's busy backoff:
    // a failed idle check cannot manufacture an error on a later operation.
    return readTransaction(db,()=>timed(()=>cacheKeyInside(publication,metadata,at),at));
  };
  function checkInside(source,intent) {
    const next=inspectInside(source.ref,intent);
    if(!matches(source,next))fail('source_unavailable');
    return next;
  }
  function check(source,intent = 'history',at=Infinity) {
    return read(()=>checkInside(source,intent),at);
  }
  // Eligibility memoization is keyed by this read-only connection's native
  // change counter. It never bypasses per-port checks or final source checks.
  let eligibilityVersion;const eligibility=new Map();
  function selectUnit(rows,offset,observed,deadlineAt) {
    const pending=new Map(),entries=[];
    const unitStart=performance.now(),unitAt=Math.min(deadlineAt,unitStart+25);
    read(()=>{
      if(versionInside()!==observed)fail('source_changed');
      try{timed(()=>{
        while(entries.length<32&&offset+entries.length<rows.length&&performance.now()<unitAt){
          deadline(deadlineAt);
          const row=rows[offset+entries.length],key=row.source.canonical??fingerprint(row.source);
          let entry=eligibility.get(key);
          if(!entry){
            try{const next=checkInside(row.source,'history');entry={classification:next.classification};}
            catch(error){if(!['source_unavailable','source_excluded','raw_crypto_unavailable'].includes(error.code))throw error;
              entry={denied:true};}
            if(!entry.denied)pending.set(key,entry);
          }
          entries.push({row,entry});
        }
      },unitAt);}catch(error){
        // A time slice may interrupt the next row. Its incomplete check is
        // retried in a fresh snapshot; only fully checked rows leave this unit.
        if(error.code!=='search_deadline')throw error;
        deadline(deadlineAt);
      }
    },deadlineAt);
    const unitHoldMs=performance.now()-unitStart;
    if(version(deadlineAt)!==observed)fail('source_changed');
    return {entries,pending,unitHoldMs};
  }
  function select(rows,intent,deadlineAt) {
    const observed=version(deadlineAt);
    const pending=new Map();
    if(eligibilityVersion!==observed){eligibility.clear();eligibilityVersion=observed;}
    const eligible=[];let denied=0,timedOut=false,offset=0;
    while(offset<rows.length){
      if(performance.now()>=deadlineAt){timedOut=true;break;}
      const unit=selectUnit(rows,offset,observed,deadlineAt);
      // The unit ended at this version. Later expiry cannot tear these checks.
      for(const [key,entry] of unit.pending){eligibility.set(key,entry);pending.set(key,entry);}
      for(const {row,entry} of unit.entries){
        if(entry.denied||intent==='current'&&entry.classification.kind==='history-only')denied++;
        else eligible.push(row);
      }
      offset+=unit.entries.length;
    }
    if(version(deadlineAt)!==observed)fail('source_changed');
    return {eligible,denied,timedOut,version:observed,commit(check=()=>{}){for(const [key,entry] of pending){check();eligibility.set(key,entry);}check();}};
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
  function validate(entries,at=Infinity) {
    // Refresh commitments without holding one population-sized read snapshot.
    for(const entry of entries)if(entry.fence)checkFence(entry.fence,at);
    // Host callbacks precede the final snapshot. Complete commitments cover
    // aggregate-only dependencies; exact output contributors still run the full predicate.
    const inside = (predicates = true) => {
      for (const entry of entries) {
        if(entry.fence&&fenceInside(entry.fence)!==entry.fence)fail('source_unavailable');
        if(entry.version!==undefined&&versionInside()!==entry.version)throw Object.assign(new MemoryStoreError('source_changed'),{fence:entry.fence});
        if(entry.cache && cacheKeyInside(entry.cache.publication,entry.cache.metadata,at)!==entry.cache.key)fail('source_unavailable');
        // Without a complete commitment, every dependency remains mandatory.
        for (const source of predicates || !entry.fence ? entry.sources : [])
        if (!matches(source,inspectInside(source.ref,entry.intent))) fail('source_unavailable');
      }
    };
    const checkAll = () => read(()=>inside(false),at);
    entries.forEach(entry => entry.access(checkAll));
    return read(() => {
      inside();
      return entries.map(entry => entry.value);
    },at);
  }
  function reset({keepCommitment=false,keepEligibility=false}={}) {
    if(!keepCommitment)cachedFence=undefined;
    if(!keepEligibility){eligibility.clear();eligibilityVersion=undefined;}
  }
  function refresh(at=Infinity) {
    deadline(at);resetContentSuppressionRequestInside(db);
  }
  return { reset,refresh,resume:()=>resumeAt,read,identity:{storeId:identity.store_id,fileIdentity:database.fileIdentity,ownerId:options.ownerId,readSet:options.readSet},
    bind,authorize,inventory,check,select,open,validate,fingerprint,fence,checkFence,cacheKey,
    inspect:(ref,intent='history')=>read(()=>inspectInside(ref,intent)) };
}

import { performance } from 'node:perf_hooks';
import { createHash, createHmac } from 'node:crypto';
import { readTransaction, isStorageBusy } from './database.mjs';
import { installedContentLayout } from './content-safety-schema.mjs';
import { contentSuppressionFenceInside } from './content-suppression-storage.mjs';
import { sourceReadSafety } from './content-safety.mjs';
import { createCardRawSources } from './card-raw-sources.mjs';
import { createRawSourceReader } from './raw-source-reader.mjs';
import { rawSourceRef } from './raw-source-input.mjs';
import { verifyPrivateGrant } from './private-card-facade.mjs';
import { contentAuthorityPort } from './content-safety-boundary.mjs';
import { fail } from './validation.mjs';
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
  const read = work => {
    database.assertFile();
    if(performance.now()<resumeAt)fail('source_unavailable');
    try{return readTransaction(db,work);}catch(error){
      // A pending writer makes a fresh SHARED acquisition busy. Abandon the
      // quantum instead of waiting or repeatedly reacquiring ahead of capture.
      if(isStorageBusy(error)){resumeAt=performance.now()+25;fail('source_unavailable');}
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
  const sourceIdentity = { storeId: identity.store_id, cursorSecret: identity.cursor_secret };
  const sources = createCardRawSources(db,sourceIdentity);
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
    if (!sourceReadSafety(db,{identity:sourceIdentity,namespace:ns,ref,rawBudget:state}).allowed) fail('source_unavailable');
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
  const version = () => read(versionInside);
  function buildFence(expectedVersion) {
    let remaining=50000;
    const scan=(sql,args)=>{
      const columns=read(()=>db.prepare(sql).columns().map(column=>column.name));
      const quoted=columns.map(name=>'"'+name.replaceAll('"','""')+'"');
      const order=sql.match(/ ORDER BY (.+) LIMIT 50001$/s)[1].split(',');
      const positions=order.map(name=>columns.indexOf(name.split('.').at(-1)));
      if(positions.some(index=>index<0))fail('storage_error');
      const pages=[];let after=null;
      while(true){
        const limit=Math.min(32,remaining+1);
        const bounded=sql.replace(' ORDER BY ',(after?' AND ('+order.join(',')+')>('+order.map(()=>'?').join(',')+')':'')+' ORDER BY ')
          .replace('LIMIT 50001','LIMIT '+limit);
        const page=read(()=>{
          if(versionInside()!==expectedVersion)fail('source_unavailable');
          // Native JSON materialization avoids thousands of JS row objects
          // while a canonical SHARED lock is held. All selected values remain.
          return db.prepare(`SELECT count(*) AS count,json_group_array(json_array(${quoted.join(',')})) AS rows FROM (${bounded})`).get(...args,...after??[]);
        });
        remaining-=page.count;if(remaining<0)fail('source_budget_exceeded');
        pages.push(page.rows);if(page.count<limit)break;
        const last=JSON.parse(page.rows).at(-1);after=positions.map(index=>last[index]);
      }
      return {columns,pages};
    };
    const rows=options.readSet.map(ns=>{
      const args=boundary(ns);
      const conversations=scan(`SELECT id,revision,client,session_key FROM raw_conversations WHERE ${where} ORDER BY id LIMIT 50001`,args);
      const parts=scan(`SELECT p.conversation_id,p.message_id,p.part_index,p.start,p.end,p.saved,p.digest,
        p.byte_count,p.event_id,p.reason,p.format,p.key_version,length(p.sealed) AS bytes,raw_search_sealed_digest(p.sealed) AS fingerprint,
        m.role,m.ordinal,m.occurred_at,m.total_units,m.total_bytes
        FROM raw_parts p CROSS JOIN raw_conversations c ON c.id=p.conversation_id
        JOIN raw_messages m ON m.conversation_id=p.conversation_id AND m.message_id=p.message_id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? ORDER BY p.conversation_id,p.message_id,p.part_index LIMIT 50001`,args);
      const exclusions=scan(`SELECT x.* FROM raw_source_exclusions x JOIN raw_conversations c ON c.id=x.conversation_id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? ORDER BY x.conversation_id,x.message_id,x.start,x.end LIMIT 50001`,args);
      const fences=scan(`SELECT client,session_key FROM raw_session_fences WHERE ${where} ORDER BY client,session_key LIMIT 50001`,args);
      const lineage=scan(`SELECT l.*,m.currentness,m.deleted,o.kind FROM raw_receipt_lineage l
        JOIN raw_conversations c ON c.id=l.conversation_id
        LEFT JOIN receipts r ON r.id=l.receipt_id LEFT JOIN memories m ON m.id=r.memory_id
        LEFT JOIN raw_receipt_origins o ON o.receipt_id=l.receipt_id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? ORDER BY l.receipt_id,l.conversation_id,l.message_id,l.start,l.end LIMIT 50001`,args);
      const receipts=scan(`SELECT r.id,r.memory_id,r.client,r.session_id,r.event_id,r.role,r.receipt_key,
        m.revision,m.currentness,m.review_state,m.deleted,o.kind FROM receipts r JOIN memories m ON m.id=r.memory_id
        LEFT JOIN raw_receipt_origins o ON o.receipt_id=r.id WHERE m.owner_id=? AND m.scope=? AND m.project_id=? ORDER BY r.id LIMIT 50001`,args);
      const maps=scan(`SELECT a.* FROM raw_source_maps a JOIN raw_conversations c ON c.id=a.conversation_id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? ORDER BY a.conversation_id,a.message_id,a.source_key,a.start,a.end LIMIT 50001`,args);
      const controls=read(()=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='local_capture_controls'").get())?
        scan(`SELECT client,revision FROM local_capture_controls WHERE ${where} ORDER BY client LIMIT 50001`,args):[];
      const facts=read(()=>db.prepare("SELECT 1 FROM sqlite_master WHERE name='content_suppressions'").get())?
        scan('SELECT * FROM content_suppressions WHERE owner_id=? ORDER BY fact_id LIMIT 50001',[ns.ownerId]):[];
      return {ns,conversations,parts,exclusions,fences,lineage,receipts,maps,controls,facts,suppression:read(()=>contentSuppressionFenceInside(db,ns.ownerId)),
        epoch:read(()=>db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...args)),
        exclusion:read(()=>db.prepare(`SELECT generation FROM raw_exclusion_clocks WHERE ${where}`).get(...args))};
    });
    // Hashing and serialization happen after every canonical lock is released.
    const value=bind('raw-search-inventory-fence-v2',rows);
    if(version()!==expectedVersion)fail('source_unavailable');
    cachedFence={version:expectedVersion,value};return value;
  }
  function fence() {
    const current=version();
    return cachedFence?.version===current?cachedFence.value:buildFence(current);
  }
  function fenceInside() {
    if(!cachedFence||versionInside()!==cachedFence.version)fail('source_unavailable');
    return cachedFence.value;
  }
  const checkFence = expected => read(() => { if(fenceInside()!==expected)fail('source_unavailable'); });
  function cacheKeyInside(publication,metadata) {
    const observed=versionInside();
    const namespaces=options.readSet.map(ns=>{
      const args=boundary(ns);
      const fences=db.prepare(`SELECT client,session_key FROM raw_session_fences WHERE ${where} ORDER BY client,session_key LIMIT 50001`).all(...args);
      if(fences.length>50000)fail('source_budget_exceeded');
      return [ns,db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...args)??null,
        db.prepare(`SELECT generation FROM raw_exclusion_clocks WHERE ${where}`).get(...args)??null,
        bind('raw-search-session-fences-v1',fences)];
    });
    return bind('raw-search-cache-key-v1',[identity.store_id,options.ownerId,publication.generation,
      publication.sequence,publication.revision,metadata,contentSuppressionFenceInside(db,options.ownerId),namespaces,observed]);
  }
  // Every key component is read in a single canonical snapshot. The final
  // delivery snapshot repeats this read, closing any scoring/provider wait.
  const cacheKey = (publication,metadata) => {
    database.assertFile();
    // An optional cache check must not set the shared reader's busy backoff:
    // a failed idle check cannot manufacture an error on a later operation.
    return readTransaction(db,()=>cacheKeyInside(publication,metadata));
  };
  function check(source,intent = 'history') {
    return read(() => {
      const next = inspectInside(source.ref,intent);
      if (!matches(source,next)) fail('source_unavailable');
      return next;
    });
  }
  // Eligibility memoization is keyed by this read-only connection's native
  // change counter. It never bypasses per-port checks or final source checks.
  let eligibilityVersion;const eligibility=new Map();
  function select(rows,intent,deadlineAt) {
    const observed=version();
    if(eligibilityVersion!==observed){eligibility.clear();eligibilityVersion=observed;}
    const eligible=[];let denied=0,timedOut=false;
    for(const row of rows){
      if(performance.now()>=deadlineAt){timedOut=true;break;}
      const key=row.source.canonical??fingerprint(row.source);
      let entry=eligibility.get(key);
      if(!entry){
        try{const next=check(row.source);entry={classification:next.classification};}
        catch(error){if(!['source_unavailable','source_excluded','raw_crypto_unavailable'].includes(error.code))throw error;
          entry={denied:true};}
        if(!entry.denied)eligibility.set(key,entry);
      }
      if(entry.denied||intent==='current'&&entry.classification.kind==='history-only')denied++;
      else eligible.push(row);
    }
    if(version()!==observed)fail('source_unavailable');
    return {eligible,denied,timedOut};
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
  function validate(entries) {
    // All host callbacks run first, then one deferred canonical snapshot.
    const inside = () => {
      let observed;
      for (const entry of entries) {
        if(entry.cache && cacheKeyInside(entry.cache.publication,entry.cache.metadata)!==entry.cache.key)fail('source_unavailable');
        if(entry.fence){observed??=fenceInside();if(observed!==entry.fence)fail('source_unavailable');}
        // A full keyed canonical inventory binds *all* contributor identities,
        // bytes and denial facts. Materialized ranges additionally rerun the
        // existing exact-source predicate in this same snapshot.
        for (const source of entry.fence ? entry.materialized ?? [] : entry.sources)
        if (!matches(source,inspectInside(source.ref,entry.intent))) fail('source_unavailable');
      }
    };
    const checkAll = () => read(inside);
    entries.forEach(entry => entry.access(checkAll));
    return read(() => {
      inside();
      return entries.map(entry => entry.value);
    });
  }
  return { read,identity:{storeId:identity.store_id,fileIdentity:database.fileIdentity,ownerId:options.ownerId,readSet:options.readSet},
    bind,authorize,inventory,check,select,open,validate,fingerprint,fence,checkFence,cacheKey,
    inspect:(ref,intent='history')=>read(()=>inspectInside(ref,intent)) };
}

import { sourceReadSafety } from './content-safety.mjs';
import { createHmac } from 'node:crypto';
import { cardText, keyed } from './private-card-input.mjs';
import { createCardRawSources } from './card-raw-sources.mjs';
import { createRawLineageStorage } from './raw-lineage-storage.mjs';
import { reserveContentIdentityInside, contentSuppressionReasonInside } from './content-suppression-storage.mjs';
import { cachedContentLayout, cardLineageRevision } from './content-safety-schema.mjs';
import { fail } from './validation.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
const publicNamespace = row => ({ ownerId: row.owner_id, scope: row.scope, projectId: row.project_id || null });
const positive = n => Number.isSafeInteger(n) && n > 0;
export const hasCardLineage = db => cardLineageRevision(cachedContentLayout(db)) === 1;
export const lineageHmac = (identity, purpose, tuple) => createHmac('sha256', identity.cursorSecret)
  .update(JSON.stringify([purpose, tuple])).digest('hex');
const sourceTuple = s => [{ownerId:s.owner_id,scope:s.source_scope,projectId:s.source_project||null},
  s.source_kind,s.source_key,s.source_incarnation,JSON.parse(s.source_version),s.content_identity];
const sourceKey = s => JSON.stringify(sourceTuple(s).slice(0,5));
const sorted = sources => sources.map(sourceTuple).sort((a,b) => Buffer.compare(Buffer.from(JSON.stringify(a)),Buffer.from(JSON.stringify(b))));
const wrap = (identity, ns, kind, key, version, value) => lineageHmac(identity,'card-source-s2-v1',
  [identity.storeId,ns,kind,key,version,value]);
const bind = (identity, purpose, value) => keyed(identity.cursorSecret,purpose,[identity.storeId,value]);
export const cardBodyDigest = (identity, ns, row) => lineageHmac(identity,'card-body-s2-v1',
  [identity.storeId,ns,row.id,row.body_revision,row.title,row.body]);
const parentDigest = (identity,ns,row) => lineageHmac(identity,'card-parent-s2-v1',
  [identity.storeId,ns,row.id,row.content,row.fingerprint]);
function strictTextBytes(db,table,id,fields) {
  const row=db.prepare(`SELECT ${fields.map(field=>`hex(CAST(${field} AS BLOB)) AS ${field}`).join(',')} FROM ${table} WHERE id=?`).get(id);
  if(!row)fail('source_unavailable');
  for(const field of fields) {
    const bytes=Buffer.from(row[field],'hex');
    try { const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!Buffer.from(text).equals(bytes))fail('source_unavailable'); }
    catch { fail('source_unavailable'); }
  }
}
const provenanceDigest = (identity,ns,h,sources) => lineageHmac(identity,'card-provenance-s2-v1',
  [identity.storeId,ns,h.card_id,h.body_revision,h.provenance_revision,h.body_digest,h.completeness,
    h.origin,h.authorization_action,sorted(sources)]);

// Decode the actual SQLite bytes. A TEXT decoder's replacement characters must
// never turn corrupt bytes into a different body with a valid commitment.
export function exactCardInside(db, ns, id) {
  const row = db.prepare(`SELECT *,hex(CAST(title AS BLOB)) AS title_utf8,
    hex(CAST(body AS BLOB)) AS body_utf8 FROM private_cards WHERE ${where} AND id=?`).get(...boundary(ns),id);
  if (!row) fail('source_unavailable');
  for (const [field,limit] of [['title',200],['body',20000]]) {
    const bytes = Buffer.from(row[field+'_utf8'],'hex');
    let text; try { text = new TextDecoder('utf-8',{fatal:true}).decode(bytes); } catch { fail('source_unavailable'); }
    if (!Buffer.from(text).equals(bytes) || text !== row[field] || cardText(text,limit) !== text) fail('source_unavailable');
  }
  return row;
}
export function cardLineageStampInside(db, ns, id) {
  if (!hasCardLineage(db)) return null;
  const h = db.prepare(`SELECT body_revision,provenance_revision,body_digest,provenance_digest FROM card_body_provenance
    WHERE ${where} AND card_id=? ORDER BY body_revision DESC,provenance_revision DESC LIMIT 1`).get(...boundary(ns),id);
  return h ? [h.body_revision,h.provenance_revision,h.body_digest,h.provenance_digest] : null;
}
export function cardLineageItemInside(db,item) {
  return hasCardLineage(db)&&item.type==='card' ? [item,cardLineageStampInside(db,item.ref.namespace,item.ref.cardId)] : item;
}
export function cardLineageNamespaceInside(db,ns) {
  if(!hasCardLineage(db))return {};
  const rows=db.prepare(`SELECT card_id,body_revision,provenance_revision,body_digest,provenance_digest
    FROM card_body_provenance WHERE ${where} ORDER BY card_id,body_revision,provenance_revision LIMIT 4097`).all(...boundary(ns));
  if(rows.length>4096||Buffer.byteLength(JSON.stringify(rows))>8*1024*1024)fail('source_budget_exceeded');
  const identity=db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const pointers=db.prepare(`SELECT id,revision,body_revision,state FROM private_cards WHERE ${where} ORDER BY id LIMIT 4097`).all(...boundary(ns));
  if(pointers.length>4096)fail('source_budget_exceeded');
  return {lineage:lineageHmac(identity,'card-publication-s2-v1',[identity.storeId,ns,rows,pointers])};
}
const headers = (db,ns,id) => db.prepare(`SELECT * FROM card_body_provenance WHERE ${where}
  AND card_id=? ORDER BY body_revision DESC,provenance_revision DESC LIMIT 1`).get(...boundary(ns),id);
const sourcesFor = (db,ns,id,revision) => db.prepare(`SELECT * FROM card_body_sources WHERE ${where}
  AND card_id=? AND body_revision=? LIMIT 257`).all(...boundary(ns),id,revision);
function bounded(sources) {
  if (sources.length > 256 || Buffer.byteLength(JSON.stringify(sources)) > 65536) fail('source_budget_exceeded');
}
function source(identity, ns, kind, key, version, content, evidenceOrigin = 'writer', evidence) {
  return { owner_id:ns.ownerId,source_scope:ns.scope,source_project:ns.projectId??'',source_kind:kind,source_key:key,source_incarnation:key,
    source_version:JSON.stringify(version),content_identity:content,evidence_origin:evidenceOrigin,
    evidence_digest:lineageHmac(identity,'card-source-evidence-s2-v1',[identity.storeId,ns,kind,key,version,evidence??content]) };
}

/** Complete canonical input closure. No caller supplies completeness or ancestry. */
export function collectCardBodySourcesInside(db, identity, ns, refs, validateSource) {
  const values = new Map(), raw = createCardRawSources(db,identity), budget = raw.budget();
  const add = s => { const k=sourceKey(s),old=values.get(k); if(old && old.content_identity!==s.content_identity)fail('source_unavailable'); values.set(k,s); bounded([...values.values()]); };
  function rawSource(ref, origin='writer') {
    const view=raw.resolve(ns,ref,budget), parts=view.parts.map(p=>p.part_index).sort((a,b)=>a-b);
    const version=['raw-span-v1',ref.messageId,ref.span.start,ref.span.end,ref.span.precision,parts];
    add(source(identity,ns,'raw',ref.conversationId,version,wrap(identity,ns,'raw',ref.conversationId,version,ref.contentIdentity),origin));
  }
  for(const ref of refs) {
    if(!validateSource(ref))fail('source_unavailable');
    if(ref.type==='raw'){rawSource(ref);continue;}
    if(ref.type==='submitted-note') {
      const version=['note-v1',ref.revision];
      add(source(identity,ns,ref.type,ref.sourceId,version,wrap(identity,ns,ref.type,ref.sourceId,version,ref.contentIdentity)));continue;
    }
    if(ref.type!=='receipt')fail('source_unavailable');
    const parent=db.prepare(`SELECT * FROM memories WHERE ${where} AND id=?`).get(...boundary(ns),ref.memoryId);
    if(!parent || parent.deleted)fail('source_unavailable');
    strictTextBytes(db,'memories',parent.id,['content','fingerprint']);
    const parentCommit=parentDigest(identity,ns,parent);
    add(source(identity,ns,'memory',parent.id,['memory-revision-v1',ref.memoryRevision],parentCommit,'receipt-ancestry'));
    const version=['receipt-v1',parent.id,ref.memoryRevision,parentCommit];
    add(source(identity,ns,'receipt',ref.receiptId,version,wrap(identity,ns,'receipt',ref.receiptId,version,ref.contentIdentity)));
    if(cachedContentLayout(db)?.rawLineage) {
      // Include every applicable ancestor of the bound Memory, not just the
      // selected receipt. Unknown origin is an error rather than an empty set.
      const receipts=db.prepare('SELECT * FROM receipts WHERE memory_id=? LIMIT 257').all(parent.id);
      if(receipts.length>256)fail('source_budget_exceeded');
      const targets=[];
      createRawLineageStorage(db).assertStoredReceipts(ns,receipts,{readExisting:true,rawTargets:targets});
      for(const r of receipts)targets.push(...db.prepare(`SELECT conversation_id AS conversationId,message_id AS messageId,
        start,end,precision FROM raw_receipt_lineage WHERE receipt_id=? LIMIT 257`).all(r.id));
      for(const target of targets) {
        const anchor={conversationId:target.conversationId,messageId:target.messageId,
          span:{start:target.start,end:target.end,precision:target.precision}};
        rawSource(raw.refFor(ns,anchor,raw.inspect(ns,anchor,budget)),'receipt-ancestry');
      }
    }
  }
  return [...values.values()];
}
function reserveSources(db, ns, sources, origin='writer') {
  for(const s of sources) {
    reserveContentIdentityInside(db,ns,s.source_kind,s.source_key,s.source_incarnation,origin);
    const version=JSON.parse(s.source_version);
    if(s.source_kind==='raw' && version[0]==='raw-span-v1') {
      reserveContentIdentityInside(db,ns,'raw-message',JSON.stringify([s.source_key,version[1]]),s.source_key,origin);
      for(const part of version[5])reserveContentIdentityInside(db,ns,'raw-part',JSON.stringify([s.source_key,version[1],part]),s.source_key,origin);
    }
  }
}

/** One append/seal path, shared by every authored writer and offline seeding. */
export function sealCardBodyInside(db, {identity,namespace:ns,cardId,sources,newBody=false,authorization=null,legacy=false}) {
  if(!db.isTransaction)fail('storage_error');
  const row=exactCardInside(db,ns,cardId),previous=headers(db,ns,cardId);
  if(!positive(row.body_revision) || previous && (newBody ? row.body_revision<=previous.body_revision : row.body_revision!==previous.body_revision))fail('source_unavailable');
  const prior=previous&&!newBody?verifyCardLineageCommitmentsInside(db,identity,ns,cardId):null;
  const old=prior?.sources??[];
  bounded(old); bounded(sources);
  const keys=new Map(old.map(s=>[sourceKey(s),s]));
  const added=sources.filter(s=>{
    const prior=keys.get(sourceKey(s));
    if(prior && prior.content_identity!==s.content_identity)fail('source_unavailable');
    if(prior)return false;keys.set(sourceKey(s),s);return true;
  });
  if(previous&&!newBody&&!added.length) {
    if(previous.completeness==='complete')validateCardBodySourcesInside(db,identity,ns,old,{validateSource:ref=>sourceReadSafety(db,{identity,namespace:ns,ref}).allowed});
    return previous;
  }
  const provenanceRevision=previous&&!newBody?previous.provenance_revision+1:1;
  if(!positive(provenanceRevision))fail('source_budget_exceeded');
  const all=[...old,...added.map(s=>({...s,added_revision:provenanceRevision}))];bounded(all);
  const own=authorization&&authorization.authorization_kind!=='operation';
  const header={card_id:cardId,body_revision:row.body_revision,provenance_revision:provenanceRevision,
    body_digest:cardBodyDigest(identity,ns,row),completeness:legacy?'unknown':previous&&!newBody?previous.completeness:'complete',
    origin:legacy?'legacy-unknown':previous&&!newBody&&previous.origin==='legacy-unknown'?'legacy-unknown':all.length?'derived':'user-authored',
    authorization_action:previous&&!newBody?previous.authorization_action:own?authorization.host_action_id:null};
  if(header.completeness==='complete'&&!all.length&&!own&&!(previous&&!newBody&&previous.authorization_action))fail('authority_required');
  if(previous&&!newBody&&header.body_digest!==previous.body_digest)fail('source_unavailable');
  if(header.completeness==='complete')validateCardBodySourcesInside(db,identity,ns,all,{current:newBody,
    validateSource:ref=>sourceReadSafety(db,{identity,namespace:ns,ref}).allowed});
  reserveContentIdentityInside(db,ns,'card',cardId,cardId,legacy?'canonical-edge':'writer');
  reserveSources(db,ns,added,legacy?'canonical-edge':'writer');
  const insert=db.prepare(`INSERT INTO card_body_sources VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
  for(const s of added)insert.run(...boundary(ns),cardId,row.body_revision,s.source_scope,s.source_project,s.source_kind,
    s.source_key,s.source_incarnation,s.source_version,s.content_identity,provenanceRevision,s.evidence_origin,s.evidence_digest);
  const digest=provenanceDigest(identity,ns,header,all);
  db.prepare(`INSERT INTO card_body_provenance VALUES(?,?,?,'card',?,?,?,?,?,?,?,?,?)`).run(...boundary(ns),
    cardId,row.body_revision,provenanceRevision,header.body_digest,digest,header.completeness,header.origin,all.length,header.authorization_action);
  return {...header,provenance_digest:digest,source_count:all.length};
}

export function verifyCardLineageCommitmentsInside(db,identity,ns,cardId) {
  const row=exactCardInside(db,ns,cardId),h=headers(db,ns,cardId);
  if(!h||h.body_revision!==row.body_revision)fail('source_unavailable');
  const sources=sourcesFor(db,ns,cardId,row.body_revision);bounded(sources);
  if(h.source_count!==sources.length||cardBodyDigest(identity,ns,row)!==h.body_digest||
      provenanceDigest(identity,ns,h,sources)!==h.provenance_digest)fail('source_unavailable');
  return {row,header:h,sources};
}
/** Verify latest body/header and exact commitments before any source decisions. */
export function loadCardBodyContributorsInside(db, identity, ns, cardId, {validateSource,current=false}={}) {
  const {row,header:h,sources}=verifyCardLineageCommitmentsInside(db,identity,ns,cardId);
  if(h.completeness!=='complete')fail('source_unavailable');
  if(h.authorization_action) {
    const a=db.prepare('SELECT * FROM card_body_authorizations WHERE owner_id=? AND host_action_id=?').get(ns.ownerId,h.authorization_action);
    if(!a||a.scope!==ns.scope||a.project_id!==(ns.projectId??'')||a.card_id!==cardId||a.body_revision!==row.body_revision||
      a.body_digest!==h.body_digest||a.authorization_kind==='operation'||!a.actor_id||!a.authorized_at)fail('source_unavailable');
    const op=db.prepare('SELECT * FROM card_operations WHERE owner_id=? AND action_id=?').get(ns.ownerId,h.authorization_action);
    if(!op||op.scope!==ns.scope||op.project_id!==(ns.projectId??'')||op.method!==a.method||op.target_id!==cardId||
      a.payload_binding!==lineageHmac(identity,'card-action-audit-s2-v1',[identity.storeId,ns.ownerId,h.authorization_action,op.payload_binding]))fail('source_unavailable');
    const result=JSON.parse(op.result);
    if(result.id!==cardId||result.bodyRevision!==row.body_revision)fail('source_unavailable');
  }
  if(!sources.length&&(h.origin!=='user-authored'||!h.authorization_action))fail('source_unavailable');
  const refs=validateCardBodySourcesInside(db,identity,ns,sources,{validateSource,current});
  return {row,header:h,sources,refs,stamp:[h.body_revision,h.provenance_revision,h.body_digest,h.provenance_digest]};
}

function validateCardBodySourcesInside(db,identity,ns,sources,{validateSource,current=false}) {
  const refs=[], raw=createCardRawSources(db,identity), budget=raw.budget();
  for(const s of sources) {
    if(s.source_scope!==ns.scope||s.source_project!==(ns.projectId??'')||s.source_key!==s.source_incarnation||!s.content_identity)fail('source_unavailable');
    const v=JSON.parse(s.source_version), target={kind:s.source_kind,key:s.source_key,version:s.source_version,
      revision:v[0]==='memory-revision-v1'||v[0]==='note-v1'?v[1]:v[0]==='receipt-v1'?v[2]:undefined,
      ...(v[0]==='raw-span-v1'?{messageId:v[1],start:v[2],end:v[3]}:{})};
    if(JSON.stringify(v)!==s.source_version||contentSuppressionReasonInside(db,ns,target))fail('source_unavailable');
    let ref;
    if(s.source_kind==='memory') {
      if(v.length!==2||v[0]!=='memory-revision-v1'||!positive(v[1]))fail('source_unavailable');
      const m=db.prepare(`SELECT * FROM memories WHERE ${where} AND id=?`).get(...boundary(ns),s.source_key);
      if(!m||m.deleted||parentDigest(identity,ns,m)!==s.content_identity||current&&(m.currentness!=='current'||m.review_state==='awaiting'))fail('source_unavailable');
      strictTextBytes(db,'memories',m.id,['content','fingerprint']);
      continue;
    }
    if(s.source_kind==='receipt') {
      if(v.length!==4||v[0]!=='receipt-v1'||!positive(v[2]))fail('source_unavailable');
      const m=sources.find(a=>a.source_kind==='memory'&&a.source_key===v[1]&&a.source_version===JSON.stringify(['memory-revision-v1',v[2]])&&a.content_identity===v[3]);
      const r=db.prepare('SELECT * FROM receipts WHERE memory_id=? AND id=?').get(v[1],s.source_key);
      if(!m||!r)fail('source_unavailable');
      strictTextBytes(db,'receipts',r.id,['client','session_id','event_id','role','excerpt']);
      ref={type:'receipt',namespace:ns,memoryId:v[1],memoryRevision:v[2],receiptId:r.id,completeness:'excerpt-only',
        contentIdentity:bind(identity,'retained-receipt-content-v1',[ns,v[1],v[2],r.id,r.client,r.session_id,r.event_id,r.role,r.excerpt])};
      if(wrap(identity,ns,'receipt',r.id,v,ref.contentIdentity)!==s.content_identity)fail('source_unavailable');
    } else if(s.source_kind==='submitted-note') {
      if(v.length!==2||v[0]!=='note-v1'||!positive(v[1]))fail('source_unavailable');
      const n=db.prepare(`SELECT * FROM card_notes WHERE ${where} AND id=?`).get(...boundary(ns),s.source_key);
      if(!n)fail('source_unavailable');
      strictTextBytes(db,'card_notes',n.id,['text']);
      ref={type:'submitted-note',namespace:ns,sourceId:n.id,revision:v[1],completeness:'provided-note',
        contentIdentity:bind(identity,'submitted-note-content-v1',[ns,n.id,v[1],n.text])};
      if(wrap(identity,ns,'submitted-note',n.id,v,ref.contentIdentity)!==s.content_identity)fail('source_unavailable');
    } else if(s.source_kind==='raw') {
      if(v.length!==6||v[0]!=='raw-span-v1'||!Array.isArray(v[5]))fail('source_unavailable');
      const anchor={conversationId:s.source_key,messageId:v[1],span:{start:v[2],end:v[3],precision:v[4]}};
      const view=raw.inspect(ns,anchor,budget);
      if(JSON.stringify(view.parts.map(p=>p.part_index).sort((a,b)=>a-b))!==JSON.stringify(v[5]))fail('source_unavailable');
      ref=raw.refFor(ns,anchor,view);
      if(wrap(identity,ns,'raw',s.source_key,v,ref.contentIdentity)!==s.content_identity)fail('source_unavailable');
    } else fail('source_unavailable');
    if(validateSource&&!validateSource(ref))fail('source_unavailable');
    refs.push(ref);
  }
  if(validateSource&&refs.length) {
    const expected=collectCardBodySourcesInside(db,identity,ns,refs,()=>true);
    if(expected.some(s=>!sources.some(bound=>sourceKey(bound)===sourceKey(s)&&bound.content_identity===s.content_identity)))fail('source_unavailable');
  }
  return refs;
}

/** Owner-wide claims precede the legacy namespaced operation lookup. */
export function checkCardActionInside(db,identity,ns,method,input,payloadBinding,audit) {
  if(!audit)fail('authority_required');
  const old=db.prepare('SELECT * FROM card_body_authorizations WHERE owner_id=? AND host_action_id=?').get(ns.ownerId,input.actionId);
  const receipt=db.prepare('SELECT * FROM card_operations WHERE owner_id=? AND action_id=?').get(ns.ownerId,input.actionId);
  const target=input.cardId??input.mappingId??input.mocId??input.topicRef?.mocId??input.sourceId??input.actionId;
  const binding=lineageHmac(identity,'card-action-audit-s2-v1',[identity.storeId,ns.ownerId,input.actionId,payloadBinding]);
  if(receipt&&!old||old&&(!receipt||old.scope!==ns.scope||old.project_id!==(ns.projectId??'')||old.method!==method||
    old.request_target!==target||old.actor_id!==audit.actorId||old.authorization_kind!==audit.authorizationKind||old.payload_binding!==binding||receipt.method!==method||
    receipt.payload_binding!==payloadBinding||receipt.scope!==ns.scope||receipt.project_id!==(ns.projectId??'')))fail('action_conflict');
  return {old,claim:{owner_id:ns.ownerId,host_action_id:input.actionId,scope:ns.scope,project_id:ns.projectId??'',method,
    request_target:target,actor_id:audit.actorId,authorized_at:audit.authorizedAt,payload_binding:binding,
    authorization_kind:'operation',card_id:null,body_revision:null,body_digest:null}};
}
export function recordCardActionInside(db, claim) {
  db.prepare('INSERT INTO card_body_authorizations VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)').run(...Object.values(claim));
}

export function legacyCardSources(identity, observation) {
  const seen=new Map();
  for(const edge of observation.edges) {
    const id=edge.identity,ns={ownerId:id.ownerId,scope:id.scope,projectId:id.projectId||null};
    const version=JSON.parse(id.version);
    const known=['memory-revision-v1','note-v1'].includes(version[0])&&version.length===2&&positive(version[1]);
    const origin=edge.evidence.origin.includes('binding')?'binding':
      ['receipts','memories','raw_receipt_lineage','raw_source_maps'].includes(edge.evidence.origin)?'receipt-ancestry':'canonical-operation';
    const s=source(identity,ns,id.kind,id.key,known?version:['legacy-unresolved-v1',edge.evidence.digest],'',origin,edge.evidence);
    s.evidence_digest=edge.evidence.digest;
    if(seen.has(sourceKey(s))&&seen.get(sourceKey(s)).evidence_digest!==s.evidence_digest)s.source_version=JSON.stringify(['legacy-unresolved-v1',edge.evidence.digest]);
    seen.set(sourceKey(s),s);
  }
  return [...seen.values()];
}

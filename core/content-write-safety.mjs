import { assertContentScopes } from './content-safety-boundary.mjs';
import { createRawLineageStorage } from './raw-lineage-storage.mjs';
import { createHmac } from 'node:crypto';
import { cardContributorsInside, contentReadSafety, sourceReadSafety, createContentReadMemo } from './content-safety.mjs';
import { sourceRef } from './private-card-input.mjs';
import { bindContentSafetyConnection, cachedContentLayout, installedContentLayout } from './content-safety-schema.mjs';
import { contentSuppressionReasonInside, contentSuppressionTargetMatches, suppressionEpoch, withContentSuppressionCeilingsInside } from './content-suppression-storage.mjs';
import { contentWriteChanges } from './content-write-changes.mjs';
import { CONTENT_TERMINAL_FIELDS, CONTENT_TERMINAL_ACK_FIELDS, registerContentWriteGuard } from './content-write-context.mjs';
import { fail } from './validation.mjs';
import { hasCardLineage, loadCardBodyContributorsInside, verifyCardLineageCommitmentsInside, lineageHmac } from './card-lineage.mjs';
import { engineCardMetadataInside, engineCardRevisionsInside, isEngineCard } from './content-safety.mjs';

const names = {memory:'memories',receipt:'receipts',card:'private_cards','submitted-note':'card_notes',raw:'raw_conversations'};
const kinds = Object.fromEntries(Object.entries(names).map(([kind,table])=>[table,kind]));
const boundary=ns=>[ns.ownerId,ns.scope,ns.projectId??''];
const namespace=row=>row?.owner_id?{ownerId:row.owner_id,scope:row.scope??'owner',projectId:row.project_id??''}:null;
const quote=name=>'"'+name.replaceAll('"','""')+'"';
// Opaque protocol, topology and feature identities are deliberately classified
// separately from retained Memory/receipt/Card/note/Raw content identities.
const opaque = new Set(`actionId actorId agentId ownerId projectId storeId sessionId streamId eventId messageId messageIds
 targetEventId classificationEventId keepActionId operationActionId leaseId effectId mappingId mocId parentId parentIds
 parentL2Ids childId slotId episodeId episodeIds originEpisodeId stepId contractId manifestId packageId versionId
 assetId derivativeId objectId bindingId profileId releaseId localTargetId localStoreId sourceKey idempotencyKey
 admissionKey token attemptToken sourceFence factId`.split(/\s+/));
const contentRefs=new Set(`memoryRef memoryRefs cardRef cardRefs receiptRef receiptRefs noteRef noteRefs sourceRef sourceRefs evidenceRefs reasonRefs triggerMemoryRefs boundRefs selectedRefs finalRefs refs invalidRefs`.split(/\s+/));
const opaqueRefs=new Set(`assetRef assetVersionRef packageRef methodPackageRef methodVersionRef versionRef releaseRef
 profileRef topicRef mocRef parentRef placementRefs createdMocRefs`.split(/\s+/));
const jsonColumns=new Set(`source_ref result anchors receipt_ids previous_receipt_ids memory_ids bound_refs selected_refs final_refs
 reconciliation record payload keep_source_ids from_ref to_ref items reason_refs provenance timecodes context vector`.split(/\s+/));
const referenceRevision=(column,row)=>{
  const prefix=column.replace(/_(?:memory_)?id$/,'');
  return row[prefix+'_revision']??(column==='memory_id'?row.memory_revision??row.bound_revision??row.admission_revision:column==='card_id'?row.card_revision:undefined)??row.revision;
};
const camel=name=>name.replace(/_([a-z])/g,(_,c)=>c.toUpperCase());
const identityField=/[iI]ds?$|Refs?$/;
const specialMemory=new Set(['previousId','replacementId','predecessorId','fromId','toId','previousMemoryId','replacementMemoryId','leftMemoryId','rightMemoryId']);
const referenceKinds = field => /MemoryIds?$/.test(field)||/^memoryIds?$/.test(field)||specialMemory.has(field)?'memory':
  /ReceiptIds?$/.test(field)||/^receiptIds?$/.test(field)?'receipt':
  /CardIds?$/.test(field)||/^cardIds?$/.test(field)?'card':
  /^(?:source|note)Ids?$/.test(field)?'submitted-note':field==='conversationId'?'raw':null;

// Closure membership is schema data, never a search through payload strings.
// JSON paths address typed reference objects only; '*' visits one array level.
// The schema coverage test checks direct FKs and the declared polymorphic slots.
const engineCardClosureReferences = {
  private_cards: { columns: ['id'] },
  card_operations: { columns: ['target_id'], json: [
    { column: 'result', path: [], key: 'id', rowMethods: ['createCardDraft', 'editCardDraft', 'confirmCardDraft',
      'cancelCardDraft', 'editKnowledgeCard', 'deleteKnowledgeCard', 'declareCardCurrentDependencies',
      'revalidateCardCurrentDependencies', 'consolidate'] },
    { column: 'result', path: ['cardRefs', '*'], key: 'cardId', when: ['type', 'card'] }] },
  card_body_provenance: { columns: ['card_id'] },
  card_body_sources: { columns: ['card_id'] },
  card_body_authorizations: { columns: ['card_id', 'request_target'] },
  card_bindings: { columns: ['card_id'] },
  card_memory_bindings: { columns: ['card_id'] },
  card_raw_bindings: { columns: ['card_id'] },
  card_effects: { columns: [{ key: 'entity_id', when: ['entity_type', 'card'] }] },
  card_applicability_reviews: { columns: ['card_id'] },
  card_current_dependencies: { columns: ['card_id'] },
  card_moc_title_sources: { columns: ['card_id'] },
  card_moc_refs: { columns: ['card_id'] },
  card_raw_pending_invalidations: { columns: ['card_id'] },
  content_identity_reservations: { columns: [
    { key: 'stable_key', when: ['kind', 'card'] }, { key: 'incarnation', when: ['kind', 'card'] }] },
  content_suppressions: { columns: [
    { key: 'stable_key', when: ['kind', 'card'] }, { key: 'incarnation', when: ['kind', 'card'] }] },
  method_changes: { json: [{ column: 'reason_refs', path: ['*'], key: 'cardId', when: ['type', 'card'] }] },
  method_binding_events: { json: [{ column: 'reason_refs', path: ['*'], key: 'cardId', when: ['type', 'card'] }] },
  role_profile_releases: { json: [{ column: 'payload', path: ['fields', 'related', '*'], key: 'cardId', when: ['type', 'card'] }] },
  role_profile_changes: { json: [{ column: 'payload', path: ['reasonRefs', '*'], key: 'cardId', when: ['type', 'card'] }] },
};
function closureRowReferencesCard(table, row, keys) {
  const refs=engineCardClosureReferences[table];
  if(!refs||!row)return false;
  const matches=(node,slot)=>node&&(!slot.when||node[slot.when[0]]===slot.when[1])&&keys.has(node[slot.key]);
  if(refs.columns?.some(slot=>matches(row,typeof slot==='string'?{key:slot}:slot)))return true;
  return refs.json?.some(slot=>{
    if(row[slot.column]==null||slot.rowMethods&&!slot.rowMethods.includes(row.method))return false;
    let nodes;
    try{nodes=[JSON.parse(row[slot.column])];}catch{fail('evidence_unavailable');}
    for(const part of slot.path)nodes=nodes.flatMap(node=>part==='*'?(Array.isArray(node)?node:[]):[node?.[part]]);
    return nodes.some(node=>matches(node,slot));
  })??false;
}

/** A session spans just one mutation. No SQL or session is allocated on open,
 * reads, legacy cells, or trusted maintenance without a facade write context. */
export function beginContentWriteSafety(db, operation) {
  const layout=cachedContentLayout(db)??installedContentLayout(db);
  if(!layout.suppressionRevision)return null;
  if(!db.isTransaction)fail('storage_error');
  // Entry callbacks run outside the write lock. Recheck the complete scope in
  // this transaction even for a mutation with no surviving rows or ids.
  assertContentScopes(db,operation.scopes);
  const scopes=operation.scopes.filter(ns=>ns.scope==='personal'||ns.scope==='project');
  const ceilings=new Map();
  for(const {ownerId}of operation.scopes)if(!ceilings.has(ownerId)){
    const row=db.prepare('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs WHERE owner_id=?').get(ownerId);
    ceilings.set(ownerId,row?suppressionEpoch(row):0n);
  }
  if(!ceilings.size)fail('evidence_unavailable');
  const session=db.createSession(), replayTargets=[];
  const declared=table=>{
    for(let c=operation;c;c=c.parent)if(CONTENT_TERMINAL_FIELDS[c.method]?.split('.')[0]===table)return true;
    return false;
  };
  return {close:()=>session.close(), terminal(kind,row) {
    if(!row||!declared(names[kind])||!ceilings.has(row.owner_id)||!row.deleted&&!['deleted','cancelled'].includes(row.state))fail('evidence_unavailable');
    replayTargets.push({kind,row});
  }, validate(result) {
    const changes=contentWriteChanges(session.changeset()), metadata=new Map(), seen=new Set(), checked=new Set();
    const identity=db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata WHERE singleton=1').get();
    const tables=new Map(db.prepare('PRAGMA table_list').all().filter(t=>t.schema==='main').map(t=>[t.name,t.type]));
    const info=table=>{if(!metadata.has(table))metadata.set(table,db.prepare('PRAGMA table_info('+quote(table)+')').all());return metadata.get(table);};
    const exists=table=>tables.has(table);
    const get=(table,key)=>exists(table)?db.prepare('SELECT * FROM '+quote(table)+' WHERE id=?').get(key):null;
    const newFacts=[];
    for(const [owner,epoch]of ceilings)for(const fact of db.prepare(`SELECT * FROM content_suppressions INDEXED BY content_suppression_window
      WHERE owner_id=? AND (epoch_hi,epoch_lo)>(?,?) ORDER BY epoch_hi,epoch_lo`).all(owner,Number(epoch>>32n),Number(epoch&0xffffffffn)))newFacts.push(fact);
    const terminal=new Set();
    const canonical=[],removed=[];
    for(const change of changes) {
      if(tables.get(change.table)==='shadow')continue;
      const columns=info(change.table);if(columns.length!==change.primary.length)fail('evidence_unavailable');
      if(!change.next){removed.push({table:change.table,row:Object.fromEntries(columns.map((c,i)=>[c.name,change.old[i]]))});continue;}
      const pk=columns.filter((_,i)=>change.primary[i]);if(!pk.length)fail('evidence_unavailable');
      const values=pk.map(c=>{const i=columns.indexOf(c);return change.next[i]??change.old?.[i];});
      const row=db.prepare('SELECT * FROM '+quote(change.table)+' WHERE '+pk.map(c=>quote(c.name)+' IS ?').join(' AND ')).get(...values);
      if(!row)fail('evidence_unavailable');
      canonical.push({table:change.table,row,old:change.old,columns});
    }
    // The declaration names a canonical field; arguments never select an
    // exemption. Automatic terminal changes additionally require their own fact.
    for(const {table,row}of canonical) {
      const kind=kinds[table];
      if(kind&&(row.deleted||['deleted','cancelled'].includes(row.state)) &&
          (newFacts.some(f=>f.match_mode==='incarnation'&&contentSuppressionTargetMatches(f,namespace(row),{kind,key:row.id}))))
        terminal.add(JSON.stringify([...boundary(namespace(row)),kind,row.id]));
    }
    for(const {kind,row}of replayTargets)terminal.add(JSON.stringify([...boundary(namespace(row)),kind,row.id]));
    // Deleted receipt/Raw rows remain visible in the native changeset. Their
    // same-transaction facts, not acknowledgement arguments, identify targets.
    for(const {table,row}of removed){
      const kind=kinds[table],ns=kind==='receipt'?namespace(get('memories',row.memory_id)):namespace(row);
      if(kind&&ns&&newFacts.some(f=>f.match_mode==='incarnation'&&contentSuppressionTargetMatches(f,ns,{kind,key:row.id})))
        terminal.add(JSON.stringify([...boundary(ns),kind,row.id]));
    }
    // A terminal replay has no changed row. Its declared root field comes from
    // the canonical operation receipt, not request arguments or nested effects.
    for(let c=operation;c;c=c.parent) {
      const field=CONTENT_TERMINAL_ACK_FIELDS[c.method],table=CONTENT_TERMINAL_FIELDS[c.method]?.split('.')[0],kind=kinds[table];
      const key=field&&(result?.[field]??result?.value?.[field]);
      if(typeof key!=='string'||!kind)continue;
      const row=get(table,key),ns=namespace(row)??scopes[0];
      if(ns&&(row?.deleted||['deleted','cancelled'].includes(row?.state)||kind==='raw'&&!row)&&
          db.prepare(`SELECT 1 FROM content_suppressions INDEXED BY content_suppression_target
            WHERE owner_id=? AND scope=? AND project_id=? AND kind=? AND stable_key=? AND incarnation=? AND match_mode='incarnation' LIMIT 1`).get(...boundary(ns),kind,key,key))
        terminal.add(JSON.stringify([...boundary(ns),kind,key]));
    }
    function locate(kind,key) {
      if(kind==='receipt'){
        const row=get('receipts',key),parent=row?get('memories',row.memory_id):null;
        return {row,ns:namespace(parent),parent};
      }
      const row=get(names[kind],key);return {row,ns:namespace(row)};
    }
    const lineage=hasCardLineage(db);
    const oldValue=(change,name)=>change.old?.[change.columns.findIndex(column=>column.name===name)]??change.row[name];
    // Corrections retire a revision even when its text/fingerprint is identical.
    // Require the native revision transition and removed receipt identities,
    // covered by the same scoped correction facts. Supersession has no such facts.
    function retiredMemory(fact) {
      if(fact.kind!=='memory'||fact.match_mode!=='revision-through'||fact.reason!=='correction_supersession')return false;
      const change=canonical.find(c=>c.table==='memories'&&c.old&&c.row.id===fact.stable_key&&
        contentSuppressionTargetMatches(fact,namespace(c.row),{kind:'memory',key:c.row.id,revision:oldValue(c,'revision')}));
      if(!change)return false;
      const previous=oldValue(change,'revision'),receipts=removed.filter(c=>c.table==='receipts'&&c.row.memory_id===change.row.id);
      return Number.isSafeInteger(previous)&&previous>0&&change.row.revision===previous+1&&
        fact.source_version===JSON.stringify(['memory-revision-through-v1',previous])&&receipts.length>0&&
        receipts.every(({row})=>newFacts.some(f=>f.kind==='receipt'&&f.match_mode==='incarnation'&&
          f.reason===fact.reason&&f.action_id===fact.action_id&&
          contentSuppressionTargetMatches(f,namespace(change.row),{kind:'receipt',key:row.id})));
    }
    const terminalFacts=newFacts.filter(f=>terminal.has(JSON.stringify([f.owner_id,f.scope,f.project_id,f.kind,f.stable_key]))||
      lineage&&retiredMemory(f)||
      f.kind==='raw'&&f.match_mode==='span'&&exists('raw_source_exclusions')&&
      db.prepare(`SELECT 1 FROM raw_source_exclusions x JOIN raw_conversations c ON c.id=x.conversation_id
        WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND x.conversation_id=? AND x.message_id=? AND x.start=? AND x.end=?`)
        .get(f.owner_id,f.scope,f.project_id,f.stable_key,f.message_key,f.span_start,f.span_end));
    const bindingTables=new Set(['card_bindings','card_memory_bindings','card_raw_bindings']);
    const changedBindings=new Set([...canonical,...removed].filter(c=>bindingTables.has(c.table)).map(c=>c.row.card_id));
    const ownTarget=(ns,target)=>terminalFacts.some(f=>contentSuppressionTargetMatches(f,ns,target));
    const ownTerminal=(ns,target)=>terminalFacts.some(f=>contentSuppressionTargetMatches(f,ns,target)&&
      (f.match_mode!=='span'||target.start>=f.span_start&&target.end<=f.span_end));
    // A retained receipt may reach an own terminal Raw target through lineage.
    // Exempt only prior Raw facts wholly covered by that terminal target. This
    // scoped overlay still runs S1's full canonical proof and ancestry checks.
    const terminalAncestors=new Set(),rawRanges=new Map();
    for(const fact of terminalFacts.filter(f=>f.kind==='raw')){
      const key=JSON.stringify([fact.owner_id,fact.scope,fact.project_id,fact.stable_key]);
      if(!rawRanges.has(key))rawRanges.set(key,db.prepare(`SELECT * FROM content_suppressions INDEXED BY content_suppression_target
        WHERE (owner_id,scope,project_id,kind,stable_key,incarnation)=(?,?,?,'raw',?,?) AND (epoch_hi,epoch_lo)<=(?,?)`)
        .all(fact.owner_id,fact.scope,fact.project_id,fact.stable_key,fact.stable_key,Number(ceilings.get(fact.owner_id)>>32n),Number(ceilings.get(fact.owner_id)&0xffffffffn)));
      for(const prior of rawRanges.get(key))if(fact.match_mode==='incarnation'||fact.match_mode==='span'&&prior.match_mode==='span'&&
          prior.message_key===fact.message_key&&prior.span_start>=fact.span_start&&prior.span_end<=fact.span_end)terminalAncestors.add(prior.fact_id);
    }
    function sourceTargets(ref){
      if(ref.type==='receipt')return [{kind:'memory',key:ref.memoryId,revision:ref.memoryRevision,version:JSON.stringify(['memory-revision-v1',ref.memoryRevision])},{kind:'receipt',key:ref.receiptId}];
      return [{kind:ref.type,key:ref.sourceId??ref.conversationId,revision:ref.revision,
        version:ref.type==='submitted-note'?JSON.stringify(['note-v1',ref.revision]):undefined,messageId:ref.messageId,start:ref.span?.start,end:ref.span?.end}];
    }
    let dependentMemo;
    function dependentReadMemo(){
      if(dependentMemo)return dependentMemo;
      // Only exemption-(c) validation uses this adapter. Retain S1's complete
      // receipt identity/origin/lineage proof, excluding canonical exclusions
      // wholly owned by this transaction's terminal targets. Other exclusions
      // and uncertain/foreign lineage still refuse. Ordinary serving never
      // receives this memo or adapter.
      const source=bindContentSafetyConnection({get isTransaction(){return db.isTransaction;},prepare(sql){
        if(sql.replace(/\s+/g,' ').trim()==='SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=? AND start<? AND end>?')return {get(conversationId,messageId,end,start){
          const rows=db.prepare(`SELECT c.owner_id,c.scope,c.project_id,x.conversation_id,x.message_id,x.start,x.end
            FROM raw_source_exclusions x LEFT JOIN raw_conversations c ON c.id=x.conversation_id
            WHERE x.conversation_id=? AND x.message_id=? AND x.start<? AND x.end>? ORDER BY x.start,x.end`).iterate(conversationId,messageId,end,start);
          for(const row of rows)if(!row.owner_id||!ownTerminal(namespace(row),{kind:'raw',key:row.conversation_id,messageId:row.message_id,start:row.start,end:row.end}))return {present:1};
          return undefined;
        }};
        return db.prepare(sql);
      }},db);
      return dependentMemo=createContentReadMemo(source);
    }
    function automaticallyInvalidatedCard(key,ns){
      if(engineMemoryInvalidatedCard(key,ns))return true;
      if(lineage)return lineageInvalidatedCard(key,ns);
      const change=canonical.find(c=>c.table==='private_cards'&&c.row.id===key),row=change?.row??get('private_cards',key);
      if(!row||row.state!=='confirmed'||changedBindings.has(key)||change&&(!change.old||
          !Number.isSafeInteger(change.old[change.columns.findIndex(c=>c.name==='revision')])||
          row.revision<=change.old[change.columns.findIndex(c=>c.name==='revision')]||
          change.columns.some((c,i)=>!['id','revision','updated_at'].includes(c.name)&&change.old[i]!==undefined)||
          !canonical.some(c=>c.table==='card_effects'&&!c.old&&c.row.kind==='evidence_invalidated'&&c.row.entity_type==='card'&&
            c.row.entity_id===key&&c.row.revision===row.revision&&JSON.stringify(boundary(namespace(c.row)))===JSON.stringify(boundary(ns)))))return false;
      // Stable canonical bindings establish (c), including receipt-only Cards
      // whose eligibility changes without a legacy revision/effect transition.
      // An insertion, body edit or caller-supplied binding cannot qualify.
      const publicNs={...ns,projectId:ns.projectId||null};let contributors;
      try{contributors=cardContributorsInside(db,key);for(const ref of contributors)sourceRef(ref,publicNs,true);}
      catch{fail('evidence_unavailable');}
      const reachesTarget=ref=>sourceTargets(ref).some(target=>ownTarget(ns,target))||ref.type==='receipt'&&exists('raw_receipt_lineage')&&
        db.prepare('SELECT conversation_id,message_id,start,end FROM raw_receipt_lineage WHERE receipt_id=?').all(ref.receiptId)
          .some(row=>ownTarget(ns,{kind:'raw',key:row.conversation_id,messageId:row.message_id,start:row.start,end:row.end}));
      if(!contributors.some(reachesTarget))return false;
      withContentSuppressionCeilingsInside(db,ceilings,()=>{for(const ref of contributors){
        const targets=sourceTargets(ref),own=targets.some(target=>ownTarget(ns,target));
        if(!own){if(!sourceReadSafety(db,{identity,namespace:publicNs,ref,memo:dependentReadMemo()}).allowed)fail('evidence_unavailable');continue;}
        // Exempt the terminal contributor only. A receipt's surviving parent,
        // or any other contributor, still observes every pre-operation fact.
        for(const target of targets)if(!ownTarget(ns,target)){
          if(contentSuppressionReasonInside(db,ns,target))fail('evidence_unavailable');
          check(target.kind,target.key,ns,target.revision);
        }
        if(ref.type==='raw'&&contentSuppressionReasonInside(db,ns,targets[0]))fail('evidence_unavailable');
      }},terminalAncestors);
      return true;
    }
    function lineageInvalidatedCard(key,ns) {
      const change=canonical.find(c=>c.table==='private_cards'&&c.row.id===key),row=change?.row??get('private_cards',key);
      if(!row||!['draft','confirmed'].includes(row.state)||changedBindings.has(key)||
        JSON.stringify(boundary(namespace(row)))!==JSON.stringify(boundary(ns)))return false;
      if(change&&(!change.old||change.columns.some((c,i)=>!['id','revision','updated_at'].includes(c.name)&&change.old[i]!==undefined)||
        !Number.isSafeInteger(oldValue(change,'revision'))||!Number.isSafeInteger(row.revision)||row.revision<=oldValue(change,'revision')))return false;
      if([...canonical,...removed].some(c=>['card_body_provenance','card_body_sources','card_body_authorizations'].includes(c.table)&&c.row.card_id===key))return false;
      // This is dependency evidence only. Unknown and previously denied siblings
      // retain their denial and are never evaluated as readable content here.
      const durable=db.prepare(`SELECT * FROM card_body_sources WHERE owner_id=? AND scope=? AND project_id=?
        AND card_id=? AND body_revision=? LIMIT 257`).all(...boundary(ns),key,row.body_revision);
      if(durable.length>256)return false;
      const targets=[];
      for(const s of durable) {
        let v;try{v=JSON.parse(s.source_version);}catch{continue;}
        targets.push({kind:s.source_kind,key:s.source_key,version:s.source_version,revision:v[0]==='memory-revision-v1'||v[0]==='note-v1'?v[1]:undefined,
          ...(v[0]==='raw-span-v1'?{messageId:v[1],start:v[2],end:v[3]}:{})});
      }
      // Stable presentation rows are positive evidence when an older body's
      // closure was unknown. They cannot grant completeness or serving access.
      if(!changedBindings.has(key))for(const ref of cardContributorsInside(db,key))targets.push(...sourceTargets(ref));
      if(!targets.some(target=>ownTarget(ns,target)))return false;
      // A receipt-only Card can be invalidated once per changed Memory. Native
      // sessions retain only the net Card update, so reconstruct every step from
      // its newly inserted effects and canonical source transitions. An unchanged
      // Card has zero steps: a source denial cannot authorize extra audit effects.
      const effects=canonical.filter(c=>c.table==='card_effects'&&c.row.entity_type==='card'&&c.row.entity_id===key)
        .sort((a,b)=>a.row.ordinal-b.row.ordinal);
      const previous=change?oldValue(change,'revision'):row.revision;
      if(effects.length!==row.revision-previous||removed.some(c=>c.table==='card_effects'&&c.row.entity_type==='card'&&c.row.entity_id===key))return false;
      const causes=new Set();let timestamp;
      for(const [index,effect]of effects.entries()) {
        const e=effect.row;
        if(effect.old||e.kind!=='evidence_invalidated'||e.revision!==previous+index+1||
          JSON.stringify(boundary(namespace(e)))!==JSON.stringify(boundary(ns)))return false;
        const memory=canonical.find(c=>c.table==='memories'&&c.old&&
          e.action_id==='memory-revision-'+c.row.id+'-'+c.row.revision&&
          JSON.stringify(boundary(namespace(c.row)))===JSON.stringify(boundary(ns)));
        if(memory) {
          if(causes.has(memory.row.id)||memory.row.revision!==oldValue(memory,'revision')+1||
            !targets.some(target=>ownTarget(ns,target)&&(target.kind==='memory'&&target.key===memory.row.id||
              target.kind==='receipt'&&removed.some(c=>c.table==='receipts'&&c.row.id===target.key&&c.row.memory_id===memory.row.id))))return false;
          causes.add(memory.row.id);timestamp=memory.row.updated_at;
        } else {
          // Note and coalesced Raw writers emit one step for their canonical
          // source action. Multi-step sequences belong to Memory triggers only.
          if(effects.length!==1||!terminalFacts.some(f=>f.action_id===e.action_id&&
            targets.some(target=>contentSuppressionTargetMatches(f,ns,target))))return false;
        }
      }
      return timestamp===undefined||row.updated_at===timestamp;
    }
    function engineMemoryInvalidatedCard(key,ns) {
      const change=canonical.find(c=>c.table==='private_cards'&&c.row.id===key),row=change?.row;
      const sameNamespace=value=>value&&JSON.stringify(boundary(value))===JSON.stringify(boundary(ns));
      if(!change?.old||!['draft','confirmed'].includes(row.state)||!sameNamespace(namespace(row))||
        !scopes.some(sameNamespace)||!engineCardMetadataInside(db,ns,row)||
        change.columns.some((c,i)=>!['id','revision','updated_at'].includes(c.name)&&change.old[i]!==undefined))return false;
      const previous=oldValue(change,'revision');
      if(!Number.isSafeInteger(previous)||previous<1||!Number.isSafeInteger(row.revision)||row.revision<=previous)return false;
      // Check both identities of an update: moving a binding or authority row
      // away from this Card is still a change to this Card's closure.
      const belongs=c=>c.row.card_id===key||c.old&&oldValue(c,'card_id')===key;
      if([...canonical,...removed].some(c=>
        (bindingTables.has(c.table)||['card_body_provenance','card_body_sources','card_body_authorizations'].includes(c.table))&&belongs(c)||
        c.table==='card_body_authorizations'&&(c.row.request_target===key||c.old&&oldValue(c,'request_target')===key)||
        c.table==='card_operations'&&(c.row.target_id===key||c.old&&oldValue(c,'target_id')===key)))return false;
      const cardEffect=c=>c.row.entity_type==='card'&&c.row.entity_id===key||
        c.old&&oldValue(c,'entity_type')==='card'&&oldValue(c,'entity_id')===key;
      const effects=canonical.filter(c=>c.table==='card_effects'&&cardEffect(c)).sort((a,b)=>a.row.ordinal-b.row.ordinal);
      if(effects.length!==row.revision-previous||removed.some(c=>c.table==='card_effects'&&cardEffect(c)))return false;
      // Enumerate all changed bound Memories, including any whose entire
      // effect interval is missing. Native sessions retain only old/final rows.
      const causes=[];
      for(const memory of canonical.filter(c=>c.table==='memories'&&c.old&&oldValue(c,'revision')!==c.row.revision)) {
        if(!db.prepare('SELECT 1 FROM card_memory_bindings WHERE card_id=? AND memory_id=? LIMIT 1').get(key,memory.row.id))continue;
        const revision=oldValue(memory,'revision');
        if(!sameNamespace(namespace(memory.row))||!Number.isSafeInteger(revision)||revision<1||
          !Number.isSafeInteger(memory.row.revision)||memory.row.revision<=revision||
          memory.columns.some((c,i)=>['owner_id','scope','project_id'].includes(c.name)&&memory.old[i]!==undefined))return false;
        causes.push({memory,revision});
      }
      let timestamp;
      for(const [index,effect]of effects.entries()) {
        const e=effect.row;
        if(effect.old||e.kind!=='evidence_invalidated'||e.revision!==previous+index+1||!sameNamespace(namespace(e)))return false;
        // Consume each Memory's interval in ordinal order; neither a duplicate
        // nor a jump can explain the next trigger effect.
        const cause=causes.find(c=>c.revision<c.memory.row.revision&&
          e.action_id==='memory-revision-'+c.memory.row.id+'-'+(c.revision+1));
        if(!cause)return false;
        cause.revision++;timestamp=cause.memory.row.updated_at;
      }
      if(!causes.length||causes.some(c=>c.revision!==c.memory.row.revision))return false;
      // This only hides an engine Card: every read rejects its advanced revision.
      // It grants no serving authority or retention exception; text, bindings,
      // seals and purge behavior stay unchanged, including prior source denials.
      return row.updated_at===timestamp;
    }
    function engineForgottenCard(key,ns) {
      // A source cascade may terminally forget a bound Memory without a public
      // forget ancestor. Same-action terminal facts and removed bindings prove
      // ownership; a method name alone cannot authorize this transition.
      const change=canonical.find(c=>c.table==='private_cards'&&c.row.id===key),row=change?.row;
      const sameNamespace=value=>value&&JSON.stringify(boundary(value))===JSON.stringify(boundary(ns));
      if(!change?.old||row.state!=='deleted'||row.title!==null||row.body!==null||
        row.revision!==oldValue(change,'revision')+1||
        !sameNamespace(namespace(row))||!scopes.some(sameNamespace)||!engineCardMetadataInside(db,ns,row)||
        change.columns.some((c,i)=>!['id','state','revision','title','body','updated_at'].includes(c.name)&&change.old[i]!==undefined))return false;
      // Purging removes live bindings, but never rewrites a receipt or sealed
      // authority. Moving a row away still changes this Card's closure.
      const touches=(c,column)=>c.row[column]===key||c.old&&oldValue(c,column)===key;
      if([...canonical,...removed].some(c=>
        ['card_body_provenance','card_body_sources','card_body_authorizations'].includes(c.table)&&touches(c,'card_id')||
        c.table==='card_body_authorizations'&&touches(c,'request_target')||
        c.table==='card_operations'&&touches(c,'target_id'))||
        canonical.some(c=>bindingTables.has(c.table)&&touches(c,'card_id'))||
        [...bindingTables].some(table=>exists(table)&&db.prepare('SELECT 1 FROM '+table+' WHERE card_id=? LIMIT 1').get(key)))return false;
      const effects=canonical.filter(c=>c.table==='card_effects'&&c.row.entity_type==='card'&&c.row.entity_id===key);
      if(effects.length!==1||effects[0].old)return false;
      const effect=effects[0].row;
      return effect.kind==='card_deleted'&&effect.revision===row.revision&&
        JSON.stringify(boundary(namespace(effect)))===JSON.stringify(boundary(ns))&&
        newFacts.some(f=>f.kind==='card'&&f.match_mode==='incarnation'&&f.reason==='purge'&&f.action_id===effect.action_id&&
          contentSuppressionTargetMatches(f,ns,{kind:'card',key}))&&
        removed.some(c=>c.table==='card_memory_bindings'&&c.row.card_id===key&&
          terminalFacts.some(f=>f.kind==='memory'&&f.match_mode==='incarnation'&&f.action_id===effect.action_id&&
            contentSuppressionTargetMatches(f,ns,{kind:'memory',key:c.row.memory_id})&&
            canonical.some(m=>m.table==='memories'&&m.old&&m.row.id===c.row.memory_id&&m.row.deleted===1&&m.row.content===null&&
              oldValue(m,'deleted')===0&&JSON.stringify(boundary(namespace(m.row)))===JSON.stringify(boundary(ns)))));
    }
    const sourceAuthority=createRawLineageStorage(db);
    function engineRetiredCard(key,ns) {
      if(operation.method!=='maintainCards'||changedBindings.has(key))return false;
      const change=canonical.find(c=>c.table==='private_cards'&&c.row.id===key);
      if(!change?.old||oldValue(change,'revision')!==1||change.row.revision!==2||
        change.columns.some((c,i)=>!['id','revision','updated_at'].includes(c.name)&&change.old[i]!==undefined)||
        [...canonical,...removed].some(c=>['card_body_provenance','card_body_sources','card_body_authorizations'].includes(c.table)&&c.row.card_id===key))return false;
      const publicNs=namespace(change.row); publicNs.projectId ||= null;
      if(!engineCardRevisionsInside(db,publicNs,{...change.row,revision:1}))return false;
      // A stale transition exposes no body or source acknowledgement. Preserve
      // the immutable seal even when source suppression caused the retirement;
      // requiring readable sources would prevent safe retirement in that case.
      if(lineage)verifyCardLineageCommitmentsInside(db,identity,publicNs,key);
      return true;
    }
    function episodeSource(key,ns) {
      const source=get('episode_sources',key),origin=source?get('session_episodes',source.origin_episode_id):null;
      if(!source||!origin||origin.deleted||!ns||JSON.stringify(boundary(namespace(origin)))!==JSON.stringify(boundary(ns)))fail('evidence_unavailable');
      sourceAuthority.assertReceipts(ns,[{client:origin.client,sessionId:origin.session_key,eventId:source.message_id,role:source.role,excerpt:source.text}]);
    }
    function check(kind,key,ns,revision,extra={},audit=false) {
      if(key===null||key===undefined)return;
      if(typeof key!=='string'||!key)fail('evidence_unavailable');
      const found=locate(kind,key);ns=ns??found.ns;
      if(!ns||!ceilings.has(ns.ownerId)||found.ns&&JSON.stringify(boundary(found.ns))!==JSON.stringify(boundary(ns)))fail('evidence_unavailable');
      if(terminal.has(JSON.stringify([...boundary(ns),kind,key])))return;
      const boundRevision=revision??found.row?.revision;
      const version=Number.isSafeInteger(boundRevision)?kind==='memory'?JSON.stringify(['memory-revision-v1',boundRevision]):kind==='submitted-note'?JSON.stringify(['note-v1',boundRevision]):undefined:undefined;
      const target={kind,key,revision:boundRevision,version,...extra};
      if(ownTerminal(ns,target))return;
      if(audit&&newFacts.some(f=>contentSuppressionTargetMatches(f,ns,target)))return;
      if(!found.row)fail('evidence_unavailable');
      if(lineage&&kind==='card'&&automaticallyInvalidatedCard(key,ns))return;
      if(contentSuppressionReasonInside(db,ns,target))fail('evidence_unavailable');
      if(kind==='card'&&engineRetiredCard(key,ns))return;
      const stamp=JSON.stringify([kind,key,ns,revision,extra,audit]);if(checked.has(stamp))return;checked.add(stamp);
      if(kind==='card'&&automaticallyInvalidatedCard(key,ns))return;
      if(kind==='memory'||kind==='card'){
        const publicNs={...ns,projectId:ns.projectId||null},ref={type:kind,namespace:publicNs,[kind==='memory'?'memoryId':'cardId']:key,revision:found.row.revision,
          ...(kind==='card'?{bodyRevision:found.row.body_revision}:{})};
        if(!contentReadSafety(db,{identity,namespace:publicNs,ref,intent:'history',method:kind==='card'?'getCard':'retrieval'}).allowed)fail('evidence_unavailable');
        // Acknowledgements may project these anchors after storage returns.
        // Validate their canonical contributors before this transaction commits.
        if(kind==='memory')for(const table of ['procedural_tags','qualification_anchors'])if(exists(table))for(const row of db.prepare('SELECT * FROM '+table+' WHERE memory_id=?').all(key)){
          if(table==='procedural_tags'&&row.anchors)walk(JSON.parse(row.anchors),ns,'anchors');
          if(table==='qualification_anchors')check('receipt',row.receipt_id,ns);
        }
      }else if(kind==='receipt'){
        const memory=found.parent;
        if(!memory)fail('evidence_unavailable');
        const publicNs={...ns,projectId:ns.projectId||null};
        if(!contentReadSafety(db,{identity,namespace:publicNs,intent:'history',ref:{type:'memory',namespace:publicNs,memoryId:memory.id,revision:memory.revision},receipts:[found.row]}).allowed)fail('evidence_unavailable');
      }else if(kind==='submitted-note'){
        const row=found.row,publicNs={...ns,projectId:ns.projectId||null},ref={type:kind,namespace:publicNs,sourceId:key,revision:row.revision,completeness:'provided-note',
          contentIdentity:createHmac('sha256',identity.cursorSecret).update(JSON.stringify(['submitted-note-content-v1',[identity.storeId,[publicNs,row.id,row.revision,row.text]]])).digest('base64url')};
        if(!sourceReadSafety(db,{identity,namespace:publicNs,ref}).allowed)fail('evidence_unavailable');
      }
    }
    function metadataIdentity(table,key,ns) {
      const row=get(table,key),bound=namespace(row);
      if(!row||bound&&(!ns||JSON.stringify(boundary(bound))!==JSON.stringify(boundary(ns))))fail('evidence_unavailable');
      const stamp=JSON.stringify(['metadata',table,key,ns]);if(checked.has(stamp))return;checked.add(stamp);
      if(bound&&contentSuppressionReasonInside(db,bound))fail('evidence_unavailable');
      if(table==='mocs'||table==='card_mocs') {
        const card=table==='card_mocs',kind=card?'card':'memory',prefix=card?'card_moc':'moc';
        for(const member of db.prepare('SELECT * FROM '+prefix+'_title_sources WHERE moc_id=?').all(key))
          check(kind,member[card?'card_id':'memory_id'],bound,member[card?'card_revision':'memory_revision']);
      }
    }
    function mocIdentity(key,ns) {
      const table=['mocs','card_mocs'].find(table=>get(table,key));if(!table)fail('evidence_unavailable');metadataIdentity(table,key,ns);
    }
    function generic(key,ns,hint,audit,revision) {
      if((hint==='applyCardPlacement'||!hint&&operation.method==='applyCardPlacement')&&db.prepare('SELECT 1 FROM card_operations WHERE owner_id=? AND scope=? AND project_id=? AND action_id=? AND method=\'applyCardPlacement\'').get(...boundary(ns),key))return;
      if(hint==='messages')return; // canonical message keys, not retained Memory identities
      if(hint==='nextStep'&&canonical.some(({table,row})=>table==='session_episodes'&&JSON.stringify(boundary(namespace(row)))===JSON.stringify(boundary(ns))&&JSON.parse(row.record).nextStep?.id===key))return;
      if(get('episode_sources',key)){episodeSource(key,ns);return;}
      const hinted={memory:'memory',memories:'memory',legacyMemory:'memory',detail:'memory',forgotten:'memory',receipt:'receipt',receipts:'receipt',card:'card',cards:'card',note:'submitted-note',source:'submitted-note',raw:'raw',conversation:'raw',conversations:'raw'}[hint];
      if(hinted){check(hinted,key,ns,revision,{},audit);return;}
      const matches=Object.keys(names).filter(kind=>get(names[kind],key));
      if(matches.length===1){check(matches[0],key,ns,revision,{},audit);return;}
      // Known non-content feature objects have canonical identities too.
      const table=['mocs','card_mocs','session_episodes','method_packages','method_versions','assets','asset_versions','asset_derivatives','role_profiles','role_profile_releases','evidence_mappings','qualified_slots','binary_objects','index_generations'].find(table=>get(table,key));
      if(table){metadataIdentity(table,key,ns);return;}
      fail('evidence_unavailable');
    }
    function walk(node,inherited=scopes.length===1?scopes[0]:null,hint='',audit=false) {
      audit ||= ['reviewEffects','transitions','conflicts'].includes(hint);
      if(!node||typeof node!=='object'||ArrayBuffer.isView(node)||seen.has(node))return;
      seen.add(node);
      if(Array.isArray(node)){for(const child of node)walk(child,inherited,hint,audit);return;}
      const ns=node.namespace??namespace(node)??inherited;
      if(lineage&&ns&&(node.cardId||node.type==='card'&&node.id)&&['title','body','content','excerpt'].some(field=>typeof node[field]==='string')) {
        const key=node.cardId??node.id,row=get('private_cards',key),publicNs={...ns,projectId:ns.projectId||null};
        if(!row||!contentReadSafety(db,{identity,namespace:publicNs,method:'getCard',intent:'history',
          ref:{type:'card',namespace:publicNs,cardId:key,revision:row.revision,bodyRevision:row.body_revision}}).allowed)fail('evidence_unavailable');
      }
      if(['receipt','submitted-note','raw'].includes(node.type)&&node.contentIdentity){
        const key=node.receiptId??node.sourceId??node.conversationId;
        const auditTarget={kind:node.type,key,revision:node.revision,messageId:node.messageId,start:node.span?.start,end:node.span?.end};
        if(!terminal.has(JSON.stringify([...boundary(ns),node.type,key]))&&!ownTerminal(ns,auditTarget)&&!(audit&&newFacts.some(f=>contentSuppressionTargetMatches(f,ns,auditTarget)))&&!sourceReadSafety(db,{identity,namespace:ns,ref:node}).allowed)fail('evidence_unavailable');
      }
      for(const [column,value]of Object.entries(node)) {
        const field=camel(column);
        if(value===null||value===undefined)continue;
        const sourceField=/^sourceIds?$/.test(field),kind=field==='sourceId'&&node.type==='raw'?'raw':referenceKinds(field);
        if(sourceField&&node.type!=='submitted-note'&&node.type!=='raw'&&(Array.isArray(value)?value:[value]).every(key=>get('episode_sources',key))) {
          for(const key of Array.isArray(value)?value:[value])episodeSource(key,ns);continue;
        }
        if(kind){for(const key of Array.isArray(value)?value:[value])check(kind,key,ns,node.memoryRevision??node.revision??node.expectedRevision,{messageId:node.messageId,start:node.span?.start,end:node.span?.end},audit);}
        else if(field==='id'&&typeof value==='string')generic(value,ns,node.type==='conversation'?'conversation':hint,audit,node.revision??node.expectedRevision);
        else if(field==='entityId'&&['memory','receipt','card','submitted-note','raw'].includes(node.entityType))check(node.entityType,value,ns,node.revision,{},audit);
        else if(field==='entityId'&&node.entityType==='episode')generic(value,ns,'episode',audit);
        else if(field==='childId'&&['memory','card'].includes(node.childType))check(node.childType,value,ns,node.childRevision,{},audit);
        else if(field==='targetId'&&node.memoryId)check('memory',value,ns,node.targetRevision,{},audit);
        else if(field==='targetId'&&typeof node.method==='string'&&/Card|SourceNote/.test(node.method))generic(value,ns,node.method,audit);
        else if(field==='targetId'&&typeof node.client==='string'&&typeof node.storeId==='string') { /* local control binding */ }
        else if(field==='ownerId'){
          const bound={ownerId:value,scope:['personal','project'].includes(node.scope)?node.scope:'owner',projectId:node.projectId??''};
          if(contentSuppressionReasonInside(db,bound))fail('evidence_unavailable');
        }
        else if(['mocId','parentId','parentIds','parentL2Ids','childId'].includes(field)){for(const key of Array.isArray(value)?value:[value])mocIdentity(key,ns);}
        else if(identityField.test(field)&&!opaque.has(field)&&!opaqueRefs.has(field)){
          if(contentRefs.has(field)&&typeof value==='object') {
            if(Array.isArray(value)&&value.some(ref=>!ref||typeof ref!=='object'))fail('evidence_unavailable');
            walk(value,ns,field.replace(/Refs?$/,''),audit);
          }
          else fail('evidence_unavailable');
        }
        if(typeof value==='object')walk(value,ns,field==='entity'&&node.entity?.type==='memory'?'memory':field==='entity'&&node.entity?.type==='card'?'card':field,audit);
      }
    }
    const validateRows=lineage?(_db,_ceilings,work)=>work():withContentSuppressionCeilingsInside;
    {
      const sourceMethods=new Set(['forget','correct','deleteSourceNote','deleteConversation','setRawCaptureControl']);
      let sourceOperation=false;
      for(let context=operation;context;context=context.parent)sourceOperation ||= sourceMethods.has(context.method);
      // Review rejection and either episode cascade also run forgetMutation.
      // Their actual terminal Memory fact selects validation without expanding
      // the method classification or granting authority to ordinary writes.
      sourceOperation ||= terminalFacts.some(f=>f.kind==='memory'&&f.match_mode==='incarnation');
      // Only this operation's declared terminal Card may be user-deleted.
      // Match its canonical acknowledgement, scoped fact and request claim;
      // a second purge fact cannot declare another target for the operation.
      const declaredCardDeletion=row=>operation.method==='deleteKnowledgeCard'&&
        CONTENT_TERMINAL_FIELDS[operation.method]==='private_cards.id'&&
        scopes.some(ns=>JSON.stringify(boundary(ns))===JSON.stringify(boundary(namespace(row))))&&
        row.id===result?.[CONTENT_TERMINAL_ACK_FIELDS[operation.method]]&&
        terminalFacts.some(f=>f.kind==='card'&&f.match_mode==='incarnation'&&
          contentSuppressionTargetMatches(f,namespace(row),{kind:'card',key:row.id})&&
          canonical.some(c=>c.table==='card_body_authorizations'&&!c.old&&c.row.method===operation.method&&
            c.row.request_target===row.id&&c.row.host_action_id===f.action_id&&
            JSON.stringify(boundary(namespace(c.row)))===JSON.stringify(boundary(namespace(row)))));
      // Older suppression-enabled layouts have the same native deletion and
      // operation receipt, but no lineage authorization table. Keep that
      // existing terminal path under the common closure audit as well.
      const legacyCardDeletion=row=>!lineage&&operation.method==='deleteKnowledgeCard'&&
        CONTENT_TERMINAL_FIELDS[operation.method]==='private_cards.id'&&
        row.id===result?.[CONTENT_TERMINAL_ACK_FIELDS[operation.method]]&&
        terminalFacts.some(f=>f.kind==='card'&&f.match_mode==='incarnation'&&
          contentSuppressionTargetMatches(f,namespace(row),{kind:'card',key:row.id}));
      // Every existing engine transition has one explanation and one closure
      // audit, including declared deletion and internal maintenance transactions.
      // An empty allowance freezes every declared structural reference table.
      const frozenCardRows=Object.fromEntries(Object.keys(engineCardClosureReferences).map(table=>[table,[]]));
      const before=c=>c.old?Object.fromEntries(c.columns.map((column,i)=>
        [column.name,c.old[i]===undefined?c.row[column.name]:c.old[i]])):null;
      function engineClosure(change) {
        const row=change.row,ns=namespace(row),key=row.id;
        const keys=new Set([key,before(change)?.id]);keys.delete(undefined);
        const sameNamespace=value=>JSON.stringify(boundary(namespace(value)))===JSON.stringify(boundary(ns));
        const effects=canonical.filter(c=>c.table==='card_effects'&&c.row.entity_type==='card'&&keys.has(c.row.entity_id));
        const facts=canonical.filter(c=>c.table==='content_suppressions'&&c.row.kind==='card'&&keys.has(c.row.stable_key));
        const purged=change.old&&row.state==='deleted'&&row.title===null&&row.body===null&&
          row.revision===oldValue(change,'revision')+1&&scopes.some(s=>JSON.stringify(boundary(s))===JSON.stringify(boundary(ns)))&&
          engineCardMetadataInside(db,ns,row)&&change.columns.every((c,i)=>
            ['id','state','revision','title','body','updated_at'].includes(c.name)||change.old[i]===undefined)&&
          effects.length===1&&!effects[0].old&&effects[0].row.kind==='card_deleted'&&
          effects[0].row.revision===row.revision&&sameNamespace(effects[0].row)&&
          facts.length===1&&!facts[0].old&&facts[0].row.reason==='purge'&&facts[0].row.match_mode==='incarnation'&&
          facts[0].row.action_id===effects[0].row.action_id&&contentSuppressionTargetMatches(facts[0].row,ns,{kind:'card',key});
        // The suppression writer inserts this reservation only on first purge.
        // Existing reservations are not rewritten; updates/removals never qualify.
        const reservations=canonical.filter(c=>c.table==='content_identity_reservations'&&!c.old&&
          sameNamespace(c.row)&&c.row.kind==='card'&&c.row.stable_key===key&&c.row.incarnation===key&&
          c.row.evidence_origin==='writer'&&facts.length===1&&facts[0].row.evidence_origin==='writer');
        const purgeWrites=()=>({...frozenCardRows,private_cards:[change],card_effects:effects,content_suppressions:facts,
          content_identity_reservations:reservations,
          ...Object.fromEntries([...bindingTables,'card_current_dependencies'].map(table=>[table,
            removed.filter(c=>c.table===table&&keys.has(c.row.card_id))]))});
        const ownAction=purged?effects[0].row.action_id:null;
        const receipts=canonical.filter(c=>c.table==='card_operations'&&!c.old&&c.row.action_id===ownAction&&
          c.row.method===operation.method&&c.row.target_id===key&&sameNamespace(c.row)&&c.row.result===JSON.stringify(result));
        const authorizations=canonical.filter(c=>c.table==='card_body_authorizations'&&!c.old&&
          c.row.host_action_id===ownAction&&c.row.method===operation.method&&c.row.request_target===key&&
          c.row.authorization_kind==='operation'&&c.row.card_id===null&&sameNamespace(c.row)&&
          c.row.actor_id&&c.row.authorized_at&&receipts.length===1&&
          c.row.payload_binding===lineageHmac(identity,'card-action-audit-s2-v1',
            [identity.storeId,row.owner_id,ownAction,receipts[0].row.payload_binding]));
        // Predicates retain their existing proofs. Allowances add no authority.
        const paths=[
          {accept:purged&&sourceOperation&&engineForgottenCard(key,ns),writes:purgeWrites},
          {accept:purged&&(lineage?declaredCardDeletion(row):legacyCardDeletion(row))&&receipts.length===1&&
              authorizations.length===(lineage?1:0),
            writes:()=>({...purgeWrites(),card_operations:receipts,card_body_authorizations:authorizations})},
          {accept:engineMemoryInvalidatedCard(key,ns),
            writes:()=>({...frozenCardRows,private_cards:[change],card_effects:effects})},
          {accept:operation.method==='maintainCards'&&purged,writes:purgeWrites},
          {accept:row.state!=='deleted'&&engineRetiredCard(key,ns),
            writes:()=>({...frozenCardRows,private_cards:[change]})},
        ].filter(path=>path.accept);
        if(paths.length!==1)fail('evidence_unavailable');
        const allowed=paths[0].writes();
        for(const c of [...canonical,...removed])if(closureRowReferencesCard(c.table,c.row,keys)||c.old&&closureRowReferencesCard(c.table,before(c),keys)) {
          if(!Object.hasOwn(allowed,c.table)||!allowed[c.table].includes(c))fail('evidence_unavailable');
        }
        if(purged)for(const table of [...bindingTables,'card_current_dependencies'])if(exists(table)&&
          [...keys].some(id=>db.prepare('SELECT 1 FROM '+quote(table)+' WHERE card_id=? LIMIT 1').get(id)))fail('evidence_unavailable');
      }
      if(removed.some(c=>c.table==='private_cards'&&isEngineCard(c.row.id)))fail('evidence_unavailable');
      for(const change of canonical)if(change.table==='private_cards'&&
        (isEngineCard(change.row.id)||isEngineCard(before(change)?.id))&&
        (change.old||['deleted','cancelled'].includes(change.row.state)))engineClosure(change);
      if(lineage&&(!sourceOperation||operation.method==='deleteKnowledgeCard')&&operation.method!=='maintainCards'&&canonical.some(c=>
        c.table==='private_cards'&&isEngineCard(c.row.id)&&c.row.state==='deleted'&&!declaredCardDeletion(c.row)))fail('evidence_unavailable');
      if(lineage&&sourceOperation) {
        // Audit removals have no surviving row for generic reference walking.
        // Validate effects even when the source writer leaves its Card untouched.
        if(removed.some(c=>c.table==='card_effects'))fail('evidence_unavailable');
        for(const {table,row,old}of canonical) {
          if(['card_body_sources','card_body_provenance'].includes(table)||table==='card_body_authorizations'&&row.authorization_kind!=='operation')fail('evidence_unavailable');
          if(table==='private_cards'&&!engineForgottenCard(row.id,namespace(row))&&!engineMemoryInvalidatedCard(row.id,namespace(row))&&!lineageInvalidatedCard(row.id,namespace(row)))fail('evidence_unavailable');
          if(table==='card_effects'&&(old||row.entity_type==='card'&&!engineForgottenCard(row.entity_id,namespace(row))&&!engineMemoryInvalidatedCard(row.entity_id,namespace(row))&&!lineageInvalidatedCard(row.entity_id,namespace(row))))fail('evidence_unavailable');
        }
      }
    }
    validateRows(db,ceilings,()=>{
      for(const {table,row}of canonical){
        if(lineage&&['card_body_sources','card_body_provenance','card_body_authorizations'].includes(table)) {
          // Authority rows are immutable typed records, never a request to read
          // their historical source identities through generic FK/ID walking.
          const change=canonical.find(c=>c.table===table&&c.row===row);
          if(change.old)fail('evidence_unavailable');
          const publicNs=publicNamespaceForAuthority(row);
          if(table==='card_body_authorizations'&&row.authorization_kind==='operation') {
            const receipt=db.prepare('SELECT * FROM card_operations WHERE owner_id=? AND action_id=?').get(row.owner_id,row.host_action_id);
            if(!receipt||receipt.scope!==row.scope||receipt.project_id!==row.project_id||receipt.method!==row.method||!row.actor_id||!row.authorized_at||
              row.payload_binding!==lineageHmac(identity,'card-action-audit-s2-v1',[identity.storeId,row.owner_id,row.host_action_id,receipt.payload_binding]))fail('evidence_unavailable');
          } else loadCardBodyContributorsInside(db,identity,publicNs,row.card_id,{validateSource:ref=>sourceReadSafety(db,{identity,namespace:publicNs,ref}).allowed});
          continue;
        }
        if(table.startsWith('content_')||table==='owner_suppression_epochs')continue; // same-transaction safety/audit records
        const ns=namespace(row)??scopes[0]??null,audit=/_effects$|_operations$|^confirmation_/.test(table);
        if(namespace(row)&&contentSuppressionReasonInside(db,namespace(row)))fail('evidence_unavailable');
        for(const foreign of db.prepare('PRAGMA foreign_key_list('+quote(table)+')').all()) {
          const kind=kinds[foreign.table];
          if(kind&&foreign.to==='id'&&row[foreign.from]!=null)check(kind,row[foreign.from],ns,undefined,{},audit);
        }
        if(table==='episode_sources')episodeSource(row.id,ns);
        if(table==='index_memories')check('memory',row.id,ns,row.revision);
        if(table==='raw_deletion_effects'&&kinds[{memory:'memories',receipt:'receipts',card:'private_cards'}[row.entity_type]])
          check(row.entity_type,row.entity_id,ns,undefined,{},true);
        if(table==='card_operations'&&row.target_id)generic(row.target_id,ns,row.method,true);
        if(kinds[table])check(kinds[table],row.id,ns,row.revision,{},audit);
        if(['mocs','card_mocs'].includes(table))metadataIdentity(table,row.id,ns);
        for(const [column,value]of Object.entries(row)) {
          if(value===null)continue;
          if(column==='source_id'&&table==='raw_deletion_effects') {
            if(row.source_type==='conversation')check('raw',value,ns,undefined,{},audit);
            else if(row.source_type==='episode')metadataIdentity('session_episodes',value,ns);
            else fail('evidence_unavailable');
            continue;
          }
          const field=camel(column),kind=column==='source_id'&&table==='episode_sources'||['method_changes','role_profile_changes','role_profile_releases'].includes(table)&&['from_id','to_id','predecessor_id'].includes(column)?null:referenceKinds(field);
          if(kind&&!jsonColumns.has(column))check(kind,value,ns,referenceRevision(column,row),{messageId:row.message_id,start:row.start,end:row.end},audit);
          else if(['moc_id','parent_id','child_id','memory_moc_id','card_moc_id'].includes(column))mocIdentity(value,ns);
          else if((column==='from_receipt'||column==='to_receipt'))check('receipt',value,ns,undefined,{},audit);
          else if(column==='target_id'&&table==='confirmation_conflicts')check('memory',value,ns,row.target_revision);
          else if(column==='entity_id'&&['memory','receipt','card','submitted-note','raw'].includes(row.entity_type))check(row.entity_type,value,ns,row.revision,{},audit);
          if(jsonColumns.has(column)&&typeof value==='string'){
            let parsed;try{parsed=JSON.parse(value);}catch{fail('evidence_unavailable');}
            if(column==='keep_source_ids')for(const key of parsed)episodeSource(key,ns);
            else if(['receipt_ids','previous_receipt_ids','memory_ids'].includes(column))for(const key of parsed)check(column==='memory_ids'?'memory':'receipt',key,ns,undefined,{},audit);
            else walk(parsed,ns,column==='result'?operation.method:column,audit);
          }
        }
      }
      walk(result);
    });
    function publicNamespaceForAuthority(row){return {ownerId:row.owner_id,scope:row.scope,projectId:row.project_id||null};}
  }};
}
registerContentWriteGuard(beginContentWriteSafety);

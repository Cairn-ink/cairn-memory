import { hasCardLineage, cardLineageItemInside, cardLineageNamespaceInside } from './card-lineage.mjs';
import { contentSuppressionReasonInside, cachedContentSuppressionRequestInside, contentSuppressionMayMatchInside } from './content-suppression-storage.mjs';
import { cachedContentLayout } from './content-safety-schema.mjs';
import { contentReadSafety, memoryReadEligible, receiptReadSafety, anchoredReadSafety, createContentReadMemo, isEngineCard, engineCardRevisionsInside } from './content-safety.mjs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { createQualificationStorage } from './claim-qualification-storage.mjs';
import { evidenceInput, evidenceRefs } from './private-evidence-input.mjs';
import { keyed } from './private-card-input.mjs';
import { fail } from './validation.mjs';
import { receiptSourceTimeProbe } from './context-read-assembly.mjs';

const where = 'owner_id=? AND scope=? AND project_id=?';
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId ?? ''];
const size = value => Buffer.byteLength(JSON.stringify({ ok: true, value }), 'utf8');
const words = text => new Set(text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? []);
const attribution = { status: 'unassessed', commitment: 'unknown' };

/** All methods run synchronously inside the caller's shared SQLite transaction.
 * The only callbacks are internal canonical readers, never host/model ports. */
export function createPrivateEvidenceStorage({ db, identity, cardDetailInside, receiptRefInside, memoReceiptEventTime = false }) {
  const bind = (purpose, value) => keyed(identity.cursorSecret, purpose, [identity.storeId, value]);
  const qualification = createQualificationStorage({ db, receiptKey: receipt =>
    createHash('sha256').update(JSON.stringify(receipt)).digest('hex') });
  const generations = ns => ({ memory: db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`)
    .get(...boundary(ns))?.epoch ?? 1,
  card: db.prepare(`SELECT generation FROM card_epochs WHERE ${where}`).get(...boundary(ns))?.generation ?? 1,
  ...cardLineageNamespaceInside(db,ns) });
  function encode(purpose, value, maximum) {
    const body = Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${body}.${bind(purpose, body)}`;
    if (token.length > maximum) fail('context_item_too_large');
    return token;
  }
  function decode(purpose, token, code) {
    const [body, signature, extra] = token.split('.');
    if (extra !== undefined || !body || !signature || !/^[A-Za-z0-9_-]+$/.test(body)) fail(code);
    const expected = Buffer.from(bind(purpose, body));
    const supplied = Buffer.from(signature);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) fail(code);
    try {
      const bytes = Buffer.from(body, 'base64url');
      if (bytes.toString('base64url') !== body) fail(code);
      return JSON.parse(bytes.toString('utf8'));
    } catch { fail(code); }
  }
  function memoryRow(ns, id, memo) {
    const key=JSON.stringify([boundary(ns),id]);
    if(memo?.evidenceMemories?.has(key))return memo.evidenceMemories.get(key);
    const layout = cachedContentLayout(db);
    const ancestry = layout?.suppressionRevision && layout.rawLineage ? `,EXISTS(
      SELECT 1 FROM receipts ar JOIN raw_receipt_lineage al ON al.receipt_id=ar.id
      LEFT JOIN raw_conversations ac ON ac.id=al.conversation_id WHERE ar.memory_id=memories.id
      AND (ac.owner_id IS NOT memories.owner_id OR ac.scope IS NOT memories.scope OR ac.project_id IS NOT memories.project_id)) AS invalid_raw_ancestry` : '';
    return db.prepare(`SELECT *${ancestry} FROM memories WHERE ${where} AND id=? AND deleted=0`).get(...boundary(ns), id);
  }
  function memoryBatchInside(ns, refs, memo) {
    if(!cachedContentLayout(db)?.suppressionRevision || !db.isTransaction)return;
    const cache=memo.evidenceMemories??=new Map();
    const ids=[...new Set(refs.filter(ref=>ref.type==='memory' &&
      JSON.stringify(boundary(ref.namespace))===JSON.stringify(boundary(ns))).map(ref=>ref.memoryId))]
      .filter(id=>!cache.has(JSON.stringify([boundary(ns),id])));
    if(!ids.length)return;
    const layout=cachedContentLayout(db);
    const ancestry=layout.rawLineage ? `,EXISTS(
      SELECT 1 FROM receipts ar JOIN raw_receipt_lineage al ON al.receipt_id=ar.id
      LEFT JOIN raw_conversations ac ON ac.id=al.conversation_id WHERE ar.memory_id=memories.id
      AND (ac.owner_id IS NOT memories.owner_id OR ac.scope IS NOT memories.scope OR ac.project_id IS NOT memories.project_id)) AS invalid_raw_ancestry,
      (SELECT count(*) FROM sqlite_master WHERE type='table' AND name IN (
        'raw_conversations','raw_messages','raw_source_maps','raw_source_exclusions','raw_receipt_lineage',
        'raw_session_fences','raw_deletion_actions','raw_receipt_origins','raw_job_sources','episode_identity',
        'session_episodes','episode_messages','episode_sources','episode_memory_links','episode_keep_actions'))=15 AND
      EXISTS(SELECT 1 FROM episode_identity WHERE singleton=1 AND length(secret)=64 AND secret NOT GLOB '*[^0-9a-f]*') AND
      NOT EXISTS(SELECT 1 FROM receipts ar WHERE ar.memory_id=memories.id AND (
        EXISTS(SELECT 1 FROM raw_receipt_lineage l WHERE l.receipt_id=ar.id) OR
        EXISTS(SELECT 1 FROM raw_receipt_origins o WHERE o.receipt_id=ar.id AND o.kind!='independent') OR
        EXISTS(SELECT 1 FROM episode_memory_links k WHERE k.memory_id=memories.id) OR
        EXISTS(SELECT 1 FROM raw_conversations c WHERE c.owner_id=memories.owner_id AND c.scope=memories.scope AND c.project_id=memories.project_id AND c.client=ar.client) OR
        EXISTS(SELECT 1 FROM session_episodes e WHERE e.owner_id=memories.owner_id AND e.scope=memories.scope AND e.project_id=memories.project_id AND e.client=ar.client) OR
        EXISTS(SELECT 1 FROM raw_job_sources j WHERE j.owner_id=memories.owner_id AND j.scope=memories.scope AND j.project_id=memories.project_id AND j.source_client=ar.client) OR
        EXISTS(SELECT 1 FROM raw_session_fences f WHERE f.owner_id=memories.owner_id AND f.scope=memories.scope AND f.project_id=memories.project_id AND f.client=ar.client)
      )) AS empty_raw_ancestry` : '';
    // The existing Memory SELECT now covers the bounded candidate batch and
    // its original receipt page. Root absence is deliberately broader than a
    // session-key match: any possible source/fence keeps the lineage fallback.
    // Two fixed projections; the facade fixes this boolean for its open lifetime.
    const memoReceiptProjection = memoReceiptEventTime
      ? `json_object('id',id,'memory_id',memory_id,'receipt_key',receipt_key,
        'client',client,'session_id',session_id,'event_id',event_id,'role',role,'excerpt',excerpt,'created_at',created_at,'occurred_at',occurred_at)`
      : `json_object('id',id,'memory_id',memory_id,'receipt_key',receipt_key,
        'client',client,'session_id',session_id,'event_id',event_id,'role',role,'excerpt',excerpt,'created_at',created_at)`;
    const sourceTimes=memo.sourceDates && layout.rawLineage ? `,(SELECT json_group_array(r.id)
      FROM (SELECT id FROM receipts WHERE memory_id=memories.id ORDER BY created_at,id LIMIT 17) r
      WHERE ${receiptSourceTimeProbe}) AS source_time_receipts` : '';
    const rows=db.prepare(`SELECT memories.*${ancestry}${sourceTimes},
      EXISTS(SELECT 1 FROM memory_qualifications q WHERE q.memory_id=memories.id) AS has_qualification,
      (SELECT json_group_array(${memoReceiptProjection})
        FROM (SELECT * FROM receipts WHERE memory_id=memories.id ORDER BY created_at,id LIMIT 17)) AS batch_receipts
      FROM memories WHERE ${where} AND deleted=0 AND id IN (${ids.map(()=>'?').join(',')})`).all(...boundary(ns),...ids);
    for(const id of ids)cache.set(JSON.stringify([boundary(ns),id]),undefined);
    for(const row of rows)cache.set(JSON.stringify([boundary(ns),row.id]),row);
  }
  function selectedReceiptRef(ns,row,receipt) {
    return {type:'receipt',namespace:ns,memoryId:row.id,memoryRevision:row.revision,receiptId:receipt.id,
      contentIdentity:bind('retained-receipt-content-v1',[ns,row.id,row.revision,receipt.id,receipt.client,
        receipt.session_id,receipt.event_id,receipt.role,receipt.excerpt]),completeness:'excerpt-only'};
  }
  function memoryMetadata(ns, row) {
    return { type: 'memory', ref: { type: 'memory', namespace: ns, memoryId: row.id, revision: row.revision },
      state: row.currentness === 'current' ? 'active' : 'historical', reviewState: row.review_state,
      filing: { status: row.filing_status }, kind: row.kind, origin: row.origin, confidence: row.confidence };
  }
  function cardMetadata(card) {
    return { type: 'card', ref: { type: 'card', namespace: card.namespace, cardId: card.id,
      revision: card.revision, bodyRevision: card.bodyRevision }, state: card.state,
    support: card.support, origin: card.origin,
    ...(card.origin === 'engine' ? { builtAt: card.builtAt, clusterKey: card.clusterKey,
      status: card.status, sourceRevisions: card.sourceRevisions } : {}) };
  }
  const cardEligible = (ns, card, intent, memo) => Boolean(card && contentReadSafety(db, { identity, namespace: ns, intent, memo,
    ref: { type: 'card', namespace: ns, cardId: card.id, revision: card.revision, bodyRevision: card.bodyRevision },
    currentCardEligible: () => card.support.status === 'eligible' && card.support.applicability === 'current' &&
      (!card.support.currentDependency || card.support.currentDependency.status === 'current') }).allowed);
  const memoryEligible = (ns, row, intent) => Boolean(row && contentReadSafety(db, { identity, namespace: ns, intent,
    ref: { type: 'memory', namespace: ns, memoryId: row.id, revision: row.revision } }).allowed);
  function item(ns, ref, intent, readSet, options, memo = createContentReadMemo(db)) {
    if (ref.type === 'card') {
      const card = cardDetailInside(ns, ref.cardId, readSet, { ...options, safetyMemo: memo });
      if (!cardEligible(ns, card, intent, memo)) fail('evidence_unavailable');
      if (card.revision !== ref.revision || card.bodyRevision !== ref.bodyRevision) fail('revision_conflict');
      const sources = card.bindings.map(binding => binding.source);
      return { ...cardMetadata(card), title: card.title, body: card.body,
        qualification: { applicability: card.support.applicability, attribution: 'unassessed', commitment: 'unknown' },
        provenance: { sources, completeness: sources.some(source => source.type === 'raw') ?
          sources.every(source => source.type === 'raw') ? 'selected-raw-span' : 'mixed-sources' : sources.every(source => source.type === 'submitted-note') ?
          'provided-note' : 'excerpt-only', conversationCoverage: 'unknown', meaning: 'unassessed',
        support: card.support.status, corroboration: 'not-assessed',
        coverage: { status: 'complete', included: sources.length, omitted: 0 } },
        bindings: card.bindings, triggerMemoryRefs: card.triggerMemoryRefs };
    }
    const row = memoryRow(ns, ref.memoryId, options?.legacyEvidence?undefined:memo);
    const safety = Boolean(!options?.legacyEvidence && row && cachedContentLayout(db)?.suppressionRevision &&
      memo.evidenceMemories?.get(JSON.stringify([boundary(ns),row.id]))===row);
    // The selected canonical row and receipts belong to this synchronous
    // snapshot. One S1+fact decision below owns their combined validation.
    if (safety ? !memoryReadEligible(row, intent) : !memoryEligible(ns, row, intent)) fail('evidence_unavailable');
    if (safety && row.revision !== ref.revision) {
      // Preserve the original unavailable-before-revision-conflict order.
      if (!contentReadSafety(db,{identity,namespace:ns,intent,memo,selectedMemory:row,
        ref:{...ref,revision:row.revision}}).allowed) fail('evidence_unavailable');
    }
    if (row.revision !== ref.revision) fail('revision_conflict');
    const projected=safety;
    const selectedReceipts=projected?JSON.parse(row.batch_receipts):undefined;
    const allReceiptRows = selectedReceipts ?? db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY created_at,id LIMIT 17').all(row.id);
    const receiptRows = allReceiptRows.filter(receipt => receiptReadSafety(db, { namespace: ns, receipt, memo,
      rawAncestryEmpty:projected && row.empty_raw_ancestry===1 && !contentSuppressionMayMatchInside(db,ns,{kind:'receipt',key:receipt.id}) }).allowed);
    if(selectedReceipts)(memo.evidenceReceipts??=new Map()).set(JSON.stringify([boundary(ns),row.id]),selectedReceipts);
    if (!contentReadSafety(db, { identity, namespace: ns, ref, intent, memo, ...(safety ? { selectedMemory: row, selectedReceipts } : {}), receipts: receiptRows.slice(0, 16) }).allowed) fail('evidence_unavailable');
    const sourceAccess = memoryReadEligible(row) ? 'available' : 'unavailable-for-noncurrent-memory';
    const sources = sourceAccess === 'available' ? receiptRows.slice(0, 16).map(receipt => selectedReceipts?selectedReceiptRef(ns,row,receipt):receiptRefInside(ns, row, receipt)) : [];
    const projection = projected && row.has_qualification===0 ? null : qualification.inspect(row);
    const assessed = projection && anchoredReadSafety(db, { namespace: ns, memoryId: row.id, anchors: projection.anchors, memo }).allowed ? projection : null;
    const qualified = assessed ? { ...assessed, sourceText: 'read-separately',
      anchors: assessed.anchors.map(({ text, ...anchor }) => anchor) } : null;
    return { ...memoryMetadata(ns, row), content: row.content, qualification: qualified,
      provenance: { sources, sourceAccess,
        receiptMetadata: receiptRows.slice(0, 16).map(receipt => ({ memoryId: row.id,
          memoryRevision: row.revision, receiptId: receipt.id })),
        completeness: 'excerpt-only', conversationCoverage: 'unknown',
        meaning: 'unassessed', attribution, corroboration: 'not-assessed',
        coverage: { status: allReceiptRows.length > 16 || receiptRows.length !== allReceiptRows.length ? 'budget_exhausted' : 'complete', included: Math.min(receiptRows.length, 16),
          omitted: allReceiptRows.length > 16 ? null : allReceiptRows.length - receiptRows.length } } };
  }
  function makeSnapshot(ns, intent, refs, items, accessGeneration) {
    return encode('evidence-snapshot-v1', { version: 1,
      binding: bind('evidence-scope-v1', ns), intent, refs,
      generations: generations(ns), accessGeneration,
      fences: items.map(value => bind('evidence-item-v1', cardLineageItemInside(db,value))) }, 16384);
  }
  function fetched(ns, input, accessGeneration) {
    const memo = createContentReadMemo(db), items = input.refs.map(ref => item(ns, ref, input.intent, undefined, undefined, memo));
    const result = { items, snapshot: makeSnapshot(ns, input.intent, input.refs, items, accessGeneration) };
    if (size(result) > input.responseByteLimit) fail('context_item_too_large');
    return result;
  }
  function revalidate(ns, input, accessGeneration) {
    const previous = decode('evidence-snapshot-v1', input.snapshot, 'invalid_snapshot');
    if (previous.binding !== bind('evidence-scope-v1', ns) || previous.version !== 1 ||
        !['current', 'history'].includes(previous.intent)) fail('invalid_snapshot');
    if (JSON.stringify(previous.generations) !== JSON.stringify(generations(ns)) ||
        previous.accessGeneration !== accessGeneration) fail('snapshot_stale');
    // Empty selections also have a meaningful generation fence.
    const refs = previous.refs.length ? evidenceRefs(previous.refs, ns) : [];
    const memo = createContentReadMemo(db), items = refs.map(ref => item(ns, ref, previous.intent, undefined, undefined, memo));
    if (JSON.stringify(previous.fences) !== JSON.stringify(items.map(value => bind('evidence-item-v1', cardLineageItemInside(db,value))))) fail('snapshot_stale');
    const result = { items, snapshot: makeSnapshot(ns, previous.intent, refs, items, accessGeneration) };
    if (size(result) > input.responseByteLimit) fail('context_item_too_large');
    return result;
  }
  function select(ns, input, original, accessGeneration) {
    const memo = createContentReadMemo(db), started = performance.now(), captured = generations(ns);
    const binding = bind('evidence-query-v1', [ns, input]);
    let previous;
    if (original.cursor !== undefined) {
      previous = decode('evidence-cursor-v1', original.cursor, 'invalid_cursor');
      if (previous.binding !== binding) fail('invalid_cursor');
      if (JSON.stringify(previous.generations) !== JSON.stringify(captured) ||
          previous.accessGeneration !== accessGeneration) fail('cursor_stale');
    }
    const after = previous?.after ?? Object.fromEntries(input.types.map(type => [type, '']));
    let turn = previous?.turn ?? 0, scannedRows = 0, scannedBodyUnits = 0, stopped = null;
    const byType = Object.fromEntries(input.types.map(type => [type, { scanned: 0, included: 0, partial: true }]));
    const exhausted = new Set(), blocked = new Set(), matches = [], queryWords = words(input.query);
    function next(type, metadataOnly = false) {
      let candidateAfter = after[type];
      const layout=cachedContentLayout(db);
      let columns = metadataOnly ? (layout?.suppressionRevision
        ? 'id,revision'+(type==='card'?',body_revision':'') : 'id') : '*';
      if(type==='memory'&&layout?.suppressionRevision&&layout.rawLineage)columns+=`,EXISTS(
        SELECT 1 FROM receipts ar JOIN raw_receipt_lineage al ON al.receipt_id=ar.id
        LEFT JOIN raw_conversations ac ON ac.id=al.conversation_id WHERE ar.memory_id=memories.id
        AND (ac.owner_id IS NOT memories.owner_id OR ac.scope IS NOT memories.scope OR ac.project_id IS NOT memories.project_id)) AS invalid_raw_ancestry`;
      while (true) {
        const row = type === 'memory' ? db.prepare(`SELECT ${columns} FROM memories WHERE ${where}
        AND deleted=0 AND id>? ORDER BY id LIMIT 1`).get(...boundary(ns), candidateAfter) :
          db.prepare(`SELECT ${columns} FROM private_cards WHERE ${where} AND state='confirmed' AND id>? ORDER BY id LIMIT 1`)
            .get(...boundary(ns), candidateAfter);
        if (!row || type !== 'card' || !isEngineCard(row.id)) return row;
        // The query guarantees confirmed state, including metadata-only peeks.
        // Legacy peeks select only id; fetch the full candidate only for engines.
        const candidate = row.revision === undefined ?
          db.prepare(`SELECT * FROM private_cards WHERE ${where} AND state='confirmed' AND id>? ORDER BY id LIMIT 1`)
            .get(...boundary(ns), candidateAfter) : { ...row, state: 'confirmed' };
        if (engineCardRevisionsInside(db, ns, candidate) &&
          contentReadSafety(db, { identity, namespace: ns, memo, method: 'getCard',
            ref: { type: 'card', namespace: ns, cardId: candidate.id,
              revision: candidate.revision, bodyRevision: candidate.body_revision } }).allowed) return row;
        // Advance only this private scan position. Denied engines never enter
        // contributor checks, body budgets, counts, stream turns or cursor ids.
        candidateAfter = row.id;
      }
    }
    function assertContributor(type,row,peek=false) {
      const layout=cachedContentLayout(db);
      if(!row || !layout?.suppressionRevision)return;
      if(type==='memory'){
        if(row.invalid_raw_ancestry||contentSuppressionReasonInside(db,ns,{kind:'memory',key:row.id,
          revision:row.revision,version:JSON.stringify(['memory-revision-v1',row.revision]),
          ancestryChecked:!layout.rawLineage||Object.hasOwn(row,'invalid_raw_ancestry')}))fail('evidence_unavailable');
        return;
      }
      const proof=cachedContentSuppressionRequestInside(db,ns.ownerId);
      if(peek&&!hasCardLineage(db)&&proof?.facts?.length===0&&proof.readSet.some(n=>n.scope==='owner'||n.scope===ns.scope&&(n.projectId??'')===(ns.projectId??'')))return;
      // Share this decision with the existing detail read, including its
      // contributor/source memo. No extra canonical pass per scanned Card.
      if(!contentReadSafety(db,{identity,namespace:ns,memo,method:'getCard',
        ref:{type:'card',namespace:ns,cardId:row.id,revision:row.revision,bodyRevision:row.body_revision}}).allowed)fail('evidence_unavailable');
    }
    while (matches.length < input.limit && exhausted.size + blocked.size < input.types.length) {
      if (scannedRows >= input.scanRows) { stopped = 'row_budget'; break; }
      if (performance.now() - started >= input.deadlineMs) { stopped = 'deadline'; break; }
      const type = input.types[turn];
      turn = (turn + 1) % input.types.length;
      if (exhausted.has(type) || blocked.has(type)) continue;
      const row = next(type);
      if (!row) { exhausted.add(type); continue; }
      // Scanned counts, body-unit budgets and cursor identities are outputs.
      assertContributor(type,row);
      const text = type === 'memory' ? row.content : `${row.title}\n${row.body}`;
      if (scannedBodyUnits + text.length > input.scanBodyUnits) { blocked.add(type); stopped = 'body_budget'; continue; }
      after[type] = row.id; scannedRows++; scannedBodyUnits += text.length; byType[type].scanned++;
      const card = type === 'card' ? cardDetailInside(ns, row.id, undefined, { safetyMemo: memo }) : null;
      if (type === 'memory' ? !memoryReadEligible(row, input.intent) : !cardEligible(ns, card, input.intent, memo)) continue;
      const recordWords = words(text);
      const score = [...queryWords].reduce((total, word) => total + Number(recordWords.has(word)), 0);
      if (!score) continue;
      if (type === 'memory' && !memoryEligible(ns, row, input.intent)) continue;
      matches.push({ ...(type === 'memory' ? memoryMetadata(ns, row) : cardMetadata(card)), score });
      byType[type].included++;
    }
    // A metadata-only bounded peek tells callers which streams actually ended.
    for (const type of input.types) if (!blocked.has(type)) {
      const peek=next(type,true);assertContributor(type,peek,true);if(!peek)exhausted.add(type);
    }
    const complete = exhausted.size === input.types.length;
    for (const type of input.types) byType[type].partial = !exhausted.has(type);
    matches.sort((left, right) => right.score - left.score || input.types.indexOf(left.type) - input.types.indexOf(right.type) ||
      ((left.ref.memoryId ?? left.ref.cardId) < (right.ref.memoryId ?? right.ref.cardId) ? -1 : 1));
    const refs = matches.map(value => value.ref), items = refs.map(ref => item(ns, ref, input.intent, undefined, undefined, memo));
    return { items: matches,
      coverage: { status: complete ? 'complete' : 'budget_exhausted', byType, scannedRows, scannedBodyUnits,
        reason: complete ? null : matches.length === input.limit ? 'item_limit' : stopped,
        ranking: 'literal-unicode-word-overlap', relevance: 'not-assessed' },
      nextCursor: complete ? null : encode('evidence-cursor-v1', { binding, generations: captured,
        accessGeneration, after, turn }, 8192),
      snapshot: makeSnapshot(ns, input.intent, refs, items, accessGeneration) };
  }
  return Object.freeze({
    // Internal U5 read seam: authorization and the deferred transaction belong
    // to the caller. Reuses the exact current/history canonical predicate/DTO.
    itemsInside(ns, refs, intent, readSet, options) {
      const memo = options?.safetyMemo ?? createContentReadMemo(db);
      if(!options?.legacyEvidence)memoryBatchInside(ns,options?.batchRefs??refs,memo);
      return refs.map(ref => item(ns, ref, intent, readSet, options, memo));
    },
    call(method, ns, original, accessGeneration) {
    const input = evidenceInput(method, original, ns);
    if (method === 'selectEvidence') return select(ns, input, original, accessGeneration);
    if (method === 'fetchEvidence') return fetched(ns, input, accessGeneration);
    return revalidate(ns, input, accessGeneration);
  } });
}

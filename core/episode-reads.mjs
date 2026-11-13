import { sourceDigest } from './procedural-storage.mjs';
import { cachedContentLayout } from './content-safety-schema.mjs';
import { contentReadSafety, receiptDenialsInside, createContentReadMemo } from './content-safety.mjs';
import { cachedContentSuppressionRequestInside, contentSuppressionReasonInside } from './content-suppression-storage.mjs';
import { transaction } from './database.mjs';
import { episodeClient, episodeMetadata, episodeReadRow, instant } from './episode-storage.mjs';
import { episodeSourceEvidenceCTE, episodeSourceEvidenceSQL, episodeSourceKeys } from './raw-lineage-storage.mjs';
import { fail, object, denseArray, identifier } from './validation.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId];
const where = alias => `${alias}.owner_id=? AND ${alias}.scope=? AND ${alias}.project_id=?`;
export const envelopeText = value => JSON.stringify({ ok: true, value });
export function rangeInput(input, operation) {
  const memory = operation === 'listMemoriesByTime';
  object(input, ['namespace','since','until','timeBasis','client','limit','cursor', ...(memory ? ['states'] : [])]);
  if (input.since === null || input.until === null) fail('invalid_input');
  const since = instant(input.since), until = instant(input.until);
  if (since >= until || Date.parse(until)-Date.parse(since) > 366*86400000) fail('invalid_input');
  const limit = input.limit === undefined ? 20 : input.limit;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) fail('invalid_input');
  const timeBasis = input.timeBasis === undefined ? (memory ? 'receipt' : 'event') : input.timeBasis;
  if (!(memory ? ['receipt','revision'] : ['event','receipt']).includes(timeBasis)) fail('invalid_input');
  const client = input.client === undefined ? null : episodeClient(input.client);
  let states = null;
  if (memory) {
    const supplied = input.states === undefined ? ['active'] : denseArray(input.states,1,2);
    if (supplied.some(state=>!['active','historical'].includes(state)) || new Set(supplied).size !== supplied.length) fail('invalid_input');
    states = ['active','historical'].filter(state=>supplied.includes(state));
  }
  return { since, until, timeBasis, client, limit, states };
}
export function rangeOrder(operation, filter) {
  return operation === 'listEpisodes' ? `${filter.timeBasis === 'event' ? 'eventEnd' : 'firstReceivedAt'}:desc,id:asc`
    : filter.timeBasis === 'receipt' ? 'receipt.createdAt:desc,receipt.id:asc,memory.id:asc' : 'updatedAt:desc,id:asc';
}
export function validateRangeAnchor(anchor, receipt) {
  try {
    object(anchor, receipt ? ['time','id','memoryId'] : ['time','id']);
    if (Object.keys(anchor).length !== (receipt ? 3 : 2)) fail('invalid_cursor');
    if (anchor.time === null) fail('invalid_cursor');
    instant(anchor.time); identifier(anchor.id);
    if (receipt) identifier(anchor.memoryId);
  } catch { fail('invalid_cursor'); }
}
// Export the exact production query builders for EXPLAIN assertions.
export function rangeQuery(ns, operation, f, after) {
  const params = boundary(ns), clauses = [], episode = operation === 'listEpisodes';
  let sql, time, id, memoryId;
  if (episode) {
    time = f.timeBasis === 'event' ? "json_extract(e.record,'$.eventEnd')" : 'e.first_received_at';
    id = 'e.id';
    sql = `SELECT e.* FROM session_episodes e INDEXED BY ${f.timeBasis === 'event' ? 'episode_event_read' : 'episode_receipt_read'}`;
    clauses.push(where('e'), 'e.deleted=0', 'e.id NOT IN (SELECT id FROM review_hidden_episodes)');
    if (f.timeBasis === 'event') {
      clauses.push(`${time}>=?`, "json_extract(e.record,'$.eventStart')<?"); params.push(f.since,f.until);
    } else { clauses.push(`${time}>=?`,`${time}<?`); params.push(f.since,f.until); }
    if (f.client !== null) { clauses.push('e.client=?'); params.push(f.client); }
  } else {
    const receipt = f.timeBasis === 'receipt';
    time = receipt ? 'r.created_at' : 'm.updated_at'; id = receipt ? 'r.id' : 'm.id'; memoryId = receipt ? 'r.memory_id' : null;
    sql = receipt ? `SELECT m.*,r.id AS receipt_id,r.created_at AS receipt_time,r.client AS receipt_client
      FROM receipts r INDEXED BY receipt_time_read CROSS JOIN memories m ON m.id=r.memory_id`
      : 'SELECT m.* FROM memories m INDEXED BY namespace_memories';
    clauses.push(where('m'), 'm.deleted=0', "m.review_state != 'awaiting'", `m.currentness IN (${f.states.map(()=>'?').join(',')})`, `${time}>=?`, `${time}<?`);
    params.push(...f.states.map(s=>s === 'active' ? 'current' : s), f.since, f.until);
    if (f.client !== null) {
      clauses.push(receipt ? 'r.client=?' : 'EXISTS (SELECT 1 FROM receipts r WHERE r.memory_id=m.id AND r.client=?)');
      params.push(f.client);
    }
  }
  if (after) {
    clauses.push(`${time}<=?`, `(${time}<? OR (${time}=? AND (${id}>?${memoryId ? ` OR (${id}=? AND ${memoryId}>?)` : ''})))`);
    params.push(after.time,after.time,after.time,after.id);
    if (memoryId) params.push(after.id,after.memoryId);
  }
  sql += ` WHERE ${clauses.join(' AND ')} ORDER BY ${time} DESC,${id} ASC${memoryId ? ','+memoryId+' ASC' : ''} LIMIT ?`;
  params.push(f.limit+1);
  return { sql, params };
}
export function memoryMetadata(row, decisionReview = false) {
  return { id: row.id, revision: row.revision, kind: row.kind, origin: row.origin, confidence: row.confidence,
    ...(decisionReview ? { reviewState: row.review_state } : {}),
    state: row.currentness === 'current' ? 'active' : 'historical', filingStatus: row.filing_status,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
// Two existing SELECTs share only engine-owned data inside one synchronous snapshot.
// Nothing here opens a file descriptor or survives a caller boundary.
export function createEpisodeReadProjection({ db, epoch }) {
  return function begin(ns, query, expectedEpoch) {
    const layout = cachedContentLayout(db);
    if (!layout?.suppressionRevision) return { epoch: epoch(ns), query };
    if (!db.isTransaction) fail('storage_error');
    const proof = cachedContentSuppressionRequestInside(db, ns.ownerId);
    const fence = db.prepare(`WITH candidates AS MATERIALIZED (${query.sql}),
      headers AS MATERIALIZED (
        SELECT c.id episode_id,s.id,s.role,s.text,o.client,o.session_key
        FROM candidates c CROSS JOIN episode_sources s INDEXED BY episode_source_page ON s.episode_id=c.id
        LEFT JOIN session_episodes o ON o.id=s.origin_episode_id LIMIT 817),
      header_size AS MATERIALIZED (SELECT count(*) rows,
        coalesce(sum(length(CAST(id AS BLOB))+length(CAST(text AS BLOB))+
          coalesce(length(CAST(client AS BLOB)),0)+coalesce(length(CAST(session_key AS BLOB)),0)+128),0) bytes
        FROM headers),
      header_json AS MATERIALIZED (SELECT *,json_object('id',id,'client',client,'session',session_key,'role',role,'text',text) payload
        FROM headers WHERE (SELECT rows<=816 AND bytes<=4194304 FROM header_size))
      SELECT n.epoch,coalesce(f.epoch_hi,0) epoch_hi,coalesce(f.epoch_lo,0) epoch_lo,
        ${layout.rawLineage ? '(SELECT secret FROM episode_identity WHERE singleton=1)' : 'NULL'} AS identity_secret,
        CASE WHEN ? IS NULL OR ?=coalesce(n.epoch,1) THEN
          CASE WHEN (SELECT rows>816 OR bytes>4194304 FROM header_size)
            OR EXISTS(SELECT 1 FROM headers GROUP BY episode_id HAVING count(*)>16)
            OR (SELECT coalesce(sum(length(CAST(payload AS BLOB))+64),0) FROM header_json)>4194304 THEN NULL ELSE
            (SELECT json_group_array(json_object('episodeId',c.id,'sources',json((
              SELECT json_group_array(json(payload)) FROM header_json h WHERE h.episode_id=c.id)))) FROM candidates c)
          END
        END AS source_headers
      FROM (SELECT 1) anchor LEFT JOIN namespace_epochs n ON n.owner_id=? AND n.scope=? AND n.project_id=?
      LEFT JOIN owner_suppression_epochs f ON f.owner_id=?`)
      .get(...query.params, expectedEpoch ?? null, expectedEpoch ?? null, ...boundary(ns), ns.ownerId);
    if (proof && `${fence.epoch_hi}:${fence.epoch_lo}` !== proof.epoch) fail('evidence_unavailable');
    const current = fence.epoch ?? 1;
    // Do not decode later malformed evidence until the cursor fence agrees.
    if (expectedEpoch !== undefined && current !== expectedEpoch) return { epoch: current };
    // The caller retains its existing namespace-denial behavior (list refuses,
    // nextSteps filters). Do not let malformed later source evidence win.
    if (contentSuppressionReasonInside(db, ns)) return { epoch: current, query };
    if (fence.source_headers === null) fail('episode_sources_unavailable');
    const budget = { remaining: 4096, bytesRemaining: 4*1024*1024 };
    budget.bytesRemaining -= Buffer.byteLength(fence.source_headers, 'utf8');
    if (budget.bytesRemaining < 0) fail('episode_sources_unavailable');
    const headers = JSON.parse(fence.source_headers);
    if (headers.length > 51 || headers.some(row => row.sources.length > 16)) fail('episode_sources_unavailable');
    const keys = episodeSourceKeys(ns, headers, layout.rawLineage ? fence.identity_secret : undefined);
    const serializedKeys = JSON.stringify(keys);
    budget.bytesRemaining -= Buffer.byteLength(serializedKeys, 'utf8') +
      (typeof fence.identity_secret === 'string' ? Buffer.byteLength(fence.identity_secret, 'utf8') : 0);
    if (budget.bytesRemaining < 0) fail('episode_sources_unavailable');
    return { epoch: current, budget, query: {
      sql: `WITH candidates AS MATERIALIZED (${query.sql}), source_keys AS MATERIALIZED (SELECT value FROM json_each(?)),
        ${episodeSourceEvidenceCTE(layout.rawLineage)}
        SELECT c.*,${episodeSourceEvidenceSQL()} AS episode_read_proof,
          (SELECT value FROM proof_incomplete) AS episode_read_incomplete,
          (SELECT overflow FROM proof_state) AS episode_read_overflow,
          (SELECT json_object('rows',rows,'memories',memories,'receipts',receipts,'ancestryInput',ancestry_input,
            'sources',sources,'parents',parents,'ancestry',ancestry,'roots',roots,'maps',maps) FROM proof_state) AS episode_read_stats
        FROM candidates c`,
      params: [...query.params, serializedKeys, budget.bytesRemaining] } };
  };
}
export function createEpisodeReads({ db, epoch, decisionReview, assertEpisodeRead, episodeProjection }) {
  return function read(ns, operation, filter, cursor) {
    // Reviewed read-only pages can share a snapshot with a RESERVED writer.
    return transaction(db, () => {
      const original = rangeQuery(ns,operation,filter,cursor?.a);
      const projected = operation === 'listEpisodes' ? episodeProjection(ns, original, cursor?.e) : { epoch: epoch(ns), query: original };
      const current = projected.epoch;
      if (cursor && cursor.e !== current) fail('cursor_stale');
      const query = projected.query;
      let rows = db.prepare(query.sql).all(...query.params);
      if (contentSuppressionReasonInside(db, ns)) fail('revision_conflict');
      if (operation === 'listEpisodes') rows = episodeReadRowsInside(db,ns,rows).rows
        .filter(row=>filter.timeBasis!=='event'||JSON.parse(row.record).eventEnd!==null);
      return { epoch: current, rows: rows.map(row => {
        if (operation === 'listEpisodes') {
          assertEpisodeRead?.(ns, row, projected.budget);
          row = episodeReadRow(row);
          const item = episodeMetadata(ns,row);
          return { item, key: { time: filter.timeBasis === 'event' ? item.eventEnd : item.firstReceivedAt, id: row.id } };
        }
        const receipt = filter.timeBasis === 'receipt';
        if (cachedContentLayout(db)?.suppressionRevision && (!contentReadSafety(db, { namespace: ns, intent: 'history',
          ref: { type: 'memory', namespace: ns, memoryId: row.id, revision: row.revision } }).allowed ||
          receipt && contentSuppressionReasonInside(db, ns, { kind: 'receipt', key: row.receipt_id }))) fail('revision_conflict');
        return { item: { memory: memoryMetadata(row, decisionReview), ...(receipt ? { receipt: {
          id: row.receipt_id, createdAt: row.receipt_time, client: row.receipt_client } } : {}) },
          key: receipt ? { time: row.receipt_time, id: row.receipt_id, memoryId: row.id } : { time: row.updated_at, id: row.id } };
      }) };
    }, undefined, { deferred: true });
  };
}
export function rangePage(page, filter, binding, encodeCursor, operation) {
  const values = page.rows.slice(0,filter.limit);
  const output = { items: [], nextCursor: null, exhausted: false, status: 'complete', indexRevision: page.epoch,
    ...(operation === 'listEpisodes' && filter.timeBasis === 'event' ? { unknownEventIntervals: 'excluded' } : {}) };
  const render = take => {
    output.items = values.slice(0,take).map(row=>row.item);
    output.exhausted = take === page.rows.length;
    output.nextCursor = output.exhausted || !take ? null : encodeCursor({ ...binding,e:page.epoch,a:values[take-1].key });
    return Buffer.byteLength(envelopeText(output),'utf8') <= 65536;
  };
  for (let take = values.length; take >= 0; take--) {
    if (render(take)) {
      if (!take && values.length) fail('context_item_too_large');
      return output;
    }
    output.status = 'budget_exhausted';
  }
  fail('context_item_too_large');
}

export function episodeReadRowsInside(db, ns, rows, linkedReceipts = [], {memo=createContentReadMemo(db),defer=false} = {}) {
  const sources = rows.length ? db.prepare(`SELECT s.*,o.client AS origin_client,o.session_key AS origin_session
    FROM json_each(?) wanted CROSS JOIN session_episodes e ON e.id=wanted.value
    CROSS JOIN episode_sources s INDEXED BY episode_source_page ON s.episode_id=e.id
    CROSS JOIN session_episodes o ON o.id=s.origin_episode_id
    WHERE e.owner_id=? AND e.scope=? AND e.project_id=? AND o.owner_id=e.owner_id
      AND o.scope=e.scope AND o.project_id=e.project_id ORDER BY s.id`)
    .all(JSON.stringify(rows.map(row=>row.id)),...boundary(ns)) : [];
  const receipts = sources.map(source => {
    const input={client:source.origin_client,sessionId:source.origin_session,eventId:source.message_id,role:source.role,excerpt:source.text};
    return {receipt_key:sourceDigest(JSON.stringify(input)),client:input.client,session_id:input.sessionId,event_id:input.eventId,role:input.role};
  });
  if(defer)return {memo,receipts:[...receipts,...linkedReceipts]};
  const denied = receiptDenialsInside(db,ns,[...receipts,...linkedReceipts],memo);
  const hidden = new Set(sources.filter((source,index)=>denied.has(receipts[index].receipt_key)).map(source=>source.id));
  return {memo,sources:sources.filter(source=>!hidden.has(source.id)),rows:rows.map(row=>{
    if (!sources.some(source=>source.episode_id===row.id&&hidden.has(source.id))) return row;
    // Same record as invalidate(ns,id,false): source denial invalidates the
    // whole interpretation. No event interval survives a withheld source.
    const record = { clientLabel:null,eventStart:null,eventEnd:null,eventTimeCoverage:'unknown',
      interpretedAt:null,type:null,language:null,gist:null,outcome:null,nextStep:null,
      anchors:{},modelMetadata:null,semanticSupport:'unassessed',editor:{},
      processing:{state:'invalidated',missing:0,expired:0,omitted:0,errorCode:null} };
    return {...row,record:JSON.stringify(record)};
  })};
}

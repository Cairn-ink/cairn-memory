import { transaction } from './database.mjs';
import { episodeClient, episodeMetadata, instant } from './episode-storage.mjs';
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
    clauses.push(where('e'), 'e.deleted=0');
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
    clauses.push(where('m'), 'm.deleted=0', `m.currentness IN (${f.states.map(()=>'?').join(',')})`, `${time}>=?`, `${time}<?`);
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
export function memoryMetadata(row) {
  return { id: row.id, revision: row.revision, kind: row.kind, origin: row.origin, confidence: row.confidence,
    state: row.currentness === 'current' ? 'active' : 'historical', filingStatus: row.filing_status,
    createdAt: row.created_at, updatedAt: row.updated_at };
}
export function createEpisodeReads({ db, epoch }) {
  return function read(ns, operation, filter, cursor) {
    return transaction(db, () => {
      const current = epoch(ns);
      if (cursor && cursor.e !== current) fail('cursor_stale');
      const query = rangeQuery(ns,operation,filter,cursor?.a);
      const rows = db.prepare(query.sql).all(...query.params);
      return { epoch: current, rows: rows.map(row => {
        if (operation === 'listEpisodes') {
          const item = episodeMetadata(ns,row);
          return { item, key: { time: filter.timeBasis === 'event' ? item.eventEnd : item.firstReceivedAt, id: row.id } };
        }
        const receipt = filter.timeBasis === 'receipt';
        return { item: { memory: memoryMetadata(row), ...(receipt ? { receipt: {
          id: row.receipt_id, createdAt: row.receipt_time, client: row.receipt_client } } : {}) },
          key: receipt ? { time: row.receipt_time, id: row.receipt_id, memoryId: row.id } : { time: row.updated_at, id: row.id } };
      }) };
    });
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

// Frozen receipt enumeration and validation oracle for equivalence tests.
import { bindContentSafetyConnection, cachedContentLayout, installedContentLayout } from '../content-safety-schema.mjs';
import { hasContentSuppressionRequestInside, contentSuppressionTargetMatches, writeContentSuppressionInside, contentSuppressionReasonInside } from '../content-suppression-storage.mjs';
import { createHash, createHmac } from 'node:crypto';
import { fail } from '../validation.mjs';
import { createRawSourceRoots, rawSessionKeys } from '../raw-source-roots.mjs';

// The read optimisation has a bounded lease on SHARED. Overflow restarts the
// complete validator under BEGIN IMMEDIATE; it is never a negative source proof.
const sourceSnapshotOverflows = new WeakSet();
export const isSourceSnapshotOverflow = error => sourceSnapshotOverflows.has(error);
export const SOURCE_SNAPSHOT_STATEMENTS = 512;
export const SOURCE_SNAPSHOT_MS = 100;
const sourcePageSize = 128;
// Preserve ordered capture's four-receipt page plus one overflow witness.
const sourceReceiptPageSize = 4;
function sourceSnapshotOverflow() {
  const error = Object.assign(new Error('source snapshot requires writer validation'), {code:'source_budget_exceeded'});
  sourceSnapshotOverflows.add(error); throw error;
}

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId || ''];
const sha = value => createHash('sha256').update(value).digest('hex');
const receiptDigest = value => sha(JSON.stringify(value));
const lineageDigest = (secret,value) => createHmac('sha256',Buffer.from(secret,'hex')).update(JSON.stringify(value)).digest('hex');
export function createLegacyReceiptWalk(db, { readMemo } = {}) {
  const native=db;
  let snapshot;
  // Count every nested lineage/fact/root statement; check between iterator rows.
  // Registration associates caches/attestation with the same native connection.
  const check = () => { if (snapshot && (performance.now() >= snapshot.deadline ||
    snapshot.statements >= SOURCE_SNAPSHOT_STATEMENTS)) sourceSnapshotOverflow(); };
  const snapshotDb = bindContentSafetyConnection({
    get isTransaction() { return native.isTransaction; },
    exec: sql => native.exec(sql),
    prepare(sql) {
      if (!snapshot) return native.prepare(sql);
      check(); const statement = native.prepare(sql);
      const execute = (method,args) => { check(); snapshot.statements++; return statement[method](...args); };
      return { get: (...args) => execute('get',args), all: (...args) => execute('all',args),
        *iterate(...args) { const rows=execute('iterate',args); for (const row of rows) { check(); yield row; } } };
    },
  }, native);
  function sourceSnapshot(work, proof, deadline = performance.now()+SOURCE_SNAPSHOT_MS) {
    if (snapshot) fail('storage_error');
    snapshot = { deadline,statements:0,inputs:new Map(),validated:new Set(),proof };
    db=snapshotDb;
    try { check(); const result=work(); check(); return result; } finally { snapshot=undefined; db=native; }
  }
  const roots = createRawSourceRoots(snapshotDb, { readMemo });
  let available;
  const enabled = () => available === true || (available = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE name='raw_source_maps'").get()));
  const digest = value => lineageDigest(db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret, value);
  const sourceKey = receipt => digest(['raw-source-v1', receipt.role, receipt.excerpt]);
  const sessionKey = (ns, client, session) => 's1:' + digest(['episode-v1', ...boundary(ns), client, session]);

  function anchors(ns, receipt) {
    if (!enabled()) return [];
    const hashed = sessionKey(ns, receipt.client, receipt.sessionId);
    const rows = db.prepare(`SELECT c.id,m.total_units,m.role FROM raw_conversations c JOIN raw_messages m ON m.conversation_id=c.id
      WHERE c.owner_id=? AND c.scope=? AND c.project_id=? AND c.client=? AND c.session_key IN (?,?) AND m.message_id=?${snapshot ? ' LIMIT 2' : ''}`)
      .all(...boundary(ns), receipt.client, receipt.sessionId, hashed, receipt.eventId);
    if (rows.length > 1) fail('raw_lineage_unavailable');
    if (!rows.length) return [];
    const row = rows[0];
    if (row.role !== receipt.role) fail('event_payload_conflict');
    const maps = db.prepare('SELECT start,end,precision FROM raw_source_maps WHERE conversation_id=? AND message_id=? AND source_key=?' + (snapshot ? ' LIMIT 129' : ''))
      .all(row.id, receipt.eventId, sourceKey(receipt));
    if(snapshot && maps.length>128)sourceSnapshotOverflow();
    const known = db.prepare('SELECT 1 FROM raw_source_maps WHERE conversation_id=? AND message_id=?').get(row.id, receipt.eventId);
    if (!maps.length && known) fail('raw_lineage_unavailable');
    return (maps.length ? maps : [{ start: 0, end: row.total_units, precision: 'whole-message' }])
      .map(span => ({ conversationId: row.id, messageId: receipt.eventId, ...span }));
  }

  function assertAnchors(values) {
    for (const anchor of values) {
      check();
      if(snapshot && db.prepare('SELECT start FROM raw_source_exclusions WHERE conversation_id=? AND message_id=? LIMIT 129')
        .all(anchor.conversationId,anchor.messageId).length>128)sourceSnapshotOverflow();
      if (db.prepare(`SELECT 1 FROM raw_source_exclusions WHERE conversation_id=? AND message_id=?
      AND start<? AND end>?`).get(anchor.conversationId, anchor.messageId, anchor.end, anchor.start)) fail('source_excluded');
    }
  }
  // Index order is explicit and every input page has a fixed LIMIT. Filtering
  // follows the page bound, so even a source with no matches cannot scan an
  // unbounded namespace in one statement. The writer fallback visits every page.
  function* receiptInputs(ns) {
    const cacheKey=JSON.stringify(boundary(ns));
    if(snapshot?.inputs.has(cacheKey)){ yield* snapshot.inputs.get(cacheKey); return; }
    const retained=[];
    for (const deleted of [0,1]) {
      let after;
      while (true) {
        check();
        // Seek both index ranges separately: the mixed DESC/ASC index must
        // not rescan an arbitrarily large equal-timestamp prefix on each page.
        const select=(clause,args,limit)=>db.prepare(`SELECT id,revision,deleted,updated_at FROM memories INDEXED BY namespace_memories
          WHERE owner_id=? AND scope=? AND project_id=? AND deleted=? ${clause}
          ORDER BY updated_at DESC,id LIMIT ?`).all(...boundary(ns),deleted,...args,limit);
        const memories=after ? select('AND updated_at=? AND id>?',[after.updated_at,after.id],129) : select('',[],129);
        if(after && memories.length<129)memories.push(...select('AND updated_at<?',[after.updated_at],129-memories.length));
        if(snapshot && memories.length>sourcePageSize)sourceSnapshotOverflow();
        const selected=memories.slice(0,sourcePageSize);
        for(let offset=0;offset<selected.length;offset+=sourceReceiptPageSize) {
          check();const keys=selected.slice(offset,offset+sourceReceiptPageSize);
          const inputs=db.prepare(`SELECT r.*,
            json_extract(wanted.value,'$[1]') AS memory_revision,json_extract(wanted.value,'$[2]') AS memory_deleted
            FROM json_each(?) wanted CROSS JOIN receipts r INDEXED BY memory_receipts
              ON r.memory_id=json_extract(wanted.value,'$[0]') LIMIT 5`)
            .all(JSON.stringify(keys.map(memory=>[memory.id,memory.revision,memory.deleted])));
          if(snapshot && (inputs.length>sourceReceiptPageSize || retained.length+inputs.length>sourcePageSize))sourceSnapshotOverflow();
          if(inputs.length<=sourceReceiptPageSize) {
            for(const row of inputs){if(snapshot)retained.push(row);yield row;}
          } else {
            // Discard this incomplete prefix. The writer route visits every
            // receipt of every key, with the existing four-plus-one row bound.
            for(const memory of keys) {
              let receiptAfter;
              while(true) {
                check();
                const page=db.prepare(`SELECT r.*,? AS memory_revision,? AS memory_deleted FROM receipts r INDEXED BY memory_receipts
                  WHERE memory_id=? ${receiptAfter ? 'AND (created_at,id)>(?,?)' : ''}
                  ORDER BY created_at,id LIMIT 5`).all(memory.revision,memory.deleted,memory.id,
                    ...(receiptAfter ? [receiptAfter.created_at,receiptAfter.id] : []));
                const rows=page.slice(0,sourceReceiptPageSize);
                for(const row of rows)yield row;
                if(page.length<=sourceReceiptPageSize)break;
                receiptAfter=rows.at(-1);
              }
            }
          }
        }
        if(memories.length<=sourcePageSize)break;
        after=memories[sourcePageSize-1];
      }
    }
    if(snapshot)snapshot.inputs.set(cacheKey,retained);
  }
  function assertReceipts(ns, receipts, readExisting = false, rawTargets) {
    if (!readExisting && (cachedContentLayout(db)??installedContentLayout(db)).suppressionRevision) {
      // An incomplete fact set, or a possible Raw fact join, must not start an
      // unbounded indexed fallback inside SHARED, even for the scope denial.
      const proof=snapshot?.proof, facts=proof?.facts;
      const covered=proof?.owner===ns.ownerId && (proof.epoch==='0:0' || proof.readSet.some(selected=>
        selected.scope==='owner' || selected.scope===ns.scope && (selected.projectId??'')===(ns.projectId??'')));
      if(snapshot && (!hasContentSuppressionRequestInside(db) || !covered || !facts ||
          facts.some(fact=>fact.kind==='raw')))sourceSnapshotOverflow();
      if (contentSuppressionReasonInside(db, ns)) fail('source_excluded');
      for (const receipt of receipts) {
        check();
        for (const row of receiptInputs(ns)) {
          check();
          if(row.client!==receipt.client || row.session_id!==receipt.sessionId || row.event_id!==receipt.eventId ||
            row.role!==receipt.role || row.excerpt!==receipt.excerpt)continue;
          if(snapshot?.validated.has(row.id))continue;
          // Stored ancestry can multiply the fact join. Leave that complete
          // conservative validator to the writer route, even for one anchor.
          if(snapshot && cachedContentLayout(db).rawLineage && db.prepare(`SELECT l.receipt_id FROM receipts r INDEXED BY memory_receipts
            CROSS JOIN raw_receipt_lineage l ON l.receipt_id=r.id WHERE r.memory_id=? LIMIT 1`).get(row.memory_id))sourceSnapshotOverflow();
          // Preserve the old history decision's canonical identity checks here,
          // without calling back into a read entry from lineage validation.
          const source = { client: row.client, sessionId: row.session_id, eventId: row.event_id, role: row.role, excerpt: row.excerpt };
          if (row.memory_deleted || receiptDigest(source) !== row.receipt_key ||
              contentSuppressionReasonInside(db, ns, { kind: 'memory', key: row.memory_id,
                revision: row.memory_revision, version: JSON.stringify(['memory-revision-v1', row.memory_revision]),
                ...(snapshot ? {ancestryChecked:true} : {}) }) ||
              contentSuppressionReasonInside(db, ns, { kind: 'receipt', key: row.id,
                ...(snapshot ? {ancestryChecked:true} : {}) })) fail('source_excluded');
          snapshot?.validated.add(row.id);
        }
      }
    }
    if (!enabled()) return;
    for (const receipt of receipts) {
      roots.assertSession(ns, receipt.client, receipt.sessionId, readExisting);
      const values = anchors(ns, receipt);
      for (const anchor of values) if (!readExisting && contentSuppressionReasonInside(db, ns, { kind: 'raw', key: anchor.conversationId,
        messageId: anchor.messageId, start: anchor.start, end: anchor.end })) fail('source_excluded');
      assertAnchors(values);
      rawTargets?.push(...values);
    }
  }
  return { assertReceipts, sourceSnapshot };
}

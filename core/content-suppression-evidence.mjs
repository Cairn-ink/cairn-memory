import { createHash, createHmac } from 'node:crypto';
import { createCardRawSources } from './card-raw-sources.mjs';
import { identityKey, SUPPRESSION_LIMITS } from './content-suppression-input.mjs';
import { fail } from './validation.mjs';

const boundary = c => [c.namespace.ownerId,c.namespace.scope,c.namespace.projectId ?? ''];
const where = 'owner_id=? AND scope=? AND project_id=?';
const spanKey = a => JSON.stringify([a.key,a.messageId,a.span.start,a.span.end,a.span.precision]);

/** Negative answers require retained evidence of the supplied bound version.
 * This never fills a missing input field from the current canonical row. */
export function createSuppressionEvidence(db, layout, identity, charge) {
  const done = new Map(), raw = layout.rawSources ? createCardRawSources(db, identity) : null;
  const bind = (purpose, value) => createHmac('sha256', identity.cursorSecret)
    .update(JSON.stringify([purpose,[identity.storeId,value]])).digest('base64url');
  const get = (sql, ...args) => { charge(); return db.prepare(sql).get(...args); };
  const all = (sql, ...args) => {
    const rows = db.prepare(sql).all(...args);
    if (rows.length > SUPPRESSION_LIMITS.nodes) fail('source_budget_exceeded');
    charge(rows.length + 1); return rows;
  };
  function requiredRaw(c, receipts) {
    const expected = new Set();
    for (const receipt of receipts) {
      const origin = get('SELECT kind FROM raw_receipt_origins WHERE receipt_id=?',receipt.id)?.kind;
      const anchors = all(`SELECT l.*,r.owner_id,r.scope,r.project_id FROM raw_receipt_lineage l
        LEFT JOIN raw_conversations r ON r.id=l.conversation_id WHERE l.receipt_id=? LIMIT ?`,receipt.id,SUPPRESSION_LIMITS.nodes + 1);
      if (!['independent','derived'].includes(origin) || origin === 'independent' && anchors.length || origin === 'derived' && !anchors.length) fail('evidence_unavailable');
      for (const anchor of anchors) {
        if (anchor.owner_id !== c.namespace.ownerId || anchor.scope !== c.namespace.scope ||
            anchor.project_id !== (c.namespace.projectId ?? '')) fail('evidence_unavailable');
        expected.add(JSON.stringify([anchor.conversation_id,anchor.message_id,anchor.start,anchor.end,anchor.precision]));
      }
    }
    return expected;
  }
  function rawClosure(c, expected) {
    const actual = new Set(c.ancestors.filter(a => a.kind === 'raw').map(spanKey));
    if (actual.size !== expected.size || [...expected].some(key => !actual.has(key))) fail('evidence_unavailable');
    for (const ancestor of c.ancestors) verify(ancestor);
  }
  function verify(c) {
    const key = identityKey(c);
    if (done.has(key)) return done.get(key);
    const ns = { ownerId:c.namespace.ownerId,scope:c.namespace.scope,projectId:c.namespace.projectId };
    charge(); let version;
    if (c.kind === 'memory') {
      if (c.ancestors.some(a => a.kind !== 'raw')) fail('evidence_unavailable');
      const row = get(`SELECT revision,deleted FROM memories WHERE ${where} AND id=?`,...boundary(c),c.key);
      if (!row || row.deleted || row.revision !== c.boundRevision) fail('evidence_unavailable');
      if (!layout.rawLineage) {
        if (c.ancestors.length) fail('evidence_unavailable');
      } else {
        const receipts = all('SELECT id FROM receipts WHERE memory_id=? LIMIT ?',c.key,SUPPRESSION_LIMITS.nodes + 1);
        if (!receipts.length) fail('evidence_unavailable');
        rawClosure(c, requiredRaw(c, receipts));
      }
      version = ['memory-revision-v1',c.boundRevision];
    } else if (c.kind === 'receipt') {
      if (c.ancestors.some(a => !['memory','raw'].includes(a.kind))) fail('evidence_unavailable');
      const parent = c.ancestors.find(a => a.kind === 'memory'); verify(parent);
      const row = get('SELECT * FROM receipts WHERE id=? AND memory_id=?',c.key,c.memoryId);
      if (!row) fail('evidence_unavailable');
      const source = { client: row.client, sessionId: row.session_id, eventId: row.event_id, role: row.role, excerpt: row.excerpt };
      if (createHash('sha256').update(JSON.stringify(source)).digest('hex') !== row.receipt_key) fail('evidence_unavailable');
      if (layout.rawLineage) {
        const expected = requiredRaw(c, [row]);
        // Raw ancestors may be transitively captured by the parent Memory.
        const flattened = { ...c, ancestors: [...c.ancestors.filter(a => a.kind === 'raw'),...parent.ancestors] };
        const available = new Set(flattened.ancestors.map(spanKey));
        if ([...expected].some(key => !available.has(key)) || c.ancestors.filter(a => a.kind === 'raw').some(a => !expected.has(spanKey(a)))) fail('evidence_unavailable');
        for (const ancestor of flattened.ancestors) verify(ancestor);
      } else if (c.ancestors.length !== 1) fail('evidence_unavailable');
      // C deliberately requires no S2c parent commitment unavailable in v18
      // get. Incarnation facts remain matchable; an exact commitment-version
      // fact without retained evidence refuses instead of inventing that field.
      version = null;
    } else if (c.kind === 'submitted-note') {
      if (!layout.cards) fail('evidence_unavailable');
      const row = get(`SELECT revision,state,text FROM card_notes WHERE ${where} AND id=?`,...boundary(c),c.key);
      if (!row || row.state !== 'available' || row.revision !== c.boundRevision ||
          bind('submitted-note-content-v1',[ns,c.key,c.boundRevision,row.text]) !== c.contentIdentity) fail('evidence_unavailable');
      version = ['note-v1',c.boundRevision];
    } else if (c.kind === 'raw') {
      if (!raw) fail('evidence_unavailable');
      const row = get(`SELECT revision FROM raw_conversations WHERE ${where} AND id=?`,...boundary(c),c.key);
      if (!row || row.revision !== c.boundRevision) fail('evidence_unavailable');
      const budget = raw.budget(SUPPRESSION_LIMITS.bytes,SUPPRESSION_LIMITS.nodes);
      const view = raw.resolve(ns,{ type:'raw',namespace:ns,conversationId:c.key,
        messageId:c.messageId,span:c.span,contentIdentity:c.contentIdentity },budget);
      charge(budget.scanned + 1);
      version = ['raw-span-v1',c.messageId,c.span.start,c.span.end,c.span.precision,view.parts.map(p => p.part_index).sort((a,b) => a-b)];
    } else {
      // S2h has no retained, bound-body S2c records. A supplied Card closure,
      // including an empty one on v18, can never establish a negative answer.
      fail('evidence_unavailable');
    }
    done.set(key,version);
    return version;
  }
  return { verify };
}

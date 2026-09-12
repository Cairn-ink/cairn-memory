import { transaction } from './database.mjs';
import { fail } from './validation.mjs';

const where = 'owner_id = ? AND scope = ? AND project_id = ?';
const boundary = ns => [ns.ownerId, ns.scope, ns.projectId];
const eventKey = (ns, s) => [...boundary(ns), s.client, s.eventId];
const streamKey = (ns, s) => [...boundary(ns), s.client, s.causal.streamId];
const outcome = (reason = null, retiredCount = 0) => ({
  status: reason ? 'unresolved' : retiredCount ? 'applied' : 'complete_no_change', reason, retiredCount,
});

/** Private ordered-capture proof around the existing admission transactions. */
export function createOrderedCaptureStorage({ db, admissionStorage, epoch, activeRow,
  supersessionStorage, receiptKey, isSuppressed }) {
  const event = (ns, s) => db.prepare(`SELECT * FROM capture_events WHERE ${where}
    AND client = ? AND event_id = ?`).get(...eventKey(ns, s));
  const highWater = (ns, s) => db.prepare(`SELECT high_water FROM capture_streams
    WHERE ${where} AND client = ? AND stream_id = ?`).get(...streamKey(ns, s))?.high_water ?? 0;
  function bound(ns, s) {
    const row = event(ns, s);
    if (!row || row.stream_id !== s.causal.streamId || row.sequence !== s.causal.sequence) {
      fail('capture_order_conflict');
    }
    return row;
  }
  function validate(ns, s, order) {
    bound(ns, s);
    if (highWater(ns, s) !== order.highWater || s.causal.sequence <= order.highWater) {
      fail('capture_order_conflict');
    }
    if (epoch(ns) !== order.indexRevision) fail('index_revision_conflict');
  }
  function claim(ns, s) {
    return admissionStorage.claimAdmission(ns, { ...s, leaseMs: 125000 }, {
      replay() {
        const row = bound(ns, s);
        if (!row.reconciliation) fail('capture_order_conflict');
        return { reconciliation: JSON.parse(row.reconciliation) };
      },
      prepare(claim) {
        const previous = event(ns, s);
        if (claim && !previous) fail('event_payload_conflict');
        if (previous && (previous.stream_id !== s.causal.streamId || previous.sequence !== s.causal.sequence)) {
          fail('event_payload_conflict');
        }
        const water = highWater(ns, s);
        if (s.causal.sequence <= water) fail('capture_order_conflict');
        const occupied = db.prepare(`SELECT event_id FROM capture_events WHERE ${where}
          AND client = ? AND stream_id = ? AND sequence = ?`)
          .get(...streamKey(ns, s), s.causal.sequence);
        if (occupied && occupied.event_id !== s.eventId) fail('capture_order_conflict');
        if (!previous) db.prepare(`INSERT INTO capture_events
          (owner_id,scope,project_id,client,event_id,stream_id,sequence)
          VALUES (?,?,?,?,?,?,?)`).run(...eventKey(ns, s), s.causal.streamId, s.causal.sequence);
        db.prepare(`INSERT INTO capture_streams
          (owner_id,scope,project_id,client,stream_id,high_water) VALUES (?,?,?,?,?,0)
          ON CONFLICT DO NOTHING`).run(...streamKey(ns, s));
        return { order: { highWater: water, indexRevision: epoch(ns) } };
      },
    });
  }
  function receipts(id) {
    return db.prepare(`SELECT r.id, r.role, r.excerpt, c.owner_id, c.scope, c.project_id,
      c.client, c.stream_id, c.sequence FROM receipts r LEFT JOIN receipt_causality c
      ON c.receipt_id = r.id WHERE r.memory_id = ? ORDER BY r.id LIMIT 5`).all(id);
  }
  function eligible(ns, s, row, sources) {
    return row.origin === 'agent-inferred' && sources.length > 0 && sources.length <= 4 &&
      sources.every(r => r.owner_id === ns.ownerId && r.scope === ns.scope &&
        r.project_id === ns.projectId && r.client === s.client &&
        r.stream_id === s.causal.streamId && r.sequence < s.causal.sequence);
  }
  function discover(ns, s, order, items) {
    return transaction(db, () => {
      validate(ns, s, order);
      if (!items.length) return { candidates: [], reason: null };
      const rows = db.prepare(`SELECT * FROM memories WHERE ${where}
        AND deleted = 0 AND currentness = 'current' ORDER BY id LIMIT 13`).all(...boundary(ns));
      if (rows.length > 12) return { candidates: [], reason: 'candidate_limit' };
      const fingerprints = new Set(items.map(item => item.fingerprint));
      const candidates = rows.filter(row => !fingerprints.has(row.fingerprint))
        .map(row => ({ row, receipts: receipts(row.id) }));
      if (candidates.some(({ row, receipts: sources }) => !eligible(ns, s, row, sources))) {
        return { candidates, reason: 'unordered_sources' };
      }
      return { candidates, reason: null };
    });
  }
  function finish(ns, s, token, order, snapshot, items, decisions, reason) {
    let reconciliation;
    return admissionStorage.finishAdmission(ns, { ...s, token, items }, {
      validate() {
        validate(ns, s, order);
        for (const candidate of snapshot.candidates) {
          const row = activeRow(ns, candidate.row.id);
          if (!row || row.currentness !== 'current' || row.revision !== candidate.row.revision ||
              JSON.stringify(receipts(row.id)) !== JSON.stringify(candidate.receipts)) {
            fail('index_revision_conflict');
          }
        }
        if (reason && decisions.length) fail('invalid_model_output');
        for (const decision of decisions) {
          const item = items[decision.replacementIndex];
          if (isSuppressed(ns, item.fingerprint)) fail('memory_suppressed');
        }
      },
      admitted(entries) {
        // Only receipts actually inserted by this mutation acquire provenance.
        for (const entry of entries) for (const id of entry.insertedReceiptIds) {
          db.prepare(`INSERT INTO receipt_causality
            (receipt_id,owner_id,scope,project_id,client,stream_id,sequence)
            VALUES (?,?,?,?,?,?,?)`).run(id, ...streamKey(ns, s), s.causal.sequence);
        }
        const successors = new Map();
        const resolved = decisions.map(decision => {
          const item = items[decision.replacementIndex];
          const entry = entries.find(entry => entry.item === item);
          if (!entry) fail('invalid_ref');
          if (successors.has(entry.memoryId) && successors.get(entry.memoryId) !== decision.replacementIndex) {
            fail('invalid_ref');
          }
          successors.set(entry.memoryId, decision.replacementIndex);
          const replacement = activeRow(ns, entry.memoryId);
          const previous = activeRow(ns, snapshot.candidates[decision.predecessorIndex].row.id);
          if (!previous || previous.currentness !== 'current' || !replacement ||
              replacement.currentness !== 'current' || previous.id === replacement.id ||
              replacement.origin !== 'agent-inferred') fail('invalid_ref');
          const receiptIds = decision.receiptIndices.map(index => db.prepare(
            'SELECT id FROM receipts WHERE memory_id = ? AND receipt_key = ?')
            .get(replacement.id, receiptKey(item.receipts[index]))?.id);
          if (receiptIds.some(id => !id)) fail('invalid_ref');
          return { previous, replacement, receiptIds };
        });
        const predecessors = new Set(resolved.map(row => row.previous.id));
        if (resolved.some(row => predecessors.has(row.replacement.id))) fail('invalid_ref');
        for (const row of resolved) supersessionStorage.retire(ns, row.previous, row.replacement, row.receiptIds);
        reconciliation = outcome(reason, resolved.length);
        return { reconciliation };
      },
      complete() {
        db.prepare(`UPDATE capture_events SET reconciliation = ? WHERE ${where}
          AND client = ? AND event_id = ?`).run(JSON.stringify(reconciliation), ...eventKey(ns, s));
        db.prepare(`UPDATE capture_streams SET high_water = ? WHERE ${where}
          AND client = ? AND stream_id = ?`).run(s.causal.sequence, ...streamKey(ns, s));
      },
    });
  }
  return { claim, discover, finish };
}

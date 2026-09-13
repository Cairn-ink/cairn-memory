import { createHash } from 'node:crypto';
import { qualificationInput, qualificationSources } from './claim-qualification-input.mjs';
import { fail } from './validation.mjs';

const digest = text => createHash('sha256').update(text, 'utf8').digest('hex');
const source = row => ({ client: row.client, sessionId: row.session_id,
  eventId: row.event_id, role: row.role, excerpt: row.excerpt });

// All callers hold the shared runtime transaction. No model or external I/O.
export function createQualificationStorage({ db, receiptKey }) {
  function inspect(memory) {
    const row = db.prepare('SELECT * FROM memory_qualifications WHERE memory_id = ?').get(memory.id);
    if (!row) return null;
    try {
      if (memory.deleted || row.version !== 1 || !Number.isSafeInteger(row.bound_revision) ||
          row.bound_revision < 1 || row.bound_revision > memory.revision ||
          row.content_digest !== digest(memory.content)) fail('storage_error');
      if (!memory.content.isWellFormed()) fail('storage_error');
      const stored = db.prepare(`SELECT * FROM qualification_anchors
        WHERE memory_id = ? ORDER BY ordinal LIMIT 5`).all(memory.id);
      if (stored.length !== row.anchor_count) fail('storage_error');
      const receipts = stored.map((anchor, index) => {
        if (anchor.ordinal !== index) fail('storage_error');
        const receipt = db.prepare('SELECT * FROM receipts WHERE id = ? AND memory_id = ?')
          .get(anchor.receipt_id, memory.id);
        if (!receipt || receipt.receipt_key !== receiptKey(source(receipt)) ||
            !['user', 'assistant'].includes(receipt.role) ||
            anchor.receipt_digest !== digest(receipt.excerpt)) fail('storage_error');
        return receipt;
      });
      const clean = qualificationInput({ version: row.version,
        slot: { subject: row.subject, property: row.property, scope: row.scope, applies: row.applies },
        value: row.value, attribution: row.attribution, commitment: row.commitment,
        anchors: stored.map((anchor, index) => ({ receiptIndex: index, start: anchor.start, end: anchor.end,
          text: receipts[index].excerpt.slice(anchor.start, anchor.end), fields: JSON.parse(anchor.fields) })),
      }, receipts.map(source));
      return { ...clean, boundRevision: row.bound_revision, contentDigest: row.content_digest,
        anchors: clean.anchors.map(({ receiptIndex, ...anchor }) => ({
          receiptId: stored[receiptIndex].receipt_id, receiptDigest: stored[receiptIndex].receipt_digest, ...anchor,
        })) };
    } catch { fail('storage_error'); }
  }

  function bind(memory, input, receipts, deduplicated, content) {
    if (input === undefined) return;
    qualificationSources(content, receipts);
    if (memory.content !== content) fail('storage_error');
    const clean = qualificationInput(input, receipts);
    const authoritative = receipts.map(expected => {
      const receipt = db.prepare('SELECT * FROM receipts WHERE memory_id = ? AND receipt_key = ?')
        .get(memory.id, receiptKey(expected));
      if (!receipt || receipt.receipt_key !== receiptKey(source(receipt)) ||
          JSON.stringify(source(receipt)) !== JSON.stringify(expected)) fail('storage_error');
      return receipt;
    });
    const seen = new Set();
    const anchored = clean.anchors.map(({ receiptIndex, ...anchor }) => {
      const receipt = authoritative[receiptIndex];
      if (receipt.excerpt.slice(anchor.start, anchor.end) !== anchor.text) fail('storage_error');
      const key = JSON.stringify([receipt.id, anchor.start, anchor.end, anchor.fields]);
      if (seen.has(key)) fail('invalid_input');
      seen.add(key);
      return { receiptId: receipt.id, receiptDigest: digest(receipt.excerpt), ...anchor };
    });
    const contentDigest = digest(memory.content);
    const value = { ...clean, boundRevision: memory.revision, contentDigest, anchors: anchored };
    if (deduplicated) {
      const existing = inspect(memory);
      // The original revision is retained even after filing/receipt additions.
      if (!existing || JSON.stringify({ ...value, boundRevision: existing.boundRevision }) !== JSON.stringify(existing)) {
        fail('qualification_conflict');
      }
      return;
    }
    db.prepare(`INSERT INTO memory_qualifications
      (memory_id,version,bound_revision,content_digest,subject,property,scope,applies,value,attribution,commitment,anchor_count)
      VALUES (?,1,?,?,?,?,?,?,?,?,?,?)`).run(memory.id, memory.revision, contentDigest,
      clean.slot.subject, clean.slot.property, clean.slot.scope, clean.slot.applies, clean.value,
      clean.attribution, clean.commitment, anchored.length);
    const insert = db.prepare(`INSERT INTO qualification_anchors
      (memory_id,ordinal,receipt_id,receipt_digest,start,end,fields) VALUES (?,?,?,?,?,?,?)`);
    anchored.forEach((anchor, ordinal) => insert.run(memory.id, ordinal, anchor.receiptId,
      anchor.receiptDigest, anchor.start, anchor.end, JSON.stringify(anchor.fields)));
  }

  function clear(memoryId) {
    db.prepare('DELETE FROM memory_qualifications WHERE memory_id = ?').run(memoryId);
  }

  return { bind, inspect, clear };
}

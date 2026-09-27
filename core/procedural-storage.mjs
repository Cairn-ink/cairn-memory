import { createHash } from 'node:crypto';
import { transaction } from './database.mjs';
import { ensureEpisodes, hasEpisodes } from './episode-schema.mjs';
import { denseArray, fail, object } from './validation.mjs';

export const sourceDigest = text => createHash('sha256').update(text).digest('hex');
export function sourceSpan(text, start, end) {
  const boundary = offset => offset === 0 || offset === text.length ||
    !(text.charCodeAt(offset) >= 0xdc00 && text.charCodeAt(offset) <= 0xdfff);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end <= start ||
      end > text.length || !boundary(start) || !boundary(end)) fail('invalid_input');
}

/** Tags have an independent revision; tag edits never run memory invalidators. */
export function createProceduralStorage({ db, activeRow, advanceEpoch, epoch }) {
  function inspect(id) {
    if (!hasEpisodes(db)) return null;
    const row = db.prepare('SELECT * FROM procedural_tags WHERE memory_id=?').get(id);
    return row ? { tagRevision: row.tag_revision, procedural: row.positive === 1,
      origin: row.origin, anchors: row.anchors ? JSON.parse(row.anchors) : [] } : null;
  }
  function clear(id) {
    if (hasEpisodes(db)) db.prepare(`UPDATE procedural_tags SET tag_revision=tag_revision+1,
      positive=0,origin=NULL,anchors=NULL WHERE memory_id=? AND positive=1`).run(id);
  }
  function write(memory, value, origin = 'explicit', receipts) {
    let anchors = null;
    if (value !== null) {
      if (!['preference', 'instruction'].includes(memory.kind)) fail('invalid_input');
      object(value, ['anchors']);
      anchors = denseArray(value.anchors, 1, 4).map(anchor => {
        object(anchor, receipts ? ['receiptIndex', 'start', 'end'] : ['receiptId', 'digest', 'start', 'end']);
        let receipt;
        if (receipts) {
          if (!Number.isSafeInteger(anchor.receiptIndex) || anchor.receiptIndex < 0 || anchor.receiptIndex >= receipts.length) fail('invalid_input');
          receipt = db.prepare('SELECT id,excerpt FROM receipts WHERE memory_id=? AND receipt_key=?')
            .get(memory.id, sourceDigest(JSON.stringify(receipts[anchor.receiptIndex])));
        } else receipt = db.prepare('SELECT id,excerpt FROM receipts WHERE memory_id=? AND id=?').get(memory.id, anchor.receiptId);
        if (!receipt || (!receipts && sourceDigest(receipt.excerpt) !== anchor.digest)) fail('invalid_input');
        sourceSpan(receipt.excerpt, anchor.start, anchor.end);
        return { receiptId: receipt.id, digest: sourceDigest(receipt.excerpt), start: anchor.start, end: anchor.end };
      });
    }
    db.prepare(`INSERT INTO procedural_tags VALUES(?,1,?,?,?) ON CONFLICT(memory_id) DO UPDATE SET
      tag_revision=tag_revision+1,positive=excluded.positive,origin=excluded.origin,anchors=excluded.anchors`)
      .run(memory.id, value === null ? 0 : 1, value === null ? null : origin, anchors ? JSON.stringify(anchors) : null);
    advanceEpoch({ ownerId: memory.owner_id, scope: memory.scope, projectId: memory.project_id });
    return inspect(memory.id);
  }
  function set(ns, input) {
    ensureEpisodes(db);
    return transaction(db, () => {
      const memory = activeRow(ns, input.memoryId);
      if (!memory) fail('memory_not_found');
      if (memory.currentness !== 'current') fail('memory_historical');
      if (memory.revision !== input.expectedRevision || (inspect(memory.id)?.tagRevision ?? 0) !== input.expectedTagRevision) fail('revision_conflict');
      return { tag: write(memory, input.procedural), indexRevision: epoch(ns) };
    });
  }
  return { inspect, clear, write, set };
}

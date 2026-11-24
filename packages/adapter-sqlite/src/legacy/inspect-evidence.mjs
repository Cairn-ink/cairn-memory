import { createHash } from "node:crypto";
import { createQualificationStorage } from "../../../../core/claim-qualification-storage.mjs";
import { anchoredReadSafety } from "../../../../core/content-safety.mjs";
import { createProceduralStorage } from "../../../../core/procedural-storage.mjs";

const digest = text => createHash("sha256").update(text).digest("hex");
const scope = row => ({ owner: row.owner_id, namespace: row.scope + "\0" + row.project_id });
const namespace = row => ({ ownerId: row.owner_id, scope: row.scope, projectId: row.project_id || null });
const toJson = value => value == null ? null : JSON.stringify(value);

// Qualify adjuncts in the cold legacy snapshot with the same receipt safety
// rules as inspect. The target rechecks their anchors when serving them.
export function readInspectMigrationInput(db, { cursorSecret, receipts, namespaceEpochs, history, memo }) {
  const qualification = createQualificationStorage({ db, receiptKey: receipt => digest(JSON.stringify(receipt)) });
  const procedural = createProceduralStorage({ db });
  const liveRows = db.prepare("SELECT * FROM memories WHERE deleted = 0 AND review_state != 'awaiting'");
  const links = new Map(history.map(link => [link.previous_memory_id, link]));
  const evidence = [];
  for (const row of liveRows.iterate()) {
    const safe = value => value && anchoredReadSafety(db, {
      namespace: namespace(row), memoryId: row.id, anchors: value.anchors, memo, project: true,
    }).allowed ? value : null;
    let qualified = null;
    try {
      qualified = safe(qualification.inspect(row, { withholdDenied: true }));
    } catch (error) {
      if (error.code !== "storage_error") throw error;
    }
    let tag = null;
    try {
      const stored = procedural.inspect(row.id);
      if (stored && Array.isArray(stored.anchors) && stored.anchors.length <= 4 &&
          ["explicit", "model", null].includes(stored.origin) && validPosition(stored.tagRevision)) {
        tag = safe({ ...stored, origin: stored.origin === "model" ? "inferred" : stored.origin });
      }
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    }
    const link = links.get(row.id);
    const supersession = link && {
      previousRevision: Number(link.previous_revision), memoryId: link.replacement_memory_id,
      revision: Number(link.replacement_revision), receiptIds: parseReceiptIds(link.receipt_ids),
    };
    const filing = row.filing_status;
    if (filing === "filed" || qualified || tag || supersession) {
      evidence.push({ scope: scope(row), id: row.id, filing,
        qualification: toJson(qualified), procedural: toJson(tag), supersession: toJson(supersession) });
    }
  }
  return {
    cursorSecret, evidence,
    receiptPositions: new Map(receipts.flatMap(row => {
      const position = Number(row.inspect_position);
      return validPosition(position) ? [[row.id, position]] : [];
    })),
    epochs: namespaceEpochs.map(row => ({ scope: scope(row), value: Number(row.epoch) })),
  };
}

function validPosition(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function parseReceiptIds(json) {
  try {
    const ids = JSON.parse(json);
    if (Array.isArray(ids) && ids.length <= 4 && ids.every(id => typeof id === "string") &&
        new Set(ids).size === ids.length) return ids;
  } catch { /* Withhold malformed links. */ }
  return [];
}

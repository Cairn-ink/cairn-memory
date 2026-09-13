import { randomUUID } from 'node:crypto';
import { fail } from './validation.mjs';

const descriptor = row => ({ subject: row.subject, property: row.property,
  scope: row.claim_scope, applies: row.applies });
const complete = slot => Object.values(slot).every(value => value !== null);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Trusted local caller attests identity and single-claim shape. None of these
// checks independently prove semantic identity, atomicity or source entailment.
// Every caller holds the runtime's write transaction; no model or external I/O.
export function createQualifiedTransitionStorage({ db, qualificationStorage, advanceEpoch, epoch }) {
  const slotRow = id => db.prepare('SELECT * FROM qualified_slots WHERE id = ?').get(id);
  const memberRow = id => db.prepare('SELECT * FROM qualified_claim_bindings WHERE memory_id = ?').get(id);
  const owned = (slot, ns) => slot && slot.owner_id === ns.ownerId &&
    slot.scope === ns.scope && slot.project_id === ns.projectId;

  function inspect(ns, memory, qualification) {
    const member = memberRow(memory.id);
    if (!member) return null;
    const slot = slotRow(member.slot_id);
    if (!qualification || !owned(slot, ns) || member.single_claim !== 1 ||
        member.bound_revision !== qualification.boundRevision ||
        member.content_digest !== qualification.contentDigest ||
        !complete(qualification.slot) || !same(descriptor(slot), qualification.slot)) fail('storage_error');
    return member;
  }

  function bind(ns, memory, requestedSlot) {
    const qualification = qualificationStorage.inspect(memory);
    const existing = inspect(ns, memory, qualification);
    if (!qualification) fail('qualification_missing');
    if (!complete(qualification.slot)) fail('qualification_incomplete');
    if (existing) {
      if (requestedSlot !== null && requestedSlot !== existing.slot_id) fail('qualification_conflict');
      return { slotId: existing.slot_id, memory: { id: memory.id, revision: memory.revision },
        indexRevision: epoch(ns) };
    }
    let slotId = requestedSlot;
    if (slotId === null) {
      slotId = randomUUID();
      db.prepare(`INSERT INTO qualified_slots
        (id,owner_id,scope,project_id,subject,property,claim_scope,applies) VALUES (?,?,?,?,?,?,?,?)`)
        .run(slotId, ns.ownerId, ns.scope, ns.projectId, qualification.slot.subject,
          qualification.slot.property, qualification.slot.scope, qualification.slot.applies);
    } else {
      const slot = slotRow(slotId);
      if (!owned(slot, ns)) fail('slot_not_found');
      if (!same(descriptor(slot), qualification.slot)) fail('slot_mismatch');
      // An orphan slot cannot supply a surviving trusted identity attestation.
      if (!db.prepare('SELECT 1 FROM qualified_claim_bindings WHERE slot_id = ? LIMIT 1').get(slotId)) {
        fail('storage_error');
      }
    }
    db.prepare(`INSERT INTO qualified_claim_bindings
      (memory_id,slot_id,bound_revision,content_digest,single_claim) VALUES (?,?,?,?,1)`)
      .run(memory.id, slotId, qualification.boundRevision, qualification.contentDigest);
    return { slotId, memory: { id: memory.id, revision: memory.revision }, indexRevision: advanceEpoch(ns) };
  }

  function supportedReceipts(memory, qualification, fields) {
    const coverage = new Set();
    const ids = new Set();
    for (const anchor of qualification.anchors) {
      const receipt = db.prepare('SELECT role FROM receipts WHERE id = ? AND memory_id = ?')
        .get(anchor.receiptId, memory.id);
      if (!receipt) fail('storage_error');
      if (receipt.role !== 'user') continue;
      for (const field of anchor.fields) if (fields.includes(field)) {
        coverage.add(field); ids.add(anchor.receiptId);
      }
    }
    return fields.every(field => coverage.has(field)) ? [...ids] : null;
  }

  function evaluate(ns, previous, replacement) {
    // Inspect both even if the first lacks support: corruption is never a normal
    // unresolved policy result. No label/slot overrides are accepted here.
    const before = qualificationStorage.inspect(previous);
    const after = qualificationStorage.inspect(replacement);
    const left = inspect(ns, previous, before);
    const right = inspect(ns, replacement, after);
    if (!before || !after) return { reason: 'qualification_missing' };
    if (!left || !right) return { reason: 'binding_missing' };
    if (left.slot_id !== right.slot_id || !same(before.slot, after.slot)) return { reason: 'slot_mismatch' };
    // A two-record CAS cannot retire other current members without their own
    // revision guards. Even an equal-value third claim must remain unresolved.
    if (db.prepare(`SELECT 1 FROM qualified_claim_bindings b JOIN memories m ON m.id = b.memory_id
      WHERE b.slot_id = ? AND m.deleted = 0 AND m.currentness = 'current'
      AND m.id NOT IN (?, ?) LIMIT 1`).get(left.slot_id, previous.id, replacement.id)) {
      return { reason: 'additional_current_claims' };
    }
    if (before.value === null || after.value === null) return { reason: 'value_unknown' };
    if (before.value === after.value) return { reason: 'same_value' };
    if (before.attribution !== 'direct' || after.attribution !== 'direct') return { reason: 'attribution_unsupported' };
    if (before.commitment !== 'adopted' || after.commitment !== 'adopted') return { reason: 'commitment_unsupported' };
    const previousReceipts = supportedReceipts(previous, before, ['commitment']);
    const receiptIds = supportedReceipts(replacement, after, ['commitment', 'value']);
    if (!previousReceipts || !receiptIds) return { reason: 'adoption_evidence_missing' };
    return { reason: null, receiptIds };
  }

  return { bind, evaluate };
}

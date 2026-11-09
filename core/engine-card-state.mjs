// Engine identities select an additional policy; they never grant authority.
// The canonical Card operation and source bindings must also exist and match.
export const isEngineCard = id => typeof id === 'string' && id.startsWith('engine-card.');
export function engineCardMetadataInside(db, ns, row) {
  if (!isEngineCard(row.id)) return null;
  const operation = db.prepare(`SELECT result FROM card_operations WHERE owner_id=? AND scope=?
    AND project_id=? AND action_id=? AND method='consolidate' AND target_id=?`)
    .get(ns.ownerId, ns.scope, ns.projectId ?? '', row.id, row.id);
  if (!operation) return null;
  try {
    const value = JSON.parse(operation.result);
    return value.origin === 'engine' && value.id === row.id && value.revision === 1 &&
      typeof value.clusterKey === 'string' && typeof value.builtAt === 'string' &&
      Number.isFinite(Date.parse(value.builtAt)) && Array.isArray(value.sourceRevisions) && value.sourceRevisions.length <= 96 &&
      value.sourceRevisions.every(ref => ref && typeof ref.memoryId === 'string' && Number.isSafeInteger(ref.revision) && ref.revision > 0) &&
      new Set(value.sourceRevisions.map(ref => ref.memoryId)).size === value.sourceRevisions.length ? value : null;
  } catch { return null; }
}

// A Card is current only while *all* source revisions are current. Historical
// claims can be sources: their values belong in the timeline, not current state.
export function engineCardRevisionsInside(db, ns, row) {
  const metadata = engineCardMetadataInside(db, ns, row);
  if (!metadata || row.revision !== metadata.revision || row.state !== 'confirmed') return false;
  const sources = db.prepare(`SELECT b.memory_id,b.memory_revision,m.revision,m.deleted,m.owner_id,m.scope,m.project_id
    FROM card_memory_bindings b LEFT JOIN memories m ON m.id=b.memory_id WHERE b.card_id=?`).all(row.id);
  return sources.length > 0 && sources.length === metadata.sourceRevisions.length && sources.every(s =>
    metadata.sourceRevisions.some(ref => ref.memoryId === s.memory_id && ref.revision === s.memory_revision) &&
    s.memory_revision === s.revision && !s.deleted && s.owner_id === ns.ownerId && s.scope === ns.scope && s.project_id === (ns.projectId ?? ''));
}

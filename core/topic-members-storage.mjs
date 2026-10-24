import { identifier, revision, fail } from './validation.mjs';
import { memberKinds } from './topic-members-input.mjs';

export const MEMBER_STATE_BYTES = 8 * 1024 * 1024;
const same = (r, n) => r && r.owner_id === n.ownerId && r.scope === n.scope && r.project_id === n.projectId;
function validMetadata(row) {
  try { identifier(row.id); revision(row.revision); } catch { fail('unsupported_database'); }
}
/** Each step makes one indexed physical visit and at most three point validations.
 * Only one candidate and its canonical attribution survive a step/call. */
export function createTopicMembersStorage(db) {
  const q = sql => db.prepare(sql);
  const moc = q('SELECT id,owner_id,scope,project_id,revision,level FROM mocs WHERE id=?');
  const nextSQL = `SELECT id,revision,kind,deleted,currentness,review_state FROM memories INDEXED BY index_memory_keyset
    WHERE owner_id=? AND scope=? AND project_id=? AND id>? ORDER BY id LIMIT 1`;
  const next = q(nextSQL), first = q(nextSQL.replace('id>?', 'id>=?'));
  const ref = q(`SELECT moc_id,moc_revision,memory_revision FROM moc_memory_refs INDEXED BY memory_moc_refs
    WHERE memory_id=? AND moc_id>? ORDER BY moc_id LIMIT 1`);
  const edge = q('SELECT parent_revision,child_revision FROM moc_edges WHERE parent_id=? AND child_id=?');
  const pm = q('SELECT revision FROM index_memories WHERE generation=? AND id=?');
  const pc = q('SELECT revision FROM index_mocs WHERE generation=? AND id=?');
  const pr = q('SELECT moc_revision,memory_revision FROM index_memory_refs WHERE generation=? AND moc_id=? AND memory_id=?');
  const pe = q('SELECT parent_revision,child_revision FROM index_edges WHERE generation=? AND parent_id=? AND child_id=?');
  const projected = (statement, generation, expected, ...keys) => {
    if (generation === null) return true;
    const row = statement.get(generation, ...keys);
    return row && Object.keys(expected).every(key => row[key] === expected[key]);
  };
  function target(request, captured) {
    if (request.selection.type === 'unfiled') return;
    const row = moc.get(request.selection.mocId);
    if (!same(row, request.namespace) || !projected(pc, captured.generation, { revision: row.revision }, row.id)) fail('moc_not_found');
    validMetadata(row);
    if (![1, 2].includes(row.level)) fail('unsupported_database');
    if (row.revision !== request.selection.revision) fail('revision_conflict');
    if (`L${row.level}` !== request.selection.level) fail('invalid_ref');
  }
  function step(s, request, captured) {
    const n = request.namespace, g = captured.generation;
    if (s.phase === 'memory') {
      const row = (s.started ? next : first).get(n.ownerId, n.scope, n.projectId, s.after);
      s.started = true;
      if (!row) { s.done = true; return; }
      s.after = row.id;
      if (row.deleted || row.currentness !== 'current' || !['none', 'confirmed'].includes(row.review_state) ||
          !projected(pm, g, { revision: row.revision }, row.id)) return;
      validMetadata(row);
      if (!memberKinds.includes(row.kind)) fail('unsupported_database');
      if (request.kind !== null && request.kind !== row.kind) return;
      s.row = row; s.refAfter = ''; s.attribution = null; s.phase = 'ref';
    } else if (s.phase === 'ref') {
      const placement = ref.get(s.row.id, s.refAfter);
      if (!placement) { s.phase = 'settle'; return; }
      s.refAfter = placement.moc_id;
      const child = moc.get(placement.moc_id);
      if (!same(child, n) || child.level !== 1 || child.revision !== placement.moc_revision ||
          s.row.revision !== placement.memory_revision ||
          !projected(pc, g, { revision: child.revision }, child.id) ||
          !projected(pr, g, { moc_revision: placement.moc_revision, memory_revision: placement.memory_revision }, child.id, s.row.id)) return;
      validMetadata(child);
      if (request.selection.type === 'unfiled') { s.phase = 'memory'; s.row = null; return; }
      if (request.selection.level === 'L1') {
        if (child.id === request.selection.mocId) {
          s.attribution ??= { type: 'l1', mocId: child.id, revision: child.revision };
        }
      } else { s.child = child; s.phase = 'edge'; }
    } else if (s.phase === 'edge') {
      const c = s.child, selected = request.selection, row = edge.get(selected.mocId, c.id);
      if (row && row.parent_revision === selected.revision && row.child_revision === c.revision &&
          projected(pe, g, { parent_revision: row.parent_revision, child_revision: row.child_revision }, selected.mocId, c.id)) {
        // Ref seeks use BINARY ordering, so the first valid child is canonical.
        s.attribution ??= { type: 'l1', mocId: c.id, revision: c.revision };
      }
      s.phase = 'ref';
      s.child = null;
    } else if (s.phase === 'settle') {
      if (s.attribution || request.selection.type === 'unfiled') {
        s.pending = { id: s.row.id, revision: s.row.revision, kind: s.row.kind, reportedUnder: s.attribution };
      }
      s.row = null; s.attribution = null; s.phase = 'memory';
    }
  }
  return { target, step, create: () => ({ phase: 'memory', after: '', done: false, pending: null }) };
}

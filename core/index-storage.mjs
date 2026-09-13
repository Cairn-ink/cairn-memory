import { randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';
import { fail } from './validation.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId];
const owned = (row, ns) => row && row.owner_id === ns.ownerId && row.scope === ns.scope && row.project_id === ns.projectId;
const namespace = alias => `${alias}.owner_id = ? AND ${alias}.scope = ? AND ${alias}.project_id = ?`;
const phases = [
  { table: 'memories', keys: ['id'], projection: 'index_memories', columns: ['id','revision'] },
  { table: 'mocs', keys: ['id'], projection: 'index_mocs', columns: ['id','revision'] },
  { table: 'moc_title_sources', keys: ['moc_id','memory_id'], projection: 'index_title_sources', columns: ['moc_id','memory_id','memory_revision'] },
  { table: 'moc_memory_refs', keys: ['moc_id','memory_id'], projection: 'index_memory_refs', columns: ['moc_id','memory_id','moc_revision','memory_revision'] },
  { table: 'moc_edges', keys: ['parent_id','child_id'], projection: 'index_edges', columns: ['parent_id','child_id','parent_revision','child_revision'] },
];

export function createIndexStorage({ db, epoch, advanceEpoch }) {
  function assertAvailable(ns) {
    const state = db.prepare(`SELECT active_generation FROM namespace_index_state WHERE ${namespace('namespace_index_state')}`)
      .get(...boundary(ns));
    if (state && state.active_generation === null) fail('index_unavailable');
  }

  function next(ns, phase, key) {
    const p = phases[phase];
    const tuple = `(${p.keys.map(k => `r.${k}`).join(',')})`;
    const after = key === null ? '' : ` AND ${tuple} > (${p.keys.map(() => '?').join(',')})`;
    if (phase < 2) return db.prepare(`SELECT r.id, r.revision, ${phase === 0 ? 'r.deleted, r.currentness' : 'r.level'} FROM ${p.table} r
      WHERE ${namespace('r')}${after} ORDER BY ${p.keys.map(k => `r.${k}`).join(',')} LIMIT 1`)
      .get(...boundary(ns), ...(key ?? []));
    // Namespace attribution happens only after a bounded indexed read. Filtering
    // here through endpoint joins could scan arbitrarily many orphan/foreign rows.
    // Such rows consume work too; their key remains private persisted progress.
    return db.prepare(`SELECT r.* FROM ${p.table} r
      WHERE 1 = 1${after}
      ORDER BY ${p.keys.map(k => `r.${k}`).join(',')} LIMIT 1`)
      .get(...(key ?? []));
  }

  function invalid(ns, phase, row) {
    if (phase === 0) return row.deleted || row.currentness !== 'current' ? 'skip' : null;
    if (phase === 1) return [1,2].includes(row.level) ? null : {
      parentId: row.id, childType: 'moc', childId: row.id, reason: 'invalid_level' };
    const edge = phase === 4;
    const parentId = edge ? row.parent_id : row.moc_id;
    const childId = edge ? row.child_id : row.memory_id;
    const parent = db.prepare('SELECT id, owner_id, scope, project_id, level, revision FROM mocs WHERE id = ?').get(parentId);
    const child = db.prepare(`SELECT id, owner_id, scope, project_id, revision, ${edge ? 'level' : 'deleted, currentness'}
      FROM ${edge ? 'mocs' : 'memories'} WHERE id = ?`).get(childId);
    if (!owned(parent, ns) && !owned(child, ns)) return 'skip';
    let reason = null;
    if (!owned(parent, ns) || !owned(child, ns)) reason = 'not_found';
    else if ((edge && (parent.level !== 2 || child.level !== 1)) ||
      (phase === 3 && parent.level !== 1) || (phase === 2 && ![1,2].includes(parent.level))) reason = 'invalid_level';
    else if (child.deleted || (!edge && child.currentness !== 'current') ||
      child.revision !== (edge ? row.child_revision : row.memory_revision) ||
      (phase !== 2 && parent.revision !== (edge ? row.parent_revision : row.moc_revision))) reason = 'stale';
    return reason ? { parentId, childType: edge ? 'moc' : 'memory', childId, reason } : null;
  }

  function rebuildIndex(ns, { expectedIndexRevision, limit, progress }) {
    if (!Number.isSafeInteger(expectedIndexRevision) || expectedIndexRevision < 1 ||
      !Number.isInteger(limit) || limit < 1 || limit > 500) fail('invalid_input');
    return transaction(db, () => {
      let generation;
      if (progress !== undefined) {
        if (!progress || typeof progress !== 'object' || Array.isArray(progress) ||
          Object.keys(progress).sort().join(',') !== 'generation,phase,sequence' ||
          typeof progress.generation !== 'string' || !Number.isInteger(progress.phase) ||
          progress.phase < 0 || progress.phase > 4 || !Number.isSafeInteger(progress.sequence) ||
          progress.sequence < 1) fail('invalid_cursor');
        generation = db.prepare('SELECT * FROM index_generations WHERE id = ?').get(progress.generation);
        if (!generation || !owned(generation, ns) || generation.captured_epoch !== expectedIndexRevision ||
          generation.page_limit !== limit || generation.published || generation.phase !== progress.phase ||
          generation.sequence !== progress.sequence) fail('invalid_cursor');
        if (epoch(ns) !== expectedIndexRevision) fail('stale_rebuild');
      } else {
        if (epoch(ns) !== expectedIndexRevision) fail('index_revision_conflict');
        generation = { id: randomUUID(), phase: 0, last_key: 'null', sequence: 0 };
        db.prepare(`INSERT INTO namespace_index_state(owner_id,scope,project_id,active_generation)
          VALUES (?,?,?,NULL) ON CONFLICT DO NOTHING`).run(...boundary(ns));
        db.prepare(`INSERT INTO index_generations(id,owner_id,scope,project_id,captured_epoch,page_limit,phase,last_key,sequence)
          VALUES (?,?,?,?,?,?,0,'null',0)`).run(generation.id,...boundary(ns),expectedIndexRevision,limit);
      }
      let phase = generation.phase;
      let key = JSON.parse(generation.last_key);
      let visited = 0;
      const invalidRefs = [];
      while (phase < phases.length) {
        const row = next(ns, phase, key);
        if (!row) { phase++; key = null; continue; }
        if (visited === limit) break;
        visited++;
        const p = phases[phase];
        key = p.keys.map(k => row[k]);
        const problem = invalid(ns, phase, row);
        if (problem) { if (problem !== 'skip') invalidRefs.push(problem); continue; }
        db.prepare(`INSERT INTO ${p.projection}(generation,${p.columns.join(',')})
          VALUES (${p.columns.map(() => '?').concat('?').join(',')})`)
          .run(generation.id,...p.columns.map(k => row[k]));
      }
      if (phase === phases.length) {
        db.prepare(`UPDATE namespace_index_state SET active_generation = ? WHERE ${namespace('namespace_index_state')}`)
          .run(generation.id,...boundary(ns));
        db.prepare('UPDATE index_generations SET published = 1, phase = 5, sequence = sequence + 1 WHERE id = ?').run(generation.id);
        return { state: 'published', indexRevision: advanceEpoch(ns), progress: null, exhausted: true, invalidRefs };
      }
      const sequence = generation.sequence + 1;
      db.prepare('UPDATE index_generations SET phase = ?, last_key = ?, sequence = ? WHERE id = ?')
        .run(phase,JSON.stringify(key),sequence,generation.id);
      return { state: 'staged', indexRevision: expectedIndexRevision,
        progress: { generation: generation.id, phase, sequence }, exhausted: false, invalidRefs };
    });
  }
  return Object.freeze({ rebuildIndex, assertAvailable });
}

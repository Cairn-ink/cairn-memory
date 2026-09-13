// Projections deliberately have no foreign keys to mutable declaration tables.
// An unfinished generation is an immutable snapshot of the work already visited.
export function migrateVersion6(db) {
  db.exec(`
    CREATE TABLE namespace_index_state (
      owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      active_generation TEXT, PRIMARY KEY(owner_id, scope, project_id)
    ) STRICT;
    CREATE TABLE index_generations (
      id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, scope TEXT NOT NULL, project_id TEXT NOT NULL,
      captured_epoch INTEGER NOT NULL, page_limit INTEGER NOT NULL,
      phase INTEGER NOT NULL, last_key TEXT NOT NULL, sequence INTEGER NOT NULL,
      published INTEGER NOT NULL DEFAULT 0
    ) STRICT;
    CREATE INDEX index_memory_keyset ON memories(owner_id, scope, project_id, id);
    CREATE INDEX index_moc_keyset ON mocs(owner_id, scope, project_id, id);
    CREATE TABLE index_memories (generation TEXT NOT NULL, id TEXT NOT NULL,
      revision INTEGER NOT NULL, PRIMARY KEY(generation,id)) STRICT;
    CREATE TABLE index_mocs (generation TEXT NOT NULL, id TEXT NOT NULL,
      revision INTEGER NOT NULL, PRIMARY KEY(generation,id)) STRICT;
    CREATE TABLE index_title_sources (generation TEXT NOT NULL, moc_id TEXT NOT NULL,
      memory_id TEXT NOT NULL, memory_revision INTEGER NOT NULL,
      PRIMARY KEY(generation,moc_id,memory_id)) STRICT;
    CREATE TABLE index_memory_refs (generation TEXT NOT NULL, moc_id TEXT NOT NULL,
      memory_id TEXT NOT NULL, moc_revision INTEGER NOT NULL, memory_revision INTEGER NOT NULL,
      PRIMARY KEY(generation,moc_id,memory_id)) STRICT;
    CREATE TABLE index_edges (generation TEXT NOT NULL, parent_id TEXT NOT NULL,
      child_id TEXT NOT NULL, parent_revision INTEGER NOT NULL, child_revision INTEGER NOT NULL,
      PRIMARY KEY(generation,parent_id,child_id)) STRICT;
  `);
  installIndexReaders(db);
}

// Refresh only readers and their maintenance triggers; generations and progress
// are durable and must survive a schema upgrade unchanged.
export function installIndexReaders(db, currentOnly = false) {
  const same = (a, b) => `${a}.owner_id = ${b}.owner_id AND ${a}.scope = ${b}.scope AND ${a}.project_id = ${b}.project_id`;
  const active = (alias) => `SELECT active_generation FROM namespace_index_state s WHERE ${same('s', alias)}`;
  const definitions = [
    { raw: 'memories', projection: 'index_memories', view: 'index_read_memories', keys: ['id'], columns: ['id','revision'],
      from: 'memories r', valid: `r.deleted = 0${currentOnly ? " AND r.currentness = 'current'" : ''}`, owner: 'r' },
    { raw: 'mocs', projection: 'index_mocs', view: 'index_read_mocs', keys: ['id'], columns: ['id','revision'],
      from: 'mocs r', valid: 'r.level IN (1,2)', owner: 'r' },
    { raw: 'moc_title_sources', projection: 'index_title_sources', view: 'index_read_title_sources', keys: ['moc_id','memory_id'], columns: ['moc_id','memory_id','memory_revision'],
      from: 'moc_title_sources r JOIN mocs p ON p.id = r.moc_id JOIN memories c ON c.id = r.memory_id',
      valid: `${same('p','c')} AND p.level IN (1,2) AND c.deleted = 0 AND c.revision = r.memory_revision${currentOnly ? " AND c.currentness = 'current'" : ''}`, owner: 'p' },
    { raw: 'moc_memory_refs', projection: 'index_memory_refs', view: 'index_read_memory_refs', keys: ['moc_id','memory_id'], columns: ['moc_id','memory_id','moc_revision','memory_revision'],
      from: 'moc_memory_refs r JOIN mocs p ON p.id = r.moc_id JOIN memories c ON c.id = r.memory_id',
      valid: `${same('p','c')} AND p.level = 1 AND c.deleted = 0 AND p.revision = r.moc_revision AND c.revision = r.memory_revision${currentOnly ? " AND c.currentness = 'current'" : ''}`, owner: 'p' },
    { raw: 'moc_edges', projection: 'index_edges', view: 'index_read_edges', keys: ['parent_id','child_id'], columns: ['parent_id','child_id','parent_revision','child_revision'],
      from: 'moc_edges r JOIN mocs p ON p.id = r.parent_id JOIN mocs c ON c.id = r.child_id',
      valid: `${same('p','c')} AND p.level = 2 AND c.level = 1 AND p.revision = r.parent_revision AND c.revision = r.child_revision`, owner: 'p' },
  ];
  for (const d of definitions) {
    if (currentOnly) {
      db.exec(`DROP VIEW ${d.view};
        DROP TRIGGER index_${d.raw}_insert;
        DROP TRIGGER index_${d.raw}_update;
        DROP TRIGGER index_${d.raw}_delete;`);
    }
    const match = d.columns.map(k => `i.${k} = r.${k}`).join(' AND ');
    // Preserve the pre-rebuild live read behavior (including its invalid-ref reports).
    const rawOwner = d.owner === 'r' ? '' : ` LEFT JOIN mocs p ON p.id = r.${d.raw === 'moc_edges' ? 'parent_id' : 'moc_id'}`;
    const rawCurrent = !currentOnly ? '' : d.raw === 'memories'
      ? " AND r.currentness = 'current'"
      : ['moc_title_sources', 'moc_memory_refs'].includes(d.raw)
        ? " AND NOT EXISTS (SELECT 1 FROM memories h WHERE h.id = r.memory_id AND h.currentness = 'historical')"
        : '';
    db.exec(`CREATE VIEW ${d.view} AS
      SELECT r.* FROM ${d.raw} r${rawOwner} WHERE (${active(d.owner)}) IS NULL${rawCurrent}
      UNION ALL SELECT r.* FROM ${d.from}
      JOIN ${d.projection} i ON ${match} AND i.generation = (${active(d.owner)})
      WHERE ${d.valid};`);
    const oldMatch = d.keys.map(k => `${k} = OLD.${k}`).join(' AND ');
    const newMatch = d.keys.map(k => `r.${k} = NEW.${k}`).join(' AND ');
    const generations = d.owner === 'r' ? `SELECT active_generation FROM namespace_index_state s WHERE ${same('s','OLD')}` :
      `SELECT s.active_generation FROM namespace_index_state s JOIN mocs p ON ${same('s','p')}
        WHERE p.id = OLD.${d.raw === 'moc_edges' ? 'parent_id' : 'moc_id'}
       UNION SELECT s.active_generation FROM namespace_index_state s
        JOIN ${d.raw === 'moc_edges' ? 'mocs' : 'memories'} c ON ${same('s','c')}
        WHERE c.id = OLD.${d.raw === 'moc_edges' ? 'child_id' : 'memory_id'}`;
    const remove = `DELETE FROM ${d.projection} WHERE ${oldMatch}
      AND generation IN (${generations});`;
    const insert = `INSERT OR REPLACE INTO ${d.projection}(generation,${d.columns.join(',')})
      SELECT (${active(d.owner)}),${d.columns.map(k => `r.${k}`).join(',')}
      FROM ${d.from} WHERE ${newMatch} AND ${d.valid} AND (${active(d.owner)}) IS NOT NULL;`;
    // Revision refreshes of other groups must not resurrect an excluded raw ref.
    // Only an explicit INSERT creates previously absent projected relationships.
    const refresh = `UPDATE ${d.projection} SET ${d.columns.map(k => `${k} = NEW.${k}`).join(',')}
      WHERE ${oldMatch} AND generation IN
        (${generations});
      DELETE FROM ${d.projection} WHERE ${d.keys.map(k => `${k} = NEW.${k}`).join(' AND ')}
        AND generation IN (${generations})
        AND NOT EXISTS (SELECT 1 FROM ${d.from} WHERE ${newMatch} AND ${d.valid});`;
    db.exec(`CREATE TRIGGER index_${d.raw}_insert AFTER INSERT ON ${d.raw} BEGIN ${insert} END;
      CREATE TRIGGER index_${d.raw}_update AFTER UPDATE ON ${d.raw} BEGIN ${refresh} END;
      CREATE TRIGGER index_${d.raw}_delete AFTER DELETE ON ${d.raw} BEGIN ${remove} END;`);
  }
}

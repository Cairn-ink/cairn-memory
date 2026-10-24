// Independent physical-visit oracle. SQL markers confer NO accounting exemption.
// Scope comes from actual row namespace columns or a separate snapshot of the
// referenced canonical identities. The snapshot is observer setup, not product
// work. WHERE callbacks count discarded rows as well as returned rows; EQP
// parity proves instrumentation did not repair/change the product access plan.
export function instrumentSourceWork(db, { readSet } = {}) {
  if (!readSet?.length) throw Error('measurement_read_set_required');
  const prepare = db.prepare.bind(db), key = ns => JSON.stringify([ns.ownerId, ns.scope, ns.projectId ?? '']);
  const authorized = new Set(readSet.map(key)), entities = new Map();
  const tables = new Set(prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
  for (const table of ['memories', 'private_cards', 'mocs', 'card_mocs']) {
    const identities = new Map();
    if (tables.has(table)) for (const row of prepare(`SELECT id,owner_id,scope,project_id FROM ${table}`).all())
      identities.set(row.id, authorized.has(JSON.stringify([row.owner_id, row.scope, row.project_id])));
    entities.set(table, identities);
  }
  const counts = { lookups: 0, visits: 0, byTable: {}, lookupsByTable: {}, plansChecked: 0, private: { lookups: 0, visits: 0, byTable: {}, lookupsByTable: {}, plansChecked: 0 } };
  const frames = [], plans = new Set(), columns = new Map();
  function descriptor(table, alias) {
    if (!columns.has(table)) columns.set(table, new Set(prepare(`PRAGMA table_info(${table})`).all().map(row => row.name)));
    const names = columns.get(table), col = name => `${alias}.${name}`;
    if (['owner_id', 'scope', 'project_id'].every(name => names.has(name)))
      return { columns: ['owner_id', 'scope', 'project_id'].map(col), classify: values => authorized.has(JSON.stringify(values)) };
    let refs;
    if (table === 'rationale_edges') refs = [['from_id', 'memories'], ['to_id', 'memories']];
    else if (table === 'memory_conflicts') refs = [['left_memory_id', 'memories'], ['right_memory_id', 'memories']];
    else if (table === 'card_memory_bindings') refs = [['card_id', 'private_cards'], ['memory_id', 'memories']];
    else if (['moc_edges', 'index_edges'].includes(table)) refs = [['parent_id', 'mocs'], ['child_id', 'mocs']];
    else if (table === 'card_moc_edges') refs = [['parent_id', 'card_mocs'], ['child_id', 'card_mocs']];
    else if (['moc_title_sources', 'moc_memory_refs', 'index_title_sources', 'index_memory_refs'].includes(table)) refs = [['moc_id', 'mocs'], ['memory_id', 'memories']];
    else if (['card_moc_title_sources', 'card_moc_refs'].includes(table)) refs = [['moc_id', 'card_mocs'], ['card_id', 'private_cards']];
    else if (table === 'index_memories') refs = [['id', 'memories']];
    else if (table === 'index_mocs') refs = [['id', 'mocs']];
    else if (names.has('memory_id')) refs = [['memory_id', 'memories']];
    else if (names.has('card_id')) refs = [['card_id', 'private_cards']];
    else refs = [];
    return { columns: refs.map(([name]) => col(name)), classify: values => refs.every(([, entity], i) => entities.get(entity).get(values[i]) !== false) };
  }
  const descriptors = new Map(); let sequence = 0;
  db.function('u5c2_visit', { varargs: true }, (id, table, _rowid, ...values) => {
    const publicRow = descriptors.get(id).classify(values), ledger = publicRow ? counts : counts.private;
    ledger.visits++; ledger.byTable[table] = (ledger.byTable[table] ?? 0) + 1;
    const frame = frames.at(-1); if (frame) frame[publicRow ? 'public' : 'foreign'] = true;
    return 1;
  });
  function instrument(sql) {
    const referenced = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)(?:\s+(?:AS\s+)?((?!(?:WHERE|INDEXED|JOIN|CROSS|ORDER|LIMIT|ON)\b)[a-z_]+))?/gi)];
    if (!referenced.length || !/\bWHERE\b/i.test(sql)) throw Error('unmetered_source_statement: ' + sql);
    const predicates = referenced.map(([, table, alias]) => {
      const id = ++sequence, d = descriptor(table, alias ?? table); descriptors.set(id, d);
      return `u5c2_visit(${id},'${table}',${alias ?? table}.rowid${d.columns.length ? ',' + d.columns.join(',') : ''})`;
    });
    // A namespace-prefix index can test an unindexed ID residual before an
    // ordinary WHERE callback. Guard that residual with CASE so every physical
    // namespace row is observed. Preserve/compare EQP; never silently repair it.
    if (referenced.length === 1 && /INDEXED BY (?:private_card_scope|sqlite_autoindex_card_mocs_2)\b/.test(sql) && /\bid IN \(/.test(sql))
      return sql.replace(/\bid IN \([^)]*\)/, predicate => `(CASE WHEN ${predicates[0]} THEN ${predicate} ELSE 0 END)`);
    return sql.replace(/\bWHERE\b/i, 'WHERE ' + predicates.join(' AND ') + ' AND');
  }
  function lookup(frame) {
    const ledger = frame.ownerForeign ? counts.private : frame.ownerPublic || frame.empty || frame.public || !frame.foreign ? counts : counts.private;
    ledger.lookups++; ledger.lookupsByTable[frame.table] = (ledger.lookupsByTable[frame.table] ?? 0) + 1;
  }
  return { counts, database: { prepare(sql) {
    const meteredSql = instrument(sql), statement = prepare(meteredSql), table = sql.match(/\bFROM\s+([a-z_]+)/i)[1];
    function plan(args) {
      if (plans.has(sql)) return;
      const details = query => prepare('EXPLAIN QUERY PLAN ' + query).all(...args).map(row => row.detail);
      if (JSON.stringify(details(sql)) !== JSON.stringify(details(meteredSql))) throw Error('instrumentation_changed_access_plan: ' + sql);
      plans.add(sql); counts.plansChecked++;
    }
    return { get(...args) {
      plan(args); const frame = { table }; frames.push(frame);
      try { const row = statement.get(...args); frame.empty = !row; return row; } finally { frames.pop(); lookup(frame); }
    }, all(...args) {
      plan(args); const frame = { table }; frames.push(frame);
      try { return statement.all(...args); } finally { frames.pop(); lookup(frame); }
    }, iterate(...args) {
      plan(args);
      // Cursor construction is a lookup even if the budget stops before its
      // first step. Full incident cursors are owned by the authorized seed;
      // row visits are classified separately from that single lookup.
      const owner = sql.match(/WHERE (?:e\.)?(id|card_id|memory_id|moc_id|parent_id|from_id|to_id|left_memory_id|right_memory_id)=\?/);
      const column = owner?.[1];
      const entity = column === 'id' ? table : column === 'card_id' ? 'private_cards' : ['moc_id', 'parent_id'].includes(column) ?
        table.startsWith('card_') ? 'card_mocs' : 'mocs' : 'memories';
      const known = owner && entities.get(entity)?.get(args[0]);
      const frame = { table, ownerPublic: known !== false, ownerForeign: known === false }, iterator = statement.iterate(...args);
      lookup(frame);
      return { next() {
        frames.push(frame);
        try { return iterator.next(); } finally { frames.pop(); }
      }, return() { return iterator.return?.() ?? { done: true }; },
      [Symbol.iterator]() { return this; } };
    } };
  } } };
}

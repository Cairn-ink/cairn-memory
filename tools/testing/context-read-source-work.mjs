// Opt-in test/measurement instrumentation. SQLite invokes the visit function
// from WHERE for each row it tests, including rows discarded by joins, filters
// or a later sort/LIMIT. Counting iterator outputs would miss those visits.
// EQP parity checks ensure adding the function did not change the access plan.
// Private scope-filter SQL is marked explicitly and metered separately. Its
// physical visits/lookups never masquerade as authorized-source work. The
// independent negative control remains public and detects hidden scans.
// This is deliberately outside the product charging implementation.
export function instrumentSourceWork(db) {
  const prepare = db.prepare.bind(db), counts = { lookups: 0, visits: 0, byTable: {}, plansChecked: 0, private: { lookups: 0, visits: 0, byTable: {}, plansChecked: 0 } };
  db.function('u5c2_visit', (table, _rowid, scope) => {
    const ledger = scope === 'private' ? counts.private : counts;
    ledger.visits++; ledger.byTable[table] = (ledger.byTable[table] ?? 0) + 1; return 1;
  });
  const plans = new Set();
  function instrument(sql) {
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)(?:\s+(?:AS\s+)?((?!(?:WHERE|INDEXED|JOIN|CROSS|ORDER|LIMIT|ON)\b)[a-z_]+))?/gi)];
    if (!tables.length || !/\bWHERE\b/i.test(sql)) throw Error('unmetered_source_statement: ' + sql);
    const predicates = tables.map(([, table, alias]) => `u5c2_visit('${table}',${alias ?? table}.rowid,'${sql.startsWith('/* source-private */') ? 'private' : 'public'}')`);
    return sql.replace(/\bWHERE\b/i, 'WHERE ' + predicates.join(' AND ') + ' AND');
  }
  return { counts, database: { prepare(sql) {
    const meteredSql = instrument(sql), statement = prepare(meteredSql), ledger = sql.startsWith('/* source-private */') ? counts.private : counts;
    return Object.fromEntries(['get', 'all', 'iterate'].map(method => [method, (...args) => {
      if (!plans.has(sql)) {
        const plan = query => prepare('EXPLAIN QUERY PLAN ' + query).all(...args).map(row => row.detail);
        if (JSON.stringify(plan(sql)) !== JSON.stringify(plan(meteredSql))) throw Error('instrumentation_changed_access_plan: ' + sql);
        plans.add(sql); ledger.plansChecked++;
      }
      ledger.lookups++; return statement[method](...args);
    }]));
  } } };
}

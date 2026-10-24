// Opt-in test/measurement instrumentation. SQLite invokes the visit function
// from WHERE for each row it tests, including rows discarded by joins, filters
// or a later sort/LIMIT. Counting iterator outputs would miss those visits.
// EQP parity checks ensure adding the function did not change the access plan.
// This is deliberately outside the product charging implementation.
export function instrumentSourceWork(db) {
  const prepare = db.prepare.bind(db), counts = { lookups: 0, visits: 0, byTable: {}, plansChecked: 0 };
  db.function('u5c2_visit', (table, _rowid) => {
    counts.visits++; counts.byTable[table] = (counts.byTable[table] ?? 0) + 1; return 1;
  });
  const plans = new Set();
  function instrument(sql) {
    const tables = [...sql.matchAll(/\b(?:FROM|JOIN)\s+([a-z_]+)(?:\s+(?:AS\s+)?((?!(?:WHERE|INDEXED|JOIN|CROSS|ORDER|LIMIT|ON)\b)[a-z_]+))?/gi)];
    if (!tables.length || !/\bWHERE\b/i.test(sql)) throw Error('unmetered_source_statement: ' + sql);
    const predicates = tables.map(([, table, alias]) => `u5c2_visit('${table}',${alias ?? table}.rowid)`);
    return sql.replace(/\bWHERE\b/i, 'WHERE ' + predicates.join(' AND ') + ' AND');
  }
  return { counts, database: { prepare(sql) {
    const meteredSql = instrument(sql), statement = prepare(meteredSql);
    return Object.fromEntries(['get', 'all', 'iterate'].map(method => [method, (...args) => {
      if (!plans.has(sql)) {
        const plan = query => prepare('EXPLAIN QUERY PLAN ' + query).all(...args).map(row => row.detail);
        if (JSON.stringify(plan(sql)) !== JSON.stringify(plan(meteredSql))) throw Error('instrumentation_changed_access_plan: ' + sql);
        plans.add(sql); counts.plansChecked++;
      }
      counts.lookups++; return statement[method](...args);
    }]));
  } } };
}

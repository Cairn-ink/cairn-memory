import { fail } from './validation.mjs';

const boundary = ['owner_id', 'scope', 'project_id'];
const primary = {
  memories: ['id'], mocs: ['id'], moc_title_sources: ['moc_id', 'memory_id'],
  moc_edges: ['parent_id', 'child_id'], moc_memory_refs: ['moc_id', 'memory_id'],
  namespace_epochs: boundary, namespace_index_state: boundary, index_generations: ['id'],
  index_memories: ['generation', 'id'], index_mocs: ['generation', 'id'],
  index_title_sources: ['generation', 'moc_id', 'memory_id'],
  index_memory_refs: ['generation', 'moc_id', 'memory_id'], index_edges: ['generation', 'parent_id', 'child_id'],
};
const secondary = [
  ['memories', 'index_memory_keyset', [...boundary, 'id']],
  ['mocs', 'index_moc_keyset', [...boundary, 'id']],
  ['moc_memory_refs', 'memory_moc_refs', ['memory_id', 'moc_id']],
];
const markers = [[20, 'private_cards'], [20, 'card_notes'], [21, 'card_memory_bindings'],
  [22, 'card_applicability_reviews'], [23, 'card_mocs'], [24, 'raw_conversations'],
  [25, 'raw_capture_events'], [26, 'raw_source_maps'], [27, 'raw_deletion_actions'],
  [28, 'card_raw_bindings'], [29, 'local_capture_controls'], [30, 'method_packages'],
  [31, 'assets'], [32, 'role_profiles'], [33, 'card_current_dependencies']];
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const predicate = (columns, binary) => columns.map(name => `${quote(name)}${binary ? ' COLLATE BINARY' : ''}=?`).join(' AND ');

// Lex only bounded index DDL. Quoted names, string literals and comments do not
// turn the word WHERE into a partial-index predicate.
function partial(sql) {
  if (sql === null || sql.length > 4096) fail('unsupported_database');
  const tokens = sql.match(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9]*/g) ?? [];
  return tokens.some(token => token.toUpperCase() === 'WHERE');
}
export function assertPointPlan(db, table, columns, { binary = true, index } = {}) {
  const sql = `EXPLAIN QUERY PLAN SELECT 1 FROM ${quote(table)}${index ? ' INDEXED BY ' + quote(index) : ''}
    WHERE ${predicate(columns, binary)} LIMIT 1`;
  const detail = db.prepare(sql).get(...columns.map(() => ''))?.detail;
  if (!detail?.startsWith('SEARCH ')) fail('unsupported_database');
  if (table === 'store_metadata') {
    if (!detail.includes('INTEGER PRIMARY KEY')) fail('unsupported_database');
    return null;
  }
  if (columns.some(name => !detail.includes(`${name}=?`))) fail('unsupported_database');
  const name = detail.match(/USING (?:COVERING )?INDEX (\S+) \(/)?.[1];
  if (!name || (index ? name !== index : !name.startsWith(`sqlite_autoindex_${table}_`))) fail('unsupported_database');
  return name;
}

/** No native iterator, all(), OFFSET or all-index inventory survives a step.
 * Each step visits one physical schema row/EOF, or one bounded pragma/plan row.
 * Initialization checkpoints are ordinary cloneable traversal data. */
export function createTopicOpening(db, version) {
  const plans = [...Object.entries(primary).map(([table, columns]) => [table, null, columns]), ...secondary];
  const tables = [...Object.keys(primary), 'store_metadata'];
  const wanted = new Set([...tables, ...markers.map(([, name]) => name), ...secondary.map(([, name]) => name)]);
  const schema = db.prepare(`SELECT rowid,type,substr(name,1,256) name,substr(tbl_name,1,256) tbl_name,
    CASE WHEN name IN ('index_memory_keyset','index_moc_keyset','memory_moc_refs') THEN substr(sql,1,4097) END sql
    FROM sqlite_master WHERE rowid>? ORDER BY rowid LIMIT 1`);
  const column = db.prepare('SELECT substr(name,1,256) name,substr(type,1,64) type,pk FROM pragma_table_info(?) WHERE cid=?');
  const indexColumn = db.prepare('SELECT substr(name,1,256) name,"desc",coll,"key" FROM pragma_index_xinfo(?) WHERE seqno=?');
  let ready = false;
  function step(s) {
    if (s.done) return;
    if (s.phase === 'plans') {
      const [table, index, columns] = plans[s.position];
      // Default comparisons must use every BINARY key component too. Explicit
      // BINARY predicates protect reads; this check refuses NOCASE/RTRIM columns.
      const name = assertPointPlan(db, table, columns, { binary: false, index });
      s.indexes.push({ name, columns });
      if (++s.position === plans.length) { s.phase = 'schema'; s.position = 0; }
    } else if (s.phase === 'schema') {
      const row = schema.get(s.after);
      if (row) {
        s.after = row.rowid;
        if (wanted.has(row.name)) {
          if (tables.includes(row.name) || markers.some(([, name]) => name === row.name)) {
            if (row.type !== 'table') fail('unsupported_database');
            s.seen[row.name] = true;
          } else {
            const spec = secondary.find(([, name]) => name === row.name);
            if (row.type !== 'index' || row.tbl_name !== spec[0] || partial(row.sql)) fail('unsupported_database');
            s.seen[row.name] = true;
          }
        }
      } else {
        if ([...tables, ...secondary.map(([, name]) => name)].some(name => !s.seen[name]) ||
            markers.some(([first, name]) => Boolean(s.seen[name]) !== (version >= first))) fail('unsupported_database');
        s.phase = 'columns'; s.position = 0; s.offset = 0; s.keys = [];
      }
    } else if (s.phase === 'columns') {
      const table = tables[s.position], row = column.get(table, s.offset++);
      if (row) {
        if (row.pk) s.keys[row.pk - 1] = row.name;
        const comparisons = [...(primary[table] ?? []), ...secondary.filter(([name]) => name === table).flatMap(([, , keys]) => keys)];
        if (comparisons.includes(row.name) && row.type !== 'TEXT') fail('unsupported_database');
        if (table === 'store_metadata' && row.pk && row.type !== 'INTEGER') fail('unsupported_database');
      } else {
        if (JSON.stringify(s.keys) !== JSON.stringify(table === 'store_metadata' ? ['singleton'] : primary[table])) fail('unsupported_database');
        s.offset = 0; s.keys = [];
        if (++s.position === tables.length) { s.phase = 'indexes'; s.position = 0; }
      }
    } else {
      const index = s.indexes[s.position], row = indexColumn.get(index.name, s.offset++);
      if (row) {
        if (row.key) {
          if (row.name !== index.columns[s.keys.length] || row.desc || row.coll !== 'BINARY') fail('unsupported_database');
          s.keys.push(row.name);
        }
      } else {
        if (JSON.stringify(s.keys) !== JSON.stringify(index.columns)) fail('unsupported_database');
        s.offset = 0; s.keys = [];
        if (++s.position === s.indexes.length) s.done = true;
      }
    }
  }
  return { get ready() { return ready; }, create: () => ({ phase: 'plans', position: 0, after: 0, seen: {}, indexes: [], done: ready }),
    step, accept: state => { if (state?.done) ready = true; } };
}

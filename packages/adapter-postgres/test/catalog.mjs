// Structural catalog snapshot reader for the Postgres adapter DB tests.
export async function readCatalog(connection, tables = null, { includeDefaults = false } = {}) {
  const { rows } = await connection.query(`
    WITH tables AS (
      SELECT c.oid, c.relname FROM pg_class c
      WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
        AND ($1::text[] IS NULL OR c.relname::text = ANY ($1))
        AND NOT EXISTS (
          SELECT 1 FROM pg_depend WHERE classid = 'pg_class'::regclass AND objid = c.oid AND deptype = 'e'
        )
    ), catalog AS (
      SELECT t.relname AS table_name, 'column' AS item, a.attname AS name,
        format_type(a.atttypid, a.atttypmod)
          || COALESCE(' COLLATE ' || quote_ident(coll.collname), '')
          || CASE WHEN a.attnotnull THEN ' NOT NULL' ELSE ' NULL' END
          || COALESCE(CASE WHEN a.attgenerated = 's' THEN ' GENERATED STORED ' ELSE ' DEFAULT ' END
            || pg_get_expr(d.adbin, d.adrelid), '') AS definition
      FROM tables t JOIN pg_attribute a ON a.attrelid = t.oid
      JOIN pg_type ty ON ty.oid = a.atttypid
      LEFT JOIN pg_collation coll ON coll.oid = a.attcollation AND a.attcollation <> ty.typcollation
      LEFT JOIN pg_attrdef d ON $2::boolean AND d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attnum > 0 AND NOT a.attisdropped
      UNION ALL
      SELECT t.relname, 'constraint', c.conname, pg_get_constraintdef(c.oid)
      FROM tables t JOIN pg_constraint c ON c.conrelid = t.oid
      UNION ALL
      SELECT t.relname, 'index', c.relname, pg_get_indexdef(i.indexrelid)
      FROM tables t JOIN pg_index i ON i.indrelid = t.oid
      JOIN pg_class c ON c.oid = i.indexrelid
    )
    SELECT concat_ws(chr(9), table_name, item, name, definition) AS entry
    FROM catalog ORDER BY table_name::text COLLATE "C", item COLLATE "C", name::text COLLATE "C"
  `, [tables, includeDefaults]);
  return rows.map(({ entry }) => entry);
}

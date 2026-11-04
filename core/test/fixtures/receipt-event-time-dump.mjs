// Isolated, read-only full-database oracle. Never opens a raw file descriptor.
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const uri = pathToFileURL(process.argv[2]);
uri.searchParams.set('mode', 'ro');
uri.searchParams.set('immutable', '1');
const db = new DatabaseSync(uri.href, { readOnly: true });
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const encode = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? ['integer', String(item)] :
  item instanceof Uint8Array ? ['blob', Buffer.from(item).toString('hex')] : item);
try {
  const schema = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all();
  const tables = db.prepare('PRAGMA table_list').all().filter(row => row.schema === 'main');
  const dump = [schema];
  for (const { name } of schema.filter(row => row.type === 'table')) {
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
    const primary = columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
    const order = [...primary, ...columns.map(c => c.name).filter(c => !primary.includes(c))];
    const withoutRowid = tables.find(table => table.name === name).wr === 1;
    // Rowid tables use [rowid, ...all columns] arrays, in rowid order. The
    // positional prefix cannot overwrite an INTEGER PRIMARY KEY alias (even
    // one named rowid); that column remains in its original column position.
    // WITHOUT ROWID tables retain the primary-key/all-column object dump.
    const rowid = ['rowid', '_rowid_', 'oid'].find(candidate =>
      !columns.some(column => column.name.toLowerCase() === candidate));
    if (!withoutRowid && !rowid) throw Error('rowid identifiers shadowed: ' + name);
    const statement = db.prepare(withoutRowid
      ? `SELECT * FROM ${quote(name)} ORDER BY ${order.map(quote).join(',')}`
      : `SELECT ${quote(rowid)},* FROM ${quote(name)} ORDER BY ${quote(rowid)}`);
    if (!withoutRowid) statement.setReturnArrays(true);
    statement.setReadBigInts(true);
    dump.push([name, statement.all()]);
  }
  dump.push(db.prepare('PRAGMA application_id').get(), db.prepare('PRAGMA user_version').get());
  process.stdout.write(createHash('sha256').update(encode(dump)).digest('hex'));
} finally { db.close(); }

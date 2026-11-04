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
  const dump = [schema];
  for (const { name } of schema.filter(row => row.type === 'table')) {
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
    const primary = columns.filter(c => c.pk).sort((a, b) => a.pk - b.pk).map(c => c.name);
    const order = [...primary, ...columns.map(c => c.name).filter(c => !primary.includes(c))];
    const statement = db.prepare(`SELECT * FROM ${quote(name)} ORDER BY ${order.map(quote).join(',')}`);
    statement.setReadBigInts(true);
    dump.push([name, statement.all()]);
  }
  dump.push(db.prepare('PRAGMA application_id').get(), db.prepare('PRAGMA user_version').get());
  process.stdout.write(createHash('sha256').update(encode(dump)).digest('hex'));
} finally { db.close(); }

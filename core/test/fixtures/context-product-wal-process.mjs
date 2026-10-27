// Test-only independent process: raw file observation and SQLite connections
// are separate invocations, so a raw close can never release SQLite locks.
import { readFileSync, existsSync, copyFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [role, path, mode = 'WAL'] = process.argv.slice(2);
if (role === 'copy') {
  copyFileSync(path, mode);
} else if (role === 'old-pin') {
  const {openDatabase}=await import('./topic-overview-b2513501/core/database.mjs');
  const db=openDatabase(path);db.close();
} else if (role === 'bytes') {
  console.log(JSON.stringify(Object.fromEntries(['','-wal','-shm','-journal'].map(s => [s, existsSync(path+s) ? readFileSync(path+s).toString('base64') : null]))));
} else {
  const { DatabaseSync } = await import('node:sqlite');
  const db = new DatabaseSync(path, { readOnly: role === 'logical' || role === 'native' });
  if (role === 'logical') {
    db.exec('BEGIN');
    const schema = db.prepare('SELECT type,name,sql FROM sqlite_schema ORDER BY type,name').all();
    const rows = schema.filter(r => r.type === 'table').map(r => [r.name,db.prepare('SELECT * FROM "'+r.name+'"').all()]);
    const version = db.prepare('PRAGMA user_version').get().user_version;
    const journal = db.prepare('PRAGMA journal_mode').get().journal_mode;
    console.log(JSON.stringify({ digest:createHash('sha256').update(JSON.stringify({schema,rows,version})).digest('hex'), version, journal }));
    db.exec('ROLLBACK'); db.close();
  } else if (role === 'native') {
    db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN');
    db.prepare('SELECT id FROM memories').all(); db.exec('ROLLBACK'); db.close();
  } else if (role === 'mode') {
    db.exec('PRAGMA journal_mode='+mode); db.close();
  } else if (role === 'hot') {
    db.exec("PRAGMA journal_mode=DELETE; PRAGMA cache_size=1; BEGIN IMMEDIATE; UPDATE memories SET content=printf('%.*c',1000000,'x')");
    // Deliberate crash after a cache spill leaves a real hot rollback journal.
    process.exit(0);
  } else {
    db.exec('PRAGMA busy_timeout=0; PRAGMA journal_mode='+mode);
    process.on('message', ({id,command}) => {
      try {
        if (command === 'write') db.exec('BEGIN IMMEDIATE; UPDATE namespace_epochs SET epoch=epoch+1; COMMIT');
        if (command === 'exclusive') db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE; UPDATE namespace_epochs SET epoch=epoch+1');
        if (command === 'exclusiveEmpty') db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');
        if (command === 'reserved') db.exec('BEGIN IMMEDIATE');
        if (command === 'release') db.exec('ROLLBACK');
        if (command === 'close') db.close();
        process.send({id,ok:true});
        if (command === 'close') process.disconnect();
      } catch(e) {process.send({id,ok:false,code:e.errcode});}
    });
    process.send({ready:true});
  }
}

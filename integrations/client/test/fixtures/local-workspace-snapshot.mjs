import { createHash } from 'node:crypto';
import { readFileSync,readdirSync,lstatSync } from 'node:fs';
import { join,relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

// Never open/close a raw descriptor on an SQLite file in a process holding
// SQLite connections: that can disturb POSIX advisory locks. Logical database
// state is read through the same SQLite library; journal files get metadata only.
export function workspaceSnapshot(root,databasePath) {
  const result={},sha=value=>createHash('sha256').update(value).digest('hex');
  function databaseState() {
    const db=new DatabaseSync(databasePath,{readOnly:true});
    try {
      db.exec('BEGIN');
      const schema=db.prepare("SELECT type,name,sql FROM sqlite_schema WHERE sql IS NOT NULL ORDER BY type,name").all();
      const tables=schema.filter(row=>row.type==='table').map(row=>[row.name,db.prepare('SELECT * FROM "'+row.name.replaceAll('"','""')+'"').all()]);
      const fingerprint=sha(JSON.stringify([schema,tables]));db.exec('COMMIT');return fingerprint;
    } finally {db.close();}
  }
  function visit(directory) {
    for(const name of readdirSync(directory)) {
      const path=join(directory,name),info=lstatSync(path);
      const database=path===databasePath,sqliteFile=/(?:\.sqlite|\.db)(?:$|[-.])/.test(name);
      result[relative(root,path)]={mode:info.mode&0o777,ino:info.ino,
        ...(info.isFile() ? database ? {sha:databaseState()} : sqliteFile ? {} : {sha:sha(readFileSync(path))} : {})};
      if(info.isDirectory())visit(path);
    }
  }
  visit(root);return result;
}

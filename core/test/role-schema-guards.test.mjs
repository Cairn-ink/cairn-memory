import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture,ns,publish,ok } from './role-fixture.mjs';
function replace(db,table,row){const columns=Object.keys(row);return db.prepare(`INSERT OR REPLACE INTO ${table} (${columns.join(',')}) VALUES (${columns.map(()=>'?').join(',')})`).run(...Object.values(row));}
test('C04 every v32 unique key and hidden rowid reject REPLACE with recursive_triggers=0; rows never disappear',t=>{
 const f=fixture(t),first=ok(f.call('publishRoleProfileRelease',{...publish(),changeReason:{text:'First recorded explanation'}})),second=ok(f.call('publishRoleProfileRelease',{...publish(ns,'finance','second',first.release,1),changeReason:{text:'Second explanation'}}));
 const db=new DatabaseSync(f.path);db.exec('PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=0');t.after(()=>db.close());assert.equal(db.prepare('PRAGMA recursive_triggers').get().recursive_triggers,0);
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name GLOB 'role_profile*' ORDER BY name").all().map(r=>r.name);assert.equal(tables.length,7);
 const parentGuards=db.prepare("SELECT name,sql FROM sqlite_master WHERE name IN ('role_release_parent','role_change_parent')").all();
 for(const guard of parentGuards)db.exec('DROP TRIGGER '+guard.name); // Isolate the unique-key/rowid guard from earlier parent checks.
 let attacks=0;
 for(const table of tables){
  const row=db.prepare('SELECT rowid AS rowid,* FROM '+table+' LIMIT 1').get();assert.ok(row,table);
  const unique=db.prepare('SELECT name FROM pragma_index_list(?) WHERE "unique"=1').all(table).map(index=>db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(index.name).map(c=>c.name));
  for(const key of [['rowid'],...unique]){
   const copy={...row};
   // Change every other unique key so exactly this conflict (or rowid) is hit.
   const keep=new Set(key);
   if(key[0]!=='rowid')delete copy.rowid;
   for(const other of unique){if(other.every(c=>keep.has(c)))continue;const column=other.find(c=>!keep.has(c));if(column)copy[column]=typeof copy[column]==='number'?copy[column]+100:'replacement-'+copy[column];}
   const before=db.prepare('SELECT rowid AS rowid,* FROM '+table).all();assert.throws(()=>replace(db,table,copy),/role_replace/,table+' '+key);assert.deepEqual(db.prepare('SELECT rowid AS rowid,* FROM '+table).all(),before);attacks++;
  }
  assert.throws(()=>db.exec('DELETE FROM '+table),/role_delete/);assert.throws(()=>db.exec('UPDATE '+table+' SET rowid=rowid+100'),/role_immutable/);
 }
 for(const guard of parentGuards)db.exec(guard.sql);
 assert.equal(attacks,21); // Mechanically enumerated unique keys plus one rowid/table.
 const head={namespace:ns,roleKey:'finance',actionId:'delete',expectedCurrentRelease:second.release,expectedRegistryRevision:2,release:first.release,expectedRevision:1};ok(f.call('deleteRoleProfileRelease',head));
 const tomb=db.prepare('SELECT * FROM role_profile_releases WHERE id=?').get(first.release.releaseId);assert.equal(tomb.payload,null);assert.equal(tomb.byte_count,0);
 assert.throws(()=>replace(db,'role_profile_releases',{...tomb,payload:'{}',state:'available',revision:1,byte_count:2}),/role_(replace|parent)/);
 assert.throws(()=>db.prepare("UPDATE role_profile_releases SET state='available',revision=1,payload='{}',byte_count=2 WHERE id=?").run(tomb.id),/role_immutable/);
 assert.equal(db.prepare('SELECT count(*) n FROM role_profile_changes WHERE payload IS NOT NULL').get().n,0);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
 t.diagnostic('replacement key/rowid attacks: '+attacks);
});

test('C04 an omitted reason is immutable absence; a release cannot commit without its exact edge row',t=>{
 const f=fixture(t),value=ok(f.call('publishRoleProfileRelease',publish())),db=new DatabaseSync(f.path);t.after(()=>db.close());db.exec('PRAGMA foreign_keys=ON;PRAGMA recursive_triggers=0');
 const row=db.prepare('SELECT * FROM role_profile_changes WHERE to_id=?').get(value.release.releaseId);assert.equal(row.payload,null);assert.equal(row.byte_count,0);
 assert.throws(()=>db.prepare("UPDATE role_profile_changes SET payload='{}',byte_count=2 WHERE to_id=?").run(row.to_id),/role_immutable/);
 assert.throws(()=>replace(db,'role_profile_changes',{...row,payload:'{}',byte_count:2}),/role_replace/);
 const release=db.prepare('SELECT * FROM role_profile_releases WHERE id=?').get(value.release.releaseId),missing={...release,id:'missing-edge',ordinal:2,predecessor_id:release.id,predecessor_identity:release.content_identity};
 db.exec('BEGIN');
 try{
  db.prepare('UPDATE role_profiles SET revision=revision+1,next_ordinal=next_ordinal+1,current_release_id=? WHERE id=?').run(missing.id,release.profile_id);
  const columns=Object.keys(missing);db.prepare('INSERT INTO role_profile_releases ('+columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')').run(...Object.values(missing));
  assert.throws(()=>db.exec('COMMIT'),/FOREIGN KEY/);
 }finally{db.exec('ROLLBACK');}
 assert.equal(db.prepare('SELECT count(*) n FROM role_profile_releases').get().n,1);
 assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
});

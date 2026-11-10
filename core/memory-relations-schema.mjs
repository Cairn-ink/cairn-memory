import { fail } from './validation.mjs';

// Preserve each base's capabilities and safety attestation in a new layout family.
import { RELATION_LAYOUTS } from './content-safety-layout.mjs';
export const relationDDL = `CREATE TABLE memory_relations (
 id TEXT PRIMARY KEY NOT NULL,
 from_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
 from_revision INTEGER NOT NULL CHECK(from_revision>0),
 to_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
 to_revision INTEGER NOT NULL CHECK(to_revision>0),
 relation TEXT NOT NULL CHECK(relation IN ('supersedes','contradicts','refines','causes','same_thread')),
 confidence REAL NOT NULL CHECK(confidence BETWEEN 0 AND 1),
 decided_by TEXT NOT NULL CHECK(decided_by IN ('llm','rule','user')),
 receipt_id TEXT REFERENCES receipts(id) ON DELETE CASCADE,
 event_time TEXT,
 reason TEXT CHECK(reason IS NULL OR length(reason)<=600),
 created_at TEXT NOT NULL,
 CHECK(decided_by!='rule' OR relation='same_thread'),
 CHECK(from_memory_id!=to_memory_id)
) STRICT;
CREATE INDEX memory_relations_to ON memory_relations(to_memory_id,relation);
CREATE INDEX memory_relations_from ON memory_relations(from_memory_id);
CREATE INDEX memory_relations_to_date ON memory_relations(to_memory_id,created_at DESC,id);
CREATE TABLE memory_relation_times (
 memory_id TEXT PRIMARY KEY NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL CHECK(revision>0),
 event_time TEXT NOT NULL,
 receipt_id TEXT NOT NULL REFERENCES receipts(id) ON DELETE CASCADE
) STRICT;
CREATE TRIGGER memory_relations_boundary BEFORE INSERT ON memory_relations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM memories a JOIN memories b
 ON a.owner_id=b.owner_id AND a.scope=b.scope AND a.project_id=b.project_id
 WHERE a.id=NEW.from_memory_id AND b.id=NEW.to_memory_id AND a.deleted=0 AND b.deleted=0
 AND a.revision=NEW.from_revision AND b.revision=NEW.to_revision)
 OR (NEW.receipt_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM receipts
 WHERE id=NEW.receipt_id AND memory_id=NEW.from_memory_id))
 THEN RAISE(ABORT,'invalid_relation_boundary') END;
END;
CREATE TRIGGER memory_relations_revision AFTER UPDATE OF revision,deleted ON memories
 WHEN OLD.revision!=NEW.revision OR NEW.deleted=1 BEGIN
 DELETE FROM memory_relations WHERE from_memory_id=OLD.id OR to_memory_id=OLD.id;
 DELETE FROM memory_relation_times WHERE memory_id=OLD.id;
END;
CREATE VIEW memory_conflicts AS SELECT from_memory_id AS left_memory_id,
 from_revision AS left_revision,to_memory_id AS right_memory_id,to_revision AS right_revision,
 relation,CASE WHEN id LIKE 'inferred-hint:%' THEN 'inferred-hint' ELSE 'explicit-hint' END AS source
 FROM memory_relations WHERE decided_by='user' AND relation='contradicts';`;

export function installMemoryRelations(db) {
 const physical=db.prepare('PRAGMA user_version').get().user_version;
 if(RELATION_LAYOUTS.includes(physical)&&physical>=200)return;
 const inherited=RELATION_LAYOUTS.includes(physical)?physical-100:physical;
 if(!RELATION_LAYOUTS.includes(inherited+200))fail('unsupported_database');
 if(RELATION_LAYOUTS.includes(physical)){
  // The first relation package had four labels and no reason field.
  db.exec(`DROP VIEW memory_conflicts;
   DROP TRIGGER memory_relations_boundary; DROP TRIGGER memory_relations_revision;
   DROP INDEX memory_relations_to; DROP INDEX memory_relations_from; DROP INDEX memory_relations_to_date;
   ALTER TABLE memory_relations RENAME TO previous_memory_relations;
   ALTER TABLE memory_relation_times RENAME TO previous_memory_relation_times;`);
  db.exec(relationDDL);
  const sourceDate=db.prepare("SELECT 1 FROM pragma_table_info('receipts') WHERE name='occurred_at'").get()?'coalesce(p.occurred_at,p.created_at)':'p.created_at';
  db.exec(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,receipt_id,event_time,created_at)
   SELECT r.id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,receipt_id,
    (SELECT ${sourceDate} FROM receipts p WHERE p.id=r.receipt_id),created_at FROM previous_memory_relations r WHERE decided_by!='rule';
   INSERT INTO memory_relation_times SELECT t.memory_id,t.revision,${sourceDate},t.receipt_id
    FROM previous_memory_relation_times t JOIN receipts p ON p.id=t.receipt_id;
   DROP TABLE previous_memory_relations; DROP TABLE previous_memory_relation_times;`);
 }else{
  db.exec('ALTER TABLE memory_conflicts RENAME TO legacy_memory_conflicts');
  db.exec(relationDDL);
  db.exec(`INSERT INTO memory_relations(id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,receipt_id,event_time,created_at)
   SELECT source||':'||lower(hex(randomblob(16))),left_memory_id,left_revision,right_memory_id,right_revision,
   'contradicts',1,'user',NULL,NULL,(SELECT max(updated_at) FROM memories WHERE id IN(left_memory_id,right_memory_id))
   FROM legacy_memory_conflicts; DROP TABLE legacy_memory_conflicts;`);
 }
 db.exec(`PRAGMA user_version=${inherited+200}`);
}

export const previousRelationDDL=relationDDL.replace(",'same_thread'",'').replace(' reason TEXT CHECK(reason IS NULL OR length(reason)<=600),\n','').replace(" CHECK(decided_by!='rule' OR relation='same_thread'),\n",'');

export function validateMemoryRelations(db) {
 const expected=new Map();
 for(const sql of (db.prepare('PRAGMA user_version').get().user_version<200?previousRelationDDL:relationDDL).match(/CREATE (?:TABLE|INDEX|VIEW)[\s\S]*?;|CREATE TRIGGER[\s\S]*?^END;/gm)) {
  const [,type,name]=sql.match(/^CREATE (TABLE|INDEX|VIEW|TRIGGER) (\w+)/);
  expected.set(name,{type:type.toLowerCase(),sql});
 }
 const normalize=s=>s.trim().replace(/;$/,'').replace(/\s+/g,' ');
 const statement=db.prepare('SELECT type,sql FROM sqlite_schema WHERE name=?');
 for(const [name,wanted] of expected){const row=statement.get(name);
  if(!row||row.type!==wanted.type||normalize(row.sql??'')!==normalize(wanted.sql))fail('unsupported_database');}
}

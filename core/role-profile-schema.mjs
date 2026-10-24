import { roleFields } from './role-profile-input.mjs';
import { canonicalJSON, canonicalObject } from './task-receipt.mjs';
import { keyed } from './private-card-input.mjs';
import { fail } from './validation.mjs';

export const ROLE_PROFILE_SCHEMA_VERSION = 32;
const ns = `owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200), scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK(length(project_id)<=200 AND ((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0)))`;
const sql = `
CREATE TABLE role_profiles (
 id TEXT PRIMARY KEY, ${ns}, role_key TEXT NOT NULL CHECK(length(role_key) BETWEEN 1 AND 200 AND role_key NOT GLOB '*[^A-Za-z0-9._-]*'),
 state TEXT NOT NULL CHECK(state IN ('active','disabled')), current_release_id TEXT, current_identity TEXT,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991), next_ordinal INTEGER NOT NULL CHECK(next_ordinal BETWEEN 1 AND 129),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
 UNIQUE(owner_id,scope,project_id,role_key), UNIQUE(owner_id,scope,project_id,id),
 CHECK((current_release_id IS NULL)=(current_identity IS NULL)), CHECK(state='disabled' OR current_release_id IS NOT NULL),
 FOREIGN KEY(id,current_release_id,current_identity) REFERENCES role_profile_releases(profile_id,id,content_identity) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE TABLE role_profile_releases (
 id TEXT PRIMARY KEY, profile_id TEXT NOT NULL REFERENCES role_profiles(id) DEFERRABLE INITIALLY DEFERRED,
 ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 128), content_identity TEXT NOT NULL CHECK(length(content_identity)=43),
 predecessor_id TEXT, predecessor_identity TEXT, state TEXT NOT NULL CHECK(state IN ('available','deleted')),
 revision INTEGER NOT NULL, payload TEXT, byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 0 AND 32768), created_at TEXT NOT NULL,
 UNIQUE(profile_id,ordinal), UNIQUE(profile_id,id,content_identity),
 CHECK((predecessor_id IS NULL)=(predecessor_identity IS NULL)),
 CHECK((state='available' AND revision=1 AND payload IS NOT NULL AND json_valid(payload) AND json_type(payload)='object'
 AND byte_count=length(CAST(payload AS BLOB))
 AND json_type(payload,'$.fields') IS 'object' AND json_type(payload,'$.fields.duties') IS 'array' AND json_array_length(payload,'$.fields.duties') BETWEEN 1 AND 8
 AND json_type(payload,'$.fields.requiredOutputs') IS 'array' AND json_array_length(payload,'$.fields.requiredOutputs') BETWEEN 1 AND 8
 AND json_type(payload,'$.fields.methods') IS 'array' AND json_array_length(payload,'$.fields.methods')<=16
 AND json_type(payload,'$.fields.related') IS 'array' AND json_array_length(payload,'$.fields.related')<=16
 AND json_type(payload,'$.actorId') IS 'text' AND json_type(payload,'$.agentId') IS 'text' AND json_extract(payload,'$.createdAt') IS created_at) OR (state='deleted' AND revision=2 AND payload IS NULL AND byte_count=0)),
 FOREIGN KEY(profile_id,predecessor_id,predecessor_identity) REFERENCES role_profile_releases(profile_id,id,content_identity) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(profile_id,id,content_identity) REFERENCES role_profile_changes(profile_id,to_id,to_identity) DEFERRABLE INITIALLY DEFERRED
) STRICT;
CREATE INDEX role_profile_history ON role_profile_releases(profile_id,ordinal);
CREATE TABLE role_profile_changes (
 to_id TEXT PRIMARY KEY, profile_id TEXT NOT NULL, to_identity TEXT NOT NULL, from_id TEXT, from_identity TEXT,
 payload TEXT, byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 0 AND 32768),
 UNIQUE(profile_id,to_id,to_identity),
 CHECK((from_id IS NULL)=(from_identity IS NULL)),
 CHECK((payload IS NULL AND byte_count=0) OR (payload IS NOT NULL AND json_valid(payload) AND json_type(payload)='object' AND byte_count=length(CAST(payload AS BLOB)))),
 FOREIGN KEY(profile_id,to_id,to_identity) REFERENCES role_profile_releases(profile_id,id,content_identity),
 FOREIGN KEY(profile_id,from_id,from_identity) REFERENCES role_profile_releases(profile_id,id,content_identity)
) STRICT;
CREATE TABLE role_profile_operations (
 ${ns}, action_id TEXT NOT NULL, method TEXT NOT NULL CHECK(method IN ('publishRoleProfileRelease','disableRoleProfile','deleteRoleProfileRelease')),
 payload_binding TEXT NOT NULL, target_id TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result)), created_at TEXT NOT NULL,
 PRIMARY KEY(owner_id,scope,project_id,action_id),
 FOREIGN KEY(owner_id,scope,project_id,target_id) REFERENCES role_profiles(owner_id,scope,project_id,id)
) STRICT;
CREATE TABLE role_profile_events (
 event_id TEXT PRIMARY KEY, ${ns}, profile_id TEXT NOT NULL REFERENCES role_profiles(id),
 kind TEXT NOT NULL CHECK(kind IN ('published','disabled','deleted')), revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 9007199254740991),
 action_id TEXT NOT NULL, ordinal INTEGER NOT NULL UNIQUE CHECK(ordinal BETWEEN 1 AND 9007199254740991), created_at TEXT NOT NULL,
 UNIQUE(profile_id,revision),
 FOREIGN KEY(owner_id,scope,project_id,profile_id) REFERENCES role_profiles(owner_id,scope,project_id,id)
) STRICT;
CREATE INDEX role_profile_event_scope ON role_profile_events(owner_id,scope,project_id,ordinal);
CREATE TABLE role_profile_epochs (${ns}, generation INTEGER NOT NULL CHECK(generation BETWEEN 1 AND 9007199254740991), PRIMARY KEY(owner_id,scope,project_id)) STRICT;
CREATE TABLE role_profile_owner_usage (owner_id TEXT PRIMARY KEY, byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 0 AND 50000000)) STRICT;
`;
const tables = ['role_profiles','role_profile_releases','role_profile_changes','role_profile_operations','role_profile_events','role_profile_epochs','role_profile_owner_usage'];
const immutable = (columns) => columns.map(c => `NEW.${c} IS NOT OLD.${c}`).join(' OR ');
function guards(db) {
  for (const table of tables) {
    const columns = db.prepare('SELECT name FROM pragma_table_info(?)').all(table).map(r => r.name);
    const keys = db.prepare('SELECT name FROM pragma_index_list(?) WHERE "unique"=1').all(table).map(index =>
      db.prepare('SELECT name FROM pragma_index_info(?) ORDER BY seqno').all(index.name).map(r => r.name));
    const collision = ['rowid=NEW.rowid', ...keys.map(key => '(' + key.map(c => `${c}=NEW.${c}`).join(' AND ') + ')')].join(' OR ');
    db.exec(`CREATE TRIGGER ${table}_insert BEFORE INSERT ON ${table} WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${collision}) BEGIN SELECT RAISE(ABORT,'role_replace'); END;
      CREATE TRIGGER ${table}_delete BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'role_delete'); END;`);
    let allowed;
    if (table === 'role_profiles') allowed = `NOT (${immutable(['rowid','id','owner_id','scope','project_id','role_key','created_at'])}) AND NEW.revision=OLD.revision+1 AND NEW.next_ordinal IN (OLD.next_ordinal,OLD.next_ordinal+1)`;
    else if (table === 'role_profile_releases') allowed = `NOT (${immutable(columns.filter(c => !['state','revision','payload','byte_count'].includes(c)).concat('rowid'))}) AND OLD.state='available' AND NEW.state='deleted' AND NEW.revision=2 AND NEW.payload IS NULL AND NEW.byte_count=0`;
    else if (table === 'role_profile_changes') allowed = `NOT (${immutable(['rowid','to_id','profile_id','to_identity','from_id','from_identity'])}) AND OLD.payload IS NOT NULL AND NEW.payload IS NULL AND NEW.byte_count=0 AND EXISTS(SELECT 1 FROM role_profile_releases WHERE id IN (OLD.to_id,OLD.from_id) AND state='deleted')`;
    else if (table === 'role_profile_epochs') allowed = `NOT (${immutable(['rowid','owner_id','scope','project_id'])}) AND NEW.generation=OLD.generation+1`;
    else if (table === 'role_profile_owner_usage') allowed = `NEW.rowid=OLD.rowid AND NEW.owner_id=OLD.owner_id`;
    else allowed = '0';
    db.exec(`CREATE TRIGGER ${table}_update BEFORE UPDATE ON ${table} WHEN NOT (${allowed}) BEGIN SELECT RAISE(ABORT,'role_immutable'); END;`);
  }
  db.exec(`CREATE TRIGGER role_release_parent BEFORE INSERT ON role_profile_releases
    WHEN NEW.state!='available' OR NEW.revision!=1 OR NOT EXISTS(SELECT 1 FROM role_profiles WHERE id=NEW.profile_id AND next_ordinal=NEW.ordinal+1)
      OR (NEW.predecessor_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM role_profile_releases WHERE id=NEW.predecessor_id AND profile_id=NEW.profile_id AND content_identity=NEW.predecessor_identity AND ordinal<NEW.ordinal AND state='available'))
    BEGIN SELECT RAISE(ABORT,'role_parent'); END;
    CREATE TRIGGER role_change_parent BEFORE INSERT ON role_profile_changes
    WHEN NOT EXISTS(SELECT 1 FROM role_profile_releases WHERE id=NEW.to_id AND state='available' AND predecessor_id IS NEW.from_id AND predecessor_identity IS NEW.from_identity)
    BEGIN SELECT RAISE(ABORT,'role_edge'); END;
    CREATE TRIGGER role_release_purge AFTER UPDATE OF state ON role_profile_releases WHEN NEW.state='deleted' BEGIN
      UPDATE role_profile_owner_usage SET byte_count=byte_count-OLD.byte_count WHERE owner_id=(SELECT owner_id FROM role_profiles WHERE id=OLD.profile_id);
      UPDATE role_profile_changes SET payload=NULL,byte_count=0 WHERE (to_id=OLD.id OR from_id=OLD.id) AND payload IS NOT NULL;
    END;
    CREATE TRIGGER role_change_purge AFTER UPDATE OF payload ON role_profile_changes WHEN NEW.payload IS NULL BEGIN
      UPDATE role_profile_owner_usage SET byte_count=byte_count-OLD.byte_count WHERE owner_id=(SELECT owner_id FROM role_profiles WHERE id=OLD.profile_id);
    END;`);
}
export function installRoleProfiles(db) { db.exec(sql); guards(db); }
let definitions;
export function assertNoRoleProfiles(db) {
  if (db.prepare("SELECT 1 FROM sqlite_master WHERE lower(name) GLOB 'role_*' OR lower(tbl_name) GLOB 'role_*'").get()) fail('unsupported_database');
}
export function validateRoleProfiles(db) {
  if (!definitions) {
    const reference = new db.constructor(':memory:');
    try { installRoleProfiles(reference); definitions = reference.prepare("SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name").all(); }
    finally { reference.close(); }
  }
  const actual = db.prepare("SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND (lower(name) GLOB 'role_*' OR lower(tbl_name) GLOB 'role_*') ORDER BY name").all();
  if (JSON.stringify(actual) !== JSON.stringify(definitions)) fail('unsupported_database');
  try {
    if(db.prepare('PRAGMA foreign_key_check').get() || db.prepare('PRAGMA quick_check').get().quick_check !== 'ok')fail('unsupported_database');
    const identity=db.prepare('SELECT store_id,cursor_secret FROM store_metadata WHERE singleton=1').get();
    for(const row of db.prepare('SELECT * FROM role_profiles').iterate()) {
      if(row.next_ordinal!==db.prepare('SELECT count(*)+1 n FROM role_profile_releases WHERE profile_id=?').get(row.id).n)fail('unsupported_database');
      const namespace={ownerId:row.owner_id,scope:row.scope,projectId:row.project_id||null};
      const profile={type:'role-profile',namespace,profileId:row.id,roleKey:row.role_key};
      for(const release of db.prepare("SELECT * FROM role_profile_releases WHERE profile_id=? AND state='available'").iterate(row.id)) {
        const payload=JSON.parse(release.payload);
        if(Object.keys(payload).sort().join()!=='actorId,agentId,createdAt,fields'||canonicalJSON(payload)!==release.payload||canonicalJSON(roleFields(Object.fromEntries(Object.entries(payload.fields).filter(([key,value])=>key!=='appliesTo'||value!==null)),namespace))!==canonicalJSON(payload.fields))fail('unsupported_database');
        for(const label of [payload.actorId,payload.agentId])if(typeof label!=='string'||!label.trim()||!label.isWellFormed()||label.includes('\0')||label.length>200)fail('unsupported_database');
        if(keyed(identity.cursor_secret,'role-profile-release-v1',[identity.store_id,canonicalObject([profile,release.ordinal,payload])])!==release.content_identity)fail('unsupported_database');
      }
    }
  } catch(error) {
    if(error?.code==='ERR_SQLITE_ERROR' && Number.isInteger(error.errcode) && [5,6].includes(error.errcode&255))throw error;
    fail('unsupported_database');
  }
}

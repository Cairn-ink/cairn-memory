import { installMethodPackages } from './method-package-schema.mjs';
import { fail } from './validation.mjs';

export const ASSET_SCHEMA_VERSION = 31;
export const ASSET_TABLES = Object.freeze(['assets','asset_versions','asset_derivatives','binary_objects','binary_chunks',
  'method_manifest_formats','method_mixed_entries','binary_owner_usage','asset_operations','asset_effects','asset_epochs']);
const namespace = `owner_id TEXT NOT NULL, scope TEXT NOT NULL CHECK(scope IN ('personal','project')), project_id TEXT NOT NULL`;
const namespaceCheck = `CHECK((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0))`;
const canonicalSQL = `
 CREATE TABLE assets (
  id TEXT PRIMARY KEY, ${namespace}, state TEXT NOT NULL CHECK(state IN ('available','deleted')),
  revision INTEGER NOT NULL CHECK(revision>0), next_ordinal INTEGER NOT NULL CHECK(next_ordinal>0),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, ${namespaceCheck}
 ) STRICT;
 CREATE INDEX asset_scope ON assets(owner_id,scope,project_id,id);
 CREATE TABLE asset_versions (
  id TEXT PRIMARY KEY, asset_id TEXT NOT NULL REFERENCES assets(id), ordinal INTEGER NOT NULL CHECK(ordinal>0),
  content_identity TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('available','deleted')),
  revision INTEGER NOT NULL CHECK(revision IN (1,2)), title TEXT, filename TEXT, media_type TEXT,
  byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 0 AND 33554432), object_id TEXT UNIQUE,
  imported_at TEXT NOT NULL, UNIQUE(asset_id,ordinal), UNIQUE(id,content_identity),
  FOREIGN KEY(object_id) REFERENCES binary_objects(id) DEFERRABLE INITIALLY DEFERRED,
  CHECK((state='available' AND revision=1 AND title IS NOT NULL AND filename IS NOT NULL AND media_type IS NOT NULL
    AND byte_count>0 AND object_id IS NOT NULL) OR
   (state='deleted' AND revision=2 AND title IS NULL AND filename IS NULL AND media_type IS NULL AND byte_count=0 AND object_id IS NULL))
 ) STRICT;
 CREATE INDEX asset_version_parent ON asset_versions(asset_id,ordinal);
 CREATE TABLE asset_derivatives (
  id TEXT PRIMARY KEY, version_id TEXT NOT NULL, source_identity TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('available','deleted')), revision INTEGER NOT NULL CHECK(revision IN (1,2)),
  kind TEXT CHECK(kind IN ('caption','transcript','description','alt-text')), text TEXT,
  content_identity TEXT NOT NULL, provenance TEXT, language TEXT, timecodes TEXT,
  byte_count INTEGER NOT NULL CHECK(byte_count>=0), created_at TEXT NOT NULL,
  FOREIGN KEY(version_id,source_identity) REFERENCES asset_versions(id,content_identity),
  CHECK(language IS NULL OR (length(language) BETWEEN 1 AND 35 AND language NOT GLOB '*[^A-Za-z0-9-]*')),
  CHECK(text IS NULL OR (length(text)<=20000 AND instr(text,char(0))=0 AND byte_count=length(CAST(text AS BLOB)))),
  CHECK(provenance IS NULL OR (json_valid(provenance) AND json_type(provenance)='object'
    AND json_type(provenance,'$.source') IS 'object' AND json_extract(provenance,'$.source.type') IS 'asset-version'
    AND json_extract(provenance,'$.source.versionId') IS version_id
    AND json_extract(provenance,'$.source.contentIdentity') IS source_identity
    AND json_type(provenance,'$.method') IS 'object' AND json_extract(provenance,'$.method.kind') IS 'user-provided')),
  CHECK(timecodes IS NULL OR (json_valid(timecodes) AND json_type(timecodes)='array' AND json_array_length(timecodes)<=256)),
  CHECK((state='available' AND revision=1 AND kind IS NOT NULL AND text IS NOT NULL AND provenance IS NOT NULL) OR
   (state='deleted' AND revision=2 AND kind IS NULL AND text IS NULL AND provenance IS NULL AND language IS NULL AND timecodes IS NULL AND byte_count=0))
 ) STRICT;
 CREATE INDEX asset_derivative_source ON asset_derivatives(version_id,id);
 CREATE TABLE binary_objects (
  id TEXT PRIMARY KEY, ${namespace}, media_type TEXT NOT NULL, content_identity TEXT NOT NULL,
  byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 1 AND 33554432), asset_version_id TEXT UNIQUE,
  method_version_id TEXT, position INTEGER CHECK(position>=0), ${namespaceCheck},
  UNIQUE(method_version_id,position),
  FOREIGN KEY(asset_version_id) REFERENCES asset_versions(id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY(method_version_id,position) REFERENCES method_mixed_entries(version_id,position) DEFERRABLE INITIALLY DEFERRED,
  CHECK((asset_version_id IS NOT NULL AND method_version_id IS NULL AND position IS NULL) OR
    (asset_version_id IS NULL AND method_version_id IS NOT NULL AND position IS NOT NULL))
 ) STRICT;
 CREATE INDEX binary_object_scope ON binary_objects(owner_id,scope,project_id,id);
 CREATE INDEX binary_object_method ON binary_objects(method_version_id,position);
 CREATE TABLE binary_chunks (
  object_id TEXT NOT NULL REFERENCES binary_objects(id) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL CHECK(chunk_index>=0), chunk_mac TEXT NOT NULL,
  bytes BLOB NOT NULL CHECK(length(bytes) BETWEEN 1 AND 32768), PRIMARY KEY(object_id,chunk_index)
 ) STRICT;
 CREATE TABLE method_manifest_formats (
  version_id TEXT PRIMARY KEY REFERENCES method_versions(id), format TEXT NOT NULL CHECK(format='mixed-v1')
 ) STRICT;
 CREATE TABLE method_mixed_entries (
  version_id TEXT NOT NULL REFERENCES method_manifest_formats(version_id), position INTEGER NOT NULL CHECK(position>=0 AND position<256),
  kind TEXT NOT NULL CHECK(kind IN ('text','binary')), path TEXT NOT NULL, folded_path TEXT NOT NULL,
  media_type TEXT NOT NULL, content_identity TEXT NOT NULL, byte_count INTEGER NOT NULL CHECK(byte_count>=0),
  binary_object_id TEXT UNIQUE REFERENCES binary_objects(id) DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY(version_id,position), UNIQUE(version_id,folded_path),
  CHECK((kind='text' AND binary_object_id IS NULL) OR (kind='binary' AND binary_object_id IS NOT NULL AND byte_count BETWEEN 1 AND 33554432))
 ) STRICT;
 CREATE INDEX method_mixed_binary ON method_mixed_entries(binary_object_id);
 CREATE TABLE binary_owner_usage (owner_id TEXT PRIMARY KEY, byte_count INTEGER NOT NULL CHECK(byte_count BETWEEN 0 AND 200000000)) STRICT;
 CREATE TABLE asset_operations (
  ${namespace}, action_id TEXT NOT NULL, method TEXT NOT NULL, payload_binding TEXT NOT NULL,
  target_id TEXT NOT NULL, result TEXT NOT NULL CHECK(json_valid(result) AND json_type(result)='object'), created_at TEXT NOT NULL,
  PRIMARY KEY(owner_id,scope,project_id,action_id), ${namespaceCheck}
 ) STRICT;
 CREATE TABLE asset_effects (
  effect_id TEXT PRIMARY KEY, ${namespace}, kind TEXT NOT NULL CHECK(kind IN
   ('asset_version_imported','asset_derivative_created','asset_deleted','asset_version_deleted','asset_derivative_deleted')),
  entity_type TEXT NOT NULL CHECK(entity_type IN ('asset','asset-version','asset-derivative')), entity_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0), action_id TEXT NOT NULL, ordinal INTEGER NOT NULL UNIQUE CHECK(ordinal>0), ${namespaceCheck}
 ) STRICT;
 CREATE INDEX asset_effect_scope ON asset_effects(owner_id,scope,project_id,ordinal);
 CREATE TABLE asset_epochs (${namespace}, generation INTEGER NOT NULL CHECK(generation>0),
  PRIMARY KEY(owner_id,scope,project_id), ${namespaceCheck}) STRICT;
`;
const epochSQL = (owner, scope, project) => `INSERT INTO asset_epochs VALUES(${owner},${scope},${project},2)
 ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET generation=generation+1;`;
const triggerSQL = `
 CREATE TRIGGER asset_terminal BEFORE UPDATE ON assets WHEN OLD.state='deleted'
  BEGIN SELECT RAISE(ABORT,'asset_terminal'); END;
 CREATE TRIGGER asset_identity_immutable BEFORE UPDATE ON assets WHEN
  NEW.id!=OLD.id OR NEW.owner_id!=OLD.owner_id OR NEW.scope!=OLD.scope OR NEW.project_id!=OLD.project_id OR NEW.created_at!=OLD.created_at
  BEGIN SELECT RAISE(ABORT,'asset_immutable'); END;
 CREATE TRIGGER asset_no_delete BEFORE DELETE ON assets BEGIN SELECT RAISE(ABORT,'asset_tombstone_required'); END;
 CREATE TRIGGER asset_version_insert BEFORE INSERT ON asset_versions WHEN NEW.state!='available' OR NEW.revision!=1 OR
  NOT EXISTS(SELECT 1 FROM assets WHERE id=NEW.asset_id AND state='available') OR
  EXISTS(SELECT 1 FROM binary_objects WHERE id=NEW.object_id) OR
  (SELECT count(*) FROM asset_versions WHERE asset_id=NEW.asset_id)>=64
  BEGIN SELECT RAISE(ABORT,'asset_parent_unavailable'); END;
 CREATE TRIGGER asset_version_immutable BEFORE UPDATE ON asset_versions WHEN OLD.state='deleted' OR
  NEW.id!=OLD.id OR NEW.asset_id!=OLD.asset_id OR NEW.ordinal!=OLD.ordinal OR NEW.content_identity!=OLD.content_identity OR
  NEW.imported_at!=OLD.imported_at OR NEW.state!='deleted' OR NEW.revision!=OLD.revision+1
  BEGIN SELECT RAISE(ABORT,'asset_version_immutable'); END;
 CREATE TRIGGER asset_version_no_delete BEFORE DELETE ON asset_versions BEGIN SELECT RAISE(ABORT,'asset_tombstone_required'); END;
 CREATE TRIGGER asset_derivative_insert BEFORE INSERT ON asset_derivatives WHEN NEW.state!='available' OR NEW.revision!=1 OR
  NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=NEW.version_id AND
   v.content_identity=NEW.source_identity AND v.state='available' AND a.state='available') OR
  (SELECT count(*) FROM asset_derivatives WHERE version_id=NEW.version_id)>=32 OR
  NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=NEW.version_id AND
    json_extract(NEW.provenance,'$.source.assetId') IS a.id AND
    json_extract(NEW.provenance,'$.source.namespace.ownerId') IS a.owner_id AND
    json_extract(NEW.provenance,'$.source.namespace.scope') IS a.scope AND
    (json_type(NEW.provenance,'$.source.namespace.projectId') IS 'null' AND a.project_id='' OR
     json_extract(NEW.provenance,'$.source.namespace.projectId') IS a.project_id))
  BEGIN SELECT RAISE(ABORT,'asset_parent_unavailable'); END;
 CREATE TRIGGER asset_derivative_timecodes BEFORE INSERT ON asset_derivatives WHEN NEW.timecodes IS NOT NULL AND (
  NOT EXISTS(SELECT 1 FROM asset_versions WHERE id=NEW.version_id AND (media_type GLOB 'audio/*' OR media_type GLOB 'video/*')) OR
  EXISTS(SELECT 1 FROM json_each(NEW.timecodes) t WHERE json_type(t.value) IS NOT 'object' OR
   json_type(t.value,'$.startMs') IS NOT 'integer' OR json_type(t.value,'$.endMs') IS NOT 'integer' OR
   json_extract(t.value,'$.startMs')<0 OR json_extract(t.value,'$.endMs')<json_extract(t.value,'$.startMs') OR
   json_extract(t.value,'$.endMs')>9007199254740991 OR
   (CAST(t.key AS INTEGER)>0 AND json_extract(NEW.timecodes,'$['||(CAST(t.key AS INTEGER)-1)||'].endMs')>json_extract(t.value,'$.startMs'))))
  BEGIN SELECT RAISE(ABORT,'invalid_asset_timecodes'); END;
 CREATE TRIGGER asset_derivative_immutable BEFORE UPDATE ON asset_derivatives WHEN OLD.state='deleted' OR
  NEW.id!=OLD.id OR NEW.version_id!=OLD.version_id OR NEW.source_identity!=OLD.source_identity OR
  NEW.content_identity!=OLD.content_identity OR NEW.created_at!=OLD.created_at OR NEW.state!='deleted' OR NEW.revision!=OLD.revision+1
  BEGIN SELECT RAISE(ABORT,'asset_derivative_immutable'); END;
 CREATE TRIGGER asset_derivative_no_delete BEFORE DELETE ON asset_derivatives BEGIN SELECT RAISE(ABORT,'asset_tombstone_required'); END;
 CREATE TRIGGER binary_object_owner BEFORE INSERT ON binary_objects WHEN
  (NEW.asset_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id
   WHERE v.id=NEW.asset_version_id AND v.object_id=NEW.id AND a.state='available' AND v.state='available' AND
    a.owner_id=NEW.owner_id AND a.scope=NEW.scope AND a.project_id=NEW.project_id AND
    v.content_identity=NEW.content_identity AND v.media_type=NEW.media_type AND v.byte_count=NEW.byte_count)) OR
  (NEW.method_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM method_versions v JOIN method_packages p ON p.id=v.package_id
   JOIN method_mixed_entries e ON e.version_id=v.id AND e.position=NEW.position WHERE v.id=NEW.method_version_id AND
    v.state='available' AND p.state='available' AND p.owner_id=NEW.owner_id AND p.scope=NEW.scope AND p.project_id=NEW.project_id AND
    e.kind='binary' AND e.binary_object_id=NEW.id AND e.content_identity=NEW.content_identity AND e.media_type=NEW.media_type AND e.byte_count=NEW.byte_count))
  BEGIN SELECT RAISE(ABORT,'invalid_binary_owner'); END;
 CREATE TRIGGER binary_object_immutable BEFORE UPDATE ON binary_objects BEGIN SELECT RAISE(ABORT,'binary_object_immutable'); END;
 CREATE TRIGGER binary_chunk_shape BEFORE INSERT ON binary_chunks WHEN NOT EXISTS(SELECT 1 FROM binary_objects o
  WHERE o.id=NEW.object_id AND NEW.chunk_index*32768<o.byte_count AND
   length(NEW.bytes)=min(32768,o.byte_count-NEW.chunk_index*32768))
  BEGIN SELECT RAISE(ABORT,'invalid_binary_chunk'); END;
 CREATE TRIGGER binary_chunk_immutable BEFORE UPDATE ON binary_chunks BEGIN SELECT RAISE(ABORT,'binary_chunk_immutable'); END;
 CREATE TRIGGER method_format_parent BEFORE INSERT ON method_manifest_formats WHEN NOT EXISTS(
  SELECT 1 FROM method_versions v JOIN method_packages p ON p.id=v.package_id WHERE v.id=NEW.version_id AND v.state='available' AND p.state='available')
  BEGIN SELECT RAISE(ABORT,'method_parent_unavailable'); END;
 CREATE TRIGGER method_format_immutable BEFORE UPDATE ON method_manifest_formats BEGIN SELECT RAISE(ABORT,'method_format_immutable'); END;
 CREATE TRIGGER method_mixed_parent BEFORE INSERT ON method_mixed_entries WHEN NOT EXISTS(
  SELECT 1 FROM method_versions v JOIN method_packages p ON p.id=v.package_id WHERE v.id=NEW.version_id AND v.state='available' AND p.state='available') OR
  (NEW.kind='binary' AND EXISTS(SELECT 1 FROM binary_objects WHERE id=NEW.binary_object_id)) OR
  (NEW.kind='text' AND NOT EXISTS(SELECT 1 FROM method_files f WHERE f.version_id=NEW.version_id AND f.position=NEW.position AND
    f.path=NEW.path AND f.media_type=NEW.media_type AND f.content_identity=NEW.content_identity AND f.byte_count=NEW.byte_count))
  BEGIN SELECT RAISE(ABORT,'invalid_method_entry'); END;
 CREATE TRIGGER method_mixed_immutable BEFORE UPDATE ON method_mixed_entries BEGIN SELECT RAISE(ABORT,'method_entry_immutable'); END;
 CREATE TRIGGER binary_object_release AFTER DELETE ON binary_objects BEGIN
  UPDATE binary_owner_usage SET byte_count=byte_count-OLD.byte_count WHERE owner_id=OLD.owner_id;
  ${epochSQL('OLD.owner_id','OLD.scope','OLD.project_id')}
 END;
 CREATE TRIGGER asset_derivative_release AFTER UPDATE OF state ON asset_derivatives WHEN OLD.state='available' AND NEW.state='deleted' BEGIN
  UPDATE binary_owner_usage SET byte_count=byte_count-OLD.byte_count WHERE owner_id=(SELECT a.owner_id FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE v.id=OLD.version_id);
  INSERT INTO asset_epochs SELECT a.owner_id,a.scope,a.project_id,2 FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE v.id=OLD.version_id
   ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET generation=generation+1;
 END;
 CREATE TRIGGER asset_version_purge AFTER UPDATE OF state ON asset_versions WHEN OLD.state='available' AND NEW.state='deleted' BEGIN
  DELETE FROM binary_objects WHERE asset_version_id=NEW.id;
  UPDATE asset_derivatives SET state='deleted',revision=2,kind=NULL,text=NULL,provenance=NULL,language=NULL,timecodes=NULL,byte_count=0
   WHERE version_id=NEW.id AND state='available';
 END;
 CREATE TRIGGER asset_purge AFTER UPDATE OF state ON assets WHEN OLD.state='available' AND NEW.state='deleted' BEGIN
  UPDATE asset_versions SET state='deleted',revision=2,title=NULL,filename=NULL,media_type=NULL,byte_count=0,object_id=NULL WHERE asset_id=NEW.id AND state='available';
 END;
 CREATE TRIGGER asset_version_epoch AFTER INSERT ON asset_versions BEGIN
  INSERT INTO asset_epochs SELECT owner_id,scope,project_id,2 FROM assets WHERE id=NEW.asset_id
   ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET generation=generation+1;
 END;
 CREATE TRIGGER asset_lifecycle_epoch AFTER UPDATE OF state ON assets BEGIN
  ${epochSQL('NEW.owner_id','NEW.scope','NEW.project_id')}
 END;
 CREATE TRIGGER method_binary_purge AFTER UPDATE OF state ON method_versions WHEN OLD.state='available' AND NEW.state='deleted' BEGIN
  DELETE FROM binary_objects WHERE method_version_id=NEW.id;
  DELETE FROM method_mixed_entries WHERE version_id=NEW.id;
 END;
 CREATE TRIGGER method_binary_package_purge AFTER UPDATE OF state ON method_packages WHEN OLD.state='available' AND NEW.state='deleted' BEGIN
  DELETE FROM binary_objects WHERE method_version_id IN (SELECT id FROM method_versions WHERE package_id=NEW.id);
  DELETE FROM method_mixed_entries WHERE version_id IN (SELECT id FROM method_versions WHERE package_id=NEW.id);
 END;
`;
export function installAssets(db) { db.exec(canonicalSQL + triggerSQL); }
let definitions;
export function assertNoAssets(db) {
  const names = db.prepare("SELECT name,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
  if (names.some(row => ASSET_TABLES.includes(row.name) || ASSET_TABLES.includes(row.tbl_name) ||
    /^(asset_|binary_|method_mixed_|method_binary_|method_format_)/.test(row.name))) fail('unsupported_database');
}
export function validateAssets(db) {
  if (!definitions) {
    // Reuse the caller's SQLite class so importing schema guards stays portable.
    const reference = new db.constructor(':memory:');
    try {
      installMethodPackages(reference);
      const previous = new Set(reference.prepare('SELECT name FROM sqlite_master').all().map(row=>row.name));
      installAssets(reference);
      definitions = reference.prepare('SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY name').all().filter(row=>!previous.has(row.name));
    }
    finally { reference.close(); }
  }
  const find = db.prepare('SELECT type,tbl_name,sql FROM sqlite_master WHERE name=?');
  for (const expected of definitions) {
    const actual = find.get(expected.name);
    if (!actual || actual.type !== expected.type || actual.tbl_name !== expected.tbl_name || actual.sql !== expected.sql) fail('unsupported_database');
  }
}
// Complete shapes, not one row per page: writers call this before COMMIT.
export function validateBinaryObject(db, objectId) {
  const object = db.prepare('SELECT byte_count FROM binary_objects WHERE id=?').get(objectId);
  const shape = db.prepare('SELECT count(*) AS n,coalesce(sum(length(bytes)),0) AS bytes,min(chunk_index) AS first,max(chunk_index) AS last FROM binary_chunks WHERE object_id=?').get(objectId);
  const count = object && Math.ceil(object.byte_count / 32768);
  if (!object || shape.n !== count || shape.first !== 0 || shape.last !== count-1 || shape.bytes !== object.byte_count) fail('storage_error');
}
export function validateMixedManifest(db, versionId) {
  const shape = db.prepare("SELECT count(*) AS n,min(position) AS first,max(position) AS last,sum(kind='binary') AS binaries FROM method_mixed_entries WHERE version_id=?").get(versionId);
  if (!shape.n || shape.n>256 || shape.first!==0 || shape.last!==shape.n-1 || !shape.binaries) fail('storage_error');
  const entries=db.prepare('SELECT position,kind,path,folded_path,media_type,content_identity,byte_count,binary_object_id FROM method_mixed_entries WHERE version_id=? ORDER BY position').all(versionId);
  const files=db.prepare('SELECT position,path,media_type,content_identity,byte_count FROM method_files WHERE version_id=? ORDER BY position').all(versionId);
  const text=entries.filter(row=>row.kind==='text');
  if (files.length!==text.length || text.some((row,i)=>['position','path','media_type','content_identity','byte_count'].some(key=>row[key]!==files[i][key])) ||
      entries.some(row=>row.folded_path!==row.path.toLowerCase()) ||
      entries.filter(row=>row.kind==='binary').reduce((sum,row)=>sum+row.byte_count,0)>67108864) fail('storage_error');
  for (const row of entries.filter(row=>row.kind==='binary')) validateBinaryObject(db,row.binary_object_id);
}

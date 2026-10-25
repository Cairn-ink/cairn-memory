import { validateDependencyRecord } from './card-current-input.mjs';
import { fail, identifier } from './validation.mjs';

export const CARD_CURRENT_SCHEMA_VERSION = 33;
const positive = name => `${name} INTEGER NOT NULL CHECK(${name} BETWEEN 1 AND 9007199254740991)`;
const sql = `CREATE TABLE card_current_dependencies (
 card_id TEXT PRIMARY KEY REFERENCES private_cards(id) CHECK(length(card_id) BETWEEN 1 AND 200), owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200),
 scope TEXT NOT NULL CHECK(scope IN ('personal','project')), project_id TEXT NOT NULL CHECK(length(project_id)<=200 AND ((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0))),
 ${positive('revision')}, ${positive('card_revision')}, ${positive('body_revision')},
 context TEXT NOT NULL CHECK(json_valid(context) AND json_type(context)='object'),
 vector TEXT NOT NULL CHECK(json_valid(vector) AND json_type(vector)='array' AND json_array_length(vector) BETWEEN 1 AND 16 AND length(CAST(vector AS BLOB))<=32768)
) STRICT;
CREATE INDEX card_current_namespace ON card_current_dependencies(owner_id,scope,project_id,card_id);`;
const closed = (json, path, keys) => `(SELECT count(*) FROM json_each(${json},'${path}'))!=${keys.length} OR EXISTS(SELECT 1 FROM json_each(${json},'${path}') WHERE key NOT IN (${keys.map(k=>`'${k}'`).join(',')}))`;
// SQL admission checks run even for raw writes and recursive_triggers=0.
function invalid() {
  const c = 'NEW.context', e = 'd.value', b = 'b.value';
  const ns = (x,p) => `json_type(${x},'${p}') IS NOT 'object' OR ${closed(x,p,['ownerId','scope','projectId'])} OR json_extract(${x},'${p}.ownerId') IS NOT NEW.owner_id OR json_extract(${x},'${p}.scope') NOT IN ('personal','project') OR NOT ((json_extract(${x},'${p}.scope')='personal' AND json_type(${x},'${p}.projectId')='null') OR (json_extract(${x},'${p}.scope')='project' AND json_type(${x},'${p}.projectId')='text' AND length(json_extract(${x},'${p}.projectId')) BETWEEN 1 AND 200))`;
  return `${closed(c,'$',['readSet','roleId'])} OR json_type(${c},'$.readSet') IS NOT 'array' OR json_array_length(${c},'$.readSet') NOT BETWEEN 1 AND 2
   OR NOT (json_type(${c},'$.roleId')='null' OR (json_type(${c},'$.roleId')='text' AND length(json_extract(${c},'$.roleId')) BETWEEN 1 AND 200 AND json_extract(${c},'$.roleId') NOT GLOB '*[^A-Za-z0-9._-]*'))
   OR EXISTS(SELECT 1 FROM json_each(${c},'$.readSet') n WHERE ${ns('n.value','$')})
   OR NOT EXISTS(SELECT 1 FROM json_each(${c},'$.readSet') n WHERE json_extract(n.value,'$.scope')=NEW.scope AND coalesce(json_extract(n.value,'$.projectId'),'')=NEW.project_id)
   OR (json_array_length(${c},'$.readSet')=2 AND (json_extract(${c},'$.readSet[0].scope')!='personal' OR json_extract(${c},'$.readSet[1].scope')!='project'))
   OR (SELECT count(DISTINCT json_extract(value,'$.package.packageId')) FROM json_each(NEW.vector))!=json_array_length(NEW.vector)
   OR EXISTS(SELECT 1 FROM json_each(NEW.vector) d WHERE
     ${closed(e,'$',['package','version','consulted','availability'])}
     OR json_type(${e},'$.package') IS NOT 'object' OR ${closed(e,'$.package',['type','namespace','packageId'])}
     OR json_extract(${e},'$.package.type') IS NOT 'method-package' OR json_type(${e},'$.package.packageId') IS NOT 'text' OR length(json_extract(${e},'$.package.packageId')) NOT BETWEEN 1 AND 200
     OR ${ns(e,'$.package.namespace')}
     OR NOT EXISTS(SELECT 1 FROM json_each(${c},'$.readSet') n WHERE n.value=json_extract(${e},'$.package.namespace'))
     OR json_type(${e},'$.version') IS NOT 'object' OR ${closed(e,'$.version',['type','namespace','packageId','versionId','manifestIdentity'])}
     OR json_extract(${e},'$.version.type') IS NOT 'method-version' OR json_extract(${e},'$.version.namespace') IS NOT json_extract(${e},'$.package.namespace') OR json_extract(${e},'$.version.packageId') IS NOT json_extract(${e},'$.package.packageId')
     OR json_type(${e},'$.version.versionId') IS NOT 'text' OR length(json_extract(${e},'$.version.versionId')) NOT BETWEEN 1 AND 200 OR json_type(${e},'$.version.manifestIdentity') IS NOT 'text' OR length(json_extract(${e},'$.version.manifestIdentity'))!=43 OR json_extract(${e},'$.version.manifestIdentity') GLOB '*[^A-Za-z0-9_-]*'
     OR json_type(${e},'$.availability') IS NOT 'object' OR ${closed(e,'$.availability',['packageState','versionState','versionRevision'])}
     OR json_extract(${e},'$.availability.packageState') IS NOT 'available' OR json_extract(${e},'$.availability.versionState') IS NOT 'available' OR json_extract(${e},'$.availability.versionRevision') IS NOT 1
     OR json_type(${e},'$.consulted') IS NOT 'array' OR json_array_length(${e},'$.consulted') NOT BETWEEN 1 AND json_array_length(${c},'$.readSet')*(CASE WHEN json_type(${c},'$.roleId')='null' THEN 1 ELSE 2 END)
     OR EXISTS(SELECT 1 FROM json_each(${e},'$.consulted') b WHERE
       ${closed(b,'$',['namespace','roleKey','revision','state','version'])}
       OR json_extract(${b},'$.namespace') IS NOT json_extract(${c},'$.readSet['||(json_array_length(${c},'$.readSet')-1-CAST(b.key/(CASE WHEN json_type(${c},'$.roleId')='null' THEN 1 ELSE 2 END) AS INTEGER))||']')
       OR json_extract(${b},'$.roleKey') IS NOT (CASE WHEN json_type(${c},'$.roleId')='null' OR b.key%2=1 THEN '*' ELSE json_extract(${c},'$.roleId') END)
       OR (b.key<json_array_length(${e},'$.consulted')-1 AND (json_type(${b},'$.revision') IS NOT 'null' OR json_type(${b},'$.state') IS NOT 'null' OR json_type(${b},'$.version') IS NOT 'null'))
       OR (b.key=json_array_length(${e},'$.consulted')-1 AND (json_type(${b},'$.revision') IS NOT 'integer' OR json_extract(${b},'$.revision') NOT BETWEEN 1 AND 9007199254740991 OR json_extract(${b},'$.state') IS NOT 'active' OR json_extract(${b},'$.version') IS NOT json_extract(${e},'$.version')))
     )
   )`;
}
export function installCardCurrentDependencies(db) {
  db.exec(sql);
  db.exec(`CREATE TRIGGER card_current_insert BEFORE INSERT ON card_current_dependencies WHEN NEW.revision!=1 OR EXISTS(SELECT 1 FROM card_current_dependencies WHERE card_id=NEW.card_id OR rowid=NEW.rowid) BEGIN SELECT RAISE(ABORT,'card_current_replace'); END;
   CREATE TRIGGER card_current_update BEFORE UPDATE ON card_current_dependencies WHEN NEW.rowid!=OLD.rowid OR NEW.card_id IS NOT OLD.card_id OR NEW.owner_id IS NOT OLD.owner_id OR NEW.scope IS NOT OLD.scope OR NEW.project_id IS NOT OLD.project_id OR NEW.revision!=OLD.revision+1 BEGIN SELECT RAISE(ABORT,'card_current_immutable'); END;
   CREATE TRIGGER card_current_delete BEFORE DELETE ON card_current_dependencies WHEN NOT EXISTS(SELECT 1 FROM private_cards WHERE id=OLD.card_id AND state IN ('deleted','cancelled')) BEGIN SELECT RAISE(ABORT,'card_current_delete'); END;
   CREATE TRIGGER card_current_admit_insert BEFORE INSERT ON card_current_dependencies WHEN NOT EXISTS(SELECT 1 FROM private_cards WHERE id=NEW.card_id AND owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND state='confirmed') OR (${invalid()}) BEGIN SELECT RAISE(ABORT,'card_current_shape'); END;
   CREATE TRIGGER card_current_admit_update BEFORE UPDATE ON card_current_dependencies WHEN NOT EXISTS(SELECT 1 FROM private_cards WHERE id=NEW.card_id AND owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND state='confirmed') OR (${invalid()}) BEGIN SELECT RAISE(ABORT,'card_current_shape'); END;
   CREATE TRIGGER card_current_parent_insert BEFORE INSERT ON private_cards WHEN EXISTS(SELECT 1 FROM private_cards WHERE (id=NEW.id OR rowid=NEW.rowid) AND (state IN ('deleted','cancelled') OR EXISTS(SELECT 1 FROM card_current_dependencies WHERE card_id=private_cards.id))) BEGIN SELECT RAISE(ABORT,'card_current_parent_replace'); END;
   CREATE TRIGGER card_current_parent_update BEFORE UPDATE ON private_cards WHEN (OLD.state IN ('deleted','cancelled') AND (NEW.state IS NOT OLD.state OR NEW.id IS NOT OLD.id OR NEW.rowid!=OLD.rowid OR NEW.owner_id IS NOT OLD.owner_id OR NEW.scope IS NOT OLD.scope OR NEW.project_id IS NOT OLD.project_id OR NEW.revision IS NOT OLD.revision OR NEW.body_revision IS NOT OLD.body_revision)) OR (EXISTS(SELECT 1 FROM card_current_dependencies WHERE card_id=OLD.id) AND (NEW.id IS NOT OLD.id OR NEW.rowid!=OLD.rowid OR NEW.owner_id IS NOT OLD.owner_id OR NEW.scope IS NOT OLD.scope OR NEW.project_id IS NOT OLD.project_id OR NEW.state NOT IN ('confirmed','deleted','cancelled'))) BEGIN SELECT RAISE(ABORT,'card_current_parent'); END;
   CREATE TRIGGER card_current_parent_delete BEFORE DELETE ON private_cards WHEN OLD.state IN ('deleted','cancelled') OR EXISTS(SELECT 1 FROM card_current_dependencies WHERE card_id=OLD.id) BEGIN SELECT RAISE(ABORT,'card_current_parent_delete'); END;
   CREATE TRIGGER card_current_purge AFTER UPDATE OF state ON private_cards WHEN NEW.state IN ('deleted','cancelled') BEGIN DELETE FROM card_current_dependencies WHERE card_id=NEW.id; END;`);
}
let definitions;
const owned = "(lower(name) GLOB 'card_current_*' OR lower(tbl_name)='card_current_dependencies')";
export function assertNoCardCurrentDependencies(db) {
  if (db.prepare(`SELECT 1 FROM sqlite_master WHERE ${owned}`).get()) fail('unsupported_database');
}
export function validateCardCurrentDependencies(db) {
  if (!definitions) {
    const reference = new db.constructor(':memory:');
    try { reference.exec('CREATE TABLE private_cards(id TEXT PRIMARY KEY);'); installCardCurrentDependencies(reference);
      definitions = reference.prepare(`SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND ${owned} ORDER BY name`).all();
    } finally { reference.close(); }
  }
  const actual = db.prepare(`SELECT name,type,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL AND ${owned} ORDER BY name`).all();
  if (JSON.stringify(actual) !== JSON.stringify(definitions)) fail('unsupported_database');
  try {
    if (db.prepare('PRAGMA foreign_key_check').get() || db.prepare('PRAGMA quick_check').get().quick_check !== 'ok') fail('unsupported_database');
    for (const row of db.prepare('SELECT d.*,c.id parent,c.owner_id po,c.scope ps,c.project_id pp,c.state FROM card_current_dependencies d LEFT JOIN private_cards c ON c.id=d.card_id').iterate()) {
      identifier(row.card_id);
      if (!row.parent || row.owner_id !== row.po || row.scope !== row.ps || row.project_id !== row.pp || row.state !== 'confirmed') fail('unsupported_database');
      validateDependencyRecord(row.context, row.vector, { ownerId: row.owner_id, scope: row.scope, projectId: row.project_id || null });
    }
  } catch (error) {
    if (error?.code === 'ERR_SQLITE_ERROR' && [5,6].includes(error.errcode & 255)) throw error;
    fail('unsupported_database');
  }
}

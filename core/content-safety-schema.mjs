import { AsyncLocalStorage } from 'node:async_hooks';
import { resolveContentLayout } from './content-safety-layout.mjs';
import { fail } from './validation.mjs';
import { cardLineageDDL, authoredInvalidationDDL } from './card-lineage-schema.mjs';
import { lineageBaseDeclarations, extendedReceiptDeclarations } from './card-lineage-base-schema.mjs';
import { installLocalRawPrivacy } from './local-authority-schema.mjs';

const tables = `CREATE TABLE content_safety_control (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 base_layout INTEGER NOT NULL CHECK(base_layout IN (18,23,33)),
 suppression_revision INTEGER NOT NULL CHECK(suppression_revision=1),
 card_lineage_revision INTEGER NOT NULL CHECK(card_lineage_revision IN (0,1)),
 migration_state TEXT NOT NULL CHECK(migration_state='complete'),
 suppression_domain TEXT NOT NULL CHECK(length(suppression_domain)=36),
 migration_id TEXT NOT NULL CHECK(length(migration_id)=36),
 inventory_digest TEXT NOT NULL CHECK(length(inventory_digest)=64 AND inventory_digest NOT GLOB '*[^0-9a-f]*'),
 CHECK(base_layout!=18 OR card_lineage_revision=0)
) STRICT, WITHOUT ROWID;
CREATE TABLE content_identity_reservations (
 owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200),
 scope TEXT NOT NULL CHECK(scope IN ('personal','project')),
 project_id TEXT NOT NULL CHECK(length(project_id)<=200 AND ((scope='personal' AND project_id='') OR (scope='project' AND length(project_id)>0))),
 kind TEXT NOT NULL CHECK(kind IN ('memory','receipt','submitted-note','raw','card','raw-message','raw-part')),
 stable_key TEXT NOT NULL CHECK(length(stable_key) BETWEEN 1 AND 1024),
 incarnation TEXT NOT NULL CHECK(length(incarnation) BETWEEN 1 AND 200),
 evidence_origin TEXT NOT NULL CHECK(evidence_origin IN ('writer','canonical-tombstone','canonical-edge')),
 PRIMARY KEY(owner_id,scope,project_id,kind,stable_key),
 UNIQUE(owner_id,scope,project_id,kind,stable_key,incarnation),
 CHECK(kind IN ('raw-message','raw-part') OR stable_key=incarnation)
) STRICT, WITHOUT ROWID;
CREATE TABLE owner_suppression_epochs (
 owner_id TEXT PRIMARY KEY CHECK(length(owner_id) BETWEEN 1 AND 200),
 epoch_hi INTEGER NOT NULL CHECK(epoch_hi BETWEEN 0 AND 4294967295),
 epoch_lo INTEGER NOT NULL CHECK(epoch_lo BETWEEN 0 AND 4294967295)
) STRICT, WITHOUT ROWID;
CREATE TABLE content_suppressions (
 owner_id TEXT NOT NULL CHECK(length(owner_id) BETWEEN 1 AND 200),
 fact_id TEXT NOT NULL CHECK(length(fact_id)=64 AND fact_id NOT GLOB '*[^0-9a-f]*'),
 epoch_hi INTEGER NOT NULL CHECK(epoch_hi BETWEEN 0 AND 4294967295),
 epoch_lo INTEGER NOT NULL CHECK(epoch_lo BETWEEN 0 AND 4294967295),
 scope TEXT NOT NULL CHECK(scope IN ('owner','personal','project')),
 project_id TEXT NOT NULL CHECK(length(project_id)<=200 AND ((scope IN ('owner','personal') AND project_id='') OR (scope='project' AND length(project_id)>0))),
 kind TEXT NOT NULL CHECK(kind IN ('owner','namespace','memory','receipt','submitted-note','raw','card')),
 stable_key TEXT NOT NULL CHECK(length(stable_key)<=200), incarnation TEXT NOT NULL CHECK(length(incarnation)<=200),
 match_mode TEXT NOT NULL CHECK(match_mode IN ('owner','namespace','incarnation','version','revision-through','span')),
 source_version TEXT NOT NULL CHECK(length(CAST(source_version AS BLOB))<=2048 AND (source_version='*' OR (json_valid(source_version) AND json_type(source_version)='array'))),
 message_key TEXT NOT NULL CHECK(length(message_key)<=200),
 span_start INTEGER NOT NULL CHECK(span_start>=0), span_end INTEGER NOT NULL CHECK(span_end>=0),
 reason TEXT NOT NULL CHECK(reason IN ('user_forget','correction_supersession','purge','privacy_erase','account_erasure')),
 action_id TEXT NOT NULL CHECK(length(action_id) BETWEEN 1 AND 200),
 recorded_at TEXT NOT NULL CHECK(length(recorded_at)>0),
 evidence_origin TEXT NOT NULL CHECK(evidence_origin IN ('writer','canonical-tombstone')),
 cleanup_status TEXT NOT NULL CHECK(cleanup_status IN ('pending','failed','complete')),
 cleanup_attempt INTEGER NOT NULL CHECK(cleanup_attempt BETWEEN 0 AND 9007199254740991),
 reservation_incarnation TEXT GENERATED ALWAYS AS (CASE WHEN match_mode IN ('owner','namespace') THEN NULL ELSE incarnation END) STORED,
 PRIMARY KEY(owner_id,fact_id), UNIQUE(owner_id,epoch_hi,epoch_lo),
 FOREIGN KEY(owner_id) REFERENCES owner_suppression_epochs(owner_id),
 FOREIGN KEY(owner_id,scope,project_id,kind,stable_key,reservation_incarnation)
   REFERENCES content_identity_reservations(owner_id,scope,project_id,kind,stable_key,incarnation),
 CHECK((match_mode='owner' AND scope='owner' AND kind='owner' AND stable_key='' AND incarnation='') OR
       (match_mode='namespace' AND scope!='owner' AND kind='namespace' AND stable_key='' AND incarnation='') OR
       (match_mode NOT IN ('owner','namespace') AND scope!='owner' AND kind NOT IN ('owner','namespace') AND length(stable_key)>0 AND stable_key=incarnation)),
 CHECK((match_mode='span' AND kind='raw' AND length(message_key)>0 AND span_end>span_start) OR
       (match_mode!='span' AND message_key='' AND span_start=0 AND span_end=0)),
 CHECK((match_mode IN ('version','revision-through') AND source_version!='*') OR (match_mode NOT IN ('version','revision-through') AND source_version='*')),
 CHECK(match_mode!='revision-through' OR kind='memory'),
 CHECK(epoch_hi!=0 OR epoch_lo!=0)
) STRICT, WITHOUT ROWID;
CREATE INDEX content_suppression_target ON content_suppressions(owner_id,scope,project_id,kind,stable_key,incarnation,match_mode);
CREATE INDEX content_suppression_window ON content_suppressions(owner_id,epoch_hi,epoch_lo,scope,project_id,kind,stable_key,incarnation);
CREATE INDEX content_suppression_cleanup ON content_suppressions(cleanup_status,owner_id,fact_id);
`;
const guards = `CREATE TRIGGER safety_control_insert BEFORE INSERT ON content_safety_control WHEN EXISTS(SELECT 1 FROM content_safety_control) BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_control_delete BEFORE DELETE ON content_safety_control BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_control_update BEFORE UPDATE ON content_safety_control
 WHEN NEW.singleton IS NOT OLD.singleton OR NEW.base_layout IS NOT OLD.base_layout OR NEW.suppression_revision IS NOT OLD.suppression_revision OR NEW.migration_state IS NOT OLD.migration_state OR NEW.suppression_domain IS NOT OLD.suppression_domain OR OLD.card_lineage_revision!=0 OR NEW.card_lineage_revision!=1
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_reservation_insert BEFORE INSERT ON content_identity_reservations
 WHEN EXISTS(SELECT 1 FROM content_identity_reservations WHERE (owner_id,scope,project_id,kind,stable_key)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.kind,NEW.stable_key)) BEGIN SELECT RAISE(ABORT,'safety_replace'); END;
CREATE TRIGGER safety_reservation_update BEFORE UPDATE ON content_identity_reservations BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_reservation_delete BEFORE DELETE ON content_identity_reservations BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_epoch_insert BEFORE INSERT ON owner_suppression_epochs
 WHEN NEW.epoch_hi!=0 OR NEW.epoch_lo!=0 OR EXISTS(SELECT 1 FROM owner_suppression_epochs WHERE owner_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT,'safety_epoch'); END;
CREATE TRIGGER safety_epoch_delete BEFORE DELETE ON owner_suppression_epochs BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_epoch_update BEFORE UPDATE ON owner_suppression_epochs
 WHEN NEW.owner_id IS NOT OLD.owner_id OR (OLD.epoch_hi=4294967295 AND OLD.epoch_lo=4294967295) OR
 NEW.epoch_hi!=OLD.epoch_hi+CASE WHEN OLD.epoch_lo=4294967295 THEN 1 ELSE 0 END OR
 NEW.epoch_lo!=CASE WHEN OLD.epoch_lo=4294967295 THEN 0 ELSE OLD.epoch_lo+1 END OR
 NOT EXISTS(SELECT 1 FROM content_suppressions WHERE owner_id=NEW.owner_id AND epoch_hi=NEW.epoch_hi AND epoch_lo=NEW.epoch_lo)
 BEGIN SELECT RAISE(ABORT,'safety_epoch'); END;
CREATE TRIGGER safety_suppression_insert BEFORE INSERT ON content_suppressions
 WHEN EXISTS(SELECT 1 FROM content_suppressions WHERE (owner_id,fact_id)=(NEW.owner_id,NEW.fact_id) OR (owner_id,epoch_hi,epoch_lo)=(NEW.owner_id,NEW.epoch_hi,NEW.epoch_lo)) OR
 NOT EXISTS(SELECT 1 FROM owner_suppression_epochs e WHERE e.owner_id=NEW.owner_id AND NOT(e.epoch_hi=4294967295 AND e.epoch_lo=4294967295) AND NEW.epoch_hi=e.epoch_hi+CASE WHEN e.epoch_lo=4294967295 THEN 1 ELSE 0 END AND NEW.epoch_lo=CASE WHEN e.epoch_lo=4294967295 THEN 0 ELSE e.epoch_lo+1 END)
 BEGIN SELECT RAISE(ABORT,'safety_epoch'); END;
CREATE TRIGGER safety_suppression_advance AFTER INSERT ON content_suppressions
 BEGIN UPDATE owner_suppression_epochs SET epoch_hi=NEW.epoch_hi,epoch_lo=NEW.epoch_lo WHERE owner_id=NEW.owner_id; END;
CREATE TRIGGER safety_suppression_delete BEFORE DELETE ON content_suppressions BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
CREATE TRIGGER safety_suppression_update BEFORE UPDATE ON content_suppressions
 WHEN (NEW.owner_id,NEW.fact_id,NEW.epoch_hi,NEW.epoch_lo,NEW.scope,NEW.project_id,NEW.kind,NEW.stable_key,NEW.incarnation,NEW.match_mode,NEW.source_version,NEW.message_key,NEW.span_start,NEW.span_end,NEW.reason,NEW.action_id,NEW.recorded_at,NEW.evidence_origin) IS NOT
 (OLD.owner_id,OLD.fact_id,OLD.epoch_hi,OLD.epoch_lo,OLD.scope,OLD.project_id,OLD.kind,OLD.stable_key,OLD.incarnation,OLD.match_mode,OLD.source_version,OLD.message_key,OLD.span_start,OLD.span_end,OLD.reason,OLD.action_id,OLD.recorded_at,OLD.evidence_origin) OR NEW.cleanup_attempt!=OLD.cleanup_attempt+1 OR OLD.cleanup_status='complete'
 BEGIN SELECT RAISE(ABORT,'safety_immutable'); END;
`;
const receiptAndRaw = `CREATE TRIGGER safety_receipt_insert BEFORE INSERT ON receipts
 WHEN EXISTS(SELECT 1 FROM receipts WHERE id=NEW.id OR rowid=NEW.rowid OR (memory_id,receipt_key)=(NEW.memory_id,NEW.receipt_key)) OR EXISTS(SELECT 1 FROM content_identity_reservations r JOIN memories m ON m.id=NEW.memory_id WHERE (r.owner_id,r.scope,r.project_id,r.kind,r.stable_key)=(m.owner_id,m.scope,m.project_id,'receipt',NEW.id))
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_receipt_identity BEFORE UPDATE ON receipts
 WHEN (NEW.rowid,NEW.id,NEW.memory_id,NEW.receipt_key) IS NOT (OLD.rowid,OLD.id,OLD.memory_id,OLD.receipt_key) BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_raw_message_insert BEFORE INSERT ON raw_messages
 WHEN EXISTS(SELECT 1 FROM raw_messages WHERE rowid=NEW.rowid OR (conversation_id=NEW.conversation_id AND (message_id=NEW.message_id OR ordinal=NEW.ordinal))) OR EXISTS(SELECT 1 FROM content_identity_reservations r JOIN raw_conversations c ON c.id=NEW.conversation_id WHERE (r.owner_id,r.scope,r.project_id,r.kind,r.stable_key)=(c.owner_id,c.scope,c.project_id,'raw-message',json_array(NEW.conversation_id,NEW.message_id)))
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_raw_message_identity BEFORE UPDATE ON raw_messages
 WHEN (NEW.rowid,NEW.conversation_id,NEW.message_id,NEW.ordinal,NEW.role,NEW.first_event_id) IS NOT (OLD.rowid,OLD.conversation_id,OLD.message_id,OLD.ordinal,OLD.role,OLD.first_event_id) BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_raw_part_insert BEFORE INSERT ON raw_parts
 WHEN EXISTS(SELECT 1 FROM raw_parts WHERE rowid=NEW.rowid OR (conversation_id,message_id,part_index)=(NEW.conversation_id,NEW.message_id,NEW.part_index)) OR EXISTS(SELECT 1 FROM content_identity_reservations r JOIN raw_conversations c ON c.id=NEW.conversation_id WHERE (r.owner_id,r.scope,r.project_id,r.kind,r.stable_key)=(c.owner_id,c.scope,c.project_id,'raw-part',json_array(NEW.conversation_id,NEW.message_id,NEW.part_index)))
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_raw_part_identity BEFORE UPDATE ON raw_parts
 WHEN (NEW.rowid,NEW.conversation_id,NEW.message_id,NEW.part_index,NEW.start,NEW.end,NEW.digest) IS NOT (OLD.rowid,OLD.conversation_id,OLD.message_id,OLD.part_index,OLD.start,OLD.end,OLD.digest) BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
CREATE TRIGGER safety_memory_terminal BEFORE UPDATE ON memories WHEN OLD.deleted=1 AND NEW.deleted!=1 BEGIN SELECT RAISE(ABORT,'safety_terminal'); END;
CREATE TRIGGER safety_note_terminal BEFORE UPDATE ON card_notes WHEN OLD.state='deleted' AND NEW.state!='deleted' BEGIN SELECT RAISE(ABORT,'safety_terminal'); END;
CREATE TRIGGER safety_card_terminal BEFORE UPDATE ON private_cards WHEN OLD.state IN ('deleted','cancelled') AND NEW.state IS NOT OLD.state BEGIN SELECT RAISE(ABORT,'safety_terminal'); END;
`;
const cardFallback = `CREATE TRIGGER safety_card_suppression AFTER UPDATE OF state ON private_cards
 WHEN OLD.state IN ('draft','confirmed') AND NEW.state IN ('deleted','cancelled') AND NOT EXISTS(SELECT 1 FROM content_suppressions WHERE (owner_id,scope,project_id,kind,stable_key,incarnation,match_mode,reason)=(NEW.owner_id,NEW.scope,NEW.project_id,'card',NEW.id,NEW.id,'incarnation','purge'))
 BEGIN
 INSERT INTO owner_suppression_epochs SELECT NEW.owner_id,0,0 WHERE NOT EXISTS(SELECT 1 FROM owner_suppression_epochs WHERE owner_id=NEW.owner_id);
 INSERT INTO content_identity_reservations SELECT NEW.owner_id,NEW.scope,NEW.project_id,'card',NEW.id,NEW.id,'writer' WHERE NOT EXISTS(SELECT 1 FROM content_identity_reservations WHERE (owner_id,scope,project_id,kind,stable_key)=(NEW.owner_id,NEW.scope,NEW.project_id,'card',NEW.id));
 INSERT INTO content_suppressions(owner_id,fact_id,epoch_hi,epoch_lo,scope,project_id,kind,stable_key,incarnation,match_mode,source_version,message_key,span_start,span_end,reason,action_id,recorded_at,evidence_origin,cleanup_status,cleanup_attempt)
 SELECT NEW.owner_id,lower(hex(randomblob(32))),epoch_hi+CASE WHEN epoch_lo=4294967295 THEN 1 ELSE 0 END,CASE WHEN epoch_lo=4294967295 THEN 0 ELSE epoch_lo+1 END,NEW.scope,NEW.project_id,'card',NEW.id,NEW.id,'incarnation','*','',0,0,'purge','card-terminal',NEW.updated_at,'writer','pending',0 FROM owner_suppression_epochs WHERE owner_id=NEW.owner_id;
 END;
`;

const canonical = [
  ['memories', 'memory', 'id=NEW.id OR rowid=NEW.rowid OR (NEW.deleted=0 AND deleted=0 AND (owner_id,scope,project_id,fingerprint)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.fingerprint))', 18],
  ['card_notes', 'submitted-note', 'id=NEW.id OR rowid=NEW.rowid', 20],
  ['private_cards', 'card', 'id=NEW.id OR rowid=NEW.rowid', 20],
  ['raw_conversations', 'raw', 'id=NEW.id OR rowid=NEW.rowid OR (owner_id,scope,project_id,client,session_key)=(NEW.owner_id,NEW.scope,NEW.project_id,NEW.client,NEW.session_key)', 24],
];
export function contentSafetyDDL(base, receiptEventTime = false, attestedFeatures = false) {
  let sql = tables + guards;
  if (attestedFeatures) {
    sql = sql.replace(" migration_state TEXT",
      ' receipt_event_time INTEGER NOT NULL CHECK (receipt_event_time IN (0,1)),\n migration_state TEXT')
      .replace('WHEN NEW.singleton IS NOT OLD.singleton',
        'WHEN NEW.receipt_event_time IS NOT OLD.receipt_event_time OR NEW.singleton IS NOT OLD.singleton');
  }
  for (const [table, kind, collision, first] of canonical) {
    if (base < first) continue;
    sql += `CREATE TRIGGER safety_${table}_insert BEFORE INSERT ON ${table}
 WHEN EXISTS(SELECT 1 FROM ${table} WHERE ${collision}) OR EXISTS(SELECT 1 FROM content_identity_reservations WHERE owner_id=NEW.owner_id AND scope=NEW.scope AND project_id=NEW.project_id AND kind='${kind}' AND stable_key=NEW.id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_reuse'); END;
CREATE TRIGGER safety_${table}_identity BEFORE UPDATE ON ${table}
 WHEN (NEW.rowid,NEW.id,NEW.owner_id,NEW.scope,NEW.project_id) IS NOT (OLD.rowid,OLD.id,OLD.owner_id,OLD.scope,OLD.project_id)
 BEGIN SELECT RAISE(ABORT,'safety_identity_change'); END;
`;
  }
  // Split only complete CREATE statements: trigger bodies contain semicolons.
  const statements = receiptAndRaw.match(/CREATE TRIGGER[\s\S]*?END;/g);
  for (const statement of statements) {
    if (statement.includes(' ON receipts') || statement.includes(' ON memories') ||
        base >= 20 && (statement.includes(' ON card_notes') || statement.includes(' ON private_cards')) ||
        base >= 24 && (statement.includes(' ON raw_messages') || statement.includes(' ON raw_parts'))) sql += (receiptEventTime && statement.includes('CREATE TRIGGER safety_receipt_identity ')
          ? statement.replaceAll('NEW.receipt_key)', 'NEW.receipt_key,NEW.occurred_at)')
            .replaceAll('OLD.receipt_key)', 'OLD.receipt_key,OLD.occurred_at)') : statement) + '\n';
  }
  if (base >= 20) sql += cardFallback;
  return sql;
}
const normalize = sql => sql.trim().replace(/;$/, '').replace(/\s+/g, ' ');
const expected = new Map();
function expectedSchema(base, receiptEventTime = false, attestedFeatures = false, lineage = 0) {
  const key = JSON.stringify([base, receiptEventTime, attestedFeatures, lineage]);
  if (!expected.has(key)) {
    // Comparison needs no SQLite handle: use the closed normative declarations.
    const sql = contentSafetyDDL(base, receiptEventTime, attestedFeatures) + (lineage ? cardLineageDDL : '');
    const declarations = sql.match(/CREATE (?:TABLE|(?:UNIQUE )?INDEX)[\s\S]*?;|CREATE TRIGGER[\s\S]*?END;/g);
    expected.set(key, new Map(declarations.map(sql => {
      const [, type, name] = sql.match(/^CREATE (?:UNIQUE )?(TABLE|INDEX|TRIGGER) (\w+)/);
      return [name, { type: type.toLowerCase(), sql: normalize(sql) }];
    })));
  }
  return expected.get(key);
}
const matchesSafetySchema = (rows, layout, receiptEventTime, lineage = 0, baseScan = false) => {
  const wanted = new Map([...expectedSchema(layout.base, receiptEventTime, layout.attestedFeatures, lineage)]
    .filter(([name]) => !baseScan || !/^card_body_|^card_operations_owner_action$/.test(name)));
  return rows.length === wanted.size && rows.every(row => wanted.has(row.name) &&
    row.type === wanted.get(row.name).type && normalize(row.sql ?? '') === wanted.get(row.name).sql);
};
// Preserve quoted SQL bytes when comparing the complete inherited package.
// Whitespace inside a CHECK literal is meaningful and cannot be normalized away.
const exactDDL = sql => JSON.stringify((sql??'').match(/'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`|\[[^\]]*\]|[A-Za-z_][A-Za-z_0-9]*|[0-9]+|[^\s;]/g)??[]);
function verifyCompleteCardSchema(db,layout,eventTime) {
  const wanted=new Map(lineageBaseDeclarations[layout.base].map(row=>[row.name,{...row}]));
  if(eventTime)wanted.get('receipts').sql=extendedReceiptDeclarations[layout.base];
  wanted.get('card_memory_revision_invalidation').sql=authoredInvalidationDDL(layout.base);
  for(const [name,row]of expectedSchema(layout.base,eventTime,true,1))wanted.set(name,{name,...row});
  // Local Raw adds one closed, optional package to the inherited schema. Admit
  // the entire exact package or none of it; never ignore a name/prefix family.
  // Metadata only: read-only openers execute no DDL or repair writes.
  const local = new Map(installLocalRawPrivacy().trim().split(';').filter(sql=>sql.trim()).map(sql=>{
    sql=sql.trim().replace(' IF NOT EXISTS','');
    const [,type,name]=sql.match(/^CREATE (TABLE|INDEX) (\w+)/);
    return [name,{type:type.toLowerCase(),sql}];
  }));
  const actual=metadataRows(db.prepare('SELECT name,type,sql FROM sqlite_schema WHERE sql IS NOT NULL LIMIT '+(wanted.size+local.size+1)));
  if(layout.base===33&&actual.some(row=>local.has(row.name)))for(const [name,row]of local)wanted.set(name,row);
  if(actual.length!==wanted.size||actual.some(row=>!wanted.has(row.name)||row.type!==wanted.get(row.name).type||
    exactDDL(row.sql)!==exactDDL(wanted.get(row.name).sql)))fail('unsupported_database');
}
const safetyObjects = `SELECT schema_version AS cookie,name,type,sql FROM pragma_schema_version LEFT JOIN sqlite_schema ON (
 name GLOB 'content_safety_*' OR name GLOB 'content_identity_*' OR name='owner_suppression_epochs'
 OR name GLOB 'content_suppression*' OR name GLOB 'safety_*') LIMIT 65`;
const lineageObjects = safetyObjects.replace(") LIMIT 65", " OR name GLOB 'card_body_*' OR name='card_operations_owner_action') LIMIT 85");
export function verifyContentSafetyDDL(db, physical) {
  const layout = resolveContentLayout(physical);
  const receiptEventTime = layout.attestedFeatures
    ? supportedReceiptEventTime(db.prepare('SELECT receipt_event_time FROM content_safety_control WHERE singleton=1').get()?.receipt_event_time)
    : false;
  const lineage = layout.attestedFeatures ? db.prepare('SELECT card_lineage_revision FROM content_safety_control WHERE singleton=1').get()?.card_lineage_revision : 0;
  const wanted = expectedSchema(layout.base, receiptEventTime, layout.attestedFeatures, lineage);
  const rows = db.prepare(lineage ? lineageObjects : safetyObjects).all().filter(row => row.name !== null);
  if (!layout.suppressionRevision || rows.length !== wanted.size || rows.some(row => !wanted.has(row.name) ||
      row.type !== wanted.get(row.name).type || normalize(row.sql ?? '') !== wanted.get(row.name).sql)) fail('unsupported_database');
}
// Native readers stream bounded metadata; trusted metered adapters may expose all.
const metadataRows = statement => typeof statement.iterate === 'function' ? [...statement.iterate()] : statement.all();
// All serving adapters share the native connection's attestation and refusal.
const connections = new WeakMap();
export function contentSafetyConnection(db) { return connections.get(db) ?? db; }
export function bindContentSafetyConnection(adapter, db) {
  const native = contentSafetyConnection(db), previous = connections.get(adapter);
  if (previous && previous !== native) fail('unsupported_database');
  // Registration must never clear a refusal observed before association.
  if (refused.has(adapter)) refused.add(native);
  if (!layouts.has(native) && layouts.has(adapter)) layouts.set(native, layouts.get(adapter));
  connections.set(adapter, native);
  return adapter;
}
// A charged serving adapter can stop before SQLite executes. Exhaustion is not
// evidence of a broken schema and must not permanently refuse its connection.
export const contentSafetyBudgetError = error =>
  ['source_budget_exceeded','read_budget_exceeded','budget_exceeded','read_timeout'].includes(error?.code) ||
  ['deadline','work_limit','state_limit'].includes(error?.reason);
const servingLayout = new AsyncLocalStorage();
export function withContentSafetyLayoutInside(db, work, proof) {
  if(!db.isTransaction)fail('storage_error');
  // A request proof is reused only inside engine-owned synchronous work. The
  // public delivery fence still reattests the header independently.
  cachedContentLayout(db);
  const layout=proof ?? installedContentLayout(db);
  return servingLayout.run({native:contentSafetyConnection(db),layout},()=>work(layout));
}
// Feature values never travel on layout objects: copies, aliases, computed
// property access and destructuring cannot expose the attested bit.
const eventTimeLayouts = new WeakSet();
export function receiptEventTimeEnabled(layout) { return eventTimeLayouts.has(layout); }
const lineageLayouts = new WeakSet();
export function cardLineageRevision(layout) { return lineageLayouts.has(layout) ? 1 : 0; }
// The native transaction implementation registers this seam without linking
// SQLite into configuration/CLI imports of the safety boundary.
let contentReadSnapshot;
export function registerContentReadSnapshot(read) { contentReadSnapshot=read; }
export function withCanonicalContentSnapshot(db,work) {
  if(db.isTransaction)return work();
  if(!contentReadSnapshot)fail('storage_error');
  return contentReadSnapshot(contentSafetyConnection(db),work);
}
const layouts = new WeakMap();
const refused = new WeakSet();
const controlFields = ['singleton','base_layout','suppression_revision','card_lineage_revision','migration_state',
  'suppression_domain','migration_id','inventory_digest'];
const attestedControlFields = layout => layout.attestedFeatures ? [...controlFields, 'receipt_event_time'] : controlFields;
const supportedReceiptEventTime = value => {
  if (value !== 0 && value !== 1) fail('unsupported_database');
  return value === 1;
};
const headerSQL = layout => `SELECT schema_version AS cookie,(SELECT user_version FROM pragma_user_version) AS physical,
 (SELECT application_id FROM pragma_application_id) AS applicationId${layout?.suppressionRevision ?
    ',(SELECT json_array(' + attestedControlFields(layout).join(',') + ') FROM content_safety_control WHERE singleton=1) AS control' : ''}
 FROM pragma_schema_version`;
/** Metadata only: version, bounded schema and a final coherent header/control.
 * No population scan, DDL, repair or seeding on open. */
export function attestContentSafety(db, physical) {
  if (refused.has(contentSafetyConnection(db))) fail('unsupported_database');
  try {
    if (physical === undefined) physical = db.prepare('PRAGMA user_version').get().user_version;
    const layout = resolveContentLayout(physical);
    // The schema rows and their cookie share one statement snapshot. Compare
    // with the final header without adding any opener statements.
    const scanned = metadataRows(db.prepare(safetyObjects));
    const cookie = scanned[0]?.cookie;
    let rows = scanned.filter(row => row.name !== null);
    let controlBinding, header;
    if (!layout.suppressionRevision) {
      if (rows.length) fail('unsupported_database');
    } else {
      // Reject unknown DDL before reading any control values. Families admit
      // only the two supported tuple shapes; the row must then select exactly
      // the matching shape. Legacy cells retain their original preflight.
      const lineageAlternatives = layout.attestedFeatures && [23,33].includes(layout.base) ? [0,1] : [0];
      if (!(layout.attestedFeatures ? [false, true] : [false]).some(flag => lineageAlternatives.some(lineage => matchesSafetySchema(rows, layout, flag, lineage, true)))) fail('unsupported_database');
      // Read the control population and final schema/version header together.
      // This retains the cookie fence without a separate singleton statement.
      const control = metadataRows(db.prepare(`SELECT c.*,schema_version AS cookie,
        (SELECT user_version FROM pragma_user_version) AS physical,
        (SELECT application_id FROM pragma_application_id) AS applicationId,
        EXISTS(SELECT 1 FROM pragma_table_xinfo('receipts') WHERE name='occurred_at') AS receiptEventTimeColumn
        FROM pragma_schema_version LEFT JOIN content_safety_control c ON 1 LIMIT 2`));
      const row = control[0];
      if (control.length !== 1 || row.singleton !== 1 || row.base_layout !== layout.base ||
          row.suppression_revision !== 1 || !lineageAlternatives.includes(row.card_lineage_revision) || row.migration_state !== 'complete' ||
          ![row.suppression_domain, row.migration_id].every(value => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)) ||
          !/^[0-9a-f]{64}$/.test(row.inventory_digest)) fail('unsupported_database');
      const eventTime = layout.attestedFeatures ? supportedReceiptEventTime(row.receipt_event_time) : false;
      // Lineage-zero openers retain the original bounded query and sequence.
      // Only the selected installed package needs the extended object scan;
      // bind it to both the initial schema cookie and final control snapshot.
      if (row.card_lineage_revision === 1) {
        const extended = metadataRows(db.prepare(lineageObjects));
        if (extended[0]?.cookie !== cookie || row.cookie !== cookie) fail('unsupported_database');
        rows = extended.filter(object => object.name !== null);
      }
      // Shared by every safety-attested opener, including legacy ordinary
      // readers and lazy topic preparation. Metadata only, in the existing
      // final header snapshot; cached reads retain their single header check.
      if (Boolean(row.receiptEventTimeColumn) !== eventTime ||
          !matchesSafetySchema(rows, layout, eventTime, row.card_lineage_revision)) fail('unsupported_database');
      if (eventTime) eventTimeLayouts.add(layout);
      if (row.card_lineage_revision === 1) {
        const invalidation=db.prepare("SELECT sql FROM sqlite_schema WHERE name='card_memory_revision_invalidation'").get();
        if(normalize(invalidation?.sql??'')!==normalize(authoredInvalidationDDL(layout.base)))fail('unsupported_database');
        verifyCompleteCardSchema(db,layout,eventTime);
        lineageLayouts.add(layout);
      }
      // Exact DDL closes the feature/revision vocabulary; the control row selects
      // only supported values. Missing, extra or future columns refuse above.
      controlBinding = JSON.stringify(attestedControlFields(layout).map(field => row[field]));
      header = { cookie: row.cookie, physical: row.physical, applicationId: row.applicationId, control: controlBinding };
    }
    header ??= db.prepare(headerSQL(false)).get();
    if (header.cookie !== cookie || header.physical !== physical || physical !== 0 && header.applicationId !== 0x43414952 ||
        layout.suppressionRevision && header.control !== controlBinding) fail('unsupported_database');
    layouts.set(contentSafetyConnection(db), { layout, header });
    return layout;
  } catch (error) {
    if (contentSafetyBudgetError(error) || [5, 6].includes(Number(error?.errcode) & 255)) throw error;
    refused.add(contentSafetyConnection(db));
    // Preserve native operational error mapping/diagnostics for the first
    // failure; the native connection nevertheless stays permanently refused.
    if ([7,10].includes(Number(error?.errcode) & 255)) throw error;
    fail('unsupported_database');
  }
}
/** Trusted adapters can reuse the opener's attestation without any new SQL. */
export function cachedContentLayout(db) {
  if (refused.has(contentSafetyConnection(db))) fail('unsupported_database');
  return layouts.get(contentSafetyConnection(db))?.layout;
}
export function installedContentLayout(db) {
  if (refused.has(contentSafetyConnection(db))) fail('unsupported_database');
  const serving=servingLayout.getStore();
  if(serving?.native===contentSafetyConnection(db))return serving.layout;
  const cached = layouts.get(contentSafetyConnection(db));
  if (!cached) return attestContentSafety(db);
  let header;
  try { header = db.prepare(headerSQL(cached.layout)).get(); }
  catch (error) { if (contentSafetyBudgetError(error) || [5,6].includes(Number(error?.errcode) & 255)) throw error; refused.add(contentSafetyConnection(db)); if ([7,10].includes(Number(error?.errcode) & 255)) throw error; fail('unsupported_database'); }
  if (header.cookie !== cached.header.cookie || header.physical !== cached.header.physical ||
      header.applicationId !== cached.header.applicationId || header.control !== cached.header.control) {
    return attestContentSafety(db, header.physical);
  }
  return cached.layout;
}

/** Existing writer transactions already own the storage lock. Keep lifecycle
 * readiness checks free of I/O, and legacy transactions on their old path. */
export function checkInstalledContentSafety(db) {
  if (refused.has(contentSafetyConnection(db))) fail('unsupported_database');
  if (layouts.get(contentSafetyConnection(db))?.layout.suppressionRevision) installedContentLayout(db);
}

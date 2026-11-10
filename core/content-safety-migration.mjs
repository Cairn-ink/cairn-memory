import { createHash, randomUUID } from 'node:crypto';
import { sqliteFileStat } from './sqlite-journal-probe.mjs';
import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { attestContentSafety, contentSafetyDDL, verifyContentSafetyDDL } from './content-safety-schema.mjs';
import { safetyPhysicalVersion } from './content-safety-layout.mjs';
import { validateContextProductLayout } from './context-product-schema.mjs';
import { writeContentSuppressionInside, suppressionEpoch } from './content-suppression-storage.mjs';
import { fail, identifier } from './validation.mjs';
import { cardLineageDDL, authoredInvalidationDDL } from './card-lineage-schema.mjs';
import { exactCardInside, legacyCardSources, sealCardBodyInside, verifyCardLineageCommitmentsInside } from './card-lineage.mjs';
import { contentSafetyObservations } from './content-safety-observations.mjs';
import { classifyCardBodySafetyV1 } from './content-safety-classifier.mjs';

const boundary = row => ({ ownerId: row.owner_id, scope: row.scope, projectId: row.project_id });
const quote = name => '"' + name.replaceAll('"', '""') + '"';
const encode = value => JSON.stringify(value, (_, item) => typeof item === 'bigint' ? ['integer', String(item)] :
  item instanceof Uint8Array ? ['blob', Buffer.from(item).toString('hex')] : item);
/** Complete logical inventory for offline maintenance or pristine creation. Includes
 * accounting/authority and sqlite_sequence; no derived-sidecar reset or restore. */
export function contentSafetyInventory(db) {
  const hash = createHash('sha256');
  const schema = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
  hash.update(encode(schema));
  for (const row of schema.filter(row => row.type === 'table')) {
    const statement = db.prepare(`SELECT * FROM ${quote(row.name)}`); statement.setReadBigInts(true);
    const values = statement.all().map(encode).sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
    hash.update(encode([row.name, values]));
  }
  hash.update(encode([db.prepare('PRAGMA application_id').get(), db.prepare('PRAGMA user_version').get()]));
  return hash.digest('hex');
}
function verifyIntegrity(db) {
  const rows = db.prepare('PRAGMA integrity_check').all();
  if (rows.length !== 1 || rows[0].integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) fail('unsupported_database');
}
function retainedFacts(db, base) {
  const facts = [];
  const add = (row, kind, key, extra = {}) => facts.push({ namespace: boundary(row), kind, key,
    reason: 'purge', actionId: 'safety-migration', origin: 'canonical-tombstone', ...extra });
  for (const row of db.prepare('SELECT id,owner_id,scope,project_id FROM memories WHERE deleted=1').all()) add(row, 'memory', row.id);
  // Retained reject results establish purge. A bare deleted row does not prove
  // user intent, so recovered rows use conservative purge throughout.
  if (base >= 20) {
    for (const row of db.prepare("SELECT id,owner_id,scope,project_id FROM card_notes WHERE state='deleted'").all()) add(row, 'submitted-note', row.id);
    for (const row of db.prepare("SELECT id,owner_id,scope,project_id FROM private_cards WHERE state IN ('deleted','cancelled')").all()) add(row, 'card', row.id);
  }
  if (base >= 26) for (const row of db.prepare(`SELECT c.owner_id,c.scope,c.project_id,e.*,m.total_units FROM raw_source_exclusions e
    LEFT JOIN raw_conversations c ON c.id=e.conversation_id
    LEFT JOIN raw_messages m ON m.conversation_id=e.conversation_id AND m.message_id=e.message_id`).all()) {
    if (!row.owner_id || ![row.start,row.end,row.total_units].every(Number.isSafeInteger) ||
        row.start < 0 || row.end <= row.start || row.end > row.total_units) fail('unsupported_database');
    add(row, 'raw', row.conversation_id, { matchMode: 'span', messageId: row.message_id, start: row.start, end: row.end });
  }
  if (base >= 27) for (const row of db.prepare(`SELECT DISTINCT owner_id,scope,project_id,entity_type,entity_id,action_id
    FROM raw_deletion_effects WHERE entity_type='conversation'`).all()) {
    add(row, row.entity_type === 'conversation' ? 'raw' : 'memory', row.entity_id, { actionId: row.action_id });
  }
  // Fingerprint-only suppressed rows also represent ordinary supersession and
  // cannot prove a privacy target. Missing hard-deleted ids are never invented.
  const order = fact => [fact.namespace.ownerId, fact.namespace.scope, fact.namespace.projectId, fact.kind,
    fact.key, fact.key, fact.matchMode ?? 'incarnation', fact.sourceVersion ?? '*', fact.messageId ?? '',
    fact.start ?? 0, fact.end ?? 0, fact.reason, fact.actionId];
  return facts.sort((a, b) => {
    const left = order(a), right = order(b);
    for (let i = 0; i < left.length; i++) {
      const compared = typeof left[i] === 'number' ? left[i] - right[i] : Buffer.compare(Buffer.from(left[i]), Buffer.from(right[i]));
      if (compared) return compared;
    }
    return 0;
  });
}
function verifyPopulation(db, expectedFacts) {
  const actual = db.prepare('SELECT owner_id,fact_id,epoch_hi,epoch_lo FROM content_suppressions ORDER BY owner_id,epoch_hi,epoch_lo').all();
  if (actual.length !== expectedFacts.size || actual.some(row => !expectedFacts.has(row.owner_id + ':' + row.fact_id))) fail('unsupported_database');
  const epochs = new Map();
  for (const row of actual) {
    const next = (epochs.get(row.owner_id) ?? 0n) + 1n;
    if (suppressionEpoch(row) !== next) fail('unsupported_database');
    epochs.set(row.owner_id, next);
  }
  const counters = db.prepare('SELECT * FROM owner_suppression_epochs').all();
  if (counters.length !== epochs.size || counters.some(row => epochs.get(row.owner_id) !== suppressionEpoch(row))) fail('unsupported_database');
  // Validate every retained reservation's root/child identity and namespace.
  const reservations = db.prepare('SELECT * FROM content_identity_reservations').all();
  for (const row of reservations) {
    if (row.kind === 'raw-message') {
      const key = JSON.parse(row.stable_key);
      if (key.length !== 2 || key[0] !== row.incarnation || encode(key) !== row.stable_key ||
          !db.prepare('SELECT 1 FROM raw_messages WHERE conversation_id=? AND message_id=?').get(...key)) fail('unsupported_database');
    } else if (row.stable_key !== row.incarnation) fail('unsupported_database');
  }
  verifyIntegrity(db);
}
/** Shared atomic installer for offline migration and explicit new-store creation.
 * The caller owns the transaction and inventories the pristine legacy layout. */
export function installContentSafetyInside(db, base, inventory, seeds = []) {
  if (!db.isTransaction) fail('storage_error');
  const physical = safetyPhysicalVersion(base) + (attestContentSafety(db).relationsRevision*100), factIds = new Set();
  validateContextProductLayout(db); verifyIntegrity(db);
  db.exec(contentSafetyDDL(base));
  verifyContentSafetyDDL(db, physical);
  const domain = randomUUID(), migrationId = randomUUID(), recordedAt = new Date().toISOString();
  for (const seed of seeds) {
    const fact = writeContentSuppressionInside(db, { ...seed, recordedAt }, true);
    factIds.add(seed.namespace.ownerId + ':' + fact.factId);
  }
  verifyPopulation(db, factIds);
  db.prepare("INSERT INTO content_safety_control VALUES(1,?,1,0,'complete',?,?,?)").run(base, domain, migrationId, inventory);
  db.exec(`PRAGMA user_version=${physical}`);
  validateContextProductLayout(db);
  attestContentSafety(db, physical);
  verifyPopulation(db, factIds);
  return Object.freeze({ physical, base, suppressionRevision: 1, cardLineageRevision: 0,
    storeId: db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get().store_id,
    suppressionDomain: domain, facts: factIds.size, historicalCoverage: 'recoverable-tombstones-only' });
}
function offlineFile(path) {
  if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) fail('invalid_path');
  const stat = sqliteFileStat(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.mode & 0o077n) fail('unsafe_database_file');
  for (const suffix of ['-wal', '-shm', '-journal']) {
    try { sqliteFileStat(path + suffix); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    fail('unsafe_database_file');
  }
  return stat;
}
function backupInventory(path) {
  // The child alone opens backup SQLite; no raw file descriptor on either DB
  // is opened/closed by the SQLite-holding maintenance process.
  const script = `const { DatabaseSync } = await import('node:sqlite');
import { contentSafetyInventory } from ${JSON.stringify(import.meta.url)};
const db = new DatabaseSync(process.argv[1], { readOnly: true });
try { db.exec('PRAGMA query_only=ON; PRAGMA trusted_schema=OFF; BEGIN');
if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw Error('invalid_backup');
console.log(contentSafetyInventory(db)); db.exec('COMMIT'); } finally { db.close(); }`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script, path], { encoding: 'utf8', timeout: 30000, maxBuffer: 4096 });
  if (result.status !== 0 || result.error || !/^[0-9a-f]{64}\n$/.test(result.stdout)) fail('unsupported_database');
  return result.stdout.trim();
}
/** Explicit maintenance only. These assertions are supplied by the operator
 * controlling admissions and all old processes; SQLite cannot revoke idle handles.
 * Failure leaves admissions closed. A backup is never restored to serving. */
export async function migrateContentSafety(input) { return migrateSafety(input, false); }

/** Latest offline maintenance target; the S2h installer and its cells stay frozen. */
export async function migrateReceiptEventTime(input) { return migrateSafety(input, true); }
// This core maintenance API is deliberately absent from installer commands.
// Installer enablement still requires the local legacy-policy decision.
export async function migrateCardLineage(input) { return migrateSafety(input, false, true); }

async function migrateSafety({ path, backupPath, expected, quiescence }, eventTime, lineage = false) {
  if (!quiescence || ['admissionsClosed','writersStopped','readersDrained','oldHandlesClosed'].some(key => quiescence[key] !== true)) fail('invalid_input');
  const storeId = identifier(expected?.storeId), base = expected?.base;
  safetyPhysicalVersion(base);
  if(lineage && ![23,33].includes(base))fail('unsupported_database');
  const source = offlineFile(path), backup = offlineFile(backupPath);
  if (source.dev === backup.dev && source.ino === backup.ino) fail('invalid_input');
  const inventory = backupInventory(backupPath);
  const [{ DatabaseSync }, { transaction, STORAGE_BUSY_TIMEOUT_MS }] = await Promise.all([import('node:sqlite'), import('./database.mjs')]);
  const uri = pathToFileURL(path); uri.searchParams.set('mode', 'rw');
  const db = new DatabaseSync(uri.href, { timeout: STORAGE_BUSY_TIMEOUT_MS });
  try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA trusted_schema=OFF;');
    return transaction(db, () => {
      const current = sqliteFileStat(path);
      if (source.dev !== current.dev || source.ino !== current.ino || db.prepare('PRAGMA journal_mode').get().journal_mode !== 'delete') fail('unsafe_database_file');
      const layout = attestContentSafety(db);
      if ((!lineage && (!eventTime && layout.suppressionRevision || layout.attestedFeatures)) || layout.base !== base ||
          db.prepare('PRAGMA application_id').get().application_id !== 0x43414952 ||
          db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id !== storeId) fail('unsupported_database');
      validateContextProductLayout(db, layout); verifyIntegrity(db);
      if (contentSafetyInventory(db) !== inventory) fail('unsupported_database');
      const observations=lineage?contentSafetyObservations(db,{scanRows:250000,scanBytes:128*1024*1024},()=>{},layout):null;
      if(lineage && layout.suppressionRevision && db.prepare('SELECT suppression_domain FROM content_safety_control').get()?.suppression_domain!==expected.suppressionDomain)fail('unsupported_database');
      const installed = layout.suppressionRevision ? undefined :
        installContentSafetyInside(db, layout.base, inventory, retainedFacts(db, layout.base));
      if(lineage)return installCardLineageInside(db,base,inventory,observations);
      if (!eventTime) return installed;
      const physical = installReceiptEventTimeInside(db, base);
      return Object.freeze({ ...(installed ?? { base, storeId, suppressionRevision: 1, cardLineageRevision: 0 }),
        physical, receiptEventTime: true });
    });
  } finally { db.close(); }
}

function installCardLineageInside(db,base,inventory,snapshot) {
  const relationOffset=attestContentSafety(db).relationsRevision*100;
  const control=db.prepare('SELECT * FROM content_safety_control').get();
  if(control.card_lineage_revision!==0)fail('unsupported_database');
  const identity=db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  // A conflicting owner/action cannot be represented by the complete package.
  if(db.prepare('SELECT 1 FROM card_operations GROUP BY owner_id,action_id HAVING count(*)>1 LIMIT 1').get())fail('action_conflict');
  db.exec(`DROP TRIGGER safety_control_insert; DROP TRIGGER safety_control_delete; DROP TRIGGER safety_control_update;
    ALTER TABLE content_safety_control RENAME TO lineage_control_before;`);
  const declarations=contentSafetyDDL(base,control.receipt_event_time===1,true);
  db.exec(declarations.match(/CREATE TABLE content_safety_control[\s\S]*?;/)[0]);
  db.prepare("INSERT INTO content_safety_control VALUES(1,?,1,0,?,'complete',?,?,?)").run(base,
    control.receipt_event_time??0,control.suppression_domain,control.migration_id,control.inventory_digest);
  db.exec('DROP TABLE lineage_control_before');
  for(const sql of declarations.match(/CREATE TRIGGER safety_control_(?:insert|delete|update)[\s\S]*?END;/g))db.exec(sql);
  // Allocate draft numbering before installing the body rollback guard.
  for(const observation of snapshot.observations) {
    const ns={ownerId:observation.body.identity.ownerId,scope:observation.body.identity.scope,
      projectId:observation.body.identity.projectId||null};
    const row=exactCardInside(db,ns,observation.body.identity.key);
    if(!['draft','confirmed'].includes(row.state))fail('unsupported_database');
    if(row.state==='confirmed'&&(!Number.isSafeInteger(row.body_revision)||row.body_revision<1))fail('unsupported_database');
    if(row.state==='draft'&&row.body_revision===null)db.prepare('UPDATE private_cards SET body_revision=1 WHERE id=?').run(row.id);
    else if(!Number.isSafeInteger(row.body_revision)||row.body_revision<1)fail('unsupported_database');
  }
  db.exec(cardLineageDDL);
  db.exec('DROP TRIGGER card_memory_revision_invalidation');db.exec(authoredInvalidationDDL(base));
  const counts={complete:0,unknown:0,knownSuppressed:0};
  for(const observation of snapshot.observations) {
    const classification=classifyCardBodySafetyV1(observation);
    counts[classification.status==='known-suppressed'?'knownSuppressed':classification.status]++;
    const ns={ownerId:observation.body.identity.ownerId,scope:observation.body.identity.scope,projectId:observation.body.identity.projectId||null};
    sealCardBodyInside(db,{identity,namespace:ns,cardId:observation.body.identity.key,
      sources:legacyCardSources(identity,observation),newBody:true,legacy:true});
  }
  db.prepare('UPDATE content_safety_control SET card_lineage_revision=1,migration_id=?,inventory_digest=? WHERE singleton=1')
    .run(randomUUID(),inventory);
  const physical={23:52,33:53}[base]+relationOffset;db.exec(`PRAGMA user_version=${physical}`);
  verifyContentSafetyDDL(db,physical);attestContentSafety(db,physical);validateContextProductLayout(db);
  verifyIntegrity(db);
  for(const observation of snapshot.observations) {
    const target=observation.body.identity,ns={ownerId:target.ownerId,scope:target.scope,projectId:target.projectId||null};
    const verified=verifyCardLineageCommitmentsInside(db,identity,ns,target.key);
    if(verified.header.completeness!=='unknown'||verified.header.origin!=='legacy-unknown')fail('unsupported_database');
  }
  const population=db.prepare('SELECT count(*) n FROM card_body_provenance').get().n;
  if(population!==snapshot.observations.length||db.prepare(`SELECT 1 FROM private_cards c WHERE state IN ('draft','confirmed')
    AND NOT EXISTS(SELECT 1 FROM card_body_provenance p WHERE (p.owner_id,p.scope,p.project_id,p.card_id,p.body_revision)=
      (c.owner_id,c.scope,c.project_id,c.id,c.body_revision)) LIMIT 1`).get())fail('unsupported_database');
  return Object.freeze({physical,base,storeId:identity.storeId,suppressionDomain:control.suppression_domain,
    suppressionRevision:1,cardLineageRevision:1,counts});
}

/** Internal installer; caller owns the offline migration transaction. */
export function installReceiptEventTimeInside(db, base) {
  const inherited=attestContentSafety(db);
  if (!db.isTransaction || inherited.physical !== safetyPhysicalVersion(base)+(inherited.relationsRevision*100)) fail('unsupported_database');
  const physical = { 18: 51, 23: 52, 33: 53 }[base]+(inherited.relationsRevision*100);
  // Add the attested flag atomically, preserving every existing control value.
  db.exec('ALTER TABLE receipts ADD COLUMN occurred_at TEXT; DROP TRIGGER safety_receipt_identity;');
  db.exec(`DROP TRIGGER safety_control_insert; DROP TRIGGER safety_control_delete; DROP TRIGGER safety_control_update;
    ALTER TABLE content_safety_control RENAME TO event_time_control_before;`);
  const declarations = contentSafetyDDL(base, true, true);
  db.exec(declarations.match(/CREATE TABLE content_safety_control[\s\S]*?;/)[0]);
  db.exec(`INSERT INTO content_safety_control SELECT singleton,base_layout,suppression_revision,card_lineage_revision,1,
      migration_state,suppression_domain,migration_id,inventory_digest FROM event_time_control_before;
    DROP TABLE event_time_control_before;`);
  for (const trigger of declarations.match(/CREATE TRIGGER safety_control_(?:insert|delete|update)[\s\S]*?END;/g)) db.exec(trigger);
  const trigger = contentSafetyDDL(base, true).match(/CREATE TRIGGER safety_receipt_identity[\s\S]*?END;/)[0];
  db.exec(trigger);
  verifyContentSafetyDDL(db, physical);
  db.exec(`PRAGMA user_version=${physical}`);
  validateContextProductLayout(db);
  attestContentSafety(db, physical);
  verifyIntegrity(db);
  return physical;
}

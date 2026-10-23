import { types } from 'node:util';
import { storeFenceOption,pinStoreFile,assertStoreIdentity,noncreatingStoreURI } from './store-fence.mjs';
import { migrateMethodPrerequisites } from './method-package-migration.mjs';
import { randomBytes, randomUUID } from "node:crypto";
import { installRawDeletion, RAW_DELETION_SCHEMA_VERSION } from './raw-deletion-schema.mjs';
import { installRawSources, RAW_SOURCE_SCHEMA_VERSION } from './raw-source-schema.mjs';
import { assertNoLocalAuthority, installLocalAuthority, validateLocalAuthority, validateRawSourcePrerequisites, LOCAL_AUTHORITY_SCHEMA_VERSION } from './local-authority-schema.mjs';
import { closeSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { existingStoreOption, existingStorePath, validateExistingStore } from './existing-store.mjs';
import { migrateVersion17, CONFIRMATION_SCHEMA_VERSION } from './confirmation-schema.mjs';
import { fail } from "./validation.mjs";
import { installPrivateCards, installCardMemorySources, PRIVATE_CARD_SCHEMA_VERSION } from './private-card-schema.mjs';
import { installPrivateEvidence, PRIVATE_EVIDENCE_SCHEMA_VERSION } from './private-evidence-schema.mjs';
import { installPrivateOrganization, PRIVATE_ORGANIZATION_SCHEMA_VERSION } from './private-organization-schema.mjs';
import { migrateVersion6, installIndexReaders } from "./index-schema.mjs";
import { migrateVersion8 } from './ordered-capture-schema.mjs';
import { migrateVersion9 } from './claim-qualification-schema.mjs';
import { migrateVersion10 } from './qualified-transition-schema.mjs';
import { migrateVersion11 } from './rationale-schema.mjs';
import { migrateVersion12 } from './staged-evidence-schema.mjs';
import { migrateVersion13 } from './classification-journal-schema.mjs';
import { installRawJournal, RAW_SCHEMA_VERSION, installRawCapture, RAW_CAPTURE_SCHEMA_VERSION } from './raw-schema.mjs';
import { installRawLineage, RAW_LINEAGE_SCHEMA_VERSION } from './raw-lineage-schema.mjs';

import { migrateVersion14, migrateVersion15, migrateVersion16 } from './episode-schema.mjs';

export const STORAGE_BUSY_TIMEOUT_MS = 5_000;
export const isStorageBusy = error => error?.code === 'ERR_SQLITE_ERROR' &&
  Number.isInteger(error.errcode) && [5, 6].includes(error.errcode & 0xff);

export const APPLICATION_ID = 0x43414952;
const VERSION = CONFIRMATION_SCHEMA_VERSION;
// Existing layouts accepted without an upgrade by the ordinary opener.
export const READ_SCHEMA_VERSIONS = Object.freeze([VERSION, 20, PRIVATE_CARD_SCHEMA_VERSION,
  PRIVATE_EVIDENCE_SCHEMA_VERSION, PRIVATE_ORGANIZATION_SCHEMA_VERSION, LOCAL_AUTHORITY_SCHEMA_VERSION, 30]);

function createVersion3(db) {
  db.exec(`
    CREATE TABLE memories (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      content TEXT,
      kind TEXT NOT NULL,
      origin TEXT NOT NULL CHECK (origin IN ('explicit','agent-inferred')),
      confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
      revision INTEGER NOT NULL CHECK (revision > 0),
      deleted INTEGER NOT NULL DEFAULT 0 CHECK (deleted IN (0,1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0)),
      CHECK ((deleted = 0 AND content IS NOT NULL) OR (deleted = 1 AND content IS NULL))
    ) STRICT;
    CREATE UNIQUE INDEX active_identity ON memories(owner_id, scope, project_id, fingerprint)
      WHERE deleted = 0;
    CREATE INDEX namespace_memories ON memories(
      owner_id, scope, project_id, deleted, updated_at DESC, id);
    CREATE TABLE receipts (
      id TEXT NOT NULL UNIQUE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      receipt_key TEXT NOT NULL,
      client TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (memory_id, receipt_key)
    ) STRICT;
    CREATE INDEX memory_receipts ON receipts(memory_id, created_at, id);
    CREATE TABLE suppressed (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL,
      project_id TEXT NOT NULL,
      fingerprint TEXT NOT NULL,
      PRIMARY KEY (owner_id, scope, project_id, fingerprint)
    ) STRICT;
    CREATE TABLE namespace_epochs (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      epoch INTEGER NOT NULL CHECK (epoch >= 1),
      PRIMARY KEY (owner_id, scope, project_id)
    ) STRICT;
    CREATE TABLE store_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      store_id TEXT NOT NULL UNIQUE,
      cursor_secret TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare(`INSERT INTO store_metadata(singleton, store_id, cursor_secret)
    VALUES (1, ?, ?)`).run(randomUUID(), randomBytes(32).toString("hex"));
}

function migrateVersion1(db) {
  db.exec(`
    ALTER TABLE receipts RENAME TO receipts_v1;
    CREATE TABLE receipts (
      id TEXT NOT NULL UNIQUE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      receipt_key TEXT NOT NULL,
      client TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('user','assistant')),
      excerpt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (memory_id, receipt_key)
    ) STRICT;
  `);
  const insert = db.prepare(`INSERT INTO receipts
    (id, memory_id, receipt_key, client, session_id, event_id, role, excerpt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  for (const receipt of db.prepare("SELECT * FROM receipts_v1").all()) {
    insert.run(randomUUID(), receipt.memory_id, receipt.receipt_key, receipt.client,
      receipt.session_id, receipt.event_id, receipt.role, receipt.excerpt, receipt.created_at);
  }
  db.exec(`
    DROP TABLE receipts_v1;
    DROP INDEX namespace_memories;
    CREATE INDEX namespace_memories ON memories(
      owner_id, scope, project_id, deleted, updated_at DESC, id);
    CREATE INDEX memory_receipts ON receipts(memory_id, created_at, id);
    CREATE TABLE namespace_epochs (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      epoch INTEGER NOT NULL CHECK (epoch >= 1),
      PRIMARY KEY (owner_id, scope, project_id)
    ) STRICT;
    INSERT INTO namespace_epochs(owner_id, scope, project_id, epoch)
      SELECT DISTINCT owner_id, scope, project_id, 1 FROM memories;
    CREATE TABLE store_metadata (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      store_id TEXT NOT NULL UNIQUE,
      cursor_secret TEXT NOT NULL
    ) STRICT;
  `);
  db.prepare(`INSERT INTO store_metadata(singleton, store_id, cursor_secret)
    VALUES (1, ?, ?)`).run(randomUUID(), randomBytes(32).toString("hex"));
}

function migrateVersion3(db) {
  db.exec(`
    ALTER TABLE memories ADD COLUMN filing_status TEXT NOT NULL DEFAULT 'unfiled'
      CHECK (filing_status IN ('filed','unfiled'));
    CREATE TABLE mocs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      level INTEGER NOT NULL CHECK (level IN (1,2)),
      title TEXT NOT NULL,
      canonical_title TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0))
    ) STRICT;
    CREATE UNIQUE INDEX namespace_moc_titles ON mocs(
      owner_id, scope, project_id, level, canonical_title);
    CREATE INDEX namespace_mocs ON mocs(
      owner_id, scope, project_id, level, canonical_title, id);
    CREATE TABLE moc_title_sources (
      moc_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      memory_revision INTEGER NOT NULL CHECK (memory_revision > 0),
      PRIMARY KEY (moc_id, memory_id)
    ) STRICT;
    CREATE INDEX memory_title_sources ON moc_title_sources(memory_id, moc_id);
    CREATE TABLE moc_memory_refs (
      moc_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      moc_revision INTEGER NOT NULL CHECK (moc_revision > 0),
      memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      memory_revision INTEGER NOT NULL CHECK (memory_revision > 0),
      PRIMARY KEY (moc_id, memory_id)
    ) STRICT;
    CREATE INDEX memory_moc_refs ON moc_memory_refs(memory_id, moc_id);
    CREATE TABLE moc_edges (
      parent_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      parent_revision INTEGER NOT NULL CHECK (parent_revision > 0),
      child_id TEXT NOT NULL REFERENCES mocs(id) ON DELETE CASCADE,
      child_revision INTEGER NOT NULL CHECK (child_revision > 0),
      PRIMARY KEY (parent_id, child_id),
      CHECK (parent_id != child_id)
    ) STRICT;
    CREATE INDEX child_moc_edges ON moc_edges(child_id, parent_id);
  `);
}

function migrateVersion4(db) {
  db.exec(`
    CREATE TABLE admission_claims (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      client TEXT NOT NULL,
      event_id TEXT NOT NULL,
      payload_digest TEXT NOT NULL CHECK (
        length(payload_digest) = 64 AND payload_digest NOT GLOB '*[^0-9a-f]*'),
      state TEXT NOT NULL CHECK (state IN ('pending','completed')),
      token TEXT,
      lease_expires_at INTEGER,
      memory_ids TEXT,
      suppressed_count INTEGER,
      PRIMARY KEY (owner_id, scope, project_id, client, event_id),
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0)),
      CHECK ((state = 'pending' AND token IS NOT NULL AND lease_expires_at IS NOT NULL
        AND memory_ids IS NULL AND suppressed_count IS NULL) OR
        (state = 'completed' AND token IS NULL AND lease_expires_at IS NULL
        -- Five opaque IDs of up to 200 characters, doubled by JSON escaping,
        -- plus quotes, commas and brackets (including IDs preserved by migration).
        AND memory_ids IS NOT NULL AND length(memory_ids) <= 2016
        AND suppressed_count IS NOT NULL AND suppressed_count BETWEEN 0 AND 5))
    ) STRICT;
  `);
}

function migrateVersion5(db) {
  db.exec(`
    CREATE TABLE memory_conflicts (
      left_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      left_revision INTEGER NOT NULL CHECK (left_revision > 0),
      right_memory_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
      right_revision INTEGER NOT NULL CHECK (right_revision > 0),
      relation TEXT NOT NULL CHECK (relation = 'contradicts'),
      source TEXT NOT NULL CHECK (source IN ('explicit-hint','inferred-hint')),
      PRIMARY KEY (left_memory_id, left_revision, right_memory_id, right_revision, relation, source),
      CHECK (left_memory_id < right_memory_id)
    ) STRICT;
    CREATE INDEX right_memory_conflicts ON memory_conflicts(right_memory_id);
  `);
}

function migrateVersion7(db) {
  db.exec(`ALTER TABLE memories ADD COLUMN currentness TEXT NOT NULL DEFAULT 'current'
    CHECK (currentness IN ('current','historical'));
    CREATE TABLE memory_supersessions (
      owner_id TEXT NOT NULL,
      scope TEXT NOT NULL CHECK (scope IN ('personal','project')),
      project_id TEXT NOT NULL,
      previous_memory_id TEXT PRIMARY KEY REFERENCES memories(id),
      previous_revision INTEGER NOT NULL CHECK (previous_revision > 0),
      replacement_memory_id TEXT NOT NULL REFERENCES memories(id),
      replacement_revision INTEGER NOT NULL CHECK (replacement_revision > 0),
      -- Four opaque 200-unit IDs, including worst-case JSON escaping/delimiters.
      receipt_ids TEXT NOT NULL CHECK (length(receipt_ids) <= 1613),
      CHECK (previous_memory_id != replacement_memory_id),
      CHECK ((scope = 'personal' AND project_id = '') OR
             (scope = 'project' AND length(project_id) > 0))
    ) STRICT;
    CREATE INDEX replacement_supersessions ON memory_supersessions(replacement_memory_id);`);
  installIndexReaders(db, true);
}

// A read callback is internal, synchronous work on this connection only: no
// await, host callbacks, nested transactions, transaction control or live cursors.
// Return fully materialized arrays/records, never opaque containers or handles.
const activeReads = new WeakSet(), discardedConnections = new WeakSet();
export const isConnectionDiscarded = db => discardedConnections.has(db);
function materializedRead(value, seen = new Set()) {
  if (typeof value === 'function') fail('storage_error');
  if (!value || typeof value !== 'object') return;
  if (types.isPromise(value)) fail('storage_error');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype) fail('storage_error');
  for (let prototype = value; prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const key of ['next', 'then']) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, key);
      if (descriptor && (!Object.hasOwn(descriptor, 'value') || typeof descriptor.value === 'function')) fail('storage_error');
    }
  }
  if (seen.has(value)) return;
  seen.add(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    const descriptor = descriptors[key];
    if (!Object.hasOwn(descriptor, 'value')) fail('storage_error');
    materializedRead(descriptor.value, seen);
  }
}
export function readTransaction(db, work) {
  if (discardedConnections.has(db) || !db.isOpen) fail('store_closed');
  if (activeReads.has(db) || db.isTransaction || typeof work !== 'function' ||
      types.isAsyncFunction(work) || types.isGeneratorFunction(work)) fail('storage_error');
  activeReads.add(db);
  let saved, began = false, attempted = false, value, error, failed = false, cleanupError, cleanupFailed = false, unsafeResult = false;
  try {
    saved = db.prepare('PRAGMA query_only').get().query_only;
    db.exec('PRAGMA query_only=ON');
    attempted = true;
    db.exec('BEGIN');
    began = true;
    value = work();
    try { materializedRead(value); } catch (failure) { unsafeResult = true; throw failure; }
    if (!db.isTransaction) fail('storage_error');
    db.exec('COMMIT');
    began = false;
  } catch (failure) {
    error = failure; failed = true;
    // Also covers a BEGIN that took effect before an instrumentation failure.
    began ||= attempted && db.isTransaction;
  } finally {
    if (began && db.isTransaction) {
      try { db.exec('ROLLBACK'); } catch (failure) { cleanupError = failure; cleanupFailed = true; }
    }
    if (saved !== undefined) {
      try { db.exec('PRAGMA query_only=' + (saved ? 'ON' : 'OFF')); }
      catch (failure) { if (!cleanupFailed) cleanupError = failure; cleanupFailed = true; }
    }
    if (cleanupFailed || unsafeResult) {
      discardedConnections.add(db);
      try { db.close(); } catch { /* Poisoned even if native close fails. */ }
    }
    activeReads.delete(db);
  }
  if (cleanupFailed) throw cleanupError;
  if (failed) throw error;
  return value;
}

export function transaction(db, work, check) {
  if (activeReads.has(db) || discardedConnections.has(db)) fail('storage_error');
  check?.();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = work();
    check?.();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    db.exec("ROLLBACK");
    if (error?.code === 'ERR_SQLITE_ERROR' && error.message === 'card_dependency_limit_reached') {
      fail('dependency_limit_reached');
    }
    throw error;
  }
}

export function openDatabase(path, { privateCards = false, rawConversations = false, rawCapture = false, rawLineage = false, rawDeletion = false, rawSources = false, localControls = false, methodPackages = false, existingStore, storeFence } = {}) {
  if ([rawConversations, rawCapture, rawLineage, rawDeletion, rawSources, localControls].some(value => typeof value !== 'boolean')) fail('invalid_input');
  rawDeletion ||= rawSources || localControls;
  rawLineage ||= rawDeletion;
  rawCapture ||= rawLineage;
  rawConversations ||= rawCapture;
  if (storeFence !== undefined && existingStore !== undefined) fail('invalid_input');
  const fence = storeFence === undefined ? undefined : storeFenceOption(storeFence);
  if (existingStore !== undefined) {
    const option = existingStoreOption(existingStore), location = existingStorePath(path);
    const db = new DatabaseSync(location.uri, { timeout: STORAGE_BUSY_TIMEOUT_MS });
    try {
      location.check();
      db.exec('PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;');
      validateExistingStore(db, option);
      if (methodPackages && db.prepare('PRAGMA user_version').get().user_version !== 30) fail('unsupported_database');
      location.check();
      return db;
    } catch (error) {
      try { db.close(); } catch { /* Preserve the construction failure. */ }
      throw error;
    }
  }
  if (typeof path !== "string" || !path.trim() || path.includes("\0")) fail("invalid_path");
  let pin;
  if (fence) {
    pin = pinStoreFile(path, fence);
  } else if (path !== ":memory:") {
    path = resolve(path);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    try {
      closeSync(openSync(path, "ax", 0o600));
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = lstatSync(path);
    if (!stat.isFile() || (process.platform !== "win32" && (stat.mode & 0o077))) {
      fail("unsafe_database_file");
    }
  }
  let db;
  try {
    // URI mode=rw is mandatory here: no mkdir/open(ax), no creation fallback.
    db = new DatabaseSync(fence ? noncreatingStoreURI(path) : path, { timeout: STORAGE_BUSY_TIMEOUT_MS });
    db.exec("PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;");
    transaction(db, () => {
      if (fence) {
        // Before initialize() and all migration/schema or application writes.
        pin.check();
        assertStoreIdentity(db, fence);
      }
      function initialize() {
      const appId = db.prepare("PRAGMA application_id").get().application_id;
      const version = db.prepare("PRAGMA user_version").get().user_version;
      if (methodPackages && !(appId === 0 && version === 0 && db.prepare('SELECT count(*) AS n FROM sqlite_master').get().n === 0) &&
          !(appId === APPLICATION_ID && [18,20,21,22,23,24,25,26,27,28,29,30].includes(version))) fail('unsupported_database');
      if (appId === APPLICATION_ID && version === 30) {
        validateExistingStore(db, { storeId: db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id });
        return;
      }
      if (appId === APPLICATION_ID && [RAW_SCHEMA_VERSION, RAW_CAPTURE_SCHEMA_VERSION, RAW_LINEAGE_SCHEMA_VERSION, RAW_DELETION_SCHEMA_VERSION, RAW_SOURCE_SCHEMA_VERSION, LOCAL_AUTHORITY_SCHEMA_VERSION].includes(version)) {
        if (version < LOCAL_AUTHORITY_SCHEMA_VERSION) assertNoLocalAuthority(db);
        for (const name of ['raw_conversations','raw_messages','raw_parts','raw_events','raw_owner_usage','raw_capture_controls',
          'private_cards','card_notes','card_applicability_reviews','evidence_mappings']) {
          if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) fail('unsupported_database');
        }
        if (version >= RAW_CAPTURE_SCHEMA_VERSION) {
          for (const name of ['raw_capture_events', 'raw_session_fences']) {
            if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) fail('unsupported_database');
          }
        } else if (rawCapture) {
          installRawCapture(db);
          db.exec(`PRAGMA user_version = ${RAW_CAPTURE_SCHEMA_VERSION};`);
        }
        if (version >= RAW_LINEAGE_SCHEMA_VERSION) {
          for (const name of ['raw_source_maps','raw_receipt_lineage','raw_receipt_origins','raw_exclusion_clocks','raw_source_exclusions']) {
            if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) fail('unsupported_database');
          }
        } else if (rawLineage) {
          installRawLineage(db);
          db.exec(`PRAGMA user_version = ${RAW_LINEAGE_SCHEMA_VERSION};`);
        }
        if (version >= RAW_DELETION_SCHEMA_VERSION) {
          for (const name of ['raw_deletion_actions','raw_job_sources','raw_closed_jobs','raw_deletion_effects']) {
            if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name)) fail('unsupported_database');
          }
        } else if (rawDeletion) {
          installRawDeletion(db);
          db.exec(`PRAGMA user_version = ${RAW_DELETION_SCHEMA_VERSION};`);
        }
        if (version >= RAW_SOURCE_SCHEMA_VERSION) {
          validateRawSourcePrerequisites(db);
        } else if (rawSources || localControls) {
          installRawSources(db);
          db.exec(`PRAGMA user_version = ${RAW_SOURCE_SCHEMA_VERSION};`);
        }
        if (version === LOCAL_AUTHORITY_SCHEMA_VERSION) validateLocalAuthority(db);
        else if (localControls) {
          installLocalAuthority(db);
          db.exec(`PRAGMA user_version = ${LOCAL_AUTHORITY_SCHEMA_VERSION};`);
        }
        return;
      }
      function upgrade() {
      if (appId === APPLICATION_ID && version === PRIVATE_ORGANIZATION_SCHEMA_VERSION) return;
      if (appId === APPLICATION_ID && version === PRIVATE_EVIDENCE_SCHEMA_VERSION) {
        if (privateCards || rawConversations) {
          installPrivateOrganization(db);
          db.exec(`PRAGMA user_version = ${PRIVATE_ORGANIZATION_SCHEMA_VERSION};`);
        }
        return;
      }
      if (appId === APPLICATION_ID && version === PRIVATE_CARD_SCHEMA_VERSION) {
        if (privateCards || rawConversations) {
          installPrivateEvidence(db);
          installPrivateOrganization(db);
          db.exec(`PRAGMA user_version = ${PRIVATE_ORGANIZATION_SCHEMA_VERSION};`);
        }
        return;
      }
      if (appId === APPLICATION_ID && version === 20) {
        if (privateCards || rawConversations) {
          installCardMemorySources(db);
          installPrivateEvidence(db);
          installPrivateOrganization(db);
          db.exec(`PRAGMA user_version = ${PRIVATE_ORGANIZATION_SCHEMA_VERSION};`);
        }
        return;
      }
      if (appId === APPLICATION_ID && version === VERSION) {
        if (privateCards || rawConversations) {
          installPrivateCards(db);
          installCardMemorySources(db);
          installPrivateEvidence(db);
          installPrivateOrganization(db);
          db.exec(`PRAGMA user_version = ${PRIVATE_ORGANIZATION_SCHEMA_VERSION};`);
        }
        return;
      }
      function upgradeCommittedSchema() {
        if (appId === APPLICATION_ID && version === 14) return;
        if (appId === APPLICATION_ID && version === 13) {
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 12) {
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 11) {
          migrateVersion11(db);
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 10) {
          migrateVersion10(db);
          migrateVersion11(db);
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 9) {
          migrateVersion9(db);
          migrateVersion10(db);
          migrateVersion11(db);
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 8) {
          migrateVersion8(db);
          migrateVersion9(db);
          migrateVersion10(db);
          migrateVersion11(db);
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 7) {
          migrateVersion7(db);
          migrateVersion8(db);
          migrateVersion9(db);
          migrateVersion10(db);
          migrateVersion11(db);
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 6) {
          migrateVersion6(db);
          migrateVersion7(db);
          migrateVersion8(db);
          migrateVersion9(db);
          migrateVersion10(db);
          migrateVersion11(db);
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 1) {
          migrateVersion1(db);
          migrateVersion3(db);
          migrateVersion4(db);
          migrateVersion5(db);
          migrateVersion6(db);
          migrateVersion7(db);
          migrateVersion8(db);
          migrateVersion9(db);
          migrateVersion10(db);
          migrateVersion11(db);
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 3) {
          migrateVersion3(db);
          migrateVersion4(db);
          migrateVersion5(db);
          migrateVersion6(db);
          migrateVersion7(db);
          migrateVersion8(db);
          migrateVersion9(db);
          migrateVersion10(db);
          migrateVersion11(db);
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 4) {
          migrateVersion4(db);
          migrateVersion5(db);
          migrateVersion6(db);
          migrateVersion7(db);
          migrateVersion8(db);
          migrateVersion9(db);
          migrateVersion10(db);
          migrateVersion11(db);
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        if (appId === APPLICATION_ID && version === 5) {
          migrateVersion5(db);
          migrateVersion6(db);
          migrateVersion7(db);
          migrateVersion8(db);
          migrateVersion9(db);
          migrateVersion10(db);
          migrateVersion11(db);
          migrateVersion12(db);
          migrateVersion13(db);
          return;
        }
        const tables = db.prepare("SELECT count(*) AS n FROM sqlite_master").get().n;
        if (appId !== 0 || version !== 0 || tables !== 0) fail("unsupported_database");
        createVersion3(db);
        migrateVersion3(db);
        migrateVersion4(db);
        migrateVersion5(db);
        migrateVersion6(db);
        migrateVersion7(db);
        migrateVersion8(db);
        migrateVersion9(db);
        migrateVersion10(db);
        migrateVersion11(db);
        migrateVersion12(db);
        migrateVersion13(db);
      }
      if (!(appId === APPLICATION_ID && version === 17)) {
        if (!(appId === APPLICATION_ID && version === 16)) {
          if (!(appId === APPLICATION_ID && version === 15)) {
            upgradeCommittedSchema();
            migrateVersion14(db);
          }
          migrateVersion15(db);
        }
        migrateVersion16(db);
      }
      migrateVersion17(db);
      db.exec(`PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${VERSION};`);
      if (privateCards || rawConversations) {
        installPrivateCards(db);
        installCardMemorySources(db);
        installPrivateEvidence(db);
        installPrivateOrganization(db);
        db.exec(`PRAGMA user_version = ${PRIVATE_ORGANIZATION_SCHEMA_VERSION};`);
      }
      }
      upgrade();
      if (rawConversations) {
        installRawJournal(db);
        db.exec(`PRAGMA user_version = ${RAW_SCHEMA_VERSION};`);
        if (rawCapture) {
          installRawCapture(db);
          db.exec(`PRAGMA user_version = ${RAW_CAPTURE_SCHEMA_VERSION};`);
          if (rawLineage) {
            installRawLineage(db);
            db.exec(`PRAGMA user_version = ${RAW_LINEAGE_SCHEMA_VERSION};`);
            if (rawDeletion) {
              installRawDeletion(db);
              db.exec(`PRAGMA user_version = ${RAW_DELETION_SCHEMA_VERSION};`);
              if (rawSources || localControls) {
                installRawSources(db);
                db.exec(`PRAGMA user_version = ${RAW_SOURCE_SCHEMA_VERSION};`);
                if (localControls) {
                  installLocalAuthority(db);
                  db.exec(`PRAGMA user_version = ${LOCAL_AUTHORITY_SCHEMA_VERSION};`);
                }
              }
            }
          }
        }
      }
      }
      initialize();
      if (methodPackages) migrateMethodPrerequisites(db);
    });
    return db;
  } catch (error) {
    db?.close();
    throw error;
  } finally { pin?.close(); }
}

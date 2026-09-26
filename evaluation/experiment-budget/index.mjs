import { closeSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { pathToFileURL } from 'node:url';

const APPLICATION_ID = 0x43454247;
const SCHEMA_VERSION = 1;
const EMBEDDING_SCHEMA_VERSION = 2;
const DATABASE_FILENAME = 'experiment-budget.sqlite';
const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;

export const CHANNELS = Object.freeze([
  'host-completion',
  'cairn-count',
  'cairn-generation',
]);
export const OUTCOMES = Object.freeze(['succeeded', 'failed', 'unknown']);

const CHANNEL_SET = new Set(CHANNELS);
const OUTCOME_SET = new Set(OUTCOMES);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

const RUN_SCHEMA = `CREATE TABLE run_config (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  run_id TEXT NOT NULL UNIQUE,
  limit_micro_usd INTEGER NOT NULL CHECK (limit_micro_usd BETWEEN 1 AND ${MAX_SAFE_INTEGER}),
  request_cap INTEGER NOT NULL CHECK (request_cap BETWEEN 1 AND ${MAX_SAFE_INTEGER}),
  reserved_micro_usd INTEGER NOT NULL CHECK (reserved_micro_usd BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
  request_count INTEGER NOT NULL CHECK (request_count BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
  state TEXT NOT NULL CHECK (state IN ('open','overrun'))
) STRICT`;

const ATTEMPT_SCHEMA = `CREATE TABLE attempts (
  attempt_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('host-completion','cairn-count','cairn-generation')),
  reserved_micro_usd INTEGER NOT NULL CHECK (reserved_micro_usd BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
  outcome TEXT CHECK (outcome IN ('succeeded','failed','unknown')),
  actual_micro_usd INTEGER CHECK (actual_micro_usd BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
  CHECK (outcome IS NOT NULL OR actual_micro_usd IS NULL)
) STRICT`;

const EMBEDDING_ATTEMPT_SCHEMA = `CREATE TABLE attempts (
  attempt_id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('host-completion','cairn-count','cairn-generation','host-embedding')),
  reserved_micro_usd INTEGER NOT NULL CHECK (reserved_micro_usd BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
  outcome TEXT CHECK (outcome IN ('succeeded','failed','unknown')),
  actual_micro_usd INTEGER CHECK (actual_micro_usd BETWEEN 0 AND ${MAX_SAFE_INTEGER}),
  CHECK (outcome IS NOT NULL OR actual_micro_usd IS NULL)
) STRICT`;
const EMBEDDING_CHANNELS = new Set([...CHANNELS, 'host-embedding']);

const EXPECTED_SCHEMA = new Map([
  ['attempts', normalizeSql(ATTEMPT_SCHEMA)],
  ['run_config', normalizeSql(RUN_SCHEMA)],
]);
const EMBEDDING_EXPECTED_SCHEMA = new Map([
  ['attempts', normalizeSql(EMBEDDING_ATTEMPT_SCHEMA)],
  ['run_config', normalizeSql(RUN_SCHEMA)],
]);

export class ExperimentBudgetError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ExperimentBudgetError';
    this.code = code;
  }
}

const fail = (code) => {
  throw new ExperimentBudgetError(code);
};

function normalizeSql(sql) {
  return sql.trim().replace(/;$/u, '').replace(/\s+/gu, ' ');
}

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isPlainObject = (value) => value !== null
  && typeof value === 'object'
  && !Array.isArray(value)
  && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

function validateExactObject(value, keys) {
  if (!isPlainObject(value)) fail('invalid_options');
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    fail('invalid_options');
  }
}

function validateUuid(value) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) fail('invalid_options');
  return value;
}

function validateSafeInteger(value, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) fail('invalid_options');
  return value;
}

function validateConfiguration(options) {
  validateExactObject(options, ['directory', 'runId', 'limitMicroUsd', 'requestCap']);
  if (typeof options.directory !== 'string' || options.directory.length === 0
    || options.directory.includes('\0')) {
    fail('invalid_options');
  }
  const directory = path.resolve(options.directory);
  if (directory === path.parse(directory).root) fail('unsafe_path');
  return {
    directory,
    filename: path.join(directory, DATABASE_FILENAME),
    runId: validateUuid(options.runId),
    limitMicroUsd: validateSafeInteger(options.limitMicroUsd, { positive: true }),
    requestCap: validateSafeInteger(options.requestCap, { positive: true }),
  };
}

// New embedding APIs inspect descriptors before reading any caller value.
// Existing entrypoints deliberately retain their previously reviewed behavior.
function ownData(value, keys) {
  if (!isPlainObject(value)) fail('invalid_options');
  const names = Reflect.ownKeys(value);
  if (names.length !== keys.length || names.some((name) => typeof name !== 'string'
    || !keys.includes(name))) fail('invalid_options');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (keys.some((key) => !hasOwn(descriptors[key], 'value'))) fail('invalid_options');
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function detachedEmbeddingConfiguration(value) {
  return validateConfiguration(ownData(value, ['directory', 'runId', 'limitMicroUsd', 'requestCap']));
}

function detachedUpgradeOptions(value) {
  const options = ownData(value, ['directory', 'runId', 'limitMicroUsd', 'requestCap',
    'expectedCheckpoint', 'expectedHistorySha256']);
  const config = validateConfiguration({ directory: options.directory, runId: options.runId,
    limitMicroUsd: options.limitMicroUsd, requestCap: options.requestCap });
  const checkpoint = ownData(options.expectedCheckpoint, ['requestCount', 'reservedMicroUsd']);
  if (!Number.isSafeInteger(checkpoint.requestCount) || checkpoint.requestCount < 0
    || !Number.isSafeInteger(checkpoint.reservedMicroUsd) || checkpoint.reservedMicroUsd < 0
    || typeof options.expectedHistorySha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(options.expectedHistorySha256)) fail('invalid_options');
  return { config, checkpoint, historySha256: options.expectedHistorySha256 };
}

function pathParts(target) {
  const root = path.parse(target).root;
  const relative = path.relative(root, target);
  return { root, parts: relative === '' ? [] : relative.split(path.sep) };
}

function assertRealDirectoryAncestors(directory) {
  const { root, parts } = pathParts(directory);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    let entry;
    try {
      entry = lstatSync(current);
    } catch {
      fail('unsafe_path');
    }
    if (entry.isSymbolicLink() || !entry.isDirectory()) fail('unsafe_path');
  }
  try {
    if (realpathSync(directory) !== directory) fail('unsafe_path');
  } catch (error) {
    if (error instanceof ExperimentBudgetError) throw error;
    fail('unsafe_path');
  }
}

function assertPrivateMode(entry, expected, code) {
  if (process.platform !== 'win32' && (entry.mode & 0o777) !== expected) fail(code);
}

function assertSafeSidecars(filename) {
  for (const suffix of ['-journal', '-wal', '-shm']) {
    const sidecar = `${filename}${suffix}`;
    let entry;
    try {
      entry = lstatSync(sidecar);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      fail('unsafe_database_file');
    }
    if (entry.isSymbolicLink() || !entry.isFile()) fail('unsafe_database_file');
    assertPrivateMode(entry, 0o600, 'unsafe_database_file');
  }
}

function inspectExistingLocation({ directory, filename }) {
  assertRealDirectoryAncestors(path.dirname(directory));
  let directoryEntry;
  let databaseEntry;
  try {
    directoryEntry = lstatSync(directory);
    databaseEntry = lstatSync(filename);
  } catch (error) {
    if (error?.code === 'ENOENT') fail('ledger_missing');
    fail('unsafe_database_file');
  }
  if (directoryEntry.isSymbolicLink() || !directoryEntry.isDirectory()) fail('unsafe_path');
  assertRealDirectoryAncestors(directory);
  assertPrivateMode(directoryEntry, 0o700, 'unsafe_path');
  if (databaseEntry.isSymbolicLink() || !databaseEntry.isFile()) fail('unsafe_database_file');
  assertPrivateMode(databaseEntry, 0o600, 'unsafe_database_file');
  try {
    if (realpathSync(filename) !== filename) fail('unsafe_database_file');
  } catch (error) {
    if (error instanceof ExperimentBudgetError) throw error;
    fail('unsafe_database_file');
  }
  assertSafeSidecars(filename);
}

function createLocation({ directory, filename }) {
  const parent = path.dirname(directory);
  assertRealDirectoryAncestors(parent);
  try {
    lstatSync(directory);
    fail('directory_exists');
  } catch (error) {
    if (error instanceof ExperimentBudgetError) throw error;
    if (error?.code !== 'ENOENT') fail('unsafe_path');
  }
  try {
    mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (error?.code === 'EEXIST') fail('directory_exists');
    fail('ledger_failed');
  }
  assertRealDirectoryAncestors(directory);
  assertPrivateMode(lstatSync(directory), 0o700, 'unsafe_path');
  try {
    closeSync(openSync(filename, 'wx', 0o600));
  } catch (error) {
    if (error?.code === 'EEXIST') fail('directory_exists');
    fail('ledger_failed');
  }
  const entry = lstatSync(filename);
  if (entry.isSymbolicLink() || !entry.isFile()) fail('unsafe_database_file');
  assertPrivateMode(entry, 0o600, 'unsafe_database_file');
}

function isBusy(error) {
  const primaryCode = Number.isInteger(error?.errcode) ? error.errcode & 0xff : null;
  return primaryCode === 5 || primaryCode === 6;
}

function mapError(error) {
  if (error instanceof ExperimentBudgetError) return error;
  return new ExperimentBudgetError(isBusy(error) ? 'ledger_busy' : 'ledger_failed');
}

function withTransaction(db, mode, work) {
  try {
    db.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN');
    try {
      const result = work();
      db.exec('COMMIT');
      return result;
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch { /* Preserve the fixed original failure. */ }
      throw error;
    }
  } catch (error) {
    throw mapError(error);
  }
}

function configureConnection(db, readOnly = false) {
  db.exec(`PRAGMA foreign_keys = ON; PRAGMA trusted_schema = OFF;${readOnly ? ' PRAGMA query_only = ON;' : ''}`);
}

function assertSchema(db, version = SCHEMA_VERSION) {
  const applicationId = db.prepare('PRAGMA application_id').get().application_id;
  const storedVersion = db.prepare('PRAGMA user_version').get().user_version;
  if (applicationId !== APPLICATION_ID || storedVersion !== version) fail('invalid_ledger');
  const integrity = db.prepare('PRAGMA quick_check').all();
  if (integrity.length !== 1 || integrity[0].quick_check !== 'ok') fail('invalid_ledger');
  const journalMode = db.prepare('PRAGMA journal_mode').get().journal_mode;
  if (journalMode !== 'delete') fail('invalid_ledger');
  const rows = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL ORDER BY type, name`).all();
  const expected = version === SCHEMA_VERSION ? EXPECTED_SCHEMA
    : version === EMBEDDING_SCHEMA_VERSION ? EMBEDDING_EXPECTED_SCHEMA : null;
  if (expected === null || rows.length !== expected.size) fail('invalid_ledger');
  for (const row of rows) {
    if (row.type !== 'table' || row.tbl_name !== row.name
      || !expected.has(row.name)
      || normalizeSql(row.sql) !== expected.get(row.name)) {
      fail('invalid_ledger');
    }
  }
}

function validStoredInteger(value, { positive = false } = {}) {
  return Number.isSafeInteger(value) && value >= (positive ? 1 : 0);
}

function readValidatedState(db, version = SCHEMA_VERSION, includeRowid = false) {
  assertSchema(db, version);
  const runs = db.prepare('SELECT * FROM run_config').all();
  if (runs.length !== 1) fail('invalid_ledger');
  const run = runs[0];
  if (run.singleton !== 1 || !UUID_PATTERN.test(run.run_id)
    || !validStoredInteger(run.limit_micro_usd, { positive: true })
    || !validStoredInteger(run.request_cap, { positive: true })
    || !validStoredInteger(run.reserved_micro_usd)
    || !validStoredInteger(run.request_count)
    || !['open', 'overrun'].includes(run.state)) {
    fail('invalid_ledger');
  }
  const attempts = db.prepare(version === SCHEMA_VERSION && !includeRowid
    ? `SELECT attempt_id, channel, reserved_micro_usd, outcome,
      actual_micro_usd FROM attempts ORDER BY rowid`
    : `SELECT rowid, attempt_id, channel, reserved_micro_usd, outcome,
      actual_micro_usd FROM attempts ORDER BY rowid`).all();
  let reservedMicroUsd = 0;
  let hasOverrun = false;
  for (const attempt of attempts) {
    if (((version === EMBEDDING_SCHEMA_VERSION || includeRowid)
      && !Number.isSafeInteger(attempt.rowid))
      || !UUID_PATTERN.test(attempt.attempt_id)
      || !(version === EMBEDDING_SCHEMA_VERSION ? EMBEDDING_CHANNELS : CHANNEL_SET).has(attempt.channel)
      || !validStoredInteger(attempt.reserved_micro_usd)
      || (attempt.outcome !== null && !OUTCOME_SET.has(attempt.outcome))
      || (attempt.actual_micro_usd !== null && !validStoredInteger(attempt.actual_micro_usd))
      || (attempt.outcome === null && attempt.actual_micro_usd !== null)) {
      fail('invalid_ledger');
    }
    if (attempt.reserved_micro_usd > MAX_SAFE_INTEGER - reservedMicroUsd) fail('invalid_ledger');
    reservedMicroUsd += attempt.reserved_micro_usd;
    if (attempt.actual_micro_usd !== null
      && attempt.actual_micro_usd > attempt.reserved_micro_usd) hasOverrun = true;
  }
  if (attempts.length !== run.request_count
    || run.request_count > run.request_cap
    || reservedMicroUsd !== run.reserved_micro_usd
    || reservedMicroUsd > run.limit_micro_usd
    || (run.state === 'overrun') !== hasOverrun) {
    fail('invalid_ledger');
  }
  return { run, attempts };
}

function assertConfiguration(state, expected) {
  if (state.run.run_id !== expected.runId) fail('run_mismatch');
  if (state.run.limit_micro_usd !== expected.limitMicroUsd
    || state.run.request_cap !== expected.requestCap) {
    fail('configuration_mismatch');
  }
}

function publicAttempt(row) {
  return Object.freeze({
    attemptId: row.attempt_id,
    channel: row.channel,
    reservedMicroUsd: row.reserved_micro_usd,
    outcome: row.outcome,
    actualMicroUsd: row.actual_micro_usd,
  });
}

function publicState({ run, attempts }) {
  return Object.freeze({
    runId: run.run_id,
    limitMicroUsd: run.limit_micro_usd,
    requestCap: run.request_cap,
    reservedMicroUsd: run.reserved_micro_usd,
    requestCount: run.request_count,
    state: run.state,
    attempts: Object.freeze(attempts.map(publicAttempt)),
  });
}

// Version-independent history witness: schema-only migration preserves it.
// This detects accidental or foreign edits, not a database owner's forgery.
function embeddingHistorySha256(state) {
  if (state.attempts.some((row) => !Number.isSafeInteger(row.rowid))) fail('invalid_ledger');
  const run = state.run;
  const canonical = JSON.stringify(['cairn.embedding-budget-history.v1',
    [run.run_id, run.limit_micro_usd, run.request_cap, run.reserved_micro_usd,
      run.request_count, run.state],
    state.attempts.map((row) => [row.rowid, row.attempt_id, row.channel,
      row.reserved_micro_usd, row.outcome, row.actual_micro_usd])]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function embeddingInspection(state, version) {
  return Object.freeze({ schemaVersion: version, runId: state.run.run_id,
    limitMicroUsd: state.run.limit_micro_usd, requestCap: state.run.request_cap,
    reservedMicroUsd: state.run.reserved_micro_usd, requestCount: state.run.request_count,
    state: state.run.state, historySha256: embeddingHistorySha256(state) });
}

function boundEmbeddingSnapshot(state) {
  return Object.freeze({ schemaVersion: EMBEDDING_SCHEMA_VERSION, ...publicState(state),
    historySha256: embeddingHistorySha256(state) });
}

function embeddingVersion(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version !== SCHEMA_VERSION && version !== EMBEDDING_SCHEMA_VERSION) fail('invalid_ledger');
  return version;
}

function closeAfter(db, work) {
  let result;
  let error;
  try { result = work(); } catch (caught) { error = caught; }
  try { db.close(); } catch (caught) { if (!error) error = mapError(caught); }
  if (error) throw error;
  return result;
}

function openHandle(db, expected, bound = null, version = SCHEMA_VERSION) {
  let closed = false;
  const embeddingBound = bound?.version === EMBEDDING_SCHEMA_VERSION;
  const boundSnapshot = (state) => embeddingBound ? boundEmbeddingSnapshot(state) : publicState(state);
  const access = (mode, work, expectedAfter = null) => {
    if (closed) fail('ledger_closed');
    if (bound === null) {
      return withTransaction(db, mode, () => {
        const state = readValidatedState(db, version);
        assertConfiguration(state, expected);
        return work(state);
      });
    }
    try {
      const completed = withTransaction(db, mode, () => {
        inspectTransitionLocation(expected, bound.identity);
        const state = readValidatedState(db, version, embeddingBound);
        assertConfiguration(state, expected);
        if (JSON.stringify(boundSnapshot(state)) !== bound.witness) fail('invalid_ledger');
        const result = work(state);
        const after = readValidatedState(db, version, embeddingBound);
        assertConfiguration(after, expected);
        inspectTransitionLocation(expected, bound.identity);
        const actual = JSON.stringify(boundSnapshot(after));
        const intended = expectedAfter === null ? bound.witness
          : JSON.stringify(embeddingBound ? boundSnapshot(expectedAfter(state, result))
            : expectedAfter(state, result));
        if (actual !== intended) fail('invalid_ledger');
        return { result, witness: actual };
      });
      bound.witness = completed.witness;
      return completed.result;
    } catch (error) {
      closed = true;
      try { db.close(); } catch { /* The first transaction failure remains authoritative. */ }
      throw mapError(error);
    }
  };
  return Object.freeze({
    reserve(options) {
      const data = embeddingBound ? ownData(options, ['attemptId', 'channel', 'reservedMicroUsd'])
        : options;
      validateExactObject(data, ['attemptId', 'channel', 'reservedMicroUsd']);
      const attemptId = validateUuid(data.attemptId);
      const channel = bound === null ? null : data.channel;
      if (!(version === EMBEDDING_SCHEMA_VERSION ? EMBEDDING_CHANNELS : CHANNEL_SET)
        .has(bound === null ? data.channel : channel)) fail('invalid_options');
      const reservedMicroUsd = validateSafeInteger(data.reservedMicroUsd);
      return access('write', (current) => {
        if (current.attempts.some((attempt) => attempt.attempt_id === attemptId)) {
          fail('attempt_exists');
        }
        if (current.run.state === 'overrun') fail('budget_blocked');
        if (current.run.request_count >= current.run.request_cap) fail('request_cap_exceeded');
        if (reservedMicroUsd > current.run.limit_micro_usd - current.run.reserved_micro_usd) {
          fail('budget_exceeded');
        }
        db.prepare(`INSERT INTO attempts
          (attempt_id, channel, reserved_micro_usd, outcome, actual_micro_usd)
          VALUES (?, ?, ?, NULL, NULL)`).run(attemptId,
          bound === null ? data.channel : channel, reservedMicroUsd);
        db.prepare(`UPDATE run_config SET reserved_micro_usd = reserved_micro_usd + ?,
          request_count = request_count + 1 WHERE singleton = 1`).run(reservedMicroUsd);
        readValidatedState(db, version, embeddingBound);
        return publicAttempt({
          attempt_id: attemptId,
          channel: bound === null ? data.channel : channel,
          reserved_micro_usd: reservedMicroUsd,
          outcome: null,
          actual_micro_usd: null,
        });
      }, (current, attempt) => {
        if (embeddingBound) {
          const previousRowid = current.attempts.at(-1)?.rowid ?? 0;
          if (!Number.isSafeInteger(previousRowid + 1)) fail('invalid_ledger');
          return { run: { ...current.run,
            reserved_micro_usd: current.run.reserved_micro_usd + reservedMicroUsd,
            request_count: current.run.request_count + 1 },
          attempts: [...current.attempts, { rowid: previousRowid + 1,
            attempt_id: attemptId, channel, reserved_micro_usd: reservedMicroUsd,
            outcome: null, actual_micro_usd: null }] };
        }
        const prior = publicState(current);
        return { ...prior, reservedMicroUsd: prior.reservedMicroUsd + reservedMicroUsd,
          requestCount: prior.requestCount + 1, attempts: [...prior.attempts, attempt] };
      });
    },

    recordOutcome(options) {
      if (!isPlainObject(options)) fail('invalid_options');
      const keys = hasOwn(options, 'actualMicroUsd')
        ? ['attemptId', 'outcome', 'actualMicroUsd']
        : ['attemptId', 'outcome'];
      const data = embeddingBound ? ownData(options, keys) : options;
      validateExactObject(data, keys);
      const attemptId = validateUuid(data.attemptId);
      const outcome = bound === null ? null : data.outcome;
      if (!OUTCOME_SET.has(bound === null ? data.outcome : outcome)) fail('invalid_options');
      const actualMicroUsd = hasOwn(data, 'actualMicroUsd')
        ? validateSafeInteger(data.actualMicroUsd)
        : null;
      return access('write', (current) => {
        const attempt = current.attempts.find((row) => row.attempt_id === attemptId);
        if (!attempt) fail('attempt_not_found');
        if (attempt.outcome !== null) fail('attempt_terminal');
        db.prepare(`UPDATE attempts SET outcome = ?, actual_micro_usd = ?
          WHERE attempt_id = ?`).run(bound === null ? data.outcome : outcome, actualMicroUsd, attemptId);
        if (actualMicroUsd !== null && actualMicroUsd > attempt.reserved_micro_usd) {
          db.prepare(`UPDATE run_config SET state = 'overrun' WHERE singleton = 1`).run();
        }
        readValidatedState(db, version, embeddingBound);
        return publicAttempt({ ...attempt,
          outcome: bound === null ? data.outcome : outcome, actual_micro_usd: actualMicroUsd });
      }, (current, result) => {
        if (embeddingBound) return { run: { ...current.run,
          state: actualMicroUsd !== null && actualMicroUsd > result.reservedMicroUsd
            ? 'overrun' : current.run.state },
        attempts: current.attempts.map((attempt) => attempt.attempt_id === attemptId
          ? { ...attempt, outcome, actual_micro_usd: actualMicroUsd } : attempt) };
        const prior = publicState(current);
        return { ...prior,
          state: actualMicroUsd !== null && actualMicroUsd > result.reservedMicroUsd ? 'overrun' : prior.state,
          attempts: prior.attempts.map((attempt) => attempt.attemptId === attemptId ? result : attempt) };
      });
    },

    getState() {
      return access('read', embeddingBound ? boundEmbeddingSnapshot : publicState);
    },

    close() {
      if (closed) return;
      closed = true;
      try { db.close(); } catch (error) { throw mapError(error); }
    },
  });
}

function initializeDatabase(db, config) {
  withTransaction(db, 'write', () => {
    const existing = db.prepare(`SELECT count(*) AS count FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%'`).get().count;
    if (existing !== 0) fail('invalid_ledger');
    db.exec(`${RUN_SCHEMA}; ${ATTEMPT_SCHEMA};`);
    db.prepare(`INSERT INTO run_config
      (singleton, run_id, limit_micro_usd, request_cap, reserved_micro_usd, request_count, state)
      VALUES (1, ?, ?, ?, 0, 0, 'open')`).run(config.runId, config.limitMicroUsd, config.requestCap);
    db.exec(`PRAGMA application_id = ${APPLICATION_ID}; PRAGMA user_version = ${SCHEMA_VERSION};`);
    const state = readValidatedState(db);
    assertConfiguration(state, config);
  });
}

function constructDatabase(filename, options = {}) {
  let db;
  try {
    db = new DatabaseSync(filename, options);
    configureConnection(db, options.readOnly === true);
    return db;
  } catch (error) {
    try { db?.close(); } catch { /* Return only a fixed construction failure. */ }
    throw mapError(error);
  }
}

// Only the explicit cap-transition APIs use this existing-only writable open.
// The older create/reopen behavior is intentionally unchanged.
function constructExistingWritableDatabase(filename) {
  const url = pathToFileURL(filename);
  url.searchParams.set('mode', 'rw');
  return constructDatabase(url.href);
}

function inspectTransitionLocation(config, original = null) {
  inspectExistingLocation(config);
  let directory;
  let database;
  try {
    directory = lstatSync(config.directory);
    database = lstatSync(config.filename);
  } catch { fail('unsafe_database_file'); }
  if (!directory.isDirectory() || directory.isSymbolicLink()
    || !database.isFile() || database.isSymbolicLink() || database.nlink !== 1) {
    fail('unsafe_database_file');
  }
  const identity = Object.freeze({ directoryDev: directory.dev, directoryIno: directory.ino,
    databaseDev: database.dev, databaseIno: database.ino });
  if (original && Object.keys(identity).some((key) => identity[key] !== original[key])) {
    fail('unsafe_database_file');
  }
  return identity;
}

function snapshotExactConfiguration(value) {
  try {
    validateExactObject(value, ['directory', 'runId', 'limitMicroUsd', 'requestCap']);
    const detached = { directory: value.directory, runId: value.runId,
      limitMicroUsd: value.limitMicroUsd, requestCap: value.requestCap };
    return validateConfiguration(detached);
  } catch (error) {
    if (error instanceof ExperimentBudgetError) throw error;
    fail('invalid_options');
  }
}

export function openBoundExperimentBudget(options) {
  let config;
  let authorize;
  try {
    validateExactObject(options, ['configuration', 'authorize']);
    config = snapshotExactConfiguration(options.configuration);
    authorize = options.authorize;
    if (typeof authorize !== 'function') fail('invalid_options');
  } catch (error) {
    throw mapError(error);
  }
  const identity = inspectTransitionLocation(config);
  const db = constructExistingWritableDatabase(config.filename);
  try {
    const witness = withTransaction(db, 'write', () => {
      inspectTransitionLocation(config, identity);
      const state = readValidatedState(db);
      assertConfiguration(state, config);
      if (state.run.state !== 'open' || state.attempts.some((row) => row.outcome === null)) {
        fail('budget_blocked');
      }
      const original = JSON.stringify(publicState(state));
      if (authorize(publicState(state)) !== undefined) fail('ledger_failed');
      inspectTransitionLocation(config, identity);
      const after = readValidatedState(db);
      assertConfiguration(after, config);
      if (JSON.stringify(publicState(after)) !== original) fail('invalid_ledger');
      return original;
    });
    return openHandle(db, config, { identity, witness });
  } catch (error) {
    try { db.close(); } catch { /* The authorization failure remains authoritative. */ }
    throw mapError(error);
  }
}

function snapshotTransitionOptions(options) {
  try {
    validateExactObject(options, ['oldConfiguration', 'newConfiguration', 'expectedCheckpoint', 'authorize']);
    const oldConfigurationValue = options.oldConfiguration;
    const newConfigurationValue = options.newConfiguration;
    const checkpoint = options.expectedCheckpoint;
    const authorize = options.authorize;
    const oldConfiguration = snapshotExactConfiguration(oldConfigurationValue);
    const newConfiguration = snapshotExactConfiguration(newConfigurationValue);
    validateExactObject(checkpoint, ['requestCount', 'reservedMicroUsd']);
    const requestCount = validateSafeInteger(checkpoint.requestCount);
    const reservedMicroUsd = validateSafeInteger(checkpoint.reservedMicroUsd);
    if (oldConfiguration.directory !== newConfiguration.directory
      || oldConfiguration.runId !== newConfiguration.runId
      || oldConfiguration.limitMicroUsd >= newConfiguration.limitMicroUsd
      || oldConfiguration.requestCap >= newConfiguration.requestCap
      || requestCount > oldConfiguration.requestCap
      || reservedMicroUsd > oldConfiguration.limitMicroUsd
      || typeof authorize !== 'function') fail('invalid_options');
    return { oldConfiguration, newConfiguration, checkpoint: Object.freeze({ requestCount,
      reservedMicroUsd }), authorize };
  } catch (error) {
    if (error instanceof ExperimentBudgetError) throw error;
    fail('invalid_options');
  }
}

function checkpointPrefix(state, checkpoint) {
  const prefix = state.attempts.slice(0, checkpoint.requestCount);
  if (prefix.length !== checkpoint.requestCount
    || prefix.some((attempt) => attempt.outcome === null)
    || prefix.reduce((sum, attempt) => sum + attempt.reservedMicroUsd, 0)
      !== checkpoint.reservedMicroUsd) fail('configuration_mismatch');
  return Object.freeze(prefix);
}

export function inspectExperimentBudgetSnapshot(configuration) {
  const config = snapshotExactConfiguration(configuration);
  const identity = inspectTransitionLocation(config);
  const db = constructDatabase(config.filename, { readOnly: true });
  let result;
  let operationError;
  try {
    result = withTransaction(db, 'read', () => {
      inspectTransitionLocation(config, identity);
      const state = readValidatedState(db);
      assertConfiguration(state, config);
      inspectTransitionLocation(config, identity);
      return publicState(state);
    });
  } catch (error) { operationError = mapError(error); }
  try { db.close(); } catch (error) { if (!operationError) operationError = mapError(error); }
  if (operationError) throw operationError;
  return result;
}

export function transitionExperimentBudgetCaps(options) {
  const { oldConfiguration, newConfiguration, checkpoint, authorize } = snapshotTransitionOptions(options);
  const identity = inspectTransitionLocation(oldConfiguration);
  const db = constructExistingWritableDatabase(oldConfiguration.filename);
  let result;
  let operationError;
  try {
    result = withTransaction(db, 'write', () => {
      inspectTransitionLocation(oldConfiguration, identity);
      const current = readValidatedState(db);
      if (current.run.run_id !== oldConfiguration.runId) fail('run_mismatch');
      const oldCaps = current.run.limit_micro_usd === oldConfiguration.limitMicroUsd
        && current.run.request_cap === oldConfiguration.requestCap;
      const newCaps = current.run.limit_micro_usd === newConfiguration.limitMicroUsd
        && current.run.request_cap === newConfiguration.requestCap;
      if (!oldCaps && !newCaps) fail('configuration_mismatch');
      if (current.run.state !== 'open' || current.attempts.some((attempt) => attempt.outcome === null)) {
        fail('budget_blocked');
      }
      const state = publicState(current);
      const prefix = checkpointPrefix(state, checkpoint);
      if (oldCaps && (state.requestCount !== checkpoint.requestCount
        || state.reservedMicroUsd !== checkpoint.reservedMicroUsd)) fail('configuration_mismatch');
      const callbackResult = authorize(Object.freeze({ mode: oldCaps ? 'transition' : 'replay', state,
        checkpointAttempts: prefix }));
      if (callbackResult !== undefined) fail('ledger_failed');
      inspectTransitionLocation(oldConfiguration, identity);
      const afterCallback = readValidatedState(db);
      if (JSON.stringify(publicState(afterCallback)) !== JSON.stringify(state)) fail('invalid_ledger');
      if (oldCaps) {
        const changed = db.prepare(`UPDATE run_config SET limit_micro_usd = ?, request_cap = ?
          WHERE singleton = 1 AND run_id = ? AND limit_micro_usd = ? AND request_cap = ?
            AND reserved_micro_usd = ? AND request_count = ? AND state = 'open'`).run(
          newConfiguration.limitMicroUsd, newConfiguration.requestCap,
          oldConfiguration.runId, oldConfiguration.limitMicroUsd, oldConfiguration.requestCap,
          checkpoint.reservedMicroUsd, checkpoint.requestCount);
        if (Number(changed.changes) !== 1) fail('configuration_mismatch');
      }
      const after = readValidatedState(db);
      assertConfiguration(after, newConfiguration);
      if (after.run.reserved_micro_usd !== state.reservedMicroUsd
        || after.run.request_count !== state.requestCount
        || JSON.stringify(publicState(after).attempts) !== JSON.stringify(state.attempts)) {
        fail('invalid_ledger');
      }
      inspectTransitionLocation(oldConfiguration, identity);
      return publicState(after);
    });
  } catch (error) { operationError = mapError(error); }
  try { db.close(); } catch (error) { if (!operationError) operationError = mapError(error); }
  if (operationError) throw operationError;
  return result;
}

export function createExperimentBudget(options) {
  const config = validateConfiguration(options);
  createLocation(config);
  const db = constructDatabase(config.filename);
  try {
    initializeDatabase(db, config);
    return openHandle(db, config);
  } catch (error) {
    try { db.close(); } catch { /* The fixed initialization error is authoritative. */ }
    throw mapError(error);
  }
}

export function reopenExperimentBudget(options) {
  const config = validateConfiguration(options);
  inspectExistingLocation(config);

  const probe = constructDatabase(config.filename, { readOnly: true });
  try {
    withTransaction(probe, 'read', () => {
      const state = readValidatedState(probe);
      assertConfiguration(state, config);
    });
  } finally {
    try { probe.close(); } catch { /* A validation error remains authoritative. */ }
  }

  const db = constructDatabase(config.filename);
  try {
    withTransaction(db, 'read', () => {
      const state = readValidatedState(db);
      assertConfiguration(state, config);
    });
    return openHandle(db, config);
  } catch (error) {
    try { db.close(); } catch { /* The fixed reopen error is authoritative. */ }
    throw mapError(error);
  }
}

/** Read-only migration checkpoint; neither form grants embedding transport. */
export function inspectExperimentBudgetForEmbeddingUpgrade(options) {
  const config = detachedEmbeddingConfiguration(options);
  inspectExistingLocation(config);
  const db = constructDatabase(config.filename, { readOnly: true });
  return closeAfter(db, () => withTransaction(db, 'read', () => {
    const version = embeddingVersion(db);
    const state = readValidatedState(db, version, true);
    assertConfiguration(state, config);
    return embeddingInspection(state, version);
  }));
}

function assertUpgradeBinding(inspection, state, expected) {
  if (inspection.requestCount !== expected.checkpoint.requestCount
    || inspection.reservedMicroUsd !== expected.checkpoint.reservedMicroUsd
    || inspection.historySha256 !== expected.historySha256) fail('configuration_mismatch');
  if (state.run.state !== 'open' || state.attempts.some((row) => row.outcome === null)) {
    fail('budget_blocked');
  }
}

/** Explicit, existing-only schema transition on a previously inspected ledger. */
export function upgradeExperimentBudgetForEmbeddings(options) {
  const expected = detachedUpgradeOptions(options);
  const config = expected.config;
  const identity = inspectTransitionLocation(config);
  const db = constructExistingWritableDatabase(config.filename);
  return closeAfter(db, () => withTransaction(db, 'write', () => {
    inspectTransitionLocation(config, identity);
    const version = embeddingVersion(db);
    const before = readValidatedState(db, version, true);
    assertConfiguration(before, config);
    assertUpgradeBinding(embeddingInspection(before, version), before, expected);
    if (version === EMBEDDING_SCHEMA_VERSION) {
      return Object.freeze({ status: 'already-upgraded', ...embeddingInspection(before, version) });
    }
    db.exec('ALTER TABLE attempts RENAME TO attempts_legacy');
    db.exec(EMBEDDING_ATTEMPT_SCHEMA);
    db.exec(`INSERT INTO attempts (rowid, attempt_id, channel, reserved_micro_usd, outcome, actual_micro_usd)
      SELECT rowid, attempt_id, channel, reserved_micro_usd, outcome, actual_micro_usd
      FROM attempts_legacy ORDER BY rowid`);
    db.exec('DROP TABLE attempts_legacy');
    db.exec(`PRAGMA user_version = ${EMBEDDING_SCHEMA_VERSION}`);
    const after = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);
    assertConfiguration(after, config);
    const inspection = embeddingInspection(after, EMBEDDING_SCHEMA_VERSION);
    assertUpgradeBinding(inspection, after, expected);
    inspectTransitionLocation(config, identity);
    return Object.freeze({ status: 'upgraded', ...inspection });
  }));
}

/** Legacy embedding reopen retains the v1-shaped public state, on exact v2 only. */
export function reopenEmbeddingExperimentBudget(options) {
  const config = detachedEmbeddingConfiguration(options);
  const identity = inspectTransitionLocation(config);
  const probe = constructDatabase(config.filename, { readOnly: true });
  closeAfter(probe, () => withTransaction(probe, 'read', () => {
    inspectTransitionLocation(config, identity);
    const state = readValidatedState(probe, EMBEDDING_SCHEMA_VERSION, true);
    assertConfiguration(state, config);
    embeddingHistorySha256(state);
  }));
  const db = constructExistingWritableDatabase(config.filename);
  try {
    withTransaction(db, 'read', () => {
      inspectTransitionLocation(config, identity);
      const state = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);
      assertConfiguration(state, config);
      embeddingHistorySha256(state);
    });
    return openHandle(db, config, null, EMBEDDING_SCHEMA_VERSION);
  } catch (error) {
    try { db.close(); } catch { /* Preserve the validation failure. */ }
    throw mapError(error);
  }
}

/** Exact-v2 detached snapshot, including pending and overrun diagnostic states. */
export function inspectEmbeddingExperimentBudgetSnapshot(configuration) {
  const config = detachedEmbeddingConfiguration(configuration);
  const identity = inspectTransitionLocation(config);
  const db = constructDatabase(config.filename, { readOnly: true });
  return closeAfter(db, () => withTransaction(db, 'read', () => {
    inspectTransitionLocation(config, identity);
    const state = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);
    assertConfiguration(state, config);
    inspectTransitionLocation(config, identity);
    return boundEmbeddingSnapshot(state);
  }));
}

/** Existing-only v2 handle: local accounting capability, not HTTP authority. */
export function openBoundEmbeddingExperimentBudget(options) {
  const data = ownData(options, ['configuration', 'authorize']);
  const config = detachedEmbeddingConfiguration(data.configuration);
  const authorize = data.authorize;
  if (typeof authorize !== 'function') fail('invalid_options');
  const identity = inspectTransitionLocation(config);
  const db = constructExistingWritableDatabase(config.filename);
  try {
    const witness = withTransaction(db, 'write', () => {
      inspectTransitionLocation(config, identity);
      const state = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);
      assertConfiguration(state, config);
      if (state.run.state !== 'open' || state.attempts.some((row) => row.outcome === null)) {
        fail('budget_blocked');
      }
      const original = JSON.stringify(boundEmbeddingSnapshot(state));
      if (authorize(boundEmbeddingSnapshot(state)) !== undefined) fail('ledger_failed');
      inspectTransitionLocation(config, identity);
      const after = readValidatedState(db, EMBEDDING_SCHEMA_VERSION, true);
      assertConfiguration(after, config);
      if (JSON.stringify(boundEmbeddingSnapshot(after)) !== original) fail('invalid_ledger');
      return original;
    });
    return openHandle(db, config, { identity, witness, version: EMBEDDING_SCHEMA_VERSION },
      EMBEDDING_SCHEMA_VERSION);
  } catch (error) {
    try { db.close(); } catch { /* Preserve the first authorization failure. */ }
    throw mapError(error);
  }
}

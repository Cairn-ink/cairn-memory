import { closeSync, lstatSync, mkdirSync, openSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const APPLICATION_ID = 0x43454247;
const SCHEMA_VERSION = 1;
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

const EXPECTED_SCHEMA = new Map([
  ['attempts', normalizeSql(ATTEMPT_SCHEMA)],
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

function assertSchema(db) {
  const applicationId = db.prepare('PRAGMA application_id').get().application_id;
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (applicationId !== APPLICATION_ID || version !== SCHEMA_VERSION) fail('invalid_ledger');
  const integrity = db.prepare('PRAGMA quick_check').all();
  if (integrity.length !== 1 || integrity[0].quick_check !== 'ok') fail('invalid_ledger');
  const journalMode = db.prepare('PRAGMA journal_mode').get().journal_mode;
  if (journalMode !== 'delete') fail('invalid_ledger');
  const rows = db.prepare(`SELECT type, name, tbl_name, sql FROM sqlite_schema
    WHERE sql IS NOT NULL ORDER BY type, name`).all();
  if (rows.length !== EXPECTED_SCHEMA.size) fail('invalid_ledger');
  for (const row of rows) {
    if (row.type !== 'table' || row.tbl_name !== row.name
      || !EXPECTED_SCHEMA.has(row.name)
      || normalizeSql(row.sql) !== EXPECTED_SCHEMA.get(row.name)) {
      fail('invalid_ledger');
    }
  }
}

function validStoredInteger(value, { positive = false } = {}) {
  return Number.isSafeInteger(value) && value >= (positive ? 1 : 0);
}

function readValidatedState(db) {
  assertSchema(db);
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
  const attempts = db.prepare(`SELECT attempt_id, channel, reserved_micro_usd, outcome,
    actual_micro_usd FROM attempts ORDER BY rowid`).all();
  let reservedMicroUsd = 0;
  let hasOverrun = false;
  for (const attempt of attempts) {
    if (!UUID_PATTERN.test(attempt.attempt_id)
      || !CHANNEL_SET.has(attempt.channel)
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

function openHandle(db, expected) {
  let closed = false;
  const access = (mode, work) => {
    if (closed) fail('ledger_closed');
    return withTransaction(db, mode, () => {
      const state = readValidatedState(db);
      assertConfiguration(state, expected);
      return work(state);
    });
  };
  return Object.freeze({
    reserve(options) {
      validateExactObject(options, ['attemptId', 'channel', 'reservedMicroUsd']);
      const attemptId = validateUuid(options.attemptId);
      if (!CHANNEL_SET.has(options.channel)) fail('invalid_options');
      const reservedMicroUsd = validateSafeInteger(options.reservedMicroUsd);
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
          VALUES (?, ?, ?, NULL, NULL)`).run(attemptId, options.channel, reservedMicroUsd);
        db.prepare(`UPDATE run_config SET reserved_micro_usd = reserved_micro_usd + ?,
          request_count = request_count + 1 WHERE singleton = 1`).run(reservedMicroUsd);
        readValidatedState(db);
        return publicAttempt({
          attempt_id: attemptId,
          channel: options.channel,
          reserved_micro_usd: reservedMicroUsd,
          outcome: null,
          actual_micro_usd: null,
        });
      });
    },

    recordOutcome(options) {
      if (!isPlainObject(options)) fail('invalid_options');
      const keys = hasOwn(options, 'actualMicroUsd')
        ? ['attemptId', 'outcome', 'actualMicroUsd']
        : ['attemptId', 'outcome'];
      validateExactObject(options, keys);
      const attemptId = validateUuid(options.attemptId);
      if (!OUTCOME_SET.has(options.outcome)) fail('invalid_options');
      const actualMicroUsd = hasOwn(options, 'actualMicroUsd')
        ? validateSafeInteger(options.actualMicroUsd)
        : null;
      return access('write', (current) => {
        const attempt = current.attempts.find((row) => row.attempt_id === attemptId);
        if (!attempt) fail('attempt_not_found');
        if (attempt.outcome !== null) fail('attempt_terminal');
        db.prepare(`UPDATE attempts SET outcome = ?, actual_micro_usd = ?
          WHERE attempt_id = ?`).run(options.outcome, actualMicroUsd, attemptId);
        if (actualMicroUsd !== null && actualMicroUsd > attempt.reserved_micro_usd) {
          db.prepare(`UPDATE run_config SET state = 'overrun' WHERE singleton = 1`).run();
        }
        readValidatedState(db);
        return publicAttempt({ ...attempt, outcome: options.outcome, actual_micro_usd: actualMicroUsd });
      });
    },

    getState() {
      return access('read', publicState);
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

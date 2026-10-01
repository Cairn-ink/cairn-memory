import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, linkSync, lstatSync, mkdtempSync, readFileSync,
  renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { holdReader } from '../testing/reader-lock.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import * as budgetApi from '../index.mjs';

import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, openBoundEmbeddingExperimentBudget,
  reopenEmbeddingExperimentBudget, reopenExperimentBudget,
  upgradeExperimentBudgetForEmbeddings } from '../index.mjs';

const denied = code => error => error?.code === code;
const filename = config => path.join(config.directory, 'experiment-budget.sqlite');
const child = fileURLToPath(new URL('../testing/bound-embedding-ledger-child.mjs', import.meta.url));

function orphanFixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-orphan-settlement-' });
  if (t) t.after(async () => { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false); });
  const config = { directory: path.join(workspace.path, 'budget #v2'), runId: randomUUID(),
    limitMicroUsd: 300_000_000, requestCap: 840_000 };
  const initial = createExperimentBudget(config);
  try {
    for (const [channel, amount, outcome] of [['host-completion', 13, 'unknown'],
      ['cairn-count', 17, 'succeeded']]) {
      const attemptId = randomUUID();
      initial.reserve({ attemptId, channel, reservedMicroUsd: amount });
      initial.recordOutcome({ attemptId, outcome });
    }
  } finally { initial.close(); }
  const db = new DatabaseSync(filename(config));
  try { db.exec('UPDATE attempts SET rowid = 9 WHERE rowid = 2'); } finally { db.close(); }
  const inspection = inspectExperimentBudgetForEmbeddingUpgrade(config);
  upgradeExperimentBudgetForEmbeddings({ ...config, expectedCheckpoint: {
    requestCount: inspection.requestCount, reservedMicroUsd: inspection.reservedMicroUsd },
  expectedHistorySha256: inspection.historySha256 });
  const expectedAttempt = { attemptId: randomUUID(), channel: 'host-embedding', reservedMicroUsd: 5000 };
  const handle = reopenEmbeddingExperimentBudget(config);
  try { handle.reserve(expectedAttempt); } finally { handle.close(); }
  const before = inspectEmbeddingExperimentBudgetSnapshot(config);
  const expectedCheckpoint = checkpoint(before);
  return { workspace, config, before, expectedAttempt, expectedCheckpoint,
    options: { configuration: config, expectedCheckpoint, expectedAttempt, authorize() {} } };
}

function checkpoint(snapshot) {
  return { requestCount: snapshot.requestCount, reservedMicroUsd: snapshot.reservedMicroUsd,
    historySha256: snapshot.historySha256 };
}

test('OS8 exact checkpoint refuses foreign history at the real legacy settlement seam', t => {
  const f = orphanFixture(t);
  const foreign = reopenEmbeddingExperimentBudget(f.config);
  try {
    const attemptId = randomUUID();
    foreign.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 7 });
    foreign.recordOutcome({ attemptId, outcome: 'unknown' });
  } finally { foreign.close(); }
  const changed = inspectEmbeddingExperimentBudgetSnapshot(f.config);
  assert.notEqual(changed.historySha256, f.before.historySha256);
  // Before the helper exists this deliberately exercises the actual old API,
  // rather than failing on a missing import. Its legitimate unbound write is RED.
  const settle = budgetApi.settleOrphanedEmbeddingAttemptUnknown ?? (options => {
    const old = reopenEmbeddingExperimentBudget(options.configuration);
    try { return old.recordOutcome({ attemptId: options.expectedAttempt.attemptId, outcome: 'unknown' }); }
    finally { old.close(); }
  });
  let observed = 'accepted foreign history';
  let calls = 0;
  try { settle({ ...f.options, authorize() { calls++; } }); } catch (error) { observed = error.code; }
  assert.equal(observed, 'configuration_mismatch', 'stale checkpoint must fence real settlement');
  assert.equal(calls, 0);
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.config), changed);
  // The existing API remains intentionally unbound; do not change its semantics.
  const old = reopenEmbeddingExperimentBudget(f.config);
  try { old.recordOutcome({ attemptId: f.expectedAttempt.attemptId, outcome: 'unknown' }); }
  finally { old.close(); }
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.config).attempts[2].outcome, 'unknown');
});

const settleOrphan = options => budgetApi.settleOrphanedEmbeddingAttemptUnknown(options);

test('OS1–OS6 exact orphan settlement retains every field and rowid and unlocks ordinary bound open', t => {
  const f = orphanFixture(t), rows = rawRows(f.config), beforeBytes = readFileSync(filename(f.config));
  assert.throws(() => bound(f.config), denied('budget_blocked'));
  let calls = 0;
  const result = settleOrphan({ ...f.options, authorize(envelope) {
    calls++;
    assert.equal(Object.isFrozen(envelope), true);
    assert.equal(Object.isFrozen(envelope.state), true);
    assert.equal(Object.isFrozen(envelope.state.attempts), true);
    assert.equal(Object.isFrozen(envelope.target), true);
    assert.deepEqual(envelope.state, f.before);
    assert.deepEqual(envelope.target, { ...f.expectedAttempt, outcome: null, actualMicroUsd: null });
    assert.deepEqual(Object.keys(envelope), ['state', 'target']);
  } });
  assert.equal(calls, 1);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.attempts[2]), true);
  assert.deepEqual(result, { ...f.before, historySha256: result.historySha256,
    attempts: f.before.attempts.map((row, i) => i === 2 ? { ...row, outcome: 'unknown' } : row) });
  assert.notEqual(result.historySha256, f.before.historySha256);
  assert.notDeepEqual(readFileSync(filename(f.config)), beforeBytes);
  assert.deepEqual(rawRows(f.config).map(row => ({ ...row })), rows.map((row, i) => ({ ...row,
    ...(i === 2 ? { outcome: 'unknown' } : {}) })));
  assert.deepEqual(result, inspectEmbeddingExperimentBudgetSnapshot(f.config));
  const handle = bound(f.config);
  try { assert.deepEqual(handle.getState(), result); } finally { handle.close(); }
  assert.throws(() => settleOrphan(f.options), denied('configuration_mismatch'));
  assert.throws(() => settleOrphan({ ...f.options, expectedCheckpoint: checkpoint(result) }),
    denied('attempt_terminal'));
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.config), result);
});

test('OS1 descriptor-safe orphan options refuse malformed authority and data before opening', t => {
  const f = orphanFixture(t), before = readFileSync(filename(f.config));
  let reads = 0, authorizations = 0;
  const base = { ...f.options, authorize() { authorizations++; } };
  const getter = (value, key) => Object.defineProperty({ ...value }, key,
    { enumerable: true, get() { reads++; throw new Error('synthetic private getter'); } });
  const invalid = [null, [], { ...base, extra: 1 }, { ...base, [Symbol('extra')]: 1 },
    getter(base, 'authorize'), getter(base, 'configuration'),
    { ...base, configuration: getter(base.configuration, 'runId') },
    { ...base, expectedCheckpoint: getter(base.expectedCheckpoint, 'historySha256') },
    { ...base, expectedAttempt: getter(base.expectedAttempt, 'channel') },
    { ...base, authorize: null }, { ...base, authorize: async () => { authorizations++; } }];
  for (const [key, bad] of [['requestCount', -1], ['reservedMicroUsd', 1.5],
    ['historySha256', 'A'.repeat(64)], ['historySha256', false]]) {
    invalid.push({ ...base, expectedCheckpoint: { ...base.expectedCheckpoint, [key]: bad } });
  }
  for (const [key, bad] of [['attemptId', 'not-a-uuid'], ['channel', false], ['channel', 'unlisted'],
    ['reservedMicroUsd', NaN], ['reservedMicroUsd', Number.MAX_SAFE_INTEGER + 1]]) {
    invalid.push({ ...base, expectedAttempt: { ...base.expectedAttempt, [key]: bad } });
  }
  for (const key of ['configuration', 'expectedCheckpoint', 'expectedAttempt']) {
    invalid.push({ ...base, [key]: { ...base[key], extra: true } });
    invalid.push({ ...base, [key]: { ...base[key], [Symbol('extra')]: true } });
  }
  for (const options of invalid) assert.throws(() => settleOrphan(options), denied('invalid_options'));
  assert.equal(reads, 0); assert.equal(authorizations, 0);
  assert.deepEqual(readFileSync(filename(f.config)), before);
});

test('OS3 orphan target, checkpoint, multiple/no pending and overrun refuse before callback', t => {
  const f = orphanFixture(t);
  let calls = 0;
  const options = { ...f.options, authorize() { calls++; } };
  for (const [expectedAttempt, code] of [
    [{ ...f.expectedAttempt, attemptId: randomUUID() }, 'attempt_not_found'],
    [{ ...f.expectedAttempt, channel: 'host-completion' }, 'configuration_mismatch'],
    [{ ...f.expectedAttempt, reservedMicroUsd: 4999 }, 'configuration_mismatch'],
    [{ ...f.expectedAttempt, attemptId: f.before.attempts[0].attemptId }, 'attempt_terminal']]) {
    assert.throws(() => settleOrphan({ ...options, expectedAttempt }), denied(code));
  }
  for (const expectedCheckpoint of [
    { ...f.expectedCheckpoint, requestCount: 1 }, { ...f.expectedCheckpoint, reservedMicroUsd: 0 },
    { ...f.expectedCheckpoint, historySha256: 'a'.repeat(64) }]) {
    assert.throws(() => settleOrphan({ ...options, expectedCheckpoint }), denied('configuration_mismatch'));
  }
  for (const configuration of [{ ...f.config, runId: randomUUID() },
    { ...f.config, limitMicroUsd: 299_999_999 }, { ...f.config, requestCap: 839_999 }]) {
    assert.throws(() => settleOrphan({ ...options, configuration }));
  }
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.config), f.before);
  const extra = reopenEmbeddingExperimentBudget(f.config), otherId = randomUUID();
  try { extra.reserve({ attemptId: otherId, channel: 'cairn-count', reservedMicroUsd: 0 }); }
  finally { extra.close(); }
  const multiple = inspectEmbeddingExperimentBudgetSnapshot(f.config);
  assert.throws(() => settleOrphan({ ...options, expectedCheckpoint: checkpoint(multiple) }), denied('budget_blocked'));
  const terminal = reopenEmbeddingExperimentBudget(f.config);
  try {
    terminal.recordOutcome({ attemptId: otherId, outcome: 'unknown' });
    terminal.recordOutcome({ attemptId: f.expectedAttempt.attemptId, outcome: 'failed' });
  } finally { terminal.close(); }
  const none = inspectEmbeddingExperimentBudgetSnapshot(f.config);
  assert.throws(() => settleOrphan({ ...options, expectedCheckpoint: checkpoint(none) }), denied('attempt_terminal'));
  const over = orphanFixture(t), h = reopenEmbeddingExperimentBudget(over.config);
  const id = randomUUID();
  try {
    h.reserve({ attemptId: id, channel: 'host-completion', reservedMicroUsd: 1 });
    h.recordOutcome({ attemptId: id, outcome: 'succeeded', actualMicroUsd: 2 });
  } finally { h.close(); }
  assert.throws(() => settleOrphan({ ...over.options, authorize() { calls++; },
    expectedCheckpoint: checkpoint(inspectEmbeddingExperimentBudgetSnapshot(over.config)) }), denied('budget_blocked'));
  assert.equal(calls, 0);
});

test('OS4 trusted callback return/throw/async refuses without settlement and leaks no arbitrary error', t => {
  const f = orphanFixture(t), before = readFileSync(filename(f.config));
  for (const authorize of [() => 1, () => Promise.resolve(),
    () => { throw new Error('synthetic private callback body'); },
    () => { throw new budgetApi.ExperimentBudgetError('synthetic_private_code'); }]) {
    let calls = 0;
    assert.throws(() => settleOrphan({ ...f.options, authorize(info) { calls++; return authorize(info); } }),
      error => error.code === 'ledger_failed' && error.message === 'ledger_failed');
    assert.equal(calls, 1);
    assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.config), f.before);
    assert.deepEqual(readFileSync(filename(f.config)), before);
  }
  let calls = 0;
  assert.throws(() => settleOrphan({ ...f.options, authorize: async () => { calls++; } }), denied('invalid_options'));
  assert.equal(calls, 0);
});

test('OS3 foreign terminal settlement and row-order drift cannot be adopted', t => {
  for (const mutation of ['terminal', 'rowid']) {
    const f = orphanFixture(t);
    if (mutation === 'terminal') {
      const h = reopenEmbeddingExperimentBudget(f.config);
      try { h.recordOutcome({ attemptId: f.expectedAttempt.attemptId, outcome: 'failed' }); }
      finally { h.close(); }
    } else {
      const db = new DatabaseSync(filename(f.config));
      try { db.exec('UPDATE attempts SET rowid = 20 WHERE rowid = 1'); } finally { db.close(); }
    }
    const changed = inspectEmbeddingExperimentBudgetSnapshot(f.config);
    let calls = 0;
    assert.throws(() => settleOrphan({ ...f.options, authorize() { calls++; } }), denied('configuration_mismatch'));
    assert.equal(calls, 0);
    assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.config), changed);
  }
});

test('OS2 exact-v2 orphan writer refuses missing/schema/privacy/hardlink paths without creation', t => {
  for (const mutation of ['missing', 'schema', 'v1', 'mode', 'hardlink', 'symlink', 'directory-mode']) {
    const f = orphanFixture(t), file = filename(f.config), original = readFileSync(file);
    if (mutation === 'missing' || mutation === 'symlink') renameSync(file, `${file}.moved`);
    if (mutation === 'symlink') symlinkSync(`${file}.moved`, file);
    if (mutation === 'schema' || mutation === 'v1') {
      const db = new DatabaseSync(file);
      try { db.exec(`PRAGMA user_version = ${mutation === 'v1' ? 1 : 3}`); } finally { db.close(); }
    }
    if (mutation === 'mode') chmodSync(file, 0o644);
    if (mutation === 'directory-mode') chmodSync(f.config.directory, 0o755);
    if (mutation === 'hardlink') linkSync(file, `${file}.linked`);
    let calls = 0;
    assert.throws(() => settleOrphan({ ...f.options, authorize() { calls++; } }));
    assert.equal(calls, 0);
    if (mutation === 'missing') { assert.equal(existsSync(file), false); assert.deepEqual(readFileSync(`${file}.moved`), original); }
    if (mutation === 'mode' || mutation === 'directory-mode') chmodSync(mutation === 'mode' ? file : f.config.directory,
      mutation === 'mode' ? 0o600 : 0o700);
    if (!['schema', 'v1', 'missing'].includes(mutation)) assert.deepEqual(readFileSync(file), original);
  }
});

test('OS4 callback SQL drift rolls back; same-path inode/privacy replacements fail closed', t => {
  const f = orphanFixture(t), rows = rawRows(f.config), originalExec = DatabaseSync.prototype.exec;
  let active;
  try {
    DatabaseSync.prototype.exec = function(sql) {
      if (sql === 'BEGIN IMMEDIATE') active = this;
      return originalExec.call(this, sql);
    };
    assert.throws(() => settleOrphan({ ...f.options, authorize() {
      active.exec('UPDATE attempts SET rowid = 20 WHERE rowid = 1');
    } }), denied('invalid_ledger'));
  } finally { DatabaseSync.prototype.exec = originalExec; }
  assert.deepEqual(rawRows(f.config), rows);
  for (const mutation of ['replacement', 'mode', 'hardlink']) {
    const f = orphanFixture(t), file = filename(f.config), before = readFileSync(file);
    assert.throws(() => settleOrphan({ ...f.options, authorize() {
      if (mutation === 'replacement') { renameSync(file, `${file}.moved`); copyFileSync(`${file}.moved`, file); }
      if (mutation === 'mode') chmodSync(file, 0o644);
      if (mutation === 'hardlink') linkSync(file, `${file}.linked`);
    } }), denied('unsafe_database_file'));
    if (mutation === 'mode') chmodSync(file, 0o600);
    if (mutation === 'hardlink') unlinkSync(`${file}.linked`);
    assert.deepEqual(readFileSync(file), before);
    assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.config), f.before);
  }
});

test('OS6 orphan settlement lock exhaustion retains pending; short reader permits one settlement', async t => {
  const f = orphanFixture(t);
  // Register child shutdown with the workspace, not after its removal hook.
  const reader = await holdReader({ after: fn => f.workspace.defer(fn) }, filename(f.config));
  let calls = 0;
  assert.throws(() => settleOrphan({ ...f.options, authorize() { calls++; } }), denied('ledger_busy'));
  assert.equal(calls, 1); // BEGIN succeeds; DELETE-journal COMMIT waits on the reader.
  await reader.release();
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.config), f.before);
  const short = await holdReader({ after: fn => f.workspace.defer(fn) }, filename(f.config));
  await short.releaseAfter(150);
  const result = settleOrphan(f.options);
  await short.release();
  assert.equal(result.attempts[2].outcome, 'unknown');
  assert.equal(result.reservedMicroUsd, f.before.reservedMicroUsd);
});

test('OS5–OS6 conditional-write and before/after-commit/close faults retain exact uncertainty', t => {
  for (const mode of ['zero-update', 'post-write-drift', 'before-commit', 'after-commit', 'after-close']) {
    const f = orphanFixture(t), rows = rawRows(f.config);
    const originalExec = DatabaseSync.prototype.exec, originalPrepare = DatabaseSync.prototype.prepare;
    const originalClose = DatabaseSync.prototype.close;
    try {
      DatabaseSync.prototype.prepare = function(sql) {
        const statement = originalPrepare.call(this, sql);
        if (sql.startsWith("UPDATE attempts SET outcome = 'unknown'")) {
          const originalRun = statement.run;
          statement.run = (...args) => {
            if (mode === 'zero-update') return { changes: 0 };
            const result = originalRun.apply(statement, args);
            if (mode === 'post-write-drift') originalExec.call(this, 'UPDATE attempts SET rowid = 21 WHERE rowid = 1');
            return result;
          };
        }
        return statement;
      };
      DatabaseSync.prototype.exec = function(sql) {
        if (sql === 'COMMIT' && ['before-commit', 'after-commit'].includes(mode)) {
          if (mode === 'after-commit') originalExec.call(this, sql);
          throw new Error('synthetic acknowledgement body');
        }
        return originalExec.call(this, sql);
      };
      DatabaseSync.prototype.close = function() {
        originalClose.call(this);
        if (mode === 'after-close') throw new Error('synthetic close body');
      };
      assert.throws(() => settleOrphan(f.options), denied(['zero-update', 'post-write-drift'].includes(mode)
        ? 'invalid_ledger' : 'ledger_failed'));
    } finally {
      DatabaseSync.prototype.exec = originalExec;
      DatabaseSync.prototype.prepare = originalPrepare;
      DatabaseSync.prototype.close = originalClose;
    }
    const committed = ['after-commit', 'after-close'].includes(mode);
    assert.deepEqual(rawRows(f.config).map(row => ({ ...row })), rows.map((row, i) => ({ ...row,
      ...(committed && i === 2 ? { outcome: 'unknown' } : {}) })));
    const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.config);
    assert.equal(snapshot.requestCount, f.before.requestCount);
    assert.equal(snapshot.reservedMicroUsd, f.before.reservedMicroUsd);
    if (committed) assert.throws(() => settleOrphan({ ...f.options, expectedCheckpoint: checkpoint(snapshot) }),
      denied('attempt_terminal'));
  }
});

test('OS7 owned orphan fixtures clean up success, refusal and synthetic assertion/setup failure', async () => {
  for (const mode of ['success', 'refusal', 'assertion', 'setup']) {
    const f = orphanFixture(null);
    try {
      if (mode === 'setup') throw new Error('synthetic setup');
      if (mode === 'assertion') assert.equal(1, 2, 'synthetic assertion');
      if (mode === 'refusal') assert.throws(() => settleOrphan({ ...f.options,
        expectedCheckpoint: { ...f.expectedCheckpoint, requestCount: 0 } }));
      else settleOrphan(f.options);
    } catch (error) {
      assert.ok(['assertion', 'setup'].includes(mode));
    } finally { await f.workspace.cleanup(); }
    assert.equal(existsSync(f.workspace.path), false);
  }
});

test('OS2 writer-open disappearance cannot create or settle a replacement ledger', t => {
  const f = orphanFixture(t), original = readFileSync(filename(f.config));
  const moduleUrl = new URL('../index.mjs', import.meta.url).href;
  const script = `import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    import { renameSync } from 'node:fs';
    const config = ${JSON.stringify(f.config)};
    registerHooks({ load(url, context, nextLoad) {
      const loaded = nextLoad(url, context);
      if (url !== ${JSON.stringify(moduleUrl)}) return loaded;
      const source = String(loaded.source), start = source.indexOf('export function settleOrphanedEmbeddingAttemptUnknown');
      assert.ok(start > 0);
      const suffix = source.slice(start), seam = '  const db = constructExistingWritableDatabase(config.filename);';
      assert.ok(suffix.includes(seam));
      return { ...loaded, source: "import { renameSync as syntheticRename } from 'node:fs';\\n"
        + source.slice(0, start) + suffix.replace(seam,
          "  syntheticRename(config.filename, config.filename + '.moved');\\n" + seam) };
    } });
    const api = await import(${JSON.stringify(moduleUrl)});
    let calls = 0;
    try { api.settleOrphanedEmbeddingAttemptUnknown({ ...${JSON.stringify(f.options)}, authorize() { calls++; } }); }
    catch(error) { assert.equal(error.code, 'ledger_failed'); }
    assert.equal(calls, 0);`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script],
    { env: { NODE_NO_WARNINGS: '1' }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(filename(f.config)), false);
  assert.equal(existsSync(`${filename(f.config)}-journal`), false);
  assert.deepEqual(readFileSync(`${filename(f.config)}.moved`), original);
});

test('OS3 writer lock refuses before callback and a constructor-time identity change is fenced', t => {
  const locked = orphanFixture(t), holder = new DatabaseSync(filename(locked.config));
  let calls = 0;
  try {
    holder.exec('BEGIN IMMEDIATE');
    assert.throws(() => settleOrphan({ ...locked.options, authorize() { calls++; } }), denied('ledger_busy'));
    assert.equal(calls, 0);
  } finally { holder.exec('ROLLBACK'); holder.close(); }
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(locked.config), locked.before);
  const replaced = orphanFixture(t), file = filename(replaced.config);
  const originalExec = DatabaseSync.prototype.exec;
  try {
    let changed = false;
    DatabaseSync.prototype.exec = function(sql) {
      if (!changed && sql.includes('PRAGMA foreign_keys')) {
        changed = true; renameSync(file, `${file}.moved`); copyFileSync(`${file}.moved`, file);
      }
      return originalExec.call(this, sql);
    };
    assert.throws(() => settleOrphan({ ...replaced.options, authorize() { calls++; } }), denied('unsafe_database_file'));
  } finally { DatabaseSync.prototype.exec = originalExec; }
  assert.equal(calls, 0);
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(replaced.config), replaced.before);
});

test('B1 writable connections have the fixed wait while read-only inspection stays unchanged', t => {
  const f = fixture(t), originalExec = DatabaseSync.prototype.exec, statements = [];
  try {
    DatabaseSync.prototype.exec = function(sql) { statements.push(sql); return originalExec.call(this, sql); };
    const handle = bound(f.config);
    handle.close();
    assert.equal(statements.filter(sql => sql === 'PRAGMA busy_timeout = 1000').length, 1);
    statements.length = 0;
    inspectEmbeddingExperimentBudgetSnapshot(f.config);
    assert.ok(statements.some(sql => sql.includes('PRAGMA query_only = ON')));
    assert.ok(!statements.some(sql => sql.includes('busy_timeout')));
    const db = new DatabaseSync(filename(f.config), { readOnly: true });
    try {
      assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'delete');
      assert.equal(db.prepare('PRAGMA user_version').get().user_version, 2);
    } finally { db.close(); }
  } finally { DatabaseSync.prototype.exec = originalExec; }
});

test('B1/B3 short child reader permits exactly one bound settlement with no extra reservation', async t => {
  const f = fixture(t), handle = bound(f.config), attemptId = randomUUID();
  t.after(() => handle.close());
  handle.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 10 });
  const reader = await holdReader(t, filename(f.config));
  await reader.releaseAfter(200);
  assert.deepEqual(handle.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 10 }),
    { attemptId, channel: 'host-embedding', reservedMicroUsd: 10, outcome: 'succeeded', actualMicroUsd: 10 });
  await reader.release();
  const snapshot = handle.getState();
  assert.equal(snapshot.requestCount, 3);
  assert.equal(snapshot.reservedMicroUsd, 40);
  assert.equal(snapshot.attempts.at(-1).outcome, 'succeeded');
});

test('B1/B3 long child reader leaves bound settlement pending and closes failed handle', async t => {
  const f = fixture(t), handle = bound(f.config), attemptId = randomUUID();
  handle.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 10 });
  const reader = await holdReader(t, filename(f.config));
  const started = performance.now();
  assert.throws(() => handle.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 10 }), denied('ledger_busy'));
  assert.ok(performance.now() - started >= 900);
  assert.throws(() => handle.getState(), denied('ledger_closed'));
  await reader.release();
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.config);
  assert.equal(snapshot.requestCount, 3);
  assert.equal(snapshot.reservedMicroUsd, 40);
  assert.equal(snapshot.attempts.at(-1).outcome, null);
  assert.equal(snapshot.attempts.at(-1).actualMicroUsd, null);
});

function runChild(mode, config, attemptId = randomUUID()) {
  const result = spawnSync(process.execPath, [child, mode, JSON.stringify(config), attemptId],
    { encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t, overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-bound-embedding-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = { directory: path.join(root, 'budget #v2'), runId: randomUUID(),
    limitMicroUsd: 1000, requestCap: 8, ...overrides };
  const handle = createExperimentBudget(config);
  const firstId = randomUUID();
  handle.reserve({ attemptId: firstId, channel: 'host-completion', reservedMicroUsd: 13 });
  handle.recordOutcome({ attemptId: firstId, outcome: 'unknown' });
  const secondId = randomUUID();
  handle.reserve({ attemptId: secondId, channel: 'cairn-count', reservedMicroUsd: 17 });
  handle.recordOutcome({ attemptId: secondId, outcome: 'succeeded', actualMicroUsd: 5 });
  handle.close();
  const db = new DatabaseSync(filename(config));
  db.prepare('UPDATE attempts SET rowid = 9 WHERE attempt_id = ?').run(secondId);
  db.close();
  const beforeRows = rawRows(config);
  const inspection = inspectExperimentBudgetForEmbeddingUpgrade(config);
  const migrated = upgradeExperimentBudgetForEmbeddings({ ...config,
    expectedCheckpoint: { requestCount: inspection.requestCount,
      reservedMicroUsd: inspection.reservedMicroUsd },
    expectedHistorySha256: inspection.historySha256 });
  assert.equal(migrated.status, 'upgraded');
  assert.equal(migrated.historySha256, inspection.historySha256);
  assert.deepEqual(rawRows(config), beforeRows);
  return { root, config, firstId, secondId, beforeRows, inspection };
}

function rawRows(config) {
  const db = new DatabaseSync(filename(config), { readOnly: true });
  try { return db.prepare(`SELECT rowid, attempt_id, channel, reserved_micro_usd,
    outcome, actual_micro_usd FROM attempts ORDER BY rowid`).all(); }
  finally { db.close(); }
}

function bound(config, authorize = () => {}) {
  return openBoundEmbeddingExperimentBudget({ configuration: config, authorize });
}

test('B3 exact-v2 read-only snapshot preserves rowids and detached frozen history', t => {
  const f = fixture(t);
  const beforeBytes = readFileSync(filename(f.config));
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.config);
  assert.deepEqual(Object.keys(snapshot), ['schemaVersion', 'runId', 'limitMicroUsd',
    'requestCap', 'reservedMicroUsd', 'requestCount', 'state', 'attempts', 'historySha256']);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.historySha256, f.inspection.historySha256);
  assert.equal(snapshot.attempts[0].outcome, 'unknown');
  assert.equal(snapshot.attempts[0].actualMicroUsd, null);
  assert.deepEqual(f.beforeRows.map(row => row.rowid), [1, 9]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.attempts), true);
  assert.equal(Object.isFrozen(snapshot.attempts[0]), true);
  assert.deepEqual(readFileSync(filename(f.config)), beforeBytes);
  assert.deepEqual(rawRows(f.config), f.beforeRows);
  assert.equal(existsSync(`${filename(f.config)}-journal`), false);
  const old = reopenEmbeddingExperimentBudget(f.config);
  assert.equal(Object.hasOwn(old.getState(), 'schemaVersion'), false);
  old.close();
  assert.throws(() => reopenExperimentBudget(f.config), denied('invalid_ledger'));
});

test('B4/B6 bound v2 reserves exact next rowid and witnesses mixed shared channels', t => {
  const f = fixture(t);
  let received;
  const handle = bound(f.config, snapshot => { received = snapshot;
    assert.equal(Object.isFrozen(snapshot.attempts[0]), true); });
  t.after(() => handle.close());
  assert.equal(received.historySha256, f.inspection.historySha256);
  const embeddingId = randomUUID();
  assert.deepEqual(handle.reserve({ attemptId: embeddingId, channel: 'host-embedding',
    reservedMicroUsd: 40 }), { attemptId: embeddingId, channel: 'host-embedding',
    reservedMicroUsd: 40, outcome: null, actualMicroUsd: null });
  assert.equal(handle.getState().requestCount, 3);
  assert.deepEqual(rawRows(f.config).map(row => row.rowid), [1, 9, 10]);
  assert.equal(handle.getState().historySha256,
    inspectEmbeddingExperimentBudgetSnapshot(f.config).historySha256);
  assert.deepEqual(handle.recordOutcome({ attemptId: embeddingId, outcome: 'failed' }),
    { attemptId: embeddingId, channel: 'host-embedding', reservedMicroUsd: 40,
      outcome: 'failed', actualMicroUsd: null });
  const otherId = randomUUID();
  handle.reserve({ attemptId: otherId, channel: 'cairn-generation', reservedMicroUsd: 0 });
  handle.recordOutcome({ attemptId: otherId, outcome: 'succeeded', actualMicroUsd: 0 });
  const after = handle.getState();
  assert.equal(after.reservedMicroUsd, 70);
  assert.equal(after.requestCount, 4);
  assert.deepEqual(after.attempts.map(attempt => attempt.channel),
    ['host-completion', 'cairn-count', 'host-embedding', 'cairn-generation']);
  assert.equal(after.historySha256, inspectEmbeddingExperimentBudgetSnapshot(f.config).historySha256);
});

test('B3 diagnostic snapshot permits pending and overrun; bound open rejects both', t => {
  const pending = fixture(t);
  const ordinary = reopenEmbeddingExperimentBudget(pending.config);
  const pendingId = randomUUID();
  ordinary.reserve({ attemptId: pendingId, channel: 'host-embedding', reservedMicroUsd: 10 });
  ordinary.close();
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(pending.config).attempts.at(-1).outcome, null);
  assert.throws(() => bound(pending.config), denied('budget_blocked'));
  const overrun = fixture(t);
  const second = reopenEmbeddingExperimentBudget(overrun.config);
  const overrunId = randomUUID();
  second.reserve({ attemptId: overrunId, channel: 'host-embedding', reservedMicroUsd: 5 });
  second.recordOutcome({ attemptId: overrunId, outcome: 'succeeded', actualMicroUsd: 6 });
  second.close();
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(overrun.config).state, 'overrun');
  assert.throws(() => bound(overrun.config), denied('budget_blocked'));
});

test('B5 exact descriptor snapshot refuses getters before filesystem and bound mutation', t => {
  const f = fixture(t);
  let calls = 0;
  const getter = { ...f.config };
  Object.defineProperty(getter, 'runId', { enumerable: true,
    get() { calls += 1; return f.config.runId; } });
  const outer = { configuration: f.config, authorize() {} };
  Object.defineProperty(outer, 'configuration', { enumerable: true,
    get() { calls += 1; return f.config; } });
  for (const action of [() => inspectEmbeddingExperimentBudgetSnapshot(getter),
    () => openBoundEmbeddingExperimentBudget(outer),
    () => bound(getter)]) assert.throws(action, denied('invalid_options'));
  assert.equal(calls, 0);
  const handle = bound(f.config);
  t.after(() => handle.close());
  const reserveOptions = { attemptId: randomUUID(), channel: 'host-embedding', reservedMicroUsd: 1 };
  Object.defineProperty(reserveOptions, 'channel', { enumerable: true,
    get() { calls += 1; return 'host-embedding'; } });
  assert.throws(() => handle.reserve(reserveOptions), denied('invalid_options'));
  const outcomeOptions = { attemptId: f.firstId, outcome: 'failed' };
  Object.defineProperty(outcomeOptions, 'outcome', { enumerable: true,
    get() { calls += 1; return 'failed'; } });
  assert.throws(() => handle.recordOutcome(outcomeOptions), denied('invalid_options'));
  assert.equal(calls, 0);
  assert.equal(handle.getState().requestCount, 2);
});

test('B4 callback wrong return, promise and throw refuse without changing state', t => {
  const f = fixture(t);
  const before = inspectEmbeddingExperimentBudgetSnapshot(f.config);
  assert.throws(() => bound(f.config, () => 1), denied('ledger_failed'));
  assert.throws(() => bound(f.config, () => Promise.resolve()), denied('ledger_failed'));
  assert.throws(() => bound(f.config, () => { throw new Error('synthetic callback'); }),
    denied('ledger_failed'));
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.config), before);
});

test('B4 in-transaction callback rowid mutation refuses and rolls back', t => {
  const f = fixture(t);
  const before = readFileSync(filename(f.config));
  const rows = rawRows(f.config);
  assert.equal(runChild('callback-sql-mutation', f.config), 'invalid_ledger');
  assert.deepEqual(rawRows(f.config), rows);
  assert.deepEqual(readFileSync(filename(f.config)), before);
});

test('B6 foreign rowid-only edit, settlement and append each fence a bound handle', t => {
  for (const edit of ['rowid', 'settlement', 'append']) {
    const f = fixture(t);
    const handle = bound(f.config);
    t.after(() => handle.close());
    const ownId = randomUUID();
    if (edit === 'settlement') handle.reserve({ attemptId: ownId, channel: 'host-embedding',
      reservedMicroUsd: 2 });
    if (edit === 'rowid') {
      const db = new DatabaseSync(filename(f.config));
      db.prepare('UPDATE attempts SET rowid = 20 WHERE attempt_id = ?').run(f.secondId);
      db.close();
    } else {
      const foreign = reopenEmbeddingExperimentBudget(f.config);
      if (edit === 'settlement') foreign.recordOutcome({ attemptId: ownId, outcome: 'unknown' });
      else { const id = randomUUID();
        foreign.reserve({ attemptId: id, channel: 'host-embedding', reservedMicroUsd: 3 });
        foreign.recordOutcome({ attemptId: id, outcome: 'unknown' }); }
      foreign.close();
    }
    assert.throws(() => handle.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
      reservedMicroUsd: 1 }), denied('invalid_ledger'));
    assert.throws(() => handle.getState(), denied('ledger_closed'));
  }
});

test('B6 path, hardlink and mode drift fence before any bound write', t => {
  for (const edit of ['missing', 'symlink', 'hardlink', 'mode']) {
    const f = fixture(t);
    const handle = bound(f.config);
    t.after(() => handle.close());
    const original = filename(f.config);
    const moved = `${original}.moved`;
    const linked = `${original}.linked`;
    if (edit === 'missing') renameSync(original, moved);
    if (edit === 'symlink') { renameSync(original, moved); symlinkSync(moved, original); }
    if (edit === 'hardlink') linkSync(original, linked);
    if (edit === 'mode') chmodSync(original, 0o644);
    assert.throws(() => handle.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
      reservedMicroUsd: 1 }));
    assert.throws(() => handle.getState(), denied('ledger_closed'));
    if (edit === 'mode') chmodSync(original, 0o600);
    if (edit === 'hardlink') unlinkSync(linked);
  }
});

test('B3/B4 v1, wrong schema and missing v2 file reject without creation', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-bound-embedding-v1-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const v1 = { directory: path.join(root, 'budget'), runId: randomUUID(),
    limitMicroUsd: 100, requestCap: 3 };
  createExperimentBudget(v1).close();
  const before = readFileSync(filename(v1));
  assert.throws(() => inspectEmbeddingExperimentBudgetSnapshot(v1), denied('invalid_ledger'));
  assert.throws(() => bound(v1), denied('invalid_ledger'));
  assert.deepEqual(readFileSync(filename(v1)), before);
  const f = fixture(t);
  const db = new DatabaseSync(filename(f.config));
  db.exec('PRAGMA user_version = 3');
  db.close();
  assert.throws(() => inspectEmbeddingExperimentBudgetSnapshot(f.config), denied('invalid_ledger'));
  assert.throws(() => bound(f.config), denied('invalid_ledger'));
  const moved = `${filename(f.config)}.moved`;
  renameSync(filename(f.config), moved);
  assert.throws(() => bound(f.config), denied('ledger_missing'));
  assert.equal(existsSync(filename(f.config)), false);
  assert.equal(lstatSync(moved).isFile(), true);
});

test('B4/B6 constructor race, post-work foreign rowid and commit failures fence without retry', t => {
  const raced = fixture(t);
  const original = readFileSync(filename(raced.config));
  assert.equal(runChild('rename-open', raced.config), 'ledger_failed');
  assert.equal(existsSync(filename(raced.config)), false);
  assert.deepEqual(readFileSync(`${filename(raced.config)}.moved`), original);
  assert.equal(existsSync(`${filename(raced.config)}-journal`), false);
  for (const mode of ['foreign-post-work', 'fail-before-commit', 'fail-after-commit']) {
    const f = fixture(t);
    const ownId = randomUUID();
    assert.deepEqual(JSON.parse(runChild(mode, f.config, ownId)),
      { first: mode === 'foreign-post-work' ? 'invalid_ledger' : 'ledger_failed',
        second: 'ledger_closed' });
    const state = inspectEmbeddingExperimentBudgetSnapshot(f.config);
    const committed = mode === 'fail-after-commit';
    assert.equal(state.requestCount, committed ? 3 : 2);
    assert.equal(state.reservedMicroUsd, committed ? 37 : 30);
    assert.deepEqual(rawRows(f.config).map(row => row.rowid), committed ? [1, 9, 10] : [1, 9]);
    assert.equal(state.attempts.some(row => row.attemptId === ownId), committed);
    if (committed) assert.equal(state.attempts.at(-1).outcome, null);
  }
});

test('B4/B6 same-path inode replacement is refused during callback and post-work operation', t => {
  const callback = fixture(t);
  const callbackFile = filename(callback.config);
  const callbackBytes = readFileSync(callbackFile);
  assert.throws(() => bound(callback.config, () => {
    renameSync(callbackFile, `${callbackFile}.moved`);
    copyFileSync(`${callbackFile}.moved`, callbackFile);
  }), denied('unsafe_database_file'));
  assert.notEqual(lstatSync(callbackFile).ino, lstatSync(`${callbackFile}.moved`).ino);
  assert.deepEqual(readFileSync(callbackFile), callbackBytes);
  assert.deepEqual(rawRows(callback.config), callback.beforeRows);

  const operation = fixture(t);
  const operationFile = filename(operation.config);
  const operationBytes = readFileSync(operationFile);
  copyFileSync(operationFile, `${operationFile}.replacement`);
  const ownId = randomUUID();
  assert.deepEqual(JSON.parse(runChild('replace-post-work', operation.config, ownId)),
    { first: 'unsafe_database_file', second: 'ledger_closed' });
  assert.notEqual(lstatSync(operationFile).ino, lstatSync(`${operationFile}.moved`).ino);
  assert.deepEqual(readFileSync(operationFile), operationBytes);
  assert.deepEqual(readFileSync(`${operationFile}.moved`), operationBytes);
  assert.deepEqual(rawRows(operation.config), operation.beforeRows);
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(operation.config).requestCount, 2);
});

test('synthetic bound fault child refuses lookalike and traversal roots before hooks', t => {
  const external = mkdtempSync(path.join(tmpdir(), 'cairn-bound-embedding-external-'));
  t.after(() => rmSync(external, { recursive: true, force: true }));
  const externalConfig = { directory: path.join(external, 'budget #v2'), runId: randomUUID(),
    limitMicroUsd: 100, requestCap: 3 };
  createExperimentBudget(externalConfig).close();
  const inspection = inspectExperimentBudgetForEmbeddingUpgrade(externalConfig);
  upgradeExperimentBudgetForEmbeddings({ ...externalConfig,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
    expectedHistorySha256: inspection.historySha256 });
  const original = readFileSync(filename(externalConfig));
  const standard = fixture(t);
  const traversal = { ...externalConfig,
    directory: `${standard.root}/../${path.basename(external)}/budget #v2` };
  for (const config of [externalConfig, traversal]) {
    const result = spawnSync(process.execPath,
      [child, 'callback-sql-mutation', JSON.stringify(config), randomUUID()],
      { encoding: 'utf8', timeout: 10_000, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    assert.equal(result.status, 1, `fault child did not reject ${config.directory}`);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /AssertionError/u);
    assert.equal(result.stdout, '');
    assert.deepEqual(readFileSync(filename(externalConfig)), original);
  }
});

test('B9 fake batch failure and individual fallback reserve before every physical dispatch', t => {
  const f = fixture(t, { requestCap: 5 });
  const handle = bound(f.config);
  t.after(() => handle.close());
  const physical = [];
  const dispatch = (channel, reservation, outcome, actual) => {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel, reservedMicroUsd: reservation });
    const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.config);
    assert.equal(snapshot.attempts.at(-1).attemptId, attemptId);
    assert.equal(snapshot.attempts.at(-1).outcome, null);
    physical.push({ attemptId, channel }); // Synthetic transport begins only here.
    handle.recordOutcome(actual === undefined ? { attemptId, outcome }
      : { attemptId, outcome, actualMicroUsd: actual });
  };
  dispatch('host-embedding', 70, 'unknown'); // failed batch, unknown cost charged
  dispatch('host-embedding', 30, 'succeeded', 11); // first individual fallback
  dispatch('host-embedding', 30, 'failed'); // second individual fallback
  assert.equal(physical.length, 3);
  const state = handle.getState();
  assert.equal(state.requestCount, 5);
  assert.equal(state.reservedMicroUsd, 160);
  assert.equal(state.attempts[2].actualMicroUsd, null);
  assert.equal(state.attempts[3].actualMicroUsd, 11);
  assert.throws(() => handle.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 0 }), denied('request_cap_exceeded'));
  assert.equal(physical.length, 3);
});

test('B9 every existing G guard factory rejects migrated v2 before claim or transport', t => {
  const f = fixture(t);
  const result = JSON.parse(runChild('old-guards-v2', f.config));
  assert.deepEqual(Object.keys(result.observed), ['baseline', 'extended', 'reconciliation',
    'qualification', 'candidate', 'checklist', 'rationale', 'rationale-models',
    'basis-models', 'benchmark', 'case-deadline', 'qualified-pair', 'adaptive-pair']);
  assert.equal(Object.values(result.observed).every(code => code === 'invalid_ledger'), true,
    JSON.stringify(result.observed));
  assert.equal(result.claimsAbsent, true);
  assert.equal(result.physical, 0);
  assert.deepEqual([result.normalCount, result.pairCount], [0, 0]);
});

test('B6 callback filesystem mutation is refused, without pretending it was undone', t => {
  const f = fixture(t);
  const moved = `${filename(f.config)}.moved`;
  const before = readFileSync(filename(f.config));
  assert.throws(() => bound(f.config, () => renameSync(filename(f.config), moved)),
    denied('ledger_missing'));
  assert.equal(existsSync(filename(f.config)), false);
  assert.equal(lstatSync(moved).isFile(), true);
  assert.deepEqual(readFileSync(moved), before);
});

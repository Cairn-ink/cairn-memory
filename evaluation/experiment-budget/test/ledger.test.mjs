import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  chmodSync,
  lstatSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  CHANNELS,
  ExperimentBudgetError,
  OUTCOMES,
  createExperimentBudget,
  reopenExperimentBudget,
} from '../index.mjs';

const moduleUrl = new URL('../index.mjs', import.meta.url).href;
const error = (code) => (value) => value instanceof ExperimentBudgetError && value.code === code;

function workspace(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cairn-experiment-budget-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, directory: path.join(root, 'ledger') };
}

function configuration(directory, overrides = {}) {
  return {
    directory,
    runId: randomUUID(),
    limitMicroUsd: 1_000,
    requestCap: 5,
    ...overrides,
  };
}

function child(action, config, input = {}) {
  const code = `
    import { reopenExperimentBudget } from ${JSON.stringify(moduleUrl)};
    const config = JSON.parse(process.argv[1]);
    const action = process.argv[2];
    const input = JSON.parse(process.argv[3]);
    try {
      const ledger = reopenExperimentBudget(config);
      if (action === 'reserve') console.log(JSON.stringify(ledger.reserve(input)));
      if (action === 'state') console.log(JSON.stringify(ledger.getState()));
      if (action === 'crash') { ledger.reserve(input); process.exit(0); }
      ledger.close();
    } catch (caught) {
      console.log(JSON.stringify({ error: caught.code ?? 'unexpected' }));
    }
  `;
  return new Promise((resolve, reject) => {
    const processHandle = spawn(process.execPath, ['--input-type=module', '-e', code,
      JSON.stringify(config), action, JSON.stringify(input)], {
      env: { NODE_NO_WARNINGS: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    processHandle.stdout.on('data', (chunk) => { stdout += chunk; });
    processHandle.stderr.on('data', (chunk) => { stderr += chunk; });
    processHandle.on('error', reject);
    processHandle.on('close', (status) => {
      if (status !== 0) reject(new Error(`synthetic child failed (${status}): ${stderr}`));
      else resolve(stdout.length === 0 ? null : JSON.parse(stdout));
    });
  });
}

test('exports closed channel and outcome allowlists', () => {
  assert.deepEqual(CHANNELS, ['host-completion', 'cairn-count', 'cairn-generation']);
  assert.deepEqual(OUTCOMES, ['succeeded', 'failed', 'unknown']);
  assert.equal(Object.isFrozen(CHANNELS), true);
  assert.equal(Object.isFrozen(OUTCOMES), true);
});

test('creates a private ledger and preserves the normal lifecycle across restart', (t) => {
  const { directory } = workspace(t);
  const config = configuration(directory);
  const firstId = randomUUID();
  const ledger = createExperimentBudget(config);
  assert.deepEqual(ledger.reserve({
    attemptId: firstId,
    channel: 'host-completion',
    reservedMicroUsd: 600,
  }), {
    attemptId: firstId,
    channel: 'host-completion',
    reservedMicroUsd: 600,
    outcome: null,
    actualMicroUsd: null,
  });
  ledger.recordOutcome({ attemptId: firstId, outcome: 'succeeded', actualMicroUsd: 450 });
  assert.deepEqual(ledger.getState(), {
    runId: config.runId,
    limitMicroUsd: 1_000,
    requestCap: 5,
    reservedMicroUsd: 600,
    requestCount: 1,
    state: 'open',
    attempts: [{
      attemptId: firstId,
      channel: 'host-completion',
      reservedMicroUsd: 600,
      outcome: 'succeeded',
      actualMicroUsd: 450,
    }],
  });
  ledger.close();
  ledger.close();

  if (process.platform !== 'win32') {
    assert.equal(lstatSync(directory).mode & 0o777, 0o700);
    assert.equal(lstatSync(path.join(directory, 'experiment-budget.sqlite')).mode & 0o777, 0o600);
  }
  const reopened = reopenExperimentBudget(config);
  t.after(() => reopened.close());
  assert.equal(reopened.getState().reservedMicroUsd, 600);
});

test('create never reuses a directory and reopen never creates or resets a ledger', (t) => {
  const { root, directory } = workspace(t);
  mkdirSync(directory, { mode: 0o700 });
  const marker = path.join(directory, 'precious.txt');
  writeFileSync(marker, 'keep');
  assert.throws(() => createExperimentBudget(configuration(directory)), error('directory_exists'));
  assert.equal(readFileSync(marker, 'utf8'), 'keep');

  const missing = path.join(root, 'missing');
  assert.throws(() => reopenExperimentBudget(configuration(missing)), error('ledger_missing'));
  assert.throws(() => lstatSync(missing), { code: 'ENOENT' });

  rmSync(directory, { recursive: true });
  const config = configuration(directory);
  const ledger = createExperimentBudget(config);
  ledger.reserve({ attemptId: randomUUID(), channel: 'cairn-count', reservedMicroUsd: 10 });
  ledger.close();
  assert.throws(() => reopenExperimentBudget({ ...config, runId: randomUUID() }), error('run_mismatch'));
  assert.throws(() => reopenExperimentBudget({ ...config, unexpected: true }), error('invalid_options'));
  assert.throws(() => reopenExperimentBudget({ ...config, limitMicroUsd: 2_000 }),
    error('configuration_mismatch'));
  assert.throws(() => reopenExperimentBudget({ ...config, requestCap: 6 }),
    error('configuration_mismatch'));
  const reopened = reopenExperimentBudget(config);
  t.after(() => reopened.close());
  assert.equal(reopened.getState().reservedMicroUsd, 10);
});

test('enforces exact micro-USD ceiling, request cap, duplicate IDs, and zero-cost attempts', (t) => {
  const { directory } = workspace(t);
  const config = configuration(directory, { limitMicroUsd: 10, requestCap: 3 });
  const ledger = createExperimentBudget(config);
  t.after(() => ledger.close());
  const zero = randomUUID();
  const exact = randomUUID();
  ledger.reserve({ attemptId: zero, channel: 'cairn-count', reservedMicroUsd: 0 });
  ledger.reserve({ attemptId: exact, channel: 'cairn-generation', reservedMicroUsd: 10 });
  const before = ledger.getState();
  assert.throws(() => ledger.reserve({
    attemptId: exact,
    channel: 'host-completion',
    reservedMicroUsd: 0,
  }), error('attempt_exists'));
  assert.throws(() => ledger.reserve({
    attemptId: randomUUID(),
    channel: 'host-completion',
    reservedMicroUsd: 1,
  }), error('budget_exceeded'));
  assert.deepEqual(ledger.getState(), before);
  ledger.reserve({ attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: 0 });
  assert.throws(() => ledger.reserve({
    attemptId: randomUUID(),
    channel: 'host-completion',
    reservedMicroUsd: 0,
  }), error('request_cap_exceeded'));
  assert.equal(ledger.getState().reservedMicroUsd, 10);
  assert.equal(ledger.getState().requestCount, 3);
});

test('rejects invalid configuration without creating a ledger directory', (t) => {
  const { root } = workspace(t);
  const invalidOverrides = [
    { runId: randomUUID().toUpperCase() },
    { limitMicroUsd: 0 },
    { limitMicroUsd: NaN },
    { limitMicroUsd: Infinity },
    { limitMicroUsd: 1.5 },
    { limitMicroUsd: Number.MAX_SAFE_INTEGER + 1 },
    { requestCap: 0 },
    { requestCap: 1.5 },
    { requestCap: Number.MAX_SAFE_INTEGER + 1 },
  ];
  invalidOverrides.forEach((overrides, index) => {
    const directory = path.join(root, `invalid-${index}`);
    assert.throws(() => createExperimentBudget(configuration(directory, overrides)),
      error('invalid_options'));
    assert.throws(() => lstatSync(directory), { code: 'ENOENT' });
  });
  const directory = path.join(root, 'unknown-field');
  assert.throws(() => createExperimentBudget({
    ...configuration(directory), unexpected: true,
  }), error('invalid_options'));
  assert.throws(() => lstatSync(directory), { code: 'ENOENT' });
});

test('validates all input before mutation and persists no arbitrary content', (t) => {
  const { directory } = workspace(t);
  const config = configuration(directory);
  const ledger = createExperimentBudget(config);
  const initial = ledger.getState();
  for (const invalid of [
    { attemptId: 'contains user text', channel: 'host-completion', reservedMicroUsd: 1 },
    { attemptId: randomUUID(), channel: 'provider-secret', reservedMicroUsd: 1 },
    { attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: -1 },
    { attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: NaN },
    { attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: Infinity },
    { attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: 1.5 },
    { attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: Number.MAX_SAFE_INTEGER + 1 },
    { attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: 1, prompt: 'private' },
  ]) {
    assert.throws(() => ledger.reserve(invalid), error('invalid_options'));
    assert.deepEqual(ledger.getState(), initial);
  }
  ledger.close();
  const contents = readFileSync(path.join(directory, 'experiment-budget.sqlite'));
  assert.equal(contents.includes(Buffer.from('contains user text')), false);
  assert.equal(contents.includes(Buffer.from('provider-secret')), false);
  assert.equal(contents.includes(Buffer.from('private')), false);
});

test('retains failed and unknown reservations without treating missing cost as zero', (t) => {
  const { directory } = workspace(t);
  const config = configuration(directory);
  const ledger = createExperimentBudget(config);
  t.after(() => ledger.close());
  const failed = randomUUID();
  const unknown = randomUUID();
  ledger.reserve({ attemptId: failed, channel: 'cairn-count', reservedMicroUsd: 300 });
  ledger.reserve({ attemptId: unknown, channel: 'cairn-generation', reservedMicroUsd: 400 });
  ledger.recordOutcome({ attemptId: failed, outcome: 'failed' });
  ledger.recordOutcome({ attemptId: unknown, outcome: 'unknown' });
  const state = ledger.getState();
  assert.equal(state.reservedMicroUsd, 700);
  assert.deepEqual(state.attempts.map(({ outcome, actualMicroUsd }) => ({ outcome, actualMicroUsd })), [
    { outcome: 'failed', actualMicroUsd: null },
    { outcome: 'unknown', actualMicroUsd: null },
  ]);
});

test('rejects invalid terminal outcomes and costs without changing an attempt', (t) => {
  const { directory } = workspace(t);
  const ledger = createExperimentBudget(configuration(directory));
  t.after(() => ledger.close());
  const attemptId = randomUUID();
  ledger.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 100 });
  const before = ledger.getState();
  for (const invalid of [
    { attemptId, outcome: 'cancelled' },
    { attemptId, outcome: 'failed', actualMicroUsd: -1 },
    { attemptId, outcome: 'failed', actualMicroUsd: NaN },
    { attemptId, outcome: 'failed', actualMicroUsd: Infinity },
    { attemptId, outcome: 'failed', actualMicroUsd: 1.5 },
    { attemptId, outcome: 'failed', actualMicroUsd: Number.MAX_SAFE_INTEGER + 1 },
    { attemptId, outcome: 'failed', rawError: 'private' },
  ]) {
    assert.throws(() => ledger.recordOutcome(invalid), error('invalid_options'));
    assert.deepEqual(ledger.getState(), before);
  }
});

test('makes terminal outcomes immutable and an actual overrun permanently blocks reservations', (t) => {
  const { directory } = workspace(t);
  const config = configuration(directory, { limitMicroUsd: 10_000 });
  const ledger = createExperimentBudget(config);
  const attemptId = randomUUID();
  ledger.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 100 });
  ledger.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 101 });
  assert.throws(() => ledger.recordOutcome({ attemptId, outcome: 'failed' }), error('attempt_terminal'));
  assert.throws(() => ledger.reserve({
    attemptId: randomUUID(), channel: 'cairn-count', reservedMicroUsd: 0,
  }), error('budget_blocked'));
  assert.equal(ledger.getState().state, 'overrun');
  ledger.close();
  const reopened = reopenExperimentBudget(config);
  t.after(() => reopened.close());
  assert.equal(reopened.getState().state, 'overrun');
  assert.throws(() => reopened.reserve({
    attemptId: randomUUID(), channel: 'cairn-count', reservedMicroUsd: 0,
  }), error('budget_blocked'));
});

test('independent processes contend without overspending or exceeding the request cap', async (t) => {
  const { directory } = workspace(t);
  const config = configuration(directory, { limitMicroUsd: 10, requestCap: 5 });
  createExperimentBudget(config).close();
  const results = await Promise.all(Array.from({ length: 12 }, () => child('reserve', config, {
    attemptId: randomUUID(),
    channel: 'host-completion',
    reservedMicroUsd: 2,
  })));
  const accepted = results.filter((result) => !result?.error);
  const rejected = results.filter((result) => result?.error);
  assert.equal(accepted.length >= 1, true);
  assert.equal(accepted.length <= 5, true);
  assert.equal(rejected.every(({ error: code }) => [
    'budget_exceeded', 'request_cap_exceeded', 'ledger_busy',
  ].includes(code)), true);
  const reopened = reopenExperimentBudget(config);
  t.after(() => reopened.close());
  const state = reopened.getState();
  assert.equal(state.requestCount, accepted.length);
  assert.equal(state.reservedMicroUsd, accepted.length * 2);
  assert.equal(state.requestCount <= config.requestCap, true);
  assert.equal(state.reservedMicroUsd <= config.limitMicroUsd, true);
});

test('returns a fixed busy error without retrying or authorizing a reservation', (t) => {
  const { directory } = workspace(t);
  const config = configuration(directory);
  const ledger = createExperimentBudget(config);
  t.after(() => ledger.close());
  const lock = new DatabaseSync(path.join(directory, 'experiment-budget.sqlite'));
  t.after(() => lock.close());
  lock.exec('BEGIN IMMEDIATE');
  const started = performance.now();
  assert.throws(() => ledger.reserve({
    attemptId: randomUUID(), channel: 'host-completion', reservedMicroUsd: 100,
  }), error('ledger_busy'));
  assert.equal(performance.now() - started < 1_000, true);
  lock.exec('ROLLBACK');
  assert.equal(ledger.getState().requestCount, 0);
});

test('a process exit leaves an unresolved reservation that counts after restart', async (t) => {
  const { directory } = workspace(t);
  const config = configuration(directory);
  createExperimentBudget(config).close();
  const attemptId = randomUUID();
  assert.equal(await child('crash', config, {
    attemptId, channel: 'cairn-generation', reservedMicroUsd: 700,
  }), null);
  const state = await child('state', config);
  assert.equal(state.requestCount, 1);
  assert.equal(state.reservedMicroUsd, 700);
  assert.deepEqual(state.attempts[0], {
    attemptId,
    channel: 'cairn-generation',
    reservedMicroUsd: 700,
    outcome: null,
    actualMicroUsd: null,
  });
  const duplicate = await child('reserve', config, {
    attemptId, channel: 'cairn-generation', reservedMicroUsd: 0,
  });
  assert.deepEqual(duplicate, { error: 'attempt_exists' });
});

test('rejects malformed schema and inconsistent state without repairing them', (t) => {
  const first = workspace(t);
  const firstConfig = configuration(first.directory);
  createExperimentBudget(firstConfig).close();
  const firstPath = path.join(first.directory, 'experiment-budget.sqlite');
  const foreign = new DatabaseSync(firstPath);
  foreign.exec('CREATE TABLE injected (value TEXT) STRICT');
  foreign.close();
  assert.throws(() => reopenExperimentBudget(firstConfig), error('invalid_ledger'));
  const verifyForeign = new DatabaseSync(firstPath, { readOnly: true });
  assert.equal(verifyForeign.prepare(`SELECT count(*) AS count FROM sqlite_schema
    WHERE name = 'injected'`).get().count, 1);
  verifyForeign.close();

  const second = workspace(t);
  const secondConfig = configuration(second.directory);
  const ledger = createExperimentBudget(secondConfig);
  ledger.reserve({ attemptId: randomUUID(), channel: 'cairn-count', reservedMicroUsd: 100 });
  ledger.close();
  const secondPath = path.join(second.directory, 'experiment-budget.sqlite');
  const corrupt = new DatabaseSync(secondPath);
  corrupt.exec('UPDATE run_config SET reserved_micro_usd = 99');
  corrupt.close();
  assert.throws(() => reopenExperimentBudget(secondConfig), error('invalid_ledger'));
  const verifyCorrupt = new DatabaseSync(secondPath, { readOnly: true });
  assert.equal(verifyCorrupt.prepare('SELECT reserved_micro_usd FROM run_config').get().reserved_micro_usd, 99);
  verifyCorrupt.close();
});

test('rejects symlinks, permissive modes, and unsafe SQLite sidecars', (t) => {
  if (process.platform === 'win32') return;
  const first = workspace(t);
  const outside = path.join(first.root, 'outside');
  mkdirSync(outside, { mode: 0o700 });
  const linked = path.join(first.root, 'linked');
  symlinkSync(outside, linked, 'dir');
  assert.throws(() => createExperimentBudget(configuration(path.join(linked, 'ledger'))), error('unsafe_path'));

  const linkedDatabaseDirectory = path.join(first.root, 'linked-database');
  mkdirSync(linkedDatabaseDirectory, { mode: 0o700 });
  const actualConfig = configuration(path.join(first.root, 'actual-ledger'));
  createExperimentBudget(actualConfig).close();
  symlinkSync(
    path.join(actualConfig.directory, 'experiment-budget.sqlite'),
    path.join(linkedDatabaseDirectory, 'experiment-budget.sqlite'),
  );
  assert.throws(() => reopenExperimentBudget({
    ...actualConfig, directory: linkedDatabaseDirectory,
  }), error('unsafe_database_file'));

  const second = workspace(t);
  const secondConfig = configuration(second.directory);
  createExperimentBudget(secondConfig).close();
  const filename = path.join(second.directory, 'experiment-budget.sqlite');
  chmodSync(filename, 0o644);
  assert.throws(() => reopenExperimentBudget(secondConfig), error('unsafe_database_file'));
  chmodSync(filename, 0o600);
  chmodSync(second.directory, 0o755);
  assert.throws(() => reopenExperimentBudget(secondConfig), error('unsafe_path'));
  chmodSync(second.directory, 0o700);

  const target = path.join(second.root, 'sidecar-target');
  writeFileSync(target, 'do not follow', { mode: 0o600 });
  symlinkSync(target, `${filename}-journal`);
  assert.throws(() => reopenExperimentBudget(secondConfig), error('unsafe_database_file'));
  assert.equal(readFileSync(target, 'utf8'), 'do not follow');
});

test('closed handles and unknown attempts fail with fixed errors', (t) => {
  const { directory } = workspace(t);
  const ledger = createExperimentBudget(configuration(directory));
  assert.throws(() => ledger.recordOutcome({
    attemptId: randomUUID(), outcome: 'unknown',
  }), error('attempt_not_found'));
  ledger.close();
  assert.throws(() => ledger.getState(), error('ledger_closed'));
});

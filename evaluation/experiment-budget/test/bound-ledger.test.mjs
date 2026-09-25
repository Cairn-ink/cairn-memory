import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, linkSync, lstatSync, mkdtempSync, renameSync, rmSync, unlinkSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createExperimentBudget, openBoundExperimentBudget, reopenExperimentBudget,
  ExperimentBudgetError } from '../index.mjs';

const fails = (code) => (error) => error instanceof ExperimentBudgetError && error.code === code;
const moduleUrl = new URL('../index.mjs', import.meta.url).href;

function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cairn-bound-ledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const configuration = { directory: path.join(root, 'budget'), runId: randomUUID(),
    limitMicroUsd: 1_000, requestCap: 5 };
  const initial = createExperimentBudget(configuration);
  initial.close();
  return configuration;
}

test('bound handle authorizes settled state and witnesses only its own committed rows', (t) => {
  const configuration = fixture(t);
  let seen;
  const bound = openBoundExperimentBudget({ configuration, authorize(state) {
    seen = state;
    assert.equal(Object.isFrozen(state), true);
    assert.equal(Object.isFrozen(state.attempts), true);
  } });
  t.after(() => bound.close());
  assert.equal(seen.requestCount, 0);
  const attemptId = randomUUID();
  bound.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 120 });
  assert.equal(bound.getState().attempts[0].outcome, null);
  bound.recordOutcome({ attemptId, outcome: 'unknown' });
  assert.equal(bound.getState().reservedMicroUsd, 120);
  assert.equal(bound.getState().attempts[0].actualMicroUsd, null);
});

test('foreign settlement or append fences bound handle inside its next transaction', (t) => {
  const configuration = fixture(t);
  const firstId = randomUUID();
  const bound = openBoundExperimentBudget({ configuration, authorize() {} });
  t.after(() => bound.close());
  bound.reserve({ attemptId: firstId, channel: 'host-completion', reservedMicroUsd: 100 });
  const foreign = reopenExperimentBudget(configuration);
  foreign.recordOutcome({ attemptId: firstId, outcome: 'unknown' });
  foreign.close();
  assert.throws(() => bound.reserve({ attemptId: randomUUID(), channel: 'host-completion',
    reservedMicroUsd: 100 }), fails('invalid_ledger'));
  assert.throws(() => bound.getState(), fails('ledger_closed'));
  const observer = reopenExperimentBudget(configuration);
  assert.equal(observer.getState().requestCount, 1);
  observer.close();
});

test('bound authorization is existing-only and refuses pending state and callback return', (t) => {
  const configuration = fixture(t);
  const old = reopenExperimentBudget(configuration);
  old.reserve({ attemptId: randomUUID(), channel: 'cairn-count', reservedMicroUsd: 1 });
  old.close();
  assert.throws(() => openBoundExperimentBudget({ configuration, authorize() {} }),
    fails('budget_blocked'));
  const another = fixture(t);
  assert.throws(() => openBoundExperimentBudget({ configuration: another,
    authorize() { return 1; } }), fails('ledger_failed'));
  const observer = reopenExperimentBudget(another);
  assert.equal(observer.getState().requestCount, 0);
  observer.close();
});

test('foreign append and path identity or privacy changes fence before a bound reservation', (t) => {
  const configuration = fixture(t);
  const bound = openBoundExperimentBudget({ configuration, authorize() {} });
  t.after(() => bound.close());
  const foreign = reopenExperimentBudget(configuration);
  const id = randomUUID();
  foreign.reserve({ attemptId: id, channel: 'cairn-count', reservedMicroUsd: 1 });
  foreign.recordOutcome({ attemptId: id, outcome: 'failed' });
  foreign.close();
  assert.throws(() => bound.reserve({ attemptId: randomUUID(), channel: 'cairn-count',
    reservedMicroUsd: 1 }), fails('invalid_ledger'));
  assert.throws(() => bound.getState(), fails('ledger_closed'));

  const second = openBoundExperimentBudget({ configuration, authorize() {} });
  t.after(() => second.close());
  const filename = path.join(configuration.directory, 'experiment-budget.sqlite');
  const moved = path.join(configuration.directory, 'moved.sqlite');
  renameSync(filename, moved);
  assert.throws(() => second.reserve({ attemptId: randomUUID(), channel: 'cairn-count',
    reservedMicroUsd: 1 }), fails('ledger_missing'));
  assert.throws(() => second.getState(), fails('ledger_closed'));
  assert.equal(lstatSync(moved).isFile(), true);
  renameSync(moved, filename);

  const third = openBoundExperimentBudget({ configuration, authorize() {} });
  t.after(() => third.close());
  const alias = path.join(configuration.directory, 'linked.sqlite');
  linkSync(filename, alias);
  assert.throws(() => third.reserve({ attemptId: randomUUID(), channel: 'cairn-count',
    reservedMicroUsd: 1 }), fails('unsafe_database_file'));
  assert.throws(() => third.getState(), fails('ledger_closed'));
  unlinkSync(alias);

  const fourth = openBoundExperimentBudget({ configuration, authorize() {} });
  t.after(() => fourth.close());
  if (process.platform !== 'win32') {
    chmodSync(filename, 0o644);
    assert.throws(() => fourth.reserve({ attemptId: randomUUID(), channel: 'cairn-count',
      reservedMicroUsd: 1 }), fails('unsafe_database_file'));
    assert.throws(() => fourth.getState(), fails('ledger_closed'));
    chmodSync(filename, 0o600);
  }
});

test('pre- and post-COMMIT failure fence the handle without inventing a refund or retry', (t) => {
  for (const mode of ['before', 'after']) {
    const configuration = fixture(t);
    const attemptId = randomUUID();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { DatabaseSync } from 'node:sqlite';
      import { openBoundExperimentBudget } from ${JSON.stringify(moduleUrl)};
      const config = JSON.parse(process.argv[1]);
      const id = process.argv[2];
      const mode = process.argv[3];
      const handle = openBoundExperimentBudget({ configuration: config, authorize() {} });
      const original = DatabaseSync.prototype.exec;
      DatabaseSync.prototype.exec = function (sql) {
        if (sql === 'COMMIT') {
          DatabaseSync.prototype.exec = original;
          if (mode === 'before') throw new Error('synthetic before COMMIT');
          original.call(this, sql);
          throw new Error('synthetic after COMMIT');
        }
        return original.call(this, sql);
      };
      let first;
      try { handle.reserve({ attemptId: id, channel: 'host-completion', reservedMicroUsd: 7 }); }
      catch (error) { first = error.code; }
      let second;
      try { handle.getState(); } catch (error) { second = error.code; }
      console.log(JSON.stringify({ first, second }));
    `, JSON.stringify(configuration), attemptId, mode], { encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    assert.equal(child.status, 0, child.stderr);
    assert.deepEqual(JSON.parse(child.stdout.trim()), { first: 'ledger_failed', second: 'ledger_closed' });
    const recovered = reopenExperimentBudget(configuration);
    const state = recovered.getState();
    recovered.close();
    assert.equal(state.requestCount, mode === 'after' ? 1 : 0);
    assert.equal(state.reservedMicroUsd, mode === 'after' ? 7 : 0);
    if (mode === 'after') {
      assert.equal(state.attempts[0].attemptId, attemptId);
      assert.equal(state.attempts[0].outcome, null);
    }
  }
});

test('a foreign terminal row exactly before reserve BEGIN cannot be adopted as bound history', (t) => {
  const configuration = fixture(t);
  const foreignId = randomUUID();
  const ownId = randomUUID();
  const source = `
    import { DatabaseSync } from 'node:sqlite';
    import { openBoundExperimentBudget, reopenExperimentBudget } from ${JSON.stringify(moduleUrl)};
    const config = JSON.parse(process.argv[1]);
    const foreignId = process.argv[2];
    const ownId = process.argv[3];
    const bound = openBoundExperimentBudget({ configuration: config, authorize() {} });
    const original = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function (sql) {
      if (sql === 'BEGIN IMMEDIATE') {
        DatabaseSync.prototype.exec = original;
        const other = reopenExperimentBudget(config);
        other.reserve({ attemptId: foreignId, channel: 'cairn-count', reservedMicroUsd: 3 });
        other.recordOutcome({ attemptId: foreignId, outcome: 'unknown' });
        other.close();
      }
      return original.call(this, sql);
    };
    let first;
    try { bound.reserve({ attemptId: ownId, channel: 'cairn-count', reservedMicroUsd: 2 }); }
    catch (error) { first = error.code; }
    let second;
    try { bound.getState(); } catch (error) { second = error.code; }
    console.log(JSON.stringify({ first, second }));
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source,
    JSON.stringify(configuration), foreignId, ownId], { encoding: 'utf8', timeout: 10_000,
    env: { NODE_NO_WARNINGS: '1' } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), { first: 'invalid_ledger', second: 'ledger_closed' });
  const observer = reopenExperimentBudget(configuration);
  const state = observer.getState();
  observer.close();
  assert.equal(state.requestCount, 1);
  assert.equal(state.attempts[0].attemptId, foreignId);
  assert.equal(state.attempts.some((attempt) => attempt.attemptId === ownId), false);
});

test('authorization callback path changes reject before commit and preserve moved data', (t) => {
  const configuration = fixture(t);
  const filename = path.join(configuration.directory, 'experiment-budget.sqlite');
  if (process.platform !== 'win32') {
    assert.throws(() => openBoundExperimentBudget({ configuration, authorize() {
      chmodSync(filename, 0o644);
    } }), fails('unsafe_database_file'));
    chmodSync(filename, 0o600);
  }
  const moved = path.join(configuration.directory, 'moved-during-authorization.sqlite');
  assert.throws(() => openBoundExperimentBudget({ configuration, authorize() {
    renameSync(filename, moved);
  } }), fails('ledger_missing'));
  assert.equal(lstatSync(moved).isFile(), true);
  assert.throws(() => lstatSync(filename), { code: 'ENOENT' });
  renameSync(moved, filename);
  const observer = reopenExperimentBudget(configuration);
  assert.equal(observer.getState().requestCount, 0);
  observer.close();
});

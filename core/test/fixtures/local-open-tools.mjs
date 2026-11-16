import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { openMemoryCore } from '../../index.mjs';
import { openDatabase } from '../../database.mjs';
import { eventTimeFixture } from '../../testing/receipt-event-time-fixture.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

export async function localOpenFixture(t, shape) {
  let path;
  if (shape === 53) path = (await eventTimeFixture(t, 33)).path;
  else path = join(createTestWorkspace(t, { prefix: 'ordinary-open-' }).path, 'store.sqlite');
  const config = { path, raw: true, rawSearch: false };
  const core = openMemoryCore(config); await core.close();
  const db = new DatabaseSync(path);
  try { assert.equal(db.prepare('PRAGMA user_version').get().user_version, shape); }
  finally { db.close(); }
  return { path, config };
}

export function observeOpen(work) {
  const rows = [], owners = new WeakMap(); let canonical;
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  const methods = new Map(['get','all','run','iterate'].map(key => [key, StatementSync.prototype[key]]));
  function record(db, sql) {
    if (String(sql).startsWith('PRAGMA foreign_keys = ON;')) canonical ??= db;
    rows.push({ db, sql: String(sql), transaction: db.isTransaction });
  }
  DatabaseSync.prototype.exec = function(sql) { record(this, sql); return exec.call(this, sql); };
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = prepare.call(this, sql); owners.set(statement, { db: this, sql }); return statement;
  };
  for (const [key, method] of methods) StatementSync.prototype[key] = function(...args) {
    const owner = owners.get(this); if (owner) record(owner.db, owner.sql);
    return method.apply(this, args);
  };
  try {
    const value = work();
    return { value, trace: rows.filter(row => row.db === canonical).map(({ db, ...row }) => row) };
  } finally {
    DatabaseSync.prototype.exec = exec; DatabaseSync.prototype.prepare = prepare;
    for (const [key, method] of methods) StatementSync.prototype[key] = method;
  }
}
export function lockChild(role, path) {
  const child = spawn(process.execPath, [fileURLToPath(new URL('./open-lock-child.mjs', import.meta.url)), role, path],
    { stdio: ['ignore','ignore','pipe','ipc'] });
  let stderr = '', messages = [], waiters = [];
  child.stderr.on('data', data => { stderr += data; });
  child.on('message', value => { const waiter = waiters.shift(); if (waiter) waiter.resolve(value); else messages.push(value); });
  const ended = new Promise(resolve => child.once('close', (code, signal) => {
    for (const waiter of waiters.splice(0)) waiter.reject(Error('child closed: ' + stderr));
    resolve({ code, signal });
  }));
  child.on('error', error => { for (const waiter of waiters.splice(0)) waiter.reject(error); });
  function message() {
    if (messages.length) return Promise.resolve(messages.shift());
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(Error('child IPC timeout: ' + stderr)); }, 15000);
      waiters.push({ resolve: value => { clearTimeout(timer); resolve(value); }, reject: error => { clearTimeout(timer); reject(error); } });
    });
  }
  const ready = message();
  return { child, ready, async finish() {
    const report = message(); child.send('release');
    const value = await report;
    assert.deepEqual(await ended, { code: 0, signal: null }, stderr);
    return value;
  } };
}

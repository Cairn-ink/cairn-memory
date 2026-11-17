import { strict as assert } from 'node:assert';
import { registerHooks } from 'node:module';
import { connect } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { isMainThread, parentPort, Worker, workerData } from 'node:worker_threads';

if (isMainThread) {
  const [path, port] = process.argv.slice(2);
  const db = new DatabaseSync(path);
  const gate = new Int32Array(new SharedArrayBuffer(4));
  const relay = new Worker(new URL(import.meta.url), { workerData: { gate, port: Number(port) } });
  try {
    db.exec('BEGIN EXCLUSIVE; CREATE TABLE retry_lock_probe (value)');
    relay.postMessage('locked');
    assert.notEqual(Atomics.wait(gate, 0, 0, 10000), 'timed-out');
    db.exec('ROLLBACK');
  } finally { db.close(); }
} else if (workerData.gate) {
  const socket = connect(workerData.port, '127.0.0.1');
  parentPort.once('message', () => socket.write('locked'));
  socket.once('data', () => {
    Atomics.store(workerData.gate, 0, 1);
    Atomics.notify(workerData.gate, 0);
    socket.end();
  });
} else {
  const { control, fault, mutation } = workerData;
  let hit = 0;
  function report(error, db, boundary) {
    const errcode = error?.errcode;
    if (error?.code !== 'ERR_SQLITE_ERROR' || ![5, 6].includes(errcode & 255)) return;
    control.postMessage({ boundary, errcode, transaction: db?.isTransaction ?? false });
    if (mutation) assert.notEqual(Atomics.wait(mutation, 0, 0, 2000), 'timed-out');
  }
  function inject(boundary, db) {
    if (fault?.boundary !== boundary) return;
    if (++hit !== (fault.at ?? 1) && !fault.repeat) return;
    const error = Object.assign(new Error('native-shaped test fault'), { code: 'ERR_SQLITE_ERROR', errcode: fault.errcode });
    report(error, db, boundary);
    throw error;
  }
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  if (fault?.boundary === 'open') {
    globalThis.topicRetryTestDatabase = class extends DatabaseSync {
      constructor(...args) { inject('open'); super(...args); }
    };
    const opener = new URL('../../read-database.mjs', import.meta.url).href;
    const shim = 'data:text/javascript,export const DatabaseSync = globalThis.topicRetryTestDatabase;';
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === 'node:sqlite' && context.parentURL === opener) return { url: shim, shortCircuit: true };
      return next(specifier, context);
    } });
  }
  DatabaseSync.prototype.exec = function (sql) {
    inject(sql, this);
    return exec.call(this, sql);
  };
  DatabaseSync.prototype.prepare = function (sql) {
    let statement;
    try { statement = prepare.call(this, sql); }
    catch (error) { report(error, this, sql); throw error; }
    const get = statement.get;
    const db = this;
    statement.get = function (...args) {
      if (sql.includes('FROM memories INDEXED BY index_memory_keyset')) inject('scan', db);
      try { return get.apply(this, args); }
      catch (error) { report(error, db, sql); throw error; }
    };
    return statement;
  };
  await import('../../topic-overview-worker.mjs');
}

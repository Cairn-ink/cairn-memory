import { strict as assert } from 'node:assert';
import { registerHooks } from 'node:module';
import { connect } from 'node:net';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
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
  const { control, pauseAt, splitScan } = workerData;
  let faults, backoffs = 0, finished = false, released = false, faultDb;
  const arm = faultsToArm => { faults = faultsToArm.map(fault => ({ ...fault, hits: 0 })); };
  arm(workerData.faults);
  const gate = Promise.withResolvers();
  control.on('message', message => {
    if (message === 'release') {
      released = true;
      gate.resolve();
    } else {
      if (message.faults) arm(message.faults);
      control.postMessage('synced');
    }
  });
  control.unref();
  function report(error, db, boundary) {
    const errcode = error?.errcode;
    if (error?.code !== 'ERR_SQLITE_ERROR' || ![5, 6].includes(errcode & 255)) return;
    faultDb = db;
    control.postMessage({ boundary, errcode, transaction: db?.isTransaction ?? false });
  }
  function inject(boundary, db) {
    let matched;
    for (const fault of faults) {
      if (fault.boundary !== boundary) continue;
      const firstHit = fault.at ?? 1;
      const hit = ++fault.hits;
      if (hit === firstHit || (hit > firstHit && fault.repeat)) matched ??= fault;
    }
    if (!matched) return;
    const error = Object.assign(new Error('native-shaped test fault'), { code: 'ERR_SQLITE_ERROR', errcode: matched.errcode });
    report(error, db, boundary);
    throw error;
  }

  const policy = new URL('../../topic-reader-sqlite.mjs', import.meta.url).href;
  const opener = new URL('../../read-database.mjs', import.meta.url).href;
  const worker = new URL('../../topic-overview-worker.mjs', import.meta.url).href;
  const overview = new URL('../../topic-overview-storage.mjs', import.meta.url).href;
  const shims = new Map();
  function shim(parent, specifier, name, value) {
    const key = 'topicBusyTest_' + name;
    globalThis[key] = value;
    shims.set(parent + ' ' + specifier, 'data:text/javascript,export const ' + name + ' = globalThis.' + key + ';');
  }
  shim(opener, 'node:sqlite', 'DatabaseSync', class extends DatabaseSync {
    constructor(...args) { inject('open'); super(...args); }
  });
  shim(policy, 'node:timers/promises', 'setTimeout', ms => {
    const waiting = delay(ms);
    if (++backoffs !== pauseAt) return waiting;
    assert.ok(!faultDb?.isOpen || !faultDb.isTransaction, 'the delay starts after rollback');
    control.postMessage('backoff');
    return Promise.all([waiting, gate.promise]);
  });
  if (splitScan) {
    const { createTopicOverviewStorage } = await import(overview);
    let elapsed = 0;
    shim(worker, 'node:perf_hooks', 'performance', { now: () => performance.now() + elapsed });
    shim(worker, './topic-overview-storage.mjs', 'createTopicOverviewStorage', (...args) => {
      const storage = createTopicOverviewStorage(...args);
      return { ...storage, create(...inputs) {
        const data = storage.create(...inputs);
        return { ...data, scan: { next() {
          elapsed += 5;
          return data.scan.next();
        } }, finish() {
          const items = data.finish();
          finished = true;
          return items;
        } };
      } };
    });
  }
  registerHooks({ resolve(specifier, context, next) {
    const url = shims.get(context.parentURL + ' ' + specifier);
    return url ? { url, shortCircuit: true } : next(specifier, context);
  } });

  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.exec = function (sql) {
    inject(sql, this);
    if (sql === 'COMMIT' && finished) inject('final COMMIT', this);
    return exec.call(this, sql);
  };
  DatabaseSync.prototype.prepare = function (sql) {
    inject('prepare ' + sql, this);
    let statement;
    try { statement = prepare.call(this, sql); }
    catch (error) { report(error, this, sql); throw error; }
    if (pauseAt && sql.includes('SELECT * FROM content_suppressions INDEXED BY content_suppression_target')) {
      const all = statement.all;
      statement.all = function (...args) {
        const rows = all.apply(this, args);
        if (released) {
          for (const { kind, stable_key, reason } of rows) {
            if (kind === 'memory' && reason === 'user_forget') control.postMessage({ suppressedMemory: stable_key });
          }
        }
        return rows;
      };
    }
    const get = statement.get;
    const db = this;
    statement.get = function (...args) {
      if (sql.includes('FROM memories INDEXED BY index_memory_keyset')) inject('scan', db);
      if (sql.startsWith('SELECT id,owner_id,scope,project_id,revision,level FROM mocs WHERE')) inject('target', db);
      if (sql.startsWith('SELECT active_generation FROM namespace_index_state WHERE')) inject('snapshot', db);
      if (sql === 'PRAGMA journal_mode') inject(sql, db);
      try { return get.apply(this, args); }
      catch (error) { report(error, db, sql); throw error; }
    };
    return statement;
  };
  await import(worker);
}

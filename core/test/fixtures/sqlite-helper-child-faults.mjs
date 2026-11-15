// Test-only process/Worker bootstrap. Production never imports this module.
import threads from 'node:worker_threads';
import children from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';

const envelope = threads.workerData?.sqliteChildFaults;
const state = new Int32Array(envelope?.state ?? new SharedArrayBuffer(48));
const spawnSync = children.spawnSync, NativeWorker = threads.Worker;
const stall = "console.log('CHILD_STALL_REACHED'); Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0);";
// Track the actual native receiver, rather than only the public reader handle.
const connections = new WeakMap(), prepare = DatabaseSync.prototype.prepare;
let connectionSequence = 0;
function schemaCall(database, work) {
  if (!connections.has(database)) connections.set(database, ++connectionSequence);
  const id = connections.get(database);
  try {
    const value = work();
    if (state[9] === id) Atomics.store(state, 10, id);
    return value;
  } catch (error) {
    if (error.code === 'ERR_SQLITE_ERROR' && [5, 6].includes(error.errcode & 255)) Atomics.store(state, 9, id);
    throw error;
  }
}
DatabaseSync.prototype.prepare = function(sql, ...args) {
  if (sql !== 'PRAGMA schema_version') return Reflect.apply(prepare, this, [sql, ...args]);
  const database = this, statement = schemaCall(database, () => Reflect.apply(prepare, database, [sql, ...args]));
  const get = statement.get;
  statement.get = (...values) => schemaCall(database, () => Reflect.apply(get, statement, values));
  return statement;
};
export const faults = {
  arm(target, mode = 1, header = false) {
    state.fill(0); state[1] = target; state[2] = Number(header); state[0] = mode;
  },
  reset() { state.fill(0); },
  get counts() { return { injected: state[3], probes: state[4], creations: state[5], reached: state[6], readyBusy: state[8], busyConnection: state[9], retriedConnection: state[10] }; },
};
children.spawnSync = (command, args, options) => {
  const source = args?.[2], path = String(args?.[3]);
  const creation = typeof source === 'string' && source.includes('fsyncSync(fd);');
  const probe = typeof source === 'string' && source.includes('PRAGMA journal_mode') && path.includes('nolock=1');
  if (creation) Atomics.add(state, 5, 1);
  if (probe) Atomics.add(state, 4, 1);
  const target = state[1], selected = target === 1 ? creation && path.includes('.semantic-owner-')
    : target === 2 ? creation && path.endsWith('.lifecycle-lock.sqlite')
    : target === 3 ? creation && path.endsWith('.context-read-product-v1.1.sqlite')
    : target === 4 ? probe : target === 5 && creation;
  const mode = selected ? Atomics.exchange(state, 0, 0) : 0;
  if (!mode) return spawnSync(command, args, options);
  Atomics.add(state, 3, 1);
  assert.equal(options.timeout, 5000, 'production helper timeout remains 5000 ms');
  assert.deepEqual(options.env, {}, 'helper does not inherit test configuration');
  args = [...args];
  if (mode === 4) return { error: Object.assign(Error('synthetic-private-path-and-content'), { code: 'ENOENT' }), status: null, signal: null, stdout: null, stderr: 'synthetic-private-path-and-content' };
  if (mode === 1) {
    if (creation) {
      const anchor = 'const { dev, ino } = fstatSync(fd);';
      assert.ok(source.includes(anchor), 'creation delay anchor');
      const header = state[2] ? "const {DatabaseSync}=await import('node:sqlite'); const half=new DatabaseSync(temporary); half.exec('VACUUM'); half.close();" : '';
      args[2] = source.replace(anchor, anchor + header + stall);
    } else args[2] = source + '\n' + stall;
    const result = spawnSync(command, args, { ...options, timeout: 1500 });
    Atomics.store(state, 6, Number(result.stdout?.includes('CHILD_STALL_REACHED')));
    return result;
  }
  // Real child exit/signal, with hostile output that must never enter a cause.
  args[2] = "console.error('synthetic-private-path-and-content'); " + (mode === 2 ? 'process.exit(23);' : "process.kill(process.pid,'SIGTERM');");
  return spawnSync(command, args, options);
};
threads.Worker = class extends NativeWorker {
  constructor(entry, options = {}) {
    super(new URL('./sqlite-helper-child-fault-worker.mjs', import.meta.url), {
      ...options, workerData: { sqliteChildFaults: { entry: String(entry), data: options.workerData, state: state.buffer } },
    });
    this.on('message', message => {
      if (message.kind === 'ready' && message.result?.ok === false)
        Atomics.store(state, 8, Number(message.result.error.code === 'storage_busy' && message.result.error.retryable === true));
    });
  }
};
if (envelope) threads.workerData = envelope.data;
syncBuiltinESMExports();
